package handlers

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// ---------------------------------------------------------------------------
// Stub meta.RESTMapper — implements all 7 interface methods.
// Only RESTMapping is used by resolveRESTMapping; the rest return errors.
// ---------------------------------------------------------------------------

type stubScope struct{ name meta.RESTScopeName }

func (s stubScope) Name() meta.RESTScopeName { return s.name }

var (
	scopeNamespace meta.RESTScope = stubScope{meta.RESTScopeNameNamespace}
	scopeRoot      meta.RESTScope = stubScope{meta.RESTScopeNameRoot}
)

type stubRESTMapper struct {
	// maps GroupKind → RESTMapping
	mappings map[schema.GroupKind]*meta.RESTMapping
}

func (m *stubRESTMapper) RESTMapping(gk schema.GroupKind, versions ...string) (*meta.RESTMapping, error) {
	if rm, ok := m.mappings[gk]; ok {
		return rm, nil
	}
	return nil, fmt.Errorf("no REST mapping found for %s", gk)
}

func (m *stubRESTMapper) RESTMappings(gk schema.GroupKind, versions ...string) ([]*meta.RESTMapping, error) {
	return nil, fmt.Errorf("not implemented")
}

func (m *stubRESTMapper) KindFor(resource schema.GroupVersionResource) (schema.GroupVersionKind, error) {
	return schema.GroupVersionKind{}, fmt.Errorf("not implemented")
}

func (m *stubRESTMapper) KindsFor(resource schema.GroupVersionResource) ([]schema.GroupVersionKind, error) {
	return nil, fmt.Errorf("not implemented")
}

func (m *stubRESTMapper) ResourceFor(input schema.GroupVersionResource) (schema.GroupVersionResource, error) {
	return schema.GroupVersionResource{}, fmt.Errorf("not implemented")
}

func (m *stubRESTMapper) ResourcesFor(input schema.GroupVersionResource) ([]schema.GroupVersionResource, error) {
	return nil, fmt.Errorf("not implemented")
}

func (m *stubRESTMapper) ResourceSingularizer(resource string) (string, error) {
	return "", fmt.Errorf("not implemented")
}

// newTestMapper returns a stub mapper pre-populated with core Kubernetes
// resource mappings used by the apply handler tests.
func newTestMapper() *stubRESTMapper {
	return &stubRESTMapper{
		mappings: map[schema.GroupKind]*meta.RESTMapping{
			{Group: "", Kind: "PersistentVolumeClaim"}: {
				Resource:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
				GroupVersionKind: schema.GroupVersionKind{Group: "", Version: "v1", Kind: "PersistentVolumeClaim"},
				Scope:           scopeNamespace,
			},
			{Group: "", Kind: "PersistentVolume"}: {
				Resource:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "persistentvolumes"},
				GroupVersionKind: schema.GroupVersionKind{Group: "", Version: "v1", Kind: "PersistentVolume"},
				Scope:           scopeRoot,
			},
			{Group: "storage.k8s.io", Kind: "StorageClass"}: {
				Resource:        schema.GroupVersionResource{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"},
				GroupVersionKind: schema.GroupVersionKind{Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass"},
				Scope:           scopeRoot,
			},
			{Group: "apps", Kind: "Deployment"}: {
				Resource:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
				GroupVersionKind: schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"},
				Scope:           scopeNamespace,
			},
		},
	}
}

// ---------------------------------------------------------------------------
// parseYAMLStream tests
// ---------------------------------------------------------------------------

const pvcYAML = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
`

const pvYAML = `
apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: standard
`

const storageClassYAML = `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
`

const multiDocYAML = `---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: multi-pvc
  namespace: staging
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: multi-pv
spec:
  capacity:
    storage: 20Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Delete
`

func TestParseYAMLStream_PVC(t *testing.T) {
	h := &ResourceApplyHandler{}
	objects, errMsg := h.parseYAMLStream(pvcYAML)

	require.Empty(t, errMsg, "expected no parse error")
	require.Len(t, objects, 1, "expected exactly one object")

	obj := objects[0]
	assert.Equal(t, "PersistentVolumeClaim", obj.GetKind())
	assert.Equal(t, "v1", obj.GetAPIVersion())
	assert.Equal(t, "my-pvc", obj.GetName())
	assert.Equal(t, "default", obj.GetNamespace(), "PVC must carry its namespace")
}

func TestParseYAMLStream_PV(t *testing.T) {
	h := &ResourceApplyHandler{}
	objects, errMsg := h.parseYAMLStream(pvYAML)

	require.Empty(t, errMsg)
	require.Len(t, objects, 1)

	obj := objects[0]
	assert.Equal(t, "PersistentVolume", obj.GetKind())
	assert.Equal(t, "v1", obj.GetAPIVersion())
	assert.Equal(t, "my-pv", obj.GetName())
	assert.Empty(t, obj.GetNamespace(), "cluster-scoped PV must have no namespace")
}

func TestParseYAMLStream_StorageClass(t *testing.T) {
	h := &ResourceApplyHandler{}
	objects, errMsg := h.parseYAMLStream(storageClassYAML)

	require.Empty(t, errMsg)
	require.Len(t, objects, 1)

	obj := objects[0]
	assert.Equal(t, "StorageClass", obj.GetKind())
	assert.Equal(t, "storage.k8s.io/v1", obj.GetAPIVersion())
	assert.Equal(t, "fast", obj.GetName())
	assert.Empty(t, obj.GetNamespace(), "cluster-scoped StorageClass must have no namespace")
}

func TestParseYAMLStream_MultiDoc(t *testing.T) {
	h := &ResourceApplyHandler{}
	objects, errMsg := h.parseYAMLStream(multiDocYAML)

	require.Empty(t, errMsg)
	require.Len(t, objects, 2, "expected two objects from multi-document YAML")

	assert.Equal(t, "PersistentVolumeClaim", objects[0].GetKind())
	assert.Equal(t, "multi-pvc", objects[0].GetName())
	assert.Equal(t, "staging", objects[0].GetNamespace())

	assert.Equal(t, "PersistentVolume", objects[1].GetKind())
	assert.Equal(t, "multi-pv", objects[1].GetName())
	assert.Empty(t, objects[1].GetNamespace())
}

func TestParseYAMLStream_InvalidYAML(t *testing.T) {
	h := &ResourceApplyHandler{}
	// Complete garbage that cannot be parsed as YAML
	_, errMsg := h.parseYAMLStream("{{{{: not valid yaml: [}")

	assert.NotEmpty(t, errMsg, "invalid YAML must return an error message")
}

func TestParseYAMLStream_MissingKind(t *testing.T) {
	// Valid YAML structure but missing required "kind" field — the object
	// should still be returned so the caller can report the validation error.
	const noKindYAML = `
apiVersion: v1
metadata:
  name: orphan
  namespace: default
`
	h := &ResourceApplyHandler{}
	objects, errMsg := h.parseYAMLStream(noKindYAML)

	require.Empty(t, errMsg, "partial YAML is still parseable — kind check is caller's job")
	require.Len(t, objects, 1)
	assert.Empty(t, objects[0].GetKind())
}

// ---------------------------------------------------------------------------
// resolveRESTMapping tests
// ---------------------------------------------------------------------------

func objectWithAPIVersionAndKind(apiVersion, kind string) *unstructured.Unstructured {
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion(apiVersion)
	obj.SetKind(kind)
	return obj
}

func TestResolveRESTMapping_PVC_IsNamespaced(t *testing.T) {
	mapper := newTestMapper()
	obj := objectWithAPIVersionAndKind("v1", "PersistentVolumeClaim")

	mapping, err := resolveRESTMapping(mapper, obj)

	require.NoError(t, err)
	assert.Equal(t, "persistentvolumeclaims", mapping.Resource.Resource)
	assert.Equal(t, meta.RESTScopeNameNamespace, mapping.Scope.Name(),
		"PVC must be a namespace-scoped resource")
}

func TestResolveRESTMapping_PV_IsClusterScoped(t *testing.T) {
	mapper := newTestMapper()
	obj := objectWithAPIVersionAndKind("v1", "PersistentVolume")

	mapping, err := resolveRESTMapping(mapper, obj)

	require.NoError(t, err)
	assert.Equal(t, "persistentvolumes", mapping.Resource.Resource)
	assert.Equal(t, meta.RESTScopeNameRoot, mapping.Scope.Name(),
		"PV must be a cluster-scoped resource")
}

func TestResolveRESTMapping_StorageClass_IsClusterScoped(t *testing.T) {
	mapper := newTestMapper()
	obj := objectWithAPIVersionAndKind("storage.k8s.io/v1", "StorageClass")

	mapping, err := resolveRESTMapping(mapper, obj)

	require.NoError(t, err)
	assert.Equal(t, "storageclasses", mapping.Resource.Resource)
	assert.Equal(t, meta.RESTScopeNameRoot, mapping.Scope.Name(),
		"StorageClass must be a cluster-scoped resource")
}

func TestResolveRESTMapping_Deployment_IsNamespaced(t *testing.T) {
	mapper := newTestMapper()
	obj := objectWithAPIVersionAndKind("apps/v1", "Deployment")

	mapping, err := resolveRESTMapping(mapper, obj)

	require.NoError(t, err)
	assert.Equal(t, "deployments", mapping.Resource.Resource)
	assert.Equal(t, meta.RESTScopeNameNamespace, mapping.Scope.Name())
}

func TestResolveRESTMapping_UnknownKind_ReturnsError(t *testing.T) {
	mapper := newTestMapper()
	obj := objectWithAPIVersionAndKind("v1", "Wombat")

	_, err := resolveRESTMapping(mapper, obj)

	assert.Error(t, err, "unknown kind must return an error from the mapper")
}

func TestResolveRESTMapping_InvalidAPIVersion_ReturnsError(t *testing.T) {
	mapper := newTestMapper()
	obj := objectWithAPIVersionAndKind("not/a/valid/apiversion", "Whatever")

	_, err := resolveRESTMapping(mapper, obj)

	assert.Error(t, err, "malformed apiVersion must produce a parse error")
}
