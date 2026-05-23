package handlers

import (
	"fmt"
	"io"
	"net/http"
	gopath "path"
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

		// Enforce kind-level blacklist (security hardening)
		if kindErr := isApplyKindForbidden(obj); kindErr != "" {
			result.Status = "failed"
			result.Error = kindErr
			logger.Audit(user.Key(), "ApplyDenied", strings.ToLower(obj.GetKind()), obj.GetNamespace(), cs.Name,
				fmt.Sprintf("Forbidden kind: %s/%s rejected (%s)", obj.GetKind(), obj.GetName(), kindErr),
				logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP(), Name: obj.GetName()})
			logger.Security(user.Key(), "APPLY_KIND_FORBIDDEN", fmt.Sprintf("kind=%s name=%s ns=%s cluster=%s", obj.GetKind(), obj.GetName(), obj.GetNamespace(), cs.Name))
			failCount++
			results = append(results, result)
			continue
		}

		// Enforce permitted-field policy for workload kinds (security hardening)
		if fieldErr := validateWorkloadFields(obj); fieldErr != "" {
			result.Status = "failed"
			result.Error = fieldErr
			logger.Audit(user.Key(), "ApplyDenied", strings.ToLower(obj.GetKind()), obj.GetNamespace(), cs.Name,
				fmt.Sprintf("Forbidden field in %s/%s: %s", obj.GetKind(), obj.GetName(), fieldErr),
				logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP(), Name: obj.GetName()})
			logger.Security(user.Key(), "APPLY_FIELD_FORBIDDEN", fmt.Sprintf("kind=%s name=%s ns=%s reason=%s", obj.GetKind(), obj.GetName(), obj.GetNamespace(), fieldErr))
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

		// Resources with generateName would always be created — creation is
		// disabled by policy. Resources whose target name does not exist are
		// also rejected: this endpoint is for UPDATING pre-existing resources.
		var existingObj *unstructured.Unstructured
		var getErr error
		var opStatus string
		var opErr error
		var historyAction string

		if obj.GetName() == "" && obj.GetGenerateName() != "" {
			result.Status = "failed"
			result.Action = "create"
			result.Error = fmt.Sprintf("resource creation is disabled via the dashboard (kind=%s used generateName; only updates of pre-existing resources are permitted)", obj.GetKind())
			logger.Audit(user.Key(), "ApplyCreateBlocked", resource, ns, cs.Name,
				fmt.Sprintf("Create blocked (generateName) for %s", obj.GetKind()),
				logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP(), Name: obj.GetGenerateName() + "*"})
			logger.Security(user.Key(), "APPLY_CREATE_BLOCKED", fmt.Sprintf("kind=%s generateName=%s ns=%s cluster=%s", obj.GetKind(), obj.GetGenerateName(), ns, cs.Name))
			failCount++
			results = append(results, result)
			continue
		}

		existingObj = &unstructured.Unstructured{}
		existingObj.SetGroupVersionKind(obj.GetObjectKind().GroupVersionKind())
		getErr = cs.K8sClient.Get(ctx, client.ObjectKey{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}, existingObj)

		if apierrors.IsNotFound(getErr) {
			result.Status = "failed"
			result.Action = "create"
			result.Error = fmt.Sprintf("resource creation is disabled via the dashboard (%s/%s does not exist; only updates of pre-existing resources are permitted)", obj.GetKind(), obj.GetName())
			logger.Audit(user.Key(), "ApplyCreateBlocked", resource, ns, cs.Name,
				fmt.Sprintf("Create blocked for non-existent %s/%s", obj.GetKind(), obj.GetName()),
				logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP(), Name: obj.GetName()})
			logger.Security(user.Key(), "APPLY_CREATE_BLOCKED", fmt.Sprintf("kind=%s name=%s ns=%s cluster=%s", obj.GetKind(), obj.GetName(), ns, cs.Name))
			failCount++
			results = append(results, result)
			continue
		} else if getErr == nil {
			result.Action = "update"
			historyAction = "update"
			if !rbac.CanAccess(user, resource, "update", cs.Name, ns) {
				result.Status = "failed"
				result.Error = rbac.NoAccess(user.Key(), string(common.VerbUpdate), resource, ns, cs.Name)
				logger.Audit(user.Key(), "ApplyDenied", resource, ns, cs.Name,
					fmt.Sprintf("RBAC denied update on %s/%s", obj.GetKind(), obj.GetName()),
					logger.AuditOpts{Severity: logger.AuditWarning, SourceIP: c.ClientIP(), Name: obj.GetName()})
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
			logger.Audit(user.Key(), "ApplyFailed", resource, ns, cs.Name,
				fmt.Sprintf("%s/%s %s failed: %s", obj.GetKind(), obj.GetName(), historyAction, opErr.Error()),
				logger.AuditOpts{Severity: logger.AuditError, SourceIP: c.ClientIP(), Name: obj.GetName()})
		} else {
			successCount++
			logger.Audit(user.Key(), "Apply", resource, ns, cs.Name,
				fmt.Sprintf("%s %s/%s (%s)", historyAction, obj.GetKind(), obj.GetName(), opStatus),
				logger.AuditOpts{Severity: logger.AuditInfo, SourceIP: c.ClientIP(), Name: obj.GetName()})
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

// isApplyKindForbidden returns a non-empty reason if obj's Kubernetes kind
// must not be applied via the dashboard regardless of RBAC. Used as the
// outermost guard in ApplyResource() to prevent secret material from being
// written through the YAML editor.
//
// The check is intentionally simple and string-based on Kind so that even
// unknown / future API versions of the same kind are blocked.
func isApplyKindForbidden(obj *unstructured.Unstructured) string {
	switch obj.GetKind() {
	case "Secret":
		return "Secret resources cannot be applied via the dashboard (security hardening: secret material must never traverse the dashboard)"
	}
	return ""
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
//   - spec.template.spec.containers[].volumeMounts[].subPath / subPathExpr
//     (must not be settable; would let a user surface a different file from
//     a permitted volume into a sensitive container path)
//   - spec.template.spec.containers[].volumeMounts[].mountPropagation
//     (Bidirectional / HostToContainer must not be selectable via Apply)
//   - spec.template.spec.containers[].volumeMounts[].mountPath under any
//     sensitive container path (see sensitiveMountPathPrefixes below)
//   - status                                         (server-managed)
//
// hostPath volumes are PERMITTED. volumeMounts[].readOnly may be set to true
// but cannot be flipped from true to false via this validator alone (the
// editor-side diff is the second guard for that case).
func validateWorkloadFields(obj *unstructured.Unstructured) string {
	kind := obj.GetKind()
	if kind != "Deployment" && kind != "StatefulSet" && kind != "DaemonSet" {
		return ""
	}

	// --- Top-level metadata: block server-managed fields ---
	if metaMap, ok := obj.Object["metadata"].(map[string]interface{}); ok {
		for _, f := range []string{"uid", "resourceVersion", "creationTimestamp"} {
			if v, has := metaMap[f]; has && v != nil && v != "" {
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

		// volumeMounts[]: lock down the security-sensitive sub-fields.
		if mountList, ok := cMap["volumeMounts"].([]interface{}); ok {
			for _, vm := range mountList {
				vmMap, ok := vm.(map[string]interface{})
				if !ok {
					continue
				}
				vmName, _ := vmMap["name"].(string)
				if _, has := vmMap["subPath"]; has {
					return fmt.Sprintf("%s: container %q volumeMount %q sets subPath which is forbidden (re-binding a sub-file into the container is not allowed via Apply)", kind, cName, vmName)
				}
				if _, has := vmMap["subPathExpr"]; has {
					return fmt.Sprintf("%s: container %q volumeMount %q sets subPathExpr which is forbidden", kind, cName, vmName)
				}
				if _, has := vmMap["mountPropagation"]; has {
					return fmt.Sprintf("%s: container %q volumeMount %q sets mountPropagation which is forbidden (Bidirectional/HostToContainer must not be selectable via Apply)", kind, cName, vmName)
				}
				if mp, _ := vmMap["mountPath"].(string); mp != "" {
					if reason := checkSensitiveMountPath(mp); reason != "" {
						return fmt.Sprintf("%s: container %q volumeMount %q mountPath %q is forbidden (%s)", kind, cName, vmName, mp, reason)
					}
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

// sensitiveMountPathPrefixes lists container paths that must not be a
// volumeMount target. A volumeMount under any of these paths could overlay
// system binaries, configuration, or runtime sockets and shadow them with
// content controlled by the requester.
//
// Allowed application roots (e.g. /home/sas/..., /home/zoho/..., /dev/shm,
// /usr/tmp/...) are permitted; only the explicitly sensitive prefixes below
// are rejected.
var sensitiveMountPathPrefixes = []string{
	"/etc",
	"/bin",
	"/sbin",
	"/usr/bin",
	"/usr/sbin",
	"/usr/local/bin",
	"/usr/local/sbin",
	"/lib",
	"/lib64",
	"/usr/lib",
	"/usr/lib64",
	"/boot",
	"/root",
	"/proc",
	"/sys",
	"/var/run",
	"/var/lib/kubelet",
	"/var/lib/docker",
	"/var/lib/containerd",
}

// checkSensitiveMountPath returns a non-empty reason if mp falls under any
// sensitive container path. It treats "/dev" as forbidden except for the
// explicit "/dev/shm" carve-out (legitimately used by application workloads).
//
// The input path is canonicalised with path.Clean before matching so that
// trivial bypasses such as "//etc/passwd", "/etc/./passwd", "/etc/foo/.."
// and trailing-slash variants are all caught.
func checkSensitiveMountPath(mp string) string {
	if mp == "" {
		return ""
	}
	// Only absolute, POSIX-style paths make sense for a container mountPath.
	// Reject any relative or empty path outright — kubelet would reject too,
	// but the validator must not silently accept odd input.
	if !strings.HasPrefix(mp, "/") {
		return "mountPath must be an absolute path"
	}
	clean := gopath.Clean(mp)
	if clean == "/" {
		return "mountPath \"/\" overlays the container root filesystem"
	}
	// /dev with a /dev/shm carve-out
	if clean == "/dev" || (strings.HasPrefix(clean, "/dev/") && clean != "/dev/shm" && !strings.HasPrefix(clean, "/dev/shm/")) {
		return "mountPath under /dev is restricted; only /dev/shm is permitted"
	}
	for _, p := range sensitiveMountPathPrefixes {
		if clean == p || strings.HasPrefix(clean, p+"/") {
			return fmt.Sprintf("mountPath under %s is a sensitive container path", p)
		}
	}
	return ""
}
