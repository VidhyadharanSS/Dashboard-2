package resources

import (
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/klog/v2"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type NodeHandler struct {
	*GenericResourceHandler[*corev1.Node, *corev1.NodeList]
}

func NewNodeHandler() *NodeHandler {
	return &NodeHandler{
		GenericResourceHandler: NewGenericResourceHandler[*corev1.Node, *corev1.NodeList](
			"nodes",
			true, // Nodes are cluster-scoped resources
			true,
		),
	}
}

func (h *NodeHandler) List(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	var nodeMetrics metricsv1.NodeMetricsList

	// Parse label selector
	listOpts := []client.ListOption{}
	if labelSelector := c.Query("labelSelector"); labelSelector != "" {
		labels, err := labels.Parse(labelSelector)
		if err != nil {
			klog.Errorf("Failed to parse label selector %s: %v", labelSelector, err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid label selector: " + err.Error()})
			return
		}
		listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: labels})
	}

	var nodes corev1.NodeList
	if err := cs.K8sClient.List(c.Request.Context(), &nodes, listOpts...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list nodes: " + err.Error()})
		return
	}

	if err := cs.K8sClient.List(c.Request.Context(), &nodeMetrics); err != nil {
		klog.Warningf("Failed to list node metrics: %v", err)
	}

	// Get all pods to calculate resource requests per node
	var pods corev1.PodList
	if err := cs.K8sClient.List(c.Request.Context(), &pods); err != nil {
		klog.Warningf("Failed to list pods for node resource calculation: %v", err)
	}

	// Group pods by node name and calculate resource requests
	nodeResourceRequests := make(map[string]common.MetricsCell)
	for _, pod := range pods.Items {
		if pod.Spec.NodeName == "" {
			continue // Skip pods not scheduled to any node
		}

		// Skip terminated pods (Succeeded or Failed) as they don't consume resources
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}

		nodeName := pod.Spec.NodeName
		if _, exists := nodeResourceRequests[nodeName]; !exists {
			nodeResourceRequests[nodeName] = common.MetricsCell{}
		}

		metrics := nodeResourceRequests[nodeName]
		metrics.Pods++

		// Calculate CPU, memory, and GPU requests for this pod
		for _, container := range pod.Spec.Containers {
			if cpuRequest := container.Resources.Requests.Cpu(); cpuRequest != nil {
				metrics.CPURequest += cpuRequest.MilliValue()
			}
			if memoryRequest := container.Resources.Requests.Memory(); memoryRequest != nil {
				metrics.MemoryRequest += memoryRequest.Value()
			}
			if gpuRequest, ok := container.Resources.Requests["nvidia.com/gpu"]; ok && !gpuRequest.IsZero() {
				val, _ := gpuRequest.AsInt64()
				metrics.GPURequest += val
				klog.Infof("Pod %s container %s requests GPU: %d", pod.Name, container.Name, val)
			}
		}

		nodeResourceRequests[nodeName] = metrics
	}

	nodeMetricsMap := lo.KeyBy(nodeMetrics.Items, func(item metricsv1.NodeMetrics) string {
		return item.Name
	})

	result := &common.NodeListWithMetrics{
		TypeMeta: nodes.TypeMeta,
		ListMeta: nodes.ListMeta,
		Items:    make([]*common.NodeWithMetrics, len(nodes.Items)),
	}
	for i := range nodes.Items {
		node := &nodes.Items[i]
		metricsCell := &common.MetricsCell{}
		metricsCell.CPULimit = node.Status.Allocatable.Cpu().MilliValue()
		metricsCell.MemoryLimit = node.Status.Allocatable.Memory().Value()
		if gpuLimit, ok := node.Status.Allocatable["nvidia.com/gpu"]; ok {
			metricsCell.GPULimit = gpuLimit.Value()
		}

		if nm, ok := nodeMetricsMap[node.Name]; ok {
			if cpuQuantity, ok := nm.Usage["cpu"]; ok {
				metricsCell.CPUUsage = cpuQuantity.MilliValue()
			}
			if memQuantity, ok := nm.Usage["memory"]; ok {
				metricsCell.MemoryUsage = memQuantity.Value()
			}
		}
		if requests, exists := nodeResourceRequests[node.Name]; exists {
			metricsCell.CPURequest = requests.CPURequest
			metricsCell.MemoryRequest = requests.MemoryRequest
			metricsCell.GPURequest = requests.GPURequest
			metricsCell.Pods = requests.Pods
			metricsCell.PodsLimit = node.Status.Allocatable.Pods().Value()
		}
		result.Items[i] = &common.NodeWithMetrics{
			Node:    node,
			Metrics: metricsCell,
		}
	}
	sort.Slice(result.Items, func(i, j int) bool {
		return result.Items[i].Name < result.Items[j].Name
	})
	c.JSON(http.StatusOK, result)
}

func (h *NodeHandler) Watch(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	listOpts := metav1.ListOptions{}
	if labelSelector := c.Query("labelSelector"); labelSelector != "" {
		listOpts.LabelSelector = labelSelector
	}
	if fieldSelector := c.Query("fieldSelector"); fieldSelector != "" {
		listOpts.FieldSelector = fieldSelector
	}

	watchInterface, err := cs.K8sClient.ClientSet.CoreV1().Nodes().Watch(c, listOpts)
	if err != nil {
		_ = writeSSE(c, "error", gin.H{"error": fmt.Sprintf("failed to start node watch: %v", err)})
		return
	}
	defer watchInterface.Stop()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	flusher, _ := c.Writer.(http.Flusher)

	for {
		select {
		case <-c.Request.Context().Done():
			_ = writeSSE(c, "close", gin.H{"message": "connection closed"})
			return
		case <-ticker.C:
			// Periodically send a full list update or ping if needed
			_, _ = fmt.Fprintf(c.Writer, ": ping\n\n")
			flusher.Flush()
		case event, ok := <-watchInterface.ResultChan():
			if !ok {
				_ = writeSSE(c, "close", gin.H{"message": "watch channel closed"})
				return
			}

			node, ok := event.Object.(*corev1.Node)
			if !ok || node == nil {
				continue
			}

			// For nodes, we always want to include metrics if possible
			// Reuse some logic from List if needed, but for watch efficiency we might just send the node
			// and let the client fetch metrics OR attach current metrics if available.
			// Let's attach basic metrics for the heatmap.
			
			obj := &common.NodeWithMetrics{Node: node}
			
			// Attach metrics
			var nodeMetrics metricsv1.NodeMetrics
			if err := cs.K8sClient.Get(c, client.ObjectKey{Name: node.Name}, &nodeMetrics); err == nil {
				metricsCell := &common.MetricsCell{}
				metricsCell.CPULimit = node.Status.Allocatable.Cpu().MilliValue()
				metricsCell.MemoryLimit = node.Status.Allocatable.Memory().Value()
				metricsCell.PodsLimit = node.Status.Allocatable.Pods().Value()
				
				if cpuQuantity, ok := nodeMetrics.Usage["cpu"]; ok {
					metricsCell.CPUUsage = cpuQuantity.MilliValue()
				}
				if memQuantity, ok := nodeMetrics.Usage["memory"]; ok {
					metricsCell.MemoryUsage = memQuantity.Value()
				}
				
				// Optional: get pod counts for this node
				var pods corev1.PodList
				if err := cs.K8sClient.List(c, &pods, client.MatchingFields{"spec.nodeName": node.Name}); err == nil {
					metricsCell.Pods = int64(len(pods.Items))
					// We could also sum requests here, but SSE should be lightweight.
					// For heatmap, Usage % is most important.
				}
				
				obj.Metrics = metricsCell
			}

			switch event.Type {
			case watch.Added:
				_ = writeSSE(c, "added", obj)
			case watch.Modified:
				_ = writeSSE(c, "modified", obj)
			case watch.Deleted:
				_ = writeSSE(c, "deleted", obj)
			}
		}
	}
}

func (h *NodeHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.GET("/_all/watch", h.Watch)
}
