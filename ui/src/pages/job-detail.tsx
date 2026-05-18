import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNamespaceContext } from '@/hooks/use-namespace-context'

import { IconLoader, IconRefresh, IconTrash } from '@tabler/icons-react'
import { formatDistance } from 'date-fns'
import * as yaml from 'js-yaml'
import { Job } from 'kubernetes-types/batch/v1'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { updateResource, useResource, useResources } from '@/lib/api'
import { getOwnerInfo } from '@/lib/k8s'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { Terminal } from '@/components/terminal'
import { VolumeTable } from '@/components/volume-table'
import { YamlEditor } from '@/components/yaml-editor'
import { FavoriteButton } from '@/components/favorite-button'
import { ResourceTopology } from '@/components/resource-topology'
import {
  SidebarEvents,
  SidebarRelatedResources,
  SidebarLabels,
  SidebarAnnotations,
} from '@/components/overview-sidebar'

interface JobStatusBadge {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

function getJobStatusBadge(job?: Job | null): JobStatusBadge {
  if (!job) return { label: '-', variant: 'secondary' }
  const conditions = job.status?.conditions || []
  const completed = conditions.find((condition) => condition.type === 'Complete')
  const failed = conditions.find((condition) => condition.type === 'Failed')
  if (failed?.status === 'True') return { label: 'Failed', variant: 'destructive' }
  if (completed?.status === 'True') return { label: 'Complete', variant: 'default' }
  if ((job.status?.active || 0) > 0) return { label: 'Running', variant: 'secondary' }
  return { label: 'Pending', variant: 'outline' }
}

const getJobDuration = (job?: Job | null): string => {
  if (!job?.status?.startTime) return '-'
  const start = new Date(job.status.startTime)
  if (job.status.completionTime) {
    const end = new Date(job.status.completionTime)
    return formatDistance(end, start)
  }
  return `${formatDistance(new Date(), start)} (running)`
}

export function JobDetail(props: { namespace: string; name: string }) {
  const { namespace, name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const navigate = useNavigate()
  const { setActiveNamespace } = useNamespaceContext()
  const { t } = useTranslation()

  const { data: job, isLoading, isError, error: jobError, refetch: refetchJob } = useResource('jobs', name, namespace)
  const { data: pods, refetch: refetchPods } = useResources('pods', namespace, { labelSelector: `job-name=${name}`, disable: !namespace || !name })

  useEffect(() => { if (job) setYamlContent(yaml.dump(job, { indent: 2 })) }, [job])

  const jobStatus = useMemo(() => getJobStatusBadge(job), [job])

  const handleManualRefresh = async () => {
    setRefreshKey((prev) => prev + 1)
    await Promise.all([refetchJob(), refetchPods()])
  }

  const handleSaveYaml = async (content: Job) => {
    setIsSavingYaml(true)
    try {
      await updateResource('jobs', name, namespace, content)
      toast.success('Job YAML saved successfully')
      await refetchJob()
    } catch (error) { toast.error(translateError(error, t)) }
    finally { setIsSavingYaml(false) }
  }

  const handleYamlChange = (content: string) => { setYamlContent(content) }

  if (isLoading) {
    return (<div className="p-6"><Card><CardContent className="pt-6"><div className="flex items-center justify-center gap-2"><IconLoader className="animate-spin" /><span>Loading job details...</span></div></CardContent></Card></div>)
  }

  if (isError || !job) {
    return <ErrorMessage resourceName={'Job'} error={jobError} refetch={handleManualRefresh} />
  }

  const templateSpec = job.spec?.template?.spec
  const initContainers = templateSpec?.initContainers || []
  const containers = templateSpec?.containers || []
  const volumes = templateSpec?.volumes

  return (
    <div className="space-y-2 animate-page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{name}</h1>
          <p className="text-muted-foreground">
            Namespace:{' '}
            <button onClick={() => { setActiveNamespace(namespace); navigate(`/pods?namespace=${namespace}`) }}
              className="font-medium text-primary hover:underline">{namespace}</button>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <FavoriteButton resourceType="jobs" name={name} namespace={namespace} />
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleManualRefresh} title="Refresh">
            <IconRefresh className="w-3.5 h-3.5" />
          </Button>
          <QuickYamlDialog resourceType="jobs" namespace={namespace} name={name} triggerVariant="outline" triggerSize="icon" />
          <DescribeDialog resourceType={'jobs'} namespace={namespace} name={name} compact triggerVariant="outline" />
          <div className="w-px h-5 bg-border mx-0.5" />
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
                      <Badge variant={jobStatus.variant}>{jobStatus.label}</Badge>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Completions</p>
                      <p className="text-lg font-bold">{job.status?.succeeded || 0}/{job.spec?.completions || 1}</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Active</p>
                      <p className="text-lg font-bold">{job.status?.active || 0}</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Failed</p>
                      <p className={`text-lg font-bold ${(job.status?.failed || 0) > 0 ? 'text-red-500' : ''}`}>{job.status?.failed || 0}</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Duration</p>
                      <p className="text-sm font-bold">{getJobDuration(job)}</p>
                    </Card>
                    <Card className="p-3 space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Created</p>
                      <p className="text-sm font-bold">{formatDate(job.metadata?.creationTimestamp || '')}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {job.metadata?.creationTimestamp ? new Date(job.metadata.creationTimestamp).toLocaleString() : ''}
                      </p>
                    </Card>
                  </div>

                  {/* Pods Table */}
                  {pods && pods.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Pods ({pods.length})</CardTitle>
                      </CardHeader>
                      <CardContent className="px-0 pb-0">
                        <PodTable pods={pods} />
                      </CardContent>
                    </Card>
                  )}

                  {/* Job Information */}
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold">Job Information</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Created</span>
                          <p className="font-medium">{formatDate(job.metadata?.creationTimestamp || '', true)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Parallelism</span>
                          <p className="font-medium">{job.spec?.parallelism ?? 1}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Backoff Limit</span>
                          <p className="font-medium">{job.spec?.backoffLimit ?? 6}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Active Deadline</span>
                          <p className="font-medium">{job.spec?.activeDeadlineSeconds ? `${job.spec.activeDeadlineSeconds}s` : 'Not set'}</p>
                        </div>
                        {getOwnerInfo(job.metadata) && (
                          <div>
                            <span className="text-muted-foreground text-xs">Owner</span>
                            <p className="font-medium">
                              {(() => {
                                const ownerInfo = getOwnerInfo(job.metadata)
                                if (!ownerInfo) return 'No owner'
                                return (<Link to={ownerInfo.path} className="text-primary hover:underline">{ownerInfo.kind}/{ownerInfo.name}</Link>)
                              })()}
                            </p>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground text-xs">TTL After Finished</span>
                          <p className="font-medium">{job.spec?.ttlSecondsAfterFinished ? `${job.spec.ttlSecondsAfterFinished}s` : 'Not set'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Start Time</span>
                          <p className="font-medium">{job.status?.startTime ? formatDate(job.status.startTime, false) : '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Completion Time</span>
                          <p className="font-medium">{job.status?.completionTime ? formatDate(job.status.completionTime, false) : '-'}</p>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs">UID</span>
                          <p className="font-mono text-xs text-muted-foreground">{job.metadata?.uid}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Init Containers */}
                  {initContainers.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm font-semibold">Init Containers ({initContainers.length})</CardTitle></CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-4">{initContainers.map((container) => (<ContainerTable key={container.name} container={container} init />))}</div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Containers */}
                  {containers.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4"><CardTitle className="text-sm font-semibold">Containers ({containers.length})</CardTitle></CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="space-y-4">{containers.map((container) => (<ContainerTable key={container.name} container={container} />))}</div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* ── Right Sidebar ── */}
                <div className="space-y-4">
                  <SidebarEvents resource="jobs" name={name} namespace={namespace} />
                  <SidebarRelatedResources resource="jobs" name={name} namespace={namespace} />
                  <SidebarLabels labels={job.metadata?.labels || {}} />
                  <SidebarAnnotations annotations={job.metadata?.annotations || {}} />
                </div>
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: <YamlEditor<'jobs'> key={refreshKey} value={yamlContent} title="YAML Configuration" onSave={handleSaveYaml} onChange={handleYamlChange} isSaving={isSavingYaml} />,
          },
          ...(pods && pods.length > 0
            ? [
              { value: 'pods', label: (<>Pods {pods && <Badge variant="secondary">{pods.length}</Badge>}</>), content: <PodTable pods={pods} /> },
              { value: 'logs', label: 'Logs', content: (<div className="space-y-6"><LogViewer namespace={namespace} pods={pods} containers={job.spec?.template.spec?.containers} initContainers={job.spec?.template.spec?.initContainers} labelSelector={`job-name=${name}`} /></div>) },
              { value: 'terminal', label: 'Terminal', content: (<div className="space-y-6"><Terminal namespace={namespace} pods={pods} containers={job.spec?.template.spec?.containers} initContainers={job.spec?.template.spec?.initContainers} /></div>) },
            ]
            : []),
          {
            value: 'related', label: 'Related',
            content: (<div className="space-y-6"><ResourceTopology resource="jobs" name={name} namespace={namespace} /><RelatedResourcesTable resource={'jobs'} name={name} namespace={namespace} /></div>),
          },
          { value: 'events', label: 'Events', content: <EventTable resource="jobs" name={name} namespace={namespace} /> },
          { value: 'history', label: 'History', content: <ResourceHistoryTable resourceType="jobs" name={name} namespace={namespace} currentResource={job} /> },
          ...(volumes ? [{ value: 'volumes' as const, label: 'Volumes', content: <VolumeTable namespace={namespace} volumes={volumes} containers={containers} /> }] : []),
          { value: 'monitor', label: 'Monitor', content: <PodMonitoring namespace={namespace} pods={pods} containers={job.spec?.template.spec?.containers} initContainers={job.spec?.template.spec?.initContainers} labelSelector={`job-name=${name}`} /> },
        ]}
      />

      <ResourceDeleteConfirmationDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen} resourceName={name} resourceType="jobs" namespace={namespace} />
    </div>
  )
}

