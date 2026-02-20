# Kites - Modern Kubernetes Dashboard

<div align="center">

### _A modern, intuitive Kubernetes dashboard for developers and operators_

[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?style=flat&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19+-61DAFB?style=flat&logo=react)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Apache-green.svg)](LICENSE)

</div>

**Kites** is a lightweight, high-performance Kubernetes dashboard designed to provide a seamless interface for managing and monitoring clusters. It features real-time metrics, advanced multi-cluster support, and deep workload visualization.

## ✨ Key Features

### 🎨 **Visualization & UX**
- 🕸️ **Workload Topology Map** - Intuitively visualize relationships between Services, Deployments, and Pods to understand cluster structure at a glance.
- 🌓 **Multi-Theme Support** - Dark/light/color themes including specialized themes like "Claude" and "Dark Matter".
- 🔍 **Global Search** - Instant search across all namespaces and resource types.
- 📱 **Responsive Design** - Full functionality across desktop and mobile browsers.

### 🚀 **Stable Observability**
- 💻 **High-Volume Web Terminal** - Robust terminal support with built-in flow control and buffering, allowing stable **3000+ line pastes** into editors like `vi` without data loss.
- 📊 **Real-time Metrics** - Live CPU, memory, and network usage tracking.
- 📝 **Smart Log Streaming** - Real-time pod log streaming with powerful search and filtering capabilities.
- 📈 **DCGM Integration** - Support for GPU metrics and node-level performance monitoring.

### 🏘️ **Cluster Management**
- 🔄 **Multi-Cluster Contexts** - Seamlessly switch between different environments using encrypted kubeconfig storage.
- 🔌 **Kube Proxy** - Access internal pod services directly through the dashboard without local `kubectl port-forward`.
- ⚙️ **Resource Operations** - Create, scale, restart, and live-edit YAML with a built-in Monaco editor.
- 🏷️ **Image Tag Selector** - Quickly update container images via automated tag discovery.

### 🔐 **Security & RBAC**
- 🛡️ **OAuth2 Integration** - Enterprise-ready authentication support (including Zoho OAuth).
- 🔒 **Fine-grained RBAC** - Application-level permission management to control who can view or edit specific resources.
- 👥 **User Management** - Centralized management of roles and access keys.

---

## 🚀 Quick Start

### Docker
Run Kites as a standalone container:
```bash
docker run --rm -p 8080:8080 kites-dashboard:latest
```

### Deploy in Kubernetes
1. **Apply deployment manifests**
   ```bash
   kubectl apply -f deploy/install.yaml
   ```
2. **Access via port-forward**
   ```bash
   kubectl port-forward -n kube-system svc/kites 8080:8080
   ```

### Build from Source
1. **Clone and Install Dependencies**
   ```bash
   git clone <repo-url>
   cd kites
   make deps
   ```
2. **Build and Run**
   ```bash
   make build
   make run
   ```

---

## 🏗️ Architecture

Kites operates on a secure **Backend-Proxy model**:
- **Authentication:** Stateless JWT-based sessions.
- **Identity:** Integrates with OAuth providers for user verification.
- **RBAC:** Dual-layer authorization (Internal App Roles + Kubernetes ServiceAccount permissions).
- **Security:** Kubeconfigs are stored with symmetric encryption (`KITE_ENCRYPT_KEY`).

## 📄 License
This project is licensed under the Apache License 2.0.
