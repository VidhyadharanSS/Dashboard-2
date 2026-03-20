import { useCallback, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Copy } from 'lucide-react'
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { formatDate, getAge, parseBytes } from '@/lib/utils'
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

export function PVCListPage() {
  const { t } = useTranslation()

  const columnHelper = createColumnHelper<PersistentVolumeClaim>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-1 min-w-0 group/name">
            <div className="font-medium text-blue-500 hover:underline truncate">
              <Link
                to={`/persistentvolumeclaims/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
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
        ),
      }),
      columnHelper.accessor('status.phase', {
        header: t('common.status'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const phase = getValue() || 'Unknown'
          return (
            <Badge
              variant="outline"
              className={`px-1.5 ${
                phase === 'Bound'
                  ? 'border-green-500/40 text-green-600 dark:text-green-400'
                  : phase === 'Pending'
                    ? 'border-amber-500/40 text-amber-600'
                    : phase === 'Lost'
                      ? 'border-red-500/40 text-red-500'
                      : ''
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                phase === 'Bound' ? 'bg-green-500' :
                phase === 'Pending' ? 'bg-amber-500' :
                phase === 'Lost' ? 'bg-red-500' : 'bg-muted-foreground'
              }`} />
              {phase}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('spec.volumeName', {
        header: t('pvcs.volume'),
        cell: ({ getValue }) => {
          const volumeName = getValue()
          if (volumeName) {
            return (
              <div className="font-medium text-blue-500 hover:underline truncate max-w-[180px]">
                <Link to={`/persistentvolumes/${volumeName}`}>
                  {volumeName}
                </Link>
              </div>
            )
          }
          return <span className="text-muted-foreground">-</span>
        },
      }),
      columnHelper.accessor('spec.storageClassName', {
        header: t('pvcs.storageClass'),
        enableColumnFilter: true,
        cell: ({ getValue }) => {
          const scName = getValue()
          if (scName) {
            return (
              <div className="font-medium text-blue-500 hover:underline">
                <Link to={`/storageclasses/${scName}`}>{scName}</Link>
              </div>
            )
          }
          return <span className="text-muted-foreground">-</span>
        },
      }),
      columnHelper.accessor(
        (row) => parseBytes(row.spec?.resources?.requests?.storage || '0'),
        {
          id: 'capacity',
          header: t('pvcs.capacity'),
          cell: ({ row }) => {
            const requested = row.original.spec?.resources?.requests?.storage
            const actual = (row.original.status as any)?.capacity?.storage
            return (
              <div className="flex flex-col">
                <span className="text-sm font-mono tabular-nums">
                  {requested || '-'}
                </span>
                {actual && actual !== requested && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Actual: {actual}
                  </span>
                )}
              </div>
            )
          },
        }
      ),
      columnHelper.accessor('spec.accessModes', {
        header: t('pvcs.accessModes'),
        cell: ({ getValue }) => {
          const modes = getValue() || []
          return (
            <div className="flex flex-wrap gap-1">
              {modes.length > 0 ? modes.map((mode) => (
                <Badge key={mode} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {mode}
                </Badge>
              )) : <span className="text-muted-foreground">-</span>}
            </div>
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
        header: t('common.actions'),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <QuickYamlDialog
              resourceType="persistentvolumeclaims"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="persistentvolumeclaims"
              namespace={row.original.metadata?.namespace}
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper, t]
  )

  const pvcSearchFilter = useCallback(
    (pvc: PersistentVolumeClaim, query: string) => {
      return (
        pvc.metadata!.name!.toLowerCase().includes(query) ||
        (pvc.metadata!.namespace?.toLowerCase() || '').includes(query) ||
        (pvc.spec!.volumeName?.toLowerCase() || '').includes(query) ||
        (pvc.spec!.storageClassName?.toLowerCase() || '').includes(query) ||
        (pvc.status!.phase?.toLowerCase() || '').includes(query)
      )
    },
    []
  )

  return (
    <ResourceTable
      resourceName={'PersistentVolumeClaims'}
      columns={columns}
      searchQueryFilter={pvcSearchFilter}
    />
  )
}
  )
}
