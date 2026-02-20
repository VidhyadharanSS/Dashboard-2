import { useCallback, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Filter, LayoutGrid } from 'lucide-react'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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

const NODE_POOL_FILTERS = {
  'NodePool-common (CRMIntelligencepy)': 'kites.zoho.com/nodepool-common',
  'Nodepool-weaviate (For weaviate)': 'kites.zoho.com/nodepool-weaviate',
}

const CATEGORY_FILTERS = {
  'Main': 'kites.zoho.com/nodepool-crmintelligencepy-default',
  'Lab': 'kites.zoho.com/nodepool-crmintelligencepy-lab',
  'Premium': 'kites.zoho.com/nodepool-crmintelligencepy-premium',
}

const SHARING_FILTERS = {
  'LLM (unshared)': 'kites.zoho.com/gpu-unshared',
  'non LLM (shared)': 'kites.zoho.com/gpu-shared',
}

export function NodeListPage() {
  const { t } = useTranslation()
  const [nodePoolFilter, setNodePoolFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sharingFilter, setSharingFilter] = useState<string>('all')

  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<NodeWithMetrics>()

  // Define columns for the node table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium text-blue-500 hover:underline">
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
            <Badge variant="outline" className="text-muted-foreground px-1.5">
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
            <div>
              {roles.map((role) => (
                <Badge
                  key={role}
                  variant={role === 'control-plane' ? 'default' : 'secondary'}
                  className="text-xs"
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
        header: 'Pods',
        cell: ({ row }) => (
          <Link
            to={`/nodes/${row.original.metadata!.name}?tab=pods`}
            className="text-muted-foreground hover:text-primary/80 hover:underline transition-colors cursor-pointer"
          >
            {row.original.metrics?.pods || 0} /{' '}
            {row.original.metrics?.podsLimit || 0}
          </Link>
        ),
      }),
      columnHelper.accessor((row) => row.metrics?.cpuUsage || 0, {
        id: 'cpu',
        header: 'CPU',
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
        header: 'Memory',
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
        header: 'GPU',
        cell: ({ row }) => (
          <MetricCell
            metrics={row.original.metrics}
            type="gpu"
            limitLabel="Capacity"
            showPercentage={true}
            useRequestBasedUsage={true}
          />
        ),
      }),
      columnHelper.accessor((row) => getNodeIP(row), {
        id: 'ip',
        header: 'IP Address',
        cell: ({ getValue }) => {
          const ip = getValue()
          return (
            <span className="text-sm font-mono text-muted-foreground">
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
            <span className="text-sm">{version}</span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        },
      }),
      columnHelper.accessor('status.nodeInfo.kernelVersion', {
        header: 'Kernel Version',
        cell: ({ getValue }) => {
          const kernelVersion = getValue()
          return kernelVersion ? (
            <span className="text-sm">{kernelVersion}</span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )
        },
      }),
      columnHelper.accessor('status.nodeInfo.osImage', {
        header: 'OS Image',
        cell: ({ getValue }) => {
          const osImage = getValue()
          return osImage ? (
            <span className="text-sm">{osImage}</span>
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
            <span className="text-muted-foreground text-sm">{dateStr}</span>
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
      return (
        node.metadata!.name!.toLowerCase().includes(lowerQuery) ||
        (node.status?.nodeInfo?.kubeletVersion?.toLowerCase() || '').includes(
          lowerQuery
        ) ||
        getNodeStatus(node).toLowerCase().includes(lowerQuery) ||
        roles.some((role) => role.toLowerCase().includes(lowerQuery)) ||
        ip.toLowerCase().includes(lowerQuery)
      )
    },
    []
  )

  // Label filter logic
  const labelFilter = useMemo(() => {
    const parts = []
    if (nodePoolFilter !== 'all') {
      parts.push(NODE_POOL_FILTERS[nodePoolFilter as keyof typeof NODE_POOL_FILTERS])
    }
    if (categoryFilter !== 'all') {
      parts.push(CATEGORY_FILTERS[categoryFilter as keyof typeof CATEGORY_FILTERS])
    }
    if (sharingFilter !== 'all') {
      parts.push(SHARING_FILTERS[sharingFilter as keyof typeof SHARING_FILTERS])
    }
    return parts.length > 0 ? parts.join(',') : undefined
  }, [nodePoolFilter, categoryFilter, sharingFilter])

  // Filter toolbar component
  const [showHeatmap, setShowHeatmap] = useState(false)

  const filterToolbar = (
    <div className="flex items-center gap-2">
      <Button
        variant={showHeatmap ? 'secondary' : 'outline'}
        size="sm"
        onClick={() => setShowHeatmap(!showHeatmap)}
        className="gap-2"
      >
        <LayoutGrid className="h-4 w-4" />
        {showHeatmap ? 'Hide Overview' : 'Show Overview'}
      </Button>
      <div className="w-px h-6 bg-border mx-1" />
      <Filter className="h-4 w-4 text-muted-foreground mr-1" />
      <Select
        value={nodePoolFilter}
        onValueChange={setNodePoolFilter}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Node Pool" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Pools</SelectItem>
          {Object.keys(NODE_POOL_FILTERS).map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={categoryFilter}
        onValueChange={setCategoryFilter}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Setup" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Setup</SelectItem>
          {Object.keys(CATEGORY_FILTERS).map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={sharingFilter}
        onValueChange={setSharingFilter}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="GPU Sharing" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any Mode</SelectItem>
          {Object.keys(SHARING_FILTERS).map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="space-y-4">
      {showHeatmap && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
          <ClusterHeatmap />
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
        labelSelector={labelFilter}
      />
    </div>
  )
}
