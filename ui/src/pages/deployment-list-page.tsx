import { useCallback, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Deployment } from 'kubernetes-types/apps/v1'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { IconReload } from '@tabler/icons-react'

import * as api from '@/lib/api'

import { getDeploymentStatus } from '@/lib/k8s'
import { formatDate, getAge } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DeploymentStatusIcon } from '@/components/deployment-status-icon'
import { DeploymentCreateDialog } from '@/components/editors/deployment-create-dialog'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ResourceTable } from '@/components/resource-table'

export function DeploymentListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  // Define column helper outside of any hooks
  const columnHelper = createColumnHelper<Deployment>()

  // Define columns for the deployment table
  const columns = useMemo(
    () => [
      columnHelper.accessor('metadata.name', {
        header: t('common.name'),
        cell: ({ row }) => {
          const containers = row.original.spec?.template?.spec?.containers || []
          const image = containers[0]?.image || ''
          const shortImage = image.includes('/') ? image.split('/').pop() || image : image
          return (
            <div className="flex flex-col gap-0.5 group/name">
              <div className="flex items-center gap-1 min-w-0">
                <div className="font-medium text-blue-500 hover:underline truncate">
                  <Link
                    to={`/deployments/${row.original.metadata!.namespace}/${row.original.metadata!.name}`}
                  >
                    {row.original.metadata!.name}
                  </Link>
                </div>
                <button
                  className="opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(row.original.metadata!.name || '')
                    toast.success('Name copied to clipboard')
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
          const status = getDeploymentStatus(row.original)

          let subtext = null
          if (status === 'Progressing' && row.original.status?.conditions) {
            const progressingCond = row.original.status.conditions.find(c => c.type === 'Progressing')
            if (progressingCond && progressingCond.message) {
              subtext = progressingCond.message
            } else if (row.original.status.availableReplicas !== row.original.status.replicas) {
              subtext = `${row.original.status.availableReplicas || 0} / ${row.original.status.replicas || 0} pods available`
            }
          }

          return (
            <div className="flex flex-col gap-1">
              <Badge variant="outline" className="text-muted-foreground px-1.5 w-fit">
                <DeploymentStatusIcon status={status} />
                {status}
              </Badge>
              {subtext && <span className="text-xs text-muted-foreground truncate max-w-[250px]" title={subtext}>{subtext}</span>}
            </div>
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
        cell: ({ row }) => {
          const ns = row.original.metadata?.namespace
          const name = row.original.metadata?.name || ''
          return (
            <div className="flex items-center justify-end gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        await api.restartResource('deployments', name, ns!)
                        toast.success(`Restarted ${name}`)
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err)
                        toast.error(`Failed to restart: ${msg}`)
                      }
                    }}
                  >
                    <IconReload className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Restart deployment</TooltipContent>
              </Tooltip>
              <QuickYamlDialog
                resourceType="deployments"
                namespace={ns}
                name={name}
                triggerVariant="ghost"
                triggerSize="icon"
              />
              <DescribeDialog
                resourceType="deployments"
                namespace={ns}
                name={name}
              />
            </div>
          )
        }
      }),
    ],
    [columnHelper, t]
  )

  // Custom filter for deployment search
  const deploymentSearchFilter = useCallback(
    (deployment: Deployment, query: string) => {
      return (
        deployment.metadata!.name!.toLowerCase().includes(query) ||
        (deployment.metadata!.namespace?.toLowerCase() || '').includes(query)
      )
    },
    []
  )

  const handleCreateClick = () => {
    setIsCreateDialogOpen(true)
  }

  const handleCreateSuccess = (deployment: Deployment, namespace: string) => {
    // Navigate to the newly created deployment's detail page
    navigate(`/deployments/${namespace}/${deployment.metadata?.name}`)
  }

  const handleBatchRestart = useCallback(async (rows: Deployment[]) => {
    const promises = rows.map((row) => {
      const name = row.metadata?.name
      const namespace = row.metadata?.namespace
      if (!name || !namespace) return Promise.resolve()

      return api.restartResource('deployments', name, namespace)
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

  return (
    <>
      <ResourceTable
        resourceName="Deployments"
        columns={columns}
        searchQueryFilter={deploymentSearchFilter}
        showCreateButton={true}
        onCreateClick={handleCreateClick}
        onBatchRestart={handleBatchRestart}
        enableLabelFilter={true}
      />

      <DeploymentCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSuccess={handleCreateSuccess}
      />
    </>
  )
}
