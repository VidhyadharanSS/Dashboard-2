package kube

import (
	"context"
	"sync"
	"time"

	"golang.org/x/net/websocket"
	"k8s.io/klog/v2"
)

// WebSocketKeepalive manages keepalive for WebSocket connections
// to prevent idle connection timeouts through proxies (especially zero-trust)
type WebSocketKeepalive struct {
	conn          *websocket.Conn
	interval      time.Duration
	stopChan      chan struct{}
	stoppedChan   chan struct{}
	mu            sync.Mutex
	running       bool
	lastPongTime  time.Time
	pongTimeout   time.Duration
}

// NewWebSocketKeepalive creates a new keepalive manager for a WebSocket connection
func NewWebSocketKeepalive(conn *websocket.Conn) *WebSocketKeepalive {
	return &WebSocketKeepalive{
		conn:         conn,
		interval:     30 * time.Second, // Send ping every 30 seconds
		pongTimeout:  10 * time.Second, // Expect pong within 10 seconds
		stopChan:     make(chan struct{}),
		stoppedChan:  make(chan struct{}),
		lastPongTime: time.Now(),
	}
}

// Start begins sending periodic ping frames
func (k *WebSocketKeepalive) Start(ctx context.Context) {
	k.mu.Lock()
	if k.running {
		k.mu.Unlock()
		return
	}
	k.running = true
	k.mu.Unlock()

	go k.pingLoop(ctx)
}

// Stop stops the keepalive mechanism
func (k *WebSocketKeepalive) Stop() {
	k.mu.Lock()
	if !k.running {
		k.mu.Unlock()
		return
	}
	k.running = false
	k.mu.Unlock()

	close(k.stopChan)
	<-k.stoppedChan
}

// pingLoop sends periodic ping frames and monitors for pong responses
func (k *WebSocketKeepalive) pingLoop(ctx context.Context) {
	defer close(k.stoppedChan)

	ticker := time.NewTicker(k.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-k.stopChan:
			return
		case <-ticker.C:
			if err := k.sendPing(); err != nil {
				klog.V(2).Infof("WebSocket keepalive ping failed: %v", err)
				return
			}

			// Check if we received a pong recently
			k.mu.Lock()
			timeSinceLastPong := time.Since(k.lastPongTime)
			k.mu.Unlock()

			if timeSinceLastPong > k.interval+k.pongTimeout {
				klog.V(2).Infof("WebSocket connection appears dead (no pong for %v)", timeSinceLastPong)
				return
			}
		}
	}
}

// sendPing sends a ping frame to the WebSocket connection
func (k *WebSocketKeepalive) sendPing() error {
	k.mu.Lock()
	defer k.mu.Unlock()

	// Send a simple ping message
	// Note: golang.org/x/net/websocket doesn't have built-in ping/pong frames
	// so we send a JSON message that clients can ignore
	msg := map[string]string{"type": "ping"}
	if err := websocket.JSON.Send(k.conn, msg); err != nil {
		return err
	}

	return nil
}

// UpdatePongTime updates the last pong received time
func (k *WebSocketKeepalive) UpdatePongTime() {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.lastPongTime = time.Now()
}

// SetInterval changes the ping interval (useful for testing)
func (k *WebSocketKeepalive) SetInterval(interval time.Duration) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.interval = interval
}
