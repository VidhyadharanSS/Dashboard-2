/**
 * Feature: Pod Restart Leaderboard Widget
 *
 * Surfaces pods with the highest restart counts as an early-warning system
 * for flapping workloads (CrashLoopBackOff, OOMKill, etc.).
 * 
 * - Shows top 8 pods sorted by restart count
 * - Color-coded severity (green / amber / red)
 * - Clickable rows navigate to pod detail
 * - Shows restart trend indicator and last restart time
 */

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
    IconRefreshAlert,
    IconLoader2,
    IconFlame,
    IconAlertTriangle,
    IconCircleCheck,
    IconTrendingUp,
} from '@tabler/icons-react'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { getPodStatus } from '@/lib/k8s'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import type { Pod } from 'kubernetes-types/core/v1'

interface RestartPodInfo {
    name: string
    namespace: string
    uid: string
    restarts: number
    restartString: string
    status: string
    lastRestartAge: string | null
    containerCount: number
    readyCount: number
}

function getRestartSeverity(restarts: number): {
    color: string
    bgColor: string
    icon: React.ElementType
    label: string
} {
    if (restarts >= 50) return {
        color: 'text-red-600 dark:text-red-400',
        bgColor: 'bg-red-500/10',
        icon: IconFlame,
        label: 'Critical',
    }
    if (restarts >= 10) return {
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
        icon: IconAlertTriangle,
        label: 'Warning',
    }
    if (restarts >= 1) return {
        color: 'text-yellow-600 dark:text-yellow-400',
        bgColor: 'bg-yellow-500/10',
        icon: IconTrendingUp,
        label: 'Minor',
    }
    return {
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-500/10',
        icon: IconCircleCheck,
        label: 'Healthy',
    }
}

function RestartBar({ restarts, maxRestarts }: { restarts: number; maxRestarts: number }) {
    const pct = maxRestarts > 0 ? Math.min((restarts / maxRestarts) * 100, 100) : 0
    const severity = getRestartSeverity(restarts)
    const barColorClass = restarts >= 50
        ? 'bg-red-500'
        : restarts >= 10
            ? 'bg-amber-500'
            : restarts >= 1
                ? 'bg-yellow-500'
                : 'bg-emerald-500'

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 w-24">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${barColorClass}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <span className={`text-xs font-bold tabular-nums ${severity.color}`}>
                            {restarts}
                        </span>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                    {restarts} restarts — {severity.label}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export function PodRestartLeaderboard() {
    const navigate = useNavigate()
    const { canAccess } = usePermissions()
    const canListPods = canAccess('pods', 'list')

    const { data: pods, isLoading } = useResources('pods', undefined, {
        refreshInterval: 30000,
        disable: !canListPods,
    })

    const { leaderboard, totalRestarts, maxRestarts, summary } = useMemo(() => {
        if (!pods) return { leaderboard: [], totalRestarts: 0, maxRestarts: 0, summary: { critical: 0, warning: 0, minor: 0 } }

        const allPods = pods as Pod[]
        let totalRestarts = 0
        let critical = 0
        let warning = 0
        let minor = 0

        const podInfos: RestartPodInfo[] = allPods.map(pod => {
            const status = getPodStatus(pod)
            totalRestarts += status.restartCount

            if (status.restartCount >= 50) critical++
            else if (status.restartCount >= 10) warning++
            else if (status.restartCount >= 1) minor++

            // Try to find last restart time from container statuses
            let lastRestartAge: string | null = null
            const containerStatuses = [
                ...(pod.status?.containerStatuses || []),
                ...(pod.status?.initContainerStatuses || []),
            ]
            for (const cs of containerStatuses) {
                if (cs.lastState?.terminated?.finishedAt) {
                    const age = formatDistanceToNow(new Date(cs.lastState.terminated.finishedAt), { addSuffix: true })
                    if (!lastRestartAge) lastRestartAge = age
                }
            }

            return {
                name: pod.metadata?.name || '',
                namespace: pod.metadata?.namespace || '',
                uid: pod.metadata?.uid || '',
                restarts: status.restartCount,
                restartString: status.restartString,
                status: status.reason,
                lastRestartAge,
                containerCount: status.totalContainers,
                readyCount: status.readyContainers,
            }
        })

        const sorted = podInfos
            .filter(p => p.restarts > 0)
            .sort((a, b) => b.restarts - a.restarts)
            .slice(0, 8)

        const maxRestarts = sorted.length > 0 ? sorted[0].restarts : 0

        return {
            leaderboard: sorted,
            totalRestarts,
            maxRestarts,
            summary: { critical, warning, minor },
        }
    }, [pods])

    return (
        <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-amber-500/10 rounded-md">
                        <IconRefreshAlert className="h-4 w-4 text-amber-500" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        Pod Restart Leaderboard
                    </CardTitle>
                </div>
                {/* Summary badges */}
                <div className="flex items-center gap-1.5">
                    {summary.critical > 0 && (
                        <Badge variant="destructive" className="text-[10px] h-5 px-1.5 gap-0.5">
                            <IconFlame className="h-2.5 w-2.5" />
                            {summary.critical}
                        </Badge>
                    )}
                    {summary.warning > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 gap-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                            <IconAlertTriangle className="h-2.5 w-2.5" />
                            {summary.warning}
                        </Badge>
                    )}
                    {totalRestarts > 0 && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                            Σ{totalRestarts}
                        </span>
                    )}
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
                ) : leaderboard.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                        <IconCircleCheck className="h-8 w-8 text-emerald-500 opacity-50" />
                        <p className="text-xs font-medium">No pod restarts detected</p>
                        <p className="text-[10px] text-muted-foreground">All pods are running stable</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {leaderboard.map((pod) => {
                            return (
                                <button
                                    key={pod.uid}
                                    onClick={() => navigate(`/pods/${pod.namespace}/${pod.name}`)}
                                    className="w-full group flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 transition-colors text-left border border-transparent hover:border-border/50"
                                >
                                    {/* Status icon */}
                                    <PodStatusIcon status={pod.status} className="w-4 h-4 shrink-0" />

                                    {/* Pod info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                                                {pod.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                            <span>{pod.namespace}</span>
                                            <span>·</span>
                                            <span>{pod.readyCount}/{pod.containerCount} ready</span>
                                            {pod.lastRestartAge && (
                                                <>
                                                    <span>·</span>
                                                    <span>last {pod.lastRestartAge}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Restart bar */}
                                    <RestartBar restarts={pod.restarts} maxRestarts={maxRestarts} />
                                </button>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
