import { useState, useCallback } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useTranslation } from 'react-i18next'
import {
  IconChevronDown,
  IconChevronUp,
  IconActivity,
  IconLayoutDashboard,
  IconHeartRateMonitor,
  IconBolt,
  IconChartBar,
} from '@tabler/icons-react'

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
import { WorkloadDistributionWidget } from '@/components/dashboard/workload-distribution-widget'
import { PodRestartLeaderboard } from '@/components/dashboard/pod-restart-leaderboard'
import { ResourceTopConsumers } from '@/components/dashboard/resource-top-consumers'
import { RecentDeploymentsWidget } from '@/components/dashboard/recent-deployments-widget'
import { DeploymentRollbackWidget } from '@/components/dashboard/deployment-rollback-widget'

/* ─── Collapsible Section Header ─── */
function SectionHeader({
  icon: Icon,
  title,
  description,
  isOpen,
  onToggle,
  badge,
}: {
  icon: React.ElementType
  title: string
  description?: string
  isOpen: boolean
  onToggle: () => void
  badge?: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 group py-2 px-1 rounded-lg hover:bg-muted/30 transition-all duration-200"
    >
      <div className="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/15 transition-colors">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight group-hover:text-primary transition-colors">
            {title}
          </h2>
          {badge}
        </div>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="p-1 rounded-md text-muted-foreground group-hover:text-foreground transition-colors">
        {isOpen ? (
          <IconChevronUp className="h-4 w-4" />
        ) : (
          <IconChevronDown className="h-4 w-4" />
        )}
      </div>
    </button>
  )
}

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

  // Section collapse state — persisted in localStorage
  const [sections, setSections] = useState(() => {
    try {
      const stored = localStorage.getItem('overview-sections')
      return stored
        ? JSON.parse(stored)
        : { overview: true, workloads: true, pods: true, namespaces: true, operations: true, logs: true, metrics: true }
    } catch {
      return { overview: true, workloads: true, pods: true, namespaces: true, operations: true, logs: true, metrics: true }
    }
  })

  const toggleSection = useCallback((key: string) => {
    setSections((prev: Record<string, boolean>) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem('overview-sections', JSON.stringify(next))
      return next
    })
  }, [])

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
    <div className="flex flex-col gap-5 animate-page-enter">
      {/* Hero header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-gradient">{t('overview.title')}</h1>
        <p className="text-muted-foreground text-sm font-medium italic opacity-80">
          Navigate Kites cluster with ease!
        </p>
      </div>

      {/* Cluster stats cards — always visible */}
      <ClusterStatsCards stats={overview} isLoading={isLoading} />

      {!isDismissed &&
        user?.provider !== 'Anonymous' &&
        user?.roles?.some((role) => role.name === 'admin') && <SettingsHint />}

      {/* ─── Section 1: Overview & Health ─── */}
      <div>
        <SectionHeader
          icon={IconLayoutDashboard}
          title="Cluster Overview"
          description="Resource allocation, health score, and recent events"
          isOpen={sections.overview}
          onToggle={() => toggleSection('overview')}
        />
        {sections.overview && (
          <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <ResourceCharts
              data={overview?.resource}
              isLoading={isLoading}
              error={error}
              isError={isError}
            />
            <ClusterHealthScore overview={overview} isLoading={isLoading} />
            <RecentEvents />
          </div>
        )}
      </div>

      {/* ─── Section 2: Workloads ─── */}
      <div>
        <SectionHeader
          icon={IconChartBar}
          title="Workload Insights"
          description="Distribution of deployments, statefulsets, daemonsets, and jobs"
          isOpen={sections.workloads}
          onToggle={() => toggleSection('workloads')}
        />
        {sections.workloads && (
          <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
            {canAccess('deployments', 'list') && <WorkloadDistributionWidget />}
            {canAccess('pods', 'list') && <ResourceTopConsumers />}
          </div>
        )}
      </div>

      {/* ─── Section 3: Pod Health ─── */}
      <div>
        <SectionHeader
          icon={IconHeartRateMonitor}
          title="Pod Health"
          description="Failing pods, restart leaderboard, and container status"
          isOpen={sections.pods}
          onToggle={() => toggleSection('pods')}
        />
        {sections.pods && (
          <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
            {canAccess('pods', 'list') && <FailingPodsWidget />}
            {canAccess('pods', 'list') && <PodRestartLeaderboard />}
          </div>
        )}
      </div>

      {/* ─── Section 4: Namespace Health + Recent Deployments ─── */}
      <div>
        <SectionHeader
          icon={IconActivity}
          title="Namespaces & Deployments"
          description="Per-namespace pod health and recently created deployments"
          isOpen={sections.namespaces}
          onToggle={() => toggleSection('namespaces')}
        />
        {sections.namespaces && (
          <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
            {canAccess('pods', 'list') && <NamespaceHealthWidget />}
            {canAccess('deployments', 'list') && <RecentDeploymentsWidget />}
          </div>
        )}
      </div>

      {/* ─── Section 5: Operations (Rollback + Quick Actions) ─── */}
      <div>
        <SectionHeader
          icon={IconBolt}
          title="Quick Operations"
          description="Deployment rollback, search, terminal & log access"
          isOpen={sections.operations}
          onToggle={() => toggleSection('operations')}
        />
        {sections.operations && (
          <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
            {canAccess('deployments', 'update') && <DeploymentRollbackWidget />}
            <QuickActionsWidget />
          </div>
        )}
      </div>

      {/* ─── Section 6: Live System Logs ─── */}
      {canAccess('nodes', 'get') && (
        <div>
          <SectionHeader
            icon={IconActivity}
            title="Live System Logs"
            description="Real-time streaming access logs from the Kite server"
            isOpen={sections.logs}
            onToggle={() => toggleSection('logs')}
          />
          {sections.logs && (
            <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <LiveLogWidget />
            </div>
          )}
        </div>
      )}

      {/* ─── Section 7: CPU/Memory Charts if Prometheus enabled ─── */}
      {overview?.prometheusEnabled && (
        <div>
          <SectionHeader
            icon={IconChartBar}
            title="Resource Metrics"
            description="CPU, memory, and network utilization over time (Prometheus)"
            isOpen={sections.metrics}
            onToggle={() => toggleSection('metrics')}
          />
          {sections.metrics && (
            <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2 mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
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
      )}
    </div>
  )
}
