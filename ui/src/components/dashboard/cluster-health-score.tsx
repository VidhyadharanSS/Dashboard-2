/**
 * Feature: Cluster Health Score Dashboard Widget
 *
 * Computes a composite health score (0-100) from multiple signals:
 *  - Node readiness (30% weight)
 *  - Pod health ratio (30% weight)
 *  - Warning event ratio (20% weight)
 *  - Resource utilization pressure (20% weight)
 *
 * Displays as a radial gauge with animated arc + breakdown cards.
 */

import { useMemo } from 'react'
import {
    IconHeartbeat,
    IconServer,
    IconBox,
    IconAlertTriangle,
    IconCpu,
    IconTrendingUp,
    IconTrendingDown,
    IconMinus,
    IconChevronRight,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'

import { OverviewData } from '@/types/api'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { getPodStatus } from '@/lib/k8s'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Pod, Event } from 'kubernetes-types/core/v1'

interface ClusterHealthScoreProps {
    overview?: OverviewData
    isLoading?: boolean
}

function getScoreColor(score: number): string {
    if (score >= 90) return '#10b981' // emerald
    if (score >= 70) return '#f59e0b' // amber
    if (score >= 50) return '#f97316' // orange
    return '#ef4444' // red
}

function getScoreLabel(score: number): string {
    if (score >= 90) return 'Excellent'
    if (score >= 70) return 'Good'
    if (score >= 50) return 'Fair'
    return 'Critical'
}

function getScoreBgClass(score: number): string {
    if (score >= 90) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    if (score >= 70) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    if (score >= 50) return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    return 'bg-red-500/10 text-red-600 dark:text-red-400'
}

/* ─── SVG Radial Gauge ─── */
function RadialGauge({ score, size = 140 }: { score: number; size?: number }) {
    const strokeWidth = 10
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    const progress = (score / 100) * circumference
    const color = getScoreColor(score)
    const center = size / 2

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                {/* Background track */}
                <circle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    className="text-muted/30"
                />
                {/* Score arc */}
                <circle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={`${progress} ${circumference}`}
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold tabular-nums" style={{ color }}>
                    {score}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {getScoreLabel(score)}
                </span>
            </div>
        </div>
    )
}

/* ─── Score Breakdown Item ─── */
function BreakdownItem({
    icon: Icon,
    label,
    value,
    detail,
    weight,
    color,
    navigateTo,
}: {
    icon: React.ElementType
    label: string
    value: number
    detail: string
    weight: string
    color: string
    navigateTo?: string
}) {
    const navigate = useNavigate()
    const TrendIcon = value >= 90 ? IconTrendingUp : value >= 50 ? IconMinus : IconTrendingDown
    const trendColor = value >= 90 ? 'text-emerald-500' : value >= 50 ? 'text-amber-500' : 'text-red-500'

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md transition-all duration-150 group ${navigateTo ? 'hover:bg-muted/60 cursor-pointer active:scale-[0.98]' : 'hover:bg-muted/50 cursor-default'}`}
                        onClick={() => navigateTo && navigate(navigateTo)}
                    >
                        <div className={`p-1.5 rounded-md ${color} ${navigateTo ? 'group-hover:scale-110 transition-transform duration-150' : ''}`}>
                            <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <span className={`text-xs font-medium flex items-center gap-1 ${navigateTo ? 'group-hover:text-primary transition-colors' : ''}`}>
                                    {label}
                                    {navigateTo && <IconChevronRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />}
                                </span>
                                <div className="flex items-center gap-1">
                                    <TrendIcon className={`h-3 w-3 ${trendColor}`} />
                                    <span className="text-xs font-bold tabular-nums">{value}</span>
                                </div>
                            </div>
                            {/* Mini bar */}
                            <div className="h-1 rounded-full bg-muted mt-1 overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-700 ease-out"
                                    style={{
                                        width: `${value}%`,
                                        backgroundColor: getScoreColor(value),
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                    <div className="font-medium">{detail}</div>
                    <div className="text-muted-foreground">Weight: {weight}</div>
                    {navigateTo && <div className="text-primary mt-1">Click to view →</div>}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

/* ─── Main Component ─── */
export function ClusterHealthScore({ overview, isLoading }: ClusterHealthScoreProps) {
    const { canAccess } = usePermissions()

    const { data: pods } = useResources('pods', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('pods', 'list'),
    })

    const { data: events } = useResources('events', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('events', 'list'),
    })

    const scores = useMemo(() => {
        // Node readiness score (30% weight)
        let nodeScore = 100
        if (overview) {
            const { totalNodes, readyNodes } = overview
            nodeScore = totalNodes > 0 ? Math.round((readyNodes / totalNodes) * 100) : 100
        }
        const nodeDetail = overview
            ? `${overview.readyNodes}/${overview.totalNodes} nodes ready`
            : 'No data'

        // Pod health score (30% weight)
        let podScore = 100
        let podDetail = 'No data'
        if (pods && (pods as Pod[]).length > 0) {
            const allPods = pods as Pod[]
            const healthy = allPods.filter(p => {
                const status = getPodStatus(p)
                return ['Running', 'Completed', 'Succeeded'].includes(status.reason)
            }).length
            const progressing = allPods.filter(p => {
                const status = getPodStatus(p)
                return ['ContainerCreating', 'PodInitializing', 'Pending'].includes(status.reason)
            }).length
            const failing = allPods.length - healthy - progressing
            podScore = allPods.length > 0
                ? Math.round(((healthy + progressing * 0.5) / allPods.length) * 100)
                : 100
            podDetail = `${healthy} healthy, ${progressing} pending, ${failing} failing of ${allPods.length}`
        }

        // Warning events score (20% weight)
        // More warnings = lower score. 0 warnings = 100. 20+ warnings = 0.
        let eventScore = 100
        let eventDetail = 'No warnings'
        if (events && (events as Event[]).length > 0) {
            const allEvents = events as Event[]
            const warnings = allEvents.filter(e => e.type === 'Warning').length
            const total = allEvents.length
            eventScore = total > 0
                ? Math.max(0, Math.round(100 - (warnings / Math.max(total, 1)) * 200))
                : 100
            eventDetail = `${warnings} warnings in ${total} recent events`
        }

        // Resource utilization pressure (20% weight)
        // Score drops if CPU or memory request/limit ratios are too high
        let resourceScore = 100
        let resourceDetail = 'No metrics data'
        if (overview?.resource) {
            const { cpu, memory } = overview.resource
            const cpuPressure = cpu.allocatable > 0
                ? Math.min(cpu.requested / cpu.allocatable, 1)
                : 0
            const memPressure = memory.allocatable > 0
                ? Math.min(memory.requested / memory.allocatable, 1)
                : 0
            // Sweet spot is 40-70% utilization. Below 20% means underutilization (still ok).
            // Above 80% means pressure.
            const cpuScore = cpuPressure > 0.9 ? 20 : cpuPressure > 0.8 ? 50 : cpuPressure > 0.7 ? 75 : 100
            const memScore = memPressure > 0.9 ? 20 : memPressure > 0.8 ? 50 : memPressure > 0.7 ? 75 : 100
            resourceScore = Math.round((cpuScore + memScore) / 2)
            resourceDetail = `CPU: ${Math.round(cpuPressure * 100)}% requested, Memory: ${Math.round(memPressure * 100)}% requested`
        }

        // Weighted composite
        const composite = Math.round(
            nodeScore * 0.30 +
            podScore * 0.30 +
            eventScore * 0.20 +
            resourceScore * 0.20
        )

        return {
            composite: Math.min(100, Math.max(0, composite)),
            node: { score: nodeScore, detail: nodeDetail },
            pod: { score: podScore, detail: podDetail },
            event: { score: eventScore, detail: eventDetail },
            resource: { score: resourceScore, detail: resourceDetail },
        }
    }, [overview, pods, events])

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <div className="h-5 w-32 bg-muted rounded animate-pulse" />
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center py-6">
                        <div className="h-[140px] w-[140px] rounded-full bg-muted animate-pulse" />
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="overflow-hidden">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <div className={`p-1.5 rounded-md ${getScoreBgClass(scores.composite)}`}>
                        <IconHeartbeat className="h-4 w-4" />
                    </div>
                    Cluster Health
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
                <div className="flex flex-col items-center gap-4">
                    {/* Radial gauge */}
                    <RadialGauge score={scores.composite} />

                    {/* Breakdown */}
                    <div className="w-full space-y-0.5">
                        <BreakdownItem
                            icon={IconServer}
                            label="Nodes"
                            value={scores.node.score}
                            detail={scores.node.detail}
                            weight="30%"
                            color="bg-blue-500/10 text-blue-500"
                            navigateTo="/nodes"
                        />
                        <BreakdownItem
                            icon={IconBox}
                            label="Pods"
                            value={scores.pod.score}
                            detail={scores.pod.detail}
                            weight="30%"
                            color="bg-green-500/10 text-green-500"
                            navigateTo="/pods"
                        />
                        <BreakdownItem
                            icon={IconAlertTriangle}
                            label="Events"
                            value={scores.event.score}
                            detail={scores.event.detail}
                            weight="20%"
                            color="bg-amber-500/10 text-amber-500"
                            navigateTo="/events"
                        />
                        <BreakdownItem
                            icon={IconCpu}
                            label="Resources"
                            value={scores.resource.score}
                            detail={scores.resource.detail}
                            weight="20%"
                            color="bg-purple-500/10 text-purple-500"
                            navigateTo="/nodes"
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
