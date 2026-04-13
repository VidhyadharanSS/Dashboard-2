import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconRocket, IconLoader2, IconLayersIntersect, IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import type { Deployment } from 'kubernetes-types/apps/v1'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { getDeploymentStatus } from '@/lib/k8s'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function RecentDeploymentsWidget() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { canAccess } = usePermissions()
    const { data: deployments, isLoading } = useResources('deployments', undefined, {
        refreshInterval: 30000,
        disable: !canAccess('deployments', 'list')
    })

    const recentDeployments = deployments
        ? (deployments as Deployment[])
            .sort((a, b) => {
                const timeA = a.metadata?.creationTimestamp || ''
                const timeB = b.metadata?.creationTimestamp || ''
                return new Date(timeB).getTime() - new Date(timeA).getTime()
            })
            .slice(0, 6)
        : []

    return (
        <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-violet-500/10 rounded-md">
                        <IconRocket className="h-4 w-4 text-violet-500" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        {t('dashboard.recentDeployments', 'Recent Deployments')}
                    </CardTitle>
                </div>
                {recentDeployments.length > 0 && (
                    <Badge variant="outline" className="h-5 text-[10px] font-mono">
                        {(deployments as Deployment[] | undefined)?.length || 0} total
                    </Badge>
                )}
            </CardHeader>
            <CardContent className="flex-1 pt-3 pb-2 px-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : recentDeployments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                        <IconLayersIntersect className="h-8 w-8 opacity-30" />
                        <p className="text-xs font-medium">No deployments found</p>
                    </div>
                ) : (
                    <TooltipProvider>
                        <div className="space-y-1">
                            {recentDeployments.map((dep) => {
                                const ready = dep.status?.readyReplicas || 0
                                const total = dep.spec?.replicas || 0
                                const isHealthy = ready === total && total > 0
                                const status = getDeploymentStatus(dep)
                                const isProgressing = status === 'Progressing'
                                const image = dep.spec?.template?.spec?.containers?.[0]?.image || ''
                                const imageTag = image.split(':').pop() || 'latest'

                                return (
                                    <button
                                        key={dep.metadata?.uid}
                                        onClick={() =>
                                            navigate(
                                                `/deployments/${dep.metadata?.namespace}/${dep.metadata?.name}`
                                            )
                                        }
                                        className="w-full group flex items-center gap-2 p-2 rounded-md hover:bg-muted/60 transition-colors text-left border border-transparent hover:border-border/50"
                                    >
                                        {/* Status indicator */}
                                        <div className={`h-2 w-2 rounded-full shrink-0 ${
                                            isProgressing ? 'bg-blue-500 animate-pulse' :
                                            isHealthy ? 'bg-emerald-500' :
                                            status === 'Scaled Down' ? 'bg-gray-400' :
                                            'bg-red-500'
                                        }`} />

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                                                    {dep.metadata?.name}
                                                </span>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Badge variant="outline" className="text-[9px] h-4 font-mono shrink-0">
                                                            {imageTag.length > 15 ? imageTag.slice(0, 12) + '…' : imageTag}
                                                        </Badge>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="text-xs font-mono">
                                                        {image}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                <span>{dep.metadata?.namespace}</span>
                                                <span>·</span>
                                                <span className={isHealthy ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                                                    {ready}/{total} ready
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <Badge
                                                variant={isHealthy ? 'default' : isProgressing ? 'secondary' : 'destructive'}
                                                className="text-[10px] h-5"
                                            >
                                                {status}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground hidden sm:inline">
                                                {dep.metadata?.creationTimestamp &&
                                                    formatDistanceToNow(
                                                        new Date(dep.metadata.creationTimestamp),
                                                        { addSuffix: true }
                                                    ).replace('about ', '')}
                                            </span>
                                        </div>
                                    </button>
                                )
                            })}

                            {/* View all link */}
                            <button
                                onClick={() => navigate('/deployments')}
                                className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-primary font-medium hover:text-primary/80 transition-colors"
                            >
                                <IconExternalLink className="h-3 w-3" />
                                View all deployments
                            </button>
                        </div>
                    </TooltipProvider>
                )}
            </CardContent>
        </Card>
    )
}
