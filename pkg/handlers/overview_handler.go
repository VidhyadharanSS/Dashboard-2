package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// WorkloadCounts summarises each workload type's total and ready counts.
type WorkloadCounts struct {
	TotalDeployments      int `json:"totalDeployments"`
	ReadyDeployments      int `json:"readyDeployments"`
	TotalStatefulSets     int `json:"totalStatefulSets"`
	ReadyStatefulSets     int `json:"readyStatefulSets"`
	TotalDaemonSets       int `json:"totalDaemonSets"`
	ReadyDaemonSets       int `json:"readyDaemonSets"`
	TotalJobs             int `json:"totalJobs"`
	CompletedJobs         int `json:"completedJobs"`
	TotalCronJobs         int `json:"totalCronJobs"`
}

type OverviewData struct {
	TotalNodes      int                   `json:"totalNodes"`
	ReadyNodes      int                   `json:"readyNodes"`
	TotalPods       int                   `json:"totalPods"`
	RunningPods     int                   `json:"runningPods"`
	FailingPods     int                   `json:"failingPods"`
	PendingPods     int                   `json:"pendingPods"`
	SucceededPods   int                   `json:"succeededPods"`
	TotalNamespaces int                   `json:"totalNamespaces"`
	TotalServices   int                   `json:"totalServices"`
	PromEnabled     bool                  `json:"prometheusEnabled"`
	Resource        common.ResourceMetric `json:"resource"`
	Workloads       WorkloadCounts        `json:"workloads"`
}

// isPodFailing returns true when a pod is in a known failure / crash state.
func isPodFailing(pod v1.Pod) bool {
	if pod.Status.Phase == v1.PodFailed {
		return true
	}
	// Check container statuses for crash/error conditions
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil {
			reason := cs.State.Waiting.Reason
			if reason == "CrashLoopBackOff" ||
				reason == "OOMKilled" ||
				reason == "Error" ||
				reason == "ImagePullBackOff" ||
				reason == "ErrImagePull" ||
				strings.HasPrefix(reason, "Err") {
				return true
			}
		}
	}
	return false
}

func GetOverview(c *gin.Context) {
	ctx := c.Request.Context()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if len(user.Roles) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
	}

	// Get nodes
	nodes := &v1.NodeList{}
	if err := cs.K8sClient.List(ctx, nodes, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	readyNodes := 0
	var cpuAllocatable, memAllocatable resource.Quantity
	var cpuRequested, memRequested resource.Quantity
	var cpuLimited, memLimited resource.Quantity
	for _, node := range nodes.Items {
		cpuAllocatable.Add(*node.Status.Allocatable.Cpu())
		memAllocatable.Add(*node.Status.Allocatable.Memory())
		for _, condition := range node.Status.Conditions {
			if condition.Type == v1.NodeReady && condition.Status == v1.ConditionTrue {
				readyNodes++
				break
			}
		}
	}

	// Get pods
	pods := &v1.PodList{}
	if err := cs.K8sClient.List(ctx, pods, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	runningPods, failingPods, pendingPods, succeededPods := 0, 0, 0, 0
	for _, pod := range pods.Items {
		for _, container := range pod.Spec.Containers {
			if container.Resources.Requests != nil {
				cpuRequested.Add(*container.Resources.Requests.Cpu())
				memRequested.Add(*container.Resources.Requests.Memory())
			}
			if container.Resources.Limits != nil {
				if cpuLimit := container.Resources.Limits.Cpu(); cpuLimit != nil {
					cpuLimited.Add(*cpuLimit)
				}
				if memLimit := container.Resources.Limits.Memory(); memLimit != nil {
					memLimited.Add(*memLimit)
				}
			}
		}
		switch pod.Status.Phase {
		case v1.PodRunning:
			if isPodFailing(pod) {
				failingPods++
			} else {
				runningPods++
			}
		case v1.PodPending:
			pendingPods++
		case v1.PodSucceeded:
			succeededPods++
		case v1.PodFailed:
			failingPods++
		}
	}

	// Get namespaces
	namespaces := &v1.NamespaceList{}
	if err := cs.K8sClient.List(ctx, namespaces, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get services
	services := &v1.ServiceList{}
	if err := cs.K8sClient.List(ctx, services, &client.ListOptions{}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// ── Workload counts ──────────────────────────────────────────────────────
	var wc WorkloadCounts

	deployments := &appsv1.DeploymentList{}
	if err := cs.K8sClient.List(ctx, deployments, &client.ListOptions{}); err == nil {
		wc.TotalDeployments = len(deployments.Items)
		for _, d := range deployments.Items {
			if d.Status.ReadyReplicas == d.Status.Replicas && d.Status.Replicas > 0 {
				wc.ReadyDeployments++
			}
		}
	}

	statefulSets := &appsv1.StatefulSetList{}
	if err := cs.K8sClient.List(ctx, statefulSets, &client.ListOptions{}); err == nil {
		wc.TotalStatefulSets = len(statefulSets.Items)
		for _, ss := range statefulSets.Items {
			if ss.Status.ReadyReplicas == ss.Status.Replicas && ss.Status.Replicas > 0 {
				wc.ReadyStatefulSets++
			}
		}
	}

	daemonSets := &appsv1.DaemonSetList{}
	if err := cs.K8sClient.List(ctx, daemonSets, &client.ListOptions{}); err == nil {
		wc.TotalDaemonSets = len(daemonSets.Items)
		for _, ds := range daemonSets.Items {
			if ds.Status.NumberReady == ds.Status.DesiredNumberScheduled {
				wc.ReadyDaemonSets++
			}
		}
	}

	jobs := &batchv1.JobList{}
	if err := cs.K8sClient.List(ctx, jobs, &client.ListOptions{}); err == nil {
		wc.TotalJobs = len(jobs.Items)
		for _, j := range jobs.Items {
			if j.Status.CompletionTime != nil {
				wc.CompletedJobs++
			}
		}
	}

	cronJobs := &batchv1.CronJobList{}
	if err := cs.K8sClient.List(ctx, cronJobs, &client.ListOptions{}); err == nil {
		wc.TotalCronJobs = len(cronJobs.Items)
	}

	overview := OverviewData{
		TotalNodes:      len(nodes.Items),
		ReadyNodes:      readyNodes,
		TotalPods:       len(pods.Items),
		RunningPods:     runningPods,
		FailingPods:     failingPods,
		PendingPods:     pendingPods,
		SucceededPods:   succeededPods,
		TotalNamespaces: len(namespaces.Items),
		TotalServices:   len(services.Items),
		PromEnabled:     cs.PromClient != nil,
		Resource: common.ResourceMetric{
			CPU: common.Resource{
				Allocatable: cpuAllocatable.MilliValue(),
				Requested:   cpuRequested.MilliValue(),
				Limited:     cpuLimited.MilliValue(),
			},
			Mem: common.Resource{
				Allocatable: memAllocatable.MilliValue(),
				Requested:   memRequested.MilliValue(),
				Limited:     memLimited.MilliValue(),
			},
		},
		Workloads: wc,
	}

	c.JSON(http.StatusOK, overview)
}

// var (
// 	initialized bool
// )

func InitCheck(c *gin.Context) {
	// if initialized {
	// 	c.JSON(http.StatusOK, gin.H{"initialized": true})
	// 	return
	// }
	step := 0
	uc, _ := model.CountUsers()
	if uc == 0 && !common.AnonymousUserEnabled {
		c.SetCookie("auth_token", "", -1, "/", "", false, true)
		c.JSON(http.StatusOK, gin.H{"initialized": false, "step": step})
	}
	if uc > 0 || common.AnonymousUserEnabled {
		step++
	}
	cc, _ := model.CountClusters()
	if cc > 0 {
		step++
	}
	initialized := step == 2
	c.JSON(http.StatusOK, gin.H{"initialized": initialized, "step": step})
}
