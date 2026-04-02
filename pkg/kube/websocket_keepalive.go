package kube

import (
	"context"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"k8s.io/klog/v2"
)

// WebSocketKeepalive manages keepalive for WebSocket connections to prevent
// idle connection timeouts through reverse proxies (nginx, zero-trust,
// corporate proxies).
//
// With gorilla/websocket we send native RFC 6455 Ping control frames.
// These are handled transparently by the browser (which responds with a Pong)
// and, crucially, they count as real data for all intermediate proxies —
// resetting proxy_read_timeout in ingress-nginx, AWS ALB idle timeout, etc.
//
// gorilla/websocket guarantees: one concurrent reader + one concurrent writer
// is safe.  The Ping control frame is written via WriteControl, which is safe
// to call concurrently with WriteMessage/WriteJSON.
//
// The interval MUST be shorter than the smallest proxy timeout in the chain.
// ingress-nginx default proxy_read_timeout = 60s, so we use 20s — giving
// 3 missed pings before the proxy would time out.
type WebSocketKeepalive struct {
	conn        *websocket.Conn
	interval    time.Duration
	stopChan    chan struct{}
	stoppedChan chan struct{}
	mu          sync.Mutex
	running     bool
}

// NewWebSocketKeepalive creates a new keepalive manager for a WebSocket connection.
// Default ping interval: 20s (safe for the common 60s proxy read-timeout).
func NewWebSocketKeepalive(conn *websocket.Conn) *WebSocketKeepalive {
	return &WebSocketKeepalive{
		conn:        conn,
		interval:    20 * time.Second,
		stopChan:    make(chan struct{}),
		stoppedChan: make(chan struct{}),
	}
}

// Start begins sending periodic RFC 6455 Ping frames.
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

// Stop stops the keepalive mechanism and waits for the goroutine to exit.
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

// pingLoop sends periodic RFC 6455 Ping control frames to keep the connection alive.
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
				klog.V(2).Infof("WebSocket keepalive ping failed (connection likely closed): %v", err)
				return
			}
		}
	}
}

// sendPing sends a native RFC 6455 Ping control frame.
// WriteControl is safe to call concurrently with WriteMessage/WriteJSON.
func (k *WebSocketKeepalive) sendPing() error {
	deadline := time.Now().Add(10 * time.Second)
	return k.conn.WriteControl(websocket.PingMessage, []byte("keepalive"), deadline)
}

// SetInterval changes the ping interval (useful for testing or tuning).
func (k *WebSocketKeepalive) SetInterval(interval time.Duration) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.interval = interval
}
