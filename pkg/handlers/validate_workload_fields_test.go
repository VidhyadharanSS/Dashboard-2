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
										"mountPath": "/home/sas/conf/myapp",
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

func TestValidateWorkloadFields_RejectsVolumeMountAtDevShm_OutsideAllowList(t *testing.T) {
	// /dev/shm is carved out of the /dev blocklist (so it does not get the
	// "/dev restricted" message), but the strict single-prefix allow-list
	// now rejects it because it is not under /home/sas.
	obj := deployObj()
	mutateFirstContainer(obj, func(c map[string]interface{}) {
		c["volumeMounts"] = []interface{}{
			map[string]interface{}{"name": "shm", "mountPath": "/dev/shm"},
		}
	})
	msg := validateWorkloadFields(obj)
	assert.NotEqual(t, "", msg, "/dev/shm must be rejected under the strict /home/sas allow-list")
	assert.Contains(t, msg, "permitted prefix")
}

func TestValidateWorkloadFields_AllowsVolumeMountUnderHomeSas(t *testing.T) {
	for _, mp := range []string{"/home/sas", "/home/sas/saved", "/home/sas/zoho/cert/ray/tls.crt", "/home/sas/conf/app.properties", "/home/sas/PROMETHEUS_MULTIPROC_DIR"} {
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
				"mountPath": "/home/sas/conf/app.properties",
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
				"mountPath":    "/home/sas/conf/app.properties",
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

func TestValidateWorkloadFields_RejectsDevShmSubdirectoryOutsideAllowList(t *testing.T) {
	// Under the strict single-prefix allow-list, every /dev/shm path is
	// rejected because it is not under /home/sas. The blocklist still carves
	// /dev/shm out of /dev, so the rejection comes from the allow-list gate.
	for _, mp := range []string{"/dev/shm", "/dev/shm/cache", "/dev/shm/multiproc/PROMETHEUS"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "shm", "mountPath": mp},
			}
		})
		msg := validateWorkloadFields(obj)
		assert.NotEqual(t, "", msg, "expected %q to be rejected by allow-list", mp)
		assert.Contains(t, msg, "permitted prefix", "expected allow-list error for %q, got: %s", mp, msg)
	}
}

func TestValidateWorkloadFields_RejectsLookalikePathsOutsideAllowList(t *testing.T) {
	// Paths whose first segment LOOKS LIKE a sensitive prefix but is actually
	// a different directory (e.g. /etcd, /binary, /rooted) are not on the
	// blocklist — the older policy permitted them. The current allow-list
	// gate now rejects them because they fall outside permittedMountPathPrefixes.
	for _, mp := range []string{"/etcd/data", "/binary/payload", "/sbinary/foo", "/rooted/app", "/proceeds/log", "/system/ok"} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "v", "mountPath": mp},
			}
		})
		msg := validateWorkloadFields(obj)
		assert.NotEqual(t, "", msg, "expected %q to be rejected by the allow-list", mp)
		assert.Contains(t, msg, "permitted prefix", "expected allow-list error for %q, got: %s", mp, msg)
	}
}

func TestValidateWorkloadFields_RejectsAppAndOptPathsOutsideAllowList(t *testing.T) {
	// Common application paths that an attacker could use to overlay app
	// config/data/logs with caller-controlled volume content. None are on
	// the sensitive-path blocklist, all are now rejected by the allow-list.
	// Under the strict single-prefix policy this also includes paths that
	// were previously on the allow-list (/home/zoho, /usr/tmp, /dev/shm).
	for _, mp := range []string{
		"/app", "/app/config", "/app/data", "/app/logs",
		"/opt/app", "/opt/app/conf",
		"/var/log/app", "/var/log/myapp",
		"/tmp", "/tmp/cache", "/var/tmp/x",
		"/data", "/cache", "/scratch", "/workspace/code",
		"/srv/www", "/mnt/data", "/media/usb",
		"/home/zoho", "/home/zoho/logs", "/home/zoho/conf/app.properties",
		"/usr/tmp", "/usr/tmp/PROMETHEUS_MULTIPROC_DIR",
		"/dev/shm", "/dev/shm/cache",
		"/home", "/home/other", "/home/sasx",
	} {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["volumeMounts"] = []interface{}{
				map[string]interface{}{"name": "v", "mountPath": mp},
			}
		})
		msg := validateWorkloadFields(obj)
		assert.NotEqual(t, "", msg, "expected %q to be rejected by the allow-list", mp)
		assert.Contains(t, msg, "permitted prefix", "expected allow-list error for %q, got: %s", mp, msg)
	}
}

func TestValidateWorkloadFields_AllowsEveryPermittedMountPrefix(t *testing.T) {
	// Every entry in permittedMountPathPrefixes must be accepted both as an
	// exact match and as a sub-path. Under the strict policy this is only
	// /home/sas and its sub-paths.
	cases := []string{
		"/home/sas",
		"/home/sas/saved",
		"/home/sas/zoho/cert/ray/tls.crt",
		"/home/sas/conf/app.properties",
		"/home/sas/logs/myapp",
		"/home/sas/PROMETHEUS_MULTIPROC_DIR",
	}
	for _, mp := range cases {
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
			map[string]interface{}{"name": "ok2", "mountPath": "/home/sas/b"},
			map[string]interface{}{"name": "bad", "mountPath": "/etc/shadow"},
			map[string]interface{}{"name": "ok3", "mountPath": "/home/sas/cache"},
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
			map[string]interface{}{"name": "nohup", "mountPath": "/home/sas/nohup"},
			map[string]interface{}{"name": "logs", "mountPath": "/home/sas/logs"},
			map[string]interface{}{"name": "tmp", "mountPath": "/home/sas/tmp"},
			map[string]interface{}{"name": "conf", "mountPath": "/home/sas/zoho/resources/conf/app.properties"},
			map[string]interface{}{"name": "saved", "mountPath": "/home/sas/saved"},
			map[string]interface{}{"name": "cert", "mountPath": "/home/sas/zoho/cert/ray/tls.crt"},
			map[string]interface{}{"name": "shm", "mountPath": "/home/sas/shm"},
			map[string]interface{}{"name": "prom", "mountPath": "/home/sas/PROMETHEUS_MULTIPROC_DIR"},
		}
	})
	assert.Equal(t, "", validateWorkloadFields(obj))
}

// ---------------------------------------------------------------------------
// checkSensitiveMountPath unit table (covers the helper directly)
// ---------------------------------------------------------------------------

func TestCheckSensitiveMountPath_Table(t *testing.T) {
	// Paths rejected by the sensitive-path blocklist (specific error message).
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
	// Paths rejected by the allow-list gate (do not match any permitted prefix).
	// Under the strict single-prefix policy, /home/zoho, /usr/tmp, and /dev/shm
	// all fall here too — only /home/sas paths are permitted.
	allowListDeny := []string{
		"/etcd/data", "/binary/x", "/rooted/x", "/proceeds/x",
		"/var/log/app", "/opt/app", "/app/data", "/app", "/tmp", "/tmp/x",
		"/data", "/cache", "/scratch", "/srv", "/mnt/x", "/workspace",
		"/home", "/home/other", "/home/sasx", "/home/zoho", "/home/zoho/logs",
		"/usr/tmp", "/usr/tmp/PROMETHEUS_MULTIPROC_DIR",
		"/dev/shm", "/dev/shm/cache", "/dev/shm/multiproc/PROMETHEUS",
	}
	for _, p := range allowListDeny {
		msg := checkSensitiveMountPath(p)
		assert.NotEqual(t, "", msg, "expected %q to be denied by allow-list", p)
		assert.Contains(t, msg, "permitted prefix", "expected allow-list error for %q, got: %s", p, msg)
	}
	// Paths permitted because they match the single permitted prefix
	// (/home/sas) and pass the blocklist.
	allow := []string{
		"",
		"/home/sas", "/home/sas/saved", "/home/sas/zoho/cert/ray/tls.crt",
		"/home/sas/logs", "/home/sas/nohup", "/home/sas/conf/app.properties",
		"/home/sas/PROMETHEUS_MULTIPROC_DIR",
	}
	for _, p := range allow {
		assert.Equal(t, "", checkSensitiveMountPath(p), "expected %q to be permitted", p)
	}
	// Relative paths are rejected too (mountPath must be absolute).
	for _, p := range []string{"etc/passwd", "../etc/passwd", "home/sas/x", "."} {
		assert.NotEqual(t, "", checkSensitiveMountPath(p), "expected relative %q to be rejected", p)
	}
}

// ---------------------------------------------------------------------------
// env[].value: sensitive-key blocklist (passwords, secrets, tokens, …)
// ---------------------------------------------------------------------------

func TestValidateWorkloadFields_RejectsSensitiveEnvKey(t *testing.T) {
	// Every name here matches a sensitive substring (case-insensitive) and
	// must be rejected when set via a literal env[].value.
	cases := []string{
		"PASSWORD", "DB_PASSWORD", "db_password", "MyPassword",
		"PASSWD", "ROOT_PASSWD",
		"SECRET", "APP_SECRET", "client_secret", "OAUTH_CLIENT_SECRET",
		"TOKEN", "AUTH_TOKEN", "refresh_token", "JWT_TOKEN",
		"APIKEY", "API_KEY", "OPENAI_API_KEY",
		"CREDENTIAL", "AWS_CREDENTIALS",
		"PRIVATE_KEY", "SSH_PRIVATE_KEY", "PRIVKEY",
		"PASSPHRASE", "GPG_PASSPHRASE",
	}
	for _, name := range cases {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["env"] = []interface{}{
				map[string]interface{}{"name": name, "value": "x"},
			}
		})
		msg := validateWorkloadFields(obj)
		assert.NotEqual(t, "", msg, "expected env name %q to be rejected", name)
		assert.Contains(t, msg, "sensitive-key pattern", "expected sensitive-key error for %q, got: %s", name, msg)
	}
}

func TestValidateWorkloadFields_AllowsBenignEnvKeysThatLookSensitive(t *testing.T) {
	// Names that contain partial matches but are not credential material
	// must still be accepted — the substring list is intentionally narrow.
	cases := []string{
		"LOG_LEVEL", "HTTP_PROXY", "JAVA_TOOL_OPTIONS", "APP_UID",
		"CACHE_KEY_PREFIX", "MAP_KEY", "KEY_VAULT_URL",
		"CERT_PATH", "TLS_CA_FILE", "TLS_CERT_FILE",
		"PUBLIC_KEY_PATH", "KEYSTORE_PATH",
		"FEATURE_FLAG_X", "DB_HOST", "DB_PORT", "DB_USER",
	}
	for _, name := range cases {
		obj := deployObj()
		mutateFirstContainer(obj, func(c map[string]interface{}) {
			c["env"] = []interface{}{
				map[string]interface{}{"name": name, "value": "x"},
			}
		})
		assert.Equal(t, "", validateWorkloadFields(obj), "expected benign env name %q to be permitted", name)
	}
}

func TestValidateWorkloadFields_RejectsSensitiveEnvKey_OnInitContainer(t *testing.T) {
	obj := deployObj()
	setNested(obj, []interface{}{
		map[string]interface{}{
			"name":  "init",
			"image": "busybox",
			"env": []interface{}{
				map[string]interface{}{"name": "INIT_DB_PASSWORD", "value": "hunter2"},
			},
		},
	}, "spec", "template", "spec", "initContainers")
	msg := validateWorkloadFields(obj)
	assert.Contains(t, msg, "sensitive-key pattern")
	assert.Contains(t, msg, "INIT_DB_PASSWORD")
}

func TestIsSensitiveEnvKey_Table(t *testing.T) {
	deny := []string{
		"PASSWORD", "password", "DB_PASSWORD", "My_PaSsWoRd",
		"PASSWD", "root_passwd",
		"SECRET", "client_secret", "WEBHOOK_SECRET",
		"TOKEN", "GITHUB_TOKEN", "refresh_token",
		"API_KEY", "APIKEY", "X_APIKEY",
		"CREDENTIAL", "AWS_CREDENTIALS",
		"PRIVATE_KEY", "PRIVKEY", "GPG_PRIVATE_KEY",
		"PASSPHRASE", "KEY_PASSPHRASE",
	}
	for _, n := range deny {
		assert.True(t, isSensitiveEnvKey(n), "expected %q to be sensitive", n)
	}
	allow := []string{
		"", "LOG_LEVEL", "HTTP_PROXY", "DB_HOST", "DB_PORT", "DB_USER",
		"CACHE_KEY_PREFIX", "MAP_KEY", "KEY_VAULT_URL",
		"CERT_PATH", "TLS_CA_FILE", "PUBLIC_KEY_PATH",
		"FEATURE_FLAG", "APP_UID", "JAVA_TOOL_OPTIONS",
	}
	for _, n := range allow {
		assert.False(t, isSensitiveEnvKey(n), "expected %q to be non-sensitive", n)
	}
}
