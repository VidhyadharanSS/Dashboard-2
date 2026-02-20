import { IconLayoutGrid, IconServer } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'

import { NodeWithMetrics } from '@/types/api'
import { NodeCondition as V1NodeCondition } from 'kubernetes-types/core/v1'
import { useResourcesWatch } from '@/lib/api'
import { withSubPath } from '@/lib/subpath'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function ClusterHeatmap() {
    const { data: nodesData, isLoading } = useResourcesWatch('nodes')
    const navigate = useNavigate()

    const nodes = nodesData || []

    const getMetricColor = (percentage: number) => {
        if (percentage < 50) return 'bg-emerald-500'
        if (percentage < 80) return 'bg-amber-500'
        return 'bg-rose-500'
    }

    if (isLoading) {
        return <div className="h-48 flex items-center justify-center text-muted-foreground">Loading cluster heatmap...</div>
    }

    return (
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                        <IconLayoutGrid size={20} />
                    </div>
                    <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">Node Resource Overview</CardTitle>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground font-semibold">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>Low</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Med</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-rose-500" />
                        <span>High</span>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                    <TooltipProvider>
                        {nodes.map((node: NodeWithMetrics) => {
                            const metrics = node.metrics
                            const cpuP = metrics?.cpuUsage || 0
                            const memP = metrics?.memoryUsage || 0
                            const pods = metrics?.pods || 0
                            const podsLimit = metrics?.podsLimit || 110
                            const podsP = (pods / podsLimit) * 100

                            const isReady = node.status?.conditions?.find((c: V1NodeCondition) => c.type === 'Ready')?.status === 'True'

                            return (
                                <Tooltip key={node.metadata?.name}>
                                    <TooltipTrigger asChild>
                                        <div
                                            onClick={() => navigate(withSubPath(`/nodes/${node.metadata?.name}`))}
                                            className={`
                                                group relative p-2 rounded-xl cursor-pointer transition-all duration-300
                                                bg-white dark:bg-slate-800 border-2
                                                ${isReady ? 'border-transparent hover:border-blue-500/50 shadow-sm' : 'border-rose-500/50 bg-rose-50/50 dark:bg-rose-950/20'}
                                                hover:shadow-lg hover:-translate-y-1
                                            `}
                                        >
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className={`w-2 h-2 rounded-full ${isReady ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 animate-pulse'}`} />
                                                    <span className="text-[10px] font-mono font-bold text-slate-400 group-hover:text-blue-500 transition-colors truncate max-w-[60px]">
                                                        {node.metadata?.name?.split('-').pop()}
                                                    </span>
                                                </div>

                                                {/* Mini bars for CPU, MEM, PODS */}
                                                <div className="space-y-1.5">
                                                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all duration-500 ${getMetricColor(cpuP)}`}
                                                            style={{ width: `${Math.min(cpuP, 100)}%` }}
                                                        />
                                                    </div>
                                                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all duration-500 ${getMetricColor(memP)}`}
                                                            style={{ width: `${Math.min(memP, 100)}%` }}
                                                        />
                                                    </div>
                                                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all duration-500 ${getMetricColor(podsP)}`}
                                                            style={{ width: `${Math.min(podsP, 100)}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl min-w-[200px] z-[100]" side="top" align="center">
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                                                <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded-md">
                                                    <IconServer size={14} />
                                                </div>
                                                <span className="font-bold text-sm tracking-tight">{node.metadata?.name}</span>
                                            </div>

                                            <div className="grid grid-cols-1 gap-2">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        <span>CPU Usage</span>
                                                        <span className={cpuP > 80 ? 'text-rose-500' : ''}>{cpuP.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                        <div className={`h-full ${getMetricColor(cpuP)}`} style={{ width: `${cpuP}%` }} />
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        <span>Memory Usage</span>
                                                        <span className={memP > 80 ? 'text-rose-500' : ''}>{memP.toFixed(1)}%</span>
                                                    </div>
                                                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                        <div className={`h-full ${getMetricColor(memP)}`} style={{ width: `${memP}%` }} />
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        <span>Pods Allocation</span>
                                                        <span className={podsP > 80 ? 'text-rose-500' : ''}>{pods}/{podsLimit}</span>
                                                    </div>
                                                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                        <div className={`h-full ${getMetricColor(podsP)}`} style={{ width: `${podsP}%` }} />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex border-t border-slate-100 dark:border-slate-800 pt-2 items-center justify-between">
                                                <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">Status</span>
                                                <Badge
                                                    variant="outline"
                                                    className={`
                                                        text-[10px] px-2 py-0 font-bold uppercase tracking-tighter
                                                        ${isReady ? 'border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20' : 'border-rose-500/50 text-rose-600 bg-rose-50 dark:bg-rose-950/20'}
                                                    `}
                                                >
                                                    {isReady ? 'Ready' : 'Not Ready'}
                                                </Badge>
                                            </div>
                                        </div>
                                    </TooltipContent>
                                </Tooltip>
                            )
                        })}
                    </TooltipProvider>
                    {nodes.length === 0 && (
                        <div className="col-span-full h-32 flex flex-col items-center justify-center gap-2 text-muted-foreground bg-white/50 dark:bg-slate-800/50 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                            <IconServer size={32} className="opacity-20" />
                            <span className="text-sm font-medium italic">No nodes detected in cluster</span>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
