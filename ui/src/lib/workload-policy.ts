// Client-side mirror of pkg/handlers/resource_apply_handler.go::validateWorkloadFields.
//
// This module is the second line of defence for the YAML editor. The
// authoritative enforcement is server-side; this module exists so that the UI
// refuses to even SEND a save request that would mutate a protected field.
//
// Protected fields apply only to workload kinds (Deployment / StatefulSet /
// DaemonSet) and may never be changed via the UI by any role, including
// superadmin. The set is intentionally mirrored 1:1 with the Go validator.

import * as yaml from 'js-yaml'

const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet'])

// metadata fields that are server-managed and must never be hand-edited
const FORBIDDEN_METADATA_FIELDS = [
  'uid',
  'resourceVersion',
  'creationTimestamp',
  'generation',
  'managedFields',
  'ownerReferences',
]

type AnyObj = Record<string, unknown>

function get(obj: unknown, path: (string | number)[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as AnyObj)[k as string]
  }
  return cur
}

// Stable structural equality - JSON.stringify of normalised input.
// undefined / null / missing are treated as equal so that "field absent" in
// both sides does not register as a change.
function deepEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined ? null : v)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

function listByName(arr: unknown): Map<string, AnyObj> {
  const m = new Map<string, AnyObj>()
  if (!Array.isArray(arr)) return m
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const name = (item as AnyObj).name
      if (typeof name === 'string') m.set(name, item as AnyObj)
    }
  }
  return m
}

/**
 * Compares two parsed workload documents and returns the list of forbidden
 * field paths that DIFFER between them. An empty result means the change is
 * acceptable (only permitted fields were touched).
 */
export function diffForbiddenWorkloadFields(
  original: unknown,
  updated: unknown
): string[] {
  if (!original || !updated || typeof original !== 'object' || typeof updated !== 'object') {
    return []
  }
  const o = original as AnyObj
  const u = updated as AnyObj
  const kind = (u.kind ?? o.kind) as string | undefined
  if (!kind || !WORKLOAD_KINDS.has(kind)) return []

  const violations: string[] = []

  // metadata immutability
  for (const f of FORBIDDEN_METADATA_FIELDS) {
    if (!deepEqual(get(o, ['metadata', f]), get(u, ['metadata', f]))) {
      violations.push(`metadata.${f}`)
    }
  }

  // selector + template labels (selector pairing)
  if (!deepEqual(get(o, ['spec', 'selector']), get(u, ['spec', 'selector']))) {
    violations.push('spec.selector')
  }
  if (
    !deepEqual(
      get(o, ['spec', 'template', 'metadata', 'labels']),
      get(u, ['spec', 'template', 'metadata', 'labels'])
    )
  ) {
    violations.push('spec.template.metadata.labels')
  }

  // pod-level sensitive fields
  if (
    !deepEqual(
      get(o, ['spec', 'template', 'spec', 'securityContext']),
      get(u, ['spec', 'template', 'spec', 'securityContext'])
    )
  ) {
    violations.push('spec.template.spec.securityContext')
  }
  if (
    !deepEqual(
      get(o, ['spec', 'template', 'spec', 'imagePullSecrets']),
      get(u, ['spec', 'template', 'spec', 'imagePullSecrets'])
    )
  ) {
    violations.push('spec.template.spec.imagePullSecrets')
  }

  // status is server-managed
  if (!deepEqual(o.status, u.status)) {
    violations.push('status')
  }

  // volumes[].secret immutable per named volume
  const oldVols = listByName(get(o, ['spec', 'template', 'spec', 'volumes']))
  const newVols = listByName(get(u, ['spec', 'template', 'spec', 'volumes']))
  const volNames = new Set([...oldVols.keys(), ...newVols.keys()])
  for (const n of volNames) {
    if (!deepEqual(oldVols.get(n)?.secret, newVols.get(n)?.secret)) {
      violations.push(`spec.template.spec.volumes[name=${n}].secret`)
    }
  }

  // containers + initContainers
  for (const collection of ['containers', 'initContainers'] as const) {
    const oldByName = listByName(get(o, ['spec', 'template', 'spec', collection]))
    const newByName = listByName(get(u, ['spec', 'template', 'spec', collection]))
    const names = new Set([...oldByName.keys(), ...newByName.keys()])
    for (const n of names) {
      const oc = (oldByName.get(n) ?? {}) as AnyObj
      const nc = (newByName.get(n) ?? {}) as AnyObj
      for (const f of ['command', 'args', 'securityContext', 'envFrom'] as const) {
        if (!deepEqual(oc[f], nc[f])) {
          violations.push(`spec.template.spec.${collection}[name=${n}].${f}`)
        }
      }
      // env[].valueFrom is immutable per env-var name; literal env[].value may be edited.
      const oEnv = new Map<string, unknown>()
      const nEnv = new Map<string, unknown>()
      const oArr = Array.isArray(oc.env) ? (oc.env as AnyObj[]) : []
      const nArr = Array.isArray(nc.env) ? (nc.env as AnyObj[]) : []
      for (const e of oArr) {
        if (typeof e?.name === 'string') oEnv.set(e.name, e.valueFrom)
      }
      for (const e of nArr) {
        if (typeof e?.name === 'string') nEnv.set(e.name, e.valueFrom)
      }
      const envNames = new Set([...oEnv.keys(), ...nEnv.keys()])
      for (const en of envNames) {
        if (!deepEqual(oEnv.get(en), nEnv.get(en))) {
          violations.push(
            `spec.template.spec.${collection}[name=${n}].env[name=${en}].valueFrom`
          )
        }
      }

      // Sensitive env name / value gating on the new env entries. Mirrors the
      // server-side isSensitiveEnvKey + checkSensitiveEnvValue checks so the
      // editor refuses to save credential material even when the env entry
      // was previously absent (i.e. a newly added env line).
      for (const e of nArr) {
        const en = typeof e?.name === 'string' ? e.name : ''
        if (!en) continue
        if (isSensitiveEnvKey(en) && e.value !== undefined) {
          violations.push(
            `spec.template.spec.${collection}[name=${n}].env[name=${en}] (sensitive credential name)`
          )
          continue
        }
        if (typeof e.value === 'string' && containsSensitiveEnvValue(e.value)) {
          violations.push(
            `spec.template.spec.${collection}[name=${n}].env[name=${en}] (value carries credential material)`
          )
        }
      }

      // volumeMounts[]: the security-sensitive sub-fields are frozen and
      // cannot be added/removed/changed via Apply. mountPath is also
      // additionally checked against a deny-list of sensitive container
      // paths (see isSensitiveMountPath below).
      const oVMs = listByName(oc.volumeMounts)
      const nVMs = listByName(nc.volumeMounts)
      const vmNames = new Set([...oVMs.keys(), ...nVMs.keys()])
      for (const vn of vmNames) {
        const oVM = (oVMs.get(vn) ?? {}) as AnyObj
        const nVM = (nVMs.get(vn) ?? {}) as AnyObj
        for (const f of ['mountPath', 'readOnly', 'subPath', 'subPathExpr', 'mountPropagation'] as const) {
          if (!deepEqual(oVM[f], nVM[f])) {
            violations.push(
              `spec.template.spec.${collection}[name=${n}].volumeMounts[name=${vn}].${f}`
            )
          }
        }
        const mp = (nVM.mountPath as string | undefined) ?? ''
        if (mp && isSensitiveMountPath(mp)) {
          violations.push(
            `spec.template.spec.${collection}[name=${n}].volumeMounts[name=${vn}].mountPath (sensitive container path)`
          )
        }
      }
    }
  }

  return violations
}

/**
 * Returns true if mp is a sensitive container path that must not be a
 * volumeMount target. Mirrors checkSensitiveMountPath() in the Go validator:
 * /dev is forbidden except for the explicit /dev/shm carve-out. The path is
 * canonicalised (POSIX path.Clean) before matching so that /etc//x,
 * /etc/./x, /etc/foo/.., and trailing-slash variants are all caught.
 */
function isSensitiveMountPath(mp: string): boolean {
  if (!mp) return false
  if (!mp.startsWith('/')) return true
  const clean = cleanPosixPath(mp)
  if (clean === '/') return true
  if (clean === '/dev') return true
  if (clean.startsWith('/dev/') && clean !== '/dev/shm' && !clean.startsWith('/dev/shm/')) return true
  const prefixes = [
    '/etc', '/bin', '/sbin',
    '/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin',
    '/lib', '/lib64', '/usr/lib', '/usr/lib64',
    '/boot', '/root', '/proc', '/sys',
    '/var/run', '/var/lib/kubelet', '/var/lib/docker', '/var/lib/containerd',
  ]
  for (const p of prefixes) {
    if (clean === p || clean.startsWith(p + '/')) return true
  }
  return false
}

/**
 * Minimal POSIX-style path canonicaliser. Equivalent to Go's path.Clean for
 * absolute inputs: collapses repeated slashes, resolves "." and ".."
 * segments, and strips trailing slashes (except for the root "/").
 */
function cleanPosixPath(p: string): string {
  const isAbs = p.startsWith('/')
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop()
      } else if (!isAbs) {
        parts.push('..')
      }
      continue
    }
    parts.push(seg)
  }
  const joined = parts.join('/')
  if (isAbs) return '/' + joined
  return joined === '' ? '.' : joined
}

/**
 * Convenience wrapper that parses two YAML strings and runs the diff.
 * Returns [] on parse failure - YAML-syntax errors are surfaced separately
 * by the editor's own YAML validation.
 */
export function diffForbiddenInYaml(
  originalYaml: string,
  newYaml: string
): string[] {
  try {
    const a = yaml.load(originalYaml)
    const b = yaml.load(newYaml)
    return diffForbiddenWorkloadFields(a, b)
  } catch {
    return []
  }
}

/**
 * Static list of paths the editor displays to the user as "locked" when a
 * workload-kind document is being edited. Used purely for UI affordance.
 */
export const LOCKED_WORKLOAD_FIELD_LABELS = [
  'metadata.uid / resourceVersion / creationTimestamp / generation',
  'spec.selector',
  'spec.template.metadata.labels',
  'spec.template.spec.securityContext',
  'spec.template.spec.imagePullSecrets',
  'spec.template.spec.volumes[].secret',
  'spec.template.spec.{containers,initContainers}[].command / args / securityContext / envFrom',
  'spec.template.spec.{containers,initContainers}[].env[].valueFrom',
  'spec.template.spec.{containers,initContainers}[].env[] (env names matching PASSWORD/SECRET/TOKEN/APIKEY/CREDENTIAL/PRIVATE_KEY/PASSPHRASE patterns, and env values that embed credentials such as proxy URLs with user:password@host or password=/token=/Bearer fragments)',
  'spec.template.spec.{containers,initContainers}[].volumeMounts[].{mountPath, readOnly, subPath, subPathExpr, mountPropagation} - mountPath must be under /home/sas and must not be a sensitive container path (/etc, /bin, /sbin, /usr/{bin,sbin,local/bin,local/sbin,lib,lib64}, /lib, /lib64, /boot, /root, /proc, /sys, /var/run, /var/lib/{kubelet,docker,containerd}, /dev except /dev/shm)',
  'status',
]

const SENSITIVE_ENV_KEY_SUBSTRINGS = [
  'PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'APIKEY', 'API_KEY',
  'CREDENTIAL', 'PRIVATE_KEY', 'PRIVKEY', 'PASSPHRASE',
]

export function isSensitiveEnvKey(name: string): boolean {
  if (!name) return false
  const up = name.toUpperCase()
  return SENSITIVE_ENV_KEY_SUBSTRINGS.some((s) => up.includes(s))
}

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // scheme://[user]:password@host
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:[^\s/@]+@/i,
  // password=, token=, secret=, api_key=, proxyPassword=, etc.
  /(?:^|[\s,;'"-])(?:[a-z_.]*)?(?:password|passwd|secret|token|apikey|api_key|credential|passphrase|privatekey|privkey|proxypassword|proxyuser)\s*[:=]\s*\S+/i,
  // Authorization: Bearer / Basic header values
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_\-=.]{8,}/i,
]

export function containsSensitiveEnvValue(v: string): boolean {
  if (!v || v.length < 8) return false
  return SENSITIVE_VALUE_PATTERNS.some((re) => re.test(v))
}

export function isWorkloadKind(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false
  const kind = (doc as AnyObj).kind
  return typeof kind === 'string' && WORKLOAD_KINDS.has(kind)
}
