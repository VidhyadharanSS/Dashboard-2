import { useCallback, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { BarChart2, Cpu, HardDrive, LayoutGrid, MemoryStick, Zap } from 'lucide-react'

import { NodeWithMetrics } from '@/types/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { MetricCell } from '@/components/metrics-cell'
import { NodeStatusIcon } from '@/components/node-status-icon'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ResourceTable } from '@/components/resource-table'
import { Button } from '@/components/ui/button'
import { ClusterHeatmap } from '@/components/cluster-heatmap'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

function getNodeStatus(node: NodeWithMetrics): string {
  const conditions = node.status?.conditions || []
  const isUnschedulable = node.spec?.unschedulable || false

  // Check if node is ready first
  const readyCondition = conditions.find((c) => c.type === 'Ready')
  const isReady = readyCondition?.status === 'True'

  if (isUnschedulable) {
    if (isReady) {
      return 'Ready,SchedulingDisabled'
    } else {
      return 'NotReady,SchedulingDisabled'
    }
  }

  if (isReady) {
    return 'Ready'
  }

  const networkUnavailable = conditions.find(
    (c) => c.type === 'NetworkUnavailable'
  )
  if (networkUnavailable?.status === 'True') {
    return 'NetworkUnavailable'
  }

  const memoryPressure = conditions.find((c) => c.type === 'MemoryPressure')
  if (memoryPressure?.status === 'True') {
    return 'MemoryPressure'
  }

  const diskPressure = conditions.find((c) => c.type === 'DiskPressure')
  if (diskPressure?.status === 'True') {
    return 'DiskPressure'
  }

  const pidPressure = conditions.find((c) => c.type === 'PIDPressure')
  if (pidPressure?.status === 'True') {
    return 'PIDPressure'
  }

  return 'NotReady'
}

function getNodeRoles(node: NodeWithMetrics): string[] {
  const labels = node.metadata?.labels || {}
  const roles: string[] = []

  // Check for common node role labels
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

  return roles // Do not assume a default role if none are found
}

// Prefer Internal IP, then External IP, then fallback to hostname
function getNodeIP(node: NodeWithMetrics): string {
  const addresses = node.status?.addresses || []

  const internalIP = addresses.find((addr) => addr.type === 'InternalIP')
  if (internalIP) {
    return internalIP.address
  }

  const externalIP = addresses.find((addr) => addr.type === 'ExternalIP')
  if (externalIP) {
    return externalIP.address
  }

  const hostname = addresses.find((addr) => addr.type === 'Hostname')
  if (hostname) {
    return hostname.address
  }

  return 'N/A'
}

import { FilterBar, FilterGroup } from '@/components/ui/filter-bar'
import { NodeLabelSelector } from '@/components/selector/node-label-selector'

export function NodeListPage() {
  const { t } = useTranslation()
  const [selectedLabels, setSelectedLabels] = useState<string>('')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'notready' | 'unschedulable'>('all')

  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<NodeWithMetrics>()

  // Define columns for the node table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium text-blue-500 hover:underline text-sm">
            <Link to={`/nodes/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor((row) => getNodeStatus(row), {
        id: 'status',
        header: t('common.status'),
        cell: ({ getValue }) => {
          const status = getValue()
          return (
            <Badge variant="outline" className="text-muted-foreground px-1.5 text-[10px] font-bold uppercase tracking-tight">
              <NodeStatusIcon status={status} />
              {status}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => getNodeRoles(row), {
        id: 'roles',
        header: 'Roles',
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
                    className="flex items-center gap-1.5 group"
                  >
                    <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
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
        header: () => (
          <span className="flex items-center gap-1">
            <Zap className="size-3 text-amber-500" />
            GPU
          </span>
        ),
        cell: ({ row }) => {
          const metrics = row.original.metrics
          if (!metrics?.gpuLimit || metrics.gpuLimit === 0) {
            return <span className="text-muted-foreground/40 text-xs">—</span>
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
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')
          return (
            <span className="text-muted-foreground text-xs">{dateStr}</span>
          )
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
            <QuickYamlDialog
              resourceType="nodes"
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="nodes"
              name={row.original.metadata?.name || ''}
            />
          </div>
        )
      }),
    ],
    [columnHelper, t]
  )

  // Custom filter for node search
  const nodeSearchFilter = useCallback(
    (node: NodeWithMetrics, query: string) => {
      const lowerQuery = query.toLowerCase()
      const roles = getNodeRoles(node)
      const ip = getNodeIP(node)
      const status = getNodeStatus(node)

      let statusMatch = true
      if (statusFilter === 'ready') statusMatch = status === 'Ready'
      else if (statusFilter === 'notready') statusMatch = status === 'NotReady' || status.includes('Pressure') || status.includes('Unavailable')
      else if (statusFilter === 'unschedulable') statusMatch = status.includes('Disabled')

      if (!statusMatch) return false

      if (!query) return true

      return (
        node.metadata!.name!.toLowerCase().includes(lowerQuery) ||
        (node.status?.nodeInfo?.kubeletVersion?.toLowerCase() || '').includes(
          lowerQuery
        ) ||
        status.toLowerCase().includes(lowerQuery) ||
        roles.some((role) => role.toLowerCase().includes(lowerQuery)) ||
        ip.toLowerCase().includes(lowerQuery)
      )
    },
    [statusFilter]
  )

  const filterToolbar = (
    <FilterBar>
      <FilterGroup label="Status">
        <Button
          variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setStatusFilter('all')}
          className="h-7 text-xs font-medium"
        >
          All
        </Button>
        <Button
          variant={statusFilter === 'ready' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setStatusFilter('ready')}
          className="h-7 text-xs font-medium"
        >
          Ready
        </Button>
        <Button
          variant={statusFilter === 'notready' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setStatusFilter('notready')}
          className="h-7 text-xs font-medium"
        >
          Not Ready
        </Button>
        <Button
          variant={statusFilter === 'unschedulable' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setStatusFilter('unschedulable')}
          className="h-7 text-xs font-medium"
        >
          Unschedulable
        </Button>
      </FilterGroup>
      <div className="w-px h-4 bg-border mx-1" />
      <FilterGroup label="View">
        <Button
          variant={showHeatmap ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowHeatmap(!showHeatmap)}
          className="h-7 gap-2 text-xs font-bold"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          {showHeatmap ? 'Overview: On' : 'Overview: Off'}
        </Button>
      </FilterGroup>
      <div className="w-px h-4 bg-border mx-1" />
      <FilterGroup label="Dynamic Filters">
        <NodeLabelSelector onLabelsChange={setSelectedLabels} />
      </FilterGroup>
    </FilterBar>
  )

  return (
    <div className="space-y-4">
      {showHeatmap && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
          <ClusterHeatmap selectedLabels={selectedLabels} />
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
        labelSelector={selectedLabels}
      />
    </div>
  )
}
