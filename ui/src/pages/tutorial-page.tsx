import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    IconSearch,
    IconTerminal2,
    IconShieldCheck,
    IconBolt,
    IconTimeline,
    IconCode,
    IconKeyboard,
    IconArrowRight,
    IconStar,
    IconChartBar,
    IconFilter,
    IconEye,
    IconRefresh,
    IconLayoutDashboard,
    IconUsers,
    IconLayersLinked,
} from '@tabler/icons-react'

const FEATURES = [
    {
        icon: IconLayoutDashboard,
        title: 'Intelligent Cluster Overview',
        description: 'Real-time cluster health scoring with weighted signals — node readiness, pod health, event warnings, and resource pressure. Clickable breakdown cards navigate directly to affected resources.',
        color: 'bg-blue-500/10 text-blue-500',
        badge: 'Core',
    },
    {
        icon: IconSearch,
        title: 'Advanced Expression Search',
        description: 'Filter any resource with JS-like expressions. Run kubectl-style commands like `kubectl get pods -n production`, use JSONPath, or write `status.phase !== "Running"`. Supports regex and deep field traversal.',
        color: 'bg-purple-500/10 text-purple-500',
        badge: 'Powerful',
    },
    {
        icon: IconTerminal2,
        title: 'Interactive Pod Terminals',
        description: 'Direct shell access to any running container with automatic resize, ANSI color support, and multi-container selection. Connect instantly from search results or pod detail pages.',
        color: 'bg-green-500/10 text-green-500',
        badge: 'Dev',
    },
    {
        icon: IconTimeline,
        title: 'Full Audit Timeline',
        description: 'Every create, update, patch, delete and apply action is logged with operator identity, before/after YAML diffs, resource type, namespace and timestamp. Export to CSV for compliance.',
        color: 'bg-amber-500/10 text-amber-500',
        badge: 'Compliance',
    },
    {
        icon: IconShieldCheck,
        title: 'Fine-grained RBAC',
        description: 'Assign roles with per-cluster, per-namespace, per-resource, and per-verb granularity. Clone roles, bulk-assign subjects, inspect effective permissions for any user, and view accessible namespaces.',
        color: 'bg-red-500/10 text-red-500',
        badge: 'Security',
    },
    {
        icon: IconBolt,
        title: 'Live Event Streaming',
        description: 'Real-time Kubernetes event feed via Server-Sent Events. Watch resource changes (ADDED / MODIFIED / DELETED) live in the sidebar drawer without polling.',
        color: 'bg-orange-500/10 text-orange-500',
        badge: 'Live',
    },
    {
        icon: IconCode,
        title: 'Inline YAML Editor & Diff',
        description: 'Edit any resource YAML in the browser with syntax highlighting and before/after diff view. Atomic patch support for zero-downtime updates.',
        color: 'bg-cyan-500/10 text-cyan-500',
        badge: 'Editor',
    },
    {
        icon: IconChartBar,
        title: 'Prometheus-powered Metrics',
        description: 'CPU and memory utilization charts for the whole cluster and per-pod. Resource pressure indicators feed directly into the health score algorithm.',
        color: 'bg-indigo-500/10 text-indigo-500',
        badge: 'Metrics',
    },
    {
        icon: IconFilter,
        title: 'Namespace-aware Filtering',
        description: 'Pin namespaces for quick access, switch context from the header pill switcher, or filter every table by namespace. Pinned preferences persist across sessions.',
        color: 'bg-teal-500/10 text-teal-500',
        badge: 'UX',
    },
    {
        icon: IconEye,
        title: 'Resource Topology Graph',
        description: 'Visual dependency graph showing how Pods, ReplicaSets, Deployments, Services, ConfigMaps, and PVCs are related. Navigate interactively from any resource detail page.',
        color: 'bg-pink-500/10 text-pink-500',
        badge: 'Visual',
    },
    {
        icon: IconRefresh,
        title: 'One-Click Rollouts & Rollbacks',
        description: 'Restart deployments, scale replicas, roll back to previous revisions, and monitor rollout progress in a live dialog — all without leaving the dashboard.',
        color: 'bg-emerald-500/10 text-emerald-500',
        badge: 'Ops',
    },
    {
        icon: IconUsers,
        title: 'Multi-Cluster & Multi-User',
        description: 'Connect multiple Kubernetes clusters and switch between them instantly. Manage users with password or OAuth/OIDC auth. Supports group-based role assignments from your identity provider.',
        color: 'bg-violet-500/10 text-violet-500',
        badge: 'Enterprise',
    },
    {
        icon: IconLayersLinked,
        title: 'Pod File Browser',
        description: 'Browse, download, upload, and preview files inside running containers directly from the browser. No kubectl cp needed. Works alongside the integrated terminal.',
        color: 'bg-sky-500/10 text-sky-500',
        badge: 'Files',
    },
]

const SHORTCUTS = [
    { keys: ['⌘', 'K'], description: 'Open global search' },
    { keys: ['⌘', 'J'], description: 'Create new resource' },
    { keys: ['⌘', 'B'], description: 'Toggle sidebar' },
    { keys: ['⌘', ','], description: 'Open settings' },
    { keys: ['⌘', '⌥', 'S'], description: 'Settings (alt shortcut)' },
    { keys: ['Esc'], description: 'Close any open dialog' },
    { keys: ['↑', '↓'], description: 'Navigate search results' },
    { keys: ['↵'], description: 'Confirm selected result' },
]

const WHY_DIFFERENT = [
    { title: 'No agent required', body: 'Connects to your cluster using standard kubeconfig — no sidecar, no operator, no CRDs needed.' },
    { title: 'RBAC-native security', body: 'Every API call is scoped to the logged-in user\'s roles. Users only see and act on what they are permitted to.' },
    { title: 'Expression search, not just filters', body: 'Write JS expressions, JSONPath, and kubectl-style commands against live resource data — not just label/name filters.' },
    { title: 'Audit every action', body: 'Compliance-grade audit log with YAML diffs, not just event logs. Know exactly what changed, by whom, and when.' },
    { title: 'Lightweight & fast', body: 'Single static binary + embedded frontend. Starts in under a second. No Helm chart of 30 dependencies.' },
    { title: 'Open & self-hostable', body: 'Deploy on-premise or in-cluster. Your data never leaves your infrastructure.' },
]

export function TutorialPage() {
    const [activeFeature, setActiveFeature] = useState<number | null>(null)

    return (
        <div className="max-w-5xl mx-auto py-8 px-4 space-y-16 animate-page-enter">

            {/* ── Hero ── */}
            <div className="text-center space-y-5">
                <Badge variant="outline" className="px-4 py-1.5 text-xs font-mono tracking-widest uppercase text-primary border-primary/20 bg-primary/5">
                    Built by Team Kites
                </Badge>
                <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-br from-foreground via-foreground/90 to-foreground/60 bg-clip-text text-transparent">
                    Kites Dashboard
                </h1>
                <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                    A modern, security-first Kubernetes dashboard engineered for operators who need speed, visibility, and control — without the complexity.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    {['Expression Search', 'Live Audit Logs', 'Fine-grained RBAC', 'Multi-Cluster', 'No Agent'].map(tag => (
                        <span key={tag} className="text-xs px-3 py-1 rounded-full bg-muted text-muted-foreground border border-border/50 hover:border-primary/30 hover:text-foreground transition-colors cursor-default">
                            {tag}
                        </span>
                    ))}
                </div>
            </div>

            {/* ── Why Different ── */}
            <div className="space-y-5">
                <div className="flex items-center gap-3">
                    <IconStar className="h-5 w-5 text-amber-500" />
                    <h2 className="text-xl font-bold tracking-tight">Why Kites is Different</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {WHY_DIFFERENT.map((item, i) => (
                        <div
                            key={i}
                            className="p-4 rounded-xl border border-border/50 bg-card hover:border-primary/20 hover:shadow-sm transition-all duration-200 animate-stagger-item"
                            style={{ '--stagger-index': i } as React.CSSProperties}
                        >
                            <div className="flex items-start gap-2">
                                <IconArrowRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-sm font-semibold">{item.title}</p>
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.body}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Feature Grid ── */}
            <div className="space-y-5">
                <h2 className="text-xl font-bold tracking-tight">All Features</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    {FEATURES.map((feature, i) => {
                        const Icon = feature.icon
                        const isActive = activeFeature === i
                        return (
                            <Card
                                key={i}
                                className={`cursor-pointer transition-all duration-200 card-elevated animate-stagger-item ${isActive ? 'border-primary/30 shadow-md' : ''}`}
                                style={{ '--stagger-index': i } as React.CSSProperties}
                                onClick={() => setActiveFeature(isActive ? null : i)}
                            >
                                <CardHeader className="pb-2">
                                    <CardTitle className="flex items-center gap-3 text-sm font-semibold">
                                        <div className={`p-2 rounded-lg ${feature.color} transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <span className="flex-1">{feature.title}</span>
                                        <Badge variant="outline" className="text-[10px] h-5 shrink-0">{feature.badge}</Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <p className={`text-xs text-muted-foreground leading-relaxed transition-all duration-200 ${isActive ? '' : 'line-clamp-2'}`}>
                                        {feature.description}
                                    </p>
                                    {!isActive && (
                                        <span className="text-[10px] text-primary mt-1 inline-block">Read more ↓</span>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            </div>

            {/* ── Keyboard Shortcuts ── */}
            <div className="space-y-5">
                <div className="flex items-center gap-3">
                    <IconKeyboard className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-xl font-bold tracking-tight">Keyboard Shortcuts</h2>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {SHORTCUTS.map((shortcut, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/40 border border-border/30 hover:bg-muted/60 transition-colors animate-stagger-item"
                            style={{ '--stagger-index': i } as React.CSSProperties}
                        >
                            <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                            <div className="flex items-center gap-1">
                                {shortcut.keys.map((key, ki) => (
                                    <kbd
                                        key={ki}
                                        className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-background px-1.5 font-mono text-[11px] font-medium shadow-sm"
                                    >
                                        {key}
                                    </kbd>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Footer ── */}
            <div className="border-t pt-8 text-center space-y-2">
                <p className="text-sm font-semibold text-foreground">Built by Team Kites</p>
                <p className="text-xs text-muted-foreground">
                    Open-source Kubernetes dashboard — fast, secure, and built for real operational workflows.
                </p>
                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest mt-3">
                    Kites Dashboard · MIT License
                </p>
            </div>
        </div>
    )
}