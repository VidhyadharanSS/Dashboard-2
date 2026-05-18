/**
 * NamespaceQuickSwitch — Pinned namespaces shown as quick-access pills in the header.
 * Enhanced with inline unpin buttons, active state glow, and keyboard accessibility.
 */
import { useCallback, useMemo } from 'react'
import { IconPinFilled, IconX } from '@tabler/icons-react'
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
        <TooltipProvider delayDuration={200}>
            <div className="hidden md:flex items-center gap-1 px-2" role="toolbar" aria-label="Pinned namespace filters">
                {/* Pinned label */}
                <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider font-semibold mr-0.5 select-none">ns</span>

                {/* Reset Pill — only when a namespace is active */}
                {activeNamespace !== '_all' && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => handleSelect('_all')}
                                className="flex items-center gap-0.5 h-6 px-2 rounded-md text-[10px] font-medium border border-dashed border-muted-foreground/25 text-muted-foreground hover:border-destructive/50 hover:text-destructive hover:bg-destructive/5 transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                                aria-label="Clear namespace filter"
                            >
                                <IconX className="h-3 w-3" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">Clear filter — show all namespaces</TooltipContent>
                    </Tooltip>
                )}

                {/* Pinned namespace pills */}
                {pinnedOptions.map(ns => {
                    const isActive = activeNamespace === ns
                    return (
                        <div key={ns} className="flex items-center">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => handleSelect(isActive ? '_all' : ns)}
                                        className={cn(
                                            "group/pill flex items-center gap-1 h-6 pl-2 rounded-md text-[11px] font-medium transition-all border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                            isActive
                                                ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20 pr-1'
                                                : 'bg-muted/40 border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-muted/70 pr-2'
                                        )}
                                        aria-pressed={isActive}
                                        aria-label={`Filter by namespace ${ns}`}
                                    >
                                        <IconPinFilled className={cn(
                                            "h-2.5 w-2.5 shrink-0",
                                            isActive ? "text-primary-foreground/70" : "text-amber-500/60"
                                        )} />
                                        <span className="max-w-[80px] truncate">{ns}</span>
                                        {/* Inline unpin button — visible on hover or when active */}
                                        {isActive && (
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    togglePin(ns)
                                                    handleSelect('_all')
                                                }}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); togglePin(ns); handleSelect('_all') } }}
                                                className="ml-0.5 h-4 w-4 flex items-center justify-center rounded-sm hover:bg-primary-foreground/20 transition-colors"
                                                aria-label={`Unpin ${ns}`}
                                            >
                                                <IconX className="h-2.5 w-2.5" />
                                            </span>
                                        )}
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs max-w-[180px]">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="font-semibold">{ns}</span>
                                        <span className="text-muted-foreground">
                                            {isActive ? 'Active — click to clear' : 'Click to filter'}
                                        </span>
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    )
                })}
            </div>
        </TooltipProvider>
    )
}
