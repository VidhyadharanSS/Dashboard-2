# Security Hardening: Commit Record

## Repository

- **Canonical repo (Zoho):** https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard
- **GitHub mirror:** https://github.com/VidhyadharanSS/Dashboard-2
- **Active branch:** `security-hardening`
- **Current HEAD:** `9ba2e42`

## Development tracking

The team imported the source via `git init` (not `git clone`), so this
repository has no shared ancestor with the upstream OSS history.
To make changes reviewable, the following annotated tags are published
on both remotes:

| Tag                      | Commit    | Date       | Marks |
|--------------------------|-----------|------------|-------|
| `baseline-upstream-oss`  | `2865610` | 2026-02-06 | Upstream `zxh326/kite` snapshot the internal `kites-core-v1` fork is built on. |
| `kites-team-start`       | `2efa508` | 2026-02-20 | Team divergence point (first team commit). |
| `kites-feature-complete` | `7c3ffe8` | 2026-04-13 | End of feature-development phase. |
| `security-phase-1`       | `eb550ab` | 2026-05-19 | Remove Secrets viewer, disable workload creation, restrict editable YAML fields. |
| `security-phase-2`       | `8d3799a` | 2026-05-23 | Freeze volumeMount fields, deny sensitive mountPaths, canonicalise + bypass-attempt tests. |
| `security-phase-3`       | `c93fe96` | 2026-05-29 | mountPath allow-list and sensitive env-KEY blocklist. |
| `security-phase-4`       | `41097e5` | 2026-05-29 | mountPath allow-list tightened to `/home/sas` only. |
| `security-phase-5`       | `8380d9e` | 2026-06-01 | Reject credential-bearing env VALUES; role-filter fix; audit-log expansion; UI polish. |
| `security-phase-6`       | `601b113` | 2026-06-01 | Documentation update for phase-5. |

Lineage:
`github.com/zxh326/kite` (upstream OSS)
-> `git.csez.zohocorpin.com/ziax/kitesdashboard` branch `kites-core-v1` (internal Zoho fork)
-> team `git init` import -> `kites-team-start` -> `kites-feature-complete` -> security phases 1-6 -> HEAD.

Earlier personal-fork branches (pre-team, out of scope for this review):

- https://github.com/VidhyadharanSS/kite/tree/feature/ui-font-language-update
- https://github.com/VidhyadharanSS/kite/tree/fix-sqlite-hostpath
- https://github.com/VidhyadharanSS/kite/tree/fix-websocket-proxy
- Squashed view: https://git.csez.zohocorpin.com/vidhyadharan.ss/kite-dashboard/-/commit/fa80a8740f9721fa096abc313a2a4c593934b42d

Going forward, every new hardening phase will land its own
`security-phase-N` annotated tag.

## Timeline at a glance

| # | Commit | Date | Summary |
|---|--------|------|---------|
| 1 | `10db78a` | 2026-05-18 | Add `SECURITY_AUDIT_REPORT.md` (findings + permit/exclude spec). |
| 2 | `eb550ab` | 2026-05-19 | Remove Secrets UI + handler, disable Create-Workload, first `validateWorkloadFields()`. |
| 3 | `eddbc9b` | 2026-05-20 | Remove residual secret references (search, related-resources, UI selector). |
| 4 | `05f1d26` | 2026-05-21 | RBAC table polish, tab-title logo removal. |
| 5 | `cbaddaf` | 2026-05-22 | Node label sort, remove forced Zoho OAuth consent prompt. |
| 6 | `206c890` | 2026-05-22 | Refine workload field policy, permit `hostPath`, add 25 unit tests. |
| 7 | `d2cb2d1` | 2026-05-23 | Sanitise persisted sidebar config, client-side YAML editor mirror. |
| 8 | `6bf9495` | 2026-05-23 | UI: deployment overview rebalance, dark-theme polish (non-security). |
| 9 | `9729ecc` | 2026-05-23 | Freeze `volumeMount` fields; deny sensitive `mountPath` prefixes. |
| 10 | `8d3799a` | 2026-05-23 | Canonicalise `mountPath`; add bypass-attempt tests; mirror in UI vitest. |
| 11 | `23a5756` | 2026-05-24 | Block all resource CREATE; kind-level deny `Secret`; expanded audit logging. |
| 12 | `c93fe96` | 2026-05-29 | `mountPath` allow-list + sensitive env-KEY blocklist. |
| 13 | `41097e5` | 2026-05-29 | Tighten `mountPath` allow-list to `/home/sas` only. |
| 14 | `8380d9e` | 2026-06-01 | Phase 6 fixes (see detail below). |
| 15 | `601b113` | 2026-06-01 | Phase 6 documentation. |

## Detailed change log

### 1. `10db78a` docs: add security audit report

Added `SECURITY_AUDIT_REPORT.md` covering the five audit findings
(Secrets exposure, hostPath mounts, workload creation, env-from-secret
injection, search/related-resources leakage), the permit/exclude spec
for the apply endpoint, and the threat model.

### 2. `eb550ab` security: initial dashboard hardening

- Removed Secrets list/detail/topology routes from the UI.
- Removed Secrets handler in `pkg/handlers/resources/handler.go`
  (`/api/v1/_/secrets/*` now returns 404).
- Removed "Create Workload" actions on Deployment, StatefulSet,
  DaemonSet, Job, CronJob, ReplicaSet list pages.
- First version of `validateWorkloadFields()` gating the YAML apply
  endpoint.

### 3. `eddbc9b` security: remove remaining secrets references

- `pkg/handlers/search_handler.go`: dropped `secrets` from the
  searchable resource set.
- `pkg/utils/search.go`: removed `secret`/`secrets` aliases.
- `pkg/handlers/resources/related_resources.go`: removed the secret
  enumeration block, `envFrom.secretRef` check, and `volumes[].secret`
  check.
- `ui/src/pages/expression-search-page.tsx`: removed `secret` options
  from the resource-type selector.

### 4. `05f1d26` fix: RBAC table polish, remove tab logo

- `ui/src/components/settings/rbac-management.tsx`: scrollable column
  layout, working role filter.
- `pkg/model/user.go`: minor user-record adjustments.
- `ui/index.html`: removed the brand logo from the tab title.

### 5. `cbaddaf` fix: node label sort + pinned active, remove forced Zoho consent

- Node label panel: sort by usage count, pin the active label.
- OAuth: removed the forced Zoho consent prompt added by an earlier
  debug change.

### 6. `206c890` security(apply): refine workload field policy, permit hostPath

Rewrote `validateWorkloadFields()` against the agreed permit/exclude
spec and added 25 unit tests in
`pkg/handlers/validate_workload_fields_test.go`.

Blocked: `metadata.{uid, resourceVersion, creationTimestamp}`,
`spec.selector`, `spec.template.metadata.labels`,
`spec.template.spec.securityContext`,
`spec.template.spec.imagePullSecrets`,
`spec.template.spec.volumes[].secret`,
`containers[].{command, args, securityContext}`,
`containers[].env[].valueFrom` (any kind),
`containers[].envFrom[].{secretRef, configMapRef}`, same on
`initContainers[]`, `status`.

Permitted: `volumes[].hostPath` (required for worker-node integrations;
gated by RBAC + audit, IDC change-process for production).

### 7. `d2cb2d1` security(ui): strip /secrets from persisted sidebar, enforce policy in YAML editor

- `ui/src/contexts/sidebar-config-context.tsx`: added
  `FORBIDDEN_SIDEBAR_URLS = {/secrets}` and `sanitizeSidebarConfig()`.
  `loadConfig()` strips forbidden URLs from stored `sidebar_preference`
  on every load. `CURRENT_CONFIG_VERSION` 1 -> 2.
- `ui/src/lib/workload-policy.ts`: client-side mirror of
  `validateWorkloadFields()`. `YamlEditor` freezes initial YAML as a
  security baseline; on Save it diffs against the baseline and refuses
  to call `onSave` if any forbidden path differs. Applies regardless
  of caller's role.
- Amber "Read-only fields" banner lists locked paths; red panel lists
  violated paths when Save is blocked.

### 8. `6bf9495` ui: rebalance deployment overview, dark-theme polish

Non-security; cherry-picked to `main` as `3802b15`. Overview tab
rebalanced to 5-column 60/40; home overview trimmed; dark-mode tokens
and card surfaces polished in `default.css` + `App.css`.

### 9. `9729ecc` security(apply): freeze volumeMount fields, deny sensitive mountPaths

Added to server validator + client mirror:

- `volumeMounts[].{subPath, subPathExpr, mountPropagation}`: forbidden.
- `volumeMounts[].mountPath`: rejected under sensitive container paths
  (`/`, `/etc`, `/bin`, `/sbin`, `/usr/{bin,sbin,local/bin,local/sbin,
  lib,lib64}`, `/lib`, `/lib64`, `/boot`, `/root`, `/proc`, `/sys`,
  `/var/run`, `/var/lib/{kubelet,docker,containerd}`, `/dev`). Carve-out
  for `/dev/shm`.
- `readOnly`/`mountPath` diffed client-side against the frozen baseline.

Tests: 35/35 `ValidateWorkloadFields_*` pass.

### 10. `8d3799a` security(apply): canonicalise mountPath, add bypass-attempt tests

Bug: raw string-prefix matching allowed `//etc/passwd`, `/etc//passwd`,
`/etc/./passwd`, `/etc/foo/..`, `/etc/` (trailing slash) to bypass the
deny-list while still resolving to `/etc` in the kernel.

Fix: `path.Clean` (POSIX) on server, `cleanPosixPath` on client, before
deny-list lookup. Reject any non-absolute `mountPath` outright.

Tests: 6 new groups in `validate_workload_fields_test.go` (bypass
table, relative path, `/dev/shm` subdirs, look-alike non-sensitive
paths, initContainer parity, multi-mount, helper-level
`checkSensitiveMountPath`). New vitest suite
`ui/src/lib/workload-policy.test.ts` with 22 tests. Result:
pkg/handlers 41/41 pass; UI vitest 48/48.

### 11. `23a5756` security: block all resource creation, harden secret exposure, strengthen audit

Secrets fully blocked:

- `resource_apply_handler.go::isApplyKindForbidden()` rejects any
  `kind: Secret` before RBAC and field checks.
- `related_resources.go`: dropped `*corev1.Secret` from
  topology-discovery switch.
- `template_handler.go`: removed Secret YAML template; purges
  pre-seeded Secret rows from existing DBs.
- `ui/src/components/volume-table.tsx`: renders
  `volume.secret.secretName` as inert text (was a link).
- Deleted orphaned `ui/src/pages/secret-list-page.tsx` and
  `secret-detail.tsx`.

No resource creation via the dashboard:

- `pkg/handlers/resources/handler.go`: `resourceCreateDisabled`
  extended to every registered Kubernetes resource. POST on
  `/resources/<kind>` returns 405.
- `ApplyResource()`: refuses CREATE. `generateName` rejected; unknown
  names rejected with "creation is disabled; only updates to
  pre-existing resources are permitted."

Strengthened audit logging:

- `middleware/rbac.go`: every RBAC denial audited (was writes only).
  Reads on sensitive resources (`secrets`, `serviceaccounts`, RBAC
  kinds, `oauth-providers`, `apikeys`, `users`, `clusters`) escalate
  to `AuditWarning`. `RBAC_DENIED` security event always emitted.
- `resource_apply_handler.go`: per-object audit lines for `Apply`
  (INFO), `ApplyFailed` (ERROR), kind-forbidden rejection (WARN +
  `APPLY_KIND_FORBIDDEN`), field-policy rejection (WARN +
  `APPLY_FIELD_FORBIDDEN`), create-blocked rejection (WARN +
  `APPLY_CREATE_BLOCKED`). All carry `name` + `sourceIP`.

### 12. `c93fe96` security(apply): mountPath allow-list + sensitive env-KEY blocklist

- Replaced the mountPath deny-list with an explicit allow-list (initial
  set: `/home/sas`, `/home/zoho`, `/dev/shm`, `/usr/tmp`, agreed
  application-data paths).
- Added env-KEY blocklist: case-insensitive match against `PASSWORD`,
  `PASSWD`, `SECRET`, `TOKEN`, `APIKEY`, `API_KEY`, `CREDENTIAL`,
  `PRIVATE_KEY`, `PRIVKEY`, `PASSPHRASE`. Mirrored client-side.

### 13. `41097e5` security(apply): tighten mountPath allow-list to `/home/sas` only

Reduced the allow-list to a single root: `/home/sas` (and subpaths).
All other previously-allowed roots removed after live workload audit
confirmed they were unused. Server + client + tests aligned.

### 14. `8380d9e` Phase 6 fixes (merged at `4a6debd`)

See "Phase 6 detail" section below.

### 15. `601b113` Phase 6 documentation

This file's Phase 6 section.

## Phase 6 detail (commit `8380d9e`)

### 6.1 Reject credential-bearing env VALUES on Apply

The env-KEY blocklist (phase 12) caught names but missed credentials
smuggled into the VALUE of a benign-named variable. Real examples:

- `http_proxy=http://kites:ct1kites-8090@172.20.95.189:8090`
- `JAVA_TOOL_OPTIONS=-Dhttp.proxyPassword=...`

`resource_apply_handler.go::checkSensitiveEnvValue` adds three regex
families:

1. `scheme://[user]:password@host` (proxy URLs, `jdbc://`, `redis://`,
   including no-user `redis://:pwd@`).
2. `(password|passwd|secret|token|apikey|api_key|credential|passphrase|privatekey|privkey|proxypassword|proxyuser)\s*[:=]\s*\S+`
   with leading `-`/`.` allowed, so `-Dhttp.proxyPassword=...` matches.
3. HTTP `Bearer <token>` / `Basic <b64>` headers.

Values shorter than 8 chars are skipped to avoid false positives. Same
regex set mirrored in
`ui/src/lib/workload-policy.ts::containsSensitiveEnvValue`. Tests:
`TestCheckSensitiveEnvValue_Table` + three integration tests.

### 6.2 Remove em-dashes from UI strings

All em-dash characters in `ui/src` (`.ts`, `.tsx`, `.css`) replaced
with regular hyphens. Verified: `grep -rln "—" ui/src` returns 0.

### 6.3 Expand audit logging coverage

Newly audited events:

- OAuth callback: `LoginFailed` for provider errors (`access_denied`
  etc.) at `WARNING`; for state/CSRF mismatch at `CRITICAL`;
  `LoginDenied` when authenticated user has no roles or disabled
  account, at `WARNING`.
- `Logout` at `INFO` with source IP.
- `RevokeSession` (self), `RevokeAllSessions` (self),
  `AdminRevokeSession` (admin), all with source IP and revoked-row
  count.
- Batch user delete: per-user entry with `Success` flag; failed deletes
  at `ERROR`.

### 6.4 Fix the role-filter bug in User Management

Symptom: filtering by role (e.g. "CRM DI - Role") returned "No users
found" while users clearly showed that role badge.

Root cause: legacy filter in `model/user.go::ListUsers` did a SQL JOIN
against `role_assignments` on `subject = users.username OR subject =
users.email`. Role badges come from `rbac/rbac.go::GetUserRoles` which
reads the in-memory `RBACConfig.RoleMapping` snapshot. The two paths
could disagree (OIDC-group-mapped membership not represented as a
direct user assignment).

Fix:

- New helper `rbac.SubjectsForRole(name)` returns subjects from the
  same snapshot the UI uses.
- `handlers/user_handler.go::ListUsers` resolves the role via that
  helper, then passes a `roleSubjects []string` parameter.
- `model.ListUsers` applies
  `WHERE users.username IN ? OR users.email IN ?` when `roleSubjects`
  is non-empty. A non-existent role yields sentinel
  `__kite_no_match__` so the DB returns zero rows instead of all rows.

### 6.5 Dark theme readability

`ui/src/styles/themes/default.css` `.dark` scope: `--popover` 0.215 ->
0.235; `--secondary` 0.28 -> 0.3; `--accent` 0.295 -> 0.32;
`--muted-foreground` 0.745 -> 0.785 (WCAG AA on dark cards); `--border`
14% -> 18%; `--input` 18% -> 22%; `--sidebar-border` 12% -> 16%.

## Permitted vs. excluded field reference

For `Deployment`, `StatefulSet`, `DaemonSet`.

**Permitted** (editable via Apply, subject to RBAC + client-side frozen
diff):

- `metadata.{name, namespace, labels (non-locked), annotations
  (non-locked)}`
- `spec.replicas`, `spec.strategy`
- `containers[].{image, ports, resources, readinessProbe,
  livenessProbe, startupProbe, lifecycle}`
- `containers[].env[].value` (literal only, must pass env-KEY and
  env-VALUE checks)
- `containers[].volumeMounts[]` structural list. `mountPath`,
  `readOnly`, `subPath`, `subPathExpr`, `mountPropagation` are frozen
  per existing mount; `mountPath` is canonicalised and restricted to
  the `/home/sas` allow-list.
- `spec.template.spec.{volumes (non-secret), nodeSelector, tolerations,
  affinity, terminationGracePeriodSeconds, dnsPolicy, dnsConfig,
  restartPolicy, serviceAccountName, automountServiceAccountToken}`

**Excluded** (rejected server-side and client-side):

- `metadata.{uid, resourceVersion, creationTimestamp}`
- `spec.selector`
- `spec.template.metadata.labels`
- `spec.template.spec.{securityContext, imagePullSecrets}`
- `spec.template.spec.volumes[].secret`
- `containers[].{command, args, securityContext}`
- `containers[].env[]` with: `valueFrom` (any kind), sensitive KEY
  pattern, or credential-bearing VALUE
- `containers[].envFrom[].{secretRef, configMapRef}`
- `containers[].volumeMounts[].{subPath, subPathExpr, mountPropagation}`
- `containers[].volumeMounts[].mountPath` outside the `/home/sas`
  allow-list
- `status`

**Kind-level denies:** `Secret`.

**Resource-level denies:** CREATE on every Kubernetes resource. Only
UPDATE of pre-existing resources is allowed.

## Verification

```
go vet ./pkg/... ./internal/... .
go test ./pkg/handlers/ ./pkg/handlers/resources/ \
        ./pkg/middleware/ ./pkg/rbac/ ./pkg/model/ -count=1
cd ui && pnpm test            # 48/48 vitest
pnpm build                    # succeeds
cd .. && go build .           # produces ./kite
```

Both remotes synchronized at the same SHA:

- origin (GitHub mirror): `security-hardening` -> `9ba2e42`
- zoho (Zoho repo):       `security-hardening` -> `9ba2e42`
