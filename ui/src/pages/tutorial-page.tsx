/**
 * Tutorial / Help page
 *
 * Static architecture diagram + user-focused FAQ accordion
 */
import { useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ─── Static Architecture Diagram ─────────────────────────────────────────────

function ArchDiagram() {
    const node = (label: string, sub: string, color: string) => (
        <div className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border text-center min-w-[100px] ${color}`}>
            <span className="text-xs font-semibold leading-tight">{label}</span>
            {sub && <span className="text-[10px] text-muted-foreground leading-tight">{sub}</span>}
        </div>
    )
    const arrow = (label?: string) => (
        <div className="flex flex-col items-center text-muted-foreground select-none">
            <div className="h-5 w-px bg-border" />
            {label && <span className="text-[10px] px-1 py-0.5 bg-muted rounded text-muted-foreground whitespace-nowrap">{label}</span>}
            <div className="h-5 w-px bg-border" />
            <span className="text-xs leading-none">↓</span>
        </div>
    )
    const harrow = (label?: string) => (
        <div className="flex items-center gap-0 text-muted-foreground select-none">
            <div className="w-5 h-px bg-border" />
            {label && <span className="text-[10px] px-1 py-0.5 bg-muted rounded text-muted-foreground whitespace-nowrap">{label}</span>}
            <div className="w-5 h-px bg-border" />
            <span className="text-xs leading-none">→</span>
        </div>
    )

    return (
        <div className="overflow-x-auto py-2">
            {/* Top row: Browser ↔ Kites API */}
            <div className="flex flex-col items-center gap-0">
                <div className="flex items-center gap-2">
                    {node('Browser', 'React + Vite', 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300')}
                    {harrow('REST / WebSocket')}
                    {node('Kites API Server', 'Go / Gin', 'bg-primary/10 border-primary/30 text-primary')}
                </div>

                {/* Below Kites API: 3 branches */}
                <div className="flex items-start gap-8 mt-4 ml-[148px]">
                    {/* K8s branch */}
                    <div className="flex flex-col items-center gap-0">
                        {arrow('client-go')}
                        {node('K8s API Server', 'control plane', 'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300')}
                    </div>
                    {/* DB branch */}
                    <div className="flex flex-col items-center gap-0">
                        {arrow('GORM')}
                        {node('Database', 'SQLite / Postgres', 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300')}
                    </div>
                    {/* Prometheus branch */}
                    <div className="flex flex-col items-center gap-0">
                        {arrow('PromQL')}
                        {node('Prometheus', 'metrics', 'bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300')}
                    </div>
                </div>

                {/* OAuth flow note */}
                <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground border border-dashed border-border rounded-lg px-4 py-2 max-w-md text-center">
                    <span>Browser redirects to OAuth provider &rarr; provider sends token callback to API server &rarr; API server sets JWT cookie on browser</span>
                </div>
            </div>
        </div>
    )
}

// ─── FAQ data - user focused ──────────────────────────────────────────────────

const FAQ: { q: string; a: string }[] = [
    {
        q: 'How do I switch between namespaces?',
        a: 'Use the namespace selector in the top navigation bar. You can also pin frequently used namespaces to the quick-switch pills that appear next to the breadcrumb. Type to filter when the list is long.',
    },
    {
        q: 'How do I open a terminal inside a pod?',
        a: 'Navigate to the pod detail page (Workloads → Pods → click a pod), then click the Terminal tab. Select the container if the pod has multiple containers. A shell opens directly in the browser with no kubectl required.',
    },
    {
        q: 'How do I view logs for a pod or container?',
        a: 'Open the pod detail page and click the Logs tab. Use the container selector to switch between containers, and the live-tail toggle to stream logs in real time. You can also download the full log as a text file.',
    },
    {
        q: 'How do I check why a pod is failing?',
        a: 'Open the pod detail page and check the Status section for error badges, the Events tab for Kubernetes events, and the Conditions list. The diagnostics widget highlights the most likely cause (OOM, image pull errors, scheduling constraints, etc.).',
    },
    {
        q: 'How do I search for a specific resource?',
        a: 'Click the search icon in the top bar or press Ctrl+K. You can search by name across all resource types. For complex queries use Advanced Search (sidebar), which lets you write expression-based filters against any field in the resource spec.',
    },
    {
        q: 'How do I switch between clusters?',
        a: 'Use the cluster selector at the bottom of the left sidebar. All resource views refresh immediately to show the selected cluster. Your namespace selection is remembered per cluster.',
    },
    {
        q: 'How do I view the full YAML or details of a resource?',
        a: 'Open the resource detail page and click the YAML tab to see the full manifest. You can edit the YAML inline and save it to apply changes directly. The Overview tab shows a structured, human-readable summary.',
    },
    {
        q: 'What do the workload status badges mean?',
        a: 'Green badges (Running, Ready) mean the workload is healthy. Yellow/orange badges (Pending, Progressing) mean it is starting or updating. Red badges (Failed, CrashLoopBackOff, Error) indicate a problem. Click the badge to navigate to the affected resource.',
    },
    {
        q: 'How do I view metrics for a node or namespace?',
        a: 'Go to Metrics (sidebar) for cluster-wide Prometheus charts. Node-level CPU and memory are on the Nodes list page. Individual pod metrics appear on the pod detail Monitor tab if Prometheus is configured for the cluster.',
    },
    {
        q: 'How do I view and roll back deployment revisions?',
        a: 'Open a Deployment detail page and click the Revisions tab. Each revision shows the image tag, replica count, and when it was created. Click "View Info" on any revision to see full details, or "Rollback to Rev N" to restore that version.',
    },
    {
        q: 'How do I pin items to the sidebar?',
        a: 'Click your profile avatar in the top-right corner and choose "Customize Sidebar". You can pin/unpin any resource group or item, reorder sections, and hide groups you do not need.',
    },
    {
        q: 'What keyboard shortcuts are available?',
        a: 'Press ? or click the keyboard icon in the header to open the shortcut reference. Key shortcuts include: Ctrl+K (global search), Ctrl+J (create resource), Ctrl+, (settings), Cmd+B (toggle sidebar).',
    },
]

// ─── FAQ Accordion Item ──────────────────────────────────────────────────────

function FAQItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="border-b border-border last:border-0">
            <button
                className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-medium text-foreground hover:text-primary transition-colors"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                <span>{q}</span>
                <IconChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                />
            </button>
            {open && (
                <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{a}</p>
            )}
        </div>
    )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function TutorialPage() {
    return (
        <div className="max-w-3xl mx-auto space-y-8 animate-page-enter px-4 py-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Help & Documentation</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Architecture overview and answers to common questions about the Kites dashboard.
                </p>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Dashboard Architecture</CardTitle>
                </CardHeader>
                <CardContent>
                    <ArchDiagram />
                    <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
                        The browser communicates with the Kites API server over REST, SSE (live resource streaming), and
                        WebSocket (pod terminals). The API server uses client-go to talk to the cluster and PromQL to query Prometheus.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Frequently Asked Questions</CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-2">
                    {FAQ.map((item) => (
                        <FAQItem key={item.q} q={item.q} a={item.a} />
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}
