import { useCallback, useEffect, useState } from 'react'
import { useNamespaceContext } from '@/hooks/use-namespace-context'
import { useNavigate } from 'react-router-dom'

import {
  IconLoader,
  IconRefresh,
  IconReload,
  IconScale,
  IconTrash,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { Deployment } from 'kubernetes-types/apps/v1'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  patchResource,
  restartDeployment,
  updateResource,
  useResource,
  useResourcesWatch,
} from '@/lib/api'
import { getDeploymentStatus, toSimpleContainer } from '@/lib/k8s'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ContainerTable } from '@/components/container-table'
import { DeploymentStatusIcon } from '@/components/deployment-status-icon'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { LogViewer } from '@/components/log-viewer'
import { PodMonitoring } from '@/components/pod-monitoring'
import { PodTable } from '@/components/pod-table'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { FavoriteButton } from '@/components/favorite-button'
import { ResourceTopology } from '@/components/resource-topology'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { RolloutMonitor } from '@/components/rollout-monitor'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'
import { YamlEditor } from '@/components/yaml-editor'

export function DeploymentDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [scaleReplicas, setScaleReplicas] = useState<number>(1)
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const navigate = useNavigate()
  const { setActiveNamespace } = useNamespaceContext()

  const [isYamlDirty, setIsYamlDirty] = useState(false) // true = user has unsaved edits — do NOT overwrite from server
  const [isScalePopoverOpen, setIsScalePopoverOpen] = useState(false)
  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<number>(0)
  const [isRolloutMonitorOpen, setIsRolloutMonitorOpen] = useState(false)
  const { t } = useTranslation()

  // Fetch deployment data
  const {
    data: deployment,
    isLoading: isLoadingDeployment,
    isError: isDeploymentError,
    error: deploymentError,
    refetch: refetchDeployment,
  } = useResource('deployments', name, namespace, {
    refreshInterval,
  })

  const labelSelector = deployment?.spec?.selector.matchLabels
    ? Object.entries(deployment.spec.selector.matchLabels)
      .map(([key, value]) => `${key}=${value}`)
      .join(',')
    : undefined
  const { data: relatedPods, isLoading: isLoadingPods } = useResourcesWatch(
    'pods',
    namespace,
    {
      labelSelector,
      enabled: !!deployment?.spec?.selector.matchLabels,
    }
  )

  useEffect(() => {
    if (deployment) {
      // Only sync YAML from server when the user hasn't made any local edits.
      // During OOM/CrashLoop storms the deployment refetches every 15s;
      // without this guard it would wipe out in-progress user changes.
      if (!isYamlDirty) {
        setYamlContent(yaml.dump(deployment, { indent: 2 }))
      }
      setScaleReplicas(deployment.spec?.replicas || 1)
    }
  }, [deployment, isYamlDirty])

  // Auto-reset refresh interval when deployment reaches stable state
  useEffect(() => {
    if (deployment) {
      const status = getDeploymentStatus(deployment)
      const isStable =
        status === 'Available' ||
        status === 'Scaled Down' ||
        status === 'Paused'

      if (isStable) {
        const timer = setTimeout(() => {
          setRefreshInterval(0)
        }, 15000) // Changed from 10s to 15s to reduce load
        return () => clearTimeout(timer)
      } else {
        setRefreshInterval(15000) // Changed from 10s to 15s to protect Master Node
      }
    }
  }, [deployment, refreshInterval])

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1)
    refetchDeployment()
  }

  const handleRestart = useCallback(async () => {
    if (!deployment) return

    try {
      await restartDeployment(namespace, name)
      toast.success('Deployment restart initiated')
      setIsRestartPopoverOpen(false)
      setRefreshInterval(15000)
      setIsRolloutMonitorOpen(true)
    } catch (error) {
      console.error('Failed to restart deployment:', error)
      toast.error(translateError(error, t))
    }
  }, [t, deployment, name, namespace])

  const handleScale = useCallback(async () => {
    if (!deployment) return

    try {
      const updatedDeployment = {
        spec: {
          replicas: scaleReplicas,
        },
      }
      await patchResource('deployments', name, namespace, updatedDeployment)
      toast.success(`Deployment scaled to ${scaleReplicas} replicas`)
      setIsScalePopoverOpen(false)
      setRefreshInterval(15000)
      setIsRolloutMonitorOpen(true)
    } catch (error) {
      console.error('Failed to restart deployment:', error)
      toast.error(translateError(error, t))
    }
  }, [t, deployment, name, namespace, scaleReplicas])

  const handleSaveYaml = async (content: Deployment) => {
    setIsSavingYaml(true)
    try {
      await updateResource('deployments', name, namespace, content)
      toast.success('YAML saved successfully')
      setIsYamlDirty(false)
      setRefreshInterval(15000)
      setIsRolloutMonitorOpen(true)
    } catch (error) {
      console.error('Failed to save YAML:', error)
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
    setIsYamlDirty(true) // user started editing — protect from background refetch resets
  }

  const handleContainerUpdate = async (
    updatedContainer: Container,
    init = false
  ) => {
    if (!deployment) return

    try {
      // Create a deep copy of the deployment
      const updatedDeployment = { ...deployment }

      if (init) {
        // Update the specific container in the deployment spec
        if (updatedDeployment.spec?.template?.spec?.initContainers) {
          const containerIndex =
            updatedDeployment.spec.template.spec.initContainers.findIndex(
              (c) => c.name === updatedContainer.name
            )

          if (containerIndex >= 0) {
            updatedDeployment.spec.template.spec.initContainers[
              containerIndex
            ] = updatedContainer
          }
        }
      } else {
        // Update the specific container in the deployment spec
        if (updatedDeployment.spec?.template?.spec?.containers) {
          const containerIndex =
            updatedDeployment.spec.template.spec.containers.findIndex(
              (c) => c.name === updatedContainer.name
            )

          if (containerIndex >= 0) {
            updatedDeployment.spec.template.spec.containers[containerIndex] =
              updatedContainer
          }
        }
      }

      // Call the update API
      await updateResource('deployments', name, namespace, updatedDeployment)
      toast.success(`Container ${updatedContainer.name} updated successfully`)
      setRefreshInterval(15000) // Changed from 10s to 15s
    } catch (error) {
      console.error('Failed to update container:', error)
      toast.error(translateError(error, t))
    }
  }

  if (isLoadingDeployment) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading deployment details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isDeploymentError || !deployment) {
    return (
      <ErrorMessage
        resourceName={'Deployment'}
        error={deploymentError}
        refetch={handleRefresh}
      />
    )
  }

  const { status } = deployment
  const readyReplicas = status?.readyReplicas || 0
  const totalReplicas = status?.replicas || 0

  return (
    <div className="space-y-2 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{name}</h1>
          <p className="text-muted-foreground">
            Namespace:{' '}
            <button
              onClick={() => {
                setActiveNamespace(namespace)
                navigate(`/pods?namespace=${namespace}`)
              }}
              className="font-medium text-primary hover:underline"
            >
              {namespace}
            </button>
          </p>
        </div>
        <div className="flex gap-2">
          <FavoriteButton resourceType="deployments" name={name} namespace={namespace} />
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <QuickYamlDialog
            resourceType="deployments"
            namespace={namespace}
            name={name}
            triggerAsText
          />
          <DescribeDialog
            resourceType="deployments"
            namespace={namespace}
            name={name}
          />
          <Popover
            open={isScalePopoverOpen}
            onOpenChange={setIsScalePopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <IconScale className="w-4 h-4" />
                Scale
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Scale Deployment</h4>
                  <p className="text-sm text-muted-foreground">
                    Adjust the number of replicas for this deployment.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="replicas">Replicas</Label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 p-0"
                      onClick={() =>
                        setScaleReplicas(Math.max(0, scaleReplicas - 1))
                      }
                      disabled={scaleReplicas <= 0}
                    >
                      -
                    </Button>
                    <Input
                      id="replicas"
                      type="number"
                      min="0"
                      value={scaleReplicas}
                      onChange={(e) =>
                        setScaleReplicas(parseInt(e.target.value) || 0)
                      }
                      className="text-center"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 p-0"
                      onClick={() => setScaleReplicas(scaleReplicas + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
                <Button onClick={handleScale} className="w-full">
                  <IconScale className="w-4 h-4 mr-2" />
                  Scale
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Popover
            open={isRestartPopoverOpen}
            onOpenChange={setIsRestartPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <IconReload className="w-4 h-4" />
                Restart
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Restart Deployment</h4>
                  <p className="text-sm text-muted-foreground">
                    This will restart all pods in the deployment by updating the
                    deployment's template with a new restart annotation. This
                    action cannot be undone.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsRestartPopoverOpen(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      handleRestart()
                      setIsRestartPopoverOpen(false)
                    }}
                    className="flex-1"
                  >
                    <IconReload className="w-4 h-4 mr-2" />
                    Restart
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsDeleteDialogOpen(true)}
          >
            <IconTrash className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>
      {/* Tabs */}
      <ResponsiveTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-4">
                {/* Status Overview */}
                <Card className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <DeploymentStatusIcon status={getDeploymentStatus(deployment)} />
                      Status Overview
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                        getDeploymentStatus(deployment) === 'Available' ? 'bg-green-500/10 text-green-600' :
                        getDeploymentStatus(deployment) === 'Progressing' ? 'bg-blue-500/10 text-blue-600 animate-pulse' :
                        getDeploymentStatus(deployment) === 'Scaled Down' ? 'bg-muted text-muted-foreground' :
                        'bg-red-500/10 text-red-600'
                      }`}>{getDeploymentStatus(deployment)}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Ready Replicas */}
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Ready</p>
                        <p className="text-sm font-semibold">
                          <span className={readyReplicas === totalReplicas && totalReplicas > 0 ? 'text-green-600' : 'text-amber-600'}>{readyReplicas}</span>
                          <span className="text-muted-foreground mx-1">/</span>{totalReplicas}
                        </p>
                        <p className="text-xs text-muted-foreground">Replicas</p>
                      </div>

                      {/* Updated Replicas */}
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Updated</p>
                        <p className="text-sm font-semibold">{status?.updatedReplicas || 0}</p>
                        <p className="text-xs text-muted-foreground">Replicas</p>
                      </div>

                      {/* Available Replicas */}
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Available</p>
                        <p className="text-sm font-semibold">{status?.availableReplicas || 0}</p>
                        <p className="text-xs text-muted-foreground">Replicas</p>
                      </div>

                      {/* Desired */}
                      <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Desired</p>
                        <p className="text-sm font-semibold">{deployment.spec?.replicas || 0}</p>
                        <p className="text-xs text-muted-foreground">Replicas</p>
                      </div>
                    </div>

                    {/* Progress bar for rolling update */}
                    {totalReplicas > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Rollout Progress</span>
                          <span>{Math.round((readyReplicas / totalReplicas) * 100)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out ${
                              readyReplicas === totalReplicas ? 'bg-green-500' :
                              readyReplicas > 0 ? 'bg-blue-500' : 'bg-muted-foreground/30'
                            }`}
                            style={{ width: `${Math.round((readyReplicas / totalReplicas) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Progressing message */}
                    {getDeploymentStatus(deployment) === 'Progressing' && deployment.status?.conditions && (() => {
                      const progCond = deployment.status!.conditions!.find(c => c.type === 'Progressing')
                      return progCond?.message ? (
                        <p className="text-xs text-muted-foreground bg-blue-500/5 border border-blue-500/10 rounded-lg px-3 py-2">
                          ℹ️ {progCond.message}
                        </p>
                      ) : null
                    })()}
                  </CardContent>
                </Card>
                {/* Deployment Info */}
                <Card>
                  <CardHeader>
                    <CardTitle>Deployment Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(
                            deployment.metadata?.creationTimestamp || '',
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Strategy
                        </Label>
                        <p className="text-sm">
                          {deployment.spec?.strategy?.type || 'RollingUpdate'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Replicas
                        </Label>
                        <p className="text-sm">
                          {deployment.spec?.replicas || 0}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Selector
                        </Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(
                            deployment.spec?.selector?.matchLabels || {}
                          ).map(([key, value]) => (
                            <Badge
                              key={key}
                              variant="secondary"
                              className="text-xs"
                            >
                              {key}: {value}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <LabelsAnno
                      labels={deployment.metadata?.labels || {}}
                      annotations={deployment.metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>

                {deployment.spec?.template.spec?.initContainers?.length &&
                  deployment.spec?.template.spec?.initContainers?.length >
                  0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          Init Containers (
                          {
                            deployment.spec?.template?.spec?.initContainers
                              ?.length
                          }
                          )
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-6">
                          <div className="space-y-4">
                            {deployment.spec?.template?.spec?.initContainers?.map(
                              (container, index) => (
                                <ContainerTable
                                  key={container.name}
                                  container={container}
                                  resourceType="deployments"
                                  resourceName={name}
                                  namespace={namespace}
                                  containerIndex={index}
                                  init
                                  onImageUpdateSuccess={refetchDeployment}
                                  onContainerUpdate={(updatedContainer) =>
                                    handleContainerUpdate(
                                      updatedContainer,
                                      true
                                    )
                                  }
                                />
                              )
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Containers (
                      {deployment.spec?.template?.spec?.containers?.length || 0}
                      )
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div className="space-y-4">
                        {deployment.spec?.template?.spec?.containers?.map(
                          (container, index) => (
                            <ContainerTable
                              key={container.name}
                              container={container}
                              resourceType="deployments"
                              resourceName={name}
                              namespace={namespace}
                              containerIndex={index}
                              onImageUpdateSuccess={refetchDeployment}
                              onContainerUpdate={(updatedContainer) =>
                                handleContainerUpdate(updatedContainer)
                              }
                            />
                          )
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Conditions */}
                {status?.conditions && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Conditions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {status.conditions.map((condition, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-2 border rounded"
                          >
                            <Badge
                              variant={
                                condition.status === 'True'
                                  ? 'default'
                                  : 'secondary'
                              }
                            >
                              {condition.type}
                            </Badge>
                            <span className="text-sm">{condition.message}</span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {formatDate(
                                condition.lastTransitionTime ||
                                condition.lastUpdateTime ||
                                ''
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <YamlEditor<'deployments'>
                key={refreshKey}
                value={yamlContent}
                title="YAML Configuration"
                onSave={handleSaveYaml}
                onChange={handleYamlChange}
                isSaving={isSavingYaml}
                unsaved={isYamlDirty}
              />
            ),
          },
          ...(relatedPods
            ? [
              {
                value: 'pods',
                label: (
                  <>
                    Pods{' '}
                    {relatedPods && (
                      <Badge variant="secondary">{relatedPods.length}</Badge>
                    )}
                  </>
                ),
                content: (
                  <PodTable
                    pods={relatedPods}
                    isLoading={isLoadingPods}
                    labelSelector={labelSelector}
                  />
                ),
              },
              {
                value: 'logs',
                label: 'Logs',
                content: (
                  <div className="space-y-6">
                    <LogViewer
                      namespace={namespace}
                      pods={relatedPods}
                      containers={deployment.spec?.template.spec?.containers}
                      initContainers={
                        deployment.spec?.template.spec?.initContainers
                      }
                      labelSelector={labelSelector}
                    />
                  </div>
                ),
              },
              {
                value: 'terminal',
                label: 'Terminal',
                content: (
                  <div className="space-y-6">
                    {relatedPods && relatedPods.length > 0 && (
                      <Terminal
                        namespace={namespace}
                        pods={relatedPods}
                        containers={
                          deployment.spec?.template.spec?.containers
                        }
                        initContainers={
                          deployment.spec?.template.spec?.initContainers
                        }
                      />
                    )}
                  </div>
                ),
              },
            ]
            : []),
          {
            value: 'Related',
            label: 'Related',
            content: (
              <div className="space-y-6">
                <ResourceTopology
                  resource="deployments"
                  name={name}
                  namespace={namespace}
                />
                <RelatedResourcesTable
                  resource={'deployments'}
                  name={name}
                  namespace={namespace}
                />
              </div>
            ),
          },
          {
            value: 'history',
            label: 'History',
            content: (
              <ResourceHistoryTable
                resourceType="deployments"
                name={name}
                namespace={namespace}
                currentResource={deployment}
              />
            ),
          },
          ...(deployment.spec?.template?.spec?.volumes
            ? [
              {
                value: 'volumes',
                label: (
                  <>
                    Volumes{' '}
                    <Badge variant="secondary">
                      {deployment.spec.template.spec.volumes.length}
                    </Badge>
                  </>
                ),
                content: (
                  <VolumeTable
                    namespace={namespace}
                    volumes={deployment.spec?.template?.spec?.volumes}
                    containers={toSimpleContainer(
                      deployment.spec?.template?.spec?.initContainers,
                      deployment.spec?.template?.spec?.containers
                    )}
                    isLoading={isLoadingDeployment}
                  />
                ),
              },
            ]
            : []),
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource="deployments"
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'monitor',
            label: 'Monitor',
            content: (
              <PodMonitoring
                namespace={namespace}
                pods={relatedPods}
                containers={deployment.spec?.template.spec?.containers}
                initContainers={deployment.spec?.template.spec?.initContainers}
                labelSelector={labelSelector}
              />
            ),
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={name}
        resourceType="deployments"
        namespace={namespace}
      />

      <RolloutMonitor
        deploymentName={name}
        namespace={namespace}
        open={isRolloutMonitorOpen}
        onOpenChange={setIsRolloutMonitorOpen}
      />
    </div>
  )
}