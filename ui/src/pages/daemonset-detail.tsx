import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useNamespaceContext } from '@/hooks/use-namespace-context'

import {
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconExternalLink,
  IconLoader,
  IconRefresh,
  IconReload,
  IconServer2,
  IconTrash,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { DaemonSet } from 'kubernetes-types/apps/v1'
import { Container } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { updateResource, useResource, useResourcesWatch } from '@/lib/api'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'
import { YamlEditor } from '@/components/yaml-editor'
import {
  SidebarEvents,
  SidebarRelatedResources,
  SidebarLabels,
  SidebarAnnotations,
} from '@/components/overview-sidebar'

export function DaemonSetDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [isYamlDirty, setIsYamlDirty] = useState(false)
  const navigate = useNavigate()
  const [, setSearchParams] = useSearchParams()
  const { setActiveNamespace } = useNamespaceContext()

  const [isRestartPopoverOpen, setIsRestartPopoverOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<number>(0)
  const { t } = useTranslation()

  const {
    data: daemonset,
    isLoading: isLoadingDaemonSet,
    isError: isDaemonSetError,
    error: daemonsetError,
    refetch: refetchDaemonSet,
  } = useResource('daemonsets', name, namespace, { refreshInterval })

  useEffect(() => {
    if (daemonset) {
      if (!isYamlDirty) {
        setYamlContent(yaml.dump(daemonset, { indent: 2 }))
      }
    }
  }, [daemonset, isYamlDirty])

  useEffect(() => {
    if (daemonset && refreshInterval > 0) {
      const { status } = daemonset
      const readyReplicas = status?.numberReady || 0
      const desiredReplicas = status?.desiredNumberScheduled || 0
      const currentReplicas = status?.currentNumberScheduled || 0
      const isStable = readyReplicas === desiredReplicas && currentReplicas === desiredReplicas
      if (isStable) setRefreshInterval(0)
    }
  }, [daemonset, refreshInterval])

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1)
    refetchDaemonSet()
  }

  const labelSelector = daemonset?.spec?.selector.matchLabels
    ? Object.entries(daemonset.spec.selector.matchLabels)
      .map(([key, value]) => `${key}=${value}`)
      .join(',')
    : undefined

  const { data: relatedPods, isLoading: isLoadingPods } = useResourcesWatch(
    'pods', namespace,
    { labelSelector, enabled: !!daemonset?.spec?.selector.matchLabels }
  )

  const handleSaveYaml = async () => {
    setIsSavingYaml(true)
    try {
      const parsedYaml = yaml.load(yamlContent) as DaemonSet
      await updateResource('daemonsets', name, namespace, parsedYaml)
      toast.success('DaemonSet YAML saved successfully')
      setIsYamlDirty(false)
      setRefreshInterval(1000)
      await refetchDaemonSet()
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

  const handleRestart = async () => {
    if (!daemonset) return
    try {
      const updatedDaemonSet = { ...daemonset }
      if (!updatedDaemonSet.spec!.template!.metadata!.annotations) {
        updatedDaemonSet.spec!.template!.metadata!.annotations = {}
      }
      updatedDaemonSet.spec!.template!.metadata!.annotations['kite.kubernetes.io/restartedAt'] = new Date().toISOString()
      await updateResource('daemonsets', name, namespace, updatedDaemonSet)
      toast.success('DaemonSet restart initiated')
      setIsRestartPopoverOpen(false)
      setRefreshInterval(1000)
    } catch (error) {
      console.error('Failed to restart daemonset:', error)
      toast.error(translateError(error, t))
    }
  }

  const handleContainerUpdate = async (updatedContainer: Container, init = false) => {
    try {
      const updatedDaemonSet = JSON.parse(JSON.stringify(daemonset)) as DaemonSet
      if (init) {
        if (updatedDaemonSet.spec?.template?.spec?.initContainers) {
          const idx = updatedDaemonSet.spec.template.spec.initContainers.findIndex((c) => c.name === updatedContainer.name)
          if (idx !== -1) updatedDaemonSet.spec.template.spec.initContainers[idx] = updatedContainer
        }
      } else {
        if (updatedDaemonSet.spec?.template?.spec?.containers) {
          const idx = updatedDaemonSet.spec.template.spec.containers.findIndex((c) => c.name === updatedContainer.name)
          if (idx !== -1) updatedDaemonSet.spec.template.spec.containers[idx] = updatedContainer
        }
      }
      await updateResource('daemonsets', name, namespace, updatedDaemonSet)
      toast.success('Container updated successfully')
      setRefreshInterval(1000)
    } catch (error) {
      console.error('Failed to update container:', error)
      toast.error(translateError(error, t))
    }
  }

  if (isLoadingDaemonSet) {
    return (
      <div className="p-6">
        <Card><CardContent className="pt-6">
          <div className="flex items-center justify-center gap-2">
            <IconLoader className="animate-spin" /><span>Loading DaemonSet details...</span>
          </div>
        </CardContent></Card>
      </div>
    )
  }

  if (isDaemonSetError || !daemonset) {
    return <ErrorMessage resourceName="DaemonSet" error={daemonsetError} refetch={handleRefresh} />
  }

  const { metadata, spec, status } = daemonset
  const readyReplicas = status?.numberReady || 0
  const desiredReplicas = status?.desiredNumberScheduled || 0
  const currentReplicas = status?.currentNumberScheduled || 0
  const availableReplicas = status?.numberAvailable || 0
  const isAvailable = availableReplicas > 0
  const isPending = currentReplicas < desiredReplicas

  return (
    <div className="space-y-2 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{metadata?.name}</h1>
          <p className="text-muted-foreground">
            Namespace:{' '}
            <button onClick={() => { setActiveNamespace(namespace); navigate(`/pods?namespace=${namespace}`) }}
              className="font-medium text-primary hover:underline">{namespace}</button>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <FavoriteButton resourceType="daemonsets" name={name} namespace={namespace} />
          <Button disabled={isLoadingDaemonSet} variant="outline" size="icon" className="h-8 w-8" onClick={handleRefresh} title="Refresh">
            <IconRefresh className="w-3.5 h-3.5" />
          </Button>
          <QuickYamlDialog resourceType="daemonsets" namespace={namespace} name={name} triggerVariant="outline" triggerSize="icon" />
          <DescribeDialog resourceType={'daemonsets'} namespace={namespace} name={name} compact triggerVariant="outline" />
          <div className="w-px h-5 bg-border mx-0.5" />
          <Popover open={isRestartPopoverOpen} onOpenChange={setIsRestartPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm"><IconReload className="w-4 h-4" />Restart</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Restart DaemonSet</h4>
                  <p className="text-sm text-muted-foreground">This will restart all pods managed by this DaemonSet. This action cannot be undone.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsRestartPopoverOpen(false)} className="flex-1">Cancel</Button>
                  <Button onClick={() => { handleRestart(); setIsRestartPopoverOpen(false) }} className="flex-1">
                    <IconReload className="w-4 h-4 mr-2" />Restart
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="destructive" size="sm" onClick={() => setIsDeleteDialogOpen(true)}>
            <IconTrash className="w-4 h-4" />Delete
          </Button>
        </div>
      </div>

      <ResponsiveTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* ── Left Column ── */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Status Cards Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Status</p>
                      <div className="flex items-center gap-1.5">
                        {isPending ? (
                          <IconExclamationCircle className="w-4 h-4 text-muted-foreground" />
                        ) : isAvailable ? (
                          <IconCircleCheckFilled className="w-4 h-4 text-green-500" />
                        ) : (
                          <IconLoader className="w-4 h-4 animate-spin text-amber-500" />
                        )}
                        <span className="text-sm font-bold">{isPending ? 'Pending' : isAvailable ? 'Available' : 'In Progress'}</span>
                      </div>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Desired</p>
                      <p className="text-lg font-bold">{desiredReplicas}</p>
                      <p className="text-[10px] text-muted-foreground">Nodes</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Ready</p>
                      <p className="text-lg font-bold">{readyReplicas}/{desiredReplicas}</p>
                      <p className="text-[10px] text-muted-foreground">Nodes</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Current</p>
                      <p className="text-lg font-bold">{currentReplicas}</p>
                      <p className="text-[10px] text-muted-foreground">Scheduled</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Unavailable</p>
                      <p className={`text-lg font-bold ${(status?.numberUnavailable ?? 0) > 0 ? 'text-red-500' : ''}`}>
                        {status?.numberUnavailable ?? 0}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Nodes</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Created</p>
                      <p className="text-sm font-bold">{formatDate(metadata?.creationTimestamp || '')}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {metadata?.creationTimestamp ? new Date(metadata.creationTimestamp).toLocaleString() : ''}
                      </p>
                    </Card>
                  </div>

                  {/* Node coverage bar */}
                  {desiredReplicas > 0 && (
                    <Card className="p-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Node coverage</span>
                          <span className="font-medium tabular-nums">{readyReplicas}/{desiredReplicas} nodes covered</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              readyReplicas === desiredReplicas ? 'bg-green-500' :
                              readyReplicas === 0 ? 'bg-red-500' : 'bg-amber-500'
                            }`}
                            style={{ width: `${Math.round((readyReplicas / desiredReplicas) * 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {Math.round((readyReplicas / desiredReplicas) * 100)}% of cluster nodes are running this DaemonSet
                        </p>
                      </div>
                    </Card>
                  )}

                  {/* Pods Table */}
                  {relatedPods && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Pods ({relatedPods.length})</CardTitle>
                      </CardHeader>
                      <CardContent className="px-0 pb-0">
                        <PodTable pods={relatedPods} isLoading={isLoadingPods} labelSelector={labelSelector} />
                      </CardContent>
                    </Card>
                  )}

                  {/* DaemonSet Information */}
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">DaemonSet Information</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Created</span>
                          <p className="font-medium">{formatDate(metadata?.creationTimestamp || '', true)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Strategy</span>
                          <p className="font-medium">{spec?.updateStrategy?.type || 'RollingUpdate'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Selector</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {Object.entries(spec?.selector?.matchLabels || {}).map(([key, value]) => (
                              <Badge key={key} variant="secondary" className="text-[10px]">{key}={value}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Service Account</span>
                          <p className="font-medium">{spec?.template?.spec?.serviceAccountName || 'default'}</p>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">Images</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {spec?.template?.spec?.containers?.map((c) => (
                              <Badge key={c.name} variant="outline" className="text-[10px] font-mono">{c.image}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Containers</span>
                          <p className="font-medium">{spec?.template?.spec?.containers?.length || 0}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Volumes</span>
                          <p className="font-medium">{spec?.template?.spec?.volumes?.length || 0}</p>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">UID</span>
                          <p className="font-mono text-xs text-muted-foreground">{metadata?.uid}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Init Containers */}
                  {spec?.template?.spec?.initContainers && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Init Containers ({spec.template.spec.initContainers.length})</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-4">
                          {spec.template.spec.initContainers.map((container, index) => (
                            <ContainerTable key={container.name} container={container} resourceType="daemonsets" resourceName={name} namespace={namespace} containerIndex={index} init onImageUpdateSuccess={refetchDaemonSet} onContainerUpdate={(uc) => handleContainerUpdate(uc, true)} />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Containers */}
                  {spec?.template?.spec?.containers && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Containers ({spec.template.spec.containers.length})</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-4">
                          {spec.template.spec.containers.map((container, index) => (
                            <ContainerTable key={container.name} container={container} resourceType="daemonsets" resourceName={name} namespace={namespace} containerIndex={index} onImageUpdateSuccess={refetchDaemonSet} onContainerUpdate={(uc) => handleContainerUpdate(uc, false)} />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Topology Link */}
                  <Card className="overflow-hidden">
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <IconServer2 className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">Resource Topology</span>
                        <span className="text-xs text-muted-foreground">View related resources and connections</span>
                      </div>
                      <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs"
                        onClick={() => { setSearchParams((prev) => { prev.set('tab', 'Related'); return prev }, { replace: true }) }}>
                        View Topology<IconExternalLink className="w-3 h-3" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* ── Right Sidebar ── */}
                <div className="space-y-4">
                  <SidebarEvents resource="daemonsets" name={name} namespace={namespace} />
                  <SidebarRelatedResources resource="daemonsets" name={name} namespace={namespace} />
                  <SidebarLabels labels={metadata?.labels || {}} />
                  <SidebarAnnotations annotations={metadata?.annotations || {}} />
                </div>
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <YamlEditor key={refreshKey} value={yamlContent} title="DaemonSet Configuration" onSave={handleSaveYaml} onChange={handleYamlChange} isSaving={isSavingYaml} />
              </div>
            ),
          },
          ...(relatedPods
            ? [
              {
                value: 'pods',
                label: (<>Pods {relatedPods && <Badge variant="secondary">{relatedPods.length}</Badge>}</>),
                content: <PodTable pods={relatedPods} isLoading={isLoadingPods} labelSelector={labelSelector} />,
              },
              {
                value: 'logs',
                label: 'Logs',
                content: (<div className="space-y-6"><LogViewer namespace={namespace} pods={relatedPods} containers={spec?.template.spec?.containers} initContainers={spec?.template.spec?.initContainers} labelSelector={labelSelector} /></div>),
              },
              {
                value: 'terminal',
                label: 'Terminal',
                content: (<div className="space-y-6">{relatedPods && relatedPods.length > 0 && (<Terminal namespace={namespace} pods={relatedPods} containers={spec?.template.spec?.containers} initContainers={spec?.template.spec?.initContainers} />)}</div>),
              },
            ]
            : []),
          {
            value: 'Related',
            label: 'Related',
            content: (<div className="space-y-6"><ResourceTopology resource="daemonsets" name={name} namespace={namespace} /><RelatedResourcesTable resource={'daemonsets'} name={name} namespace={namespace} /></div>),
          },
          ...(spec?.template?.spec?.volumes
            ? [{
                value: 'volumes',
                label: (<>Volumes{spec.template.spec.volumes && <Badge variant="secondary">{spec.template.spec.volumes.length}</Badge>}</>),
                content: (<div className="space-y-6"><VolumeTable namespace={namespace} volumes={spec.template.spec?.volumes} containers={spec.template.spec?.containers} isLoading={isLoadingDaemonSet} /></div>),
              }]
            : []),
          {
            value: 'events',
            label: 'Events',
            content: <EventTable resource="daemonsets" name={name} namespace={namespace} />,
          },
          {
            value: 'history',
            label: 'History',
            content: <ResourceHistoryTable resourceType="daemonsets" name={name} namespace={namespace} currentResource={daemonset} />,
          },
          {
            value: 'monitor',
            label: 'Monitor',
            content: <PodMonitoring namespace={namespace} pods={relatedPods} containers={spec?.template.spec?.containers} initContainers={spec?.template.spec?.initContainers} defaultQueryName={relatedPods?.[0]?.metadata?.generateName} labelSelector={labelSelector} />,
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} resourceName={metadata?.name || ''} resourceType="daemonsets" namespace={namespace} />
    </div>
  )
}

