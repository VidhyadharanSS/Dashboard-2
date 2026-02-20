import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconRocket, IconLoader2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useResources } from '@/lib/api'
import type { Deployment } from 'kubernetes-types/apps/v1'
import { Badge } from '@/components/ui/badge'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'

export function RecentDeploymentsWidget() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { data: deployments, isLoading } = useResources('deployments', undefined, {
        refreshInterval: 30000
    })

    const recentDeployments = deployments
        ? (deployments as Deployment[])
            .sort((a, b) => {
                const timeA = a.metadata?.creationTimestamp || ''
                const timeB = b.metadata?.creationTimestamp || ''
                return new Date(timeB).getTime() - new Date(timeA).getTime()
            })
            .slice(0, 5)
        : []

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <IconRocket className="h-5 w-5" />
                    {t('dashboard.recentDeployments', 'Recent Deployments')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <IconLoader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : recentDeployments.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                        No deployments found
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentDeployments.map((dep) => {
                            const ready = dep.status?.readyReplicas || 0
                            const total = dep.spec?.replicas || 0
                            const isHealthy = ready === total && total > 0

                            return (
                                <button
                                    key={dep.metadata?.uid}
                                    onClick={() =>
                                        navigate(
                                            `/deployments/${dep.metadata?.namespace}/${dep.metadata?.name}`
                                        )
                                    }
                                    className="w-full flex items-center justify-between p-2 rounded-md hover:bg-muted/80 transition-colors text-left border border-transparent hover:border-border"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate">
                                            {dep.metadata?.name}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {dep.metadata?.namespace}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge
                                            variant={isHealthy ? 'default' : 'secondary'}
                                            className="text-xs"
                                        >
                                            {ready}/{total}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {dep.metadata?.creationTimestamp &&
                                                formatDistanceToNow(
                                                    new Date(dep.metadata.creationTimestamp),
                                                    { addSuffix: true }
                                                )}
                                        </span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
