import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'

import { useOverview, useResourceUsageHistory } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import NetworkUsageChart from '@/components/chart/network-usage-chart'
import ResourceUtilizationChart from '@/components/chart/resource-utilization'
import { ClusterStatsCards } from '@/components/cluster-stats-cards'
import { ClusterHealthScore } from '@/components/dashboard/cluster-health-score'
import { RecentEvents } from '@/components/recent-events'
import { ResourceCharts } from '@/components/resources-charts'
import { SettingsHint } from '@/components/settings-hint'
import { LiveLogWidget } from '@/components/dashboard/live-log-widget'
import { QuickActionsWidget } from '@/components/dashboard/quick-actions-widget'
import { FailingPodsWidget } from '@/components/dashboard/failing-pods-widget'
import { NamespaceHealthWidget } from '@/components/dashboard/namespace-health-widget'

export function Overview() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { canAccess } = usePermissions()
  const [isDismissed] = useState(() => {
    const dismissed = localStorage.getItem('settings-hint-dismissed')
    if (dismissed === 'true') {
      return true
    }
    return false
  })

  const [timeRange] = useState('30m')
  const { data: overview, isLoading, error, isError } = useOverview()

  const {
    data: resourceUsage,
    isLoading: isLoadingResourceUsage,
    error: errorResourceUsage,
  } = useResourceUsageHistory(timeRange, {
    enabled: overview?.prometheusEnabled ?? false,
  })

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <h2 className="text-lg font-semibold">{t('overview.failedToLoad')}</h2>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('overview.unknownError')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 animate-page-enter">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-gradient">{t('overview.title')}</h1>
        <p className="text-muted-foreground text-sm font-medium italic opacity-80">
          Navigate Kites cluster with ease!
        </p>
      </div>

      <ClusterStatsCards stats={overview} isLoading={isLoading} />

      {!isDismissed &&
        user?.provider !== 'Anonymous' &&
        user?.roles?.some((role) => role.name === 'admin') && <SettingsHint />}

      {/* Row 1: Resource usage donut + Health Score + Recent Events */}
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-3">
        <ResourceCharts
          data={overview?.resource}
          isLoading={isLoading}
          error={error}
          isError={isError}
        />
        <ClusterHealthScore overview={overview} isLoading={isLoading} />
        <RecentEvents />
      </div>

      {/* Row 2: Failing Pods + Namespace Health */}
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
        {canAccess('pods', 'list') && <FailingPodsWidget />}
        {canAccess('pods', 'list') && <NamespaceHealthWidget />}
      </div>

      {/* Row 4: Live System Logs + Quick Actions (admin) */}
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
        {canAccess('nodes', 'get') && <LiveLogWidget />}
        <QuickActionsWidget />
      </div>

      {/* CPU/Memory Charts if Prometheus enabled */}
      {overview?.prometheusEnabled && (
        <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
          <ResourceUtilizationChart
            cpu={resourceUsage?.cpu || []}
            memory={resourceUsage?.memory || []}
            isLoading={isLoadingResourceUsage}
            error={errorResourceUsage}
          />

          <NetworkUsageChart
            networkIn={resourceUsage?.networkIn || []}
            networkOut={resourceUsage?.networkOut || []}
            isLoading={isLoadingResourceUsage}
            error={errorResourceUsage}
          />
        </div>
      )}
    </div>
  )
}
