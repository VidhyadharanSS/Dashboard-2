package resources

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
)

type DeploymentHandler struct {
	*GenericResourceHandler[*appsv1.Deployment, *appsv1.DeploymentList]
}

func NewDeploymentHandler() *DeploymentHandler {
	return &DeploymentHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.Deployment, *appsv1.DeploymentList](
			"deployments",
			false, // Deployments are namespaced resources
			true,
		),
	}
}

func (h *DeploymentHandler) Restart(c *gin.Context, namespace, name string) error {
	startTime := time.Now()
	var deployment appsv1.Deployment
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		return err
	}

	if deployment.Spec.Template.Annotations == nil {
		deployment.Spec.Template.Annotations = make(map[string]string)
	}

	// Trigger rolling update by updating the pod template annotation
	deployment.Spec.Template.Annotations["kite.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)

	err := cs.K8sClient.Update(c.Request.Context(), &deployment)
	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	h.recordHistory(c, "restart", &deployment, &deployment, success, errMsg, startTime)

	if success {
		user := c.MustGet("user").(model.User)
		logger.Audit(user.Key(), "Restart", "deployments", namespace, cs.Name, fmt.Sprintf("Restarted deployment %s", name), time.Since(startTime))
	}

	return err
}

// ScaleRequest represents the payload for scaling a deployment
type ScaleRequest struct {
	Replicas int32 `json:"replicas" binding:"required,min=0"`
}

// Scale handles PUT /:namespace/:name/scale to change replica count with history tracking
func (h *DeploymentHandler) Scale(c *gin.Context) {
	startTime := time.Now()
	namespace := c.Param("namespace")
	name := c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	var req ScaleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
		return
	}

	// Fetch current deployment
	var deployment appsv1.Deployment
	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	prevDeployment := deployment.DeepCopy()
	oldReplicas := int32(1)
	if deployment.Spec.Replicas != nil {
		oldReplicas = *deployment.Spec.Replicas
	}
	deployment.Spec.Replicas = &req.Replicas

	err := cs.K8sClient.Update(c.Request.Context(), &deployment)
	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	h.recordHistory(c, "scale", prevDeployment, &deployment, success, errMsg, startTime)

	if success {
		user := c.MustGet("user").(model.User)
		logger.Audit(user.Key(), "Scale", "deployments", namespace, cs.Name,
			fmt.Sprintf("Scaled deployment %s from %d to %d replicas", name, oldReplicas, req.Replicas),
			time.Since(startTime))
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "scaled successfully",
		"deployment": deployment.Name,
		"replicas":   req.Replicas,
	})
}

// RollbackRequest represents the payload for rolling back a deployment
type RollbackRequest struct {
	Revision int64 `json:"revision,omitempty"`
}

// Rollback handles POST /:namespace/:name/rollback to rollback a deployment to a previous revision
func (h *DeploymentHandler) Rollback(c *gin.Context) {
	startTime := time.Now()
	namespace := c.Param("namespace")
	name := c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	var req RollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// If no body, default to revision 0 (rollback to previous)
		req.Revision = 0
	}

	// Fetch current deployment
	var deployment appsv1.Deployment
	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	prevDeployment := deployment.DeepCopy()

	// Get the ReplicaSet history for this deployment
	rsList, err := cs.K8sClient.ClientSet.AppsV1().ReplicaSets(namespace).List(c.Request.Context(), metav1.ListOptions{
		LabelSelector: metav1.FormatLabelSelector(deployment.Spec.Selector),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list replica sets: " + err.Error()})
		return
	}

	if len(rsList.Items) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no previous revision available for rollback"})
		return
	}

	// Find the target ReplicaSet based on revision
	var targetRS *appsv1.ReplicaSet
	if req.Revision > 0 {
		for i := range rsList.Items {
			rs := &rsList.Items[i]
			if rs.Annotations["deployment.kubernetes.io/revision"] == fmt.Sprintf("%d", req.Revision) {
				targetRS = rs
				break
			}
		}
		if targetRS == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("revision %d not found", req.Revision)})
			return
		}
	} else {
		// Find the second most recent (previous) revision
		var maxRevision int64
		var secondMaxRS *appsv1.ReplicaSet
		for i := range rsList.Items {
			rs := &rsList.Items[i]
			rev := rs.Annotations["deployment.kubernetes.io/revision"]
			var revNum int64
			fmt.Sscanf(rev, "%d", &revNum)
			if revNum > maxRevision {
				secondMaxRS = targetRS
				maxRevision = revNum
				targetRS = rs
			} else if secondMaxRS == nil || revNum > 0 {
				secondMaxRS = rs
			}
		}
		targetRS = secondMaxRS
		if targetRS == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no previous revision available for rollback"})
			return
		}
	}

	// Apply the rollback by patching the deployment with the target RS's pod template
	deployment.Spec.Template = targetRS.Spec.Template

	// Add a rollback annotation
	if deployment.Annotations == nil {
		deployment.Annotations = make(map[string]string)
	}
	deployment.Annotations["kite.kubernetes.io/rolledBackAt"] = time.Now().Format(time.RFC3339)
	deployment.Annotations["kite.kubernetes.io/rolledBackToRevision"] = targetRS.Annotations["deployment.kubernetes.io/revision"]

	patchBytes, err := json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{
			"template": deployment.Spec.Template,
		},
		"metadata": map[string]interface{}{
			"annotations": deployment.Annotations,
		},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create patch: " + err.Error()})
		return
	}

	result, err := cs.K8sClient.ClientSet.AppsV1().Deployments(namespace).Patch(
		c.Request.Context(),
		name,
		types.StrategicMergePatchType,
		patchBytes,
		metav1.PatchOptions{},
	)

	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	h.recordHistory(c, "rollback", prevDeployment, &deployment, success, errMsg, startTime)

	if success {
		user := c.MustGet("user").(model.User)
		targetRevision := targetRS.Annotations["deployment.kubernetes.io/revision"]
		logger.Audit(user.Key(), "Rollback", "deployments", namespace, cs.Name,
			fmt.Sprintf("Rolled back deployment %s to revision %s", name, targetRevision),
			time.Since(startTime))
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "rollback initiated successfully",
		"deployment": result.Name,
		"revision":   targetRS.Annotations["deployment.kubernetes.io/revision"],
	})
}

// RevisionInfo represents a single deployment revision
type RevisionInfo struct {
	Revision    string            `json:"revision"`
	CreatedAt   string            `json:"createdAt"`
	Replicas    int32             `json:"replicas"`
	Image       string            `json:"image"`
	Labels      map[string]string `json:"labels,omitempty"`
	IsCurrent   bool              `json:"isCurrent"`
	ReplicaName string            `json:"replicaName"`
}

// ListRevisions handles GET /:namespace/:name/revisions to list deployment rollout history
func (h *DeploymentHandler) ListRevisions(c *gin.Context) {
	namespace := c.Param("namespace")
	name := c.Param("name")
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	var deployment appsv1.Deployment
	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &deployment); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rsList, err := cs.K8sClient.ClientSet.AppsV1().ReplicaSets(namespace).List(c.Request.Context(), metav1.ListOptions{
		LabelSelector: metav1.FormatLabelSelector(deployment.Spec.Selector),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list replica sets: " + err.Error()})
		return
	}

	currentRevision := deployment.Annotations["deployment.kubernetes.io/revision"]

	revisions := make([]RevisionInfo, 0, len(rsList.Items))
	for _, rs := range rsList.Items {
		revision := rs.Annotations["deployment.kubernetes.io/revision"]
		image := ""
		if len(rs.Spec.Template.Spec.Containers) > 0 {
			image = rs.Spec.Template.Spec.Containers[0].Image
		}

		revisions = append(revisions, RevisionInfo{
			Revision:    revision,
			CreatedAt:   rs.CreationTimestamp.Format(time.RFC3339),
			Replicas:    *rs.Spec.Replicas,
			Image:       image,
			Labels:      rs.Labels,
			IsCurrent:   revision == currentRevision,
			ReplicaName: rs.Name,
		})
	}

	klog.V(4).Infof("Found %d revisions for deployment %s/%s", len(revisions), namespace, name)

	c.JSON(http.StatusOK, gin.H{
		"revisions":       revisions,
		"currentRevision": currentRevision,
	})
}

// registerCustomRoutes adds deployment-specific routes
func (h *DeploymentHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.PUT("/:namespace/:name/scale", h.Scale)
	group.POST("/:namespace/:name/rollback", h.Rollback)
	group.GET("/:namespace/:name/revisions", h.ListRevisions)
}