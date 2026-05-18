package resources

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
	"k8s.io/kubectl/pkg/describe"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

type GenericResourceHandler[T client.Object, V client.ObjectList] struct {
	name            string
	isClusterScoped bool
	objectType      reflect.Type
	listType        reflect.Type
	enableSearch    bool
}

func NewGenericResourceHandler[T client.Object, V client.ObjectList](
	name string,
	isClusterScoped bool,
	enableSearch bool,
) *GenericResourceHandler[T, V] {
	var obj T
	var list V

	return &GenericResourceHandler[T, V]{
		name:            name,
		isClusterScoped: isClusterScoped,
		enableSearch:    enableSearch,
		objectType:      reflect.TypeOf(obj).Elem(),
		listType:        reflect.TypeOf(list).Elem(),
	}
}

func (h *GenericResourceHandler[T, V]) ToYAML(obj T) string {
	if reflect.ValueOf(obj).IsNil() {
		return ""
	}
	// Deep copy to prevent side effects when stripping managed fields for logging
	clone := obj.DeepCopyObject().(T)
	clone.SetManagedFields(nil)
	yamlBytes, err := yaml.Marshal(clone)
	if err != nil {
		return ""
	}
	return string(yamlBytes)
}

func (h *GenericResourceHandler[T, V]) getGroupKind() schema.GroupKind {
	objValue := reflect.New(h.objectType).Interface().(T)
	gvks, _, err := kube.GetScheme().ObjectKinds(objValue)
	if err != nil || len(gvks) == 0 {
		return schema.GroupKind{}
	}
	return gvks[0].GroupKind()
}

// recordHistory centralizes both Database History (for UI) and File-based Audit (for logs)
func (h *GenericResourceHandler[T, V]) recordHistory(c *gin.Context, opType string, prev, curr T, success bool, errMsg string, start time.Time) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	duration := time.Since(start)

	// 1. Record to Database History
	history := model.ResourceHistory{
		ClusterName:   cs.Name,
		ResourceType:  h.name,
		ResourceName:  curr.GetName(),
		Namespace:     curr.GetNamespace(),
		OperationType: opType,
		ResourceYAML:  h.ToYAML(curr),
		PreviousYAML:  h.ToYAML(prev),
		Success:       success,
		ErrorMessage:  errMsg,
		SourceIP:      c.ClientIP(),
		OperatorID:    user.ID,
	}
	if err := model.DB.Create(&history).Error; err != nil {
		klog.Errorf("AUDIT_DB_FAIL: Failed to save history for %s/%s: %v", h.name, curr.GetName(), err)
	}

	// 2. Record to Structured Audit Log File
	statusLabel := "SUCCESS"
	if !success {
		statusLabel = "FAILED"
	}
	// Capitalize operation type (e.g. "create" -> "Create") for audit readability.
	titleOp := strings.ToUpper(opType[:1]) + opType[1:]
	logMsg := fmt.Sprintf("[%s] %s resource %s", statusLabel, titleOp, curr.GetName())
	if !success && errMsg != "" {
		logMsg += fmt.Sprintf(" | Error: %s", errMsg)
	}

	severity := logger.AuditInfo
	if !success {
		severity = logger.AuditError
	} else if opType == "delete" {
		severity = logger.AuditWarning
	}

	logger.AuditWithOpts(user.Key(), titleOp, h.name, curr.GetNamespace(), cs.Name, logMsg, logger.AuditOpts{
		Duration: duration,
		Severity: severity,
		SourceIP: c.ClientIP(),
		Name:     curr.GetName(),
		Success:  &success,
	})
}

func (h *GenericResourceHandler[T, V]) IsClusterScoped() bool {
	return h.isClusterScoped
}

func (h *GenericResourceHandler[T, V]) Name() string {
	return h.name
}

func (h *GenericResourceHandler[T, V]) Searchable() bool {
	return h.enableSearch
}

func (h *GenericResourceHandler[T, V]) GetResource(c *gin.Context, namespace, name string) (interface{}, error) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	object := reflect.New(h.objectType).Interface().(T)
	namespacedName := types.NamespacedName{Name: name}
	if !h.isClusterScoped {
		if namespace != "" && namespace != "_all" {
			namespacedName.Namespace = namespace
		}
	}
	if err := cs.K8sClient.Get(c.Request.Context(), namespacedName, object); err != nil {
		return nil, err
	}
	return object, nil
}

func (h *GenericResourceHandler[T, V]) Get(c *gin.Context) {
	object, err := h.GetResource(c, c.Param("namespace"), c.Param("name"))
	if err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	obj, err := meta.Accessor(object)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access object metadata"})
		return
	}
	obj.SetManagedFields(nil)
	anno := obj.GetAnnotations()
	if anno != nil {
		delete(anno, common.KubectlAnnotation)
	}

	c.JSON(http.StatusOK, object)
}

func (h *GenericResourceHandler[T, V]) list(c *gin.Context) (V, error) {
	var zero V
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	objectList := reflect.New(h.listType).Interface().(V)
	ctx := c.Request.Context()

	var listOpts []client.ListOption
	namespace := c.Param("namespace")
	if !h.isClusterScoped {
		if namespace != "" && namespace != "_all" {
			listOpts = append(listOpts, client.InNamespace(namespace))
		}
	}
	if c.Query("limit") != "" {
		limit, err := strconv.ParseInt(c.Query("limit"), 10, 64)
		if err == nil {
			listOpts = append(listOpts, client.Limit(limit))
		}
	}

	if c.Query("continue") != "" {
		listOpts = append(listOpts, client.Continue(c.Query("continue")))
	}

	if c.Query("labelSelector") != "" {
		selector, err := metav1.ParseToLabelSelector(c.Query("labelSelector"))
		if err == nil {
			labelSelectorOption, _ := metav1.LabelSelectorAsSelector(selector)
			listOpts = append(listOpts, client.MatchingLabelsSelector{Selector: labelSelectorOption})
		}
	}

	if c.Query("fieldSelector") != "" {
		fieldSelectorOption, err := fields.ParseSelector(c.Query("fieldSelector"))
		if err == nil {
			listOpts = append(listOpts, client.MatchingFieldsSelector{Selector: fieldSelectorOption})
		}
	}

	if err := cs.K8sClient.List(ctx, objectList, listOpts...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return zero, err
	}

	items, _ := meta.ExtractList(objectList)
	sort.Slice(items, func(i, j int) bool {
		o1, _ := meta.Accessor(items[i])
		o2, _ := meta.Accessor(items[j])
		if o1 == nil || o2 == nil {
			return false
		}
		t1, t2 := o1.GetCreationTimestamp(), o2.GetCreationTimestamp()
		if t1.Equal(&t2) {
			return o1.GetName() < o2.GetName()
		}
		return t1.After(t2.Time)
	})

	user := c.MustGet("user").(model.User)
	isSuperUser := rbac.UserHasRole(user, "cluster-admin")

	filterItems := make([]runtime.Object, 0, len(items))
	for i := range items {
		obj, err := meta.Accessor(items[i])
		if err != nil {
			continue
		}
		obj.SetManagedFields(nil)
		if anno := obj.GetAnnotations(); anno != nil {
			delete(anno, common.KubectlAnnotation)
		}

		if !isSuperUser {
			ns := obj.GetNamespace()
			if h.Name() == "namespaces" {
				if !rbac.CanAccessNamespace(user, cs.Name, obj.GetName()) {
					continue
				}
			} else if namespace == "_all" && ns != "" {
				if !rbac.CanAccessNamespace(user, cs.Name, ns) {
					continue
				}
			}
		}
		filterItems = append(filterItems, items[i])
	}
	_ = meta.SetList(objectList, filterItems)
	return objectList, nil
}

func (h *GenericResourceHandler[T, V]) List(c *gin.Context) {
	objectList, err := h.list(c)
	if err != nil {
		return
	}

	if c.Query("reduce") == "true" {
		items, err := meta.ExtractList(objectList)
		if err == nil {
			reducedItems := make([]runtime.Object, 0, len(items))
			for _, item := range items {
				obj, ok := item.(client.Object)
				if !ok {
					reducedItems = append(reducedItems, item)
					continue
				}
				// For resources that override List() (pods, deployments, statefulsets, nodes),
				// this code path won't be reached — their custom List() handles reduce.
				// For other resources (configmaps, secrets, etc.) we create a slim copy with
				// only metadata. The Annotations and ManagedFields are already stripped above.
				reduced := reflect.New(h.objectType).Interface().(client.Object)
				reduced.SetName(obj.GetName())
				reduced.SetNamespace(obj.GetNamespace())
				reduced.SetUID(obj.GetUID())
				reduced.SetCreationTimestamp(obj.GetCreationTimestamp())
				reduced.SetLabels(obj.GetLabels())

				// ── Preserve status for workload / storage / service types so UI
				// can show ready/replica counts, phases, claim refs, etc. ──
				switch orig := item.(type) {
				case *appsv1.DaemonSet:
					if r, ok := reduced.(*appsv1.DaemonSet); ok {
						r.Spec.Selector = orig.Spec.Selector
						r.Status = orig.Status
					}
				case *corev1.PersistentVolume:
					if r, ok := reduced.(*corev1.PersistentVolume); ok {
						r.Spec = orig.Spec
						r.Status = orig.Status
					}
				case *corev1.PersistentVolumeClaim:
					if r, ok := reduced.(*corev1.PersistentVolumeClaim); ok {
						r.Spec = orig.Spec
						r.Status = orig.Status
					}
				case *batchv1.Job:
					if r, ok := reduced.(*batchv1.Job); ok {
						r.Spec.Selector = orig.Spec.Selector
						r.Status = orig.Status
					}
				case *batchv1.CronJob:
					if r, ok := reduced.(*batchv1.CronJob); ok {
						r.Status = orig.Status
					}
				case *corev1.Service:
					if r, ok := reduced.(*corev1.Service); ok {
						r.Spec.Type = orig.Spec.Type
						r.Spec.ClusterIP = orig.Spec.ClusterIP
						r.Spec.Ports = orig.Spec.Ports
						r.Spec.ExternalIPs = orig.Spec.ExternalIPs
						r.Spec.Selector = orig.Spec.Selector
					}
				case *networkingv1.Ingress:
					if r, ok := reduced.(*networkingv1.Ingress); ok {
						r.Spec = orig.Spec
						r.Status = orig.Status
					}
				case *storagev1.StorageClass:
					if r, ok := reduced.(*storagev1.StorageClass); ok {
						r.Provisioner = orig.Provisioner
						r.ReclaimPolicy = orig.ReclaimPolicy
						r.VolumeBindingMode = orig.VolumeBindingMode
					}
				case *autoscalingv2.HorizontalPodAutoscaler:
					if r, ok := reduced.(*autoscalingv2.HorizontalPodAutoscaler); ok {
						r.Spec = orig.Spec
						r.Status = orig.Status
					}
				}

				reducedItems = append(reducedItems, reduced)
			}
			_ = meta.SetList(objectList, reducedItems)
		}
	}
	c.JSON(http.StatusOK, objectList)
}

func (h *GenericResourceHandler[T, V]) Create(c *gin.Context) {
	resource := reflect.New(h.objectType).Interface().(T)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := c.ShouldBindJSON(resource); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var success bool
	var errMsg string
	var empty T
	start := time.Now()
	defer func() {
		h.recordHistory(c, "create", empty, resource, success, errMsg, start)
	}()

	if err := cs.K8sClient.Create(c.Request.Context(), resource); err != nil {
		success, errMsg = false, err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusCreated, resource)
}

func (h *GenericResourceHandler[T, V]) Update(c *gin.Context) {
	name := c.Param("name")
	resource := reflect.New(h.objectType).Interface().(T)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := c.ShouldBindJSON(resource); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	oldObj := reflect.New(h.objectType).Interface().(T)
	namespacedName := types.NamespacedName{Name: name, Namespace: c.Param("namespace")}
	if h.isClusterScoped {
		namespacedName = types.NamespacedName{Name: name}
	}
	if err := cs.K8sClient.Get(c.Request.Context(), namespacedName, oldObj); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch existing resource: " + err.Error()})
		return
	}

	var success bool
	var errMsg string
	start := time.Now()
	defer func() {
		h.recordHistory(c, "update", oldObj, resource, success, errMsg, start)
	}()

	resource.SetName(name)
	if !h.isClusterScoped {
		resource.SetNamespace(c.Param("namespace"))
	}

	if err := cs.K8sClient.Update(c.Request.Context(), resource); err != nil {
		success, errMsg = false, err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusOK, resource)
}

func (h *GenericResourceHandler[T, V]) Patch(c *gin.Context) {
	name := c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	patchBytes, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read patch data"})
		return
	}

	patchType := types.StrategicMergePatchType
	if c.Query("patchType") == "merge" {
		patchType = types.MergePatchType
	} else if c.Query("patchType") == "json" {
		patchType = types.JSONPatchType
	}

	oldObj := reflect.New(h.objectType).Interface().(T)
	namespacedName := types.NamespacedName{Name: name}
	if !h.isClusterScoped {
		namespacedName.Namespace = c.Param("namespace")
	}

	if err := cs.K8sClient.Get(c.Request.Context(), namespacedName, oldObj); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	prevObj := oldObj.DeepCopyObject().(T)
	var success bool
	var errMsg string
	start := time.Now()
	defer func() {
		h.recordHistory(c, "patch", prevObj, oldObj, success, errMsg, start)
	}()

	patch := client.RawPatch(patchType, patchBytes)
	if err := cs.K8sClient.Patch(c.Request.Context(), oldObj, patch); err != nil {
		success, errMsg = false, err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	success = true
	c.JSON(http.StatusOK, oldObj)
}

func (h *GenericResourceHandler[T, V]) Delete(c *gin.Context) {
	name := c.Param("name")
	resource := reflect.New(h.objectType).Interface().(T)
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	namespacedName := types.NamespacedName{Name: name}
	if !h.isClusterScoped {
		namespacedName.Namespace = c.Param("namespace")
	}

	ctx := c.Request.Context()
	if err := cs.K8sClient.Get(ctx, namespacedName, resource); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Capture state for history/audit before deletion
	prevObj := resource.DeepCopyObject().(T)
	start := time.Now()

	cascadeDelete := c.Query("cascade") != "false"
	forceDelete := c.Query("force") == "true"
	wait := c.Query("wait") != "false"

	deleteOptions := &client.DeleteOptions{}
	propagationPolicy := metav1.DeletePropagationForeground
	if !cascadeDelete {
		propagationPolicy = metav1.DeletePropagationOrphan
	}
	deleteOptions.PropagationPolicy = &propagationPolicy

	if forceDelete {
		gracePeriodSeconds := int64(0)
		deleteOptions.GracePeriodSeconds = &gracePeriodSeconds
	}

	var success bool
	var errMsg string
	defer func() {
		h.recordHistory(c, "delete", prevObj, resource, success, errMsg, start)
	}()

	if err := cs.K8sClient.Delete(ctx, resource, deleteOptions); err != nil {
		success, errMsg = false, err.Error()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if wait {
		timeout := 1 * time.Minute
		if forceDelete {
			timeout = 3 * time.Second
		}
		err := kube.WaitForResourceDeletion(ctx, cs.K8sClient, resource, timeout)
		if err != nil && forceDelete {
			klog.Warningf("Force delete timeout for %s, removing finalizers", resource.GetName())
			patch := client.MergeFrom(resource.DeepCopyObject().(T))
			resource.SetFinalizers([]string{})
			_ = cs.K8sClient.Patch(context.Background(), resource, patch)
		}
	}

	success = true
	c.JSON(http.StatusOK, gin.H{"message": "deleted successfully"})
}

func (h *GenericResourceHandler[T, V]) Search(c *gin.Context, q string, limit int64) ([]common.SearchResult, error) {
	if !h.enableSearch || len(q) < 3 {
		return nil, nil
	}
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	objectList := reflect.New(h.listType).Interface().(V)

	var listOpts []client.ListOption
	if idx := strings.Index(q, ":"); idx > 0 {
		listOpts = append(listOpts, client.MatchingLabels{q[:idx]: q[idx+1:]})
	}

	if err := cs.K8sClient.List(c.Request.Context(), objectList, listOpts...); err != nil {
		return nil, err
	}

	items, _ := meta.ExtractList(objectList)
	results := make([]common.SearchResult, 0, limit)
	for _, item := range items {
		obj := item.(client.Object)
		if !strings.Contains(strings.ToLower(obj.GetName()), strings.ToLower(q)) && !strings.Contains(q, ":") {
			continue
		}
		results = append(results, common.SearchResult{
			ID: string(obj.GetUID()), Name: obj.GetName(), Namespace: obj.GetNamespace(),
			ResourceType: h.name, CreatedAt: obj.GetCreationTimestamp().String(),
		})
		if limit > 0 && int64(len(results)) >= limit {
			break
		}
	}
	return results, nil
}

func (h *GenericResourceHandler[T, V]) registerCustomRoutes(group *gin.RouterGroup) {}

func (h *GenericResourceHandler[T, V]) ListHistory(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "10"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))

	var total int64
	query := model.DB.Model(&model.ResourceHistory{}).Where("cluster_name = ? AND resource_type = ? AND resource_name = ? AND namespace = ?", cs.Name, h.name, c.Param("name"), c.Param("namespace"))
	query.Count(&total)

	history := []model.ResourceHistory{}
	query.Preload("Operator").Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&history)

	c.JSON(http.StatusOK, gin.H{
		"data": history,
		"pagination": gin.H{
			"page": page, "pageSize": pageSize, "total": total,
			"totalPages": int(math.Ceil(float64(total) / float64(pageSize))),
		},
	})
}

func (h *GenericResourceHandler[T, V]) Describe(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	describer, ok := describe.DescriberFor(h.getGroupKind(), cs.K8sClient.Configuration)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no describer found"})
		return
	}
	out, err := describer.Describe(c.Param("namespace"), c.Param("name"), describe.DescriberSettings{ShowEvents: true})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": out})
}
