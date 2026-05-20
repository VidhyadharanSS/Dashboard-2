package handlers

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// deployObj returns a minimally-valid Deployment object that the validator
// would accept on its own. Tests then mutate one field to assert each rule.
func deployObj() *unstructured.Unstructured {
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "ok",
				"namespace": "default",
				"labels": map[string]interface{}{
					"app":   "ok",
					"owner": "team",
				},
			},
			"spec": map[string]interface{}{
				"replicas": int64(2),
				"template": map[string]interface{}{
					"metadata": map[string]interface{}{},
					"spec": map[string]interface{}{
						"containers": []interface{}{
							map[string]interface{}{
								"name":  "app",
								"image": "registry.example.com/app:1.0",
								"env": []interface{}{
									map[string]interface{}{
										"name":  "LOG_LEVEL",
										"value": "info",
									},
								},
								"volumeMounts": []interface{}{
									map[string]interface{}{
										"name":      "config",
										"mountPath": "/etc/myapp",
									},
								},
							},
						},
						"volumes": []interface{}{
							map[string]interface{}{
								"name": "config",
								"configMap": map[string]interface{}{
									"name": "myapp-config",
								},
							},
						},
					},
				},
			},
		},
	}
}

func setNested(obj *unstructured.Unstructured, value interface{}, path ...string) {
	if err := unstructured.SetNestedField(obj.Object, value, path...); err != nil {
		panic(err)
	}
}

func TestValidateWorkloadFields_BaselineDeployment_IsAccepted(t *testing.T) {
	got := validateWorkloadFields(deployObj())
	assert.Equal(t, "", got, "a baseline deployment with only permitted fields must be accepted")
}

func TestValidateWorkloadFields_NonWorkloadKind_IsIgnored(t *testing.T) {
	obj := deployObj()
	obj.Object["kind"] = "ConfigMap"
	// Even if a configmap had a forbidden-looking field, the validator must skip.
	obj.Object["status"] = map[string]interface{}{"foo": "bar"}
	assert.Equal(t, "", validateWorkloadFields(obj))
}

func TestValidateWorkloadFields_StatefulSetAndDaemonSet_AreAlsoEnforced(t *testing.T) {
	for _, kind := range []string{"StatefulSet", "DaemonSet"} {
		obj := deployObj()
		obj.Object["kind"] = kind
		// Add a forbidden command on the container.
		containers, _, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
		containers[0].(map[string]interface{})["command"] = []interface{}{"sh"}
		_ = unstructured.SetNestedSlice(obj.Object, containers, "spec", "template", "spec", "containers")

		msg := validateWorkloadFields(obj)
		assert.Contains(t, msg, kind)
		assert.Contains(t, msg, "command")
	}
}

// ---------------------------------------------------------------------------
// metadata immutability
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsMetadataUID(t *testing.T) {
	obj := deployObj()
	setNested(obj, "abcd-1234", "metadata", "uid")
	assert.Contains(t, validateWorkloadFields(obj), "metadata.uid")
}

func TestValidateWorkloadFields_RejectsMetadataResourceVersion(t *testing.T) {
	obj := deployObj()
	setNested(obj, "12345", "metadata", "resourceVersion")
	assert.Contains(t, validateWorkloadFields(obj), "metadata.resourceVersion")
}

func TestValidateWorkloadFields_RejectsMetadataCreationTimestamp(t *testing.T) {
	obj := deployObj()
	setNested(obj, "2024-01-01T00:00:00Z", "metadata", "creationTimestamp")
	assert.Contains(t, validateWorkloadFields(obj), "metadata.creationTimestamp")
}

// ---------------------------------------------------------------------------
// selector / template-labels immutability
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsSpecSelector(t *testing.T) {
	obj := deployObj()
	setNested(obj, map[string]interface{}{"matchLabels": map[string]interface{}{"app": "ok"}}, "spec", "selector")
	assert.Contains(t, validateWorkloadFields(obj), "spec.selector")
}

func TestValidateWorkloadFields_RejectsTemplateMetadataLabels(t *testing.T) {
	obj := deployObj()
	setNested(obj, map[string]interface{}{"app": "ok"}, "spec", "template", "metadata", "labels")
	msg := validateWorkloadFields(obj)
	assert.Contains(t, msg, "spec.template.metadata.labels")
}

// ---------------------------------------------------------------------------
// pod-spec restrictions
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsPodSecurityContext(t *testing.T) {
	obj := deployObj()
	setNested(obj, map[string]interface{}{"runAsUser": int64(0)}, "spec", "template", "spec", "securityContext")
	assert.Contains(t, validateWorkloadFields(obj), "spec.template.spec.securityContext")
}

func TestValidateWorkloadFields_RejectsImagePullSecrets(t *testing.T) {
	obj := deployObj()
	setNested(obj, []interface{}{map[string]interface{}{"name": "regcred"}}, "spec", "template", "spec", "imagePullSecrets")
	assert.Contains(t, validateWorkloadFields(obj), "imagePullSecrets")
}

// ---------------------------------------------------------------------------
// volumes
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsSecretVolume(t *testing.T) {
	obj := deployObj()
	setNested(obj, []interface{}{
		map[string]interface{}{
			"name":   "creds",
			"secret": map[string]interface{}{"secretName": "db-credentials"},
		},
	}, "spec", "template", "spec", "volumes")
	msg := validateWorkloadFields(obj)
	assert.Contains(t, msg, "Secret")
	assert.True(t, strings.Contains(msg, "forbidden"), "must mention forbidden: %s", msg)
}

func TestValidateWorkloadFields_AllowsHostPathVolume(t *testing.T) {
	obj := deployObj()
	setNested(obj, []interface{}{
		map[string]interface{}{
			"name":     "hostlogs",
			"hostPath": map[string]interface{}{"path": "/var/log/myapp", "type": "DirectoryOrCreate"},
		},
	}, "spec", "template", "spec", "volumes")
	assert.Equal(t, "", validateWorkloadFields(obj), "hostPath volumes are now permitted")
}

func TestValidateWorkloadFields_AllowsEmptyDirAndConfigMapVolumes(t *testing.T) {
	obj := deployObj()
	setNested(obj, []interface{}{
		map[string]interface{}{
			"name":     "scratch",
			"emptyDir": map[string]interface{}{},
		},
		map[string]interface{}{
			"name":      "config",
			"configMap": map[string]interface{}{"name": "myapp-config"},
		},
	}, "spec", "template", "spec", "volumes")
	assert.Equal(t, "", validateWorkloadFields(obj))
}

// ---------------------------------------------------------------------------
// container restrictions
// ---------------------------------------------------------------------------

func mutateFirstContainer(obj *unstructured.Unstructured, mutate func(map[string]interface{})) {
	containers, _, _ := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
	mutate(containers[0].(map[string]interface{}))
	_ = unstructured.SetNestedSlice(obj.Object, containers, "spec", "template", "spec", "containers")
}

func TestValidateWorkloadFields_RejectsContainerCommand(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["command"] = []interface{}{"sh", "-c", "id"}
	})
	assert.Contains(t, validateWorkloadFields(obj), "command")
}

func TestValidateWorkloadFields_RejectsContainerArgs(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["args"] = []interface{}{"--root"}
	})
	assert.Contains(t, validateWorkloadFields(obj), "args")
}

func TestValidateWorkloadFields_RejectsContainerSecurityContext(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["securityContext"] = map[string]interface{}{"privileged": true}
	})
	assert.Contains(t, validateWorkloadFields(obj), "securityContext")
}

func TestValidateWorkloadFields_RejectsInitContainerCommand(t *testing.T) {
	obj := deployObj()
	setNested(obj, []interface{}{
		map[string]interface{}{
			"name":    "init",
			"image":   "busybox",
			"command": []interface{}{"sh"},
		},
	}, "spec", "template", "spec", "initContainers")
	assert.Contains(t, validateWorkloadFields(obj), "command")
}

// ---------------------------------------------------------------------------
// env / envFrom
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_AllowsLiteralEnvValue(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["env"] = []interface{}{
			map[string]interface{}{"name": "FOO", "value": "bar"},
			map[string]interface{}{"name": "BAZ", "value": "qux"},
		}
	})
	assert.Equal(t, "", validateWorkloadFields(obj))
}

func TestValidateWorkloadFields_RejectsEnvValueFromSecret(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["env"] = []interface{}{
			map[string]interface{}{
				"name": "DB_PASS",
				"valueFrom": map[string]interface{}{
					"secretKeyRef": map[string]interface{}{"name": "db", "key": "password"},
				},
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "valueFrom")
}

func TestValidateWorkloadFields_RejectsEnvValueFromConfigMap(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["env"] = []interface{}{
			map[string]interface{}{
				"name": "REGION",
				"valueFrom": map[string]interface{}{
					"configMapKeyRef": map[string]interface{}{"name": "cfg", "key": "region"},
				},
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "valueFrom")
}

func TestValidateWorkloadFields_RejectsEnvValueFromFieldRef(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["env"] = []interface{}{
			map[string]interface{}{
				"name": "POD_IP",
				"valueFrom": map[string]interface{}{
					"fieldRef": map[string]interface{}{"fieldPath": "status.podIP"},
				},
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "valueFrom")
}

func TestValidateWorkloadFields_RejectsEnvFromSecretRef(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["envFrom"] = []interface{}{
			map[string]interface{}{
				"secretRef": map[string]interface{}{"name": "db"},
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "secretRef")
}

func TestValidateWorkloadFields_RejectsEnvFromConfigMapRef(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["envFrom"] = []interface{}{
			map[string]interface{}{
				"configMapRef": map[string]interface{}{"name": "cfg"},
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "configMapRef")
}

// ---------------------------------------------------------------------------
// status / volumeMounts (mountPath is no longer blanket-blocked)
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsStatus(t *testing.T) {
	obj := deployObj()
	obj.Object["status"] = map[string]interface{}{"replicas": int64(2)}
	assert.Contains(t, validateWorkloadFields(obj), "status")
}

func TestValidateWorkloadFields_AllowsVolumeMountAtEtcPath(t *testing.T) {
	// /etc/myapp is a legitimate location for ConfigMap mounts.
	// The validator must no longer reject mountPath prefixes blanketly.
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{
				"name":      "config",
				"mountPath": "/etc/myapp/conf.d",
			},
		}
	})
	assert.Equal(t, "", validateWorkloadFields(obj))
}
