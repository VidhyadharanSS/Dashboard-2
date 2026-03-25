package prometheus

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/api"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
	"k8s.io/klog/v2"
)

type Client struct {
	client v1.API
}

type ResourceMetrics struct {
	CPURequest    float64
	CPUTotal      float64
	MemoryRequest float64
	MemoryTotal   float64
}

// UsageDataPoint represents a single time point in usage metrics
type UsageDataPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

// ResourceUsageHistory contains historical usage data for a resource
type ResourceUsageHistory struct {
	CPU        []UsageDataPoint `json:"cpu"`
	Memory     []UsageDataPoint `json:"memory"`
	NetworkIn  []UsageDataPoint `json:"networkIn"`
	NetworkOut []UsageDataPoint `json:"networkOut"`
	DiskRead   []UsageDataPoint `json:"diskRead"`
	DiskWrite  []UsageDataPoint `json:"diskWrite"`
}

// PodMetrics contains metrics for a specific pod
type PodMetrics struct {
	CPU        []UsageDataPoint `json:"cpu"`
	Memory     []UsageDataPoint `json:"memory"`
	NetworkIn  []UsageDataPoint `json:"networkIn"`
	NetworkOut []UsageDataPoint `json:"networkOut"`
	DiskRead   []UsageDataPoint `json:"diskRead"`
	DiskWrite  []UsageDataPoint `json:"diskWrite"`
	Fallback   bool             `json:"fallback"`
}

type PodCurrentMetrics struct {
	PodName   string  `json:"podName"`
	Namespace string  `json:"namespace"`
	CPU       float64 `json:"cpu"`    // CPU cores
	Memory    float64 `json:"memory"` // Memory in MB
}

func NewClientWithRoundTripper(prometheusURL string, rt http.RoundTripper) (*Client, error) {
	if prometheusURL == "" {
		return nil, fmt.Errorf("prometheus URL cannot be empty")
	}
	client, err := api.NewClient(api.Config{
		Address:      prometheusURL,
		RoundTripper: rt,
	})
	if err != nil {
		return nil, fmt.Errorf("error creating prometheus client: %w", err)
	}

	v1api := v1.NewAPI(client)
	return &Client{
		client: v1api,
	}, nil
}

// GetResourceUsageHistory fetches historical usage data for CPU and Memory
func (c *Client) GetResourceUsageHistory(ctx context.Context, instance string, duration string, nodeLabel string) (*ResourceUsageHistory, error) {
	var step time.Duration
	var timeRange time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 1 * time.Minute
	case "1h":
		timeRange = 1 * time.Hour
		step = 2 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 30 * time.Minute
	default:
		return nil, fmt.Errorf("unsupported duration: %s", duration)
	}

	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	cpuConditions := []string{
		`resource="cpu"`,
	}
	memoryConditions := []string{
		`resource="memory"`,
	}
	if instance != "" {
		conditions = append(conditions, fmt.Sprintf(`%s="%s"`, nodeLabel, instance))
		cpuConditions = append(cpuConditions, fmt.Sprintf(`node="%s"`, instance))
		memoryConditions = append(memoryConditions, fmt.Sprintf(`node="%s"`, instance))
	}

	// Query CPU usage percentage - using container CPU usage
	cpuQuery := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{%s}[1m])) / sum(kube_node_status_allocatable{%s}) * 100`, strings.Join(conditions, ","), strings.Join(cpuConditions, ","))
	cpuData, err := c.queryRange(ctx, cpuQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying CPU usage: %w", err)
	}

	// Query Memory usage percentage - using container memory usage
	memoryQuery := fmt.Sprintf(`sum(container_memory_usage_bytes{%s}) / sum(kube_node_status_allocatable{%s}) * 100`, strings.Join(conditions, ","), strings.Join(memoryConditions, ","))
	memoryData, err := c.queryRange(ctx, memoryQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying Memory usage: %w", err)
	}

	conditions = []string{}
	if instance != "" {
		conditions = append(conditions, fmt.Sprintf(`%s="%s"`, nodeLabel, instance))
	}

	// Query Network incoming bytes rate (bytes per second)
	networkInQuery := fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	networkInData, err := c.queryRange(ctx, networkInQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying Network incoming bytes: %w", err)
	}

	// Query Network outgoing bytes rate (bytes per second)
	networkOutQuery := fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	networkOutData, err := c.queryRange(ctx, networkOutQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying Network outgoing bytes: %w", err)
	}

	if len(cpuData) == 0 && len(memoryData) == 0 && len(networkInData) == 0 && len(networkOutData) == 0 {
		return nil, fmt.Errorf("metrics-server or kube-state-metrics may not be available or configured correctly")
	}

	return &ResourceUsageHistory{
		CPU:        cpuData,
		Memory:     memoryData,
		NetworkIn:  networkInData,
		NetworkOut: networkOutData,
	}, nil
}

func (c *Client) queryRange(ctx context.Context, query string, start, end time.Time, step time.Duration) ([]UsageDataPoint, error) {
	r := v1.Range{
		Start: start,
		End:   end,
		Step:  step,
	}

	result, warnings, err := c.client.QueryRange(ctx, query, r)
	if err != nil {
		klog.Error("queryRange", "error", err)
		return nil, err
	}
	if len(warnings) > 0 {
		fmt.Printf("Warnings: %v\n", warnings)
	}

	var dataPoints []UsageDataPoint

	switch result.Type() {
	case model.ValMatrix:
		matrix := result.(model.Matrix)
		if len(matrix) > 0 {
			for _, sample := range matrix[0].Values {
				dataPoints = append(dataPoints, UsageDataPoint{
					Timestamp: sample.Timestamp.Time(),
					Value:     float64(sample.Value),
				})
			}
		}
	default:
		return nil, fmt.Errorf("unexpected result type: %s", result.Type())
	}

	return dataPoints, nil
}

// HealthCheck verifies if Prometheus is accessible
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.client.Config(ctx)
	return err
}

func (c *Client) GetCPUUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	// Build query conditionally based on whether pod name prefix and container are provided
	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetMemoryUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	// Build query conditionally based on whether pod name prefix and container are provided
	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(container_memory_usage_bytes{%s}) / 1024 / 1024`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetNetworkInUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetNetworkOutUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetDiskReadUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_fs_reads_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

func (c *Client) GetDiskWriteUsage(ctx context.Context, namespace, podNamePrefix, container string, timeRange, step time.Duration) ([]UsageDataPoint, error) {
	now := time.Now()
	start := now.Add(-timeRange)

	conditions := []string{
		`container!="POD"`, // Exclude the "POD" container
		`container!=""`,    // Exclude empty containers
	}
	if podNamePrefix != "" {
		conditions = append(conditions, fmt.Sprintf(`pod=~"%s.*"`, podNamePrefix))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	query := fmt.Sprintf(`sum(rate(container_fs_writes_bytes_total{%s}[1m]))`, strings.Join(conditions, ","))
	return c.queryRange(ctx, query, start, now, step)
}

// ─── Namespace Resource Metrics ─────────────────────────────────────────────

type NamespaceMetrics struct {
	Namespace string  `json:"namespace"`
	CPUUsage  float64 `json:"cpuUsage"`  // cores
	MemUsage  float64 `json:"memUsage"`  // bytes
	PodCount  int     `json:"podCount"`
}

// GetNamespaceResourceUsage returns CPU and memory usage broken down by namespace
func (c *Client) GetNamespaceResourceUsage(ctx context.Context) ([]NamespaceMetrics, error) {
	// CPU usage per namespace (cores)
	cpuQuery := `sum by (namespace) (rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[5m]))`
	cpuResult, _, err := c.client.Query(ctx, cpuQuery, time.Now())
	if err != nil {
		return nil, fmt.Errorf("error querying namespace CPU: %w", err)
	}

	// Memory usage per namespace (bytes)
	memQuery := `sum by (namespace) (container_memory_working_set_bytes{container!="POD",container!=""})`
	memResult, _, err := c.client.Query(ctx, memQuery, time.Now())
	if err != nil {
		return nil, fmt.Errorf("error querying namespace memory: %w", err)
	}

	// Pod count per namespace
	podQuery := `count by (namespace) (kube_pod_info)`
	podResult, _, err := c.client.Query(ctx, podQuery, time.Now())
	if err != nil {
		// Non-critical — continue without pod counts
		klog.Warningf("Failed to query pod counts: %v", err)
	}

	nsMap := make(map[string]*NamespaceMetrics)

	if cpuResult.Type() == model.ValVector {
		for _, sample := range cpuResult.(model.Vector) {
			ns := string(sample.Metric["namespace"])
			if ns == "" {
				continue
			}
			if _, ok := nsMap[ns]; !ok {
				nsMap[ns] = &NamespaceMetrics{Namespace: ns}
			}
			nsMap[ns].CPUUsage = float64(sample.Value)
		}
	}

	if memResult.Type() == model.ValVector {
		for _, sample := range memResult.(model.Vector) {
			ns := string(sample.Metric["namespace"])
			if ns == "" {
				continue
			}
			if _, ok := nsMap[ns]; !ok {
				nsMap[ns] = &NamespaceMetrics{Namespace: ns}
			}
			nsMap[ns].MemUsage = float64(sample.Value)
		}
	}

	if podResult != nil && podResult.Type() == model.ValVector {
		for _, sample := range podResult.(model.Vector) {
			ns := string(sample.Metric["namespace"])
			if ns == "" {
				continue
			}
			if _, ok := nsMap[ns]; !ok {
				nsMap[ns] = &NamespaceMetrics{Namespace: ns}
			}
			nsMap[ns].PodCount = int(sample.Value)
		}
	}

	result := make([]NamespaceMetrics, 0, len(nsMap))
	for _, m := range nsMap {
		result = append(result, *m)
	}
	return result, nil
}

// ─── Cluster-Level Metrics ──────────────────────────────────────────────────

type ClusterMetrics struct {
	// Real-time usage (from Prometheus instant queries)
	CPUUsageCores   float64 `json:"cpuUsageCores"`
	CPUTotalCores   float64 `json:"cpuTotalCores"`
	MemUsageBytes   float64 `json:"memUsageBytes"`
	MemTotalBytes   float64 `json:"memTotalBytes"`
	CPUUsagePercent float64 `json:"cpuUsagePercent"`
	MemUsagePercent float64 `json:"memUsagePercent"`
	// Pod counts
	RunningPods int `json:"runningPods"`
	TotalPods   int `json:"totalPods"`
	// Kubernetes component health
	APIServerUp    bool    `json:"apiServerUp"`
	APIServerLatP99 float64 `json:"apiServerLatencyP99Ms"` // ms
	SchedulerUp    bool    `json:"schedulerUp"`
	EtcdUp         bool    `json:"etcdUp"`
	// Container restarts in last hour
	ContainerRestarts1h int `json:"containerRestarts1h"`
	// OOMKill events in last hour
	OOMKills1h int `json:"oomKills1h"`
}

// GetClusterMetrics returns real-time cluster-wide metrics
func (c *Client) GetClusterMetrics(ctx context.Context) (*ClusterMetrics, error) {
	m := &ClusterMetrics{APIServerUp: true, SchedulerUp: true, EtcdUp: true}

	// CPU usage (cores)
	cpuVal, err := c.instantQuery(ctx, `sum(rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[5m]))`)
	if err == nil {
		m.CPUUsageCores = cpuVal
	}

	// CPU total allocatable
	cpuTotal, err := c.instantQuery(ctx, `sum(kube_node_status_allocatable{resource="cpu"})`)
	if err == nil {
		m.CPUTotalCores = cpuTotal
	}

	if m.CPUTotalCores > 0 {
		m.CPUUsagePercent = (m.CPUUsageCores / m.CPUTotalCores) * 100
	}

	// Memory usage (working set bytes)
	memVal, err := c.instantQuery(ctx, `sum(container_memory_working_set_bytes{container!="POD",container!=""})`)
	if err == nil {
		m.MemUsageBytes = memVal
	}

	// Memory total allocatable
	memTotal, err := c.instantQuery(ctx, `sum(kube_node_status_allocatable{resource="memory"})`)
	if err == nil {
		m.MemTotalBytes = memTotal
	}

	if m.MemTotalBytes > 0 {
		m.MemUsagePercent = (m.MemUsageBytes / m.MemTotalBytes) * 100
	}

	// Running pods
	runPods, err := c.instantQuery(ctx, `count(kube_pod_status_phase{phase="Running"})`)
	if err == nil {
		m.RunningPods = int(runPods)
	}

	// Total pods
	totalPods, err := c.instantQuery(ctx, `count(kube_pod_info)`)
	if err == nil {
		m.TotalPods = int(totalPods)
	}

	// API Server latency P99 (ms)
	apiLat, err := c.instantQuery(ctx, `histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{verb!="WATCH"}[5m])) by (le)) * 1000`)
	if err == nil {
		m.APIServerLatP99 = apiLat
	}

	// API Server up
	apiUp, err := c.instantQuery(ctx, `up{job=~"apiserver|kubernetes"}`)
	if err != nil || apiUp == 0 {
		m.APIServerUp = false
	}

	// Scheduler up
	schedUp, err := c.instantQuery(ctx, `up{job=~".*scheduler.*"}`)
	if err != nil || schedUp == 0 {
		m.SchedulerUp = false // May not be exposed, default true
	}

	// Etcd up
	etcdUp, err := c.instantQuery(ctx, `up{job=~".*etcd.*"}`)
	if err != nil || etcdUp == 0 {
		m.EtcdUp = false // May not be exposed
	}

	// Container restarts in last hour
	restarts, err := c.instantQuery(ctx, `sum(increase(kube_pod_container_status_restarts_total[1h]))`)
	if err == nil {
		m.ContainerRestarts1h = int(restarts)
	}

	// OOM kills in last hour
	oomKills, err := c.instantQuery(ctx, `sum(increase(kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}[1h]))`)
	if err == nil {
		m.OOMKills1h = int(oomKills)
	}

	return m, nil
}

// ─── Node Filesystem Metrics ────────────────────────────────────────────────

type NodeFilesystemMetrics struct {
	Node       string  `json:"node"`
	TotalBytes float64 `json:"totalBytes"`
	UsedBytes  float64 `json:"usedBytes"`
	UsedPct    float64 `json:"usedPercent"`
}

// GetNodeFilesystemUsage returns filesystem usage per node
func (c *Client) GetNodeFilesystemUsage(ctx context.Context) ([]NodeFilesystemMetrics, error) {
	totalQuery := `max by (instance) (node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"})`
	usedQuery := `max by (instance) (node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"} - node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"})`

	totalResult, _, err := c.client.Query(ctx, totalQuery, time.Now())
	if err != nil {
		return nil, fmt.Errorf("error querying filesystem total: %w", err)
	}

	usedResult, _, err := c.client.Query(ctx, usedQuery, time.Now())
	if err != nil {
		return nil, fmt.Errorf("error querying filesystem used: %w", err)
	}

	nodeMap := make(map[string]*NodeFilesystemMetrics)

	if totalResult.Type() == model.ValVector {
		for _, sample := range totalResult.(model.Vector) {
			node := string(sample.Metric["instance"])
			if node == "" {
				continue
			}
			nodeMap[node] = &NodeFilesystemMetrics{
				Node:       node,
				TotalBytes: float64(sample.Value),
			}
		}
	}

	if usedResult.Type() == model.ValVector {
		for _, sample := range usedResult.(model.Vector) {
			node := string(sample.Metric["instance"])
			if node == "" {
				continue
			}
			if m, ok := nodeMap[node]; ok {
				m.UsedBytes = float64(sample.Value)
				if m.TotalBytes > 0 {
					m.UsedPct = (m.UsedBytes / m.TotalBytes) * 100
				}
			}
		}
	}

	result := make([]NodeFilesystemMetrics, 0, len(nodeMap))
	for _, m := range nodeMap {
		result = append(result, *m)
	}
	return result, nil
}

// instantQuery runs an instant query and returns the scalar value
func (c *Client) instantQuery(ctx context.Context, query string) (float64, error) {
	result, warnings, err := c.client.Query(ctx, query, time.Now())
	if err != nil {
		return 0, err
	}
	if len(warnings) > 0 {
		klog.V(2).Infof("Prometheus warnings for %q: %v", query, warnings)
	}

	switch result.Type() {
	case model.ValVector:
		vec := result.(model.Vector)
		if len(vec) == 0 {
			// Treat empty result as 0 instead of erroring out so higher-level
			// handlers can still return partial metrics without 500.
			return 0, nil
		}
		return float64(vec[0].Value), nil
	case model.ValScalar:
		scalar := result.(*model.Scalar)
		return float64(scalar.Value), nil
	default:
		return 0, fmt.Errorf("unexpected result type: %s", result.Type())
	}
}

func FillMissingDataPoints(timeRange time.Duration, step time.Duration, existing []UsageDataPoint) []UsageDataPoint {
	if len(existing) == 0 {
		return existing
	}

	startTime := time.Now().Add(-timeRange)
	firstTime := existing[0].Timestamp

	if firstTime.Sub(startTime) <= step {
		return existing
	}

	result := []UsageDataPoint{}
	for t := startTime.Add(step); t.Before(firstTime); t = t.Add(step) {
		result = append(result, UsageDataPoint{
			Timestamp: t,
			Value:     0.0,
		})
	}

	return append(result, existing...)
}

// GetWorkloadMetricsBySelector fetches aggregated metrics for all pods matching a label selector in a namespace.
// This is used for workload-scoped monitoring (deployments, statefulsets, daemonsets, etc.)
func (c *Client) GetWorkloadMetricsBySelector(ctx context.Context, namespace, labelSelector, container string, duration string) (*PodMetrics, error) {
	var step time.Duration
	var timeRange time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 15 * time.Second
	case "1h":
		timeRange = 1 * time.Hour
		step = 1 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 5 * time.Minute
	default:
		return nil, fmt.Errorf("unsupported duration: %s", duration)
	}

	now := time.Now()
	start := now.Add(-timeRange)

	// Build label conditions from Kubernetes label selector
	// Label selector format: "app=nginx,env=prod" → prometheus: app="nginx",env="prod"
	promConditions := buildPromConditions(namespace, labelSelector, container)

	cpuQuery := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{%s}[1m]))`, strings.Join(promConditions, ","))
	cpuData, err := c.queryRange(ctx, cpuQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying workload CPU: %w", err)
	}

	memQuery := fmt.Sprintf(`sum(container_memory_working_set_bytes{%s}) / 1024 / 1024`, strings.Join(promConditions, ","))
	memData, err := c.queryRange(ctx, memQuery, start, now, step)
	if err != nil {
		return nil, fmt.Errorf("error querying workload memory: %w", err)
	}

	netConditions := buildNetConditions(namespace, labelSelector)
	netInQuery := fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{%s}[1m]))`, strings.Join(netConditions, ","))
	netInData, err := c.queryRange(ctx, netInQuery, start, now, step)
	if err != nil {
		netInData = nil
	}

	netOutQuery := fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{%s}[1m]))`, strings.Join(netConditions, ","))
	netOutData, err := c.queryRange(ctx, netOutQuery, start, now, step)
	if err != nil {
		netOutData = nil
	}

	diskReadQuery := fmt.Sprintf(`sum(rate(container_fs_reads_bytes_total{%s}[1m]))`, strings.Join(promConditions, ","))
	diskReadData, err := c.queryRange(ctx, diskReadQuery, start, now, step)
	if err != nil {
		diskReadData = nil
	}

	diskWriteQuery := fmt.Sprintf(`sum(rate(container_fs_writes_bytes_total{%s}[1m]))`, strings.Join(promConditions, ","))
	diskWriteData, err := c.queryRange(ctx, diskWriteQuery, start, now, step)
	if err != nil {
		diskWriteData = nil
	}

	return &PodMetrics{
		CPU:        FillMissingDataPoints(timeRange, step, cpuData),
		Memory:     FillMissingDataPoints(timeRange, step, memData),
		NetworkIn:  FillMissingDataPoints(timeRange, step, netInData),
		NetworkOut: FillMissingDataPoints(timeRange, step, netOutData),
		DiskRead:   FillMissingDataPoints(timeRange, step, diskReadData),
		DiskWrite:  FillMissingDataPoints(timeRange, step, diskWriteData),
		Fallback:   false,
	}, nil
}

// buildPromConditions converts a k8s label selector string to prometheus label conditions
func buildPromConditions(namespace, labelSelector, container string) []string {
	conditions := []string{
		`container!="POD"`,
		`container!=""`,
	}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	if container != "" {
		conditions = append(conditions, fmt.Sprintf(`container="%s"`, container))
	}
	if labelSelector != "" {
		for _, part := range strings.Split(labelSelector, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) == 2 {
				conditions = append(conditions, fmt.Sprintf(`label_%s="%s"`, sanitizeLabelName(kv[0]), kv[1]))
			}
		}
	}
	return conditions
}

// buildNetConditions for network (pod-level, no container filter)
func buildNetConditions(namespace, labelSelector string) []string {
	conditions := []string{}
	if namespace != "" {
		conditions = append(conditions, fmt.Sprintf(`namespace="%s"`, namespace))
	}
	if labelSelector != "" {
		for _, part := range strings.Split(labelSelector, ",") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) == 2 {
				conditions = append(conditions, fmt.Sprintf(`label_%s="%s"`, sanitizeLabelName(kv[0]), kv[1]))
			}
		}
	}
	return conditions
}

// sanitizeLabelName replaces characters that are invalid in Prometheus label names
func sanitizeLabelName(name string) string {
	result := make([]byte, len(name))
	for i := 0; i < len(name); i++ {
		c := name[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			result[i] = c
		} else {
			result[i] = '_'
		}
	}
	return string(result)
}

// GetPodMetrics fetches metrics for a specific pod
func (c *Client) GetPodMetrics(ctx context.Context, namespace, podName, container string, duration string) (*PodMetrics, error) {
	var step time.Duration
	var timeRange time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 15 * time.Second
	case "1h":
		timeRange = 1 * time.Hour
		step = 1 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 5 * time.Minute
	default:
		return nil, fmt.Errorf("unsupported duration: %s", duration)
	}

	cpuData, err := c.GetCPUUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod CPU usage: %w", err)
	}
	// Memory usage query for specific pod
	memoryData, err := c.GetMemoryUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Memory usage: %w", err)
	}

	networkInData, err := c.GetNetworkInUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Network incoming usage: %w", err)
	}

	networkOutData, err := c.GetNetworkOutUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Network outgoing usage: %w", err)
	}

	diskReadData, err := c.GetDiskReadUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Disk read usage: %w", err)
	}

	diskWriteData, err := c.GetDiskWriteUsage(ctx, namespace, podName, container, timeRange, step)
	if err != nil {
		return nil, fmt.Errorf("error querying pod Disk write usage: %w", err)
	}

	return &PodMetrics{
		CPU:        FillMissingDataPoints(timeRange, step, cpuData),
		Memory:     FillMissingDataPoints(timeRange, step, memoryData),
		NetworkIn:  FillMissingDataPoints(timeRange, step, networkInData),
		NetworkOut: FillMissingDataPoints(timeRange, step, networkOutData),
		DiskRead:   FillMissingDataPoints(timeRange, step, diskReadData),
		DiskWrite:  FillMissingDataPoints(timeRange, step, diskWriteData),
		Fallback:   false,
	}, nil
}
