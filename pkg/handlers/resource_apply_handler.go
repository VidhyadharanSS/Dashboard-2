package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/apimachinery/pkg/api/meta"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/runtime/serializer/yaml"
	yamlutil "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/restmapper"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	syaml "sigs.k8s.io/yaml"
)

// restMapperCache caches REST mappers per cluster to avoid repeated Discovery API calls.
type restMapperCacheEntry struct {
	mapper    meta.RESTMapper
	expiresAt time.Time
}

var (
	restMapperCacheMu    sync.Mutex
	restMapperCacheStore = map[string]*restMapperCacheEntry{}
	restMapperCacheTTL   = 5 * time.Minute
)

type ResourceApplyHandler struct{}

func NewResourceApplyHandler() *ResourceApplyHandler {
	return &ResourceApplyHandler{}
}

type ApplyResourceRequest struct {
	YAML   string `json:"yaml" binding:"required"`
	DryRun bool   `json:"dryRun"`
}

type ApplyResult struct {
	Index       int    `json:"index"`
	Kind        string `json:"kind"`
	APIVersion  string `json:"apiVersion"`
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Status      string `json:"status"` // "created", "updated", "unchanged", "failed", "skipped"
	Error       string `json:"error,omitempty"`
	Action      string `json:"action,omitempty"` // "create" or "update" — what was done
}

const applyFieldOwner = "kite-resource-apply"

// ValidateYAML parses a multi-document YAML without applying, returning identified objects
// POST /resources/validate
func (h *ResourceApplyHandler) ValidateYAML(c *gin.Context) {
	var req ApplyResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	objects, parseErr := h.parseYAMLStream(req.YAML)
	if parseErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": parseErr})
		return
	}

	type objectInfo struct {
		Index      int    `json:"index"`
		Kind       string `json:"kind"`
		APIVersion string `json:"apiVersion"`
		Name       string `json:"name"`
		Namespace  string `json:"namespace"`
		Valid      bool   `json:"valid"`
		Error      string `json:"error,omitempty"`
	}

	infos := make([]objectInfo, 0, len(objects))
	for i, obj := range objects {
		// Check for parse errors embedded in placeholder
		if parseErrMsg, ok := obj.GetAnnotations()["_parseError"]; ok {
			infos = append(infos, objectInfo{
				Index: i + 1,
				Valid: false,
				Error: "Parse error: " + parseErrMsg,
			})
			continue
		}

		displayName := obj.GetName()
		if displayName == "" && obj.GetGenerateName() != "" {
			displayName = obj.GetGenerateName() + "*"
		}

		info := objectInfo{
			Index:      i + 1,
			Kind:       obj.GetKind(),
			APIVersion: obj.GetAPIVersion(),
			Name:       displayName,
			Namespace:  obj.GetNamespace(),
			Valid:      true,
		}

		// Validate mandatory fields
		var issues []string
		if info.Kind == "" {
			issues = append(issues, "missing kind")
		}
		if info.APIVersion == "" {
			issues = append(issues, "missing apiVersion")
		}
		if obj.GetName() == "" && obj.GetGenerateName() == "" {
			issues = append(issues, "missing metadata.name or metadata.generateName")
		}
		if len(issues) > 0 {
			info.Valid = false
			info.Error = strings.Join(issues, "; ")
		}

		infos = append(infos, info)
	}

	c.JSON(http.StatusOK, gin.H{
		"objects": infos,
		"count":   len(infos),
	})
}

// parseYAMLStream splits a multi-document YAML into individual unstructured objects.
// Returns the parsed objects and an error string (empty if ok).
func (h *ResourceApplyHandler) parseYAMLStream(yamlStr string) ([]*unstructured.Unstructured, string) {
	decoder := yamlutil.NewYAMLOrJSONDecoder(strings.NewReader(yamlStr), 4096)
	var objects []*unstructured.Unstructured

	for {
		var rawObj runtime.RawExtension
		if err := decoder.Decode(&rawObj); err != nil {
			if err == io.EOF {
				break
			}
			return nil, "Failed to parse YAML stream: " + err.Error()
		}
		if len(rawObj.Raw) == 0 {
			continue
		}

		decodeUniversal := yaml.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)
		obj := &unstructured.Unstructured{}
		_, _, err := decodeUniversal.Decode(rawObj.Raw, nil, obj)
		if err != nil {
			// Still add a placeholder so the index stays correct
			placeholder := &unstructured.Unstructured{}
			placeholder.SetAnnotations(map[string]string{"_parseError": err.Error()})
			objects = append(objects, placeholder)
			continue
		}
		objects = append(objects, obj)
	}

	return objects, ""
}

// ApplyResource identifies and applies multiple resources from a single YAML string.
// Each resource object separated by --- is identified, validated, RBAC-checked, and
// applied individually. Results are returned per-object with index, kind, name, status.
func (h *ResourceApplyHandler) ApplyResource(c *gin.Context) {
	startTime := time.Now()
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)

	var req ApplyResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	objects, parseErr := h.parseYAMLStream(req.YAML)
	if parseErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": parseErr})
		return
	}

	if len(objects) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid resource objects found in YAML"})
		return
	}

	var results []ApplyResult
	ctx := c.Request.Context()
	successCount := 0
	failCount := 0
	mapper, err := buildRESTMapper(cs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build Kubernetes REST mapper: " + err.Error()})
		return
	}

	for idx, obj := range objects {
		result := ApplyResult{
			Index:      idx + 1,
			Kind:       obj.GetKind(),
			APIVersion: obj.GetAPIVersion(),
			Name:       obj.GetName(),
			Namespace:  obj.GetNamespace(),
		}

		// Check for parse errors embedded in placeholder
		if parseErrMsg, ok := obj.GetAnnotations()["_parseError"]; ok {
			result.Status = "failed"
			result.Error = "Decode error: " + parseErrMsg
			failCount++
			results = append(results, result)
			continue
		}

		// Validate mandatory fields
		if obj.GetKind() == "" || obj.GetAPIVersion() == "" {
			result.Status = "failed"
			result.Error = "Missing required fields: kind and apiVersion are mandatory"
			failCount++
			results = append(results, result)
			continue
		}
		if obj.GetName() == "" && obj.GetGenerateName() == "" {
			result.Status = "failed"
			result.Error = "Missing metadata.name or metadata.generateName — every resource object must be identifiable"
			failCount++
			results = append(results, result)
			continue
		}

		// Enforce permitted-field policy for workload kinds (security hardening)
		if fieldErr := validateWorkloadFields(obj); fieldErr != "" {
			result.Status = "failed"
			result.Error = fieldErr
			failCount++
			results = append(results, result)
			continue
		}

		mapping, mappingErr := resolveRESTMapping(mapper, obj)
		if mappingErr != nil {
			result.Status = "failed"
			result.Error = "Failed to resolve resource mapping: " + mappingErr.Error()
			failCount++
			results = append(results, result)
			continue
		}

		resource := mapping.Resource.Resource
		isNamespaced := mapping.Scope.Name() == meta.RESTScopeNameNamespace
		ns := obj.GetNamespace()
		if isNamespaced {
			if ns == "" {
				result.Status = "failed"
				result.Error = fmt.Sprintf("Missing metadata.namespace for namespaced resource %s", obj.GetKind())
				failCount++
				results = append(results, result)
				continue
			}
		} else {
			ns = "_all"
			obj.SetNamespace("")
			result.Namespace = ""
		}

		// Resources with generateName are always created (never updated)
		var existingObj *unstructured.Unstructured
		var getErr error
		var opStatus string
		var opErr error
		var historyAction string

		if obj.GetName() == "" && obj.GetGenerateName() != "" {
			if !rbac.CanAccess(user, resource, "create", cs.Name, ns) {
				result.Status = "failed"
				result.Error = rbac.NoAccess(user.Key(), string(common.VerbCreate), resource, ns, cs.Name)
				failCount++
				results = append(results, result)
				continue
			}
			result.Action = "create"
			historyAction = "create"
			if req.DryRun {
				opErr = cs.K8sClient.Create(ctx, obj, client.DryRunAll)
				opStatus = "created (dry-run)"
			} else {
				opErr = cs.K8sClient.Create(ctx, obj)
				opStatus = "created"
				if opErr == nil {
					result.Name = obj.GetName()
				}
			}
		} else {
			existingObj = &unstructured.Unstructured{}
			existingObj.SetGroupVersionKind(obj.GetObjectKind().GroupVersionKind())
			getErr = cs.K8sClient.Get(ctx, client.ObjectKey{
				Name:      obj.GetName(),
				Namespace: obj.GetNamespace(),
			}, existingObj)

			if apierrors.IsNotFound(getErr) {
				if !rbac.CanAccess(user, resource, "create", cs.Name, ns) {
					result.Status = "failed"
					result.Error = rbac.NoAccess(user.Key(), string(common.VerbCreate), resource, ns, cs.Name)
					failCount++
					results = append(results, result)
					continue
				}
				result.Action = "create"
				historyAction = "create"
				if req.DryRun {
					opErr = cs.K8sClient.Create(ctx, obj, client.DryRunAll)
					opStatus = "created (dry-run)"
				} else {
					opErr = cs.K8sClient.Create(ctx, obj)
					opStatus = "created"
				}
			} else if getErr == nil {
				result.Action = "update"
				historyAction = "update"
				if !rbac.CanAccess(user, resource, "update", cs.Name, ns) {
					result.Status = "failed"
					result.Error = rbac.NoAccess(user.Key(), string(common.VerbUpdate), resource, ns, cs.Name)
					failCount++
					results = append(results, result)
					continue
				}
				patchOpts := []client.PatchOption{
					client.FieldOwner(applyFieldOwner),
					client.ForceOwnership,
				}
				if req.DryRun {
					patchOpts = append(patchOpts, client.DryRunAll)
					opStatus = "updated (dry-run)"
				} else {
					opStatus = "updated"
				}
				opErr = cs.K8sClient.Patch(ctx, obj, client.Apply, patchOpts...)
			} else {
				opErr = getErr
				opStatus = "failed"
			}
		}

		// Record per-object history and audit
		if !req.DryRun {
			if existingObj == nil {
				existingObj = &unstructured.Unstructured{}
			}
			h.logHistory(cs.Name, user.ID, c.ClientIP(), resource, historyAction, obj, existingObj, opErr)
		}

		result.Status = opStatus
		if opErr != nil {
			result.Status = "failed"
			result.Error = opErr.Error()
			failCount++
		} else {
			successCount++
		}
		results = append(results, result)
	}

	// Aggregate audit log entry
	duration := time.Since(startTime)
	summary := fmt.Sprintf("Applied %d resource(s): %d succeeded, %d failed", len(results), successCount, failCount)
	if req.DryRun {
		summary = fmt.Sprintf("Dry-run validated %d resource(s)", len(results))
	}
	logger.Audit(user.Key(), "Apply", "multi-resource", "", cs.Name, summary, duration)

	klog.V(2).Infof("Resource apply by %s on cluster %s: %s (%s)", user.Key(), cs.Name, summary, duration)

	c.JSON(http.StatusOK, gin.H{
		"message":      summary,
		"results":      results,
		"totalObjects": len(results),
		"succeeded":    successCount,
		"failed":       failCount,
		"dryRun":       req.DryRun,
	})
}

// logHistory records per-object database history with individual YAML (not the entire raw input).
func (h *ResourceApplyHandler) logHistory(clusterName string, userID uint, sourceIP, resourceType, action string, obj, existing *unstructured.Unstructured, err error) {
	if model.DB == nil {
		return
	}

	// Marshal the individual object YAML (not the entire multi-doc input)
	objClone := obj.DeepCopy()
	objClone.SetManagedFields(nil)
	// Remove _parseError annotation if it leaked through
	annotations := objClone.GetAnnotations()
	if annotations != nil {
		delete(annotations, "_parseError")
		if len(annotations) == 0 {
			objClone.SetAnnotations(nil)
		} else {
			objClone.SetAnnotations(annotations)
		}
	}
	objYAML, _ := syaml.Marshal(objClone)

	previousYAML := []byte{}
	if existing != nil && existing.GetResourceVersion() != "" {
		existingClone := existing.DeepCopy()
		existingClone.SetManagedFields(nil)
		previousYAML, _ = syaml.Marshal(existingClone)
	}

	errMessage := ""
	if err != nil {
		errMessage = err.Error()
	}

	// Use name or generateName for the record
	resourceName := obj.GetName()
	if resourceName == "" {
		resourceName = obj.GetGenerateName() + "*"
	}

	model.DB.Create(&model.ResourceHistory{
		ClusterName:   clusterName,
		ResourceType:  resourceType,
		ResourceName:  resourceName,
		Namespace:     obj.GetNamespace(),
		OperationType: action,
		ResourceYAML:  string(objYAML),
		PreviousYAML:  string(previousYAML),
		OperatorID:    userID,
		SourceIP:      sourceIP,
		Success:       err == nil,
		ErrorMessage:  errMessage,
	})
}

func buildRESTMapper(cs *cluster.ClientSet) (meta.RESTMapper, error) {
	clusterKey := cs.Name
	now := time.Now()

	restMapperCacheMu.Lock()
	if entry, ok := restMapperCacheStore[clusterKey]; ok && now.Before(entry.expiresAt) {
		restMapperCacheMu.Unlock()
		return entry.mapper, nil
	}
	restMapperCacheMu.Unlock()

	resources, err := restmapper.GetAPIGroupResources(cs.K8sClient.ClientSet.Discovery())
	if err != nil {
		return nil, err
	}
	mapper := restmapper.NewDiscoveryRESTMapper(resources)

	restMapperCacheMu.Lock()
	restMapperCacheStore[clusterKey] = &restMapperCacheEntry{
		mapper:    mapper,
		expiresAt: now.Add(restMapperCacheTTL),
	}
	restMapperCacheMu.Unlock()

	return mapper, nil
}

func resolveRESTMapping(mapper meta.RESTMapper, obj *unstructured.Unstructured) (*meta.RESTMapping, error) {
	gv, err := schema.ParseGroupVersion(obj.GetAPIVersion())
	if err != nil {
		return nil, err
	}
	return mapper.RESTMapping(obj.GroupVersionKind().GroupKind(), gv.Version)
}

// validateWorkloadFields enforces the permitted-field policy for Deployment,
// StatefulSet, and DaemonSet objects submitted via the YAML apply endpoint.
// It returns an empty string when the object is allowed, or a human-readable
// rejection reason when a forbidden field is found.
//
// Permitted fields are listed in SECURITY_AUDIT_REPORT.md §"Permitted YAML Fields".
// Anything not on the allow-list that could influence security posture is rejected.
//
// Forbidden fields enforced by this validator:
//   - metadata.uid / metadata.resourceVersion / metadata.creationTimestamp
//     (server-managed; must not be supplied by clients)
//   - spec.selector                                  (immutable; selector pairing)
//   - spec.template.metadata.labels                  (selector pairing; must remain stable)
//   - spec.template.spec.securityContext             (pod-level securityContext)
//   - spec.template.spec.imagePullSecrets            (use cluster-level pull secrets)
//   - spec.template.spec.volumes[].secret            (secret material exposure)
//   - spec.template.spec.containers[].command / args (must be baked into the image)
//   - spec.template.spec.containers[].securityContext (container-level securityContext)
//   - spec.template.spec.containers[].env[].valueFrom (configmap or secret refs;
//     only literal env[].value is permitted)
//   - spec.template.spec.containers[].envFrom[].secretRef
//   - spec.template.spec.containers[].envFrom[].configMapRef
//   - status                                         (server-managed)
//
// hostPath volumes are PERMITTED.
func validateWorkloadFields(obj *unstructured.Unstructured) string {
	kind := obj.GetKind()
	if kind != "Deployment" && kind != "StatefulSet" && kind != "DaemonSet" {
		return ""
	}

	// --- Top-level metadata: block server-managed fields ---
	if meta, ok := obj.Object["metadata"].(map[string]interface{}); ok {
		for _, f := range []string{"uid", "resourceVersion", "creationTimestamp"} {
			if v, has := meta[f]; has && v != nil && v != "" {
				return fmt.Sprintf("%s: metadata.%s is server-managed and must not be set by clients", kind, f)
			}
		}
	}

	spec := obj.Object["spec"]
	specMap, ok := spec.(map[string]interface{})
	if !ok {
		return ""
	}

	// --- spec.selector: immutable on Deployment/StatefulSet/DaemonSet ---
	if _, has := specMap["selector"]; has {
		return fmt.Sprintf("%s: spec.selector is immutable and must not be included in updates", kind)
	}

	// --- spec.template.metadata.labels: pairs with selector, must remain stable ---
	if tplLabels, _, _ := unstructured.NestedMap(obj.Object, "spec", "template", "metadata", "labels"); len(tplLabels) > 0 {
		return fmt.Sprintf("%s: spec.template.metadata.labels is forbidden (selector-pairing; must remain stable)", kind)
	}

	// --- spec.template.spec checks ---
	templateSpec, _, _ := unstructured.NestedMap(obj.Object, "spec", "template", "spec")

	// Block pod-level securityContext
	if _, has := templateSpec["securityContext"]; has {
		return fmt.Sprintf("%s: spec.template.spec.securityContext is forbidden (security hardening)", kind)
	}

	// Block imagePullSecrets (prevents secret-based credential injection)
	if _, has := templateSpec["imagePullSecrets"]; has {
		return fmt.Sprintf("%s: spec.template.spec.imagePullSecrets is forbidden (use cluster-level pull secrets)", kind)
	}

	// Block volumes that expose Secret material (hostPath is now permitted).
	volumes, _, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "volumes")
	for _, v := range volumes {
		volMap, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		volName, _ := volMap["name"].(string)
		if _, has := volMap["secret"]; has {
			return fmt.Sprintf("%s: volume %q mounts a Secret which is forbidden (security hardening)", kind, volName)
		}
	}

	// --- Per-container checks (apply to both containers and initContainers) ---
	containers, _, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
	initContainers, _, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "initContainers")
	allContainers := append(containers, initContainers...)

	for _, c := range allContainers {
		cMap, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		cName, _ := cMap["name"].(string)

		if _, has := cMap["command"]; has {
			return fmt.Sprintf("%s: container %q sets command which is forbidden (must be baked into the image)", kind, cName)
		}
		if _, has := cMap["args"]; has {
			return fmt.Sprintf("%s: container %q sets args which is forbidden (must be baked into the image)", kind, cName)
		}
		if _, has := cMap["securityContext"]; has {
			return fmt.Sprintf("%s: container %q sets securityContext which is forbidden (security hardening)", kind, cName)
		}

		// env[].valueFrom: block ANY valueFrom (configmap or secret refs).
		// Only literal env[].value is permitted for non-sensitive config.
		if envList, ok := cMap["env"].([]interface{}); ok {
			for _, e := range envList {
				envEntry, ok := e.(map[string]interface{})
				if !ok {
					continue
				}
				envName, _ := envEntry["name"].(string)
				if _, has := envEntry["valueFrom"]; has {
					return fmt.Sprintf("%s: container %q env %q uses valueFrom which is forbidden (only literal env[].value is permitted)", kind, cName, envName)
				}
			}
		}

		// envFrom: block both Secret and ConfigMap refs.
		// Use explicit env[].value entries to declare each variable individually.
		if envFromList, ok := cMap["envFrom"].([]interface{}); ok {
			for _, ef := range envFromList {
				efMap, ok := ef.(map[string]interface{})
				if !ok {
					continue
				}
				if _, has := efMap["secretRef"]; has {
					return fmt.Sprintf("%s: container %q uses envFrom secretRef which is forbidden", kind, cName)
				}
				if _, has := efMap["configMapRef"]; has {
					return fmt.Sprintf("%s: container %q uses envFrom configMapRef which is forbidden (use explicit env[].value entries instead)", kind, cName)
				}
			}
		}
	}

	// --- status is server-managed ---
	if _, has := obj.Object["status"]; has {
		return fmt.Sprintf("%s: status field must not be included in apply requests (server-managed)", kind)
	}

	return ""
}
