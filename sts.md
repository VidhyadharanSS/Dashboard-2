# Security Hardening: Commit Record

## Repository

- **Zoho (source of truth):** [KitesDashboard](https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard)
- **GitHub mirror:** [VidhyadharanSS/Dashboard-2](https://github.com/VidhyadharanSS/Dashboard-2)
- **Team branch:** [`security-hardening`](https://github.com/VidhyadharanSS/Dashboard-2/tree/security-hardening) — HEAD [`8534187`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8534187)
- **Baseline branch (cloned-from upstream OSS):** [`baseline/upstream-oss-pre-fork`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/upstream-oss-pre-fork) → [`zxh326/kite@2865610`](https://github.com/zxh326/kite/commit/2865610)
- **Internal pre-fork source:** [`ziax/kitesdashboard@kites-core-v1`](https://git.csez.zohocorpin.com/ziax/kitesdashboard/-/tree/kites-core-v1)

### Compare team work against the OSS baseline

```bash
git fetch origin
git log  origin/baseline/upstream-oss-pre-fork..origin/security-hardening
git diff origin/baseline/upstream-oss-pre-fork..origin/security-hardening
```

## Tags

Annotated tags are pushed to both remotes so each milestone is a stable
handle for `git log` / `git diff`.

| Tag | Commit | Date | Marks |
|---|---|---|---|
| [`baseline-upstream-oss`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/baseline-upstream-oss) | [`2865610`](https://github.com/zxh326/kite/commit/2865610) | 2026-02-06 | Upstream `zxh326/kite` snapshot. |
| [`kites-team-start`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-team-start) | [`2efa508`](https://github.com/VidhyadharanSS/Dashboard-2/commit/2efa508) | 2026-02-20 | First team commit. |
| [`kites-feature-complete`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-feature-complete) | [`7c3ffe8`](https://github.com/VidhyadharanSS/Dashboard-2/commit/7c3ffe8) | 2026-04-13 | End of feature development. |
| [`security-phase-1`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-1) | [`eb550ab`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eb550ab) | 2026-05-19 | Remove Secrets viewer; disable workload create; first YAML field restrictions. |
| [`security-phase-2`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-2) | [`8d3799a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8d3799a) | 2026-05-23 | Freeze `volumeMount` fields; deny sensitive `mountPaths` + canonicalise. |
| [`security-phase-3`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-3) | [`c93fe96`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c93fe96) | 2026-05-29 | `mountPath` allow-list + sensitive env-KEY blocklist. |
| [`security-phase-4`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-4) | [`41097e5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/41097e5) | 2026-05-29 | `mountPath` tightened to `/home/sas` only. |
| [`security-phase-5`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-5) | [`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e) | 2026-06-01 | Reject credential-bearing env VALUES; role-filter fix; audit-log expansion; dark theme. |
| [`security-phase-6`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/security-phase-6) | [`601b113`](https://github.com/VidhyadharanSS/Dashboard-2/commit/601b113) | 2026-06-01 | Documentation update for phase 5. |

Per-phase diff: `git log security-phase-N..security-phase-N+1`.

## Lineage

[`zxh326/kite`](https://github.com/zxh326/kite) (upstream)
→ [`baseline/upstream-oss-pre-fork`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/upstream-oss-pre-fork) / [`baseline-upstream-oss`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/baseline-upstream-oss)
→ [`ziax/kitesdashboard@kites-core-v1`](https://git.csez.zohocorpin.com/ziax/kitesdashboard/-/tree/kites-core-v1) (internal fork)
→ [`kites-team-start`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-team-start)
→ [`kites-feature-complete`](https://github.com/VidhyadharanSS/Dashboard-2/releases/tag/kites-feature-complete)
→ security phases 1–6
→ [`HEAD`](https://github.com/VidhyadharanSS/Dashboard-2/tree/security-hardening).

Earlier personal-fork branches (pre-team, mirrored as `baseline/personal-*`):

- [feature/ui-font-language-update](https://github.com/VidhyadharanSS/kite/tree/feature/ui-font-language-update) → [`baseline/personal-font-update`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/personal-font-update)
- [fix-sqlite-hostpath](https://github.com/VidhyadharanSS/kite/tree/fix-sqlite-hostpath) → [`baseline/personal-sqlite-hostpath`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/personal-sqlite-hostpath)
- [fix-websocket-proxy](https://github.com/VidhyadharanSS/kite/tree/fix-websocket-proxy) → [`baseline/personal-websocket-proxy`](https://github.com/VidhyadharanSS/Dashboard-2/tree/baseline/personal-websocket-proxy)
- [Squashed UI changes (internal GitLab)](https://git.csez.zohocorpin.com/vidhyadharan.ss/kite-dashboard/-/commit/fa80a8740f9721fa096abc313a2a4c593934b42d)

## Security-hardening commits

| Commit | Date | Summary |
|---|---|---|
| [`10db78a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/10db78a) | 2026-05-19 | docs: add `SECURITY_AUDIT_REPORT.md` |
| [`eb550ab`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eb550ab) | 2026-05-19 | Remove Secrets UI + handler; disable Create-Workload; first `validateWorkloadFields()` (**phase-1**) |
| [`eddbc9b`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eddbc9b) | 2026-05-19 | Remove residual secret references (search, related-resources, UI selector) |
| [`05f1d26`](https://github.com/VidhyadharanSS/Dashboard-2/commit/05f1d26) | 2026-05-19 | RBAC table polish; remove tab-title logo |
| [`cbaddaf`](https://github.com/VidhyadharanSS/Dashboard-2/commit/cbaddaf) | 2026-05-20 | Node label sort; remove forced Zoho OAuth consent prompt |
| [`206c890`](https://github.com/VidhyadharanSS/Dashboard-2/commit/206c890) | 2026-05-21 | Refine workload field policy; permit `hostPath`; +25 unit tests |
| [`d2cb2d1`](https://github.com/VidhyadharanSS/Dashboard-2/commit/d2cb2d1) | 2026-05-21 | Sanitise persisted sidebar config; client-side YAML editor mirror |
| [`6bf9495`](https://github.com/VidhyadharanSS/Dashboard-2/commit/6bf9495) | 2026-05-21 | UI: deployment overview rebalance; dark-theme polish (non-security) |
| [`9729ecc`](https://github.com/VidhyadharanSS/Dashboard-2/commit/9729ecc) | 2026-05-23 | Freeze `volumeMount` fields; deny sensitive `mountPath` prefixes |
| [`8d3799a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8d3799a) | 2026-05-23 | Canonicalise `mountPath`; bypass-attempt tests; UI vitest mirror (**phase-2**) |
| [`23a5756`](https://github.com/VidhyadharanSS/Dashboard-2/commit/23a5756) | 2026-05-23 | Block all resource CREATE; kind-level deny `Secret`; expanded audit logging |
| [`c93fe96`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c93fe96) | 2026-05-29 | `mountPath` allow-list + sensitive env-KEY blocklist (**phase-3**) |
| [`41097e5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/41097e5) | 2026-05-29 | Tighten `mountPath` allow-list to `/home/sas` only (**phase-4**) |
| [`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e) | 2026-06-01 | Env-VALUE blocklist; role-filter fix; audit expansion; dark theme; em-dash sweep (**phase-5**) |
| [`601b113`](https://github.com/VidhyadharanSS/Dashboard-2/commit/601b113) | 2026-06-01 | docs: phase 6 (**phase-6**) |

Feature-development commits (`kites-team-start` → `kites-feature-complete`,
27 commits) are visible with:

```bash
git log --oneline kites-team-start..kites-feature-complete
```

## What each security phase covers

**Phase 1 ([`eb550ab`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eb550ab))** — Removed Secrets list/detail/topology routes and the Secrets handler (`/api/v1/_/secrets/*` → 404); removed "Create Workload" actions on Deployment/StatefulSet/DaemonSet/Job/CronJob/ReplicaSet; introduced `validateWorkloadFields()` gating the YAML apply endpoint. Follow-ups: secret references stripped from search/related-resources/UI selector ([`eddbc9b`](https://github.com/VidhyadharanSS/Dashboard-2/commit/eddbc9b)); persisted sidebar sanitised and client-side YAML editor mirror added ([`d2cb2d1`](https://github.com/VidhyadharanSS/Dashboard-2/commit/d2cb2d1)).

**Phase 2 ([`8d3799a`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8d3799a))** — `volumeMounts[].{subPath, subPathExpr, mountPropagation}` forbidden; `mountPath` rejected under sensitive container paths (`/`, `/etc`, `/bin`, `/sbin`, `/usr/{bin,sbin,local/bin,local/sbin,lib,lib64}`, `/lib`, `/lib64`, `/boot`, `/root`, `/proc`, `/sys`, `/var/run`, `/var/lib/{kubelet,docker,containerd}`, `/dev`) with `/dev/shm` carve-out. `mountPath` canonicalised via `path.Clean` (server) and `cleanPosixPath` (client) to defeat `//etc`, `/etc//`, `/etc/./`, `/etc/foo/..`, trailing-slash bypasses. Pre-cursor commit [`9729ecc`](https://github.com/VidhyadharanSS/Dashboard-2/commit/9729ecc) introduced the field freeze; resource-CREATE deny + kind-level Secret deny added in [`23a5756`](https://github.com/VidhyadharanSS/Dashboard-2/commit/23a5756) (same window).

**Phase 3 ([`c93fe96`](https://github.com/VidhyadharanSS/Dashboard-2/commit/c93fe96))** — Replaced the `mountPath` deny-list with an explicit allow-list; added case-insensitive env-KEY blocklist (`PASSWORD`, `PASSWD`, `SECRET`, `TOKEN`, `APIKEY`, `API_KEY`, `CREDENTIAL`, `PRIVATE_KEY`, `PRIVKEY`, `PASSPHRASE`). Mirrored client-side.

**Phase 4 ([`41097e5`](https://github.com/VidhyadharanSS/Dashboard-2/commit/41097e5))** — `mountPath` allow-list reduced to a single root: `/home/sas` (and subpaths) after live-workload audit.

**Phase 5 ([`8380d9e`](https://github.com/VidhyadharanSS/Dashboard-2/commit/8380d9e))**

- *Env-VALUE blocklist:* `checkSensitiveEnvValue` rejects three patterns — `scheme://[user]:password@host` (proxy URLs, `jdbc://`, `redis://`), `(password|passwd|secret|token|apikey|api_key|credential|passphrase|privatekey|privkey|proxypassword|proxyuser)\s*[:=]\s*\S+` (with leading `-`/`.` allowed, catches `-Dhttp.proxyPassword=…`), and HTTP `Bearer <token>` / `Basic <b64>` headers. Values shorter than 8 chars skipped. Mirrored client-side as `containsSensitiveEnvValue`.
- *Audit expansion:* OAuth `LoginFailed` (`WARNING`) / state-CSRF mismatch (`CRITICAL`) / `LoginDenied` (`WARNING`); `Logout` (`INFO`); `RevokeSession`, `RevokeAllSessions`, `AdminRevokeSession` with source IP and revoked-row count; per-user entries for batch delete (`ERROR` on failure).
- *Role-filter fix:* `rbac.SubjectsForRole(name)` reads the same in-memory `RBACConfig.RoleMapping` snapshot the UI uses for badges; `model.ListUsers` filters via `WHERE users.username IN ? OR users.email IN ?`, sentinel `__kite_no_match__` for empty/unknown roles.
- *Dark theme:* `default.css` `.dark`: `--popover` 0.215→0.235, `--secondary` 0.28→0.3, `--accent` 0.295→0.32, `--muted-foreground` 0.745→0.785 (WCAG AA), `--border` 14→18%, `--input` 18→22%, `--sidebar-border` 12→16%.
- *Em-dash sweep:* all em-dashes removed from `ui/src`. Verified: `grep -rln "—" ui/src` → 0.

**Phase 6 ([`601b113`](https://github.com/VidhyadharanSS/Dashboard-2/commit/601b113))** — Documentation update for phase 5 (this file).

## Permitted vs. excluded fields

For `Deployment`, `StatefulSet`, `DaemonSet` on the YAML Apply endpoint
(subject to RBAC and client-side frozen-baseline diff).

**Permitted**

- `metadata.{name, namespace, labels (non-locked), annotations (non-locked)}`
- `spec.replicas`, `spec.strategy`
- `containers[].{image, ports, resources, readinessProbe, livenessProbe, startupProbe, lifecycle}`
- `containers[].env[].value` (literal only, must pass env-KEY and env-VALUE checks)
- `containers[].volumeMounts[]` structure; `mountPath`, `readOnly`, `subPath`, `subPathExpr`, `mountPropagation` frozen per existing mount; `mountPath` canonicalised and restricted to `/home/sas` allow-list
- `spec.template.spec.{volumes (non-secret), nodeSelector, tolerations, affinity, terminationGracePeriodSeconds, dnsPolicy, dnsConfig, restartPolicy, serviceAccountName, automountServiceAccountToken}`

**Excluded**

- `metadata.{uid, resourceVersion, creationTimestamp}`
- `spec.selector`, `spec.template.metadata.labels`
- `spec.template.spec.{securityContext, imagePullSecrets}`
- `spec.template.spec.volumes[].secret`
- `containers[].{command, args, securityContext}`
- `containers[].env[]` with `valueFrom`, sensitive KEY pattern, or credential-bearing VALUE
- `containers[].envFrom[].{secretRef, configMapRef}`
- `containers[].volumeMounts[].{subPath, subPathExpr, mountPropagation}`
- `containers[].volumeMounts[].mountPath` outside `/home/sas`
- `status`

**Kind-level deny:** `Secret`.
**Resource-level deny:** CREATE on every Kubernetes resource (UPDATE-only on pre-existing).

## Verification

```bash
go vet ./pkg/... ./internal/... .
go test ./pkg/handlers/ ./pkg/handlers/resources/ \
        ./pkg/middleware/ ./pkg/rbac/ ./pkg/model/ -count=1
cd ui && pnpm test     # 48/48 vitest
pnpm build             # ok
cd .. && go build .    # ./kite
```

Both remotes are in sync — see HEAD link at the top of this file.
