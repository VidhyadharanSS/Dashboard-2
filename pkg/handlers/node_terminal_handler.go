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
	// Pod creation timeout
	nodeTerminalPodTimeout = 90 * time.Second
)

type NodeTerminalHandler struct {
}

func NewNodeTerminalHandler() *NodeTerminalHandler {
	return &NodeTerminalHandler{}
}

// HandleNodeTerminalWebSocket handles WebSocket connections for node terminal access.
// Security: Requires admin role OR explicit "exec" permission on "nodes" resource.
// Audit: All node terminal sessions are logged with user, node, duration.
func (h *NodeTerminalHandler) HandleNodeTerminalWebSocket(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	nodeName := c.Param("nodeName")
	if nodeName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Node name is required"})
		return
	}

	// Validate node name to prevent path traversal / injection
	if strings.ContainsAny(nodeName, "/\\..") || len(nodeName) > 253 {
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
			log.Printf("Node %s not found", nodeName)
			h.sendErrorMessage(conn, fmt.Sprintf("Node %s not found", nodeName))
			return
		}

		// ─── Session timeout context ───
		ctx, cancel := context.WithTimeout(c.Request.Context(), nodeTerminalMaxDuration)
		defer cancel()

		// ─── Create the privileged node agent pod ───
		nodeAgentName, err := h.createNodeAgent(ctx, cs, nodeName, user.Key())
		if err != nil {
			log.Printf("Failed to create node agent pod: %v", err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to create node agent pod: %v", err))
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

		// ─── Start WebSocket keepalive EARLY ───
		// Must start keepalive BEFORE the pod readiness wait, because the
		// corporate proxy (HTTP_PROXY) or reverse proxy (nginx) will kill
		// the idle WebSocket connection if no data flows during the ~90s
		// pod creation window.
		keepalive := kube.NewWebSocketKeepalive(conn)
		keepalive.Start(ctx)
		defer keepalive.Stop()

		// ─── Wait for pod readiness ───
		if err := h.waitForPodReady(ctx, cs, conn, nodeAgentName); err != nil {
			log.Printf("Failed to wait for pod ready: %v", err)
			h.sendErrorMessage(conn, fmt.Sprintf("Failed to wait for pod ready: %v", err))
			logger.Audit(user.Key(), "node-terminal-error", "nodes", "", cs.Name, fmt.Sprintf("Pod readiness timeout on node %s: %v", nodeName, err))
			return
		}

		session := kube.NewTerminalSession(cs.K8sClient, conn, "kube-system", nodeAgentName, common.NodeTerminalPodName)
		if err := session.Start(ctx, "attach"); err != nil {
			klog.Errorf("Terminal session error: %v", err)
		}
	}).ServeHTTP(c.Writer, c.Request)
}

func (h *NodeTerminalHandler) createNodeAgent(ctx context.Context, cs *cluster.ClientSet, nodeName, username string) (string, error) {
	podName := utils.GenerateNodeAgentName(nodeName)

	// Resource limits for the agent pod to prevent abuse
	cpuLimit := resource.MustParse("200m")
	memLimit := resource.MustParse("256Mi")

	// Define the kite node agent pod spec with security hardening
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: "kube-system",
			Labels: map[string]string{
				"app":                          podName,
				"kite.io/component":            "node-terminal",
				"kite.io/node":                 nodeName,
				"kite.io/created-by":           username,
			},
			Annotations: map[string]string{
				"kite.io/session-start":  time.Now().UTC().Format(time.RFC3339),
				"kite.io/created-by":     username,
				"kite.io/purpose":        "node-terminal-access",
			},
		},
		Spec: corev1.PodSpec{
			NodeName:      nodeName,
			HostNetwork:   true,
			HostPID:       true,
			HostIPC:       true,
			RestartPolicy: corev1.RestartPolicyNever,
			// Auto-delete after 2.5 hours even if cleanup fails
			ActiveDeadlineSeconds: func() *int64 { v := int64(nodeTerminalMaxDuration.Seconds() + 1800); return &v }(),
			Tolerations: []corev1.Toleration{
				{
					Operator: corev1.TolerationOpExists,
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "host",
					VolumeSource: corev1.VolumeSource{
						HostPath: &corev1.HostPathVolumeSource{
							Path: "/",
						},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name:      common.NodeTerminalPodName,
					Image:     common.NodeTerminalImage,
					Stdin:     true,
					StdinOnce: true,
					TTY:       true,
					Command:   []string{"/bin/sh", "-c", "chroot /host || (exec /bin/zsh || exec /bin/bash || exec /bin/sh)"},
					SecurityContext: &corev1.SecurityContext{
						Privileged: &[]bool{true}[0],
					},
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    cpuLimit,
							corev1.ResourceMemory: memLimit,
						},
					},
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "host",
							MountPath: "/host",
						},
					},
				},
			},
		},
	}

	object := &corev1.Pod{}
	namespacedName := types.NamespacedName{Name: podName, Namespace: "kube-system"}
	if err := cs.K8sClient.Get(ctx, namespacedName, object); err == nil {
		if utils.IsPodErrorOrSuccess(object) {
			if err := cs.K8sClient.Delete(ctx, object); err != nil {
				return "", fmt.Errorf("failed to delete existing kite node agent pod: %w", err)
			}
			// Wait briefly for deletion to propagate
			time.Sleep(2 * time.Second)
		} else {
			return podName, nil
		}
	}

	// Create the pod
	err := cs.K8sClient.Create(ctx, pod)
	if err != nil {
		return "", fmt.Errorf("failed to create kite node agent pod: %w", err)
	}

	return podName, nil
}

// waitForPodReady waits for the kite node agent pod to be ready
func (h *NodeTerminalHandler) waitForPodReady(ctx context.Context, cs *cluster.ClientSet, conn *websocket.Conn, podName string) error {
	timeout := time.After(nodeTerminalPodTimeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	h.sendMessage(conn, "info", fmt.Sprintf("Preparing node terminal agent (%s)...", podName))

	var pod *corev1.Pod
	var err error
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			h.sendMessage(conn, "info", "")
			errMsg := utils.GetPodErrorMessage(pod)
			if errMsg == "" {
				errMsg = fmt.Sprintf("Timeout waiting for pod %s to be ready after %s", podName, nodeTerminalPodTimeout)
			}
			h.sendErrorMessage(conn, errMsg)
			return fmt.Errorf("timeout waiting for pod %s to be ready", podName)
		case <-ticker.C:
			pod, err = cs.K8sClient.ClientSet.CoreV1().Pods("kube-system").Get(
				context.TODO(),
				podName,
				metav1.GetOptions{},
			)
			if err != nil {
				continue
			}
			h.sendMessage(conn, "stdout", ".")
			if utils.IsPodReady(pod) {
				h.sendMessage(conn, "info", " Ready! Connecting...\r\n")
				return nil
			}
			// Check for fatal pod errors early
			if pod.Status.Phase == corev1.PodFailed {
				errMsg := utils.GetPodErrorMessage(pod)
				if errMsg == "" {
					errMsg = "Pod failed to start"
				}
				h.sendErrorMessage(conn, errMsg)
				return fmt.Errorf("pod %s failed: %s", podName, errMsg)
			}
		}
	}
}

func (h *NodeTerminalHandler) cleanupNodeAgentPod(cs *cluster.ClientSet, podName string) error {
	gracePeriod := int64(0) // Immediate deletion
	return cs.K8sClient.ClientSet.CoreV1().Pods("kube-system").Delete(
		context.TODO(),
		podName,
		metav1.DeleteOptions{
			GracePeriodSeconds: &gracePeriod,
		},
	)
}

// sendErrorMessage sends an error message through WebSocket
func (h *NodeTerminalHandler) sendErrorMessage(conn *websocket.Conn, message string) {
	msg := map[string]interface{}{
		"type": "error",
		"data": message,
	}
	if err := websocket.JSON.Send(conn, msg); err != nil {
		log.Printf("Failed to send error message: %v", err)
	}
}

// sendMessage sends a typed message through WebSocket
func (h *NodeTerminalHandler) sendMessage(conn *websocket.Conn, msgType, message string) {
	msg := map[string]interface{}{
		"type": msgType,
		"data": message,
	}
	if err := websocket.JSON.Send(conn, msg); err != nil {
		log.Printf("Failed to send message: %v", err)
	}
}
