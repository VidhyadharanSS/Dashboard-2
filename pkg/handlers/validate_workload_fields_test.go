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
										"mountPath": "/home/zoho/conf/myapp",
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
// status / volumeMounts
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsStatus(t *testing.T) {
	obj := deployObj()
	obj.Object["status"] = map[string]interface{}{"replicas": int64(2)}
	assert.Contains(t, validateWorkloadFields(obj), "status")
}

func TestValidateWorkloadFields_RejectsVolumeMountUnderEtc(t *testing.T) {
	// /etc is a sensitive container path; overlaying it via a volumeMount
	// would let a requester shadow system configuration with attacker-
	// controlled content.
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{
				"name":      "config",
				"mountPath": "/etc/myapp/conf.d",
			},
		}
	})
	msg := validateWorkloadFields(obj)
	assert.Contains(t, msg, "mountPath")
	assert.Contains(t, msg, "/etc")
}

func TestValidateWorkloadFields_RejectsVolumeMountAtRoot(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{"name": "config", "mountPath": "/"},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "mountPath")
}

func TestValidateWorkloadFields_RejectsVolumeMountUnderBinSbinLib(t *testing.T) {
	for _, mp := range []string{"/bin/ls", "/sbin/sshd", "/usr/bin/sudo", "/usr/local/bin/foo", "/lib/x", "/lib64/x", "/boot/grub"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "config", "mountPath": mp},
			}
		})
		assert.Contains(t, validateWorkloadFields(obj), "mountPath", "expected %s to be rejected", mp)
	}
}

func TestValidateWorkloadFields_RejectsVolumeMountUnderProcSysRunVarLib(t *testing.T) {
	for _, mp := range []string{"/proc/1/root", "/sys/fs/cgroup", "/var/run/docker.sock", "/var/lib/kubelet", "/var/lib/docker", "/var/lib/containerd", "/root/.ssh"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "config", "mountPath": mp},
			}
		})
		assert.Contains(t, validateWorkloadFields(obj), "mountPath", "expected %s to be rejected", mp)
	}
}

func TestValidateWorkloadFields_RejectsVolumeMountUnderDevExceptShm(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{"name": "config", "mountPath": "/dev/sda1"},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "/dev")
}

func TestValidateWorkloadFields_AllowsVolumeMountAtDevShm(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{"name": "shm", "mountPath": "/dev/shm"},
		}
	})
	assert.Equal(t, "", validateWorkloadFields(obj))
}

func TestValidateWorkloadFields_AllowsVolumeMountUnderHomeSasAndHomeZoho(t *testing.T) {
	for _, mp := range []string{"/home/sas/saved", "/home/sas/zoho/cert/ray/tls.crt", "/home/zoho/logs", "/home/zoho/zoho/resources/conf/app.properties", "/usr/tmp", "/usr/tmp/PROMETHEUS_MULTIPROC_DIR"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "v", "mountPath": mp},
			}
		})
		assert.Equal(t, "", validateWorkloadFields(obj), "expected %s to be permitted", mp)
	}
}

func TestValidateWorkloadFields_RejectsVolumeMountSubPath(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{
				"name":      "config",
				"mountPath": "/home/zoho/conf/app.properties",
				"subPath":   "app.properties",
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "subPath")
}

func TestValidateWorkloadFields_RejectsVolumeMountSubPathExpr(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{
				"name":         "config",
				"mountPath":    "/home/zoho/conf/app.properties",
				"subPathExpr":  "$(POD_NAME).properties",
			},
		}
	})
	assert.Contains(t, validateWorkloadFields(obj), "subPathExpr")
}

func TestValidateWorkloadFields_RejectsVolumeMountPropagation(t *testing.T) {
	for _, mode := range []string{"Bidirectional", "HostToContainer", "None"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{
					"name":             "v",
					"mountPath":        "/home/sas/saved",
					"mountPropagation": mode,
				},
			}
		})
		assert.Contains(t, validateWorkloadFields(obj), "mountPropagation", "expected %s to be rejected", mode)
	}
}

// ---------------------------------------------------------------------------
// mountPath canonicalisation: bypass attempts must be caught
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsMountPathBypassAttempts(t *testing.T) {
	// All of these canonicalise to a sensitive container path and must be
	// rejected. Tests are explicit so the failure message points at the
	// specific bypass attempt that slipped through.
	cases := []struct {
		path   string
		reason string
	}{
		{"//etc/passwd", "double-leading-slash"},
		{"/etc//passwd", "double-internal-slash"},
		{"/etc/./passwd", "current-dir segment"},
		{"/etc/foo/..", "parent-dir back to /etc"},
		{"/etc/", "trailing slash"},
		{"/etc/foo/../bar", "parent-dir mid-path"},
		{"/bin/./ls", "current-dir segment under /bin"},
		{"/proc/1/./root", "current-dir segment under /proc"},
		{"/var/lib/kubelet/./pods", "current-dir segment under kubelet root"},
		{"/dev/sda/../sda1", "parent-dir under /dev"},
		{"//dev/sda1", "double-leading-slash under /dev"},
		{"/dev/./sda1", "current-dir under /dev"},
		{"//", "double-slash root"},
		{"/./", "root with current-dir"},
	}
	for _, tc := range cases {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "v", "mountPath": tc.path},
			}
		})
		assert.NotEqual(t, "", validateWorkloadFields(obj), "expected %q (%s) to be rejected", tc.path, tc.reason)
	}
}

func TestValidateWorkloadFields_RejectsRelativeMountPath(t *testing.T) {
	for _, mp := range []string{"etc/passwd", "../etc/passwd", "home/sas/saved", "."} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "v", "mountPath": mp},
			}
		})
		assert.Contains(t, validateWorkloadFields(obj), "absolute", "expected %q to be rejected", mp)
	}
}

func TestValidateWorkloadFields_AllowsDevShmSubdirectory(t *testing.T) {
	for _, mp := range []string{"/dev/shm", "/dev/shm/cache", "/dev/shm/multiproc/PROMETHEUS"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "shm", "mountPath": mp},
			}
		})
		assert.Equal(t, "", validateWorkloadFields(obj), "expected %q to be permitted", mp)
	}
}

func TestValidateWorkloadFields_AllowsLookalikeNonSensitivePaths(t *testing.T) {
	// Paths whose first segment LOOKS LIKE a sensitive prefix but is actually
	// a different directory (e.g. /etcd, /binary, /rooted) must NOT be
	// rejected by an over-broad string-prefix check.
	for _, mp := range []string{"/etcd/data", "/binary/payload", "/sbinary/foo", "/rooted/app", "/proceeds/log", "/system/ok"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "v", "mountPath": mp},
			}
		})
		assert.Equal(t, "", validateWorkloadFields(obj), "expected %q to be permitted", mp)
	}
}

// ---------------------------------------------------------------------------
// initContainer parity: every per-container check applies to initContainers
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_InitContainerVolumeMountChecks(t *testing.T) {
	cases := []struct {
		name string
		vm   map[string]interface{}
		want string
	}{
		{"sensitive mountPath", map[string]interface{}{"name": "v", "mountPath": "/etc/x"}, "mountPath"},
		{"subPath", map[string]interface{}{"name": "v", "mountPath": "/home/sas/x", "subPath": "x"}, "subPath"},
		{"subPathExpr", map[string]interface{}{"name": "v", "mountPath": "/home/sas/x", "subPathExpr": "x"}, "subPathExpr"},
		{"mountPropagation", map[string]interface{}{"name": "v", "mountPath": "/home/sas/x", "mountPropagation": "Bidirectional"}, "mountPropagation"},
	}
	for _, tc := range cases {
		obj := deployObj()
		setNested(obj, []interface{}{
			map[string]interface{}{
				"name":         "init",
				"image":        "busybox",
				"volumeMounts": []interface{}{tc.vm},
			},
		}, "spec", "template", "spec", "initContainers")
		msg := validateWorkloadFields(obj)
		assert.Contains(t, msg, tc.want, "init container case %q: %s", tc.name, msg)
	}
}

// ---------------------------------------------------------------------------
// Multiple mounts: rejection fires on the first sensitive one
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsWhenAnyOfManyMountsIsSensitive(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{"name": "ok1", "mountPath": "/home/sas/a"},
			map[string]interface{}{"name": "ok2", "mountPath": "/home/zoho/b"},
			map[string]interface{}{"name": "bad", "mountPath": "/etc/shadow"},
			map[string]interface{}{"name": "ok3", "mountPath": "/dev/shm/cache"},
		}
	})
	msg := validateWorkloadFields(obj)
	assert.Contains(t, msg, "mountPath")
	assert.Contains(t, msg, "/etc")
}

func TestValidateWorkloadFields_AllowsAllPermittedMountsTogether(t *testing.T) {
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{"name": "nohup", "mountPath": "/home/zoho/nohup"},
			map[string]interface{}{"name": "logs", "mountPath": "/home/zoho/logs"},
			map[string]interface{}{"name": "tmp", "mountPath": "/usr/tmp"},
			map[string]interface{}{"name": "conf", "mountPath": "/home/zoho/zoho/resources/conf/app.properties"},
			map[string]interface{}{"name": "saved", "mountPath": "/home/sas/saved"},
			map[string]interface{}{"name": "cert", "mountPath": "/home/sas/zoho/cert/ray/tls.crt"},
			map[string]interface{}{"name": "shm", "mountPath": "/dev/shm"},
			map[string]interface{}{"name": "prom", "mountPath": "/usr/tmp/PROMETHEUS_MULTIPROC_DIR"},
		}
	})
	assert.Equal(t, "", validateWorkloadFields(obj))
}

// ---------------------------------------------------------------------------
// checkSensitiveMountPath unit table (covers the helper directly)
// ---------------------------------------------------------------------------

func TestCheckSensitiveMountPath_Table(t *testing.T) {
	deny := []string{
		"/", "//", "/./", "/etc", "/etc/", "/etc/passwd", "//etc/passwd",
		"/bin", "/bin/ls", "/sbin/sshd", "/usr/bin/sudo", "/usr/sbin/foo",
		"/usr/local/bin/x", "/usr/local/sbin/y", "/lib/x", "/lib64/y",
		"/usr/lib/x", "/usr/lib64/y", "/boot/grub", "/root/.ssh",
		"/proc/1/root", "/sys/fs/cgroup", "/var/run/docker.sock",
		"/var/lib/kubelet/x", "/var/lib/docker/y", "/var/lib/containerd/z",
		"/dev", "/dev/sda1", "/dev/null", "/etc/foo/../bar", "/etc/./passwd",
	}
	for _, p := range deny {
		assert.NotEqual(t, "", checkSensitiveMountPath(p), "expected %q to be denied", p)
	}
	allow := []string{
		"/home/sas/saved", "/home/zoho/logs", "/usr/tmp",
		"/usr/tmp/PROMETHEUS_MULTIPROC_DIR", "/dev/shm", "/dev/shm/cache",
		"/etcd/data", "/binary/x", "/rooted/x", "/proceeds/x", "/var/log/app",
		"/opt/app", "/app/data", "",
	}
	for _, p := range allow {
		assert.Equal(t, "", checkSensitiveMountPath(p), "expected %q to be permitted", p)
	}
	// Relative paths are rejected too (mountPath must be absolute).
	for _, p := range []string{"etc/passwd", "../etc/passwd", "home/sas/x", "."} {
		assert.NotEqual(t, "", checkSensitiveMountPath(p), "expected relative %q to be rejected", p)
	}
}
