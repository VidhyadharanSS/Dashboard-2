/**
 * Feature: Workload Distribution Widget
 *
 * Provides a compact, at-a-glance visual summary of all workload types
 * (Deployments, StatefulSets, DaemonSets, Jobs, CronJobs) with health
 * status indicators (healthy / progressing / failing counts).
 *
 * - Donut ring per workload type
 * - Color-coded health segments
 * - Clickable to navigate to resource list pages
 * - Responsive grid layout
 */

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    IconLayersIntersect,
    IconDatabase,
    IconRepeat,
    IconChecklist,
    IconClock,
    IconLoader2,
    IconChartDonut,
} from '@tabler/icons-react'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { getDeploymentStatus } from '@/lib/k8s'
import { useNavigate } from 'react-router-dom'
import type { Deployment, StatefulSet, DaemonSet } from 'kubernetes-types/apps/v1'
import type { Job, CronJob } from 'kubernetes-types/batch/v1'

interface WorkloadHealth {
    type: string
    label: string
    icon: React.ElementType
    color: string
    bgColor: string
    path: string
    total: number
    healthy: number
    progressing: number
    failing: number
}

function MiniDonut({
    healthy,
    progressing,
    failing,
    total,
    size = 36,
}: {
    healthy: number
    progressing: number
    failing: number
    total: number
    size?: number
}) {
    if (total === 0) {
        return (
            <div style={{ width: size, height: size }} className="relative">
                <svg width={size} height={size} viewBox="0 0 36 36">
                    <circle
                        cx="18" cy="18" r="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        className="text-muted/30"
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-muted-foreground">0</span>
                </div>
            </div>
        )
    }

    const circumference = 2 * Math.PI * 14
    const healthyPct = (healthy / total) * circumference
    const progressingPct = (progressing / total) * circumference
    const failingPct = (failing / total) * circumference

    return (
        <div style={{ width: size, height: size }} className="relative">
            <svg width={size} height={size} viewBox="0 0 36 36" className="transform -rotate-90">
                {/* Background */}
                <circle
                    cx="18" cy="18" r="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="text-muted/20"
                />
                {/* Healthy arc (green) */}
                {healthy > 0 && (
                    <circle
                        cx="18" cy="18" r="14"
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="4"
                        strokeDasharray={`${healthyPct} ${circumference}`}
                        strokeDashoffset="0"
                        strokeLinecap="round"
                        className="transition-all duration-700"
                    />
                )}
                {/* Progressing arc (amber) */}
                {progressing > 0 && (
                    <circle
                        cx="18" cy="18" r="14"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="4"
                        strokeDasharray={`${progressingPct} ${circumference}`}
                        strokeDashoffset={`${-healthyPct}`}
                        strokeLinecap="round"
                        className="transition-all duration-700"
                    />
                )}
                {/* Failing arc (red) */}
                {failing > 0 && (
                    <circle
                        cx="18" cy="18" r="14"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth="4"
                        strokeDasharray={`${failingPct} ${circumference}`}
                        strokeDashoffset={`${-(healthyPct + progressingPct)}`}
                        strokeLinecap="round"
                        className="transition-all duration-700"
                    />
                )}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-bold tabular-nums">{total}</span>
            </div>
        </div>
    )
}

function WorkloadRow({ wl, navigate }: { wl: WorkloadHealth; navigate: (path: string) => void }) {
    const Icon = wl.icon
    const healthPct = wl.total > 0 ? Math.round((wl.healthy / wl.total) * 100) : 100

    return (
        <button
            onClick={() => navigate(wl.path)}
            className="w-full group flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/60 transition-all text-left border border-transparent hover:border-border/50"
        >
            {/* Donut */}
            <MiniDonut
                healthy={wl.healthy}
                progressing={wl.progressing}
                failing={wl.failing}
                total={wl.total}
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon className={`h-3.5 w-3.5 ${wl.color}`} />
                    <span className="text-xs font-semibold group-hover:text-primary transition-colors">
                        {wl.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                        {healthPct}%
                    </span>
                </div>
                {/* Mini stats row */}
                <div className="flex items-center gap-2 text-[10px]">
                    {wl.healthy > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            ✓ {wl.healthy}
                        </span>
                    )}
                    {wl.progressing > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                            ⟳ {wl.progressing}
                        </span>
                    )}
                    {wl.failing > 0 && (
                        <span className="text-red-600 dark:text-red-400 font-medium">
                            ✗ {wl.failing}
                        </span>
                    )}
                    {wl.total === 0 && (
                        <span className="text-muted-foreground">No resources</span>
                    )}
                </div>
            </div>
        </button>
    )
}

export function WorkloadDistributionWidget() {
    const navigate = useNavigate()
    const { canAccess } = usePermissions()

    const { data: deployments, isLoading: loadDep } = useResources('deployments', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('deployments', 'list'),
        reduce: true,
    })
    const { data: statefulsets, isLoading: loadSts } = useResources('statefulsets', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('statefulsets', 'list'),
        reduce: true,
    })
    const { data: daemonsets, isLoading: loadDs } = useResources('daemonsets', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('daemonsets', 'list'),
        reduce: true,
    })
    const { data: jobs, isLoading: loadJobs } = useResources('jobs', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('jobs', 'list'),
        reduce: true,
    })
    const { data: cronjobs, isLoading: loadCj } = useResources('cronjobs', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('cronjobs', 'list'),
        reduce: true,
    })

    const isLoading = loadDep || loadSts || loadDs || loadJobs || loadCj

    const workloads = useMemo<WorkloadHealth[]>(() => {
        // Deployments
        const deps = (deployments || []) as Deployment[]
        let depHealthy = 0, depProg = 0, depFail = 0
        deps.forEach(d => {
            const s = getDeploymentStatus(d)
            if (s === 'Available') depHealthy++
            else if (s === 'Progressing') depProg++
            else if (['Scaled Down', 'Paused'].includes(s)) depHealthy++ // consider these non-failing
            else depFail++
        })

        // StatefulSets
        const stsList = (statefulsets || []) as StatefulSet[]
        let stsHealthy = 0, stsProg = 0, stsFail = 0
        stsList.forEach(s => {
            const desired = s.spec?.replicas ?? 1
            const ready = s.status?.readyReplicas ?? 0
            if (ready >= desired && desired > 0) stsHealthy++
            else if (ready > 0) stsProg++
            else if (desired === 0) stsHealthy++
            else stsFail++
        })

        // DaemonSets
        const dsList = (daemonsets || []) as DaemonSet[]
        let dsHealthy = 0, dsProg = 0, dsFail = 0
        dsList.forEach(d => {
            const desired = d.status?.desiredNumberScheduled ?? 0
            const ready = d.status?.numberReady ?? 0
            if (ready >= desired && desired > 0) dsHealthy++
            else if (ready > 0) dsProg++
            else if (desired === 0) dsHealthy++
            else dsFail++
        })

        // Jobs
        const jobList = (jobs || []) as Job[]
        let jobHealthy = 0, jobProg = 0, jobFail = 0
        jobList.forEach(j => {
            const succeeded = j.status?.succeeded ?? 0
            const failed = j.status?.failed ?? 0
            const active = j.status?.active ?? 0
            if (succeeded > 0 && active === 0) jobHealthy++
            else if (active > 0) jobProg++
            else if (failed > 0) jobFail++
            else jobProg++
        })

        // CronJobs
        const cjList = (cronjobs || []) as CronJob[]
        let cjHealthy = 0, cjProg = 0, cjFail = 0
        cjList.forEach(cj => {
            const active = cj.status?.active?.length ?? 0
            const suspended = cj.spec?.suspend ?? false
            if (suspended) cjHealthy++ // suspended is not failing
            else if (active > 0) cjProg++
            else cjHealthy++
        })

        return [
            {
                type: 'deployments', label: 'Deployments', icon: IconLayersIntersect,
                color: 'text-blue-500', bgColor: 'bg-blue-500/10', path: '/deployments',
                total: deps.length, healthy: depHealthy, progressing: depProg, failing: depFail,
            },
            {
                type: 'statefulsets', label: 'StatefulSets', icon: IconDatabase,
                color: 'text-indigo-500', bgColor: 'bg-indigo-500/10', path: '/statefulsets',
                total: stsList.length, healthy: stsHealthy, progressing: stsProg, failing: stsFail,
            },
            {
                type: 'daemonsets', label: 'DaemonSets', icon: IconRepeat,
                color: 'text-purple-500', bgColor: 'bg-purple-500/10', path: '/daemonsets',
                total: dsList.length, healthy: dsHealthy, progressing: dsProg, failing: dsFail,
            },
            {
                type: 'jobs', label: 'Jobs', icon: IconChecklist,
                color: 'text-amber-500', bgColor: 'bg-amber-500/10', path: '/jobs',
                total: jobList.length, healthy: jobHealthy, progressing: jobProg, failing: jobFail,
            },
            {
                type: 'cronjobs', label: 'CronJobs', icon: IconClock,
                color: 'text-orange-500', bgColor: 'bg-orange-500/10', path: '/cronjobs',
                total: cjList.length, healthy: cjHealthy, progressing: cjProg, failing: cjFail,
            },
        ]
    }, [deployments, statefulsets, daemonsets, jobs, cronjobs])

    // Aggregate totals
    const totals = useMemo(() => {
        let total = 0, healthy = 0, failing = 0
        workloads.forEach(w => {
            total += w.total
            healthy += w.healthy
            failing += w.failing
        })
        return { total, healthy, failing }
    }, [workloads])

    return (
        <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-blue-500/10 rounded-md">
                        <IconChartDonut className="h-4 w-4 text-blue-500" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        Workload Distribution
                    </CardTitle>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                    <Badge variant="outline" className="h-5 text-[10px] font-mono gap-1">
                        {totals.total} total
                    </Badge>
                    {totals.failing > 0 && (
                        <Badge variant="destructive" className="h-5 text-[10px] gap-0.5">
                            {totals.failing} failing
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-1 pt-3 pb-2 px-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {workloads.map(wl => (
                            <WorkloadRow key={wl.type} wl={wl} navigate={navigate} />
                        ))}

                        {/* Legend */}
                        <div className="flex items-center justify-center gap-4 pt-3 border-t border-border/30 mt-2">
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                Healthy
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <div className="w-2 h-2 rounded-full bg-amber-500" />
                                Progressing
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <div className="w-2 h-2 rounded-full bg-red-500" />
                                Failing
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
