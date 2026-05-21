import { useCallback, useEffect, useState } from 'react'
import { useNamespaceContext } from '@/hooks/use-namespace-context'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import {
  IconAlertTriangle,
  IconCheck,
  IconExternalLink,
  IconInfoCircle,
  IconLoader,
  IconRefresh,
  IconReload,
  IconScale,
  IconServer2,
  IconTrash,
  IconHistory,
  IconRotate2,
  IconCircleCheckFilled,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { Deployment } from 'kubernetes-types/apps/v1'
import { HorizontalPodAutoscaler } from 'kubernetes-types/autoscaling/v2'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  patchResource,
  restartDeployment,
  rollbackDeployment,
  updateResource,
  useResource,
  useResourcesWatch,
  useDeploymentRevisions,
} from '@/lib/api'
import type { RevisionInfo } from '@/lib/api'
import { getDeploymentStatus, toSimpleContainer } from '@/lib/k8s'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ContainerTable } from '@/components/container-table'

import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'

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
import {
  SidebarEvents,
  SidebarRelatedResources,
  SidebarLabels,
  SidebarAnnotations,
} from '@/components/overview-sidebar'

export function DeploymentDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [scaleReplicas, setScaleReplicas] = useState<number>(1)
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const navigate = useNavigate()
  const { setActiveNamespace } = useNamespaceContext()

  const [isYamlDirty, setIsYamlDirty] = useState(false)
  const [isScalePopoverOpen, setIsScalePopoverOpen] = useState(false)
  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<number>(0)
  const [isRolloutMonitorOpen, setIsRolloutMonitorOpen] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false)
  const [pendingRollbackRevision, setPendingRollbackRevision] = useState<number | undefined>(undefined)
  const [viewingRevision, setViewingRevision] = useState<RevisionInfo | null>(null)
  const [, setSearchParams] = useSearchParams()
  const { t } = useTranslation()

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

  const { data: allHPAs } = useResourcesWatch('horizontalpodautoscalers', namespace, { enabled: !!deployment })
  const deploymentHPA = (allHPAs as HorizontalPodAutoscaler[] | undefined)?.find(
    (h) => h.spec?.scaleTargetRef?.kind === 'Deployment' && h.spec?.scaleTargetRef?.name === name
  )

  useEffect(() => {
    if (deployment) {
      if (!isYamlDirty) {
        setYamlContent(yaml.dump(deployment, { indent: 2 }))
      }
      setScaleReplicas(deployment.spec?.replicas || 1)
    }
  }, [deployment, isYamlDirty])

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
        }, 15000)
        return () => clearTimeout(timer)
      } else {
        setRefreshInterval(15000)
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
      const updatedDeployment = { spec: { replicas: scaleReplicas } }
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

  const { data: revisionsData, refetch: refetchRevisions } = useDeploymentRevisions(
    namespace,
    name,
    { enabled: !!deployment }
  )

  const confirmRollback = useCallback((revision?: number) => {
    setPendingRollbackRevision(revision)
    setRollbackDialogOpen(true)
  }, [])

  const executeRollback = useCallback(async () => {
    setIsRollingBack(true)
    try {
      const result = await rollbackDeployment(namespace, name, pendingRollbackRevision)
      toast.success(`Rollback initiated to revision ${result.revision}`)
      setRefreshInterval(15000)
      setIsRolloutMonitorOpen(true)
      setRollbackDialogOpen(false)
      refetchDeployment()
      refetchRevisions()
    } catch (error) {
      console.error('Failed to rollback deployment:', error)
      toast.error(translateError(error, t))
    } finally {
      setIsRollingBack(false)
    }
  }, [namespace, name, pendingRollbackRevision, t, refetchDeployment, refetchRevisions])

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
    setIsYamlDirty(true)
  }

  const handleContainerUpdate = async (
    updatedContainer: Container,
    init = false
  ) => {
    if (!deployment) return
    try {
      const updatedDeployment = { ...deployment }
      if (init) {
        if (updatedDeployment.spec?.template?.spec?.initContainers) {
          const containerIndex =
            updatedDeployment.spec.template.spec.initContainers.findIndex(
              (c) => c.name === updatedContainer.name
            )
          if (containerIndex >= 0) {
            updatedDeployment.spec.template.spec.initContainers[containerIndex] = updatedContainer
          }
        }
      } else {
        if (updatedDeployment.spec?.template?.spec?.containers) {
          const containerIndex =
            updatedDeployment.spec.template.spec.containers.findIndex(
              (c) => c.name === updatedContainer.name
            )
          if (containerIndex >= 0) {
            updatedDeployment.spec.template.spec.containers[containerIndex] = updatedContainer
          }
        }
      }
      await updateResource('deployments', name, namespace, updatedDeployment)
      toast.success(`Container ${updatedContainer.name} updated successfully`)
      setRefreshInterval(15000)
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
  const deploymentStatus = getDeploymentStatus(deployment)

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
        <div className="flex items-center gap-1.5">
          <FavoriteButton resourceType="deployments" name={name} namespace={namespace} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleRefresh}>
                <IconRefresh className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <QuickYamlDialog
            resourceType="deployments"
            namespace={namespace}
            name={name}
            triggerVariant="outline"
            triggerSize="icon"
          />
          <DescribeDialog
            resourceType="deployments"
            namespace={namespace}
            name={name}
            compact
            triggerVariant="outline"
          />
          <div className="w-px h-5 bg-border mx-0.5" />
          <Popover open={isScalePopoverOpen} onOpenChange={setIsScalePopoverOpen}>
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
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                      onClick={() => setScaleReplicas(Math.max(0, scaleReplicas - 1))}
                      disabled={scaleReplicas <= 0}
                    >-</Button>
                    <Input id="replicas" type="number" min="0" value={scaleReplicas}
                      onChange={(e) => setScaleReplicas(parseInt(e.target.value) || 0)}
                      className="text-center"
                    />
                    <Button variant="outline" size="sm" className="h-9 w-9 p-0"
                      onClick={() => setScaleReplicas(scaleReplicas + 1)}
                    >+</Button>
                  </div>
                </div>
                <Button onClick={handleScale} className="w-full">
                  <IconScale className="w-4 h-4 mr-2" />
                  Scale
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm"
            disabled={isRollingBack || !revisionsData || revisionsData.revisions.length < 2}
            onClick={() => confirmRollback()}
          >
            <IconRotate2 className="w-4 h-4" />
            {isRollingBack ? 'Rolling back...' : 'Rollback'}
          </Button>
          <Popover open={isRestartPopoverOpen} onOpenChange={setIsRestartPopoverOpen}>
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
                  <Button variant="outline" onClick={() => setIsRestartPopoverOpen(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={() => { handleRestart(); setIsRestartPopoverOpen(false) }} className="flex-1">
                    <IconReload className="w-4 h-4 mr-2" />
                    Restart
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="destructive" size="sm" onClick={() => setIsDeleteDialogOpen(true)}>
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
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* ── Left Column (3/5) ── */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Status Cards Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Status</p>
                      <div className="flex items-center gap-1.5">
                        <IconCircleCheckFilled className={`w-4 h-4 ${deploymentStatus === 'Available' ? 'text-green-500' :
                          deploymentStatus === 'Progressing' ? 'text-blue-500' :
                            'text-red-500'
                          }`} />
                        <span className="text-sm font-bold">{deploymentStatus}</span>
                      </div>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Desired</p>
                      <p className="text-lg font-bold">{deployment.spec?.replicas ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">Replicas</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Ready</p>
                      <p className="text-lg font-bold">{readyReplicas}/{totalReplicas}</p>
                      <p className="text-[10px] text-muted-foreground">Replicas</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Up-to-date</p>
                      <p className="text-lg font-bold">{status?.updatedReplicas ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">Replicas</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Available</p>
                      <p className="text-lg font-bold">{status?.availableReplicas ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">Replicas</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Created</p>
                      <p className="text-sm font-bold">{formatDate(deployment.metadata?.creationTimestamp || '')}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {deployment.metadata?.creationTimestamp
                          ? new Date(deployment.metadata.creationTimestamp).toLocaleString()
                          : ''}
                      </p>
                    </Card>
                  </div>

                  {/* HPA Banner */}
                  {deploymentHPA && (
                    <Card className="border-cyan-400/40 bg-cyan-500/5">
                      <CardContent className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                          <span className="font-semibold text-cyan-600 dark:text-cyan-400 text-xs uppercase tracking-wide">HPA Managed</span>
                          <span className="text-muted-foreground text-xs">
                            Min: <span className="font-medium text-foreground">{deploymentHPA.spec?.minReplicas ?? 1}</span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            Max: <span className="font-medium text-foreground">{deploymentHPA.spec?.maxReplicas}</span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            Current: <span className="font-medium text-foreground">{deploymentHPA.status?.currentReplicas ?? 0}</span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            Desired: <span className="font-medium text-foreground">{deploymentHPA.status?.desiredReplicas}</span>
                          </span>
                          <Link
                            to={`/horizontalpodautoscalers/${namespace}/${deploymentHPA.metadata?.name}`}
                            className="ml-auto text-xs text-blue-500 hover:underline"
                          >
                            {deploymentHPA.metadata?.name}
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Pods Table */}
                  {relatedPods && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">
                          Pods ({relatedPods.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-0 pb-0">
                        <PodTable
                          pods={relatedPods}
                          isLoading={isLoadingPods}
                          labelSelector={labelSelector}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {/* Deployment Information card moved to right column for layout balance */}

                  {/* Init Containers */}
                  {deployment.spec?.template.spec?.initContainers?.length &&
                    deployment.spec.template.spec.initContainers.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2 pt-4 px-4">
                          <CardTitle className="text-sm font-semibold">
                            Init Containers ({deployment.spec.template.spec.initContainers.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4">
                          <div className="space-y-4">
                            {deployment.spec.template.spec.initContainers.map((container, index) => (
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
                                  handleContainerUpdate(updatedContainer, true)
                                }
                              />
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                  {/* Containers */}
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">
                        Containers ({deployment.spec?.template?.spec?.containers?.length || 0})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="space-y-4">
                        {deployment.spec?.template?.spec?.containers?.map((container, index) => (
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
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Resource Topology Link — moved to right column */}

                  {/* Conditions — moved to right column */}
                </div>

                {/* ── Right Column (2/5) ── */}
                <div className="lg:col-span-2 space-y-4">
                  <SidebarEvents resource="deployments" name={name} namespace={namespace} />
                  <SidebarRelatedResources resource="deployments" name={name} namespace={namespace} />

                  {/* Deployment Information */}
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">Deployment Information</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Owner</span>
                          <p className="font-medium">None</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Strategy</span>
                          <p className="font-medium">{deployment.spec?.strategy?.type || 'RollingUpdate'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Revision</span>
                          <p className="font-medium">{deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] || '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Service Account</span>
                          <p className="font-medium truncate">{deployment.spec?.template?.spec?.serviceAccountName || 'default'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Max Surge</span>
                          <p className="font-medium">{deployment.spec?.strategy?.rollingUpdate?.maxSurge ?? '25%'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Max Unavailable</span>
                          <p className="font-medium">{deployment.spec?.strategy?.rollingUpdate?.maxUnavailable ?? '25%'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Containers</span>
                          <p className="font-medium">{deployment.spec?.template?.spec?.containers?.length || 0}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Volumes</span>
                          <p className="font-medium">{deployment.spec?.template?.spec?.volumes?.length || 0}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Min Ready</span>
                          <p className="font-medium">{deployment.spec?.minReadySeconds ?? 0}s</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Progress Deadline</span>
                          <p className="font-medium">{deployment.spec?.progressDeadlineSeconds ?? 600}s</p>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">Selector</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {Object.entries(deployment.spec?.selector?.matchLabels || {}).map(([key, value]) => (
                              <Badge key={key} variant="secondary" className="text-[10px]">
                                {key}={value}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">Images</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {deployment.spec?.template?.spec?.containers?.map((c) => (
                              <Badge key={c.name} variant="outline" className="text-[10px] font-mono break-all">
                                {c.image}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">UID</span>
                          <p className="font-mono text-[10px] text-muted-foreground break-all">{deployment.metadata?.uid}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <SidebarLabels labels={deployment.metadata?.labels || {}} />

                  {/* Resource Topology Link */}
                  <Card className="overflow-hidden">
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm min-w-0">
                        <IconServer2 className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">Resource Topology</span>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs shrink-0"
                        onClick={() => {
                          setSearchParams((prev) => {
                            prev.set('tab', 'Related')
                            return prev
                          }, { replace: true })
                        }}
                      >
                        View
                        <IconExternalLink className="w-3 h-3" />
                      </Button>
                    </CardContent>
                  </Card>

                  <SidebarAnnotations annotations={deployment.metadata?.annotations || {}} />

                  {/* Conditions */}
                  {status?.conditions && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          Conditions
                          <Badge variant="outline" className="text-[10px] font-normal ml-auto">
                            {status.conditions.filter(c => c.status === 'True').length}/{status.conditions.length} passing
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-2">
                          {status.conditions.map((condition, index) => {
                            const isTrue = condition.status === 'True'
                            const isFailing = !isTrue && condition.type === 'Available'
                            return (
                              <div key={index}
                                className={`flex items-start gap-3 p-3 border rounded-lg transition-colors ${isFailing ? 'border-red-500/30 bg-red-500/5' :
                                  isTrue ? 'border-border bg-card' :
                                    'border-amber-500/30 bg-amber-500/5'
                                  }`}
                              >
                                <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${isTrue ? 'bg-emerald-500/15' : isFailing ? 'bg-red-500/15' : 'bg-amber-500/15'
                                  }`}>
                                  {isTrue ? (
                                    <IconCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                  ) : (
                                    <IconAlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge variant={isTrue ? 'default' : isFailing ? 'destructive' : 'secondary'} className="text-[10px]">
                                      {condition.type}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px] h-4">{condition.status}</Badge>
                                    {condition.reason && (
                                      <span className="text-[10px] text-muted-foreground font-mono">{condition.reason}</span>
                                    )}
                                  </div>
                                  {condition.message && (
                                    <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{condition.message}</p>
                                  )}
                                  <span className="text-[10px] text-muted-foreground block mt-1">
                                    {formatDate(condition.lastTransitionTime || condition.lastUpdateTime || '')}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            ),
          },
          {
            value: 'pods',
            label: (
              <>
                Pods{' '}
                {relatedPods && <Badge variant="secondary">{relatedPods.length}</Badge>}
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
            value: 'containers',
            label: (
              <>
                Containers{' '}
                <Badge variant="secondary">
                  {deployment.spec?.template?.spec?.containers?.length || 0}
                </Badge>
              </>
            ),
            content: (
              <div className="space-y-4">
                {deployment.spec?.template.spec?.initContainers?.length &&
                  deployment.spec.template.spec.initContainers.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle>Init Containers ({deployment.spec.template.spec.initContainers.length})</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {deployment.spec.template.spec.initContainers.map((container, index) => (
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
                                handleContainerUpdate(updatedContainer, true)
                              }
                            />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                <Card>
                  <CardHeader><CardTitle>Containers ({deployment.spec?.template?.spec?.containers?.length || 0})</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {deployment.spec?.template?.spec?.containers?.map((container, index) => (
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
                      ))}
                    </div>
                  </CardContent>
                </Card>
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
                value: 'logs',
                label: 'Logs',
                content: (
                  <div className="space-y-6">
                    <LogViewer
                      namespace={namespace}
                      pods={relatedPods}
                      containers={deployment.spec?.template.spec?.containers}
                      initContainers={deployment.spec?.template.spec?.initContainers}
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
                        containers={deployment.spec?.template.spec?.containers}
                        initContainers={deployment.spec?.template.spec?.initContainers}
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
          {
            value: 'revisions',
            label: (
              <>
                Revisions{' '}
                {revisionsData?.revisions && (
                  <Badge variant="secondary">{revisionsData.revisions.length}</Badge>
                )}
              </>
            ),
            content: (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <IconHistory className="w-5 h-5" />
                    Deployment Revisions
                    <div className="flex items-center gap-2 ml-auto">
                      {revisionsData?.revisions && (
                        <Badge variant="secondary" className="text-[10px]">
                          {revisionsData.revisions.length} revision{revisionsData.revisions.length !== 1 ? 's' : ''}
                        </Badge>
                      )}
                      {revisionsData?.currentRevision && (
                        <Badge variant="outline" className="text-xs font-mono">
                          Current: #{revisionsData.currentRevision}
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!revisionsData || revisionsData.revisions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <IconHistory className="h-10 w-10 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No revisions found</p>
                      <p className="text-xs text-muted-foreground/70">
                        Revisions are created when the deployment pod template changes.
                      </p>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-[19px] top-4 bottom-4 w-px bg-border" />
                      <div className="space-y-1">
                        {revisionsData.revisions.map((rev: RevisionInfo, idx: number) => {
                          const imageTag = rev.image?.split(':').pop() || 'latest'
                          const imageRepo = rev.image?.split(':')[0]?.split('/').pop() || ''
                          return (
                            <div key={rev.revision}
                              className={`relative flex items-start gap-3 p-3 rounded-lg transition-all group ${rev.isCurrent ? 'border border-primary/40 bg-primary/5' : 'hover:bg-muted/50'
                                }`}
                            >
                              <div className="relative z-10 shrink-0">
                                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${rev.isCurrent
                                  ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20'
                                  : 'bg-card text-muted-foreground border-border group-hover:border-primary/50 transition-colors'
                                  }`}>
                                  {rev.revision}
                                </div>
                                {rev.isCurrent && (
                                  <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 bg-emerald-500 rounded-full border-2 border-card flex items-center justify-center">
                                    <IconCheck className="h-2 w-2 text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0 pt-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium truncate">{rev.replicaName}</span>
                                  {rev.isCurrent && (
                                    <Badge className="text-[10px] h-4 bg-primary/15 text-primary border-primary/25">ACTIVE</Badge>
                                  )}
                                  {idx === 0 && !rev.isCurrent && (
                                    <Badge variant="secondary" className="text-[10px] h-4">LATEST</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <Badge variant="outline" className="text-[10px] h-5 font-mono gap-1 shrink-0">
                                    {imageRepo && <span className="text-muted-foreground">{imageRepo}:</span>}
                                    <span className="font-bold">{imageTag}</span>
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    {rev.replicas} replica{rev.replicas !== 1 ? 's' : ''}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">·</span>
                                  <span className="text-[10px] text-muted-foreground">{formatDate(rev.createdAt)}</span>
                                </div>
                              </div>
                              {!rev.isCurrent && (
                                <div className="flex gap-1.5 shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="sm"
                                    className="gap-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() => setViewingRevision(rev)}
                                  >
                                    <IconInfoCircle className="w-3.5 h-3.5" />
                                    Info
                                  </Button>
                                  <Button variant="outline" size="sm"
                                    className="gap-1.5 h-7 px-2.5"
                                    onClick={() => confirmRollback(parseInt(rev.revision))}
                                    disabled={isRollingBack}
                                  >
                                    <IconRotate2 className="w-3.5 h-3.5" />
                                    Rollback to Rev {rev.revision}
                                  </Button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ),
          },
          ...(deployment.spec?.template?.spec?.volumes
            ? [{
              value: 'volumes',
              label: (
                <>
                  Volumes{' '}
                  <Badge variant="secondary">{deployment.spec.template.spec.volumes.length}</Badge>
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
            }]
            : []),
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable resource="deployments" name={name} namespace={namespace} />
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

      {/* Revision Info Dialog */}
      <Dialog open={!!viewingRevision} onOpenChange={(open) => { if (!open) setViewingRevision(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconInfoCircle className="h-5 w-5 text-primary" />
              Revision {viewingRevision?.revision} Details
            </DialogTitle>
          </DialogHeader>
          {viewingRevision && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-y-2.5 gap-x-4">
                <span className="text-muted-foreground">Revision</span>
                <span className="font-mono font-semibold">#{viewingRevision.revision}</span>
                <span className="text-muted-foreground">Replica Set</span>
                <span className="font-mono text-xs break-all">{viewingRevision.replicaName}</span>
                <span className="text-muted-foreground">Image</span>
                <span className="font-mono text-xs break-all">{viewingRevision.image || '—'}</span>
                <span className="text-muted-foreground">Replicas</span>
                <span>{viewingRevision.replicas}</span>
                <span className="text-muted-foreground">Created</span>
                <span className="text-xs">{formatDate(viewingRevision.createdAt)}</span>
                <span className="text-muted-foreground">Status</span>
                <span>{viewingRevision.isCurrent
                  ? <Badge className="text-[10px] h-4 bg-primary/15 text-primary border-primary/25">ACTIVE</Badge>
                  : <Badge variant="secondary" className="text-[10px] h-4">Past</Badge>
                }</span>
              </div>
              {viewingRevision.labels && Object.keys(viewingRevision.labels).length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1.5">Labels</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(viewingRevision.labels).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="font-mono text-[10px]">{k}={v}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setViewingRevision(null)}>Close</Button>
            {viewingRevision && !viewingRevision.isCurrent && (
              <Button
                onClick={() => {
                  setViewingRevision(null)
                  confirmRollback(parseInt(viewingRevision.revision))
                }}
                disabled={isRollingBack}
                className="gap-1.5"
              >
                <IconRotate2 className="w-4 h-4" />
                Rollback to This Revision
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation Dialog */}
      <Dialog open={rollbackDialogOpen} onOpenChange={(open) => { if (!open && !isRollingBack) { setRollbackDialogOpen(false) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconRotate2 className="h-5 w-5 text-amber-500" />
              Confirm Rollback
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You are about to rollback <strong className="text-foreground">{name}</strong> in
                  namespace <strong className="text-foreground">{namespace}</strong>
                  {pendingRollbackRevision
                    ? <> to <strong className="text-foreground">revision #{pendingRollbackRevision}</strong></>
                    : <> to its <strong className="text-foreground">previous revision</strong></>
                  }.
                </p>
                <p className="text-amber-600 dark:text-amber-400 text-xs">
                  ⚠ This will update the pod template to match a prior ReplicaSet configuration. Running pods will be replaced.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRollbackDialogOpen(false)} disabled={isRollingBack}>
              Cancel
            </Button>
            <Button onClick={executeRollback} disabled={isRollingBack} className="gap-1.5">
              <IconRotate2 className="h-4 w-4" />
              {isRollingBack ? 'Rolling back...' : 'Confirm Rollback'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

