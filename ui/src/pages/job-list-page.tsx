import { useCallback, useMemo } from 'react'
import { IconCircleCheckFilled, IconLoader, IconX } from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { Job } from 'kubernetes-types/batch/v1'
import { Link } from 'react-router-dom'

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

export function JobListPage() {
  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<Job>()

  // Define columns for the job table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => {
          const containers = row.original.spec?.template?.spec?.containers || []
          const image = containers[0]?.image || ''
          const shortImage = image.includes('/') ? image.split('/').pop() || image : image
          return (
            <div className="flex flex-col gap-0.5">
              <div className="font-medium text-blue-500 hover:underline">
                <Link
                  to={`/jobs/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
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
      columnHelper.accessor('status.conditions', {
        header: 'Status',
        cell: ({ row }) => {
          const conditions = row.original.status?.conditions || []
          const completedCondition = conditions.find(
            (c) => c.type === 'Complete'
          )
          const failedCondition = conditions.find((c) => c.type === 'Failed')

          let status = 'Running'

          if (completedCondition?.status === 'True') {
            status = 'Complete'
          } else if (failedCondition?.status === 'True') {
            status = 'Failed'
          }

          return (
            <Badge variant="outline" className="text-muted-foreground px-1.5 w-fit">
              {status === 'Complete' ? (
                <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
              ) : status === 'Failed' ? (
                <IconX className="text-red-500 h-3.5 w-3.5" />
              ) : (
                <IconLoader className="animate-spin h-3.5 w-3.5" />
              )}
              {status}
            </Badge>
          )
        },
      }),
      columnHelper.accessor((row) => row.status, {
        id: 'completions',
        header: 'Completions',
        cell: ({ row }) => {
          const status = row.original.status
          const succeeded = status?.succeeded || 0
          const completions = row.original.spec?.completions || 1
          return `${succeeded}/${completions}`
        },
      }),
      columnHelper.accessor('status.startTime', {
        header: 'Started',
        cell: ({ getValue }) => {
          const startTime = getValue()
          if (!startTime) return '-'

          const dateStr = formatDate(startTime)

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
      columnHelper.accessor('status.completionTime', {
        header: 'Completed',
        cell: ({ getValue }) => {
          const completionTime = getValue()
          if (!completionTime) return '-'

          const dateStr = formatDate(completionTime)

          return (
            <span className="text-muted-foreground text-sm">{dateStr}</span>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: 'Age',
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
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <QuickYamlDialog
              resourceType="jobs"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="jobs"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper]
  )

  // Custom filter for job search
  const jobSearchFilter = useCallback((job: Job, query: string) => {
    return (
      job.metadata!.name!.toLowerCase().includes(query) ||
      (job.metadata!.namespace?.toLowerCase() || '').includes(query)
    )
  }, [])

  return (
    <ResourceTable
      resourceName="Jobs"
      columns={columns}
      searchQueryFilter={jobSearchFilter}
    />
  )
}
