package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/serializer/yaml"
	yamlutil "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	syaml "sigs.k8s.io/yaml"
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
		info := objectInfo{
			Index:      i + 1,
			Kind:       obj.GetKind(),
			APIVersion: obj.GetAPIVersion(),
			Name:       obj.GetName(),
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
		if info.Name == "" {
			issues = append(issues, "missing metadata.name")
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
		if obj.GetName() == "" {
			result.Status = "failed"
			result.Error = "Missing metadata.name — every resource object must have a name"
			failCount++
			results = append(results, result)
			continue
		}

		// RBAC Check — determine verb based on whether resource already exists
		resource := strings.ToLower(obj.GetKind()) + "s"
		ns := obj.GetNamespace()
		if ns == "" {
			ns = "_all"
		}

		// First check create permission (needed for new resources)
		if !rbac.CanAccess(user, resource, "create", cs.Name, ns) &&
			!rbac.CanAccess(user, resource, "update", cs.Name, ns) {
			result.Status = "failed"
			result.Error = rbac.NoAccess(user.Key(), string(common.VerbCreate), resource, ns, cs.Name)
			failCount++
			results = append(results, result)
			continue
		}

		// Check if resource already exists
		existingObj := &unstructured.Unstructured{}
		existingObj.SetGroupVersionKind(obj.GetObjectKind().GroupVersionKind())
		getErr := cs.K8sClient.Get(ctx, client.ObjectKey{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}, existingObj)

		var opStatus string
		var opErr error

		if apierrors.IsNotFound(getErr) {
			// Resource does not exist — CREATE
			result.Action = "create"
			if req.DryRun {
				opStatus = "created (dry-run)"
			} else {
				opErr = cs.K8sClient.Create(ctx, obj)
				opStatus = "created"
			}
		} else if getErr == nil {
			// Resource exists — UPDATE
			result.Action = "update"
			if !rbac.CanAccess(user, resource, "update", cs.Name, ns) {
				result.Status = "failed"
				result.Error = rbac.NoAccess(user.Key(), string(common.VerbUpdate), resource, ns, cs.Name)
				failCount++
				results = append(results, result)
				continue
			}
			if req.DryRun {
				opStatus = "updated (dry-run)"
			} else {
				obj.SetResourceVersion(existingObj.GetResourceVersion())
				opErr = cs.K8sClient.Update(ctx, obj)
				opStatus = "updated"
			}
		} else {
			opErr = getErr
			opStatus = "failed"
		}

		// Record per-object history and audit
		if !req.DryRun {
			h.logHistory(cs.Name, user.ID, obj, existingObj, opErr)
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
func (h *ResourceApplyHandler) logHistory(clusterName string, userID uint, obj, existing *unstructured.Unstructured, err error) {
	// Marshal the individual object YAML (not the entire multi-doc input)
	objClone := obj.DeepCopy()
	objClone.SetManagedFields(nil)
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

	model.DB.Create(&model.ResourceHistory{
		ClusterName:   clusterName,
		ResourceType:  strings.ToLower(obj.GetKind()) + "s",
		ResourceName:  obj.GetName(),
		Namespace:     obj.GetNamespace(),
		OperationType: "apply",
		ResourceYAML:  string(objYAML),
		PreviousYAML:  string(previousYAML),
		OperatorID:    userID,
		Success:       err == nil,
		ErrorMessage:  errMessage,
	})
}