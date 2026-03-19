import { Badge } from '@/components/ui/badge'

export function TutorialPage() {
    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-12 font-sans">
            <div className="space-y-4 text-center">
                <div className="flex flex-col items-center gap-3">
                    <Badge variant="outline" className="px-3 py-1 text-xs font-mono tracking-widest uppercase text-blue-500 border-blue-500/20 bg-blue-500/5">
                        Kites Dashboard v1.2.0
                    </Badge>
                </div>
                <h1 className="text-4xl font-black tracking-tighter">Developer Manual</h1>
                <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    Core features and upcoming enhancements for the Kites dashboard.
                </p>
            </div>

            <div className="grid gap-12 md:grid-cols-2">
                <div className="space-y-6">
                    <h2 className="text-2xl font-bold uppercase tracking-tighter border-b pb-2">
                        Features Done
                    </h2>
                    <ul className="space-y-4">
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/50 text-emerald-500 bg-emerald-500/5 shrink-0">DONE</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">Advanced Expression Search</span>
                                <span className="text-muted-foreground">Filter resources via JS-like expressions (e.g., <code className="text-xs">status.phase !== "Running"</code>). Available in the sidebar.</span>
                            </div>
                        </li>
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/50 text-emerald-500 bg-emerald-500/5 shrink-0">DONE</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">Interactive Pod Terminals</span>
                                <span className="text-muted-foreground">Direct shell access to running containers with automatic sizing and terminal emulation.</span>
                            </div>
                        </li>
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/50 text-emerald-500 bg-emerald-500/5 shrink-0">DONE</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">Quick YAML Editor</span>
                                <span className="text-muted-foreground">Atomic resource patching using the <code className="text-xs">kubectl patch</code> strategy for zero-downtime updates.</span>
                            </div>
                        </li>
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/50 text-emerald-500 bg-emerald-500/5 shrink-0">DONE</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">Batch Life-cycle Actions</span>
                                <span className="text-muted-foreground">Integrated multi-select for batch deletion and management across all resource tables.</span>
                            </div>
                        </li>
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/50 text-emerald-500 bg-emerald-500/5 shrink-0">DONE</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">One-Click Rollouts</span>
                                <span className="text-muted-foreground">Restart deployments and statefulsets to trigger rolling updates with a single action.</span>
                            </div>
                        </li>
                    </ul>
                </div>

                <div className="space-y-6">
                    <h2 className="text-2xl font-bold uppercase tracking-tighter border-b pb-2">
                        Roadmap
                    </h2>
                    <ul className="space-y-4">
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-blue-500/50 text-blue-500 bg-blue-500/5 shrink-0">P1</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">Log Streaming & Export</span>
                                <span className="text-muted-foreground">Download cluster logs in raw text or structured JSON for deep-dive analysis.</span>
                            </div>
                        </li>
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-blue-500/50 text-blue-500 bg-blue-500/5 shrink-0">P2</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">Multi-Cluster Topology</span>
                                <span className="text-muted-foreground">Cross-cluster visualization and resource mapping via unified observability planes.</span>
                            </div>
                        </li>
                        <li className="flex gap-3 text-sm">
                            <Badge variant="outline" className="h-5 text-[10px] border-slate-500/50 text-slate-500 bg-slate-500/5 shrink-0">P3</Badge>
                            <div className="space-y-1">
                                <span className="font-bold block">RBAC Permission Auditor</span>
                                <span className="text-muted-foreground">Automated scanning for overly permissive ServiceAccounts and RoleBindings.</span>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>

            <div className="border-t pt-8 text-center">
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                    Technical Specification v1.2.0
                </span>
            </div>
        </div>
    )
}