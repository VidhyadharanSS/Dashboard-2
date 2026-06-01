import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNamespaceContext } from '@/hooks/use-namespace-context'

import { IconLoader, IconRefresh, IconTrash, IconShieldCheck, IconUser, IconUsers, IconServer } from '@tabler/icons-react'
import { Check, X, Shield, ShieldAlert } from 'lucide-react'
import * as yaml from 'js-yaml'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { ResourceType, ResourceTypeMap } from '@/types/api'
import { updateResource, useResource } from '@/lib/api'
import { getOwnerInfo } from '@/lib/k8s'
import { formatDate, translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { DescribeDialog } from '@/components/describe-dialog'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { RelatedResourcesTable } from '@/components/related-resource-table'
import { ResourceDeleteConfirmationDialog } from '@/components/resource-delete-confirmation-dialog'
import { ResourceHistoryTable } from '@/components/resource-history-table'
import { YamlEditor } from '@/components/yaml-editor'
import { FavoriteButton } from '@/components/favorite-button'
import { ResourceTopology } from '@/components/resource-topology'

// RBAC resource types that get enhanced detail views
const RBAC_TYPES = new Set(['roles', 'clusterroles', 'rolebindings', 'clusterrolebindings'])
const ROLE_TYPES = new Set(['roles', 'clusterroles'])
const BINDING_TYPES = new Set(['rolebindings', 'clusterrolebindings'])

const ALL_VERBS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete']

function SubjectIcon({ kind }: { kind: string }) {
  switch (kind) {
    case 'User': return <IconUser className="h-3.5 w-3.5" />
    case 'Group': return <IconUsers className="h-3.5 w-3.5" />
    case 'ServiceAccount': return <IconServer className="h-3.5 w-3.5" />
    default: return <IconShieldCheck className="h-3.5 w-3.5" />
  }
}

/** Renders permission rules for Role / ClusterRole */
function RBACRulesPanel({ rules }: { rules: any[] }) {
  if (!rules || rules.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No permission rules defined</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {rules.map((rule: any, idx: number) => {
        const resources = rule.resources || ['*']
        const verbs = rule.verbs || []
        const apiGroups = rule.apiGroups || ['""']
        const isWildcardVerbs = verbs.includes('*')
        const isWildcardResources = resources.includes('*')

        return (
          <Card key={idx} className="overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b">
              <Badge variant="outline" className="text-[10px] h-5 font-mono">Rule {idx + 1}</Badge>
              {apiGroups.map((ag: string, i: number) => (
                <Badge key={i} variant="secondary" className="text-[9px] h-4 px-1.5 font-mono">
                  apiGroup: {ag || 'core'}
                </Badge>
              ))}
              {isWildcardVerbs && isWildcardResources && (
                <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[9px] h-4 gap-1">
                  <ShieldAlert className="h-2.5 w-2.5" /> Full Access
                </Badge>
              )}
            </div>
            <CardContent className="p-4 space-y-3">
              {/* Resources */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Resources</p>
                <div className="flex flex-wrap gap-1">
                  {resources.map((res: string, i: number) => (
                    <Badge key={i} variant="outline" className={`text-xs font-mono ${res === '*' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : ''
                      }`}>
                      {res === '*' ? '* (all)' : res}
                    </Badge>
                  ))}
                </div>
                {rule.resourceNames && rule.resourceNames.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Resource Names (scoped)</p>
                    <div className="flex flex-wrap gap-1">
                      {rule.resourceNames.map((name: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[10px] font-mono">{name}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Verbs grid */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Permissions</p>
                <div className="flex flex-wrap gap-1.5">
                  {(isWildcardVerbs ? ALL_VERBS : ALL_VERBS).map((verb) => {
                    const allowed = isWildcardVerbs || verbs.includes(verb)
                    return (
                      <div key={verb} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${allowed
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-muted/30 text-muted-foreground/40 border border-transparent'
                        }`}>
                        {allowed ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        {verb}
                      </div>
                    )
                  })}
                  {/* Show any non-standard verbs */}
                  {verbs.filter((v: string) => v !== '*' && !ALL_VERBS.includes(v)).map((verb: string) => (
                    <div key={verb} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20">
                      <Check className="h-3 w-3" />
                      {verb}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

/** Renders subjects for RoleBinding / ClusterRoleBinding */
function RBACSubjectsPanel({ subjects, roleRef }: { subjects: any[]; roleRef: any }) {
  return (
    <div className="space-y-4">
      {/* Role Reference */}
      {roleRef && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <IconShieldCheck className="h-4 w-4 text-primary" />
              Bound Role
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono">{roleRef.kind}</Badge>
              <span className="text-sm font-semibold">{roleRef.name}</span>
              {roleRef.apiGroup && (
                <Badge variant="secondary" className="text-[9px] h-4 font-mono">{roleRef.apiGroup}</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subjects */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <IconUsers className="h-4 w-4 text-primary" />
            Subjects ({subjects?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(!subjects || subjects.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No subjects bound</p>
          ) : (
            <div className="space-y-2">
              {subjects.map((sub: any, idx: number) => (
                <div key={idx} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                  <div className={`p-1.5 rounded-md ${sub.kind === 'User' ? 'bg-blue-500/10 text-blue-500' :
                    sub.kind === 'Group' ? 'bg-violet-500/10 text-violet-500' :
                      'bg-emerald-500/10 text-emerald-500'
                    }`}>
                    <SubjectIcon kind={sub.kind} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{sub.name}</span>
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 shrink-0">{sub.kind}</Badge>
                    </div>
                    {sub.namespace && (
                      <span className="text-[10px] text-muted-foreground">Namespace: {sub.namespace}</span>
                    )}
                  </div>
                  {sub.apiGroup && (
                    <Badge variant="secondary" className="text-[9px] h-4 font-mono shrink-0">{sub.apiGroup}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function SimpleResourceDetail<T extends ResourceType>(props: {
  resourceType: T
  name: string
  namespace?: string
}) {
  const { namespace, name, resourceType } = props
  const [yamlContent, setYamlContent] = useState('')
  const [isSavingYaml, setIsSavingYaml] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const navigate = useNavigate()
  const { setActiveNamespace } = useNamespaceContext()


  const { t } = useTranslation()

  const {
    data,
    isLoading,
    isError,
    error,
    refetch: handleRefresh,
  } = useResource(resourceType, name, namespace)

  // ── RBAC-specific derived state ──
  // IMPORTANT: All hooks must be called unconditionally (before any early return)
  // to satisfy React's Rules of Hooks.
  const isRBACResource = RBAC_TYPES.has(resourceType)
  const isRoleType = ROLE_TYPES.has(resourceType)
  const isBindingType = BINDING_TYPES.has(resourceType)

  const rbacRules = useMemo(() => {
    if (!data || !isRoleType) return []
    return (data as any)?.rules || []
  }, [data, isRoleType])

  const rbacSubjects = useMemo(() => {
    if (!data || !isBindingType) return []
    return (data as any)?.subjects || []
  }, [data, isBindingType])

  const rbacRoleRef = useMemo(() => {
    if (!data || !isBindingType) return null
    return (data as any)?.roleRef || null
  }, [data, isBindingType])

  useEffect(() => {
    if (data) {
      setYamlContent(yaml.dump(data, { indent: 2 }))
    }
  }, [data])

  const handleSaveYaml = async (content: ResourceTypeMap[T]) => {
    setIsSavingYaml(true)
    try {
      await updateResource(resourceType, name, namespace, content)
      toast.success('YAML saved successfully')
      // Refresh data after successful save
      await handleRefresh()
    } catch (error) {
      toast.error(translateError(error, t))
    } finally {
      setIsSavingYaml(false)
    }
  }

  const handleYamlChange = (content: string) => {
    setYamlContent(content)
  }

  const handleManualRefresh = async () => {
    // Increment refresh key to force YamlEditor re-render
    setRefreshKey((prev) => prev + 1)
    await handleRefresh()
  }

  // ── Early returns AFTER all hooks ──
  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <IconLoader className="animate-spin" />
              <span>Loading {resourceType.slice(0, -1)} details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <ErrorMessage
        resourceName={resourceType.slice(0, -1)}
        error={error}
        refetch={handleRefresh}
      />
    )
  }

  return (
    <div className="space-y-2 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{name}</h1>
            {isRBACResource && (
              <Badge variant="outline" className="text-[10px] h-5 gap-1">
                <IconShieldCheck className="h-3 w-3" />
                {resourceType === 'clusterroles' || resourceType === 'clusterrolebindings' ? 'Cluster-scoped' : 'Namespaced'}
              </Badge>
            )}
          </div>
          {namespace && (
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
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <FavoriteButton resourceType={resourceType} name={name} namespace={namespace} />
          <Button
            disabled={isLoading}
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleManualRefresh}
            title="Refresh"
          >
            <IconRefresh className="w-3.5 h-3.5" />
          </Button>
          <DescribeDialog
            resourceType={resourceType}
            namespace={namespace}
            name={name}
            compact
            triggerVariant="outline"
          />
          <div className="w-px h-5 bg-border mx-0.5" />
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

      <ResponsiveTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="capitalize">
                      {resourceType.slice(0, -1)} Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Created
                        </Label>
                        <p className="text-sm">
                          {formatDate(data.metadata?.creationTimestamp || '')}
                        </p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          UID
                        </Label>
                        <p className="text-sm font-mono">
                          {data.metadata?.uid || 'N/A'}
                        </p>
                      </div>
                      {getOwnerInfo(data.metadata) && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Owner
                          </Label>
                          <p className="text-sm">
                            {(() => {
                              const ownerInfo = getOwnerInfo(data.metadata)
                              if (!ownerInfo) {
                                return 'No owner'
                              }
                              return (
                                <Link
                                  to={ownerInfo.path}
                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  {ownerInfo.kind}/{ownerInfo.name}
                                </Link>
                              )
                            })()}
                          </p>
                        </div>
                      )}
                    </div>
                    <LabelsAnno
                      labels={data.metadata?.labels || {}}
                      annotations={data.metadata?.annotations || {}}
                    />
                  </CardContent>
                </Card>

                {/* RBAC-specific overview content */}
                {isRoleType && rbacRules.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <IconShieldCheck className="h-4 w-4 text-primary" />
                      Permission Rules ({rbacRules.length})
                    </h3>
                    <RBACRulesPanel rules={rbacRules} />
                  </div>
                )}

                {isBindingType && (
                  <RBACSubjectsPanel subjects={rbacSubjects} roleRef={rbacRoleRef} />
                )}

                {/* PVC-specific overview */}
                {resourceType === 'persistentvolumeclaims' && (() => {
                  const pvc = data as any
                  const phase = pvc?.status?.phase || 'Unknown'
                  const phaseColor =
                    phase === 'Bound' ? 'text-green-600 dark:text-green-400' :
                      phase === 'Pending' ? 'text-amber-600 dark:text-amber-500' :
                        phase === 'Lost' ? 'text-red-500' : 'text-muted-foreground'
                  return (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Volume Details</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                          <div>
                            <Label className="text-xs text-muted-foreground">Phase</Label>
                            <p className={`font-semibold ${phaseColor}`}>{phase}</p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Capacity</Label>
                            <p className="font-medium font-mono">
                              {pvc?.status?.capacity?.storage || pvc?.spec?.resources?.requests?.storage || '-'}
                            </p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Storage Class</Label>
                            {pvc?.spec?.storageClassName ? (
                              <Link to={`/storageclasses/${pvc.spec.storageClassName}`} className="text-blue-500 hover:underline text-sm">
                                {pvc.spec.storageClassName}
                              </Link>
                            ) : <p className="text-muted-foreground">-</p>}
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Bound Volume</Label>
                            {pvc?.spec?.volumeName ? (
                              <Link to={`/persistentvolumes/${pvc.spec.volumeName}`} className="text-blue-500 hover:underline text-sm">
                                {pvc.spec.volumeName}
                              </Link>
                            ) : <p className="text-muted-foreground">-</p>}
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Access Modes</Label>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {(pvc?.spec?.accessModes || []).map((m: string) => (
                                <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Volume Mode</Label>
                            <p className="font-medium">{pvc?.spec?.volumeMode || 'Filesystem'}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })()}

                {/* PV-specific overview */}
                {resourceType === 'persistentvolumes' && (() => {
                  const pv = data as any
                  const phase = pv?.status?.phase || 'Unknown'
                  const phaseColor =
                    phase === 'Bound' ? 'text-green-600 dark:text-green-400' :
                      phase === 'Available' ? 'text-blue-600 dark:text-blue-400' :
                        phase === 'Released' ? 'text-amber-600 dark:text-amber-500' :
                          phase === 'Failed' ? 'text-red-500' : 'text-muted-foreground'
                  const claimRef = pv?.spec?.claimRef
                  return (
                    <Card>
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Volume Details</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                          <div>
                            <Label className="text-xs text-muted-foreground">Phase</Label>
                            <p className={`font-semibold ${phaseColor}`}>{phase}</p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Capacity</Label>
                            <p className="font-medium font-mono">{pv?.spec?.capacity?.storage || '-'}</p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Storage Class</Label>
                            {pv?.spec?.storageClassName ? (
                              <Link to={`/storageclasses/${pv.spec.storageClassName}`} className="text-blue-500 hover:underline text-sm">
                                {pv.spec.storageClassName}
                              </Link>
                            ) : <p className="text-muted-foreground">-</p>}
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Reclaim Policy</Label>
                            <p className="font-medium">{pv?.spec?.persistentVolumeReclaimPolicy || '-'}</p>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Access Modes</Label>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {(pv?.spec?.accessModes || []).map((m: string) => (
                                <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Bound Claim</Label>
                            {claimRef ? (
                              <Link
                                to={`/persistentvolumeclaims/${claimRef.namespace}/${claimRef.name}`}
                                className="text-blue-500 hover:underline text-sm"
                              >
                                {claimRef.namespace}/{claimRef.name}
                              </Link>
                            ) : <p className="text-muted-foreground">-</p>}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })()}
              </div>
            ),
          },
          {
            value: 'yaml',
            label: 'YAML',
            content: (
              <div className="space-y-4">
                <YamlEditor
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
            value: 'topology',
            label: 'Topology',
            content: (
              <ResourceTopology
                resource={resourceType}
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'Related',
            label: 'Related',
            content: (
              <RelatedResourcesTable
                resource={resourceType}
                name={name}
                namespace={namespace}
              />
            ),
          },
          {
            value: 'events',
            label: 'Events',
            content: (
              <EventTable
                resource={resourceType}
                namespace={namespace}
                name={name}
              />
            ),
          },
          {
            value: 'history',
            label: 'History',
            content: (
              <ResourceHistoryTable
                resourceType={resourceType}
                name={name}
                namespace={namespace}
                currentResource={data}
              />
            ),
          },
        ]}
      />

      <ResourceDeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        resourceName={name}
        resourceType={resourceType}
        namespace={namespace}
      />
    </div>
  )
}
