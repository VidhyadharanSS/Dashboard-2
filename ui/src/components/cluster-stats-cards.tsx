import {
  IconAlertCircleFilled,
  IconBox,
  IconCircleCheckFilled,
  IconFolders,
  IconNetwork,
  IconServer,
  IconAlertTriangle,
  IconClock,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { OverviewData } from '@/types/api'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface ClusterStatsCardsProps {
  stats?: OverviewData
  isLoading?: boolean
}

function HealthRing({ pct, size = 32 }: { pct: number; size?: number }) {  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (pct / 100) * circumference
  const center = size / 2
  const color = pct >= 90 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/20" />
        <circle cx={center} cy={center} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${progress} ${circumference}`} className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[8px] font-bold tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
      </div>
    </div>
  )
}

export function ClusterStatsCards({
  stats,
  isLoading,
}: ClusterStatsCardsProps) {
  const { t } = useTranslation()

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
              <div className="h-8 bg-muted rounded w-1/2"></div>
            </CardHeader>
          </Card>
        ))}
      </div>
    )
  }

  const failingPods = stats.failingPods ?? 0
  const pendingPods = stats.pendingPods ?? 0

  const statsConfig = [
    {
      label: t('nav.nodes'),
      value: stats.totalNodes,
      subValue: stats.readyNodes,
      icon: IconServer,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-950/50',
      routePath: '/nodes',
      extras: null,
    },
    {
      label: t('nav.pods'),
      value: stats.totalPods,
      subValue: stats.runningPods,
      icon: IconBox,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-950/50',
      routePath: '/pods',
      extras: (
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {failingPods > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/pods" className="inline-flex">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 bg-red-500/10 text-red-500 border-red-500/30 cursor-pointer hover:bg-red-500/20">
                    <IconAlertTriangle className="size-2.5" />
                    {failingPods} failing
                  </Badge>
                </Link>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Pods in CrashLoopBackOff, OOMKilled, or Failed state</TooltipContent>
            </Tooltip>
          )}
          {pendingPods > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/pods" className="inline-flex">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 bg-yellow-500/10 text-yellow-600 border-yellow-500/30 cursor-pointer hover:bg-yellow-500/20">
                    <IconClock className="size-2.5" />
                    {pendingPods} pending
                  </Badge>
                </Link>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Pods waiting to be scheduled or starting up</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      label: t('nav.namespaces'),
      value: stats.totalNamespaces,
      subValue: undefined as number | undefined,
      icon: IconFolders,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-950/50',
      routePath: '/namespaces',
      extras: null,
    },
    {
      label: t('nav.services'),
      value: stats.totalServices,
      subValue: undefined as number | undefined,
      icon: IconNetwork,
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-950/50',
      routePath: '/services',
      extras: null,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <TooltipProvider>
        {statsConfig.map((stat) => {
          const Icon = stat.icon
          const hasSubValue = stat.subValue !== undefined
          const healthPct = hasSubValue && stat.value > 0
            ? Math.round(((stat.subValue ?? stat.value) / stat.value) * 100)
            : -1
          const notReady = hasSubValue ? stat.value - (stat.subValue ?? stat.value) : 0
          const allReady = !hasSubValue || stat.subValue === stat.value

          return (
            <Card key={stat.label} className="@container/card group hover:shadow-md transition-all duration-200 card-elevated card-shine">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${stat.bgColor} group-hover:scale-105 transition-transform`}>
                      <Icon className={`size-6 ${stat.color}`} />
                    </div>
                    <div>
                      <CardDescription>{stat.label}</CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {stat.routePath ? (
                          <Link
                            to={stat.routePath}
                            className="hover:text-primary/80 hover:underline transition-colors cursor-pointer"
                          >
                            {stat.value}
                          </Link>
                        ) : (
                          stat.value
                        )}
                      </CardTitle>
                      <div className="text-sm text-muted-foreground">
                        {allReady ? (
                          <div className="flex items-center gap-1">
                            <IconCircleCheckFilled className="size-4 text-green-600 flex-shrink-0" />
                            All ready
                          </div>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 cursor-default">
                                <IconAlertCircleFilled className="size-4 text-red-600 flex-shrink-0" />
                                <span>{notReady} Not Ready</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-xs">
                              {stat.subValue} of {stat.value} are ready ({healthPct}%)
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {/* Extra badges (failing/pending pods etc.) */}
                      {stat.extras}
                    </div>
                  </div>
                  {healthPct >= 0 && (
                    <div className="hidden @[250px]/card:block">
                      <HealthRing pct={healthPct} />
                    </div>
                  )}
                </div>
              </CardHeader>
            </Card>
          )
        })}
      </TooltipProvider>
    </div>
  )
}