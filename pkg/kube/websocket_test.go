package kube

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Helpers ---

// newTestWSPair creates a test HTTP server that upgrades to WebSocket and
// returns the server-side and client-side connections.
func newTestWSPair(t *testing.T) (server *websocket.Conn, client *websocket.Conn, cleanup func()) {
	t.Helper()

	var serverConn *websocket.Conn
	ready := make(chan struct{})

	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("upgrade error: %v", err)
		}
		serverConn = c
		close(ready)
		// Block until test completes so the server doesn't close prematurely
		select {}
	}))

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	dialer := websocket.DefaultDialer
	clientConn, _, err := dialer.Dial(wsURL, nil)
	require.NoError(t, err)

	<-ready

	return serverConn, clientConn, func() {
		clientConn.Close()
		serverConn.Close()
		srv.Close()
	}
}

// --- WebSocketKeepalive Tests ---

func TestWebSocketKeepalive_SendsRFC6455Pings(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	// Track pings received by the client
	var pingCount atomic.Int32
	client.SetPingHandler(func(appData string) error {
		pingCount.Add(1)
		// Respond with pong (default behavior)
		return client.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(time.Second))
	})

	// Start a goroutine to read from client (required for ping handler to fire)
	go func() {
		for {
			_, _, err := client.ReadMessage()
			if err != nil {
				return
			}
		}
	}()

	// Create keepalive with fast interval for testing
	ka := NewWebSocketKeepalive(server)
	ka.SetInterval(50 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ka.Start(ctx)
	time.Sleep(200 * time.Millisecond)
	ka.Stop()

	// Should have received at least 2 pings in 200ms at 50ms interval
	count := pingCount.Load()
	assert.GreaterOrEqual(t, count, int32(2), "Expected at least 2 pings, got %d", count)
}

func TestWebSocketKeepalive_StopsCleanly(t *testing.T) {
	server, _, cleanup := newTestWSPair(t)
	defer cleanup()

	ka := NewWebSocketKeepalive(server)
	ka.SetInterval(10 * time.Millisecond)

	ctx := context.Background()
	ka.Start(ctx)

	// Stop should not block indefinitely
	done := make(chan struct{})
	go func() {
		ka.Stop()
		close(done)
	}()

	select {
	case <-done:
		// OK
	case <-time.After(2 * time.Second):
		t.Fatal("Stop() blocked for too long")
	}
}

func TestWebSocketKeepalive_StopsOnContextCancel(t *testing.T) {
	server, _, cleanup := newTestWSPair(t)
	defer cleanup()

	ka := NewWebSocketKeepalive(server)
	ka.SetInterval(10 * time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	ka.Start(ctx)

	// Cancel context — keepalive should stop
	cancel()
	time.Sleep(50 * time.Millisecond)

	// Stop should be a no-op / return quickly
	done := make(chan struct{})
	go func() {
		ka.Stop()
		close(done)
	}()

	select {
	case <-done:
		// OK
	case <-time.After(2 * time.Second):
		t.Fatal("Stop() blocked after context cancel")
	}
}

func TestWebSocketKeepalive_DoesNotStartTwice(t *testing.T) {
	server, _, cleanup := newTestWSPair(t)
	defer cleanup()

	ka := NewWebSocketKeepalive(server)
	ka.SetInterval(10 * time.Millisecond)

	ctx := context.Background()
	ka.Start(ctx)
	ka.Start(ctx) // Should be a no-op

	ka.Stop()
}

// --- BatchLogHandler / Log Message Tests ---

func TestBatchLogHandler_SendMessage(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	handler := NewBatchLogHandler(server, nil, nil)

	// Write a message via the handler
	handler.writeMu.Lock()
	err := handler.sendMessage("log", "hello world")
	handler.writeMu.Unlock()
	require.NoError(t, err)

	// Read it from the client side
	var msg LogsMessage
	err = client.ReadJSON(&msg)
	require.NoError(t, err)
	assert.Equal(t, "log", msg.Type)
	assert.Equal(t, "hello world", msg.Data)
}

func TestBatchLogHandler_ConcurrentWritesAreSerialised(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	handler := NewBatchLogHandler(server, nil, nil)

	// Read messages in a goroutine
	received := make(chan LogsMessage, 100)
	go func() {
		for {
			var msg LogsMessage
			err := client.ReadJSON(&msg)
			if err != nil {
				close(received)
				return
			}
			received <- msg
		}
	}()

	// Spawn 10 goroutines each sending 10 messages
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				handler.writeMu.Lock()
				_ = handler.sendMessage("log", "msg")
				handler.writeMu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	// Allow time for client to receive
	time.Sleep(100 * time.Millisecond)

	// We should receive exactly 100 valid messages (no corruption)
	count := len(received)
	assert.Equal(t, 100, count, "Expected 100 messages, got %d", count)
}

func TestSendErrorMessage_Standalone(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	err := SendErrorMessage(server, "test error")
	require.NoError(t, err)

	var msg LogsMessage
	err = client.ReadJSON(&msg)
	require.NoError(t, err)
	assert.Equal(t, "error", msg.Type)
	assert.Equal(t, "test error", msg.Data)
}

// --- Terminal Message Tests ---

func TestTerminalMessage_WriteJSON(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	msg := TerminalMessage{
		Type: "stdout",
		Data: "hello terminal",
	}

	err := server.WriteJSON(msg)
	require.NoError(t, err)

	var received TerminalMessage
	err = client.ReadJSON(&received)
	require.NoError(t, err)
	assert.Equal(t, "stdout", received.Type)
	assert.Equal(t, "hello terminal", received.Data)
}

func TestTerminalMessage_ReadJSON(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	// Client sends a terminal message
	msg := TerminalMessage{
		Type: "stdin",
		Data: "ls -la",
	}
	err := client.WriteJSON(msg)
	require.NoError(t, err)

	// Server reads it
	var received TerminalMessage
	err = server.ReadJSON(&received)
	require.NoError(t, err)
	assert.Equal(t, "stdin", received.Type)
	assert.Equal(t, "ls -la", received.Data)
}

// --- RFC 6455 Ping/Pong Control Frame Tests ---

func TestRFC6455PingPong_ServerToClient(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	// Set up client pong auto-response (default behavior)
	var pongReceived atomic.Int32
	server.SetPongHandler(func(appData string) error {
		pongReceived.Add(1)
		return nil
	})

	// Server sends a Ping
	err := server.WriteControl(websocket.PingMessage, []byte("test"), time.Now().Add(time.Second))
	require.NoError(t, err)

	// Client must read to trigger pong handler
	// Set a read deadline so we don't block forever
	client.SetReadDeadline(time.Now().Add(time.Second))
	_, _, readErr := client.ReadMessage()
	// This will timeout because no data message was sent, but the ping/pong happens at protocol level
	// The pong is handled in the background by gorilla's NextReader
	_ = readErr

	// Server needs to read to trigger its pong handler
	server.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, _, _ = server.ReadMessage()

	count := pongReceived.Load()
	assert.GreaterOrEqual(t, count, int32(1), "Expected pong response from client")
}

func TestRFC6455WriteControlConcurrentSafety(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	// gorilla/websocket allows WriteControl concurrently with WriteMessage.
	// This test verifies no panic or data corruption occurs.

	// Client reads messages in background
	go func() {
		for {
			_, _, err := client.ReadMessage()
			if err != nil {
				return
			}
		}
	}()

	var wg sync.WaitGroup

	// Goroutine 1: Write data frames
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			msg := map[string]string{"type": "log", "data": "test"}
			if err := server.WriteJSON(msg); err != nil {
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()

	// Goroutine 2: Write Ping control frames (concurrent with data frames)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			deadline := time.Now().Add(time.Second)
			if err := server.WriteControl(websocket.PingMessage, []byte("ping"), deadline); err != nil {
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()

	wg.Wait()
	// If we get here without panics, the test passes
}

// --- Application-Level Ping/Pong Tests ---

func TestApplicationLevelPingPong(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	// Simulate server sending an application-level ping
	ping := map[string]string{"type": "ping", "data": ""}
	err := server.WriteJSON(ping)
	require.NoError(t, err)

	// Client reads it
	_, raw, err := client.ReadMessage()
	require.NoError(t, err)

	var msg map[string]string
	err = json.Unmarshal(raw, &msg)
	require.NoError(t, err)
	assert.Equal(t, "ping", msg["type"])

	// Client responds with pong
	pong := map[string]string{"type": "pong"}
	err = client.WriteJSON(pong)
	require.NoError(t, err)

	// Server reads the pong
	var response map[string]string
	err = server.ReadJSON(&response)
	require.NoError(t, err)
	assert.Equal(t, "pong", response["type"])
}

// --- WebSocket Upgrader Tests ---

func TestWSUpgraderAcceptsConnections(t *testing.T) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("upgrade failed: %v", err)
			return
		}
		defer conn.Close()

		// Echo back any message
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := conn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer client.Close()

	// Send and receive a message
	testMsg := `{"type":"test","data":"hello"}`
	err = client.WriteMessage(websocket.TextMessage, []byte(testMsg))
	require.NoError(t, err)

	_, received, err := client.ReadMessage()
	require.NoError(t, err)
	assert.Equal(t, testMsg, string(received))
}

// --- Close Message Tests ---

func TestCloseMessage(t *testing.T) {
	server, client, cleanup := newTestWSPair(t)
	defer cleanup()

	// Server sends a close frame
	closeMsg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, "session ended")
	err := server.WriteMessage(websocket.CloseMessage, closeMsg)
	require.NoError(t, err)

	// Client should receive a close error
	_, _, err = client.ReadMessage()
	require.Error(t, err)
	assert.True(t, websocket.IsCloseError(err, websocket.CloseNormalClosure),
		"Expected CloseNormalClosure, got: %v", err)
}
