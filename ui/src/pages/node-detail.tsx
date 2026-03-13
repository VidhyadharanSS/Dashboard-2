import { useEffect, useState } from 'react'
import {
  IconCircleCheckFilled,
  IconExclamationCircle,
  IconLoader,
  IconRefresh,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { Node } from 'kubernetes-types/core/v1'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  updateResource,
  useResource,
  useResources,
} from '@/lib/api'
import { useAuth } from '@/contexts/auth-context'
import { usePermissions } from '@/hooks/use-permissions'
import {
  enrichNodeConditionsWithHealth,
  formatCPU,
  formatDate,
  formatMemory,
  translateError,
} from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { DescribeDialog } from '@/components/describe-dialog'
import { QuickYamlDialog } from '@/components/quick-yaml-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { NodeMonitoring } from '@/components/node-monitoring'
import { PodTable } from '@/components/pod-table'
import { Terminal } from '@/components/terminal'
import { YamlEditor } from '@/components/yaml-editor'
import { ResourceTopology } from '@/components/resource-topology'

export function NodeDetail(props: { name: string }) {
  const { name } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const { t } = useTranslation()
  const { user } = useAuth()
  const { canAccess } = usePermissions()
  const isAdmin = user?.isAdmin() ?? false
  const canExecNode = canAccess('nodes', 'exec')

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: handleRefresh,
  } = useResource('nodes', name)

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const {
    data: relatedPods,
    isLoading: isLoadingRelated,
    refetch: refetchRelated,
  } = useResources('pods', undefined, {
    fieldSelector: `spec.nodeName=${name}`,
  })

  const handleSaveYaml = async (content: Node) => {
    setIsSavingYaml(true)
    try {
      await updateResource('nodes', name, undefined, content)
      toast.success('YAML saved successfully')
    } catch (error) {
      console.error('Failed to save YAML:', error)
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleManualRefresh = async () => {
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
    await refetchRelated()
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading node details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorMessage resourceName="Node" error={error} refetch={handleRefresh} />
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{name}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={isLoading}
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
          >
            <IconRefresh className="w-4 h-4" />
            Refresh
          </Button>
          <QuickYamlDialog resourceType="nodes" name={name} triggerAsText />
          <DescribeDialog resourceType="nodes" name={name} />
        </div>
      </div>

      <ResponsiveTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-6">
                {/* Status Overview */}
                <Card>
                  <CardHeader>
                    <CardTitle>Status Overview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          {data.status?.conditions?.find(
                            (c) => c.type === 'Ready' && c.status === 'True'
                          ) ? (
                            <IconCircleCheckFilled className="w-4 h-4 fill-green-500" />
                          ) : (
                            <IconExclamationCircle className="w-4 h-4 fill-red-500" />
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Status
                          </p>
                          <p className="text-sm font-medium">
                            {data.status?.conditions?.find(
                              (c) => c.type === 'Ready' && c.status === 'True'
                            )
                              ? 'Ready'
                              : 'Not Ready'}
                            {data.spec?.unschedulable
                              ? ' (SchedulingDisabled)'
                              : ''}
                          </p>
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">Role</p>
                        <p className="text-sm">
                          {Object.keys(data.metadata?.labels || {})
                            .find((key) =>
                              key.startsWith('node-role.kubernetes.io/')
                            )
                            ?.replace('node-role.kubernetes.io/', '') || 'N/A'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Internal IP
                        </p>
                        <p className="text-sm font-medium font-mono">
                          {data.status?.addresses?.find(
                            (addr) => addr.type === 'InternalIP'
                          )?.address || 'N/A'}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">
                          Pod CIDR
                        </p>
                        <p className="text-sm font-medium font-mono">
                          {data.spec?.podCIDR || 'N/A'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Node Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>Node Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(
                            data.metadata?.creationTimestamp || '',
                            true
                          )}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Kubelet Version
                        </Label>
                        <p className="text-sm">
                          {data.status?.nodeInfo?.kubeletVersion || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Hostname
                        </Label>
                        <p className="text-sm font-mono">
                          {data.status?.addresses?.find(
                            (addr) => addr.type === 'Hostname'
                          )?.address || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          External IP
                        </Label>
                        <p className="text-sm font-mono">
                          {data.status?.addresses?.find(
                            (addr) => addr.type === 'ExternalIP'
                          )?.address || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          OS Image
                        </Label>
                        <p className="text-sm">
                          {data.status?.nodeInfo?.osImage || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Kernel Version
                        </Label>
                        <p className="text-sm">
                          {data.status?.nodeInfo?.kernelVersion || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Architecture
                        </Label>
                        <p className="text-sm">
                          {data.status?.nodeInfo?.architecture || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Container Runtime
                        </Label>
                        <p className="text-sm">
                          {data.status?.nodeInfo?.containerRuntimeVersion ||
                            'N/A'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Kube Proxy Version
                        </Label>
                        <p className="text-sm">
                          {data.status?.nodeInfo?.kubeProxyVersion || 'N/A'}
                        </p>
                      </div>
                    </div>
                    <LabelsAnno
                      labels={data.metadata?.labels || {}}
                      annotations={data.metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>

                {/* Resource Capacity & Allocation */}
                <Card>
                  <CardHeader>
                    <CardTitle>Resource Capacity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-medium mb-3">
                          CPU & Memory
                        </h4>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center p-3 border rounded-lg">
                            <div>
                              <p className="text-sm font-medium">CPU</p>
                              <p className="text-xs text-muted-foreground">
                                Capacity:{' '}
                                {data.status?.capacity?.cpu
                                  ? formatCPU(data.status.capacity.cpu)
                                  : 'N/A'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {data.status?.allocatable?.cpu
                                  ? formatCPU(data.status.allocatable.cpu)
                                  : 'N/A'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Allocatable
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-between items-center p-3 border rounded-lg">
                            <div>
                              <p className="text-sm font-medium">Memory</p>
                              <p className="text-xs text-muted-foreground">
                                Capacity:{' '}
                                {data.status?.capacity?.memory
                                  ? formatMemory(data.status.capacity.memory)
                                  : 'N/A'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {data.status?.allocatable?.memory
                                  ? formatMemory(data.status.allocatable.memory)
                                  : 'N/A'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Allocatable
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium mb-3">
                          Pods & Storage
                        </h4>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center p-3 border rounded-lg">
                            <div>
                              <p className="text-sm font-medium">Pods</p>
                              <p className="text-xs text-muted-foreground">
                                Capacity: {data.status?.capacity?.pods || 'N/A'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {data.status?.allocatable?.pods || 'N/A'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Allocatable
                              </p>
                            </div>
                          </div>
                          <div className="flex justify-between items-center p-3 border rounded-lg">
                            <div>
                              <p className="text-sm font-medium">Storage</p>
                              <p className="text-xs text-muted-foreground">
                                Capacity:{' '}
                                {data.status?.capacity?.['ephemeral-storage']
                                  ? formatMemory(
                                    data.status.capacity['ephemeral-storage']
                                  )
                                  : 'N/A'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {data.status?.allocatable?.['ephemeral-storage']
                                  ? formatMemory(
                                    data.status.allocatable[
                                    'ephemeral-storage'
                                    ]
                                  )
                                  : 'N/A'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Allocatable
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Node Taints */}
                {data.spec?.taints && data.spec.taints.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Node Taints</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 gap-2">
                        {data.spec.taints.map((taint, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-3 border rounded-lg"
                          >
                            <Badge variant="secondary">{taint.effect}</Badge>
                            <div className="flex-1">
                              <p className="text-sm font-medium">{taint.key}</p>
                              {taint.value && (
                                <p className="text-xs text-muted-foreground">
                                  = {taint.value}
                                </p>
                              )}
                            </div>
                            {taint.timeAdded && (
                              <p className="text-xs text-muted-foreground">
                                {formatDate(taint.timeAdded)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Node Conditions */}
                {data.status?.conditions &&
                  data.status.conditions.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Node Conditions</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {enrichNodeConditionsWithHealth(
                            data.status.conditions
                          ).map((condition, index) => (
                            <div
                              key={index}
                              className="flex items-center gap-3 p-3 border rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={`w-2 h-2 rounded-full ${condition.health === 'True'
                                    ? 'bg-green-500'
                                    : condition.health === 'False'
                                      ? 'bg-red-500'
                                      : 'bg-yellow-500'
                                    }`}
                                />
                                <Badge
                                  variant={
                                    condition.health === 'True'
                                      ? 'default'
                                      : 'secondary'
                                  }
                                  className="text-xs"
                                >
                                  {condition.type}
                                </Badge>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-muted-foreground truncate">
                                  {condition.message ||
                                    condition.reason ||
                                    'No message'}
                                </p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {condition.status}
                              </Badge>
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
              <div className="space-y-4">
                <YamlEditor<'nodes'>
                  key={refreshKey}
                  value={yamlContent}
                  title="YAML Configuration"
                  onSave={handleSaveYaml}
                  onChange={handleYamlChange}
                  isSaving={isSavingYaml}
                />
              </div>
            ),
          },
          {
            value: 'related',
            label: 'Related',
            content: (
              <div className="animate-in fade-in duration-500">
                <ResourceTopology resource="nodes" name={name} />
              </div>
            ),
          },
          ...(relatedPods && relatedPods.length > 0
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
                    isLoading={isLoadingRelated}
                    hiddenNode
                  />
                ),
              },
            ]
            : []),
          {
            value: 'monitor',
            label: 'Monitor',
            content: <NodeMonitoring name={name} />,
          },
          // Node terminal: only shown to admin users or those with explicit 'exec' permission on 'nodes'.
          // The backend also independently enforces rbac.CanAccess(user, "nodes", "exec", cluster, "")
          // so even if someone tampers with the frontend, the backend will reject the connection.
          ...(isAdmin || canExecNode ? [{
            value: 'Terminal',
            label: (
              <span className="flex items-center gap-1.5">
                Terminal
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-600">Admin</Badge>
              </span>
            ),
            content: (
              <div className="space-y-6">
                <Terminal
                  type="node"
                  nodeName={name}
                  requireConfirmation={true}
                />
              </div>
            ),
          }] : []),
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource={'nodes'}
                namespace={undefined}
                name={name}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
