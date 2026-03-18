/**
 * Feature: Resource Top Consumers Widget
 *
 * Surfaces the top 5 pods consuming the most CPU and Memory, helping
 * cluster operators quickly identify resource hogs and right-size workloads.
 *
 * - Dual-tab view: CPU / Memory
 * - Horizontal bar chart showing actual consumption
 * - Percentage of node allocatable resources
 * - Clickable rows navigate to pod detail
 */

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    IconCpu,
    IconServer,
    IconLoader2,
    IconChartBar,
    IconFlame,
} from '@tabler/icons-react'
import { useResources, useOverview } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { useNavigate } from 'react-router-dom'
import type { PodWithMetrics } from '@/types/api'
import { formatBytes } from '@/lib/utils'

type Tab = 'cpu' | 'memory'

interface TopConsumer {
    name: string
    namespace: string
    uid: string
    cpuUsage: number       // cores
    memoryUsage: number    // bytes
    cpuRequest: number
    memoryRequest: number
    cpuLimit: number
    memoryLimit: number
}

function formatCpuShort(cores: number): string {
    if (cores >= 1) return `${cores.toFixed(2)} cores`
    return `${Math.round(cores * 1000)}m`
}

function ConsumerBar({
    value,
    max,
    limit,
    formatFn,
    color,
}: {
    value: number
    max: number
    limit: number
    formatFn: (v: number) => string
    color: string
}) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
    const overLimit = limit > 0 && value > limit * 0.9

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-0.5">
                <span className={`text-[10px] font-bold tabular-nums ${overLimit ? 'text-red-500' : 'text-foreground'}`}>
                    {formatFn(value)}
                </span>
                {limit > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                        / {formatFn(limit)} limit
                    </span>
                )}
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${overLimit ? 'bg-red-500' : color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    )
}

export function ResourceTopConsumers() {
    const navigate = useNavigate()
    const { canAccess } = usePermissions()
    const [activeTab, setActiveTab] = useState<Tab>('cpu')

    const canListPods = canAccess('pods', 'list')

    const { data: pods, isLoading } = useResources('pods', undefined, {
        refreshInterval: 30000,
        disable: !canListPods,
    })

    const { data: overview } = useOverview()

    const consumers = useMemo<TopConsumer[]>(() => {
        if (!pods) return []

        return (pods as PodWithMetrics[])
            .filter(pod => pod.metrics && (pod.metrics.cpuUsage || pod.metrics.memoryUsage))
            .map(pod => ({
                name: pod.metadata?.name || '',
                namespace: pod.metadata?.namespace || '',
                uid: pod.metadata?.uid || '',
                cpuUsage: pod.metrics?.cpuUsage || 0,
                memoryUsage: pod.metrics?.memoryUsage || 0,
                cpuRequest: pod.metrics?.cpuRequest || 0,
                memoryRequest: pod.metrics?.memoryRequest || 0,
                cpuLimit: pod.metrics?.cpuLimit || 0,
                memoryLimit: pod.metrics?.memoryLimit || 0,
            }))
    }, [pods])

    const sortedConsumers = useMemo(() => {
        const sorted = [...consumers].sort((a, b) =>
            activeTab === 'cpu'
                ? b.cpuUsage - a.cpuUsage
                : b.memoryUsage - a.memoryUsage
        )
        return sorted.slice(0, 5)
    }, [consumers, activeTab])

    // Max values for bar scaling
    const maxCpu = useMemo(() => {
        if (sortedConsumers.length === 0) return 1
        return Math.max(...sortedConsumers.map(c => c.cpuUsage), 0.001)
    }, [sortedConsumers])

    const maxMem = useMemo(() => {
        if (sortedConsumers.length === 0) return 1
        return Math.max(...sortedConsumers.map(c => c.memoryUsage), 1)
    }, [sortedConsumers])

    // Cluster totals from overview
    const clusterCpu = overview?.resource?.cpu?.allocatable ? overview.resource.cpu.allocatable / 1000 : 0
    const clusterMem = overview?.resource?.memory?.allocatable || 0

    return (
        <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-rose-500/10 rounded-md">
                        <IconChartBar className="h-4 w-4 text-rose-500" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        Top Consumers
                    </CardTitle>
                </div>
                {/* Tab toggle */}
                <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                    <Button
                        variant={activeTab === 'cpu' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => setActiveTab('cpu')}
                    >
                        <IconCpu className="h-3 w-3" />
                        CPU
                    </Button>
                    <Button
                        variant={activeTab === 'memory' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => setActiveTab('memory')}
                    >
                        <IconServer className="h-3 w-3" />
                        Memory
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="flex-1 pt-3 pb-2 px-3">
                {!canListPods ? (
                    <div className="text-sm text-muted-foreground text-center py-6">
                        Requires permission to list pods
                    </div>
                ) : isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : sortedConsumers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                        <IconChartBar className="h-8 w-8 opacity-30" />
                        <p className="text-xs font-medium">No metrics data available</p>
                        <p className="text-[10px]">Pod metrics require metrics-server</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sortedConsumers.map((consumer, idx) => {
                            const isHot = idx === 0
                            return (
                                <button
                                    key={consumer.uid}
                                    onClick={() => navigate(`/pods/${consumer.namespace}/${consumer.name}`)}
                                    className="w-full group flex items-center gap-3 p-2 rounded-md hover:bg-muted/60 transition-colors text-left border border-transparent hover:border-border/50"
                                >
                                    {/* Rank */}
                                    <div className={`flex items-center justify-center h-6 w-6 rounded-md text-[10px] font-bold shrink-0 ${
                                        isHot
                                            ? 'bg-rose-500/10 text-rose-500'
                                            : 'bg-muted text-muted-foreground'
                                    }`}>
                                        {isHot ? <IconFlame className="h-3.5 w-3.5" /> : `#${idx + 1}`}
                                    </div>

                                    {/* Pod info & bar */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                                                {consumer.name}
                                            </span>
                                            <Badge variant="outline" className="text-[9px] h-4 shrink-0">
                                                {consumer.namespace}
                                            </Badge>
                                        </div>
                                        {activeTab === 'cpu' ? (
                                            <ConsumerBar
                                                value={consumer.cpuUsage}
                                                max={maxCpu}
                                                limit={consumer.cpuLimit}
                                                formatFn={formatCpuShort}
                                                color="bg-blue-500"
                                            />
                                        ) : (
                                            <ConsumerBar
                                                value={consumer.memoryUsage}
                                                max={maxMem}
                                                limit={consumer.memoryLimit}
                                                formatFn={(v) => formatBytes(v)}
                                                color="bg-purple-500"
                                            />
                                        )}
                                    </div>
                                </button>
                            )
                        })}

                        {/* Cluster context */}
                        {(clusterCpu > 0 || clusterMem > 0) && (
                            <div className="flex items-center justify-between pt-2 border-t border-border/30 text-[10px] text-muted-foreground">
                                <span>Cluster Allocatable:</span>
                                <span className="font-mono">
                                    {activeTab === 'cpu'
                                        ? `${clusterCpu.toFixed(1)} cores`
                                        : formatBytes(clusterMem)
                                    }
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
