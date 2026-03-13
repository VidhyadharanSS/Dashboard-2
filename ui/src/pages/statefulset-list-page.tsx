import { useCallback, useMemo } from 'react'
import { IconCircleCheckFilled, IconLoader } from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { StatefulSet } from 'kubernetes-types/apps/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import * as api from '@/lib/api'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ResourceTable } from '@/components/resource-table'

export function StatefulSetListPage() {
  const { t } = useTranslation()

  const handleBatchRestart = useCallback(async (rows: StatefulSet[]) => {
    const promises = rows.map((row) => {
      const name = row.metadata?.name
      const namespace = row.metadata?.namespace
      if (!name || !namespace) return Promise.resolve()

      return api.restartResource('statefulsets', name, namespace)
        .then(() => toast.success(t('deployments.restartSuccess', { name, defaultValue: `Successfully restarted ${name}` })))
        .catch((error) => {
          console.error(`Failed to restart ${name}:`, error)
          toast.error(t('deployments.restartFailed', { name, error: error.message, defaultValue: `Failed to restart ${name}: ${error.message}` }))
          throw error
        })
    })

    try {
      await Promise.allSettled(promises)
    } catch (e) {
      // Errors handled individually
    }
  }, [t])

  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<StatefulSet>()

  // Define columns for the statefulset table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => {
          const containers = row.original.spec?.template?.spec?.containers || []
          const image = containers[0]?.image || ''
          const shortImage = image.includes('/') ? image.split('/').pop() || image : image
          return (
            <div className="flex flex-col gap-0.5">
              <div className="font-medium text-blue-500 hover:underline">
                <Link
                  to={`/statefulsets/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
                >
                  {row.original.metadata!.name}
                </Link>
              </div>
              {shortImage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[11px] text-muted-foreground truncate max-w-[220px] font-mono cursor-default">
                      {shortImage}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm font-mono text-xs break-all">{image}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )
        },
      }),
      columnHelper.accessor((row) => row.status?.readyReplicas ?? 0, {
        id: 'ready',
        header: t('deployments.ready'),
        cell: ({ row }) => {
          const status = row.original.status
          const ready = status?.readyReplicas || 0
          const desired = status?.replicas || 0
          const isHealthy = ready === desired && desired > 0
          return (
            <span className={`font-medium tabular-nums ${isHealthy ? 'text-green-600 dark:text-green-400' : ready === 0 && desired > 0 ? 'text-red-500' : 'text-amber-500'}`}>
              {ready}/{desired}
            </span>
          )
        },
      }),
      columnHelper.accessor('status.conditions', {
        header: t('common.status'),
        cell: ({ row }) => {
          const readyReplicas = row.original.status?.readyReplicas || 0
          const replicas = row.original.status?.replicas || 0
          const isAvailable = readyReplicas === replicas
          const status = isAvailable
            ? t('deployments.available')
            : t('common.loading')
          if (replicas === 0) {
            return (
              <Badge
                variant="secondary"
                className="text-muted-foreground px-1.5"
              >
                -
              </Badge>
            )
          }

          return (
            <Badge variant="outline" className="text-muted-foreground px-1.5">
              {isAvailable ? (
                <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
              ) : (
                <IconLoader className="animate-spin" />
              )}
              {status}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('spec.serviceName', {
        header: t('services.serviceName'),
        cell: ({ getValue }) => getValue() || '-',
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.created'),
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-muted-foreground text-sm">{getAge(getValue() || '')}</span>
              </TooltipTrigger>
              <TooltipContent>{dateStr}</TooltipContent>
            </Tooltip>
          )
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <QuickYamlDialog
              resourceType="statefulsets"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="statefulsets"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper, t]
  )

  // Custom filter for statefulset search
  const statefulSetSearchFilter = useCallback(
    (statefulSet: StatefulSet, query: string) => {
      return (
        statefulSet.metadata!.name!.toLowerCase().includes(query) ||
        (statefulSet.metadata!.namespace?.toLowerCase() || '').includes(
          query
        ) ||
        (statefulSet.spec!.serviceName?.toLowerCase() || '').includes(query)
      )
    },
    []
  )

  return (
    <ResourceTable
      resourceName={'StatefulSets'}
      resourceType="statefulsets"
      columns={columns}
      searchQueryFilter={statefulSetSearchFilter}
      onBatchRestart={handleBatchRestart}
      enableLabelFilter={true}
    />
  )
}
