import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { IconGridDots, IconLoader2, IconPin, IconPinFilled, IconExternalLink } from '@tabler/icons-react'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { usePinnedNamespaces } from '@/hooks/use-pinned-namespaces'
import type { Pod } from 'kubernetes-types/core/v1'
import { useNavigate } from 'react-router-dom'
import { getPodStatus } from '@/lib/k8s'
import { useMemo } from 'react'
import { useNamespaceContext } from '@/hooks/use-namespace-context'
import { useCluster } from '@/contexts/cluster-context'

interface NsHealth {
    ns: string
    total: number
    running: number
    failing: number
}

export function NamespaceHealthWidget() {
    const navigate = useNavigate()
    const { canAccess } = usePermissions()
    const { currentCluster } = useCluster()
    const { pinned, toggle, isPinned } = usePinnedNamespaces(currentCluster)
    const { setActiveNamespace } = useNamespaceContext()
    const canList = canAccess('pods', 'list')

    const { data: pods, isLoading } = useResources('pods', undefined, {
        refreshInterval: 30000,
        disable: !canList,
    })

    const namespaceHealth = useMemo<NsHealth[]>(() => {
        if (!pods) return []
        const map: Record<string, NsHealth> = {}

            ; (pods as Pod[]).forEach(pod => {
                const ns = pod.metadata?.namespace || 'default'
                if (!map[ns]) map[ns] = { ns, total: 0, running: 0, failing: 0 }
                map[ns].total++
                const { reason } = getPodStatus(pod)
                const isOk = ['Running', 'Completed', 'Succeeded'].includes(reason)
                const isFailing = !isOk && !['ContainerCreating', 'PodInitializing', 'Pending'].includes(reason)
                if (isOk) map[ns].running++
                if (isFailing) map[ns].failing++
            })

        const all = Object.values(map)

        // Pinned namespaces first, then by failing count, then by total
        const pinnedItems = all
            .filter(h => isPinned(h.ns))
            .sort((a, b) => pinned.indexOf(a.ns) - pinned.indexOf(b.ns))

        const rest = all
            .filter(h => !isPinned(h.ns))
            .sort((a, b) => b.failing - a.failing || b.total - a.total)
            .slice(0, 8 - pinnedItems.length)

        return [...pinnedItems, ...rest]
    }, [pods, pinned, isPinned])

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    <IconGridDots className="h-5 w-5" />
                    Namespace Health
                </CardTitle>
            </CardHeader>
            <CardContent>
                {!canList ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        Requires permission to list pods
                    </p>
                ) : isLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <IconLoader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : namespaceHealth.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No namespaces found</p>
                ) : (
                    <TooltipProvider>
                        <div className="space-y-2">
                            {namespaceHealth.map(({ ns, total, running, failing }) => {
                                const healthPct = total > 0 ? Math.round((running / total) * 100) : 0
                                const barColor = failing > 0
                                    ? 'bg-destructive'
                                    : healthPct === 100
                                        ? 'bg-emerald-500'
                                        : 'bg-yellow-500'
                                const pinned_ = isPinned(ns)

                                return (
                                    <div key={ns} className="group flex items-center gap-2">
                                        {/* Pin button */}
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => toggle(ns)}
                                                >
                                                    {pinned_
                                                        ? <IconPinFilled className="h-3 w-3 text-primary" />
                                                        : <IconPin className="h-3 w-3 text-muted-foreground" />
                                                    }
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="left">
                                                {pinned_ ? 'Unpin namespace' : 'Pin to top'}
                                            </TooltipContent>
                                        </Tooltip>

                                        {/* Health row (clickable) */}
                                        <button
                                            className="flex-1 text-left min-w-0"
                                            onClick={() => {
                                                setActiveNamespace(ns)
                                                navigate(`/pods?namespace=${ns}`)
                                            }}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium group-hover:text-primary transition-colors truncate flex-1 flex items-center gap-1">
                                                    {pinned_ && <IconPinFilled className="h-2.5 w-2.5 text-primary shrink-0" />}
                                                    {ns}
                                                </span>
                                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                                    {failing > 0 && (
                                                        <span className="text-[10px] text-destructive font-medium">
                                                            {failing} failing
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {running}/{total}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                                    style={{ width: `${healthPct}%` }}
                                                />
                                            </div>
                                        </button>

                                        {/* Navigate to namespace workloads */}
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => {
                                                        setActiveNamespace(ns)
                                                        navigate(`/deployments?namespace=${ns}`)
                                                    }}
                                                >
                                                    <IconExternalLink className="h-3 w-3" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">
                                                View deployments in {ns}
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                )
                            })}
                        </div>
                    </TooltipProvider>
                )}
            </CardContent>
        </Card>
    )
}
