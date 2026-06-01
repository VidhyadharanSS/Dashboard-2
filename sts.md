# Security Hardening: Commit Record

## Repository References

- **Current working repository (Zoho):** https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/source/security-hardening/KitesDashboard
- **Active branch:** `security-hardening`
- **Commit URL pattern:** `https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/<sha>`
- **Previous mirror (GitLab, no longer used for discussions):** https://git.csez.zohocorpin.com/vidhyadharan.ss/kite-dashboard/-/tree/feature/ui-font-language-update
- **Upstream baseline (cloned from):** https://git.csez.zohocorpin.com/ziax/kitesdashboard/-/tree/kites-core-v1
- **First commit by our team on top of the upstream baseline:** `2efa508` ("feat: Workload Topology Map & Terminal Stability Fixes"). Every commit from `2efa508` onwards is work done by our team for the Kites Dashboard feature.

## Commits (chronological)

### 1. `10db78a` docs: add security audit report

Added `SECURITY_AUDIT_REPORT.md` covering:

- The five audit findings: Secrets exposure, hostPath mounts, workload
  creation, env-from-secret injection, search and related-resources
  leakage.
- Permitted vs. excluded YAML fields for the apply endpoint.
- Threat model and verification steps.

### 2. `eb550ab` security: initial dashboard hardening

Removed the Secrets surface and disabled workload creation paths.

- Removed the Secrets list, detail, and topology routes from the UI.
- Removed the Secrets handler in `pkg/handlers/resources/handler.go` so
  `/api/v1/_/secrets/*` returns 404.
- Removed "Create Workload" actions on Deployment, StatefulSet, DaemonSet,
  Job, CronJob, and ReplicaSet list pages.
- First version of `validateWorkloadFields()` in
  `pkg/handlers/resource_apply_handler.go` gating the YAML apply endpoint.

### 3. `eddbc9b` security: remove remaining secrets references

Stripped lingering secret references that the first pass missed.

- `pkg/handlers/search_handler.go`: dropped `secrets` from the searchable
  resource set.
- `pkg/utils/search.go`: removed `secret`/`secrets` search aliases.
- `pkg/handlers/resources/related_resources.go`: removed the secret
  enumeration block, the `envFrom.secretRef` check, and the
  `volumes[].secret` check so secret names no longer leak through the
  related-resources API.
- `ui/src/pages/expression-search-page.tsx`: removed `secret`/`secrets`
  options from the resource-type selector.

### 4. `05f1d26` fix: RBAC table polish, remove tab logo

Tightened the RBAC management surface.

- `ui/src/components/settings/rbac-management.tsx`: scrollable column
  layout, working role filter for users.
- `pkg/model/user.go`: minor user-record adjustments to keep the role
  filter consistent.
- `ui/index.html`: removed the embedded brand logo from the tab title so
  the product name does not leak in the address bar.

### 5. `cbaddaf` fix: node label sort + pinned active, remove forced Zoho consent

- Node label panel: sort by usage count, pin the active label.
- OAuth: removed the forced Zoho consent prompt that was added by an
  earlier debug change.

### 6. `206c890` security(apply): refine workload field policy, permit hostPath

Rewrote `validateWorkloadFields()` against the agreed permit/exclude
spec and added a full unit-test suite.

Blocked fields:

- `metadata.uid`, `metadata.resourceVersion`, `metadata.creationTimestamp`
- `spec.selector`
- `spec.template.metadata.labels`
- `spec.template.spec.securityContext`
- `spec.template.spec.imagePullSecrets`
- `spec.template.spec.volumes[].secret`
- `containers[].command`, `containers[].args`,
  `containers[].securityContext`
- `containers[].env[].valueFrom` (any form: `secretKeyRef`,
  `configMapKeyRef`, `fieldRef`, `resourceFieldRef`). Only literal
  `env[].value` is permitted.
- `containers[].envFrom` (both `secretRef` and `configMapRef`).
- Same rules applied to `initContainers[]`.
- `status`.

Permitted (newly clarified):

- `spec.template.spec.volumes[].hostPath`. Required for worker-node
  integrations such as host log directories and container runtime
  sockets. Gated by per-object RBAC and audit-logged; production changes
  still require IDC change-process approval.

Removed: the previous `sensitiveHostPaths` prefix block on
`volumeMounts[].mountPath` which would also have rejected legitimate
ConfigMap mounts under `/etc/<app>/`.

Added: 25 unit tests in `pkg/handlers/validate_workload_fields_test.go`
covering every blocked and permitted field. Updated
`SECURITY_AUDIT_REPORT.md` to match.

### 7. `d2cb2d1` security(ui): strip /secrets from persisted sidebar, enforce policy in YAML editor

Closed two residual gaps reported during deployment.

Sidebar:

- Added `FORBIDDEN_SIDEBAR_URLS = {/secrets}` and `sanitizeSidebarConfig()`
  in `ui/src/contexts/sidebar-config-context.tsx`.
- `loadConfig()` now strips forbidden URLs from a user's stored
  `sidebar_preference` on every load and persists the cleaned copy back
  to the server. A dirty preference cannot resurrect a retired surface
  on next login.
- Bumped `CURRENT_CONFIG_VERSION` from 1 to 2.

YAML editor:

- Added `ui/src/lib/workload-policy.ts`, a client-side mirror of the
  server-side `validateWorkloadFields()`.
- `YamlEditor` freezes the initial YAML as a security baseline on first
  render. On Save, it diffs the new YAML against that baseline across
  the forbidden paths only and refuses to call `onSave` if any differ.
  The block applies regardless of the caller's role.
- Added an amber "Read-only fields" banner that lists the locked paths
  while the user is editing a workload kind, and a red panel that lists
  the violated paths when Save is blocked.

### 8. `6bf9495` ui: rebalance deployment overview, trim home overview, dark theme polish

Not a security fix; part of the same delivery. Also cherry-picked to
`main` as `3802b15`.

- `ui/src/pages/deployment-detail.tsx`: Overview tab rebalanced from a
  3-column 67/33 split to a 5-column 60/40 split. Moved Deployment
  Information, Resource Topology, and Conditions into the right column
  so both columns have similar height.
- `ui/src/pages/overview.tsx`: removed the Namespace Health, Recent
  Deployments, Deployment Rollback, and Quick Actions widgets from the
  home overview, along with their imports.
- `ui/src/styles/themes/default.css`: deeper dark-mode background,
  lifted card surface, stronger borders (10% to 14%), brighter
  muted-foreground (0.705 to 0.745).
- `ui/src/App.css`: dark-mode polish layer with inner highlight and
  outer shadow on cards, stronger focus rings, clearer table-row hover,
  sidebar and tab active-state contrast, softer input fills, global
  page-enter fade.

### 9. `9729ecc` security(apply): freeze volumeMount fields, deny sensitive mountPaths

Closed the review item on `volumeMount` tampering raised by Deneshraj.

Added to the YAML apply gate (server validator + client mirror):

- `volumeMounts[].subPath` and `subPathExpr`: forbidden. Re-binding
  sub-files into the container would shadow attacker-controlled content
  over privileged paths.
- `volumeMounts[].mountPropagation`: forbidden.
  `Bidirectional`/`HostToContainer` must not be selectable via Apply.
- `volumeMounts[].mountPath`: rejected when it falls under any sensitive
  container path: `/`, `/etc`, `/bin`, `/sbin`, `/usr/{bin,sbin,
  local/bin,local/sbin,lib,lib64}`, `/lib`, `/lib64`, `/boot`, `/root`,
  `/proc`, `/sys`, `/var/run`, `/var/lib/{kubelet,docker,containerd}`,
  `/dev`. Explicit carve-out for `/dev/shm`.
- `readOnly` and `mountPath` are diffed on the client against the
  frozen baseline so tampering with existing mounts is caught before
  save.

Note: a strict allow-list of `/home/sas/*` only would break legitimate
live workloads (assignbyzia mounts under `/home/zoho/`, `/dev/shm`, and
`/usr/tmp`). The deny-list achieves the same security objective while
keeping the existing Apply flow functional.

Tests: 35/35 `ValidateWorkloadFields_*` pass. UI build clean.

### 10. `8d3799a` security(apply): canonicalise mountPath, add bypass-attempt tests, mirror tests

Fixed a bypass in the mountPath deny-list.

Bug: the deny-list used raw string-prefix matching, so the following all
evaded the check while resolving to `/etc` on the kernel side:

- `//etc/passwd`
- `/etc//passwd`
- `/etc/./passwd`
- `/etc/foo/..`
- `/etc/` (trailing slash)

Fix: apply `path.Clean` (POSIX) on the server (`Go path.Clean`) and on
the client (`cleanPosixPath`) before the deny-list lookup. Reject any
non-absolute `mountPath` outright.

Tests added:

- Server: 6 new groups in `validate_workload_fields_test.go` covering
  the bypass table, relative mountPath, `/dev/shm` subdirectories,
  look-alike non-sensitive paths, initContainer parity, multi-mount
  cases, and a helper-level table for `checkSensitiveMountPath`.
- Client: new vitest suite `ui/src/lib/workload-policy.test.ts` with 22
  tests covering kind gating, metadata drift, selector/labels,
  securityContext/imagePullSecrets, `volumes[].secret`, container
  command/args/securityContext/envFrom, `env[].valueFrom`, the full
  volumeMount lock-down (frozen fields, mountPath edits,
  sensitive-path absolute check, all bypass attempts, `/dev/shm`
  carve-out, initContainer parity), the YAML wrapper, and the
  locked-field label list.

Cosmetic: renamed a local variable that shadowed the imported k8s
`api/meta` package.

Result: pkg/handlers 41/41 `ValidateWorkloadFields_*` and
`CheckSensitiveMountPath` pass. UI vitest 48/48. UI build clean.

### 11. `23a5756` security: block all resource creation, harden secret exposure, strengthen audit

Defense-in-depth pass closing the residual gaps from the review.

Secrets fully blocked:

- `pkg/handlers/resource_apply_handler.go`: new
  `isApplyKindForbidden()` guard rejects any `kind: Secret` at the top
  of `ApplyResource()` before RBAC and field checks. Backstops the
  absence of a Secret list/get/create route.
- `pkg/handlers/resources/related_resources.go`: dropped
  `*corev1.Secret` from the topology-discovery switch so secret names
  cannot be enumerated even with read access on a known Secret.
- `pkg/handlers/template_handler.go`: removed the Secret YAML template
  from `InitTemplates()` and purges any pre-seeded Secret template row
  from existing DBs on startup.
- `ui/src/components/volume-table.tsx`: renders
  `volume.secret.secretName` as inert text. Was a `/secrets/<ns>/<name>`
  link.
- Deleted orphaned `ui/src/pages/secret-list-page.tsx` and
  `ui/src/pages/secret-detail.tsx` (no router entry, but compiled into
  the bundle).

No resource creation via the dashboard:

- `pkg/handlers/resources/handler.go`: renamed
  `workloadCreateDisabled` to `resourceCreateDisabled` and extended it
  to every Kubernetes resource registered by the dashboard:
  pods/deployments/sts/ds/jobs/cronjobs/rs, configmaps/services/
  endpoints/endpointslices, pv/pvc, serviceaccounts/namespaces,
  ingresses/storageclasses, roles/rolebindings/clusterroles/
  clusterrolebindings, gateways/httproutes, hpa, crds. Every POST on
  `/resources/<kind>` returns 405.
- `pkg/handlers/resource_apply_handler.go::ApplyResource()`: refuses
  CREATE entirely. Any `generateName` is rejected; any name that does
  not resolve via `Get()` is rejected with "creation is disabled; only
  updates to pre-existing resources are permitted." Only UPDATE on
  existing resources continues to be allowed, subject to
  `validateWorkloadFields` and RBAC.

Strengthened audit logging:

- `pkg/middleware/rbac.go`: every RBAC denial is now audited (was:
  writes only). Reads on sensitive resources (`secrets`,
  `serviceaccounts`, RBAC kinds, `oauth-providers`, `apikeys`, `users`,
  `clusters`) escalate to `AuditWarning`. Ordinary read denials remain
  at `AuditInfo`. `RBAC_DENIED` security event always emitted.
- `pkg/handlers/resource_apply_handler.go`: per-object audit lines now
  emitted for `Apply` (INFO), `ApplyFailed` (ERROR), kind-forbidden
  rejection (WARN + `APPLY_KIND_FORBIDDEN`), field-policy rejection
  (WARN + `APPLY_FIELD_FORBIDDEN`), and create-blocked rejection (WARN
  + `APPLY_CREATE_BLOCKED`). All entries carry `name` and `sourceIP`
  via `logger.AuditOpts`. The aggregate end-of-apply line is retained.

Tests: pkg/handlers + pkg/handlers/resources + pkg/middleware all
green. New `TestIsApplyKindForbidden_RejectsSecret` and
`TestIsApplyKindForbidden_AllowsNonSecretKinds` added. UI vitest 48/48.
UI build clean.

## Final permitted vs. excluded field reference

For workload kinds `Deployment`, `StatefulSet`, `DaemonSet`.

Permitted (editable via Apply, subject to RBAC and client-side frozen
diff):

- `metadata.name`, `metadata.namespace`.
- `metadata.labels`, `metadata.annotations` (non-locked keys).
- `spec.replicas`, `spec.strategy`.
- `spec.template.spec.containers[].{image, ports, resources}`.
- `spec.template.spec.containers[].env[].value` (literal only).
- `spec.template.spec.containers[].{readinessProbe, livenessProbe,
  startupProbe, lifecycle}`.
- `spec.template.spec.containers[].volumeMounts[]` structural list.
  `mountPath`, `readOnly`, `subPath`, `subPathExpr`, `mountPropagation`
  are frozen per existing mount; `mountPath` is canonicalised and
  blocked under sensitive prefixes.
- `spec.template.spec.{volumes (non-secret), nodeSelector, tolerations,
  affinity, terminationGracePeriodSeconds, dnsPolicy, dnsConfig,
  restartPolicy, serviceAccountName, automountServiceAccountToken}`.

Excluded (rejected by `validateWorkloadFields` server-side and
`diffForbiddenWorkloadFields` client-side):

- `metadata.{uid, resourceVersion, creationTimestamp}`.
- `spec.selector`.
- `spec.template.metadata.labels`.
- `spec.template.spec.securityContext`.
- `spec.template.spec.imagePullSecrets`.
- `spec.template.spec.volumes[].secret`.
- `spec.template.spec.containers[].{command, args, securityContext}`.
- `spec.template.spec.containers[].env[].valueFrom` (any kind).
- `spec.template.spec.containers[].envFrom[].{secretRef, configMapRef}`.
- `spec.template.spec.containers[].volumeMounts[].{subPath,
  subPathExpr, mountPropagation}`.
- `mountPath` under any sensitive container path: `/`, `/etc`, `/bin`,
  `/sbin`, `/usr/{bin,sbin,local/bin,local/sbin,lib,lib64}`, `/lib`,
  `/lib64`, `/boot`, `/root`, `/proc`, `/sys`, `/var/run`,
  `/var/lib/{kubelet,docker,containerd}`, `/dev`. Explicit carve-out
  for `/dev/shm`.
- `status`.

Kind-level denies (rejected before field policy): `Secret`.

Resource-level denies: CREATE on every Kubernetes resource. Only
UPDATE of pre-existing resources is allowed.

## Verification

Build: `make build` (or `pnpm build` followed by `go build .`) completes
clean on the `security-hardening` tip.

Server tests:

```
go vet ./...
go test ./pkg/handlers/ ./pkg/handlers/resources/ ./pkg/middleware/
```

All packages pass. `ValidateWorkloadFields_*` and
`CheckSensitiveMountPath` total 41 server tests plus the two
`IsApplyKindForbidden_*` tests.

UI tests:

```
cd ui && pnpm test
```

48/48 passing (vitest).

Static checks: `go vet ./...` returns no findings.

API smoke test (non-superadmin caller):

```
curl -sk -X POST https://<host>/api/v1/resources/apply \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/yaml" \
  --data-binary '<deployment yaml with command: [sh]>' \
  -w "%{http_code}\n"
```

Expected: 400 with the message listing the forbidden field.

Sidebar verification: log in as a user whose `sidebar_preference`
predated the change. The Secrets item is gone on the first page render
and the cleaned preference is written back to the server.

YAML editor verification: open any Deployment, click Edit, modify
`metadata.resourceVersion` or add `command: [sh]` to a container, click
Save. The red violation panel appears, the request is not sent, and the
field path is listed.

Create-block verification: open any Deployment list page. The "Create"
button is gone. POST to `/api/v1/_/deployments/<ns>` returns 405. POST
to `/api/v1/resources/apply` with a new (non-existent) name returns the
"creation is disabled" message.

Secret-block verification: POST to `/api/v1/resources/apply` with a
`kind: Secret` body returns the `APPLY_KIND_FORBIDDEN` rejection. The
related-resources topology for any ConfigMap or PVC no longer includes
Secret nodes.
