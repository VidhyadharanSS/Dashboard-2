package resources

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/types"
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

	// Corrected: Added startTime as the 7th argument
	h.recordHistory(c, "restart", &deployment, &deployment, success, errMsg, startTime)
	
	if success {
		user := c.MustGet("user").(model.User)
		logger.Audit(user.Key(), "Restart", "deployments", namespace, cs.Name, fmt.Sprintf("Restarted deployment %s", name), time.Since(startTime))
	}
	
	return err
}