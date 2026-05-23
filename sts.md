# Security Hardening - Commit Record

Repository: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard
Branch: security-hardening


## Commits

### 1. eb550ab - Initial dashboard hardening

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/eb550ab

Removed the Secrets surface and disabled workload creation paths.

Changes:
- Removed the Secrets list, detail, and topology routes from the UI.
- Removed the Secrets handler from `pkg/handlers/resources/handler.go` so
  `/api/v1/_/secrets/*` returns 404.
- Removed "Create Workload" actions for Deployment, StatefulSet, DaemonSet,
  Job, CronJob, and ReplicaSet list pages.
- First version of `validateWorkloadFields()` in
  `pkg/handlers/resource_apply_handler.go` to gate YAML apply.

### 2. eddbc9b - Remove remaining secrets references

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/eddbc9b

Stripped lingering secret references the first pass missed.

Changes:
- `pkg/handlers/search_handler.go`: dropped "secrets" from the searchable
  resource set.
- `pkg/utils/search.go`: removed "secret" and "secrets" search aliases.
- `pkg/handlers/resources/related_resources.go`: removed the secret
  enumeration block, the envFrom.secretRef check, and the volumes[].secret
  check, so secret names no longer leak through the related-resources API.
- `ui/src/pages/expression-search-page.tsx`: removed the "secret"/"secrets"
  options from the resource-type selector.

### 3. 10db78a - Security audit report

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/10db78a

Added `SECURITY_AUDIT_REPORT.md` documenting:
- The five audit findings (Secrets exposure, hostPath mounts, workload
  creation, env-from-secret injection, search/related-resources leakage)
  and their mitigations.
- The list of permitted and excluded YAML fields for the apply endpoint.
- The threat model and verification steps.

### 4. 05f1d26 - RBAC table polish

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/05f1d26

Tightened the RBAC management surface.

Changes:
- `ui/src/components/settings/rbac-management.tsx`: scrollable column
  layout, working role filter for users.
- `pkg/model/user.go`: minor user-record adjustments to keep the role
  filter consistent.
- `ui/index.html`: removed the embedded brand logo from the tab title to
  avoid leaking the product name in the address bar.

### 5. 206c890 - Refine validateWorkloadFields, permit hostPath

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/206c890

Rewrote `validateWorkloadFields()` against the agreed permit/exclude
spec and added a full unit-test suite.

Excluded (blocked) fields:
- `metadata.uid`, `metadata.resourceVersion`, `metadata.creationTimestamp`
- `spec.selector`
- `spec.template.metadata.labels`
- `spec.template.spec.securityContext`
- `spec.template.spec.imagePullSecrets`
- `spec.template.spec.volumes[].secret`
- `containers[].command`, `containers[].args`,
  `containers[].securityContext`
- `containers[].env[].valueFrom` (any form: secretKeyRef, configMapKeyRef,
  fieldRef, resourceFieldRef). Only literal `env[].value` is permitted.
- `containers[].envFrom` (both secretRef and configMapRef)
- Same rules applied to `initContainers[]`
- `status`

Permitted (newly clarified):
- `spec.template.spec.volumes[].hostPath`. Required for worker-node
  integrations such as host log directories and container runtime sockets.
  Gated by per-object RBAC and audit-logged; production changes still
  require IDC change-process approval.

Removed: the previous overly aggressive `sensitiveHostPaths` prefix block
on `volumeMounts[].mountPath` which would also have rejected legitimate
ConfigMap mounts under `/etc/<app>/`.

Added: 25 unit tests in `pkg/handlers/validate_workload_fields_test.go`
covering every blocked and permitted field. Updated
`SECURITY_AUDIT_REPORT.md` to match.

Files changed:
- `pkg/handlers/resource_apply_handler.go`
- `pkg/handlers/validate_workload_fields_test.go` (new)
- `SECURITY_AUDIT_REPORT.md`

### 6. d2cb2d1 - Strip /secrets from persisted sidebar, enforce policy in YAML editor

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/d2cb2d1

Closed two residual gaps reported during deployment.

Sidebar:
- Added `FORBIDDEN_SIDEBAR_URLS = {/secrets}` and `sanitizeSidebarConfig()`
  in `ui/src/contexts/sidebar-config-context.tsx`.
- `loadConfig()` now strips forbidden URLs from a user's stored
  `sidebar_preference` on every load and persists the cleaned copy back to
  the server. A dirty preference cannot resurrect a retired surface on the
  next login.
- Bumped `CURRENT_CONFIG_VERSION` from 1 to 2.

YAML editor:
- Added `ui/src/lib/workload-policy.ts`, a client-side mirror of the
  server-side `validateWorkloadFields()`.
- `YamlEditor` freezes the initial YAML as a security baseline on first
  render. On Save, it diffs the new YAML against that baseline across the
  forbidden paths only and refuses to call `onSave` if any differ. The
  block applies regardless of the caller's role.
- Added an amber "Read-only fields" banner that lists the locked paths
  while the user is editing a workload kind, and a red panel that lists
  the exact violated paths when Save is blocked.

Files changed:
- `ui/src/components/yaml-editor.tsx`
- `ui/src/contexts/sidebar-config-context.tsx`
- `ui/src/lib/workload-policy.ts` (new)

### 7. 6bf9495 - UI rebalance and dark-theme polish

URL: https://repository.zohocorpcloud.in/zohocorp/user/Vidhya_Dharan/KitesDashboard#/commit/6bf9495

Not strictly a security fix but part of the same delivery; also
cherry-picked to `main` as commit `3802b15`.

Changes:
- `ui/src/pages/deployment-detail.tsx`: rebalanced the Overview tab from
  a 3-column 67/33 split to a 5-column 60/40 split. Moved Deployment
  Information, Resource Topology, and Conditions from the left column to
  the right so both columns have similar height.
- `ui/src/pages/overview.tsx`: removed the Namespace Health, Recent
  Deployments, Deployment Rollback, and Quick Actions widgets from the
  home overview along with their imports.
- `ui/src/styles/themes/default.css`: deeper dark-mode background, lifted
  card surface, stronger borders (10 percent to 14 percent), brighter
  muted-foreground (0.705 to 0.745).
- `ui/src/App.css`: dark-mode polish layer with inner highlight and outer
  shadow on cards, stronger focus rings, clearer table-row hover,
  sidebar and tab active-state contrast, softer input fills, and a global
  page-enter fade.

## Verification

Build: `make build` (or `pnpm build` + `go build .`) completes clean on
the security-hardening tip.

Tests: `go test ./pkg/handlers/ -run ValidateWorkloadFields -v` passes
all 25 cases.

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

Sidebar verification: log in as a user whose `sidebar_preference` predated
the change. The Secrets item is gone on the first page render and the
cleaned preference is written back to the server.

YAML editor verification: open any Deployment, click Edit, modify
`metadata.resourceVersion` or add `command: [sh]` to a container, click
Save. The red violation panel appears, the request is not sent, and the
field path is listed.

