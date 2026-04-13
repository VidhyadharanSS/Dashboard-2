import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconAlertTriangle, IconLoader2, IconCircleCheck, IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import type { Pod } from 'kubernetes-types/core/v1'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { getPodStatus } from '@/lib/k8s'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function FailingPodsWidget() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { canAccess } = usePermissions()

    const canListPods = canAccess('pods', 'list')
    const { data: pods, isLoading } = useResources('pods', undefined, {
        refreshInterval: 15000,
        disable: !canListPods
    })

    const failingPods = pods
        ? (pods as Pod[]).filter(pod => {
            const status = getPodStatus(pod)
            const isNormal = [
                'Running',
                'Completed',
                'Succeeded',
                'ContainerCreating',
                'PodInitializing'
            ].includes(status.reason)
            return !isNormal;
        }).sort((a, b) => {
            // Sort by restart count descending, then by creation time
            const statusA = getPodStatus(a)
            const statusB = getPodStatus(b)
            if (statusB.restartCount !== statusA.restartCount) {
                return statusB.restartCount - statusA.restartCount
            }
            const timeA = a.metadata?.creationTimestamp || ''
            const timeB = b.metadata?.creationTimestamp || ''
            return new Date(timeB).getTime() - new Date(timeA).getTime()
        }).slice(0, 6)
        : []

    const totalFailing = pods
        ? (pods as Pod[]).filter(pod => {
            const status = getPodStatus(pod)
            return !['Running', 'Completed', 'Succeeded', 'ContainerCreating', 'PodInitializing'].includes(status.reason)
        }).length
        : 0

    return (
        <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-md ${totalFailing > 0 ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
                        {totalFailing > 0 ? (
                            <IconAlertTriangle className="h-4 w-4 text-red-500" />
                        ) : (
                            <IconCircleCheck className="h-4 w-4 text-emerald-500" />
                        )}
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        {t('dashboard.failingPods', 'Unhealthy Pods')}
                    </CardTitle>
                </div>
                <div className="flex items-center gap-1.5">
                    {totalFailing > 0 && (
                        <Badge variant="destructive" className="h-5 text-[10px] px-1.5 tabular-nums animate-in fade-in">
                            {totalFailing} failing
                        </Badge>
                    )}
                    {totalFailing === 0 && !isLoading && pods && (
                        <Badge className="h-5 text-[10px] px-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                            All healthy
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-1 pt-3 pb-2 px-3">
                {!canListPods ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                        <IconAlertTriangle className="h-6 w-6 opacity-30" />
                        <p className="text-xs">Requires permission to list pods</p>
                    </div>
                ) : isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : failingPods.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                        <div className="relative">
                            <IconCircleCheck className="h-10 w-10 text-emerald-500 opacity-50" />
                            <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-emerald-500/20 rounded-full animate-ping" />
                        </div>
                        <div className="text-center">
                            <p className="text-xs font-medium text-foreground/80">All pods are healthy</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">No failing or errored pods detected</p>
                        </div>
                    </div>
                ) : (
                    <TooltipProvider>
                        <div className="space-y-1">
                            {failingPods.map((pod) => {
                                const status = getPodStatus(pod)
                                const isCritical = ['CrashLoopBackOff', 'OOMKilled', 'Error'].includes(status.reason)
                                return (
                                    <button
                                        key={pod.metadata?.uid}
                                        onClick={() =>
                                            navigate(
                                                `/pods/${pod.metadata?.namespace}/${pod.metadata?.name}`
                                            )
                                        }
                                        className="w-full group flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 transition-colors text-left border border-transparent hover:border-border/50"
                                    >
                                        <PodStatusIcon status={status.reason} className="w-4 h-4 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                                                    {pod.metadata?.name}
                                                </span>
                                                {isCritical && (
                                                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                <span>{pod.metadata?.namespace}</span>
                                                {status.restartCount > 0 && (
                                                    <>
                                                        <span>·</span>
                                                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                                                            {status.restartCount} restarts
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Badge
                                                        variant={isCritical ? 'destructive' : 'secondary'}
                                                        className="text-[10px] h-5"
                                                    >
                                                        {status.reason}
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent side="left" className="text-xs max-w-[200px]">
                                                    {`Pod is in ${status.reason} state (${status.restartCount} restarts)`}
                                                </TooltipContent>
                                            </Tooltip>
                                            <span className="text-[10px] text-muted-foreground hidden sm:inline">
                                                {pod.metadata?.creationTimestamp &&
                                                    formatDistanceToNow(
                                                        new Date(pod.metadata.creationTimestamp),
                                                        { addSuffix: true }
                                                    ).replace('about ', '')}
                                            </span>
                                        </div>
                                    </button>
                                )
                            })}

                            {/* Show more indicator */}
                            {totalFailing > 6 && (
                                <button
                                    onClick={() => navigate('/pods')}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-primary font-medium hover:text-primary/80 transition-colors"
                                >
                                    <IconExternalLink className="h-3 w-3" />
                                    View all {totalFailing} failing pods
                                </button>
                            )}
                        </div>
                    </TooltipProvider>
                )}
            </CardContent>
        </Card>
    )
}
