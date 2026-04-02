package handlers

import (
	"context"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type LogsHandler struct {
}

func NewLogsHandler() *LogsHandler {
	return &LogsHandler{}
}

// HandleLogsWebSocket handles WebSocket connections for log streaming
func (h *LogsHandler) HandleLogsWebSocket(c *gin.Context) {
	// Upgrade HTTP → WebSocket using gorilla/websocket
	ws, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		klog.Errorf("WebSocket upgrade failed for logs: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	namespace := c.Param("namespace")
	podName := c.Param("podName")
	if namespace == "" || podName == "" {
		_ = kube.SendErrorMessage(ws, "namespace and podName are required")
		_ = ws.Close()
		return
	}

	if !rbac.CanAccess(user, "pods", "log", cs.Name, namespace) {
		_ = kube.SendErrorMessage(ws, rbac.NoAccess(user.Key(), string(common.VerbLog), "pods", namespace, cs.Name))
		_ = ws.Close()
		return
	}

	container := c.Query("container")
	tailLines := c.DefaultQuery("tailLines", "100")
	timestamps := c.DefaultQuery("timestamps", "true")
	previous := c.DefaultQuery("previous", "false")
	sinceSeconds := c.Query("sinceSeconds")

	tail, err := strconv.ParseInt(tailLines, 10, 64)
	if err != nil {
		_ = kube.SendErrorMessage(ws, "invalid tailLines parameter")
		_ = ws.Close()
		return
	}
	timestampsBool := timestamps == "true"
	previousBool := previous == "true"
	tailPtr := &tail
	if *tailPtr == -1 {
		tailPtr = nil
	}

	// Build log options
	logOptions := &corev1.PodLogOptions{
		Container:  container,
		Follow:     true,
		Timestamps: timestampsBool,
		TailLines:  tailPtr,
		Previous:   previousBool,
	}

	if sinceSeconds != "" {
		since, err := strconv.ParseInt(sinceSeconds, 10, 64)
		if err != nil {
			_ = kube.SendErrorMessage(ws, "invalid sinceSeconds parameter")
			_ = ws.Close()
			return
		}
		logOptions.SinceSeconds = &since
	}

	labelSelector := c.Query("labelSelector")
	bl := kube.NewBatchLogHandler(ws, cs.K8sClient, logOptions)

	if podName == "_all" && labelSelector != "" {
		selector, err := metav1.ParseToLabelSelector(labelSelector)
		if err != nil {
			_ = kube.SendErrorMessage(ws, "invalid labelSelector parameter: "+err.Error())
			_ = ws.Close()
			return
		}
		labelSelectorOption, err := metav1.LabelSelectorAsSelector(selector)
		if err != nil {
			_ = kube.SendErrorMessage(ws, "failed to convert labelSelector: "+err.Error())
			_ = ws.Close()
			return
		}

		podList := &corev1.PodList{}
		var listOpts []client.ListOption
		listOpts = append(listOpts, client.InNamespace(namespace))
		listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: labelSelectorOption})
		if err := cs.K8sClient.List(ctx, podList, listOpts...); err != nil {
			_ = kube.SendErrorMessage(ws, "failed to list pods: "+err.Error())
			_ = ws.Close()
			return
		}
		for _, pod := range podList.Items {
			if pod.Status.Phase == corev1.PodRunning {
				bl.AddPod(pod)
			}
		}

		go h.watchPods(ctx, cs, namespace, labelSelectorOption, bl)
	} else {
		bl.AddPod(corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      podName,
				Namespace: namespace,
			},
		})
	}

	// Keepalive is handled inside BatchLogHandler.heartbeat() which sends:
	//   1. RFC 6455 Ping control frames (transparent to JS, resets proxy timers)
	//   2. Application-level {"type":"ping"} data frames (visible to frontend)
	// No separate WebSocketKeepalive is needed.
	bl.StreamLogs(ctx)
}

func (h *LogsHandler) watchPods(ctx context.Context, cs *cluster.ClientSet, namespace string, labelSelector labels.Selector, bl *kube.BatchLogHandler) {
	listOptions := metav1.ListOptions{
		LabelSelector: labelSelector.String(),
	}

	watchInterface, err := cs.K8sClient.ClientSet.CoreV1().Pods(namespace).Watch(ctx, listOptions)
	if err != nil {
		return
	}
	defer watchInterface.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watchInterface.ResultChan():
			if !ok {
				return
			}

			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}

			klog.Infof("Pod %s in namespace %s is %s, event Type: %s", pod.Name, pod.Namespace, pod.Status.Phase, event.Type)

			switch event.Type {
			case watch.Added, watch.Modified:
				if pod.Status.Phase == corev1.PodRunning {
					bl.AddPod(*pod)
				} else {
					bl.RemovePod(*pod)
				}
			case watch.Deleted:
				bl.RemovePod(*pod)
			}
		}
	}
}


