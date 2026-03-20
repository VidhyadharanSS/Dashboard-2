import { useCallback, useMemo } from 'react'
import { IconCircleCheckFilled, IconLoader, IconX } from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { Job } from 'kubernetes-types/batch/v1'
import { Copy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

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

function getJobDuration(job: Job): string | null {
  if (!job.status?.startTime) return null
  const start = new Date(job.status.startTime).getTime()
  const end = job.status?.completionTime
    ? new Date(job.status.completionTime).getTime()
    : Date.now()
  const diff = end - start
  if (diff < 1000) return '<1s'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`
  return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`
}

export function JobListPage() {

  const columnHelper = createColumnHelper<Job>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: 'Name',
        cell: ({ row }) => {
          const containers = row.original.spec?.template?.spec?.containers || []
          const image = containers[0]?.image || ''
          const shortImage = image.includes('/') ? image.split('/').pop() || image : image
          return (
            <div className="flex flex-col gap-0.5 group/name">
              <div className="flex items-center gap-1 min-w-0">
                <div className="font-medium text-blue-500 hover:underline truncate">
                  <Link
                    to={`/jobs/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
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
                      }).catch(() => fallbackCopy(name))
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
            <Badge
              variant="outline"
              className={`px-1.5 w-fit ${
                status === 'Complete'
                  ? 'border-green-500/40 text-green-600 dark:text-green-400'
                  : status === 'Failed'
                    ? 'border-red-500/40 text-red-500'
                    : 'text-muted-foreground'
              }`}
            >
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
          const isComplete = succeeded >= completions
          return (
            <span className={`text-sm font-medium tabular-nums ${
              isComplete ? 'text-green-600 dark:text-green-400' :
              succeeded === 0 ? 'text-muted-foreground' : 'text-amber-500'
            }`}>
              {succeeded}/{completions}
            </span>
          )
        },
      }),
      columnHelper.display({
        id: 'duration',
        header: 'Duration',
        cell: ({ row }) => {
          const duration = getJobDuration(row.original)
          const isRunning = !row.original.status?.completionTime && row.original.status?.startTime
          if (!duration) return <span className="text-muted-foreground text-sm">-</span>
          return (
            <span className={`text-sm font-mono tabular-nums ${isRunning ? 'text-blue-500' : 'text-muted-foreground'}`}>
              {duration}
              {isRunning && <span className="ml-1 animate-pulse">⏱</span>}
            </span>
          )
        },
      }),
      columnHelper.accessor('status.startTime', {
        header: 'Started',
        cell: ({ getValue }) => {
          const startTime = getValue()
          if (!startTime) return <span className="text-muted-foreground text-sm">-</span>
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-muted-foreground text-sm">{getAge(startTime)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(startTime)}</TooltipContent>
            </Tooltip>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
        header: 'Age',
        cell: ({ getValue }) => (
          <Tooltip>
            <TooltipTrigger>
              <span className="text-muted-foreground text-sm">{getAge(getValue() || '')}</span>
            </TooltipTrigger>
            <TooltipContent>{formatDate(getValue() || '')}</TooltipContent>
          </Tooltip>
        ),
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
  )
}
