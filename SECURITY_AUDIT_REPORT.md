# Kite Dashboard — Security Audit Report

**Prepared by:** Vidhyadharan S S  
**Submitted to:** CRM Security Team  
**Date:** May 11, 2026  
**Repo:** https://git.csez.zohocorpin.com/vidhyadharan.ss/kite-dashboard/

---

## Context

The CRM Security Team initiated an audit in November 2025 after identifying critical vulnerabilities in the Kite Dashboard. This report summarises each finding and its remediation.

**Domain request background:** A `kites.zohointernals.*` domain request is pending IDC/Network Security (Bhargava S) approval, conditional on completing this audit. Key clarifications provided:
- Kite Dashboard is a **separate, read-only** inspection UI — distinct from the already-approved Kite AppServer.
- Two roles: **superadmin** (4 internal members, full access) and **service owner** (read-only, own namespaces only).
- Login via **Zoho OAuth2**; Zero Trust is the first-layer gateway in IDC.
- OAuth credentials are injected as **Kubernetes Secrets** — not hardcoded. Kubeconfig files are encrypted with `KITE_ENCRYPT_KEY`.

### Admin Bootstrap: Before vs. Now

**Before:** After first deploy, a superadmin had to manually log into the dashboard and create the OAuth provider configuration and kubeconfig entries through the admin UI before anyone else could log in. This was a manual, error-prone step with no audit trail.

**Now (deployment-driven bootstrap):** The OAuth provider and superadmin identity are fully configured via **environment variables injected at deployment time** (Kubernetes Secrets). On startup, the server reads `KITE_OAUTH_BOOTSTRAP_*` vars to register the OAuth provider automatically. The `KITE_SUPERADMIN_EMAILS` var holds a comma-separated list of superadmin email addresses. When any of those users log in via OAuth for the first time, they are **automatically promoted to the admin role** — no manual step required. This promotion is audit-logged at `CRITICAL` severity. Password-based superuser creation is blocked when OAuth bootstrap is active.

**Email-based user creation:** In addition to OAuth, admins can create internal users directly via the user management API — by providing a `username` + `email` (no password required for email-only accounts) or `username` + `password`. This allows pre-registering service owners before they log in via OAuth.

---

## OAuth Authentication Flow

### Step-by-step flow (Zoho OAuth2 / any configured provider)

```
Browser                         Kite Backend                    OAuth Provider (Zoho)
  |                                   |                                   |
  |-- GET /api/auth/providers ------->|                                   |
  |<-- ["zoho"] ----------------------|                                   |
  |                                   |                                   |
  |-- GET /api/auth/login             |                                   |
  |   ?provider=zoho ---------------->|                                   |
  |         Clear stale oauth_state   |                                   |
  |         Generate 32-byte random   |                                   |
  |         state (base64url)         |                                   |
  |         Set cookies:              |                                   |
  |           oauth_state  (15 min)   |                                   |
  |           oauth_provider (15 min) |                                   |
  |         SameSite=Lax, Secure(TLS) |                                   |
  |<-- { auth_url, provider } --------|                                   |
  |                                   |                                   |
  |-- Redirect to auth_url ------------------------------------------------>|
  |                                                  User authenticates     |
  |<-- Redirect to /api/auth/callback?code=...&state=... ------------------|
  |                                   |                                   |
  |-- GET /api/auth/callback -------->|                                   |
  |   ?code=...&state=...             |  Read oauth_provider cookie        |
  |                                   |  Read oauth_state cookie           |
  |                                   |  Validate: state param == cookie   |
  |                                   |  (CSRF protection — reject if mismatch) |
  |                                   |  Clear oauth_state + oauth_provider cookies |
  |                                   |-- Exchange code for token -------->|
  |                                   |<-- { access_token, refresh_token } |
  |                                   |-- GET userinfo (access_token) ---->|
  |                                   |<-- { sub, email, name, groups }   |
  |                                   |                                   |
  |                                   |  Upsert user in DB (sub-based)    |
  |                                   |  Check KITE_SUPERADMIN_EMAILS:    |
  |                                   |    if match → auto-promote admin  |
  |                                   |    audit-log at CRITICAL severity |
  |                                   |  Load RBAC roles for user         |
  |                                   |  Reject if no roles assigned      |
  |                                   |  Reject if account disabled       |
  |                                   |  Sign JWT (HS256, 24h expiry):    |
  |                                   |    { user_id, username, provider, |
  |                                   |      refresh_token, iat, exp }    |
  |                                   |  Set auth_token cookie            |
  |                                   |    HttpOnly, SameSite=Lax,        |
  |                                   |    Secure (when behind HTTPS)     |
  |                                   |  Create session record (IP, UA)   |
  |                                   |  Audit-log: OAuth login           |
  |<-- Redirect to / (dashboard) ----|                                   |
```

### Per-request authentication (after login)

Every protected API request goes through `RequireAuth()`:

1. **API Key** — if `Authorization: kite<key>` header is present, split `id-key`, fetch DB record, constant-time compare (`hmac.Equal`), reject if disabled. Logged on rejection.
2. **JWT cookie** — read `auth_token` cookie, validate HS256 signature + expiry.
   - If expired but within refresh window: call OAuth provider `refresh_token` grant → get new `access_token` → re-fetch user info → issue new JWT → silently rotate cookie.
   - If invalid/expired and no refresh available: clear cookie, return `401`.
3. Re-fetch user from DB on every request — ensures disabled accounts are rejected immediately even with a valid JWT.
4. RBAC roles are loaded fresh for the request.
5. Session `last_used_at` updated in DB.

### Security properties of the flow

| Property | Implementation |
|---|---|
| CSRF protection | 32-byte random `state` param; validated against `HttpOnly` cookie before code exchange |
| Authorization code injection | State mismatch → immediate reject + cookie clear |
| Provider error handling | `?error=` from provider surfaces as redirect error, not a crash |
| Stale session cookies | Cleared before each new OAuth flow starts |
| Token storage | HTTP-only cookie (not `localStorage`) — not accessible to JS |
| JWT signing | HS256 with server-side secret; unexpected algorithm rejected |
| Expired token refresh | Transparent rotation via OAuth refresh_token; new JWT issued |
| Account disable enforcement | DB lookup on every request — disabled flag honoured in real time |
| Login failures | Generic error messages — no user existence oracle (same message for unknown user and bad password) |
| Failed attempts | Security-logged (`LOGIN_FAILED_UNKNOWN_USER`, `LOGIN_FAILED_BAD_PASSWORD`, `LOGIN_FAILED_DISABLED`) |
| Logout | `auth_token` cookie cleared server-side |

---

## Findings & Remediation

### 1. Unrestricted YAML → Cluster Takeover | **Resolved**

**Finding:** Any user could submit arbitrary YAML (privileged containers, hostPath volumes, cluster-admin resources).

**Fix:**
- Workload creation is **template-only** — users pick from pre-approved templates, no freeform YAML.
- Container edit UI is limited to **3 safe fields**: image tag/pull policy, CPU/memory limits & requests, environment variables. `command`, `args`, `volumes`, `volumeMounts`, and `securityContext` have no UI surface.
- Superadmin YAML apply: each object is individually parsed, field-validated, and **per-object RBAC-checked** before reaching the Kubernetes API. Blocked objects are audit-logged.

> **Pending:** Scope of environment variable editing (e.g. restricting sensitive keys) to be reviewed with security team.

---

### 2. Host-to-Container Mounts | **Mitigated**

**Finding:** `hostPath` volumes could expose host filesystem (e.g. `/etc`, `/proc`, `/root`).

**Fix:** Volume configuration is not exposed in the UI. `hostPath` is permitted via superadmin YAML apply for legitimate worker-node integrations (e.g. host log directories, container runtime sockets) but is gated by per-object RBAC and audit-logged. Any new hostPath mount on a production cluster requires IDC change-process approval.

---

### 3. Cluster-Admin Service Account | **Resolved**

**Finding:** The `kite` service account had cluster-admin privileges — pod compromise = full cluster takeover.

**Fix:** Service account scoped to **minimal read/watch permissions** only. Write operations on behalf of users are gated by the application-level RBAC engine, independent of the service account.

---

### 4. Kubernetes CA Certificate Exposed to Browser | **Resolved**

**Finding:** The cluster CA cert was being sent to the frontend, exposing internal PKI material.

**Fix:** CA cert is no longer transmitted to the browser. The backend retains all cluster credentials; the browser receives only session tokens and role metadata.

---

### 5. Secrets Visible in Plain Text in UI | **Resolved**

**Finding:** Kubernetes Secret values were rendered as plain decoded text in the UI.

**Fix:** Secret values are **masked by default** and not transmitted to the frontend. Access to secret data is gated by RBAC.

---

## Security Controls (Current State)

### Authentication & Session

| Control | Detail |
|---|---|
| Login | Zoho OAuth2; password login optional (disabled via config) |
| Password storage | bcrypt; strength enforced (min 8 chars, upper + lower + digit) |
| Timing-safe comparison | `hmac.Equal` for password checks |
| Session tokens | JWT, validated on every request |
| CSRF protection | OAuth `state` param generated per login, validated on callback |
| Cookies | `SameSite=Lax`; `Secure` when behind HTTPS; stale cookies cleared before new flow |
| Login rate limit | 10 attempts / 5 min / IP |

### RBAC

- Per-request role check before forwarding to Kubernetes API.
- Roles scope **clusters, namespaces, resources, and verbs**.
- Denied write operations are audit-logged with user, verb, resource, namespace, cluster, and source IP.
- OIDC group-based role assignment supported.

### HTTP Security Headers

`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Content-Security-Policy: default-src 'self'` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy` (geolocation, mic, camera, USB disabled) · `Cross-Origin-Opener-Policy: same-origin` · `Strict-Transport-Security` (HTTPS only)

### CORS

Origin locked to the configured `HOST` value. Requests from any other origin receive no CORS header and are blocked by the browser.

### Audit Logging

Structured logs (JSON or plain text) for all mutating operations and RBAC denials. Fields: user, action, resource, name, namespace, cluster, timestamp, duration, source IP, success/failure. Denied writes also written to a dedicated security log.

### Secret Encryption at Rest

OAuth client secrets stored in DB are encrypted with **AES-256-GCM** (random nonce). Key supplied via environment variable, never stored alongside ciphertext.

---

## Superadmin YAML Modification — Permitted Fields

The following table lists the fields superadmins are permitted to modify via YAML apply. All other fields are either immutable, security-sensitive, or managed exclusively by the Kites orchestration layer.

### `spec` — Workload Behaviour

| Field | Use Case |
|---|---|
| `spec.replicas` | Scale the number of running pod replicas up or down |
| `spec.progressDeadlineSeconds` | Increase the timeout window for slow rollouts (e.g. large image pulls) |
| `spec.revisionHistoryLimit` | Control how many old ReplicaSets are retained for rollback |
| `spec.strategy.type` | Switch between `RollingUpdate` and `Recreate` for deployments |
| `spec.strategy.rollingUpdate.maxUnavailable` | Tune rolling update availability guarantee |
| `spec.strategy.rollingUpdate.maxSurge` | Tune how many extra pods are created during a rolling update |

### `spec.template.spec` — Pod Configuration

| Field | Use Case |
|---|---|
| `spec.template.spec.terminationGracePeriodSeconds` | Adjust graceful shutdown window for pods (e.g. long-running requests) |
| `spec.template.spec.nodeSelector` | Pin pods to a specific node pool (e.g. `kites.zoho.com/nodepool-common`) |
| `spec.template.spec.dnsPolicy` | Change DNS resolution policy if service discovery issues arise |
| `spec.template.spec.restartPolicy` | Change pod restart behaviour (`Always`, `OnFailure`) |

### `spec.template.spec.containers[]` — Container Configuration

| Field | Use Case |
|---|---|
| `image` | Update the container image tag for a hotfix or version rollback |
| `imagePullPolicy` | Change to `Always` / `IfNotPresent` to control image refresh behaviour |
| `ports[].containerPort` | Update the port the container listens on if the application port changes |
| `resources.limits.cpu` | Cap CPU consumption to prevent noisy-neighbour issues |
| `resources.limits.memory` | Cap memory to trigger OOM rather than node-level instability |
| `resources.requests.cpu` | Adjust CPU reservation for scheduler placement decisions |
| `resources.requests.memory` | Adjust memory reservation for scheduler placement decisions |
| `env[].value` (non-credential vars only) | Update proxy settings, feature flags, or app config values — e.g. `http_proxy`, `JAVA_TOOL_OPTIONS`, `APP_UID` |
| `readinessProbe.initialDelaySeconds` | Delay probe start for slow-starting services |
| `readinessProbe.periodSeconds` | Adjust how frequently readiness is polled |
| `readinessProbe.failureThreshold` | Allow more failures before marking pod unready |
| `readinessProbe.timeoutSeconds` | Increase probe timeout for slow health endpoints |
| `livenessProbe.*` | Same tunables as readiness — adjust for application restart thresholds |
| `stdin` / `tty` | Enable interactive terminal access for debugging |

### `spec.template.spec.volumes[]` — Permitted Volume Types

| Allowed Volume Type | Use Case |
|---|---|
| `emptyDir` | Temporary scratch space, shared memory (`/dev/shm`), log buffers |
| `configMap` | Mount application config files (e.g. `app.properties`, `webapp.xml`) |
| `hostPath` | Host-node integrations (e.g. host log directories, runtime sockets) — superadmin-only, audit-logged |

### `metadata` — Labels & Annotations (Non-Selector)

| Field | Use Case |
|---|---|
| `metadata.labels` (non-selector labels) | Update tracking labels such as `imageVersion`, `CommitAuthor`, `globalCommitId` |
| `metadata.annotations` | Update operational annotations (e.g. `kite.kubernetes.io/rolledBackAt`) |

---

### Explicitly Excluded Fields (Security-Sensitive or Immutable)

| Field | Reason |
|---|---|
| `spec.template.spec.containers[].command` / `args` | Arbitrary command execution — blocked per security audit finding #1 |
| `spec.template.spec.containers[].securityContext` | Controls privilege escalation, UID, root filesystem — must not be user-editable |
| `spec.template.spec.securityContext` | Pod-level security context |
| `spec.template.spec.volumes[].secret` | Direct secret mounting — exposure risk |
| `spec.template.spec.imagePullSecrets` | Registry credentials — managed by Kites infra only |
| `spec.selector` / `spec.template.metadata.labels` (selector labels) | Immutable after creation — changes break the ReplicaSet association |
| `metadata.uid` / `metadata.resourceVersion` / `metadata.creationTimestamp` | Kubernetes-managed immutable fields |
| `status.*` | Read-only — set by the Kubernetes control plane |
| `env[].valueFrom` (secretKeyRef / configMapKeyRef) | Secret/credential injection — only literal `env[].value` is permitted |
| `envFrom` (secretRef / configMapRef) | Bulk env import from external resources — only literal `env[].value` is permitted |

---

## Open Items

| Item | Status |
|---|---|
| Audit log forwarding to ZohoLogs | In Progress |
| Security team sign-off on approved templates | Pending |
| Review env-var editing scope in container edit UI | Pending |
| IDC domain approval (`kites.zohointernals.*`) | Pending this report |
