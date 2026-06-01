import { useCallback, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { BarChart2, Cpu, LayoutGrid, MemoryStick, Zap } from 'lucide-react'

import { NodeWithMetrics } from '@/types/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { MetricCell } from '@/components/metrics-cell'
import { NodeStatusIcon } from '@/components/node-status-icon'
import { DescribeDialog } from '@/components/describe-dialog'
import { ResourceTable } from '@/components/resource-table'
import { Button } from '@/components/ui/button'
import { ClusterHeatmap } from '@/components/cluster-heatmap'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FilterBar, FilterGroup } from '@/components/ui/filter-bar'
import { NodeLabelSelector } from '@/components/selector/node-label-selector'
import { NodeQuerySelector } from '@/components/selector/node-query-selector'
import { useSessionState } from '@/hooks/use-session-state'

/**
 * Enhanced status detection. Returns a pipe-delimited string of all relevant states.
 * Example: "Ready|DiskPressure" or "NotReady,SchedulingDisabled|MemoryPressure"
 */
function getNodeStatus(node: NodeWithMetrics): string {
  const conditions = node.status?.conditions || []
  const isUnschedulable = node.spec?.unschedulable || false

  // Check if node is ready first
  const readyCondition = conditions.find((c) => c.type === 'Ready')
  const isReady = readyCondition?.status === 'True'

  const statuses: string[] = []

  // Base state
  if (isUnschedulable) {
    statuses.push(isReady ? 'Ready,SchedulingDisabled' : 'NotReady,SchedulingDisabled')
  } else if (isReady) {
    statuses.push('Ready')
  } else {
    statuses.push('NotReady')
  }

  // Check for pressure and network issues as secondary flags
  const healthIssues = [
    { type: 'NetworkUnavailable', label: 'NetworkUnavailable' },
    { type: 'MemoryPressure', label: 'MemoryPressure' },
    { type: 'DiskPressure', label: 'DiskPressure' },
    { type: 'PIDPressure', label: 'PIDPressure' },
  ]

  healthIssues.forEach((issue) => {
    const condition = conditions.find((c) => c.type === issue.type)
    if (condition?.status === 'True') {
      statuses.push(issue.label)
    }
  })

  return statuses.join('|')
}

function getNodeRoles(node: NodeWithMetrics): string[] {
  const labels = node.metadata?.labels || {}
  const roles: string[] = []

  if (
    labels['node-role.kubernetes.io/master'] !== undefined ||
    labels['node-role.kubernetes.io/control-plane'] !== undefined
  ) {
    roles.push('control-plane')
  }

  if (labels['node-role.kubernetes.io/worker'] !== undefined) {
    roles.push('worker')
  }

  if (labels['node-role.kubernetes.io/etcd'] !== undefined) {
    roles.push('etcd')
  }

  Object.keys(labels).forEach((key) => {
    if (
      key.startsWith('node-role.kubernetes.io/') &&
      !['master', 'control-plane', 'worker', 'etcd'].includes(key.split('/')[1])
    ) {
      const role = key.split('/')[1]
      if (role && !roles.includes(role)) {
        roles.push(role)
      }
    }
  })

  return roles
}

function getNodeIP(node: NodeWithMetrics): string {
  const addresses = node.status?.addresses || []

  const internalIP = addresses.find((addr) => addr.type === 'InternalIP')
  if (internalIP) return internalIP.address

  const externalIP = addresses.find((addr) => addr.type === 'ExternalIP')
  if (externalIP) return externalIP.address

  const hostname = addresses.find((addr) => addr.type === 'Hostname')
  if (hostname) return hostname.address

  return 'N/A'
}

export function NodeListPage() {
  const { t } = useTranslation()
  const [selectedLabels, setSelectedLabels] = useSessionState<string>('nodes-selectedLabels', '')
  const [querySelector, setQuerySelector] = useSessionState<string>('nodes-querySelector', '')
  const [showHeatmap, setShowHeatmap] = useSessionState<boolean>('nodes-showHeatmap', false)
  const [statusFilter, setStatusFilter] = useSessionState<'all' | 'ready' | 'notready' | 'unschedulable'>('nodes-statusFilter', 'all')

  // Merge label selector and query selector: query selector takes priority if set, otherwise use label selector
  const effectiveLabelSelector = querySelector || selectedLabels

  const columnHelper = createColumnHelper<NodeWithMetrics>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        meta: { width: '12%' },
        cell: ({ row }) => (
          <div className="font-medium text-blue-500 hover:underline text-sm truncate">
            <Link to={`/nodes/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => getNodeStatus(row), {
        id: 'status',
        header: t('common.status'),
        meta: { width: '10%' },
        cell: ({ getValue }) => {
          const statusStr = getValue()
          const parts = statusStr.split('|')
          const mainStatus = parts[0]
          const issues = parts.slice(1)

          return (
            <div className="flex gap-1 items-center min-w-0 overflow-hidden">
              <Badge variant="outline" className="text-muted-foreground px-1.5 text-[10px] font-bold uppercase tracking-tight gap-1">
                <NodeStatusIcon status={mainStatus} className="size-3" />
                {mainStatus.replace('Ready,', '').replace('NotReady,', '')}
              </Badge>
              {issues.map((issue) => (
                <TooltipProvider key={issue}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="destructive" className="px-1 text-[9px] h-4 leading-none uppercase animate-pulse cursor-help">
                        {issue.replace('Pressure', '').replace('Unavailable', '!!')}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs font-semibold">{issue}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          )
        },
      }),
      columnHelper.accessor((row) => getNodeRoles(row), {
        id: 'roles',
        header: 'Roles',
        meta: { width: '7%' },
        cell: ({ getValue }) => {
          const roles = getValue()
          return (
            <div className="flex gap-1">
              {roles.map((role) => (
                <Badge
                  key={role}
                  variant={role === 'control-plane' ? 'default' : 'secondary'}
                  className="text-[10px] h-4 px-1"
                >
                  {role}
                </Badge>
              ))}
            </div>
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics, {
        id: 'pods',
        meta: { width: '8%' },
        header: () => (
          <span className="flex items-center gap-1">
            <BarChart2 className="size-3 text-blue-500" />
            Pods
          </span>
        ),
        cell: ({ row }) => {
          const pods = row.original.metrics?.pods || 0
          const limit = row.original.metrics?.podsLimit || 0
          const pct = limit > 0 ? (pods / limit) * 100 : 0
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={`/nodes/${row.original.metadata!.name}?tab=pods`}
                    className="flex items-center gap-1 group min-w-0"
                  >
                    <div className="w-8 shrink-0 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground group-hover:text-primary transition-colors">
                      {pods}/{limit}
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{pods} running / {limit} max ({pct.toFixed(0)}% capacity)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics?.cpuUsage || 0, {
        id: 'cpu',
        meta: { width: '11%' },
        header: () => (
          <span className="flex items-center gap-1">
            <Cpu className="size-3 text-indigo-500" />
            CPU
          </span>
        ),
        cell: ({ row }) => (
          <MetricCell
            metrics={row.original.metrics}
            type="cpu"
            limitLabel="Allocatable"
            showPercentage={true}
          />
        ),
      }),
      columnHelper.accessor((row) => row.metrics?.memoryUsage || 0, {
        id: 'memory',
        meta: { width: '12%' },
        header: () => (
          <span className="flex items-center gap-1">
            <MemoryStick className="size-3 text-emerald-500" />
            Memory
          </span>
        ),
        cell: ({ row }) => (
          <MetricCell
            metrics={row.original.metrics}
            type="memory"
            limitLabel="Allocatable"
            showPercentage={true}
          />
        ),
      }),
      columnHelper.accessor((row) => row.metrics?.gpuRequest || 0, {
        id: 'gpu',
        meta: { width: '8%' },
        header: () => (
          <span className="flex items-center gap-1">
            <Zap className="size-3 text-amber-500" />
            GPU
          </span>
        ),
        cell: ({ row }) => {
          const metrics = row.original.metrics
          if (!metrics?.gpuLimit || metrics.gpuLimit === 0) {
            return <span className="text-muted-foreground/40 text-xs">-</span>
          }
          return (
            <MetricCell
              metrics={metrics}
              type="gpu"
              limitLabel="Capacity"
              showPercentage={true}
              useRequestBasedUsage={true}
            />
          )
        },
      }),
      columnHelper.accessor((row) => getNodeIP(row), {
        id: 'ip',
        header: 'IP Address',
        meta: { width: '10%' },
        cell: ({ getValue }) => {
          const ip = getValue()
          return (
            <span className="text-xs font-mono text-muted-foreground">
              {ip}
            </span>
          )
        },
      }),
      columnHelper.accessor('status.nodeInfo.kubeletVersion', {
        header: 'Version',
        meta: { width: '6%' },
        cell: ({ getValue }) => {
          const version = getValue()
          return version ? (
            <span className="text-xs font-mono text-muted-foreground">{version}</span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.created'),
        meta: { width: '11%' },
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')
          return (
            <span className="text-muted-foreground text-xs truncate block">{dateStr}</span>
          )
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <DescribeDialog
              resourceType="nodes"
              name={row.original.metadata?.name || ''}
              compact
              triggerVariant="ghost"
            />
          </div>
        )
      }),
    ],
    [columnHelper, t]
  )

  const nodeSearchFilter = useCallback(
    (node: NodeWithMetrics, query: string) => {
      const lowerQuery = query.toLowerCase()
      const roles = getNodeRoles(node)
      const ip = getNodeIP(node)
      const status = getNodeStatus(node)

      let statusMatch = true
      if (statusFilter === 'ready') statusMatch = status.includes('Ready')
      else if (statusFilter === 'notready') statusMatch = status.includes('NotReady') || status.includes('Pressure') || status.includes('Unavailable')
      else if (statusFilter === 'unschedulable') statusMatch = status.includes('Disabled')

      if (!statusMatch) return false
      if (!query) return true

      return (
        node.metadata!.name!.toLowerCase().includes(lowerQuery) ||
        (node.status?.nodeInfo?.kubeletVersion?.toLowerCase() || '').includes(lowerQuery) ||
        status.toLowerCase().includes(lowerQuery) ||
        roles.some((role) => role.toLowerCase().includes(lowerQuery)) ||
        ip.toLowerCase().includes(lowerQuery)
      )
    },
    [statusFilter]
  )

  const filterToolbar = (
    <FilterBar className="flex-nowrap overflow-x-auto">
      <FilterGroup label="Status">
        <div className="flex items-center rounded-md border border-border/40 overflow-hidden">
          {(['all', 'ready', 'notready', 'unschedulable'] as const).map((s) => (
            <Button
              key={s}
              variant="ghost"
              size="sm"
              onClick={() => setStatusFilter(s)}
              className={`h-7 text-xs font-medium rounded-none border-none px-2.5 ${statusFilter === s
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                  : 'hover:bg-muted/60'
                }`}
            >
              {s === 'all' ? 'All' : s === 'ready' ? 'Ready' : s === 'notready' ? 'Not Ready' : 'Unschedulable'}
            </Button>
          ))}
        </div>
      </FilterGroup>
      <div className="w-px h-4 bg-border/50 shrink-0" />
      <FilterGroup>
        <Button
          variant={showHeatmap ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowHeatmap(!showHeatmap)}
          className="h-7 gap-1.5 text-xs font-medium"
        >
          <LayoutGrid className="h-3 w-3" />
          Heatmap
        </Button>
      </FilterGroup>
      <div className="w-px h-4 bg-border/50 shrink-0" />
      <FilterGroup label="Labels">
        <NodeLabelSelector onLabelsChange={(labels) => {
          setSelectedLabels(labels)
          if (labels) setQuerySelector('')
        }} />
      </FilterGroup>
      <div className="w-px h-4 bg-border/50 shrink-0" />
      <FilterGroup>
        <NodeQuerySelector
          onSelectorChange={(sel) => {
            setQuerySelector(sel)
            if (sel) setSelectedLabels('')
          }}
        />
      </FilterGroup>
    </FilterBar>
  )

  return (
    <div className="space-y-4">
      {showHeatmap && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
          <ClusterHeatmap selectedLabels={effectiveLabelSelector} />
        </div>
      )}
      <ResourceTable
        resourceName="Nodes"
        resourceType="nodes"
        columns={columns}
        clusterScope={true}
        searchQueryFilter={nodeSearchFilter}
        showCreateButton={false}
        defaultHiddenColumns={[
          'status_nodeInfo_kernelVersion',
          'status_nodeInfo_osImage',
        ]}
        extraToolbars={[filterToolbar]}
        labelSelector={effectiveLabelSelector}
      />
    </div>
  )
}