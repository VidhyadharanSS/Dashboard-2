import { useCallback, useMemo } from 'react'
import {
  IconPlayerPause,
  IconPlayerPlay,
} from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { CronJob } from 'kubernetes-types/batch/v1'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { updateResource } from '@/lib/api'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

export function CronJobListPage() {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<CronJob>()

  const handleToggleSuspend = useCallback(async (cronjob: CronJob) => {
    const ns = cronjob.metadata?.namespace
    const name = cronjob.metadata?.name
    if (!ns || !name) return
    try {
      const updated = JSON.parse(JSON.stringify(cronjob)) as CronJob
      updated.spec!.suspend = !(cronjob.spec?.suspend ?? false)
      await updateResource('cronjobs', name, ns, updated)
      toast.success(updated.spec?.suspend ? `${name} suspended` : `${name} resumed`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed: ${msg}`)
    }
  }, [])

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => {
          const containers = row.original.spec?.jobTemplate?.spec?.template?.spec?.containers || []
          const image = containers[0]?.image || ''
          const shortImage = image.includes('/') ? image.split('/').pop() || image : image
          return (
            <div className="flex flex-col gap-0.5 group/name">
              <div className="flex items-center gap-1 min-w-0">
                <div className="font-medium text-blue-500 hover:underline truncate">
                  <Link
                    to={`/cronjobs/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
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
      columnHelper.display({
        id: 'schedule',
        header: 'Schedule',
        cell: ({ row }) => (
          <code className="text-xs bg-muted/50 px-1.5 py-0.5 rounded font-mono">
            {row.original.spec?.schedule || '-'}
          </code>
        ),
      }),
      columnHelper.display({
        id: 'suspend',
        header: 'State',
        cell: ({ row }) => {
          const isSuspended = row.original.spec?.suspend ?? false
          return (
            <Badge
              variant="outline"
              className={`px-1.5 ${
                isSuspended
                  ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                  : 'border-green-500/40 text-green-600 dark:text-green-400'
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                isSuspended ? 'bg-amber-500' : 'bg-green-500'
              }`} />
              {isSuspended ? 'Suspended' : 'Active'}
            </Badge>
          )
        },
      }),
      columnHelper.display({
        id: 'active',
        header: 'Active Jobs',
        cell: ({ row }) => {
          const active = row.original.status?.active?.length || 0
          return (
            <span className={`text-sm font-medium tabular-nums ${active > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
              {active}
            </span>
          )
        },
      }),
      columnHelper.display({
        id: 'lastSchedule',
        header: 'Last Schedule',
        cell: ({ row }) => {
          const lastSchedule = row.original.status?.lastScheduleTime
          if (!lastSchedule) {
            return <span className="text-sm text-muted-foreground">Never</span>
          }
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-sm text-muted-foreground">
                  {getAge(lastSchedule as string)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(lastSchedule)}</TooltipContent>
            </Tooltip>
          )
        },
      }),
      columnHelper.display({
        id: 'lastSuccess',
        header: 'Last Success',
        cell: ({ row }) => {
          const lastSuccess = row.original.status?.lastSuccessfulTime
          if (!lastSuccess) {
            return <span className="text-sm text-muted-foreground">-</span>
          }
          return (
            <Tooltip>
              <TooltipTrigger>
                <span className="text-sm text-green-600 dark:text-green-400">
                  {getAge(lastSuccess as string)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(lastSuccess)}</TooltipContent>
            </Tooltip>
          )
        },
      }),
      columnHelper.accessor('metadata.creationTimestamp', {
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
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleSuspend(row.original)
                  }}
                >
                  {row.original.spec?.suspend ? (
                    <IconPlayerPlay className="h-3.5 w-3.5" />
                  ) : (
                    <IconPlayerPause className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {row.original.spec?.suspend ? 'Resume' : 'Suspend'}
              </TooltipContent>
            </Tooltip>
            <QuickYamlDialog
              resourceType="cronjobs"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="cronjobs"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper, t, handleToggleSuspend]
  )

  const cronJobSearchFilter = useCallback((cronjob: CronJob, query: string) => {
    const lowerQuery = query.toLowerCase()
    const name = cronjob.metadata?.name?.toLowerCase() || ''
    const namespace = cronjob.metadata?.namespace?.toLowerCase() || ''
    const schedule = cronjob.spec?.schedule?.toLowerCase() || ''
    return name.includes(lowerQuery) || namespace.includes(lowerQuery) || schedule.includes(lowerQuery)
  }, [])

  return (
    <ResourceTable
      resourceName="CronJobs"
      resourceType="cronjobs"
      columns={columns}
      searchQueryFilter={cronJobSearchFilter}
    />
  )
}
