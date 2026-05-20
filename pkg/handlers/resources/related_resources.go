package resources

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/labels"
	"sigs.k8s.io/controller-runtime/pkg/client"
	gatewayapiv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func discoverServices(ctx context.Context, k8sClient *kube.K8sClient, namespace string, podLabels map[string]string) ([]common.RelatedResource, error) {
	if len(podLabels) == 0 {
		return []common.RelatedResource{}, nil
	}

	var serviceList corev1.ServiceList
	if err := k8sClient.List(ctx, &serviceList, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, fmt.Errorf("failed to list services: %w", err)
	}

	var relatedServices []common.RelatedResource
	for _, service := range serviceList.Items {
		if service.Spec.Selector != nil {
			serviceSelector := labels.SelectorFromSet(service.Spec.Selector)
			if serviceSelector.Matches(labels.Set(podLabels)) {
				relatedServices = append(relatedServices, common.RelatedResource{
					Type:      "services",
					Namespace: service.Namespace,
					Name:      service.Name,
				})
			}
		}
	}

	return relatedServices, nil
}

func discoverIngressServices(namespace string, ingress *v1.Ingress) []common.RelatedResource {
	seen := make(map[string]struct{})
	var relatedServices []common.RelatedResource
	addService := func(svcName string) {
		if _, exist := seen[svcName]; exist {
			return
		}
		seen[svcName] = struct{}{}
		relatedServices = append(relatedServices, common.RelatedResource{
			Type:      "services",
			Namespace: namespace,
			Name:      svcName,
		})
	}

	for _, rule := range ingress.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}

		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service == nil {
				continue
			}
			addService(path.Backend.Service.Name)
		}
	}
	if ingress.Spec.DefaultBackend != nil && ingress.Spec.DefaultBackend.Service != nil {
		if _, exist := seen[ingress.Spec.DefaultBackend.Service.Name]; !exist {
			addService(ingress.Spec.DefaultBackend.Service.Name)
		}
	}

	return relatedServices
}

func discoverConfigs(namespace string, podSpec *corev1.PodTemplateSpec) []common.RelatedResource {
	if podSpec == nil {
		return []common.RelatedResource{}
	}

	configMapSet := make(map[string]struct{})
	secretSet := make(map[string]struct{})
	pvcSet := make(map[string]struct{})

	for _, container := range podSpec.Spec.Containers {
		for _, envVar := range container.Env {
			if envVar.ValueFrom != nil && envVar.ValueFrom.ConfigMapKeyRef != nil {
				configMapSet[envVar.ValueFrom.ConfigMapKeyRef.Name] = struct{}{}
			}
			if envVar.ValueFrom != nil && envVar.ValueFrom.SecretKeyRef != nil {
				secretSet[envVar.ValueFrom.SecretKeyRef.Name] = struct{}{}
			}
		}
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil {
				configMapSet[envFrom.ConfigMapRef.Name] = struct{}{}
			}
			if envFrom.SecretRef != nil {
				secretSet[envFrom.SecretRef.Name] = struct{}{}
			}
		}
	}
	for _, container := range podSpec.Spec.InitContainers {
		for _, envVar := range container.Env {
			if envVar.ValueFrom != nil && envVar.ValueFrom.ConfigMapKeyRef != nil {
				configMapSet[envVar.ValueFrom.ConfigMapKeyRef.Name] = struct{}{}
			}
			if envVar.ValueFrom != nil && envVar.ValueFrom.SecretKeyRef != nil {
				secretSet[envVar.ValueFrom.SecretKeyRef.Name] = struct{}{}
			}
		}
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil {
				configMapSet[envFrom.ConfigMapRef.Name] = struct{}{}
			}
			if envFrom.SecretRef != nil {
				secretSet[envFrom.SecretRef.Name] = struct{}{}
			}
		}
	}

	for _, volume := range podSpec.Spec.Volumes {
		if volume.ConfigMap != nil {
			configMapSet[volume.ConfigMap.Name] = struct{}{}
		}
		if volume.Secret != nil {
			secretSet[volume.Secret.SecretName] = struct{}{}
		}
		if volume.PersistentVolumeClaim != nil {
			pvcSet[volume.PersistentVolumeClaim.ClaimName] = struct{}{}
		}
	}

	var related []common.RelatedResource
	for name := range configMapSet {
		related = append(related, common.RelatedResource{
			Type:      "configmaps",
			Name:      name,
			Namespace: namespace,
		})
	}
	for name := range secretSet {
		related = append(related, common.RelatedResource{
			Type:      "secrets",
			Name:      name,
			Namespace: namespace,
		})
	}
	for name := range pvcSet {
		related = append(related, common.RelatedResource{
			Type:      "persistentvolumeclaims",
			Name:      name,
			Namespace: namespace,
		})
	}

	return related
}

func checkInUsedConfigs(spec *corev1.PodTemplateSpec, name string, resourceType string) bool {
	if spec == nil {
		return false
	}

	containers := spec.Spec.Containers
	containers = append(containers, spec.Spec.InitContainers...)
	for _, container := range containers {
		for _, envVar := range container.Env {
			if envVar.ValueFrom != nil {
				if resourceType == "configmaps" && envVar.ValueFrom.ConfigMapKeyRef != nil && envVar.ValueFrom.ConfigMapKeyRef.Name == name {
					return true
				}
				if resourceType == "secrets" && envVar.ValueFrom.SecretKeyRef != nil && envVar.ValueFrom.SecretKeyRef.Name == name {
					return true
				}
			}
		}
		for _, envFrom := range container.EnvFrom {
			if resourceType == "configmaps" && envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name == name {
				return true
			}
			if resourceType == "secrets" && envFrom.SecretRef != nil && envFrom.SecretRef.Name == name {
				return true
			}
		}
	}
	for _, volume := range spec.Spec.Volumes {
		if resourceType == "configmaps" && volume.ConfigMap != nil && volume.ConfigMap.Name == name {
			return true
		}
		if resourceType == "secrets" && volume.Secret != nil && volume.Secret.SecretName == name {
			return true
		}
		if resourceType == "persistentvolumeclaims" && volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName == name {
			return true
		}
	}
	return false
}

func discoveryWorkloads(ctx context.Context, k8sClient *kube.K8sClient, namespace string, name string, resourceType string) ([]common.RelatedResource, error) {
	var deploymentList appsv1.DeploymentList
	if err := k8sClient.List(ctx, &deploymentList, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	var statefulSetList appsv1.StatefulSetList
	if err := k8sClient.List(ctx, &statefulSetList, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	var daemonSetList appsv1.DaemonSetList
	if err := k8sClient.List(ctx, &daemonSetList, &client.ListOptions{Namespace: namespace}); err != nil {
		return nil, err
	}
	var related []common.RelatedResource
	for _, deployment := range deploymentList.Items {
		if checkInUsedConfigs(&deployment.Spec.Template, name, resourceType) {
			related = append(related, common.RelatedResource{
				Type:      "deployments",
				Name:      deployment.Name,
				Namespace: deployment.Namespace,
			})
		}
	}
	for _, statefulSet := range statefulSetList.Items {
		if checkInUsedConfigs(&statefulSet.Spec.Template, name, resourceType) {
			related = append(related, common.RelatedResource{
				Type:      "statefulsets",
				Name:      statefulSet.Name,
				Namespace: statefulSet.Namespace,
			})
		}
	}
	for _, daemonSet := range daemonSetList.Items {
		if checkInUsedConfigs(&daemonSet.Spec.Template, name, resourceType) {
			related = append(related, common.RelatedResource{
				Type:      "daemonsets",
				Name:      daemonSet.Name,
				Namespace: daemonSet.Namespace,
			})
		}
	}
	return related, nil
}

func discoverPodsByService(ctx context.Context, k8sClient *kube.K8sClient, service *corev1.Service) []common.RelatedResource {
	var endpoints corev1.Endpoints
	if err := k8sClient.Get(ctx, client.ObjectKey{Namespace: service.Namespace, Name: service.Name}, &endpoints); err != nil {
		// Endpoints might not be found, which is not a critical error.
		// For example, for external name services.
		return nil
	}

	var relatedPods []common.RelatedResource
	for _, subset := range endpoints.Subsets {
		for _, addr := range subset.Addresses {
			if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" {
				relatedPods = append(relatedPods, common.RelatedResource{
					Type:      "pods",
					Namespace: addr.TargetRef.Namespace,
					Name:      addr.TargetRef.Name,
				})
			}
		}
	}
	return relatedPods
}

func GetRelatedResources(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	namespace := c.Param("namespace")
	name := c.Param("name")
	resourceType := c.GetString("resource")
	user := c.MustGet("user").(model.User)

	resource, err := GetResource(c, resourceType, namespace, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get resource: " + err.Error()})
		return
	}

	ctx := c.Request.Context()
	var podSpec *corev1.PodTemplateSpec
	var podLabels map[string]string

	response := common.TopologyResponse{
		Nodes: []common.RelatedResource{},
		Links: []common.TopologyLink{},
	}

	rootKey := fmt.Sprintf("%s:%s:%s", resourceType, namespace, name)

	addNode := func(nodeType, nodeNamespace, nodeName string) string {
		// Filter by RBAC
		if !rbac.CanAccess(user, nodeType, "get", cs.Name, nodeNamespace) {
			return ""
		}
		key := fmt.Sprintf("%s:%s:%s", nodeType, nodeNamespace, nodeName)
		for _, n := range response.Nodes {
			if n.Type == nodeType && n.Namespace == nodeNamespace && n.Name == nodeName {
				return key
			}
		}
		response.Nodes = append(response.Nodes, common.RelatedResource{
			Type:      nodeType,
			Namespace: nodeNamespace,
			Name:      nodeName,
		})
		return key
	}

	addLink := func(source, target, label string) {
		if source == "" || target == "" {
			return
		}
		response.Links = append(response.Links, common.TopologyLink{
			Source: source,
			Target: target,
			Label:  label,
		})
	}

	switch res := resource.(type) {
	case *corev1.Pod:
		podSpec = &corev1.PodTemplateSpec{Spec: res.Spec}
		podLabels = res.Labels
		if res.Spec.NodeName != "" {
			nodeKey := addNode("nodes", "", res.Spec.NodeName)
			addLink(rootKey, nodeKey, "runs on")
		}

	case *appsv1.Deployment:
		podSpec = &res.Spec.Template
		podLabels = res.Spec.Template.Labels
	case *appsv1.StatefulSet:
		podSpec = &res.Spec.Template
		podLabels = res.Spec.Template.Labels
	case *appsv1.DaemonSet:
		podSpec = &res.Spec.Template
		podLabels = res.Spec.Template.Labels

	case *corev1.Service:
		relatedPods := discoverPodsByService(ctx, cs.K8sClient, res)
		for _, p := range relatedPods {
			podKey := addNode(p.Type, p.Namespace, p.Name)
			addLink(rootKey, podKey, "selects")
		}

	case *corev1.ConfigMap, *corev1.Secret, *corev1.PersistentVolumeClaim:
		if workloads, err := discoveryWorkloads(ctx, cs.K8sClient, namespace, name, resourceType); err == nil {
			for _, w := range workloads {
				workloadKey := addNode(w.Type, w.Namespace, w.Name)
				addLink(workloadKey, rootKey, "uses")
			}
			if resourceType == "persistentvolumeclaims" {
				pvc := res.(*corev1.PersistentVolumeClaim)
				if pvc.Spec.VolumeName != "" {
					pvKey := addNode("persistentvolumes", "", pvc.Spec.VolumeName)
					addLink(rootKey, pvKey, "bound to")
				}
			}
		}

	case *gatewayapiv1.HTTPRoute:
		related := getHTTPRouteRelatedResouces(res, namespace)
		for _, r := range related {
			nodeKey := addNode(r.Type, r.Namespace, r.Name)
			addLink(rootKey, nodeKey, "routes")
		}

	case *autoscalingv2.HorizontalPodAutoscaler:
		related := getAutoScalingRelatedResources(res, namespace)
		for _, r := range related {
			nodeKey := addNode(r.Type, r.Namespace, r.Name)
			addLink(rootKey, nodeKey, "scales")
		}

	case *v1.Ingress:
		services := discoverIngressServices(namespace, res)
		for _, s := range services {
			svcKey := addNode(s.Type, s.Namespace, s.Name)
			addLink(rootKey, svcKey, "routes to")
		}

	case *corev1.PersistentVolume:
		if res.Spec.ClaimRef != nil {
			pvcKey := addNode("persistentvolumeclaims", res.Spec.ClaimRef.Namespace, res.Spec.ClaimRef.Name)
			addLink(rootKey, pvcKey, "claimed by")
		}
		if res.Spec.StorageClassName != "" {
			scKey := addNode("storageclasses", "", res.Spec.StorageClassName)
			addLink(rootKey, scKey, "provided by")
		}

	case *storagev1.StorageClass:
		var pvList corev1.PersistentVolumeList
		if err := cs.K8sClient.List(ctx, &pvList); err == nil {
			for _, pv := range pvList.Items {
				if pv.Spec.StorageClassName == res.Name {
					pvKey := addNode("persistentvolumes", "", pv.Name)
					addLink(rootKey, pvKey, "manages")
				}
			}
		}

	case *corev1.Node:
		// Use field selector to efficiently list pods on this specific node
		podList := corev1.PodList{}
		if err := cs.K8sClient.List(ctx, &podList, &client.MatchingFields{"spec.nodeName": res.Name}); err != nil {
			// Fallback if field indexer not set up - list all and filter
			allPods := corev1.PodList{}
			if listErr := cs.K8sClient.List(ctx, &allPods); listErr == nil {
				for _, pod := range allPods.Items {
					if pod.Spec.NodeName == res.Name {
						podKey := addNode("pods", pod.Namespace, pod.Name)
						addLink(rootKey, podKey, "hosts")
					}
				}
			}
		} else {
			for _, pod := range podList.Items {
				podKey := addNode("pods", pod.Namespace, pod.Name)
				addLink(rootKey, podKey, "hosts")
			}
		}

	case *corev1.Namespace:
		nsName := res.Name
		// Discover Deployments in namespace
		var deploymentList appsv1.DeploymentList
		if err := cs.K8sClient.List(ctx, &deploymentList, &client.ListOptions{Namespace: nsName}); err == nil {
			for _, dep := range deploymentList.Items {
				depKey := addNode("deployments", dep.Namespace, dep.Name)
				addLink(rootKey, depKey, "contains")
			}
		}
		// Discover StatefulSets
		var statefulSetList appsv1.StatefulSetList
		if err := cs.K8sClient.List(ctx, &statefulSetList, &client.ListOptions{Namespace: nsName}); err == nil {
			for _, ss := range statefulSetList.Items {
				ssKey := addNode("statefulsets", ss.Namespace, ss.Name)
				addLink(rootKey, ssKey, "contains")
			}
		}
		// Discover DaemonSets
		var daemonSetList appsv1.DaemonSetList
		if err := cs.K8sClient.List(ctx, &daemonSetList, &client.ListOptions{Namespace: nsName}); err == nil {
			for _, ds := range daemonSetList.Items {
				dsKey := addNode("daemonsets", ds.Namespace, ds.Name)
				addLink(rootKey, dsKey, "contains")
			}
		}
		// Discover Services
		var serviceList corev1.ServiceList
		if err := cs.K8sClient.List(ctx, &serviceList, &client.ListOptions{Namespace: nsName}); err == nil {
			for _, svc := range serviceList.Items {
				svcKey := addNode("services", svc.Namespace, svc.Name)
				addLink(rootKey, svcKey, "exposes")
			}
		}
		// Discover Ingresses
		var ingressList v1.IngressList
		if err := cs.K8sClient.List(ctx, &ingressList, &client.ListOptions{Namespace: nsName}); err == nil {
			for _, ing := range ingressList.Items {
				ingKey := addNode("ingresses", ing.Namespace, ing.Name)
				addLink(rootKey, ingKey, "exposes")
			}
		}
	}

	if podSpec != nil && len(podLabels) > 0 {
		relatedServices, _ := discoverServices(ctx, cs.K8sClient, namespace, podLabels)
		for _, s := range relatedServices {
			svcKey := addNode(s.Type, s.Namespace, s.Name)
			addLink(svcKey, rootKey, "targets")

			// Discover Ingresses that route to this service
			var ingressList v1.IngressList
			if err := cs.K8sClient.List(ctx, &ingressList, &client.ListOptions{Namespace: namespace}); err == nil {
				for _, ing := range ingressList.Items {
					svcNames := discoverIngressServices(namespace, &ing)
					for _, svcRef := range svcNames {
						if svcRef.Name == s.Name {
							ingKey := addNode("ingresses", ing.Namespace, ing.Name)
							addLink(ingKey, svcKey, "routes to")
							break
						}
					}
				}
			}
		}
		relatedConfigs := discoverConfigs(namespace, podSpec)
		for _, c := range relatedConfigs {
			confKey := addNode(c.Type, c.Namespace, c.Name)
			addLink(rootKey, confKey, "uses")
		}

		// Discover HPAs that target this workload
		var hpaList autoscalingv2.HorizontalPodAutoscalerList
		if err := cs.K8sClient.List(ctx, &hpaList, &client.ListOptions{Namespace: namespace}); err == nil {
			for _, hpa := range hpaList.Items {
				targetKind := strings.ToLower(hpa.Spec.ScaleTargetRef.Kind) + "s"
				if targetKind == resourceType && hpa.Spec.ScaleTargetRef.Name == name {
					hpaKey := addNode("horizontalpodautoscalers", hpa.Namespace, hpa.Name)
					addLink(hpaKey, rootKey, "scales")
				}
			}
		}
	}

	if v, ok := resource.(client.Object); ok {
		for _, owner := range v.GetOwnerReferences() {
			ownerType := strings.ToLower(owner.Kind) + "s"
			if owner.Kind == "ReplicaSet" {
				rs := &appsv1.ReplicaSet{}
				if err := cs.K8sClient.Get(ctx, client.ObjectKey{Namespace: v.GetNamespace(), Name: owner.Name}, rs); err == nil {
					for _, rsOwner := range rs.OwnerReferences {
						parentType := strings.ToLower(rsOwner.Kind) + "s"
						parentKey := addNode(parentType, v.GetNamespace(), rsOwner.Name)
						addLink(parentKey, rootKey, "manages")
					}
				}
			}
			ownerKey := addNode(ownerType, v.GetNamespace(), owner.Name)
			addLink(ownerKey, rootKey, "owns")
		}
	}

	c.JSON(http.StatusOK, response)
}

func getHTTPRouteRelatedResouces(res *gatewayapiv1.HTTPRoute, namespace string) []common.RelatedResource {
	var result []common.RelatedResource
	for _, parentRef := range res.Spec.ParentRefs {
		var parentResourceType string
		if parentRef.Kind != nil && *parentRef.Kind != "" {
			parentResourceType = strings.ToLower(string(*parentRef.Kind)) + "s"
		} else {
			parentResourceType = "gateways"
		}
		result = append(result, common.RelatedResource{
			Type: parentResourceType,
			Name: string(parentRef.Name),
			Namespace: func() string {
				if parentRef.Namespace != nil && *parentRef.Namespace != "" {
					return string(*parentRef.Namespace)
				}
				return namespace
			}(),
			APIVersion: gatewayapiv1.GroupVersion.String(),
		})
	}

	for _, rule := range res.Spec.Rules {
		for _, backend := range rule.BackendRefs {
			var backendType, apiVersion string
			if backend.Kind != nil && *backend.Kind != "" {
				backendType = strings.ToLower(string(*backend.Kind)) + "s"
			} else {
				backendType = "services"
			}
			if backendType == "services" {
				apiVersion = corev1.SchemeGroupVersion.String()
			}
			result = append(result, common.RelatedResource{
				Type: backendType,
				Name: string(backend.Name),
				Namespace: func() string {
					if backend.Namespace != nil && *backend.Namespace != "" {
						return string(*backend.Namespace)
					}
					return namespace
				}(),
				APIVersion: apiVersion,
			})
		}
	}
	return result
}

func getAutoScalingRelatedResources(res *autoscalingv2.HorizontalPodAutoscaler, namespace string) []common.RelatedResource {
	var result []common.RelatedResource
	scaleTarget := res.Spec.ScaleTargetRef
	result = append(result, common.RelatedResource{
		Type:       strings.ToLower(scaleTarget.Kind) + "s",
		APIVersion: scaleTarget.APIVersion,
		Name:       scaleTarget.Name,
		Namespace:  namespace,
	})
	return result
}

