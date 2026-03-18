import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
    IconTerminal2,
    IconSearch,
    IconTopologyBus,
    IconCode,
    IconShieldCheck,
    IconReload,
    IconAdjustments,
    IconBolt,
    IconEye,
    IconDeviceFloppy,
    IconArrowsHorizontal,
    IconBrandGit,
} from '@tabler/icons-react'

interface FeatureItem {
    icon: React.ReactNode
    title: string
    description: string
    tag?: string
}

const CORE_FEATURES: FeatureItem[] = [
    {
        icon: <IconSearch size={20} />,
        title: 'Expression-Based Search',
        description:
            'Filter any Kubernetes resource using JavaScript-like expressions, JSONPath, regex, or even native kubectl commands — all RBAC-scoped and executed in-browser.',
        tag: 'Unique',
    },
    {
        icon: <IconTerminal2 size={20} />,
        title: 'In-Browser Pod Terminals',
        description:
            'Open interactive shell sessions directly into running containers with automatic sizing, multi-container support, and clipboard integration — no local tooling required.',
    },
    {
        icon: <IconTopologyBus size={20} />,
        title: 'Resource Topology Visualization',
        description:
            'Automatically discovers and renders the relationship graph between Deployments, Services, Pods, ConfigMaps, Secrets, and volumes. Exportable as PNG or SVG.',
        tag: 'Unique',
    },
    {
        icon: <IconCode size={20} />,
        title: 'Atomic YAML Patching',
        description:
            'Edit and apply partial YAML patches using the kubectl strategic-merge strategy. Supports inline diff preview and one-click rollback from the history tab.',
    },
    {
        icon: <IconShieldCheck size={20} />,
        title: 'Fine-Grained RBAC',
        description:
            'Every API call, sidebar entry, and UI action is scoped to the authenticated user\'s role. Admins can define granular permissions per resource type, verb, and namespace.',
        tag: 'Unique',
    },
    {
        icon: <IconReload size={20} />,
        title: 'One-Click Rollouts and Restarts',
        description:
            'Trigger rolling restarts on Deployments, StatefulSets, and DaemonSets with a single action. Includes a live rollout monitor that tracks pod-by-pod progress.',
    },
    {
        icon: <IconEye size={20} />,
        title: 'Real-Time Streaming (SSE)',
        description:
            'Switch any resource list to live-watch mode. Changes appear instantly via Server-Sent Events — no polling overhead, no stale data.',
    },
    {
        icon: <IconBolt size={20} />,
        title: 'Keyboard-Driven Workflow',
        description:
            'Navigate the entire dashboard without touching a mouse. Press ? to see all shortcuts, G+P to jump to Pods, Ctrl+K for global search, and more.',
    },
    {
        icon: <IconAdjustments size={20} />,
        title: 'In-Place Pod Resize (K8s 1.35+)',
        description:
            'Modify CPU and memory limits on running pods without restarting them. Kites detects cluster version and enables the feature automatically.',
        tag: 'Unique',
    },
    {
        icon: <IconDeviceFloppy size={20} />,
        title: 'Resource History and Diff',
        description:
            'Every edit is tracked. Compare any two revisions side-by-side with a full YAML diff viewer to understand exactly what changed and when.',
    },
    {
        icon: <IconArrowsHorizontal size={20} />,
        title: 'Multi-Cluster Management',
        description:
            'Switch between clusters from the sidebar footer. Each cluster maintains its own namespace, filter, and column visibility state.',
    },
    {
        icon: <IconBrandGit size={20} />,
        title: 'CRD Support with Auto-Discovery',
        description:
            'Kites automatically detects Custom Resource Definitions and renders them as first-class sidebar entries with full CRUD, topology, and YAML editing.',
    },
]

export function TutorialPage() {
    return (
        <div className="max-w-5xl mx-auto py-10 px-4 space-y-12">
            {/* Header */}
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="px-3 py-1 text-xs font-mono tracking-widest uppercase border-primary/30 text-primary bg-primary/5">
                        Kites Dashboard
                    </Badge>
                </div>
                <h1 className="text-4xl font-black tracking-tight">
                    Why Kites Dashboard
                </h1>
                <p className="text-lg text-muted-foreground max-w-3xl leading-relaxed">
                    Kites is a purpose-built Kubernetes dashboard that goes beyond basic resource listing.
                    It combines real-time observability, an expression search engine, in-browser terminals,
                    topology visualization, and a keyboard-first workflow into a single pane of glass —
                    all enforced by fine-grained RBAC.
                </p>
            </div>

            {/* Feature Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {CORE_FEATURES.map((feature) => (
                    <Card
                        key={feature.title}
                        className="group relative overflow-hidden border-border/60 bg-card/80 backdrop-blur-sm hover:border-primary/40 hover:shadow-lg transition-all duration-300"
                    >
                        <CardContent className="p-5 space-y-3">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary shrink-0">
                                    {feature.icon}
                                </div>
                                {feature.tag && (
                                    <Badge variant="secondary" className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                                        {feature.tag}
                                    </Badge>
                                )}
                            </div>
                            <div>
                                <h3 className="font-semibold text-sm leading-snug">{feature.title}</h3>
                                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                    {feature.description}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Key Differentiators */}
            <div className="space-y-6">
                <h2 className="text-2xl font-bold tracking-tight">What Sets Kites Apart</h2>
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
                        <h3 className="font-semibold text-sm">Zero Local Tooling</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            No kubectl, no kubeconfig files, no CLI dependencies. Everything runs in the browser.
                            Teams can onboard engineers in minutes without provisioning local environments.
                        </p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
                        <h3 className="font-semibold text-sm">Security by Default</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Every action is gated by server-side RBAC checks. Sidebar items, buttons, and API calls
                            are hidden or disabled automatically when the user lacks the required permissions.
                        </p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
                        <h3 className="font-semibold text-sm">Production-Ready Observability</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Built-in CPU, memory, network, and disk I/O charts per pod and node.
                            Live log streaming with multi-container support and download-as-JSON.
                        </p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-5 space-y-2">
                        <h3 className="font-semibold text-sm">Developer Experience First</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Customizable sidebar, pinned namespaces, persistent filter state, keyboard shortcuts,
                            dark/light themes, and multiple language support — built for daily use.
                        </p>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="border-t pt-8 text-center">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Kites Dashboard — Kubernetes Operations, Simplified
                </p>
            </div>
        </div>
    )
}