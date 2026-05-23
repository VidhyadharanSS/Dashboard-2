package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/logger"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"k8s.io/klog/v2"
)

func RBACMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := c.MustGet("user").(model.User)
		cs := c.MustGet("cluster").(*cluster.ClientSet)

		verbs := method2verb(c.Request.Method)
		ns, resource := url2namespaceresource(c.Request.URL.Path)
		if ns == "" || resource == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid resource URL"})
			return
		}
		if resource == "namespaces" && verbs == "get" {
			// if user has roles, allow access to list namespaces resource
			// don't worry about security here, we will filter namespaces in the list namespace handler
			// this is just to allow users to list namespaces they have access to
			c.Next()
			return
		}

		canAccess := rbac.CanAccess(user, resource, verbs, cs.Name, ns)
		if canAccess {
			// Inject resolved RBAC context for downstream handlers
			c.Set("rbac_resource", resource)
			c.Set("rbac_verb", verbs)
			c.Set("rbac_namespace", ns)
			c.Next()
		} else {
			denialMsg := rbac.NoAccess(user.Key(), verbs, resource, ns, cs.Name)

			// Audit-log ALL denied operations for security monitoring. Writes
			// (create/update/delete) and access to sensitive resources are
			// escalated to WARN severity; ordinary read denials are logged at
			// INFO so they can be retrieved forensically without dominating
			// the audit stream.
			severity := logger.AuditInfo
			if isWriteVerb(verbs) || isSensitiveResource(resource) {
				severity = logger.AuditWarning
			}
			logger.Audit(
				user.Key(), "DENIED", resource, ns, cs.Name,
				fmt.Sprintf("Blocked %s on %s — insufficient permissions", verbs, resource),
				logger.AuditOpts{Severity: severity, SourceIP: c.ClientIP()},
			)
			logger.Security(user.Key(), "RBAC_DENIED",
				fmt.Sprintf("verb=%s resource=%s ns=%s cluster=%s ip=%s",
					verbs, resource, ns, cs.Name, c.ClientIP()))
			klog.V(1).Infof("RBAC DENIED: user=%s verb=%s resource=%s ns=%s cluster=%s",
				user.Key(), verbs, resource, ns, cs.Name)

			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":     denialMsg,
				"resource":  resource,
				"verb":      verbs,
				"namespace": ns,
				"cluster":   cs.Name,
			})
		}
	}
}

// isWriteVerb returns true for mutation operations that should be audit-logged on denial.
func isWriteVerb(verb string) bool {
	switch verb {
	case string(common.VerbCreate), string(common.VerbUpdate), string(common.VerbDelete):
		return true
	default:
		return false
	}
}

// isSensitiveResource returns true for resource types whose READ access
// denials warrant elevated audit attention (potential reconnaissance).
func isSensitiveResource(resource string) bool {
	switch resource {
	case "secrets", "serviceaccounts",
		"roles", "rolebindings", "clusterroles", "clusterrolebindings",
		"oauth-providers", "apikeys", "users", "clusters":
		return true
	default:
		return false
	}
}

func method2verb(method string) string {
	switch method {
	case http.MethodPost:
		return string(common.VerbCreate)
	case http.MethodPut, http.MethodPatch:
		return string(common.VerbUpdate)
	default:
		return strings.ToLower(method)
	}
}

// url2namespaceresource converts a URL path to a resource type.
// For example:
//
// - /api/v1/pods/default/pods => default, pods
// - /api/v1/pvs/_all/some-pv => _all, some-pv
// - /api/v1/pods/default => default, pods
// - /api/v1/pods => "", pods
func url2namespaceresource(url string) (namespace string, resource string) {
	// Split the URL into its components
	parts := strings.Split(url, "/")
	if len(parts) < 4 {
		return
	}
	resource = parts[3] // The resource type is always the third part
	if len(parts) > 4 {
		namespace = parts[4]
	} else {
		namespace = "_all" // All namespaces
	}
	return
}

// prometheusResourceFromPath extracts the effective namespace from a prometheus API path.
// Prometheus pod-metrics paths have the shape: /prometheus/pods/:namespace/:podName/metrics
// We return ("prometheus", namespace) so RBAC can gate on the "prometheus" virtual resource.
func prometheusResourceFromPath(url string) (namespace string, resource string) {
	// /api/v1/prometheus/pods/:namespace/:podName/metrics
	parts := strings.Split(url, "/")
	// parts[0]="" [1]="api" [2]="v1" [3]="prometheus" [4]="pods" [5]=namespace [6]=podName ...
	if len(parts) >= 6 && parts[3] == "prometheus" && parts[4] == "pods" {
		return parts[5], "prometheus"
	}
	// All other prometheus paths are cluster-wide
	return "_all", "prometheus"
}
