/**
 * NamespaceQuickSwitch — Pinned namespaces shown as quick-access pills in the header.
 */
import { useCallback, useMemo } from 'react'
import { IconPin, IconX, IconFilter } from '@tabler/icons-react'
import { Namespace } from 'kubernetes-types/core/v1'

import { useResources } from '@/lib/api'
import { useNamespaceContext } from '@/hooks/use-namespace-context'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function syncNamespaceToResourceTable(ns: string) {
    try {
        const clusterKey = (localStorage.getItem('current-cluster') ?? '') + 'selectedNamespace'
        localStorage.setItem(clusterKey, ns)
        window.dispatchEvent(new StorageEvent('storage', { key: clusterKey, newValue: ns }))
    } catch { /* ignore */ }
}

export function NamespaceQuickSwitch() {
    const { activeNamespace, setActiveNamespace, pinned, togglePin } = useNamespaceContext()
    const { data } = useResources('namespaces', undefined, { refreshInterval: 0 })

    const pinnedOptions = useMemo(() => {
        const available = new Set(
            (data as Namespace[] | undefined)
                ?.map(ns => ns.metadata?.name ?? '')
                .filter(Boolean) ?? []
        )
        return pinned.filter(p => available.has(p))
    }, [pinned, data])

    const handleSelect = useCallback((ns: string) => {
        setActiveNamespace(ns)
        syncNamespaceToResourceTable(ns)
    }, [setActiveNamespace])

    if (pinnedOptions.length === 0) return null

    return (
        <TooltipProvider delayDuration={300}>
            <div className="hidden md:flex items-center gap-1.5 px-2">
                {/* Reset Pill */}
                {activeNamespace !== '_all' && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => handleSelect('_all')}
                                className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-destructive hover:text-destructive hover:bg-destructive/10 transition-all"
                            >
                                <IconX className="h-3 w-3" />
                                Reset
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Clear namespace filter</TooltipContent>
                    </Tooltip>
                )}

                {pinnedOptions.map(ns => {
                    const isActive = activeNamespace === ns
                    return (
                        <Tooltip key={ns}>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={() => handleSelect(isActive ? '_all' : ns)}
                                    className={cn(
                                        "group flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-all border",
                                        isActive
                                            ? 'bg-primary/10 text-primary border-primary/30 shadow-sm ring-1 ring-primary/20'
                                            : 'bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                                    )}
                                >
                                    <IconFilter className={cn("h-3 w-3", isActive ? "opacity-100" : "opacity-50")} />
                                    <span className="max-w-[70px] truncate">{ns}</span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="p-3">
                                <div className="flex flex-col gap-1.5">
                                    <p className="font-semibold text-xs border-b pb-1 mb-0.5">{ns}</p>
                                    <p className="text-[10px] text-muted-foreground max-w-[150px]">
                                        {isActive ? 'Currently active. Click to view all.' : 'Click to filter resources by this namespace.'}
                                    </p>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); togglePin(ns); if (isActive) handleSelect('_all') }}
                                        className="text-[10px] flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors mt-1 pt-1 border-t border-muted/50"
                                    >
                                        <IconPin className="h-3 w-3" />
                                        Remove pin
                                    </button>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    )
                })}
            </div>
        </TooltipProvider>
    )
}