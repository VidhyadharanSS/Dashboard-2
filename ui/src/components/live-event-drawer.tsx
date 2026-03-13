import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    IconAlertTriangle,
    IconBell,
    IconBellOff,
    IconChevronRight,
    IconFilter,
    IconInfoCircle,
    IconRefresh,
    IconSearch,
    IconX,
} from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { usePinnedNamespaces } from '@/hooks/use-pinned-namespaces'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const RESOURCE_TO_ROUTE: Record<string, string> = {
    Pod: 'pods',
    Deployment: 'deployments',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    Service: 'services',
    ConfigMap: 'configmaps',
    Node: 'nodes',
    Job: 'jobs',
    CronJob: 'cronjobs',
    ReplicaSet: 'replicasets',
}

function getResourceUrl(kind: string, ns: string | undefined, name: string) {
    const resourceType = RESOURCE_TO_ROUTE[kind]
    if (!resourceType) return null
    if (ns) return `/${resourceType}/${ns}/${name}`
    return `/${resourceType}/_all/${name}`
}

export function LiveEventDrawer() {
    const navigate = useNavigate()
    const { canAccess } = usePermissions()
    const { pinned } = usePinnedNamespaces()

    const [isOpen, setIsOpen] = useState(false)

    // Listen for keyboard shortcut toggle event from KeyboardShortcutsDialog
    useEffect(() => {
        const handler = () => setIsOpen(prev => !prev)
        window.addEventListener('toggle-events-drawer', handler)
        return () => window.removeEventListener('toggle-events-drawer', handler)
    }, [])

    const [nsFilter, setNsFilter] = useState<string>('_all')
    const [typeFilter, setTypeFilter] = useState<'all' | 'Warning' | 'Normal'>('all')
    const [searchText, setSearchText] = useState('')
    const [warningNotify, setWarningNotify] = useState(() => {
        return localStorage.getItem('event-warning-notify') === 'true'
    })
    const prevWarningIdsRef = useRef<Set<string>>(new Set())

    const { data, isLoading, refetch } = useResources('events', undefined, {
        refreshInterval: isOpen ? 15000 : (warningNotify ? 30000 : 0),
        disable: !canAccess('events', 'list'),
    })

    // Warning notification feature
    useEffect(() => {
        if (!warningNotify || !data) return
        const warnings = (data as any[]).filter(e => e.type === 'Warning')
        const currentIds = new Set(warnings.map(e => e.metadata?.uid || `${e.involvedObject?.name}-${e.reason}`))

        if (prevWarningIdsRef.current.size > 0) {
            const newWarnings = warnings.filter(e => {
                const id = e.metadata?.uid || `${e.involvedObject?.name}-${e.reason}`
                return !prevWarningIdsRef.current.has(id)
            })
            for (const w of newWarnings.slice(0, 2)) {
                toast.warning(
                    `⚠ ${w.reason}: ${w.involvedObject?.kind}/${w.involvedObject?.name}`,
                    {
                        description: w.message?.slice(0, 120),
                        duration: 5000,
                    }
                )
            }
            if (newWarnings.length > 2) {
                toast.warning(`...and ${newWarnings.length - 2} more warnings`, { duration: 3000 })
            }
        }
        prevWarningIdsRef.current = currentIds
    }, [data, warningNotify])

    const toggleWarningNotify = useCallback(() => {
        const next = !warningNotify
        setWarningNotify(next)
        localStorage.setItem('event-warning-notify', String(next))
        toast.success(next ? 'Warning notifications enabled' : 'Warning notifications disabled', { duration: 2000 })
    }, [warningNotify])

    const events = useMemo(() => {
        const lower = searchText.toLowerCase()
        return (data ?? [])
            .filter((ev) => {
                if (!ev.involvedObject?.kind) return false
                if (nsFilter !== '_all' && ev.involvedObject?.namespace !== nsFilter) return false
                if (typeFilter !== 'all' && ev.type !== typeFilter) return false
                if (lower && !(
                    ev.message?.toLowerCase().includes(lower) ||
                    ev.reason?.toLowerCase().includes(lower) ||
                    ev.involvedObject?.name?.toLowerCase().includes(lower) ||
                    ev.involvedObject?.kind?.toLowerCase().includes(lower)
                )) return false
                return true
            })
            .sort((a, b) => {
                const ta = new Date(a.lastTimestamp || a.metadata.creationTimestamp || '').getTime()
                const tb = new Date(b.lastTimestamp || b.metadata.creationTimestamp || '').getTime()
                return tb - ta
            })
            .slice(0, 80)
    }, [data, nsFilter, typeFilter, searchText])

    const warningCount = useMemo(() =>
        (data ?? []).filter(e => e.type === 'Warning').length,
        [data]
    )

    const normalCount = useMemo(() =>
        (data ?? []).filter(e => e.type === 'Normal').length,
        [data]
    )

    const handleEventClick = useCallback((ev: any) => {
        const url = getResourceUrl(
            ev.involvedObject?.kind,
            ev.involvedObject?.namespace,
            ev.involvedObject?.name
        )
        if (url) {
            navigate(url)
            setIsOpen(false)
        }
    }, [navigate])

    const namespacesToShow = useMemo(() => {
        const seen = new Set<string>()
            ; (data ?? []).forEach(e => {
                const ns = e.involvedObject?.namespace
                if (ns) seen.add(ns)
            })
        return [
            ...pinned.filter(p => seen.has(p)),
            ...[...seen].filter(s => !pinned.includes(s)).sort(),
        ]
    }, [data, pinned])

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="relative h-8 w-8"
                            onClick={() => setIsOpen(true)}
                        >
                            <IconBell className="h-4 w-4" />
                            {warningCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground leading-none">
                                    {warningCount > 9 ? '9+' : warningCount}
                                </span>
                            )}
                            <span className="sr-only">Cluster Events</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Live Cluster Events {warningCount > 0 ? `(${warningCount} warnings)` : ''}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <SheetContent side="right" className="w-[480px] sm:w-[540px] flex flex-col gap-0 p-0">
                <SheetHeader className="px-4 py-3 border-b shrink-0">
                    <div className="flex items-center justify-between">
                        <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                            <IconBell className="h-4 w-4" />
                            Live Cluster Events
                            {warningCount > 0 && (
                                <Badge variant="destructive" className="text-[10px] h-5 font-medium">
                                    {warningCount} warn
                                </Badge>
                            )}
                            {normalCount > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-5 font-normal">
                                    {normalCount} normal
                                </Badge>
                            )}
                        </SheetTitle>
                        <div className="flex items-center gap-0.5">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7"
                                            onClick={toggleWarningNotify}>
                                            {warningNotify
                                                ? <IconBell className="h-3.5 w-3.5 text-amber-500" />
                                                : <IconBellOff className="h-3.5 w-3.5" />
                                            }
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        {warningNotify ? 'Disable warning notifications' : 'Notify on new warnings'}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => refetch()}
                                disabled={isLoading}
                            >
                                <IconRefresh className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                            </Button>
                        </div>
                    </div>
                </SheetHeader>

                {/* Filters */}
                <div className="px-4 py-2 border-b shrink-0 space-y-2">
                    {/* Search */}
                    <div className="relative">
                        <IconSearch className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search events..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="h-8 pl-8 text-xs"
                        />
                        {searchText && (
                            <button onClick={() => setSearchText('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                <IconX className="h-3 w-3" />
                            </button>
                        )}
                    </div>

                    {/* Event type filter */}
                    <div className="flex items-center gap-1">
                        <IconFilter className="h-3 w-3 text-muted-foreground shrink-0" />
                        {(['all', 'Warning', 'Normal'] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTypeFilter(t)}
                                className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border ${typeFilter === t
                                    ? t === 'Warning'
                                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25 shadow-sm'
                                        : t === 'Normal'
                                            ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25 shadow-sm'
                                            : 'bg-primary text-primary-foreground border-primary shadow-sm'
                                    : 'bg-muted/60 text-muted-foreground hover:text-foreground border-transparent hover:border-border'
                                    }`}
                            >
                                {t === 'all' ? 'All Types' : t}
                            </button>
                        ))}
                    </div>

                    {/* Namespace filter — pinned first */}
                    {namespacesToShow.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                            <button
                                onClick={() => setNsFilter('_all')}
                                className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border ${nsFilter === '_all'
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-muted/60 text-muted-foreground hover:text-foreground border-transparent'
                                    }`}
                            >
                                All NS
                            </button>
                            {namespacesToShow.slice(0, 10).map(ns => (
                                <button
                                    key={ns}
                                    onClick={() => setNsFilter(ns)}
                                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border flex items-center gap-0.5 ${nsFilter === ns
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-muted/60 text-muted-foreground hover:text-foreground border-transparent'
                                        }`}
                                >
                                    {pinned.includes(ns) && <span className="text-[8px]">📌</span>}
                                    {ns}
                                </button>
                            ))}
                            {nsFilter !== '_all' && (
                                <button
                                    onClick={() => setNsFilter('_all')}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <IconX className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Event list */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading && events.length === 0 ? (
                        <div className="space-y-1 p-3">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="flex items-start gap-3 p-2.5 animate-pulse">
                                    <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="flex gap-2">
                                            <div className="h-4 w-16 bg-muted rounded" />
                                            <div className="h-4 w-12 bg-muted rounded ml-auto" />
                                        </div>
                                        <div className="h-3.5 w-full bg-muted rounded" />
                                        <div className="h-3 w-32 bg-muted rounded" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : events.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-52 text-muted-foreground gap-3">
                            <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                                <IconBell className="h-6 w-6 opacity-40" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium">No events</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {searchText || nsFilter !== '_all' || typeFilter !== 'all'
                                        ? 'Try adjusting your filters'
                                        : 'Cluster events will appear here'}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {events.map((ev, idx) => {
                                const isWarning = ev.type === 'Warning'
                                const canNavigate = !!getResourceUrl(
                                    ev.involvedObject?.kind ?? '',
                                    ev.involvedObject?.namespace,
                                    ev.involvedObject?.name ?? ''
                                )
                                const ago = ev.lastTimestamp || ev.metadata.creationTimestamp
                                    ? formatDistanceToNow(
                                        new Date(ev.lastTimestamp || ev.metadata.creationTimestamp || ''),
                                        { addSuffix: true }
                                    ).replace('about ', '').replace('less than a minute ago', 'just now')
                                    : ''

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => canNavigate && handleEventClick(ev)}
                                        className={`w-full text-left px-4 py-2.5 transition-colors group ${canNavigate ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default'}`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={`mt-0.5 shrink-0 h-6 w-6 rounded-full flex items-center justify-center ${isWarning
                                                ? 'bg-amber-500/10'
                                                : 'bg-blue-500/10'
                                                }`}>
                                                {isWarning
                                                    ? <IconAlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                                    : <IconInfoCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                                                }
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={`text-[11px] font-semibold ${isWarning ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}`}>
                                                        {ev.reason}
                                                    </span>
                                                    {ev.count && ev.count > 1 && (
                                                        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-mono text-muted-foreground font-medium">
                                                            ×{ev.count}
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0 tabular-nums">{ago}</span>
                                                </div>
                                                <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                                                    {ev.message}
                                                </p>
                                                <div className="flex items-center gap-1 mt-1">
                                                    <span className="text-[10px] text-muted-foreground font-mono">
                                                        {ev.involvedObject?.kind}/{ev.involvedObject?.namespace && `${ev.involvedObject.namespace}/`}{ev.involvedObject?.name}
                                                    </span>
                                                    {canNavigate && (
                                                        <IconChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div className="px-4 py-2 border-t bg-muted/20 text-[11px] text-muted-foreground shrink-0">
                    <div className="flex items-center justify-between">
                        <span>Showing {events.length} events</span>
                        <div className="flex items-center gap-2">
                            {warningNotify && !isOpen && (
                                <span className="flex items-center gap-1">
                                    <IconBell className="h-3 w-3 text-amber-500" />
                                    warn notify
                                </span>
                            )}
                            <span className="flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                live
                            </span>
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}