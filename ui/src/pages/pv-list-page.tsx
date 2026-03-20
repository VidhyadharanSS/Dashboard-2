import { useCallback, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Copy } from 'lucide-react'
import { PersistentVolume } from 'kubernetes-types/core/v1'
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

export function PVListPage() {
  const { t } = useTranslation()
  const columnHelper = createColumnHelper<PersistentVolume>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-1 min-w-0 group/name">
            <div className="font-medium text-blue-500 hover:underline truncate">
              <Link to={`/persistentvolumes/${row.original.metadata!.name}`}>
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
                  : phase === 'Available'
                    ? 'border-blue-500/40 text-blue-600 dark:text-blue-400'
                    : phase === 'Released'
                      ? 'border-amber-500/40 text-amber-600'
                      : phase === 'Failed'
                        ? 'border-red-500/40 text-red-500'
                        : ''
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                phase === 'Bound' ? 'bg-green-500' :
                phase === 'Available' ? 'bg-blue-500' :
                phase === 'Released' ? 'bg-amber-500' :
                phase === 'Failed' ? 'bg-red-500' : 'bg-muted-foreground'
              }`} />
              {phase}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('spec.storageClassName', {
        header: t('pvs.storageClass'),
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
        (row) => parseBytes(row.spec?.capacity?.storage || '0'),
        {
          id: 'capacity',
          header: t('pvs.capacity'),
          cell: ({ row }) => (
            <span className="text-sm font-mono tabular-nums">
              {row.original.spec?.capacity?.storage || '-'}
            </span>
          ),
        }
      ),
      columnHelper.accessor('spec.accessModes', {
        header: t('pvs.accessModes'),
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
      columnHelper.accessor('spec.persistentVolumeReclaimPolicy', {
        header: t('pvs.reclaimPolicy'),
        cell: ({ getValue }) => {
          const policy = getValue()
          if (!policy) return <span className="text-muted-foreground">-</span>
          return (
            <Badge
              variant="outline"
              className={`text-xs ${
                policy === 'Delete' ? 'border-red-500/30 text-red-600 dark:text-red-400' :
                policy === 'Retain' ? 'border-blue-500/30 text-blue-600 dark:text-blue-400' :
                ''
              }`}
            >
              {policy}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('spec.claimRef', {
        header: t('pvs.claim'),
        cell: ({ getValue }) => {
          const claimRef = getValue()
          if (claimRef && claimRef.name && claimRef.namespace) {
            return (
              <div className="font-medium text-blue-500 hover:underline truncate max-w-[200px]">
                <Link
                  to={`/persistentvolumeclaims/${claimRef.namespace}/${claimRef.name}`}
                >
                  {claimRef.namespace}/{claimRef.name}
                </Link>
              </div>
            )
          }
          return <span className="text-muted-foreground">-</span>
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
              resourceType="persistentvolumes"
              name={row.original.metadata?.name || ''}
              triggerVariant="ghost"
              triggerSize="icon"
            />
            <DescribeDialog
              resourceType="persistentvolumes"
              name={row.original.metadata?.name || ''}
            />
          </div>
        ),
      }),
    ],
    [columnHelper, t]
  )

  const pvSearchFilter = useCallback((pv: PersistentVolume, query: string) => {
    return (
      pv.metadata!.name!.toLowerCase().includes(query) ||
      (pv.spec!.storageClassName?.toLowerCase() || '').includes(query) ||
      (pv.status!.phase?.toLowerCase() || '').includes(query) ||
      (pv.spec!.claimRef?.name?.toLowerCase() || '').includes(query) ||
      (pv.spec!.claimRef?.namespace?.toLowerCase() || '').includes(query)
    )
  }, [])

  return (
    <ResourceTable
      resourceName={'PersistentVolumes'}
      columns={columns}
      clusterScope={true}
      searchQueryFilter={pvSearchFilter}
    />
  )
}
  )
}
