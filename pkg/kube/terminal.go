package kube

import (
	"context"
	"fmt"
	"log"
	"time"

	"golang.org/x/net/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/klog/v2"
)

const EndOfTransmission = "\u0004"

// TerminalMessage represents messages sent over the WebSocket
type TerminalMessage struct {
	Type string `json:"type"` // "stdin", "resize", "ping"
	Data string `json:"data"`
	Rows uint16 `json:"rows,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
}

// TerminalSession manages a WebSocket connection for terminal communication
type TerminalSession struct {
	k8sClient *K8sClient
	conn      *websocket.Conn
	sizeChan  chan *remotecommand.TerminalSize
	namespace string
	podName   string
	container string

	lastHeartbeat time.Time // Track last heartbeat for ping/pong
	readBuffer    []byte    // Buffer for data that exceeded the last Read call
}

func NewTerminalSession(client *K8sClient, conn *websocket.Conn, namespace, podName, container string) *TerminalSession {
	return &TerminalSession{
		k8sClient:  client,
		conn:       conn,
		sizeChan:   make(chan *remotecommand.TerminalSize, 10),
		namespace:  namespace,
		podName:    podName,
		container:  container,
		readBuffer: nil, // Initialize empty buffer
	}
}

func (session *TerminalSession) Start(ctx context.Context, subResource string) error {
	// Common shells to try in order of preference
	shells := [][]string{
		{"bash"},
		{"sh"},
		{"/bin/bash"},
		{"/usr/bin/bash"},
		{"/bin/sh"},
		{"/usr/bin/sh"},
	}

	var lastErr error
	for _, shell := range shells {
		err := session.execute(ctx, subResource, shell)
		if err == nil {
			return nil
		}
		lastErr = err
		// Continue if it's a "file not found" or "no such file" error
		klog.V(2).Infof("Shell %v failed: %v", shell, err)
	}

	if lastErr != nil {
		session.SendErrorMessage(fmt.Sprintf("All shells failed. Last error: %v", lastErr))
	}
	return lastErr
}

func (session *TerminalSession) execute(ctx context.Context, subResource string, command []string) error {
	req := session.k8sClient.ClientSet.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(session.podName).
		Namespace(session.namespace).
		SubResource(subResource)

	req.VersionedParams(&corev1.PodExecOptions{
		Container: session.container,
		Command:   command,
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
		TTY:       true,
	}, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(session.k8sClient.Configuration, "POST", req.URL())
	if err != nil {
		return err
	}

	// Send initial connection success message
	session.SendMessage("connected", fmt.Sprintf("Terminal connected successfully using %v", command))

	go session.checkHeartbeat(ctx)

	return exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             session,
		Stdout:            session,
		Stderr:            session,
		Tty:               true,
		TerminalSizeQueue: session,
	})
}

func (session *TerminalSession) Close() {
	if err := session.conn.Close(); err != nil {
		klog.Errorf("WebSocket close error %s: %v", session.conn.RemoteAddr(), err)
	}
	close(session.sizeChan)
}

func (session *TerminalSession) Read(p []byte) (int, error) {
	// 1. If we have buffered data from a previous read, return that first
	if len(session.readBuffer) > 0 {
		n := copy(p, session.readBuffer)
		session.readBuffer = session.readBuffer[n:] // Advance the buffer
		return n, nil
	}

	// 2. Loop until we get stdin data or an error
	// We loop here to handle "resize" or "ping" messages without returning 0 bytes to the caller,
	// effectively blocking until actual data arrives or the connection closes.
	for {
		var msg TerminalMessage
		err := websocket.JSON.Receive(session.conn, &msg)
		if err != nil {
			return copy(p, EndOfTransmission), err
		}

		switch msg.Type {
		case "stdin":
			data := []byte(msg.Data)
			n := copy(p, data)
			// If the message data is larger than buffer p, save the rest
			if n < len(data) {
				session.readBuffer = data[n:]
			}
			return n, nil

		case "resize":
			if msg.Rows > 0 && msg.Cols > 0 {
				select {
				case session.sizeChan <- &remotecommand.TerminalSize{
					Width:  msg.Cols,
					Height: msg.Rows,
				}:
				default:
				}
			}
			// Continue loop to get next message

		case "ping":
			session.lastHeartbeat = time.Now()
			session.SendMessage("pong", "")
			// Continue loop to get next message

		default:
			// Log unknown types but don't break connection
			klog.Warningf("Unknown message type received: %s", msg.Type)
		}
	}
}

func (session *TerminalSession) Write(p []byte) (int, error) {
	msg := TerminalMessage{
		Type: "stdout",
		Data: string(p),
	}
	err := websocket.JSON.Send(session.conn, msg)
	if err != nil {
		log.Printf("Write stdout error: %v", err)
		return 0, err
	}
	return len(p), nil
}

func (session *TerminalSession) Next() *remotecommand.TerminalSize {
	return <-session.sizeChan
}

func (session *TerminalSession) SendMessage(msgType, data string) {
	msg := TerminalMessage{
		Type: msgType,
		Data: data,
	}
	err := websocket.JSON.Send(session.conn, msg)
	if err != nil {
		klog.Errorf("Send message error: %v", err)
	}
}

func (session *TerminalSession) SendErrorMessage(errMsg string) {
	session.SendMessage("error", errMsg)
}

func (session *TerminalSession) checkHeartbeat(ctx context.Context) {
	session.lastHeartbeat = time.Now()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Since(session.lastHeartbeat) > 1*time.Minute {
				if err := session.conn.Close(); err != nil {
					klog.Errorf("WebSocket close error: %v", err)
				}
				return
			}
		}
	}
}