package handlers

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/serializer/yaml"
	yamlutil "k8s.io/apimachinery/pkg/util/yaml"
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
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Status    string `json:"status"` // "created", "updated", "unchanged", "failed"
	Error     string `json:"error,omitempty"`
}

// ApplyResource identifies and applies multiple resources from a single YAML string
func (h *ResourceApplyHandler) ApplyResource(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)

	var req ApplyResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	decoder := yamlutil.NewYAMLOrJSONDecoder(strings.NewReader(req.YAML), 4096)
	var results []ApplyResult
	ctx := c.Request.Context()

	for {
		var rawObj runtime.RawExtension
		if err := decoder.Decode(&rawObj); err != nil {
			if err == io.EOF {
				break
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse YAML stream: " + err.Error()})
			return
		}

		if len(rawObj.Raw) == 0 {
			continue
		}

		// Decode into unstructured
		decodeUniversal := yaml.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)
		obj := &unstructured.Unstructured{}
		_, _, err := decodeUniversal.Decode(rawObj.Raw, nil, obj)
		if err != nil {
			results = append(results, ApplyResult{Status: "failed", Error: "Decode error: " + err.Error()})
			continue
		}

		// RBAC Check
		resource := strings.ToLower(obj.GetKind()) + "s"
		if !rbac.CanAccess(user, resource, "create", cs.Name, obj.GetNamespace()) {
			results = append(results, ApplyResult{
				Kind: obj.GetKind(), Name: obj.GetName(), Status: "failed",
				Error: rbac.NoAccess(user.Key(), string(common.VerbCreate), resource, obj.GetNamespace(), cs.Name),
			})
			continue
		}

		// Prepare for Apply
		existingObj := &unstructured.Unstructured{}
		existingObj.SetGroupVersionKind(obj.GetObjectKind().GroupVersionKind())
		
		err = cs.K8sClient.Get(ctx, client.ObjectKey{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}, existingObj)

		var opStatus string
		var opErr error

		// Execution Logic
		if apierrors.IsNotFound(err) {
			if req.DryRun {
				opStatus = "created (dry-run)"
			} else {
				opErr = cs.K8sClient.Create(ctx, obj)
				opStatus = "created"
			}
		} else if err == nil {
			if req.DryRun {
				opStatus = "updated (dry-run)"
			} else {
				obj.SetResourceVersion(existingObj.GetResourceVersion())
				opErr = cs.K8sClient.Update(ctx, obj)
				opStatus = "updated"
			}
		} else {
			opErr = err
			opStatus = "failed"
		}

		// Logging & History
		h.logHistory(cs.Name, user.ID, obj, existingObj, req.YAML, opErr)

		res := ApplyResult{
			Kind:      obj.GetKind(),
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
			Status:    opStatus,
		}
		if opErr != nil {
			res.Status = "failed"
			res.Error = opErr.Error()
		}
		results = append(results, res)
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Apply completed",
		"results": results,
		"dryRun":  req.DryRun,
	})
}

func (h *ResourceApplyHandler) logHistory(clusterName string, userID uint, obj, existing *unstructured.Unstructured, rawYaml string, err error) {
	previousYAML := []byte{}
	if existing.GetResourceVersion() != "" {
		existing.SetManagedFields(nil)
		previousYAML, _ = syaml.Marshal(existing)
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
		ResourceYAML:  rawYaml,
		PreviousYAML:  string(previousYAML),
		OperatorID:    userID,
		Success:       err == nil,
		ErrorMessage:  errMessage,
	})
}