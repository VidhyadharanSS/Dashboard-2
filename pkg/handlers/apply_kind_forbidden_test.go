package handlers

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// TestIsApplyKindForbidden_RejectsSecret asserts that any Kubernetes Secret —
// regardless of apiVersion, name or namespace — is rejected outright by the
// outermost guard in ApplyResource(). This is the defense-in-depth backstop
// for the "no secret material via dashboard" hardening policy: even if a
// future regression re-enables a Secret create/list route, applying via the
// YAML editor must still fail.
func TestIsApplyKindForbidden_RejectsSecret(t *testing.T) {
	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Secret",
			"metadata": map[string]interface{}{
				"name":      "db-credentials",
				"namespace": "default",
			},
			"type": "Opaque",
			"stringData": map[string]interface{}{
				"password": "hunter2",
			},
		},
	}
	reason := isApplyKindForbidden(obj)
	assert.NotEmpty(t, reason, "Secret kind must be rejected by isApplyKindForbidden")
	assert.Contains(t, reason, "Secret")
}

// TestIsApplyKindForbidden_AllowsNonSecretKinds asserts the guard does not
// over-reach and block unrelated kinds (those are still subject to RBAC and
// the workload-field policy further down the pipeline).
func TestIsApplyKindForbidden_AllowsNonSecretKinds(t *testing.T) {
	for _, kind := range []string{"Deployment", "StatefulSet", "DaemonSet", "ConfigMap", "Service", "Ingress", "Job"} {
		obj := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"kind": kind,
			},
		}
		assert.Empty(t, isApplyKindForbidden(obj), "kind %q must not be blanket-rejected", kind)
	}
}
