import { useCallback, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Namespace } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ResourceTable } from '@/components/resource-table'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'

export function NamespaceListPage() {
  const { t } = useTranslation()

  const columnHelper = createColumnHelper<Namespace>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="font-medium text-blue-500 hover:underline">
            <Link to={`/namespaces/${row.original.metadata!.name}`}>
              {row.original.metadata!.name}
            </Link>
          </div>
        ),
      }),
      columnHelper.accessor('status.phase', {
        header: t('common.status'),
        enableColumnFilter: true,
        cell: ({ row }) => {
          const phase = row.original.status?.phase || 'Unknown'
          return (
            <Badge
              variant="outline"
              className={`px-1.5 ${
                phase === 'Active'
                  ? 'border-green-500/40 text-green-600 dark:text-green-400'
                  : phase === 'Terminating'
                    ? 'border-red-500/40 text-red-500'
                    : 'text-muted-foreground'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                  phase === 'Active'
                    ? 'bg-green-500'
                    : phase === 'Terminating'
                      ? 'bg-red-500'
                      : 'bg-muted-foreground'
                }`}
              />
              {phase}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => Object.keys(row.metadata?.labels || {}).length, {
        id: 'labels',
        header: 'Labels',
        cell: ({ row }) => {
          const labels = row.original.metadata?.labels || {}
          const labelCount = Object.keys(labels).length
          if (labelCount === 0) return <span className="text-muted-foreground text-sm">-</span>
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="text-xs cursor-default">
                  {labelCount} label{labelCount > 1 ? 's' : ''}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm text-xs">
                <div className="flex flex-col gap-0.5 font-mono">
                  {Object.entries(labels).slice(0, 8).map(([k, v]) => (
                    <span key={k}>{k}={v}</span>
                  ))}
                  {labelCount > 8 && <span className="text-muted-foreground">...and {labelCount - 8} more</span>}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: t('common.created'),
        cell: ({ getValue }) => {
          const dateStr = formatDate(getValue() || '')
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-muted-foreground text-sm">{getAge(getValue() as string)}</span>
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
              resourceType="namespaces"
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="namespaces"
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper, t]
  )

  const filter = useCallback((ns: Namespace, query: string) => {
    return (
      ns.metadata!.name!.toLowerCase().includes(query) ||
      (ns.status?.phase?.toLowerCase() || '').includes(query)
    )
  }, [])

  return (
    <ResourceTable
      resourceName="Namespaces"
      columns={columns}
      clusterScope={true}
      searchQueryFilter={filter}
    />
  )
}
