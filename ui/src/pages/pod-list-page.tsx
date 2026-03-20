import { useCallback, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Pod } from 'kubernetes-types/core/v1'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { PodWithMetrics } from '@/types/api'
import { getPodStatus } from '@/lib/k8s'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { MetricCell } from '@/components/metrics-cell'
import { PodStatusIcon } from '@/components/pod-status-icon'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ResourceTable } from '@/components/resource-table'
import { NodeLabelSelector } from '@/components/selector/node-label-selector'

function fallbackCopy(text: string) {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    toast.success('Name copied to clipboard')
  } catch {
    toast.error('Failed to copy to clipboard')
  }
}

export function PodListPage() {
  const { t } = useTranslation()
  const [nodeNameFilter, setNodeNameFilter] = useState<string[] | null>(null)

  const columnHelper = createColumnHelper<PodWithMetrics>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => {
          const status = getPodStatus(row.original).reason
          const isUnhealthy =
            status === 'Error' ||
            status === 'CrashLoopBackOff' ||
            status === 'OOMKilled' ||
            status === 'ImagePullBackOff' ||
            status === 'ErrImagePull' ||
            status === 'Failed'
          // Show the primary container image as a sub-label
          const firstContainer = row.original.spec?.containers?.[0]
          const image = firstContainer?.image || ''
          const shortImage = image.includes('/')
            ? image.split('/').pop() || image
            : image

          return (
            <div className="flex flex-col gap-0.5 min-w-0 group/name">
              <div className="flex items-center gap-1 min-w-0">
                <div
                  className={`font-medium hover:underline truncate ${isUnhealthy ? 'text-red-500' : 'text-blue-500'}`}
                >
                  <Link
                    to={`/pods/${row.original.metadata?.namespace || ''}/${row.original.metadata?.name || ''}`}
                  >
                    {row.original.metadata!.name}
                  </Link>
                </div>
                <button
                  className="opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    const name = row.original.metadata?.name || ''
                    if (navigator.clipboard && window.isSecureContext) {
                      navigator.clipboard.writeText(name).then(() => {
                        toast.success('Name copied to clipboard')
                      }).catch(() => {
                        fallbackCopy(name)
                      })
                    } else {
                      fallbackCopy(name)
                    }
                  }}
                  title="Copy name"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
              {shortImage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[11px] text-muted-foreground truncate max-w-[240px] font-mono cursor-default">
                      {shortImage}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="max-w-sm font-mono text-xs break-all"
                  >
                    {image}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor((row) => row.status?.containerStatuses, {
        id: 'containers',
        header: t('pods.ready'),
        cell: ({ row }) => {
          const s = getPodStatus(row.original)
          const isHealthy = s.readyContainers === s.totalContainers && s.totalContainers > 0
          return (
            <span
              className={`font-medium tabular-nums text-sm ${isHealthy ? 'text-green-600 dark:text-green-400' : s.readyContainers === 0 && s.totalContainers > 0 ? 'text-red-500' : 'text-amber-500'}`}
            >
              {s.readyContainers}/{s.totalContainers}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => getPodStatus(row).reason, {
        id: 'status',
        header: t('common.status'),
        enableColumnFilter: true,
        cell: ({ row }) => {
          const status = getPodStatus(row.original).reason
          return (
            <Badge
              variant="outline"
              className={`px-1.5 shrink-0 ${
                status === 'Running'
                  ? 'border-green-500/40 text-green-600 dark:text-green-400'
                  : status === 'Completed' || status === 'Succeeded'
                    ? 'border-muted text-muted-foreground'
                    : status === 'Pending' || status === 'ContainerCreating'
                      ? 'border-amber-500/40 text-amber-600'
                      : 'border-red-500/40 text-red-500'
              }`}
            >
              <PodStatusIcon status={status} />
              {status}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => row.status, {
        id: 'restarts',
        header: t('pods.restarts'),
        cell: ({ row }) => {
          const s = getPodStatus(row.original)
          // Highlight high restart counts
          const highRestarts =
            s.restartCount > 10
              ? 'text-red-500 font-semibold'
              : s.restartCount > 3
                ? 'text-amber-500'
                : 'text-muted-foreground'
          return (
            <span className={`text-sm tabular-nums ${highRestarts}`}>
              {s.restartString}
            </span>
          )
        },
      }),
      columnHelper.accessor((row) => row.metrics?.cpuUsage || 0, {
        id: 'cpu',
        header: 'CPU',
        cell: ({ row }) => (
          <MetricCell metrics={row.original.metrics} type="cpu" />
        ),
      }),
      columnHelper.accessor((row) => row.metrics?.memoryUsage || 0, {
        id: 'memory',
        header: 'Memory',
        cell: ({ row }) => (
          <MetricCell metrics={row.original.metrics} type="memory" />
        ),
      }),
      columnHelper.accessor((row) => row.status?.podIP, {
        id: 'podIP',
        header: 'IP',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm font-mono">
            {getValue() || '-'}
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.spec?.nodeName, {
        id: 'nodeName',
        header: t('pods.node'),
        enableColumnFilter: true,
        cell: ({ row }) =>
          row.original.spec?.nodeName ? (
            <div className="font-medium text-blue-500 hover:underline truncate max-w-[160px]">
              <Link to={`/nodes/${row.original.spec.nodeName}`}>
                {row.original.spec.nodeName}
              </Link>
            </div>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      }),
      columnHelper.accessor((row) => row.metadata?.creationTimestamp, {
        id: 'creationTimestamp',
        header: t('common.created'),
        cell: ({ getValue }) => (
          <Tooltip>
            <TooltipTrigger>
              <span className="text-muted-foreground text-sm">
                {getAge(getValue() || '')}
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatDate(getValue() || '')}</TooltipContent>
          </Tooltip>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <QuickYamlDialog
              resourceType="pods"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="pods"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper, t]
  )

  const podSearchFilter = useCallback(
    (pod: Pod, query: string) => {
      if (
        nodeNameFilter &&
        !nodeNameFilter.includes(pod.spec?.nodeName || '')
      ) {
        return false
      }
      return (
        (pod.metadata?.name?.toLowerCase() || '').includes(query) ||
        (pod.spec?.nodeName?.toLowerCase() || '').includes(query) ||
        (pod.status?.podIP?.toLowerCase() || '').includes(query) ||
        (pod.metadata?.namespace?.toLowerCase() || '').includes(query)
      )
    },
    [nodeNameFilter]
  )

  const extraToolbars = [
    <NodeLabelSelector onNodeNamesChange={setNodeNameFilter} />,
  ]

  return (
    <ResourceTable<Pod>
      resourceName="Pods"
      columns={columns}
      clusterScope={false}
      searchQueryFilter={podSearchFilter}
      enableLabelFilter={true}
      extraToolbars={extraToolbars}
    />
  )
}
