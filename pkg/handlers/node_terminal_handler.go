package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/net/websocket"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
)

const (
	// Maximum session duration for node terminals (2 hours)
	nodeTerminalMaxDuration = 2 * time.Hour
	// Pod creation timeout — enough for image pull on slow registries
	nodeTerminalPodTimeout = 120 * time.Second
)

type NodeTerminalHandler struct {
}

func NewNodeTerminalHandler() *NodeTerminalHandler {
	return &NodeTerminalHandler{}
}

// HandleNodeTerminalWebSocket handles WebSocket connections for node terminal access.
//
// How it works:
//  1. A privileged Pod is created on the target node, mounting the host filesystem at /host.
//  2. We wait for the pod to become Running/Ready (up to 120 s).
//  3. We exec into the container with `nsenter` to enter the host's namespaces — this gives
//     a real root shell on the node, equivalent to `ssh root@<node>`.
//  4. The WebSocket is kept alive with 15-second pings (important when behind HTTP proxies).
//  5. The pod is force-deleted when the session ends.
//
// Security: Requires admin role OR explicit "exec" permission on "nodes" resource.
// Audit:    All node terminal sessions are logged with user, node, IP, and duration.
func (h *NodeTerminalHandler) HandleNodeTerminalWebSocket(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	nodeName := c.Param("nodeName")
	if nodeName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Node name is required"})
		return
	}

	// Validate node name to prevent path traversal / injection
	if strings.ContainsAny(nodeName, "/\\") || strings.Contains(nodeName, "..") || len(nodeName) > 253 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid node name"})
		return
	}

	user := c.MustGet("user").(model.User)
	clientIP := c.ClientIP()

	websocket.Handler(func(conn *websocket.Conn) {
		defer func() {
			_ = conn.Close()
		}()

		// ─── Security Gate: Admin or explicit node exec permission ───
		if !rbac.CanAccess(user, "nodes", "exec", cs.Name, "") {
			h.sendErrorMessage(conn, rbac.NoAccess(user.Key(), string(common.VerbExec), "nodes", "", cs.Name))
			klog.Warningf("SECURITY: User %s attempted node terminal access on %s (cluster %s) but was denied", user.Key(), nodeName, cs.Name)
			logger.Audit(user.Key(), "node-terminal-denied", "nodes", "", cs.Name, fmt.Sprintf("Access denied for node %s from IP %s", nodeName, clientIP))
			return
		}

		// ─── Audit: Log session start ───
		sessionStart := time.Now()
		klog.Infof("AUDIT: User %s starting node terminal on %s (cluster %s, IP %s)", user.Key(), nodeName, cs.Name, clientIP)
		logger.Audit(user.Key(), "node-terminal-start", "nodes", "", cs.Name, fmt.Sprintf("Session started on node %s from IP %s", nodeName, clientIP))

		// ─── Verify node exists ───
		node, err := cs.K8sClient.ClientSet.CoreV1().Nodes().Get(context.TODO(), nodeName, metav1.GetOptions{})
		if err != nil {
			log.Printf("Failed to get node %s: %v", nodeName, err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to get node %s: %v", nodeName, err))
			logger.Audit(user.Key(), "node-terminal-error", "nodes", "", cs.Name, fmt.Sprintf("Node %s not found: %v", nodeName, err))
			return
		}
		if node == nil {
			h.sendErrorMessage(conn, fmt.Sprintf("Node %s not found", nodeName))
			return
		}

		// ─── Session timeout context ───
		ctx, cancel := context.WithTimeout(c.Request.Context(), nodeTerminalMaxDuration)
		defer cancel()

		// ─── Start WebSocket keepalive BEFORE any slow operations ───
		// This MUST come before pod creation/wait so that the corporate proxy
		// (HTTP_PROXY: http://192.168.100.100:3128) and any nginx reverse proxy
		// don't close the idle WebSocket during the pod startup window (~30-120s).
		keepalive := kube.NewWebSocketKeepalive(conn)
		keepalive.Start(ctx)
		defer keepalive.Stop()

		// ─── Create the privileged node agent pod ───
		nodeAgentName, err := h.createNodeAgent(ctx, cs, nodeName, user.Key())
		if err != nil {
			log.Printf("Failed to create node agent pod: %v", err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to create node agent: %v", err))
			logger.Audit(user.Key(), "node-terminal-error", "nodes", "", cs.Name, fmt.Sprintf("Failed to create agent on node %s: %v", nodeName, err))
			return
		}

		// ─── Ensure cleanup of the node agent pod ───
		defer func() {
			duration := time.Since(sessionStart)
			klog.Infof("AUDIT: Cleaning up node agent pod %s (user %s, duration %s)", nodeAgentName, user.Key(), duration.Round(time.Second))
			if err := h.cleanupNodeAgentPod(cs, nodeAgentName); err != nil {
				log.Printf("Failed to cleanup node agent pod %s: %v", nodeAgentName, err)
			}
			logger.Audit(user.Key(), "node-terminal-end", "nodes", "", cs.Name, fmt.Sprintf("Session ended on node %s after %s from IP %s", nodeName, duration.Round(time.Second), clientIP))
		}()

		// ─── Wait for pod readiness ───
		if err := h.waitForPodReady(ctx, cs, conn, nodeAgentName); err != nil {
			log.Printf("Failed to wait for pod ready: %v", err)
			h.sendErrorMessage(conn, fmt.Sprintf("Node agent failed to start: %v", err))
			logger.Audit(user.Key(), "node-terminal-error", "nodes", "", cs.Name, fmt.Sprintf("Pod readiness timeout on node %s: %v", nodeName, err))
			return
		}

		// ─── Open a real host shell via nsenter ───
		// nsenter enters the host's mount, UTS, IPC, net, and PID namespaces,
		// then chroots into the host filesystem — identical to SSHing into the node.
		// Fallback chain: nsenter → chroot → plain sh (for minimal images).
		session := kube.NewTerminalSession(cs.K8sClient, conn, "kube-system", nodeAgentName, common.NodeTerminalPodName)
		if err := session.StartWithCommand(ctx, []string{
			"/bin/sh", "-c",
			// Try nsenter first (best: full host namespace + host fs)
			// Fall back to chroot /host (good: host fs but container namespaces)
			// Fall back to plain sh (minimal: just container shell)
			`nsenter --mount=/proc/1/ns/mnt --uts=/proc/1/ns/uts --ipc=/proc/1/ns/ipc --net=/proc/1/ns/net --pid=/proc/1/ns/pid -- /bin/bash 2>/dev/null || ` +
				`nsenter --mount=/proc/1/ns/mnt -- chroot /host /bin/bash 2>/dev/null || ` +
				`chroot /host /bin/bash 2>/dev/null || ` +
				`chroot /host /bin/sh 2>/dev/null || ` +
				`exec /bin/sh`,
		}); err != nil {
			klog.Errorf("Node terminal session error for %s: %v", nodeName, err)
		}
	}).ServeHTTP(c.Writer, c.Request)
}

// createNodeAgent creates a privileged pod on the target node.
// The pod uses nsenter to enter the host's namespaces from within the container,
// giving the user an equivalent experience to SSH root access.
func (h *NodeTerminalHandler) createNodeAgent(ctx context.Context, cs *cluster.ClientSet, nodeName, username string) (string, error) {
	podName := utils.GenerateNodeAgentName(nodeName)

	// Resource limits to prevent agent abuse (node shell does not need much)
	cpuLimit := resource.MustParse("200m")
	memLimit := resource.MustParse("256Mi")

	// Use "pause" image as a minimal base; the real shell comes from nsenter
	// into the host. If busybox or a custom image is configured, use that.
	agentImage := common.NodeTerminalImage
	if agentImage == "" || agentImage == "busybox:latest" {
		// busybox has nsenter and sh, which is all we need
		agentImage = "busybox:latest"
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: "kube-system",
			Labels: map[string]string{
				"app":               podName,
				"kite.io/component": "node-terminal",
				"kite.io/node":      nodeName,
				"kite.io/created-by": username,
			},
			Annotations: map[string]string{
				"kite.io/session-start": time.Now().UTC().Format(time.RFC3339),
				"kite.io/created-by":    username,
				"kite.io/purpose":       "node-terminal-access",
			},
		},
		Spec: corev1.PodSpec{
			NodeName:      nodeName,
			HostNetwork:   true,
			HostPID:       true, // Required for nsenter to access /proc/1/ns/*
			HostIPC:       true,
			RestartPolicy: corev1.RestartPolicyNever,
			// Safety net: auto-terminate after 2.5h even if cleanup goroutine fails
			ActiveDeadlineSeconds: func() *int64 {
				v := int64(nodeTerminalMaxDuration.Seconds() + 1800)
				return &v
			}(),
			// Tolerate all taints so we can reach tainted nodes (e.g. control-plane)
			Tolerations: []corev1.Toleration{
				{Operator: corev1.TolerationOpExists},
			},
			Volumes: []corev1.Volume{
				{
					Name: "host-root",
					VolumeSource: corev1.VolumeSource{
						HostPath: &corev1.HostPathVolumeSource{Path: "/"},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name:  common.NodeTerminalPodName,
					Image: agentImage,
					// Keep stdin open for exec — do NOT use StdinOnce here.
					// StdinOnce=true causes the container to terminate its stdin
					// stream as soon as the first exec closes, which prevents
					// reconnecting to the same pod and can race with keepalive pings.
					Stdin: true,
					TTY:   true,
					// Sleep forever so the pod stays Running and we can exec into it.
					// The actual interactive shell is started via `kubectl exec` (SPDY).
					Command: []string{"/bin/sh", "-c", "trap 'exit 0' TERM; sleep infinity & wait"},
					SecurityContext: &corev1.SecurityContext{
						Privileged: func() *bool { v := true; return &v }(),
					},
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    cpuLimit,
							corev1.ResourceMemory: memLimit,
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{Name: "host-root", MountPath: "/host"},
					},
				},
			},
		},
	}

	// Re-use an existing healthy pod rather than always creating a new one
	object := &corev1.Pod{}
	namespacedName := types.NamespacedName{Name: podName, Namespace: "kube-system"}
	if err := cs.K8sClient.Get(ctx, namespacedName, object); err == nil {
		switch object.Status.Phase {
		case corev1.PodRunning:
			// Pod is already running — reuse it
			return podName, nil
		case corev1.PodFailed, corev1.PodSucceeded:
			// Pod is in a terminal state — delete and recreate
			if err := cs.K8sClient.Delete(ctx, object); err != nil {
				return "", fmt.Errorf("failed to delete stale node agent pod: %w", err)
			}
			time.Sleep(2 * time.Second)
		default:
			// Pending / Unknown — let the wait loop handle it
			return podName, nil
		}
	}

	if err := cs.K8sClient.Create(ctx, pod); err != nil {
		return "", fmt.Errorf("failed to create node agent pod: %w", err)
	}

	return podName, nil
}

// waitForPodReady waits for the kite node agent pod to be Running and Ready.
// Progress dots are streamed to the frontend every 2 seconds so the user
// sees activity and the WebSocket keepalive has real data to carry.
func (h *NodeTerminalHandler) waitForPodReady(ctx context.Context, cs *cluster.ClientSet, conn *websocket.Conn, podName string) error {
	timeout := time.After(nodeTerminalPodTimeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	h.sendMessage(conn, "info", "Preparing node terminal agent...")

	var pod *corev1.Pod
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			errMsg := utils.GetPodErrorMessage(pod)
			if errMsg == "" {
				errMsg = fmt.Sprintf("Timeout waiting for node agent to start after %s", nodeTerminalPodTimeout)
			}
			return fmt.Errorf("%s", errMsg)
		case <-ticker.C:
			var err error
			pod, err = cs.K8sClient.ClientSet.CoreV1().Pods("kube-system").Get(
				context.TODO(), podName, metav1.GetOptions{},
			)
			if err != nil {
				continue
			}
			// Send a dot so the proxy sees traffic and doesn't drop the connection
			h.sendMessage(conn, "stdout", ".")

			if utils.IsPodReady(pod) {
				h.sendMessage(conn, "info", " Ready!\r\n")
				return nil
			}
			if pod.Status.Phase == corev1.PodFailed {
				errMsg := utils.GetPodErrorMessage(pod)
				if errMsg == "" {
					errMsg = "Node agent pod failed to start"
				}
				return fmt.Errorf("%s", errMsg)
			}
		}
	}
}

func (h *NodeTerminalHandler) cleanupNodeAgentPod(cs *cluster.ClientSet, podName string) error {
	gracePeriod := int64(0)
	return cs.K8sClient.ClientSet.CoreV1().Pods("kube-system").Delete(
		context.TODO(),
		podName,
		metav1.DeleteOptions{GracePeriodSeconds: &gracePeriod},
	)
}

func (h *NodeTerminalHandler) sendErrorMessage(conn *websocket.Conn, message string) {
	msg := map[string]any{"type": "error", "data": message}
	if err := websocket.JSON.Send(conn, msg); err != nil {
		log.Printf("Failed to send error message: %v", err)
	}
}

func (h *NodeTerminalHandler) sendMessage(conn *websocket.Conn, msgType, message string) {
	msg := map[string]any{"type": msgType, "data": message}
	if err := websocket.JSON.Send(conn, msg); err != nil {
		log.Printf("Failed to send message: %v", err)
	}
}
