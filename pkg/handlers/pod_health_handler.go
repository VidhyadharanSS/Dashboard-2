package handlers

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// PodHealthSummary provides namespace-level pod health aggregation
type PodHealthSummary struct {
	Namespace string `json:"namespace"`
	Total     int    `json:"total"`
	Running   int    `json:"running"`
	Pending   int    `json:"pending"`
	Failing   int    `json:"failing"`
	Succeeded int    `json:"succeeded"`
	Unknown   int    `json:"unknown"`
	HealthPct float64 `json:"healthPct"`
}

// TopRestartPod captures the most restarting pods
type TopRestartPod struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	RestartCount   int32  `json:"restartCount"`
	Status         string `json:"status"`
	ContainerCount int    `json:"containerCount"`
	ReadyCount     int    `json:"readyCount"`
}

// PodHealthResponse is the full health response
type PodHealthResponse struct {
	TotalPods        int                 `json:"totalPods"`
	RunningPods      int                 `json:"runningPods"`
	FailingPods      int                 `json:"failingPods"`
	PendingPods      int                 `json:"pendingPods"`
	SucceededPods    int                 `json:"succeededPods"`
	NamespaceHealth  []PodHealthSummary  `json:"namespaceHealth"`
	TopRestarts      []TopRestartPod     `json:"topRestarts"`
	HealthScore      int                 `json:"healthScore"`
}

// GetPodHealthSummary provides a comprehensive pod health view for the dashboard
func GetPodHealthSummary(c *gin.Context) {
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	pods := &corev1.PodList{}
	if err := cs.K8sClient.List(ctx, pods, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	nsMap := make(map[string]*PodHealthSummary)
	var totalRunning, totalFailing, totalPending, totalSucceeded int
	var restartPods []TopRestartPod

	for _, pod := range pods.Items {
		ns := pod.Namespace
		if _, ok := nsMap[ns]; !ok {
			nsMap[ns] = &PodHealthSummary{Namespace: ns}
		}
		summary := nsMap[ns]
		summary.Total++

		// Compute restart count
		var restartCount int32
		var readyCount int
		for _, cs := range pod.Status.ContainerStatuses {
			restartCount += cs.RestartCount
			if cs.Ready {
				readyCount++
			}
		}

		podStatus := getPodPhaseStatus(pod)

		switch podStatus {
		case "Running":
			summary.Running++
			totalRunning++
		case "Pending":
			summary.Pending++
			totalPending++
		case "Failing":
			summary.Failing++
			totalFailing++
		case "Succeeded":
			summary.Succeeded++
			totalSucceeded++
		default:
			summary.Unknown++
		}

		if restartCount > 0 {
			restartPods = append(restartPods, TopRestartPod{
				Name:           pod.Name,
				Namespace:      pod.Namespace,
				RestartCount:   restartCount,
				Status:         podStatus,
				ContainerCount: len(pod.Spec.Containers),
				ReadyCount:     readyCount,
			})
		}
	}

	// Sort restarts descending
	sort.Slice(restartPods, func(i, j int) bool {
		return restartPods[i].RestartCount > restartPods[j].RestartCount
	})
	if len(restartPods) > 10 {
		restartPods = restartPods[:10]
	}

	// Build namespace health list
	nsHealth := make([]PodHealthSummary, 0, len(nsMap))
	for _, s := range nsMap {
		if s.Total > 0 {
			s.HealthPct = float64(s.Running+s.Succeeded) / float64(s.Total) * 100
		}
		nsHealth = append(nsHealth, *s)
	}
	// Sort by failing count desc, then by total desc
	sort.Slice(nsHealth, func(i, j int) bool {
		if nsHealth[i].Failing != nsHealth[j].Failing {
			return nsHealth[i].Failing > nsHealth[j].Failing
		}
		return nsHealth[i].Total > nsHealth[j].Total
	})

	// Calculate cluster health score
	totalPods := len(pods.Items)
	healthScore := 100
	if totalPods > 0 {
		healthyPods := totalRunning + totalSucceeded
		healthScore = int(float64(healthyPods) / float64(totalPods) * 100)
	}

	c.JSON(http.StatusOK, PodHealthResponse{
		TotalPods:       totalPods,
		RunningPods:     totalRunning,
		FailingPods:     totalFailing,
		PendingPods:     totalPending,
		SucceededPods:   totalSucceeded,
		NamespaceHealth: nsHealth,
		TopRestarts:     restartPods,
		HealthScore:     healthScore,
	})
}

func getPodPhaseStatus(pod corev1.Pod) string {
	if pod.Status.Phase == corev1.PodFailed {
		return "Failing"
	}
	if pod.Status.Phase == corev1.PodSucceeded {
		return "Succeeded"
	}
	if pod.Status.Phase == corev1.PodPending {
		return "Pending"
	}

	// Check for crash/error states even in "Running" phase
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil {
			reason := cs.State.Waiting.Reason
			if reason == "CrashLoopBackOff" ||
				reason == "OOMKilled" ||
				reason == "Error" ||
				reason == "ImagePullBackOff" ||
				reason == "ErrImagePull" ||
				strings.HasPrefix(reason, "Err") {
				return "Failing"
			}
		}
	}

	if pod.Status.Phase == corev1.PodRunning {
		return "Running"
	}
	return "Unknown"
}
