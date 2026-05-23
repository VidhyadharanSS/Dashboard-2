import { describe, expect, it } from 'vitest'

import {
  diffForbiddenInYaml,
  diffForbiddenWorkloadFields,
  isWorkloadKind,
  LOCKED_WORKLOAD_FIELD_LABELS,
} from './workload-policy'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyObj = Record<string, unknown>

function baselineDeployment(): AnyObj {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'app', namespace: 'default' },
    spec: {
      replicas: 1,
      template: {
        spec: {
          containers: [
            {
              name: 'app',
              image: 'app:1',
              env: [{ name: 'LOG_LEVEL', value: 'info' }],
              volumeMounts: [
                { name: 'conf', mountPath: '/home/zoho/conf/myapp' },
              ],
            },
          ],
          volumes: [{ name: 'conf', configMap: { name: 'cfg' } }],
        },
      },
    },
  }
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

// ---------------------------------------------------------------------------
// Kind gating
// ---------------------------------------------------------------------------

describe('isWorkloadKind', () => {
  it('returns true for workload kinds', () => {
    for (const kind of ['Deployment', 'StatefulSet', 'DaemonSet']) {
      expect(isWorkloadKind({ kind })).toBe(true)
    }
  })
  it('returns false for non-workload kinds and bad input', () => {
    for (const kind of ['Pod', 'Service', 'ConfigMap', '', undefined]) {
      expect(isWorkloadKind({ kind })).toBe(false)
    }
    expect(isWorkloadKind(null)).toBe(false)
    expect(isWorkloadKind(42)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// diffForbiddenWorkloadFields
// ---------------------------------------------------------------------------

describe('diffForbiddenWorkloadFields', () => {
  it('accepts identical documents', () => {
    const o = baselineDeployment()
    expect(diffForbiddenWorkloadFields(o, clone(o))).toEqual([])
  })

  it('ignores non-workload kinds entirely', () => {
    const o = { kind: 'ConfigMap', metadata: { uid: 'a' } }
    const u = { kind: 'ConfigMap', metadata: { uid: 'b' } }
    expect(diffForbiddenWorkloadFields(o, u)).toEqual([])
  })

  it('flags metadata.uid / resourceVersion / generation drift', () => {
    const o = baselineDeployment()
    const u = clone(o)
    ;(u.metadata as AnyObj).uid = 'changed'
    ;(u.metadata as AnyObj).resourceVersion = '999'
    ;(u.metadata as AnyObj).generation = 2
    const v = diffForbiddenWorkloadFields(o, u)
    expect(v).toContain('metadata.uid')
    expect(v).toContain('metadata.resourceVersion')
    expect(v).toContain('metadata.generation')
  })

  it('flags spec.selector edits', () => {
    const o = baselineDeployment()
    const u = clone(o)
    ;(u.spec as AnyObj).selector = { matchLabels: { app: 'b' } }
    expect(diffForbiddenWorkloadFields(o, u)).toContain('spec.selector')
  })

  it('flags spec.template.metadata.labels edits', () => {
    const o = baselineDeployment()
    const u = clone(o)
    const tpl = (u.spec as AnyObj).template as AnyObj
    tpl.metadata = { labels: { app: 'b' } }
    expect(diffForbiddenWorkloadFields(o, u)).toContain(
      'spec.template.metadata.labels'
    )
  })

  it('flags pod-level securityContext + imagePullSecrets drift', () => {
    const o = baselineDeployment()
    const u = clone(o)
    const spec = ((u.spec as AnyObj).template as AnyObj).spec as AnyObj
    spec.securityContext = { runAsUser: 0 }
    spec.imagePullSecrets = [{ name: 'r' }]
    const v = diffForbiddenWorkloadFields(o, u)
    expect(v).toContain('spec.template.spec.securityContext')
    expect(v).toContain('spec.template.spec.imagePullSecrets')
  })

  it('flags volumes[].secret drift per named volume', () => {
    const o = baselineDeployment()
    const u = clone(o)
    const spec = ((u.spec as AnyObj).template as AnyObj).spec as AnyObj
    ;(spec.volumes as AnyObj[]).push({
      name: 'creds',
      secret: { secretName: 'db' },
    })
    expect(diffForbiddenWorkloadFields(o, u)).toContain(
      'spec.template.spec.volumes[name=creds].secret'
    )
  })

  it('flags container command / args / securityContext / envFrom edits', () => {
    const o = baselineDeployment()
    const u = clone(o)
    const c = (((u.spec as AnyObj).template as AnyObj).spec as AnyObj)
      .containers as AnyObj[]
    c[0].command = ['sh']
    c[0].args = ['-c', 'id']
    c[0].securityContext = { privileged: true }
    c[0].envFrom = [{ secretRef: { name: 'db' } }]
    const v = diffForbiddenWorkloadFields(o, u)
    expect(v).toContain('spec.template.spec.containers[name=app].command')
    expect(v).toContain('spec.template.spec.containers[name=app].args')
    expect(v).toContain(
      'spec.template.spec.containers[name=app].securityContext'
    )
    expect(v).toContain('spec.template.spec.containers[name=app].envFrom')
  })

  it('flags env[].valueFrom drift but allows literal env[].value changes', () => {
    const o = baselineDeployment()
    const u = clone(o)
    const c = (((u.spec as AnyObj).template as AnyObj).spec as AnyObj)
      .containers as AnyObj[]
    // literal value change is allowed
    ;(c[0].env as AnyObj[])[0].value = 'debug'
    expect(diffForbiddenWorkloadFields(o, u)).toEqual([])
    // adding a valueFrom is a violation
    ;(c[0].env as AnyObj[]).push({
      name: 'DB_PASS',
      valueFrom: { secretKeyRef: { name: 'db', key: 'p' } },
    })
    expect(diffForbiddenWorkloadFields(o, u)).toContain(
      'spec.template.spec.containers[name=app].env[name=DB_PASS].valueFrom'
    )
  })
})

// ---------------------------------------------------------------------------
// volumeMount: frozen fields + sensitive mountPath deny-list
// ---------------------------------------------------------------------------

describe('diffForbiddenWorkloadFields: volumeMounts', () => {
  function withMount(vm: AnyObj): AnyObj {
    const u = baselineDeployment()
    const c = ((u.spec as AnyObj).template as AnyObj).spec as AnyObj
    ;(c.containers as AnyObj[])[0].volumeMounts = [vm]
    return u
  }

  it('flags edits to readOnly / subPath / subPathExpr / mountPropagation', () => {
    const o = withMount({ name: 'conf', mountPath: '/home/zoho/conf/myapp' })
    const u = withMount({
      name: 'conf',
      mountPath: '/home/zoho/conf/myapp',
      readOnly: false,
      subPath: 'a',
      subPathExpr: '$(POD_NAME)',
      mountPropagation: 'Bidirectional',
    })
    const v = diffForbiddenWorkloadFields(o, u)
    const expect_field = (f: string) =>
      expect(v).toContain(
        `spec.template.spec.containers[name=app].volumeMounts[name=conf].${f}`
      )
    expect_field('readOnly')
    expect_field('subPath')
    expect_field('subPathExpr')
    expect_field('mountPropagation')
  })

  it('flags mountPath edits', () => {
    const o = withMount({ name: 'conf', mountPath: '/home/zoho/conf/myapp' })
    const u = withMount({ name: 'conf', mountPath: '/home/sas/myapp' })
    expect(diffForbiddenWorkloadFields(o, u)).toContain(
      'spec.template.spec.containers[name=app].volumeMounts[name=conf].mountPath'
    )
  })

  it('flags sensitive mountPath even if the baseline already had it', () => {
    // A new mount under /etc must always be flagged on the absolute check,
    // independent of whether it differs from the baseline.
    const u = withMount({ name: 'sys', mountPath: '/etc/shadow' })
    const v = diffForbiddenWorkloadFields(u, u)
    expect(v.some((p) => p.includes('sensitive container path'))).toBe(true)
  })

  it('catches mountPath canonicalisation bypass attempts', () => {
    const cases = [
      '//etc/passwd',
      '/etc//passwd',
      '/etc/./passwd',
      '/etc/foo/..',
      '/etc/',
      '/etc/foo/../bar',
      '/bin/./ls',
      '/proc/1/./root',
      '/dev/sda/../sda1',
      '//dev/sda1',
      '//',
      '/./',
    ]
    for (const mp of cases) {
      const u = withMount({ name: 'v', mountPath: mp })
      const v = diffForbiddenWorkloadFields(u, u)
      expect(
        v.some((p) => p.includes('sensitive container path')),
        `expected ${mp} to be flagged`
      ).toBe(true)
    }
  })

  it('rejects relative mountPath', () => {
    for (const mp of ['etc/passwd', '../etc/passwd', 'home/sas/x', '.']) {
      const u = withMount({ name: 'v', mountPath: mp })
      const v = diffForbiddenWorkloadFields(u, u)
      expect(
        v.some((p) => p.includes('sensitive container path')),
        `expected relative ${mp} to be flagged`
      ).toBe(true)
    }
  })

  it('permits /dev/shm and look-alike non-sensitive paths', () => {
    for (const mp of [
      '/home/sas/saved',
      '/home/zoho/logs',
      '/usr/tmp',
      '/usr/tmp/PROMETHEUS_MULTIPROC_DIR',
      '/dev/shm',
      '/dev/shm/cache',
      '/etcd/data',
      '/binary/x',
      '/rooted/x',
      '/proceeds/x',
    ]) {
      const u = withMount({ name: 'v', mountPath: mp })
      expect(diffForbiddenWorkloadFields(u, u)).toEqual([])
    }
  })

  it('rejects sensitive mountPaths exhaustively', () => {
    for (const mp of [
      '/',
      '/etc',
      '/etc/passwd',
      '/bin/ls',
      '/sbin/sshd',
      '/usr/bin/sudo',
      '/usr/local/bin/x',
      '/lib/x',
      '/lib64/y',
      '/usr/lib/x',
      '/boot/grub',
      '/root/.ssh',
      '/proc/1/root',
      '/sys/fs/cgroup',
      '/var/run/docker.sock',
      '/var/lib/kubelet/x',
      '/var/lib/docker/y',
      '/var/lib/containerd/z',
      '/dev',
      '/dev/sda1',
    ]) {
      const u = withMount({ name: 'v', mountPath: mp })
      const v = diffForbiddenWorkloadFields(u, u)
      expect(
        v.some((p) => p.includes('sensitive container path')),
        `expected ${mp} to be flagged`
      ).toBe(true)
    }
  })

  it('applies the same checks to initContainers', () => {
    const u = baselineDeployment()
    const spec = ((u.spec as AnyObj).template as AnyObj).spec as AnyObj
    spec.initContainers = [
      {
        name: 'init',
        image: 'busybox',
        volumeMounts: [{ name: 'v', mountPath: '/etc/x' }],
      },
    ]
    const v = diffForbiddenWorkloadFields(u, u)
    expect(
      v.some((p) =>
        p.includes(
          'spec.template.spec.initContainers[name=init].volumeMounts[name=v].mountPath'
        )
      )
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// YAML wrapper + label list
// ---------------------------------------------------------------------------

describe('diffForbiddenInYaml', () => {
  it('returns [] on parse failure', () => {
    expect(diffForbiddenInYaml('not: [yaml', 'still: }not')).toEqual([])
  })
  it('returns violations when YAML differs in a locked field', () => {
    const o = `kind: Deployment
metadata:
  name: app
spec:
  template:
    spec:
      containers:
        - name: app
          image: a:1`
    const u = `kind: Deployment
metadata:
  name: app
spec:
  template:
    spec:
      containers:
        - name: app
          image: a:1
          command: [sh]`
    expect(diffForbiddenInYaml(o, u)).toContain(
      'spec.template.spec.containers[name=app].command'
    )
  })
})

describe('LOCKED_WORKLOAD_FIELD_LABELS', () => {
  it('mentions volumeMounts lock-down', () => {
    const joined = LOCKED_WORKLOAD_FIELD_LABELS.join(' | ')
    expect(joined).toMatch(/volumeMounts/)
    expect(joined).toMatch(/mountPropagation/)
    expect(joined).toMatch(/subPath/)
    expect(joined).toMatch(/\/dev\/shm/)
  })
})
