# Kites Dashboard

A Kubernetes dashboard for managing and observing clusters. Go backend,
React + TypeScript frontend, embedded Monaco editor.

## What it does

- Workload management: Deployments, StatefulSets, DaemonSets, Jobs,
  CronJobs, Pods.
- Cluster resources: Nodes, Namespaces, Services, Ingresses, Gateways,
  HTTPRoutes, ConfigMaps, PVs and PVCs, Storage Classes, HPAs.
- RBAC: Roles, RoleBindings, ClusterRoles, ClusterRoleBindings, Service
  Accounts.
- Live pod logs with filtering, exec into containers via a browser
  terminal, kube-proxy access to in-cluster services.
- Multi-cluster context switching with encrypted kubeconfig storage.
- Prometheus integration for CPU, memory, network, and node metrics.
- OAuth2 sign-in (including Zoho OAuth) and application-level RBAC on top
  of cluster RBAC.

## Repository layout

```
main.go                 Entry point.
pkg/                    Backend.
  auth/                 OAuth providers, session handling.
  cluster/              Multi-cluster manager, kubeconfig storage.
  handlers/             HTTP handlers (resources, terminal, logs, apply).
  kube/                 Client, exec, log, proxy, websocket helpers.
  middleware/           Access log, RBAC, security headers, metrics.
  model/                GORM models, encrypted-string column type.
  prometheus/           Query helpers.
  rbac/                 Application RBAC engine.
internal/load.go        DB bootstrap and seed.
ui/                     React frontend (Vite + Tailwind + shadcn).
charts/kite/            Helm chart.
deploy/                 install.yaml, ingress, service manifests.
docs/                   User and operator docs.
```

## Build and run

Prerequisites: Go 1.25+, Node 20+, pnpm.

```
make build              # builds UI then backend; outputs ./kite
./kite                  # serves on :8080
```

Manual build:

```
cd ui && pnpm install --frozen-lockfile && pnpm build && cd ..
go build -o kite .
```

Docker:

```
docker build -t kite:local .
docker run --rm -p 8080:8080 kite:local
```

Kubernetes:

```
kubectl apply -f deploy/install.yaml
kubectl port-forward -n kube-system svc/kite 8080:8080
```

Helm:

```
helm install kite charts/kite -n kite-system --create-namespace
```

## Configuration

All configuration is via environment variables. The full list is in
`docs/config/env.md`. The variables required to bring up a production
deployment are:

```
DB_TYPE                 sqlite | postgres | mysql
DB_DSN                  driver-specific DSN
ENCRYPTION_KEY          32-byte base64; used to encrypt kubeconfigs,
                        OAuth client secrets, and API keys at rest
JWT_SECRET              session-token signing key
OAUTH_PROVIDERS         comma-separated list of providers to enable
KUBECONFIG              optional, for the bootstrap cluster
```

A sample users file for local development is at `sample-users.json`.

## Branches

- `main`: full-featured build.
- `security-hardening`: production build with the Secrets surface
  removed, workload creation disabled, and the YAML apply endpoint
  restricted to a fixed permit-list. See `sts.md` for the per-commit
  record and `SECURITY_AUDIT_REPORT.md` for the audit findings and the
  permit/exclude field list.

## Tests

```
go test ./...
cd ui && pnpm test
```

The YAML apply policy is locked by 25 unit tests in
`pkg/handlers/validate_workload_fields_test.go`. They run as part of the
default `go test ./...` suite.

## License

Apache-2.0. See `LICENSE`.

