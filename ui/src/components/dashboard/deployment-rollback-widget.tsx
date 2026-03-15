import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    IconHistory,
    IconLoader2,
    IconRotate2,
    IconChevronRight,
    IconAlertCircle,
    IconCheck,
    IconClock,
    IconEye,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useResources, useResourceHistory, applyResource } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import type { Deployment } from 'kubernetes-types/apps/v1'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { ResourceHistory } from '@/types/api'
import { YamlDiffViewer } from '@/components/yaml-diff-viewer'
import * as yaml from 'js-yaml'

interface DeploymentVersion {
    id: number
    revision: number
    operationType: string
    operator: string
    createdAt: string
    success: boolean
    resourceYaml: string
    previousYaml: string
    image?: string
}

function RollbackDialog({
    open,
    onOpenChange,
    deployment,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    deployment: Deployment | null
}) {
    const { t } = useTranslation()
    const namespace = deployment?.metadata?.namespace || '_all'
    const name = deployment?.metadata?.name || ''

    const { data: historyResponse, isLoading: isLoadingHistory } = useResourceHistory(
        'deployments',
        namespace,
        name,
        1,
        20,
        { enabled: open && !!name }
    )

    const [isRollingBack, setIsRollingBack] = useState(false)
    const [selectedVersion, setSelectedVersion] = useState<ResourceHistory | null>(null)
    const [isDiffOpen, setIsDiffOpen] = useState(false)

    const versions: DeploymentVersion[] = useMemo(() => {
        if (!historyResponse?.data) return []
        return historyResponse.data
            .filter(h => h.success && h.resourceYaml)
            .map((h, idx) => {
                let image = ''
                try {
                    const parsed = yaml.load(h.resourceYaml) as any
                    image = parsed?.spec?.template?.spec?.containers?.[0]?.image || ''
                } catch { /* ignore */ }
                return {
                    id: h.id,
                    revision: historyResponse.data.length - idx,
                    operationType: h.operationType,
                    operator: h.operator?.username || 'unknown',
                    createdAt: h.createdAt,
                    success: h.success,
                    resourceYaml: h.resourceYaml,
                    previousYaml: h.previousYaml,
                    image,
                }
            })
    }, [historyResponse])

    const currentYaml = useMemo(() => {
        if (!deployment) return ''
        try {
            return yaml.dump(deployment, { indent: 2, sortKeys: true })
        } catch {
            return ''
        }
    }, [deployment])

    const handleRollback = useCallback(async (yamlContent: string) => {
        try {
            setIsRollingBack(true)
            await applyResource(yamlContent)
            toast.success(t('resourceHistory.rollback.success', 'Successfully rolled back resource'))
            onOpenChange(false)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
            toast.error(`${t('resourceHistory.rollback.error', 'Failed to rollback resource')}: ${errorMessage}`)
        } finally {
            setIsRollingBack(false)
        }
    }, [t, onOpenChange])

    const handleViewDiff = useCallback((version: DeploymentVersion) => {
        const historyEntry: ResourceHistory = {
            id: version.id,
            resourceYaml: version.resourceYaml,
            previousYaml: version.previousYaml,
        } as ResourceHistory
        setSelectedVersion(historyEntry)
        setIsDiffOpen(true)
    }, [])

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <IconHistory className="h-5 w-5" />
                            Rollback — {name}
                            <Badge variant="secondary" className="text-xs font-normal">
                                {namespace}
                            </Badge>
                        </DialogTitle>
                    </DialogHeader>

                    {isLoadingHistory ? (
                        <div className="flex items-center justify-center py-12">
                            <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : versions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                            <IconHistory className="h-8 w-8 opacity-40" />
                            <p className="text-sm">No version history available for this deployment</p>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                            {/* Current version indicator */}
                            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20">
                                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                <span className="text-xs font-medium text-primary">Current Version</span>
                                {versions[0] && (
                                    <span className="ml-auto text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                                        {versions[0].image}
                                    </span>
                                )}
                            </div>

                            {versions.map((version, idx) => (
                                <div
                                    key={version.id}
                                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-md border transition-all hover:bg-muted/50 ${idx === 0 ? 'border-primary/30 bg-primary/5' : 'border-border/50'
                                        }`}
                                >
                                    {/* Timeline indicator */}
                                    <div className="flex flex-col items-center shrink-0">
                                        <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${idx === 0
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted text-muted-foreground'
                                            }`}>
                                            {version.revision}
                                        </div>
                                    </div>

                                    {/* Version info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <Badge
                                                variant={version.operationType.toLowerCase() === 'create' ? 'default' : 'secondary'}
                                                className="text-[10px] h-4"
                                            >
                                                {version.operationType.toUpperCase()}
                                            </Badge>
                                            {idx === 0 && (
                                                <Badge variant="outline" className="text-[10px] h-4 border-primary/40 text-primary">
                                                    LIVE
                                                </Badge>
                                            )}
                                            <span className="text-[10px] text-muted-foreground ml-auto">
                                                by {version.operator}
                                            </span>
                                        </div>
                                        {version.image && (
                                            <div className="text-[11px] font-mono text-foreground/70 truncate">
                                                {version.image}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                                            <IconClock className="h-3 w-3" />
                                            {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                                        </div>
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => handleViewDiff(version)}
                                            title="View YAML diff"
                                        >
                                            <IconEye className="h-3.5 w-3.5" />
                                        </Button>
                                        {idx !== 0 && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs gap-1"
                                                onClick={() => handleRollback(version.resourceYaml)}
                                                disabled={isRollingBack}
                                            >
                                                {isRollingBack ? (
                                                    <IconLoader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <IconRotate2 className="h-3 w-3" />
                                                )}
                                                Rollback
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Diff viewer for version comparison */}
            {selectedVersion && (
                <YamlDiffViewer
                    open={isDiffOpen}
                    onOpenChange={setIsDiffOpen}
                    original={selectedVersion.previousYaml || ''}
                    modified={selectedVersion.resourceYaml || ''}
                    current={currentYaml}
                    title="Version Diff"
                    onRollback={handleRollback}
                    isRollingBack={isRollingBack}
                />
            )}
        </>
    )
}

export function DeploymentRollbackWidget() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { canAccess } = usePermissions()
    const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null)
    const [rollbackOpen, setRollbackOpen] = useState(false)
    const [selectedNamespace, setSelectedNamespace] = useState<string>('_all')

    const { data: deployments, isLoading } = useResources('deployments', selectedNamespace === '_all' ? undefined : selectedNamespace, {
        refreshInterval: 30000,
        disable: !canAccess('deployments', 'list'),
    })

    const { data: namespaces } = useResources('namespaces', undefined, {
        staleTime: 60000,
    })

    const namespaceList = useMemo(() => {
        if (!namespaces) return []
        return (namespaces as any[]).map(ns => ns.metadata?.name).filter(Boolean).sort()
    }, [namespaces])

    // Sort by last update (observedGeneration or creationTimestamp)
    const sortedDeployments = useMemo(() => {
        if (!deployments) return []
        return (deployments as Deployment[])
            .sort((a, b) => {
                // Prefer more recently updated deployments
                const genA = a.status?.observedGeneration || 0
                const genB = b.status?.observedGeneration || 0
                if (genA !== genB) return genB - genA
                const timeA = a.metadata?.creationTimestamp || ''
                const timeB = b.metadata?.creationTimestamp || ''
                return new Date(timeB).getTime() - new Date(timeA).getTime()
            })
            .slice(0, 8)
    }, [deployments])

    const handleOpenRollback = useCallback((dep: Deployment) => {
        setSelectedDeployment(dep)
        setRollbackOpen(true)
    }, [])

    return (
        <>
            <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-primary/10 rounded-md">
                            <IconRotate2 className="h-4 w-4 text-primary" />
                        </div>
                        <CardTitle className="text-sm font-semibold tracking-tight">
                            Deployment Rollback
                        </CardTitle>
                    </div>
                    <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
                        <SelectTrigger className="h-7 w-[140px] text-[10px]">
                            <SelectValue placeholder="All Namespaces" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="_all" className="text-xs">All Namespaces</SelectItem>
                            {namespaceList.map(ns => (
                                <SelectItem key={ns} value={ns} className="text-xs">{ns}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardHeader>
                <CardContent className="flex-1 pt-3 pb-2 px-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : sortedDeployments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                            <IconHistory className="h-6 w-6 opacity-40" />
                            <p className="text-xs">No deployments found</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {sortedDeployments.map((dep) => {
                                const ready = dep.status?.readyReplicas || 0
                                const total = dep.spec?.replicas || 0
                                const isHealthy = ready === total && total > 0
                                const isProgressing = dep.status?.conditions?.some(
                                    c => c.type === 'Progressing' && c.status === 'True' && c.reason === 'ReplicaSetUpdated'
                                )
                                const image = dep.spec?.template?.spec?.containers?.[0]?.image || ''
                                const imageTag = image.split(':').pop() || 'latest'

                                return (
                                    <div
                                        key={dep.metadata?.uid}
                                        className="group flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 transition-colors border border-transparent hover:border-border/50"
                                    >
                                        {/* Status indicator */}
                                        <div className={`h-2 w-2 rounded-full shrink-0 ${isProgressing ? 'bg-amber-500 animate-pulse' :
                                                isHealthy ? 'bg-emerald-500' : 'bg-red-500'
                                            }`} />

                                        {/* Deployment info */}
                                        <button
                                            onClick={() => navigate(`/deployments/${dep.metadata?.namespace}/${dep.metadata?.name}`)}
                                            className="flex-1 min-w-0 text-left"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs font-medium truncate">{dep.metadata?.name}</span>
                                                <Badge variant="outline" className="text-[9px] h-4 shrink-0 font-mono">
                                                    {imageTag}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                <span>{dep.metadata?.namespace}</span>
                                                <span>·</span>
                                                <span>{ready}/{total} ready</span>
                                                {dep.status?.observedGeneration && (
                                                    <>
                                                        <span>·</span>
                                                        <span>gen {dep.status.observedGeneration}</span>
                                                    </>
                                                )}
                                            </div>
                                        </button>

                                        {/* Rollback button */}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => handleOpenRollback(dep)}
                                            title="View versions & rollback"
                                        >
                                            <IconRotate2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <RollbackDialog
                open={rollbackOpen}
                onOpenChange={setRollbackOpen}
                deployment={selectedDeployment}
            />
        </>
    )
}
