# Security Hardening: Commit Record

## Repository

- **Canonical repository (Zoho):** [KitesDashboard](https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard)
- **GitHub mirror:** [VidhyadharanSS/Dashboard-2](https://github.com/VidhyadharanSS/Dashboard-2)
- **Active branch (team work):** [`security-hardening`](https://github.com/VidhyadharanSS/Dashboard-2/tree/security-hardening) — current HEAD [`400c9ba`](https://github.com/VidhyadharanSS/Dashboard-2/commit/400c9ba)
- **Pre-fork baseline branch (OSS upstream snapshot):** [`baseline/upstream-oss-pre-fork`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/upstream-oss-pre-fork) — points at upstream commit [`2865610`](https://github.com/zxh326/kite/commit/2865610) from [zxh326/kite](https://github.com/zxh326/kite). This is the cloned-from reference; diff `baseline/upstream-oss-pre-fork..security-hardening` for the full team delta.
- **Internal pre-fork source (Zoho fork before team handover):** [`ziax/kitesdashboard@kites-core-v1`](https://git.csez.zohocorpin.com/ziax/kitesdashboard/-/tree/kites-core-v1)

### Comparing branches

```bash
git fetch origin
git log  origin/baseline/upstream-oss-pre-fork..origin/security-hardening   # commits added by the team
git diff origin/baseline/upstream-oss-pre-fork..origin/security-hardening   # full content diff vs OSS baseline
```

Per-phase comparisons (tags described in the next section):

```bash
git log security-phase-1..security-phase-2
git log security-phase-2..security-phase-3
git log security-phase-3..security-phase-4
git log security-phase-4..security-phase-5
```

## Development tracking

Annotated tags are published on both remotes so each milestone has a
stable, immutable handle for `git log` and `git diff`.

| Tag                                                                                                                | Commit                                                                                                            | Date       | Marks |
|--------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|------------|-------|
| [`baseline-upstream-oss`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/baseline-upstream-oss)        | [`2865610`](https://github.com/zxh326/kite/commit/2865610)                                                        | 2026-02-06 | Upstream `zxh326/kite` snapshot that the internal `kites-core-v1` fork is built on. |
| [`kites-team-start`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-team-start)                  | [`2efa508`](https://github.com/VidhyadharanSS/Dashboard-2/commit/2efa508)                                         | 2026-02-20 | First team commit. Everything reachable from `HEAD` but not from this tag is team work. |
| [`kites-feature-complete`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-feature-complete)      | [`7c3ffe8`](https://github.com/VidhyadharanSS/Dashboard-2/commit/7c3ffe8)                                         | 2026-04-13 | End of feature-development phase. |
| [`security-phase-1`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-1)                  | [`eb550ab`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eb550ab)                                         | 2026-05-19 | Remove Secrets viewer, disable workload creation, restrict editable YAML fields. |
| [`security-phase-2`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-2)                  | [`8d3799a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8d3799a)                                         | 2026-05-23 | Freeze `volumeMount` fields, deny sensitive `mountPaths`, canonicalise + bypass-attempt tests. |
| [`security-phase-3`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-3)                  | [`c93fe96`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c93fe96)                                         | 2026-05-29 | `mountPath` allow-list and sensitive env-KEY blocklist. |
| [`security-phase-4`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-4)                  | [`41097e5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/41097e5)                                         | 2026-05-29 | `mountPath` allow-list tightened to `/home/sas` only. |
| [`security-phase-5`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-5)                  | [`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e)                                         | 2026-06-01 | Reject credential-bearing env VALUES; role-filter fix; audit-log expansion; UI polish. |
| [`security-phase-6`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-6)                  | [`601b113`](https://github.com/VidhyadharanSS/Dashboard-2/commit/601b113)                                         | 2026-06-01 | Documentation update for phase 5. |

**Lineage:**
[`zxh326/kite`](https://github.com/zxh326/kite) (upstream OSS, snapshot
published as branch [`baseline/upstream-oss-pre-fork`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/upstream-oss-pre-fork)
and tag [`baseline-upstream-oss`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/baseline-upstream-oss))
→ [`ziax/kitesdashboard@kites-core-v1`](https://git.csez.zohocorpin.com/ziax/kitesdashboard/-/tree/kites-core-v1) (internal Zoho fork)
→ [`kites-team-start`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-team-start)
→ [`kites-feature-complete`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-feature-complete)
→ security phases 1-6
→ [`HEAD`](https://github.com/VidhyadharanSS/Dashboard-2/tree/security-hardening).

Earlier personal-fork branches (pre-team, retained for history; also
published on the GitHub mirror as `baseline/personal-*` branches):

- [feature/ui-font-language-update](https://github.com/VidhyadharanSS/kite/tree/feature/ui-font-language-update) → mirrored as [`baseline/personal-font-update`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/personal-font-update)
- [fix-sqlite-hostpath](https://github.com/VidhyadharanSS/kite/tree/fix-sqlite-hostpath) → mirrored as [`baseline/personal-sqlite-hostpath`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/personal-sqlite-hostpath)
- [fix-websocket-proxy](https://github.com/VidhyadharanSS/kite/tree/fix-websocket-proxy) → mirrored as [`baseline/personal-websocket-proxy`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/personal-websocket-proxy)
- [Squashed UI changes (internal GitLab mirror)](https://git.csez.zohocorpin.com/vidhyadharan.ss/kite-dashboard/-/commit/fa80a8740f9721fa096abc313a2a4c593934b42d)

Every new hardening phase will land its own `security-phase-N`
annotated tag on both remotes.

## Timeline

### Feature-development phase ([`kites-team-start`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-team-start) → [`kites-feature-complete`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-feature-complete))

| Commit | Date | Summary |
|--------|------|---------|
| [`2efa508`](https://github.com/VidhyadharanSS/Dashboard-2/commit/2efa508) | 2026-02-20 | feat: Workload Topology Map & Terminal Stability Fixes (team-start) |
| [`c90644a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c90644a) | 2026-02-20 | Update README.md with Kites branding and feature roadmap |
| [`da46c0f`](https://github.com/VidhyadharanSS/Dashboard-2/commit/da46c0f) | 2026-03-12 | KITES: UI Changes |
| [`8295716`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8295716) | 2026-03-13 | Audit logging enhanced |
| [`6bbdee5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/6bbdee5) | 2026-03-13 | Resolved warnings |
| [`a46260e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/a46260e) | 2026-03-13 | WebSocket issues rectified |
| [`1963516`](https://github.com/VidhyadharanSS/Dashboard-2/commit/1963516) | 2026-03-13 | Theme changes |
| [`67e8e5c`](https://github.com/VidhyadharanSS/Dashboard-2/commit/67e8e5c) | 2026-03-13 | Terminal handler changes |
| [`be55e5a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/be55e5a) | 2026-03-13 | Terminal fixes |
| [`496ae4f`](https://github.com/VidhyadharanSS/Dashboard-2/commit/496ae4f) | 2026-03-13 | Logs issue |
| [`3aae016`](https://github.com/VidhyadharanSS/Dashboard-2/commit/3aae016) | 2026-03-15 | Node terminal removal |
| [`f9c16e1`](https://github.com/VidhyadharanSS/Dashboard-2/commit/f9c16e1) | 2026-03-18 | Backend changes |
| [`9579a4a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/9579a4a) | 2026-03-18 | Import issues |
| [`920113f`](https://github.com/VidhyadharanSS/Dashboard-2/commit/920113f) | 2026-03-18 | Backend enhancement |
| [`ca4f7c6`](https://github.com/VidhyadharanSS/Dashboard-2/commit/ca4f7c6) | 2026-03-18 | Bug fixes |
| [`a4937e4`](https://github.com/VidhyadharanSS/Dashboard-2/commit/a4937e4) | 2026-03-18 | Frontend enhancement |
| [`73f16e6`](https://github.com/VidhyadharanSS/Dashboard-2/commit/73f16e6) | 2026-03-18 | UI changes |
| [`53b9f61`](https://github.com/VidhyadharanSS/Dashboard-2/commit/53b9f61) | 2026-03-19 | Frontend changes |
| [`db1c460`](https://github.com/VidhyadharanSS/Dashboard-2/commit/db1c460) | 2026-03-19 | Topology changes |
| [`acaee06`](https://github.com/VidhyadharanSS/Dashboard-2/commit/acaee06) | 2026-03-19 | Search handler changes |
| [`2709031`](https://github.com/VidhyadharanSS/Dashboard-2/commit/2709031) | 2026-03-19 | Sidebar changes |
| [`1a4b601`](https://github.com/VidhyadharanSS/Dashboard-2/commit/1a4b601) | 2026-03-20 | Backend improvement |
| [`13930c6`](https://github.com/VidhyadharanSS/Dashboard-2/commit/13930c6) | 2026-03-25 | Prometheus integration |
| [`cce908c`](https://github.com/VidhyadharanSS/Dashboard-2/commit/cce908c) | 2026-03-25 | Prometheus integration (cont.) |
| [`6b54aa4`](https://github.com/VidhyadharanSS/Dashboard-2/commit/6b54aa4) | 2026-04-02 | fix: migrate WebSocket from `golang.org/x/net/websocket` to `gorilla/websocket` |
| [`bf0515f`](https://github.com/VidhyadharanSS/Dashboard-2/commit/bf0515f) | 2026-04-09 | Dashboard enhancements |
| [`7c3ffe8`](https://github.com/VidhyadharanSS/Dashboard-2/commit/7c3ffe8) | 2026-04-13 | Dashboard changes done (feature-complete) |

### Security-hardening phase ([`kites-feature-complete`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-feature-complete) → [`HEAD`](https://github.com/VidhyadharanSS/Dashboard-2/tree/security-hardening))

| Commit | Date | Summary |
|--------|------|---------|
| [`10db78a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/10db78a) | 2026-05-19 | docs: add `SECURITY_AUDIT_REPORT.md` (findings + permit/exclude spec) |
| [`eb550ab`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eb550ab) | 2026-05-19 | Remove Secrets UI + handler, disable Create-Workload, first `validateWorkloadFields()` (**security-phase-1**) |
| [`eddbc9b`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eddbc9b) | 2026-05-19 | Remove residual secret references (search, related-resources, UI selector) |
| [`05f1d26`](https://github.com/VidhyadharanSS/Dashboard-2/commit/05f1d26) | 2026-05-19 | RBAC table polish, tab-title logo removal |
| [`cbaddaf`](https://github.com/VidhyadharanSS/Dashboard-2/commit/cbaddaf) | 2026-05-20 | Node label sort, remove forced Zoho OAuth consent prompt |
| [`206c890`](https://github.com/VidhyadharanSS/Dashboard-2/commit/206c890) | 2026-05-21 | Refine workload field policy, permit `hostPath`, add 25 unit tests |
| [`d2cb2d1`](https://github.com/VidhyadharanSS/Dashboard-2/commit/d2cb2d1) | 2026-05-21 | Sanitise persisted sidebar config, client-side YAML editor mirror |
| [`6bf9495`](https://github.com/VidhyadharanSS/Dashboard-2/commit/6bf9495) | 2026-05-21 | UI: deployment overview rebalance, dark-theme polish (non-security) |
| [`dde6a94`](https://github.com/VidhyadharanSS/Dashboard-2/commit/dde6a94) | 2026-05-21 | Update commit history record |
| [`5fcdfe5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/5fcdfe5) | 2026-05-21 | Update README.md |
| [`9729ecc`](https://github.com/VidhyadharanSS/Dashboard-2/commit/9729ecc) | 2026-05-23 | Freeze `volumeMount` fields; deny sensitive `mountPath` prefixes |
| [`8d3799a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8d3799a) | 2026-05-23 | Canonicalise `mountPath`; add bypass-attempt tests; mirror in UI vitest (**security-phase-2**) |
| [`23a5756`](https://github.com/VidhyadharanSS/Dashboard-2/commit/23a5756) | 2026-05-23 | Block all resource CREATE; kind-level deny `Secret`; expanded audit logging |
| [`2cc22f8`](https://github.com/VidhyadharanSS/Dashboard-2/commit/2cc22f8) | 2026-05-23 | Merge `zoho/security-hardening`: README + commit history updates |
| [`8f4bca8`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8f4bca8) | 2026-05-25 | docs: resolve stash conflicts and refresh commit history |
| [`c93fe96`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c93fe96) | 2026-05-29 | `mountPath` allow-list + sensitive env-KEY blocklist (**security-phase-3**) |
| [`41097e5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/41097e5) | 2026-05-29 | Tighten `mountPath` allow-list to `/home/sas` only (**security-phase-4**) |
| [`dff3cdf`](https://github.com/VidhyadharanSS/Dashboard-2/commit/dff3cdf) | 2026-06-01 | docs(sts): add repository references |
| [`0c50b6b`](https://github.com/VidhyadharanSS/Dashboard-2/commit/0c50b6b) | 2026-06-01 | docs: update `sts.md` |
| [`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e) | 2026-06-01 | Phase 6 fixes: env-VALUE blocklist; role-filter fix; audit expansion; dark-theme polish; em-dash sweep (**security-phase-5**) |
| [`4a6debd`](https://github.com/VidhyadharanSS/Dashboard-2/commit/4a6debd) | 2026-06-01 | Merge `zoho/security-hardening` |
| [`601b113`](https://github.com/VidhyadharanSS/Dashboard-2/commit/601b113) | 2026-06-01 | docs(sts): document Phase 6 fixes (**security-phase-6**) |
| [`bfb0d1e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/bfb0d1e) | 2026-06-01 | docs(sts): add development tracking guide; tag baseline and phases |
| [`9ba2e42`](https://github.com/VidhyadharanSS/Dashboard-2/commit/9ba2e42) | 2026-06-01 | docs(sts): trim development tracking section |
| [`7d286dd`](https://github.com/VidhyadharanSS/Dashboard-2/commit/7d286dd) | 2026-06-01 | docs(sts): restructure with timeline-at-a-glance and tighter detail |

## Detailed change log

### [`10db78a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/10db78a) docs: add security audit report

Added `SECURITY_AUDIT_REPORT.md` covering the five audit findings
(Secrets exposure, hostPath mounts, workload creation, env-from-secret
injection, search/related-resources leakage), the permit/exclude spec
for the apply endpoint, and the threat model.

### [`eb550ab`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eb550ab) security: initial dashboard hardening (security-phase-1)

- Removed Secrets list/detail/topology routes from the UI.
- Removed Secrets handler in `pkg/handlers/resources/handler.go`
  (`/api/v1/_/secrets/*` now returns 404).
- Removed "Create Workload" actions on Deployment, StatefulSet,
  DaemonSet, Job, CronJob, ReplicaSet list pages.
- First version of `validateWorkloadFields()` gating the YAML apply
  endpoint.

### [`eddbc9b`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eddbc9b) security: remove remaining secrets references

- `pkg/handlers/search_handler.go`: dropped `secrets` from the
  searchable resource set.
- `pkg/utils/search.go`: removed `secret`/`secrets` aliases.
- `pkg/handlers/resources/related_resources.go`: removed the secret
  enumeration block, `envFrom.secretRef` check, and `volumes[].secret`
  check.
- `ui/src/pages/expression-search-page.tsx`: removed `secret` options
  from the resource-type selector.

### [`05f1d26`](https://github.com/VidhyadharanSS/Dashboard-2/commit/05f1d26) fix: RBAC table polish, remove tab logo

- `ui/src/components/settings/rbac-management.tsx`: scrollable column
  layout, working role filter.
- `pkg/model/user.go`: minor user-record adjustments.
- `ui/index.html`: removed the brand logo from the tab title.

### [`cbaddaf`](https://github.com/VidhyadharanSS/Dashboard-2/commit/cbaddaf) fix: node label sort + pinned active, remove forced Zoho consent

- Node label panel: sort by usage count, pin the active label.
- OAuth: removed the forced Zoho consent prompt added by an earlier
  debug change.

### [`206c890`](https://github.com/VidhyadharanSS/Dashboard-2/commit/206c890) security(apply): refine workload field policy, permit hostPath

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

### [`d2cb2d1`](https://github.com/VidhyadharanSS/Dashboard-2/commit/d2cb2d1) security(ui): strip /secrets from persisted sidebar, enforce policy in YAML editor

- `ui/src/contexts/sidebar-config-context.tsx`: added
  `FORBIDDEN_SIDEBAR_URLS = {/secrets}` and `sanitizeSidebarConfig()`.
  `loadConfig()` strips forbidden URLs from stored `sidebar_preference`
  on every load. `CURRENT_CONFIG_VERSION` 1 → 2.
- `ui/src/lib/workload-policy.ts`: client-side mirror of
  `validateWorkloadFields()`. `YamlEditor` freezes initial YAML as a
  security baseline; on Save it diffs against the baseline and refuses
  to call `onSave` if any forbidden path differs. Applies regardless
  of caller's role.
- Amber "Read-only fields" banner lists locked paths; red panel lists
  violated paths when Save is blocked.

### [`6bf9495`](https://github.com/VidhyadharanSS/Dashboard-2/commit/6bf9495) ui: rebalance deployment overview, dark-theme polish

Non-security; cherry-picked to `main` as
[`3802b15`](https://github.com/VidhyadharanSS/Dashboard-2/commit/3802b15).
Overview tab rebalanced to 5-column 60/40; home overview trimmed;
dark-mode tokens and card surfaces polished in `default.css` +
`App.css`.

### [`9729ecc`](https://github.com/VidhyadharanSS/Dashboard-2/commit/9729ecc) security(apply): freeze volumeMount fields, deny sensitive mountPaths

Added to server validator + client mirror:

- `volumeMounts[].{subPath, subPathExpr, mountPropagation}`: forbidden.
- `volumeMounts[].mountPath`: rejected under sensitive container paths
  (`/`, `/etc`, `/bin`, `/sbin`, `/usr/{bin,sbin,local/bin,local/sbin,
  lib,lib64}`, `/lib`, `/lib64`, `/boot`, `/root`, `/proc`, `/sys`,
  `/var/run`, `/var/lib/{kubelet,docker,containerd}`, `/dev`). Carve-out
  for `/dev/shm`.
- `readOnly`/`mountPath` diffed client-side against the frozen baseline.

Tests: 35/35 `ValidateWorkloadFields_*` pass.

### [`8d3799a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8d3799a) security(apply): canonicalise mountPath, add bypass-attempt tests (security-phase-2)

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

### [`23a5756`](https://github.com/VidhyadharanSS/Dashboard-2/commit/23a5756) security: block all resource creation, harden secret exposure, strengthen audit

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

### [`c93fe96`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c93fe96) security(apply): mountPath allow-list + sensitive env-KEY blocklist (security-phase-3)

- Replaced the mountPath deny-list with an explicit allow-list (initial
  set: `/home/sas`, `/home/zoho`, `/dev/shm`, `/usr/tmp`, agreed
  application-data paths).
- Added env-KEY blocklist: case-insensitive match against `PASSWORD`,
  `PASSWD`, `SECRET`, `TOKEN`, `APIKEY`, `API_KEY`, `CREDENTIAL`,
  `PRIVATE_KEY`, `PRIVKEY`, `PASSPHRASE`. Mirrored client-side.

### [`41097e5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/41097e5) security(apply): tighten mountPath allow-list to `/home/sas` only (security-phase-4)

Reduced the allow-list to a single root: `/home/sas` (and subpaths).
All other previously-allowed roots removed after live-workload audit
confirmed they were unused. Server + client + tests aligned.

### [`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e) Phase 6 fixes (security-phase-5)

See "Phase 6 detail" section below. Merged into the branch at
[`4a6debd`](https://github.com/VidhyadharanSS/Dashboard-2/commit/4a6debd).

### [`601b113`](https://github.com/VidhyadharanSS/Dashboard-2/commit/601b113) docs(sts): document Phase 6 fixes (security-phase-6)

Documentation update for Phase 6 in this file.

## Phase 6 detail ([`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e))

### 6.1 Reject credential-bearing env VALUES on Apply

The env-KEY blocklist (phase 3) caught names but missed credentials
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

`ui/src/styles/themes/default.css` `.dark` scope: `--popover` 0.215 →
0.235; `--secondary` 0.28 → 0.3; `--accent` 0.295 → 0.32;
`--muted-foreground` 0.745 → 0.785 (WCAG AA on dark cards); `--border`
14% → 18%; `--input` 18% → 22%; `--sidebar-border` 12% → 16%.

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

- origin (GitHub mirror): [`security-hardening` → HEAD](https://github.com/VidhyadharanSS/Dashboard-2/tree/security-hardening)
- zoho (Zoho repo): [`security-hardening` → HEAD](https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/source/security-hardening/KitesDashboard)
