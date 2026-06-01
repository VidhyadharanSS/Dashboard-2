/**
 * RolloutMonitor - Real-time deployment rollout progress panel.
 *
 * Opens as a Sheet after any deployment operation (restart, scale, image update, YAML save).
 * Shows per-pod phase badges, a readyReplicas progress bar, and auto-closes once stable.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    IconArrowRight,
    IconCircleCheck,
    IconExclamationCircle,
    IconLoader,
    IconX,
} from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { Pod } from 'kubernetes-types/core/v1'

import { useResource, useResources } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'

interface RolloutMonitorProps {
    deploymentName: string
    namespace: string
    open: boolean
    onOpenChange: (open: boolean) => void
}

function podPhaseColor(pod: Pod): string {
    const phase = pod.status?.phase
    if (phase === 'Running') {
        const allReady = pod.status?.containerStatuses?.every(c => c.ready) ?? false
        return allReady ? 'bg-green-500' : 'bg-amber-500'
    }
    if (phase === 'Pending') return 'bg-blue-500 animate-pulse'
    if (phase === 'Failed') return 'bg-destructive'
    if (phase === 'Succeeded') return 'bg-green-600'
    return 'bg-muted-foreground'
}

function podStatusLabel(pod: Pod): string {
    const phase = pod.status?.phase ?? 'Unknown'
    if (phase === 'Running') {
        const total = pod.status?.containerStatuses?.length ?? 0
        const ready = pod.status?.containerStatuses?.filter(c => c.ready).length ?? 0
        return `Running (${ready}/${total} ready)`
    }
    const reasons = pod.status?.containerStatuses?.flatMap(c =>
        [c.state?.waiting?.reason, c.state?.terminated?.reason]
    ).filter(Boolean)
    return reasons?.length ? `${phase} - ${reasons[0]}` : phase
}

export function RolloutMonitor({ deploymentName, namespace, open, onOpenChange }: RolloutMonitorProps) {
    const [startTime] = useState(() => new Date())
    const [autoCloseFired, setAutoCloseFired] = useState(false)

    const { data: deploymentData } = useResource<'deployments'>('deployments', deploymentName, namespace, {
        refreshInterval: open ? 3000 : 0,
    })
    const deployment = deploymentData as any

    const labelSelector = useMemo(() => {
        const labels = deployment?.spec?.selector?.matchLabels as Record<string, string> | undefined
        if (!labels) return undefined
        return Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(',')
    }, [deployment])

    const { data: podData } = useResources('pods', namespace, {
        refreshInterval: open && labelSelector ? 3000 : 0,
        labelSelector: labelSelector,
        disable: !labelSelector,
    })
    const pods = podData as Pod[] | undefined

    const status = deployment?.status as any
    const desired: number = status?.replicas ?? deployment?.spec?.replicas ?? 0
    const ready: number = status?.readyReplicas ?? 0
    const updated: number = status?.updatedReplicas ?? 0
    const available: number = status?.availableReplicas ?? 0
    const progressPct = desired > 0 ? Math.round((ready / desired) * 100) : 0
    const isStable = ready === desired && updated === desired && available === desired && desired > 0

    const sortedPods = useMemo(() => {
        return [...(pods ?? [])].sort((a, b) => {
            const ta = new Date(a.metadata?.creationTimestamp ?? '').getTime()
            const tb = new Date(b.metadata?.creationTimestamp ?? '').getTime()
            return tb - ta
        })
    }, [pods])

    useEffect(() => {
        if (isStable && open && !autoCloseFired) {
            const t = setTimeout(() => {
                setAutoCloseFired(true)
                onOpenChange(false)
            }, 8000)
            return () => clearTimeout(t)
        }
    }, [isStable, open, autoCloseFired, onOpenChange])

    const resetAutoClose = useCallback(() => setAutoCloseFired(false), [])
    useEffect(() => { if (!open) resetAutoClose() }, [open, resetAutoClose])

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[420px] sm:w-[460px] flex flex-col gap-0 p-0">
                <SheetHeader className="px-4 py-3 border-b shrink-0">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                            {isStable
                                ? <IconCircleCheck className="h-4 w-4 text-green-500" />
                                : <IconLoader className="h-4 w-4 animate-spin text-primary" />
                            }
                            Rollout Monitor
                            <span className="font-mono text-muted-foreground text-xs">- {deploymentName}</span>
                        </SheetTitle>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onOpenChange(false)}>
                            <IconX className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </SheetHeader>

                {/* Progress overview */}
                <div className="px-4 py-3 border-b shrink-0 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">Ready</span>
                            <span className="font-mono font-semibold">{ready} / {desired}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">Updated</span>
                            <span className="font-mono">{updated}</span>
                            <span className="text-muted-foreground">Available</span>
                            <span className="font-mono">{available}</span>
                        </div>
                    </div>

                    {/* Simple CSS progress bar instead of shadcn Progress */}
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-500"
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>
                            {isStable
                                ? '✓ Rollout complete - closing in 8s'
                                : `${progressPct}% ready - rollout in progress…`
                            }
                        </span>
                        <span>Started {formatDistanceToNow(startTime, { addSuffix: true })}</span>
                    </div>
                </div>

                {/* Per-pod status list */}
                <div className="flex-1 overflow-y-auto">
                    {sortedPods.length === 0 ? (
                        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                            <IconLoader className="animate-spin h-4 w-4 mr-2" />
                            Waiting for pods…
                        </div>
                    ) : (
                        <div className="divide-y">
                            {sortedPods.map(pod => {
                                const podName = pod.metadata?.name ?? ''
                                const restartCount = pod.status?.containerStatuses?.reduce((s, c) => s + (c.restartCount ?? 0), 0) ?? 0
                                const age = pod.metadata?.creationTimestamp
                                    ? formatDistanceToNow(new Date(pod.metadata.creationTimestamp), { addSuffix: true }).replace('about ', '')
                                    : ''
                                const isTerminating = !!pod.metadata?.deletionTimestamp

                                return (
                                    <div key={podName} className={`px-4 py-3 ${isTerminating ? 'opacity-50' : ''}`}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`h-2 w-2 rounded-full shrink-0 ${podPhaseColor(pod)}`} />
                                            <span className="text-xs font-mono truncate flex-1">{podName}</span>
                                            {isTerminating && (
                                                <Badge variant="destructive" className="text-[10px] py-0">Terminating</Badge>
                                            )}
                                            {restartCount > 0 && (
                                                <span className="text-[10px] text-amber-500 font-mono">↺{restartCount}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground pl-4">
                                            <span>{podStatusLabel(pod)}</span>
                                            <span className="ml-auto">{age}</span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Generation info */}
                {deployment && (
                    <div className="px-4 py-2 border-t text-[10px] text-muted-foreground shrink-0 flex gap-4">
                        <span>Generation {(deployment.metadata as any)?.generation ?? 0}</span>
                        <IconArrowRight className="h-3 w-3" />
                        <span>Observed {status?.observedGeneration ?? 0}</span>
                        {status?.conditions?.find((c: any) => c.type === 'ReplicaFailure')?.status === 'True' && (
                            <span className="text-destructive flex items-center gap-1">
                                <IconExclamationCircle className="h-3 w-3" />
                                ReplicaFailure
                            </span>
                        )}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}
