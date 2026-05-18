package resources

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

type StatefulSetHandler struct {
	*GenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList]
}

func NewStatefulSetHandler() *StatefulSetHandler {
	return &StatefulSetHandler{
		GenericResourceHandler: NewGenericResourceHandler[*appsv1.StatefulSet, *appsv1.StatefulSetList](
			"statefulsets",
			false,
			true,
		),
	}
}

// List overrides the generic List to preserve status fields even in reduce mode.
func (h *StatefulSetHandler) List(c *gin.Context) {
	objectList, err := h.list(c)
	if err != nil {
		return
	}

	if c.Query("reduce") == "true" {
		for i := range objectList.Items {
			ss := &objectList.Items[i]
			preservedStatus := ss.Status
			preservedReplicas := ss.Spec.Replicas
			preservedSelector := ss.Spec.Selector
			preservedContainers := lo.Map(ss.Spec.Template.Spec.Containers, func(c corev1.Container, _ int) corev1.Container {
				return corev1.Container{Name: c.Name, Image: c.Image}
			})

			ss.ObjectMeta = metav1.ObjectMeta{
				Name:              ss.Name,
				Namespace:         ss.Namespace,
				UID:               ss.UID,
				CreationTimestamp: ss.CreationTimestamp,
				Labels:            ss.Labels,
			}
			ss.Spec = appsv1.StatefulSetSpec{
				Replicas: preservedReplicas,
				Selector: preservedSelector,
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: preservedContainers,
					},
				},
			}
			ss.Status = preservedStatus
		}
	}

	c.JSON(http.StatusOK, objectList)
}

func (h *StatefulSetHandler) Restart(c *gin.Context, namespace, name string) error {
	startTime := time.Now()
	var statefulset appsv1.StatefulSet
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	
	if err := cs.K8sClient.Get(c.Request.Context(), types.NamespacedName{Namespace: namespace, Name: name}, &statefulset); err != nil {
		return err
	}
	
	if statefulset.Spec.Template.Annotations == nil {
		statefulset.Spec.Template.Annotations = make(map[string]string)
	}
	
	// Trigger rolling update
	statefulset.Spec.Template.Annotations["kite.kubernetes.io/restartedAt"] = time.Now().Format(time.RFC3339)

	err := cs.K8sClient.Update(c.Request.Context(), &statefulset)
	success := err == nil
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}

	// Corrected: Added startTime as the 7th argument
	h.recordHistory(c, "restart", &statefulset, &statefulset, success, errMsg, startTime)
	
	if success {
		user := c.MustGet("user").(model.User)
		logger.Audit(user.Key(), "Restart", "statefulsets", namespace, cs.Name, fmt.Sprintf("Restarted statefulset %s", name), time.Since(startTime))
	}
	
	return err
}
