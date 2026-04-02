package kube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/klog/v2"
)

type PodLogStream struct {
	Pod    corev1.Pod
	Cancel context.CancelFunc
	Done   chan struct{}
}

// BatchLogHandler streams logs from one or more pods over a single WebSocket.
//
// gorilla/websocket allows one concurrent reader + one concurrent writer.
// We enforce this with:
//   - Single reader:  the heartbeat goroutine owns all reads
//   - Single writer:  writeMu serializes writes from heartbeat (pings/pongs),
//     per-pod log streamers, and AddPod/RemovePod notifications.
type BatchLogHandler struct {
	conn      *websocket.Conn
	writeMu   sync.Mutex // serializes all writes to conn
	pods      map[string]*PodLogStream // key: namespace/name
	k8sClient *K8sClient
	opts      *corev1.PodLogOptions
	ctx       context.Context
	cancel    context.CancelFunc
}

func NewBatchLogHandler(conn *websocket.Conn, client *K8sClient, opts *corev1.PodLogOptions) *BatchLogHandler {
	ctx, cancel := context.WithCancel(context.Background())

	// Set up the pong handler for native RFC 6455 pings.
	// When the browser responds to our Ping frame, extend the read deadline.
	conn.SetReadDeadline(time.Now().Add(120 * time.Second))
	conn.SetPongHandler(func(appData string) error {
		conn.SetReadDeadline(time.Now().Add(120 * time.Second))
		return nil
	})

	l := &BatchLogHandler{
		conn:      conn,
		pods:      make(map[string]*PodLogStream),
		k8sClient: client,
		opts:      opts,
		ctx:       ctx,
		cancel:    cancel,
	}
	return l
}

func (l *BatchLogHandler) StreamLogs(ctx context.Context) {
	// Start heartbeat handler
	go l.heartbeat(ctx)

	// Wait for either external context cancellation or internal cancellation
	select {
	case <-ctx.Done():
		klog.V(1).Info("External context cancelled, stopping BatchLogHandler")
	case <-l.ctx.Done():
		klog.V(1).Info("Internal context cancelled, stopping BatchLogHandler")
	}

	l.Stop()
}

func (l *BatchLogHandler) startPodLogStream(podStream *PodLogStream) {
	pod := podStream.Pod
	podCtx, cancel := context.WithCancel(l.ctx)
	podStream.Cancel = cancel

	defer func() {
		close(podStream.Done)
	}()

	req := l.k8sClient.ClientSet.CoreV1().Pods(pod.Namespace).GetLogs(pod.Name, l.opts)
	podLogs, err := req.Stream(podCtx)
	if err != nil {
		l.writeMu.Lock()
		_ = l.sendErrorMessage(fmt.Sprintf("Failed to get pod logs for %s: %v", pod.Name, err))
		l.writeMu.Unlock()
		return
	}
	defer func() {
		_ = podLogs.Close()
	}()

	lw := writerFunc(func(p []byte) (int, error) {
		logString := string(p)
		logLines := strings.SplitSeq(logString, "\n")
		for line := range logLines {
			if line == "" {
				continue
			}
			if len(l.pods) > 1 {
				line = fmt.Sprintf("[%s]: %s", pod.Name, line)
			}
			l.writeMu.Lock()
			err := l.sendMessage("log", line)
			l.writeMu.Unlock()
			if err != nil {
				return 0, err
			}
		}

		return len(p), nil
	})

	_, err = io.Copy(lw, podLogs)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, context.Canceled) {
		l.writeMu.Lock()
		_ = l.sendErrorMessage(fmt.Sprintf("Failed to stream pod logs for %s: %v", pod.Name, err))
		l.writeMu.Unlock()
	}

	l.writeMu.Lock()
	_ = l.sendMessage("close", fmt.Sprintf("{\"status\":\"closed\",\"pod\":\"%s\"}", pod.Name))
	l.writeMu.Unlock()
}

// heartbeat reads client messages, sends periodic server-side keepalive pings,
// and manages the read side of the WebSocket.
//
// This is the ONLY goroutine that reads from the WebSocket.  Writes are
// serialized through writeMu.
//
// Keepalive strategy:
//  1. RFC 6455 Ping control frames via WriteControl (concurrent-safe with
//     WriteJSON in gorilla) — these are invisible to JS but reset all proxy
//     idle timers.
//  2. Application-level data-frame pings {"type":"ping"} — these are visible
//     to the frontend's onmessage handler and serve as a secondary keepalive.
func (l *BatchLogHandler) heartbeat(ctx context.Context) {
	keepaliveTicker := time.NewTicker(20 * time.Second)
	defer keepaliveTicker.Stop()

	// Channel for WebSocket reads (unblocks select on receive)
	type wsRead struct {
		msgType int
		data    []byte
		err     error
	}
	readCh := make(chan wsRead, 1)

	// Spawn a goroutine that blocks on conn.ReadMessage.
	// When the connection closes, ReadMessage returns an error and this
	// goroutine exits.
	go func() {
		for {
			msgType, data, err := l.conn.ReadMessage()
			readCh <- wsRead{msgType: msgType, data: data, err: err}
			if err != nil {
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			klog.V(1).Info("Heartbeat stopping due to context cancellation")
			return
		case <-l.ctx.Done():
			klog.V(1).Info("Heartbeat stopping due to internal context cancellation")
			return

		case <-keepaliveTicker.C:
			// 1. Send an RFC 6455 Ping control frame.
			// WriteControl is safe to call concurrently with WriteJSON.
			deadline := time.Now().Add(10 * time.Second)
			if err := l.conn.WriteControl(websocket.PingMessage, []byte("keepalive"), deadline); err != nil {
				klog.V(2).Infof("RFC 6455 ping failed, cancelling: %v", err)
				l.cancel()
				return
			}

			// 2. Send an application-level data-frame ping.
			l.writeMu.Lock()
			err := l.sendMessage("ping", "")
			l.writeMu.Unlock()
			if err != nil {
				klog.V(2).Infof("Keepalive data-frame ping failed, cancelling: %v", err)
				l.cancel()
				return
			}

		case msg := <-readCh:
			if msg.err != nil {
				if !websocket.IsCloseError(msg.err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					klog.Errorf("WebSocket connection error in heartbeat, cancelling: %v", msg.err)
				}
				l.cancel()
				return
			}
			// Handle text messages (application-level pings from frontend)
			if msg.msgType == websocket.TextMessage {
				if strings.Contains(string(msg.data), "ping") {
					l.writeMu.Lock()
					err := l.sendMessage("pong", "pong")
					l.writeMu.Unlock()
					if err != nil {
						klog.Infof("Failed to send pong, cancelling: %v", err)
						l.cancel()
						return
					}
				}
			}
		}
	}
}

// AddPod adds a new pod to the batch log handler and starts streaming its logs
func (l *BatchLogHandler) AddPod(pod corev1.Pod) {
	key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)

	if _, exists := l.pods[key]; exists {
		return
	}

	podStream := &PodLogStream{
		Pod:  pod,
		Done: make(chan struct{}),
	}
	l.pods[key] = podStream

	// Start streaming for this pod
	go l.startPodLogStream(podStream)

	l.writeMu.Lock()
	_ = l.sendMessage("pod_added", fmt.Sprintf("{\"pod\":\"%s\",\"namespace\":\"%s\"}",
		pod.Name, pod.Namespace))
	l.writeMu.Unlock()
}

// RemovePod removes a pod from the batch log handler and stops streaming its logs
func (l *BatchLogHandler) RemovePod(pod corev1.Pod) {
	key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
	podStream, exists := l.pods[key]
	if !exists {
		return
	}

	if podStream.Cancel != nil {
		podStream.Cancel()
	}

	go func() {
		<-podStream.Done
		l.writeMu.Lock()
		_ = l.sendMessage("pod_removed", fmt.Sprintf("{\"pod\":\"%s\",\"namespace\":\"%s\"}",
			pod.Name, pod.Namespace))
		l.writeMu.Unlock()
	}()

	delete(l.pods, key)
}

func (l *BatchLogHandler) Stop() {
	for _, podStream := range l.pods {
		if podStream.Cancel != nil {
			podStream.Cancel()
		}
	}
	l.cancel()
	l.pods = make(map[string]*PodLogStream)
}

// writerFunc adapts a function to io.Writer so we can create
// small writers inline inside functions and capture local state.
type writerFunc func([]byte) (int, error)

func (wf writerFunc) Write(p []byte) (int, error) {
	return wf(p)
}

type LogsMessage struct {
	Type string `json:"type"` // "log", "error", "connected", "close", "ping", "pong"
	Data string `json:"data"`
}

// sendMessage writes a JSON message to the WebSocket.
// Caller MUST hold l.writeMu (or be the only writer).
func (l *BatchLogHandler) sendMessage(msgType, data string) error {
	msg := LogsMessage{
		Type: msgType,
		Data: data,
	}
	return l.conn.WriteJSON(msg)
}

// sendErrorMessage writes an error message to the WebSocket.
// Caller MUST hold l.writeMu (or be the only writer).
func (l *BatchLogHandler) sendErrorMessage(errMsg string) error {
	return l.sendMessage("error", errMsg)
}

// SendErrorMessage is an exported wrapper for use from handler code BEFORE
// the BatchLogHandler takes ownership of the connection.  It writes directly
// to the connection.
func SendErrorMessage(conn *websocket.Conn, errMsg string) error {
	msg := LogsMessage{
		Type: "error",
		Data: errMsg,
	}
	return conn.WriteJSON(msg)
}
