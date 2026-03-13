/**
 * GlobalAuditDrawer — Cluster-wide activity feed accessible from the site header.
 *
 * Uses the user-level /api/v1/audit-logs endpoint (RBAC-filtered) so all users
 * see audit entries they have permission for — not just admins.
 *
 * Features:
 *  1. Operation type filter (create/update/patch/delete/apply)
 *  2. Text search across resource names/namespaces/types
 *  3. Date range quick-select (Today / 7d / 30d)
 *  4. Statistics summary bar with operation counts
 *  5. Click to navigate to the resource
 *  6. CSV export for admins
 *  7. Audit entry detail dialog with YAML diff
 *  8. Activity timeline chart
 *  9. Bookmark/pin important audit entries
 * 10. Real-time change notifications with toast
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    IconAlertCircle,
    IconArrowRight,
    IconBell,
    IconBellOff,
    IconBookmark,
    IconBookmarkFilled,
    IconCalendar,
    IconChartBar,
    IconCheck,
    IconChevronRight,
    IconDownload,
    IconEye,
    IconFilter,
    IconHistory,
    IconRefresh,
    IconSearch,
    IconUser,
    IconX,
} from '@tabler/icons-react'
import { formatDistanceToNow, format, subDays } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { ResourceHistory } from '@/types/api'
import { useAuth } from '@/contexts/auth-context'
import {
    useUserAuditLogs,
    useAuditStats,
    useAuditTimeline,
    useAuditLogDetail,
    exportAuditLogs,
    getBookmarkedAuditIds,
    toggleAuditBookmark,
    isAuditBookmarked,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const RESOURCE_TO_ROUTE: Record<string, string> = {
    pods: 'pods',
    pod: 'pods',
    deployments: 'deployments',
    deployment: 'deployments',
    statefulsets: 'statefulsets',
    statefulset: 'statefulsets',
    daemonsets: 'daemonsets',
    daemonset: 'daemonsets',
    services: 'services',
    service: 'services',
    configmaps: 'configmaps',
    configmap: 'configmaps',
    secrets: 'secrets',
    secret: 'secrets',
    ingresses: 'ingresses',
    ingress: 'ingresses',
    persistentvolumeclaims: 'persistentvolumeclaims',
    pvc: 'persistentvolumeclaims',
    persistentvolumes: 'persistentvolumes',
    pv: 'persistentvolumes',
    cronjobs: 'cronjobs',
    cronjob: 'cronjobs',
    jobs: 'jobs',
    job: 'jobs',
    horizontalpodautoscalers: 'horizontalpodautoscalers',
    hpa: 'horizontalpodautoscalers',
    namespaces: 'namespaces',
    nodes: 'nodes',
}

function getResourceUrl(type: string, ns: string, name: string) {
    const route = RESOURCE_TO_ROUTE[type.toLowerCase()]
    if (!route) return null
    if (ns && ns !== '' && ns !== '_all') return `/${route}/${ns}/${name}`
    return `/${route}/_all/${name}`
}

const OP_COLORS: Record<string, string> = {
    create: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
    update: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25',
    patch: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/25',
    delete: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
    apply: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/25',
}

const OP_BAR_COLORS: Record<string, string> = {
    create: '#10b981',
    update: '#3b82f6',
    delete: '#ef4444',
    patch: '#0ea5e9',
    apply: '#8b5cf6',
}

const OP_ICONS: Record<string, string> = {
    create: '＋',
    update: '✎',
    patch: '⚡',
    delete: '✕',
    apply: '▶',
}

type DateRange = 'all' | 'today' | '7d' | '30d'
type DrawerView = 'list' | 'timeline' | 'bookmarks'

function getDateRange(range_: DateRange): { startDate?: string; endDate?: string } {
    if (range_ === 'all') return {}
    const now = new Date()
    const endDate = format(now, 'yyyy-MM-dd')
    switch (range_) {
        case 'today':
            return { startDate: endDate, endDate }
        case '7d':
            return { startDate: format(subDays(now, 7), 'yyyy-MM-dd'), endDate }
        case '30d':
            return { startDate: format(subDays(now, 30), 'yyyy-MM-dd'), endDate }
    }
}

/* ──────────────── Mini Activity Timeline Chart ──────────────── */
function ActivityTimeline({ isOpen }: { isOpen: boolean }) {
    const { data: timeline } = useAuditTimeline(14, {
        enabled: isOpen,
        refetchInterval: isOpen ? 120000 : 0,
    })

    if (!timeline || timeline.length === 0) return null

    const maxTotal = Math.max(...timeline.map(b => b.total), 1)

    return (
        <div className="px-4 py-2.5 border-b shrink-0 bg-muted/20">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">Activity (14 days)</span>
                <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                    {(['create', 'update', 'delete'] as const).map(op => (
                        <span key={op} className="flex items-center gap-0.5">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: OP_BAR_COLORS[op] }} />
                            {op}
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex items-end gap-px h-10">
                {timeline.map((bucket, i) => {
                    const heightPercent = (bucket.total / maxTotal) * 100
                    const dayLabel = format(new Date(bucket.timestamp), 'MM/dd')
                    // Stacked bar segments
                    const segments = [
                        { key: 'delete', value: bucket.delete, color: OP_BAR_COLORS.delete },
                        { key: 'update', value: bucket.update + bucket.patch, color: OP_BAR_COLORS.update },
                        { key: 'create', value: bucket.create, color: OP_BAR_COLORS.create },
                        { key: 'apply', value: bucket.apply, color: OP_BAR_COLORS.apply },
                    ].filter(s => s.value > 0)

                    return (
                        <TooltipProvider key={i}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div
                                        className="flex-1 flex flex-col justify-end rounded-sm overflow-hidden cursor-default hover:opacity-80 transition-opacity"
                                        style={{ height: '100%' }}
                                    >
                                        <div
                                            className="flex flex-col-reverse rounded-sm overflow-hidden transition-all duration-300"
                                            style={{ height: `${Math.max(heightPercent, bucket.total > 0 ? 8 : 0)}%` }}
                                        >
                                            {segments.map(seg => {
                                                const segPercent = bucket.total > 0 ? (seg.value / bucket.total) * 100 : 0
                                                return (
                                                    <div
                                                        key={seg.key}
                                                        className="min-h-[1px]"
                                                        style={{
                                                            height: `${segPercent}%`,
                                                            backgroundColor: seg.color,
                                                            opacity: 0.85,
                                                        }}
                                                    />
                                                )
                                            })}
                                        </div>
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-[10px]">
                                    <div className="font-medium">{dayLabel}</div>
                                    <div className="text-muted-foreground">
                                        {bucket.total} changes
                                        {bucket.create > 0 && ` · ${bucket.create} created`}
                                        {bucket.update > 0 && ` · ${bucket.update} updated`}
                                        {bucket.delete > 0 && ` · ${bucket.delete} deleted`}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )
                })}
            </div>
            <div className="flex justify-between mt-0.5 text-[8px] text-muted-foreground/50">
                <span>{timeline.length > 0 ? format(new Date(timeline[0].timestamp), 'MMM dd') : ''}</span>
                <span>{timeline.length > 0 ? format(new Date(timeline[timeline.length - 1].timestamp), 'MMM dd') : ''}</span>
            </div>
        </div>
    )
}

/* ──────────────── Audit Detail Dialog ──────────────── */
function AuditDetailDialog({
    entryId,
    open,
    onOpenChange,
}: {
    entryId: number | null
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const { data: detail, isLoading } = useAuditLogDetail(entryId, { enabled: open && entryId !== null })

    if (!open) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                        <IconEye className="h-4 w-4" />
                        Audit Entry Detail
                        {detail && (
                            <Badge variant="secondary" className="text-[10px] font-mono">
                                #{detail.id}
                            </Badge>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    </div>
                ) : detail ? (
                    <div className="flex-1 overflow-y-auto space-y-4">
                        {/* Metadata grid */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="space-y-0.5">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Operation</div>
                                <Badge className={`${OP_COLORS[detail.operationType?.toLowerCase()] || ''} border text-xs`}>
                                    {detail.operationType?.toUpperCase()}
                                </Badge>
                            </div>
                            <div className="space-y-0.5">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</div>
                                <Badge variant={detail.success ? 'default' : 'destructive'} className="text-xs">
                                    {detail.success ? 'Success' : 'Failed'}
                                </Badge>
                            </div>
                            <div className="space-y-0.5">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Resource</div>
                                <div className="font-mono text-xs">
                                    {detail.resourceType}/{detail.namespace ? `${detail.namespace}/` : ''}{detail.resourceName}
                                </div>
                            </div>
                            <div className="space-y-0.5">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Operator</div>
                                <div className="text-xs flex items-center gap-1">
                                    <IconUser className="h-3 w-3" />
                                    {detail.operator?.username || 'unknown'}
                                </div>
                            </div>
                            <div className="space-y-0.5">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Cluster</div>
                                <div className="text-xs">{detail.clusterName}</div>
                            </div>
                            <div className="space-y-0.5">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Time</div>
                                <div className="text-xs tabular-nums">
                                    {detail.createdAt ? format(new Date(detail.createdAt), 'yyyy-MM-dd HH:mm:ss') : '-'}
                                </div>
                            </div>
                        </div>

                        {/* Error message if failed */}
                        {!detail.success && detail.errorMessage && (
                            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                                <div className="text-[10px] font-medium text-destructive mb-1 uppercase tracking-wider">Error</div>
                                <pre className="text-xs text-destructive whitespace-pre-wrap font-mono leading-relaxed">
                                    {detail.errorMessage}
                                </pre>
                            </div>
                        )}

                        {/* YAML Diff */}
                        {(detail.resourceYaml || detail.previousYaml) && (
                            <div className="space-y-2">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">YAML Changes</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {detail.previousYaml && (
                                        <div className="space-y-1">
                                            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                                Before
                                            </div>
                                            <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-2 overflow-auto max-h-60 leading-relaxed border">
                                                {detail.previousYaml}
                                            </pre>
                                        </div>
                                    )}
                                    {detail.resourceYaml && (
                                        <div className="space-y-1">
                                            <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                After
                                            </div>
                                            <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-2 overflow-auto max-h-60 leading-relaxed border">
                                                {detail.resourceYaml}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                                {!detail.previousYaml && detail.resourceYaml && (
                                    <pre className="text-[10px] font-mono bg-muted/40 rounded-md p-2 overflow-auto max-h-80 leading-relaxed border">
                                        {detail.resourceYaml}
                                    </pre>
                                )}
                            </div>
                        )}

                        {!detail.resourceYaml && !detail.previousYaml && (
                            <div className="text-xs text-muted-foreground text-center py-4 italic">
                                No YAML data available for this entry
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-8 text-sm">Entry not found</div>
                )}
            </DialogContent>
        </Dialog>
    )
}

/* ──────────────── Main Drawer Component ──────────────── */
export function GlobalAuditDrawer() {
    const navigate = useNavigate()
    const { user } = useAuth()
    const isAdmin = user?.isAdmin() ?? false
    const [isOpen, setIsOpen] = useState(false)
    const [opFilter, setOpFilter] = useState<string>('all')
    const [searchText, setSearchText] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [dateRange, setDateRange] = useState<DateRange>('all')
    const [showFilters, setShowFilters] = useState(false)
    const [drawerView, setDrawerView] = useState<DrawerView>('list')
    const [showTimeline, setShowTimeline] = useState(false)
    const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
        return localStorage.getItem('audit-notifications') === 'true'
    })
    const [detailEntryId, setDetailEntryId] = useState<number | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const [bookmarkIds, setBookmarkIds] = useState<number[]>(() => getBookmarkedAuditIds())
    const prevEntriesRef = useRef<ResourceHistory[]>([])
    const searchRef = useRef<HTMLInputElement>(null)

    // Debounce search input
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchText), 350)
        return () => clearTimeout(t)
    }, [searchText])

    const { startDate, endDate } = getDateRange(dateRange)

    const { data, isLoading, error, refetch } = useUserAuditLogs(
        1, 60,
        debouncedSearch || undefined,
        opFilter === 'all' ? undefined : opFilter,
        undefined,
        undefined,
        startDate,
        endDate,
        {
            refetchInterval: isOpen ? 15000 : (notificationsEnabled ? 30000 : 0),
            enabled: isOpen || notificationsEnabled,
        }
    )

    const { data: stats } = useAuditStats({
        enabled: isOpen,
        refetchInterval: isOpen ? 60000 : 0,
    })

    const entries = useMemo(() => data?.data ?? [], [data])

    // Feature: Real-time change notifications via toast
    useEffect(() => {
        if (!notificationsEnabled || entries.length === 0) return
        const prev = prevEntriesRef.current
        if (prev.length === 0) {
            prevEntriesRef.current = entries
            return
        }
        const prevIds = new Set(prev.map(e => e.id))
        const newEntries = entries.filter(e => !prevIds.has(e.id))
        if (newEntries.length > 0 && newEntries.length <= 5) {
            for (const entry of newEntries.slice(0, 3)) {
                const opKey = entry.operationType?.toLowerCase() ?? ''
                const icon = OP_ICONS[opKey] || '•'
                toast.info(
                    `${icon} ${entry.operationType?.toUpperCase()}: ${entry.resourceType}/${entry.resourceName}`,
                    {
                        description: `by ${entry.operator?.username || 'unknown'}${entry.namespace ? ` in ${entry.namespace}` : ''}`,
                        duration: 4000,
                    }
                )
            }
            if (newEntries.length > 3) {
                toast.info(`...and ${newEntries.length - 3} more changes`, { duration: 3000 })
            }
        }
        prevEntriesRef.current = entries
    }, [entries, notificationsEnabled])

    // Refresh bookmarks from storage when drawer opens
    useEffect(() => {
        if (isOpen) setBookmarkIds(getBookmarkedAuditIds())
    }, [isOpen])

    const handleNavigate = useCallback((url: string) => {
        navigate(url)
        setIsOpen(false)
    }, [navigate])

    const handleExport = useCallback(() => {
        exportAuditLogs({
            operation: opFilter === 'all' ? undefined : opFilter,
            search: debouncedSearch || undefined,
            startDate,
            endDate,
        })
    }, [opFilter, debouncedSearch, startDate, endDate])

    const resetFilters = useCallback(() => {
        setOpFilter('all')
        setSearchText('')
        setDebouncedSearch('')
        setDateRange('all')
    }, [])

    const handleToggleBookmark = useCallback((id: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const added = toggleAuditBookmark(id)
        setBookmarkIds(getBookmarkedAuditIds())
        toast.success(added ? 'Bookmarked' : 'Bookmark removed', { duration: 1500 })
    }, [])

    const handleOpenDetail = useCallback((id: number, e: React.MouseEvent) => {
        e.stopPropagation()
        setDetailEntryId(id)
        setDetailOpen(true)
    }, [])

    const toggleNotifications = useCallback(() => {
        const next = !notificationsEnabled
        setNotificationsEnabled(next)
        localStorage.setItem('audit-notifications', String(next))
        toast.success(next ? 'Notifications enabled' : 'Notifications disabled', { duration: 2000 })
    }, [notificationsEnabled])

    const hasActiveFilters = opFilter !== 'all' || debouncedSearch !== '' || dateRange !== 'all'

    // Filter for bookmarks view
    const displayEntries = useMemo(() => {
        if (drawerView === 'bookmarks') {
            return entries.filter(e => bookmarkIds.includes(e.id))
        }
        return entries
    }, [entries, drawerView, bookmarkIds])

    // Stats for the mini bar
    const stats24h = useMemo(() => {
        if (!stats?.last24h) return { create: 0, update: 0, delete: 0, patch: 0, apply: 0, total: stats?.total24h ?? 0 }
        const map: Record<string, number> = {}
        for (const s of stats.last24h) {
            map[s.operationType.toLowerCase()] = s.count
        }
        return {
            create: map['create'] ?? 0,
            update: map['update'] ?? 0,
            delete: map['delete'] ?? 0,
            patch: map['patch'] ?? 0,
            apply: map['apply'] ?? 0,
            total: stats?.total24h ?? 0,
        }
    }, [stats])

    return (
        <>
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="relative h-8 w-8">
                                    <IconHistory className="h-4 w-4" />
                                    {notificationsEnabled && (
                                        <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                                    )}
                                    <span className="sr-only">Audit Log</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Recent Changes (Audit Log)</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </SheetTrigger>

                <SheetContent side="right" className="w-[480px] sm:w-[540px] flex flex-col gap-0 p-0">
                    {/* Header */}
                    <SheetHeader className="px-4 py-3 border-b shrink-0">
                        <div className="flex items-center justify-between">
                            <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                                <IconHistory className="h-4 w-4" />
                                Audit Log
                                {data?.total != null && (
                                    <Badge variant="secondary" className="text-[10px] h-5 font-normal">
                                        {data.total.toLocaleString()}
                                    </Badge>
                                )}
                            </SheetTitle>
                            <div className="flex items-center gap-0.5">
                                {/* Notification toggle */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7"
                                                onClick={toggleNotifications}>
                                                {notificationsEnabled
                                                    ? <IconBell className="h-3.5 w-3.5 text-primary" />
                                                    : <IconBellOff className="h-3.5 w-3.5" />
                                                }
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            {notificationsEnabled ? 'Disable notifications' : 'Enable change notifications'}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                {/* Timeline toggle */}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7"
                                                onClick={() => setShowTimeline(!showTimeline)}>
                                                <IconChartBar className={`h-3.5 w-3.5 ${showTimeline ? 'text-primary' : ''}`} />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">Activity Timeline</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                                {isAdmin && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                                    onClick={handleExport}>
                                                    <IconDownload className="h-3.5 w-3.5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">Export CSV</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                    onClick={() => setShowFilters(!showFilters)}>
                                    <IconFilter className={`h-3.5 w-3.5 ${hasActiveFilters ? 'text-primary' : ''}`} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                    onClick={() => refetch()} disabled={isLoading}>
                                    <IconRefresh className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>
                        </div>
                    </SheetHeader>

                    {/* Stats bar */}
                    {stats && stats.total24h > 0 && (
                        <div className="px-4 py-2 border-b shrink-0 bg-muted/30">
                            <div className="flex items-center gap-3 text-[10px]">
                                <span className="text-muted-foreground font-medium">Last 24h:</span>
                                {stats24h.create > 0 && (
                                    <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                                        <span className="text-[9px]">＋</span>{stats24h.create} created
                                    </span>
                                )}
                                {(stats24h.update + stats24h.patch) > 0 && (
                                    <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400 font-medium">
                                        <span className="text-[9px]">✎</span>{stats24h.update + stats24h.patch} modified
                                    </span>
                                )}
                                {stats24h.delete > 0 && (
                                    <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
                                        <span className="text-[9px]">✕</span>{stats24h.delete} deleted
                                    </span>
                                )}
                                {stats24h.apply > 0 && (
                                    <span className="flex items-center gap-0.5 text-violet-600 dark:text-violet-400 font-medium">
                                        <span className="text-[9px]">▶</span>{stats24h.apply} applied
                                    </span>
                                )}
                                <span className="text-muted-foreground ml-auto">
                                    {stats24h.total} total
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Activity Timeline (collapsible) */}
                    {showTimeline && <ActivityTimeline isOpen={isOpen} />}

                    {/* View tabs: List / Bookmarks */}
                    <div className="px-4 py-1.5 border-b shrink-0 flex items-center gap-1">
                        {(['list', 'bookmarks'] as const).map(view => (
                            <button
                                key={view}
                                onClick={() => setDrawerView(view)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${drawerView === view
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                    }`}
                            >
                                {view === 'list' ? 'All' : (
                                    <span className="flex items-center gap-1">
                                        <IconBookmarkFilled className="h-3 w-3" />
                                        Pinned
                                        {bookmarkIds.length > 0 && (
                                            <span className="text-[9px] bg-primary/20 px-1 rounded-full">
                                                {bookmarkIds.length}
                                            </span>
                                        )}
                                    </span>
                                )}
                            </button>
                        ))}

                        <div className="ml-auto flex items-center gap-1">
                            {/* Compact operation filter pills */}
                            {(['all', 'create', 'update', 'delete'] as const).map(op => (
                                <button
                                    key={op}
                                    onClick={() => setOpFilter(op)}
                                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all border ${opFilter === op
                                        ? op === 'all'
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : `${OP_COLORS[op] || ''} border`
                                        : 'text-muted-foreground/60 border-transparent hover:text-foreground'
                                        }`}
                                >
                                    {op === 'all' ? 'All' : op[0].toUpperCase()}
                                </button>
                            ))}
                            {hasActiveFilters && (
                                <button onClick={resetFilters}
                                    className="text-muted-foreground hover:text-foreground ml-0.5">
                                    <IconX className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Filter area (expanded) */}
                    <div className={`border-b shrink-0 transition-all overflow-hidden ${showFilters ? 'max-h-44' : 'max-h-0 border-b-0'}`}>
                        <div className="px-4 py-2 space-y-2">
                            {/* Search */}
                            <div className="relative">
                                <IconSearch className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    ref={searchRef}
                                    placeholder="Search resources, namespaces, types..."
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

                            {/* Operation type pills (full) */}
                            <div className="flex items-center gap-1 flex-wrap">
                                {(['all', 'create', 'update', 'patch', 'delete', 'apply'] as const).map(op => (
                                    <button
                                        key={op}
                                        onClick={() => setOpFilter(op)}
                                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border ${opFilter === op
                                            ? op === 'all'
                                                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                                : `${OP_COLORS[op] || ''} border shadow-sm`
                                            : 'bg-muted/60 text-muted-foreground hover:text-foreground border-transparent hover:border-border'
                                            }`}
                                    >
                                        {op === 'all' ? 'All' : `${OP_ICONS[op] || ''} ${op.charAt(0).toUpperCase() + op.slice(1)}`}
                                    </button>
                                ))}
                            </div>

                            {/* Date range pills */}
                            <div className="flex items-center gap-1 flex-wrap">
                                <IconCalendar className="h-3 w-3 text-muted-foreground shrink-0" />
                                {(['all', 'today', '7d', '30d'] as const).map(r => (
                                    <button
                                        key={r}
                                        onClick={() => setDateRange(r)}
                                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border ${dateRange === r
                                            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                            : 'bg-muted/60 text-muted-foreground hover:text-foreground border-transparent hover:border-border'
                                            }`}
                                    >
                                        {r === 'all' ? 'All Time' : r === 'today' ? 'Today' : `Last ${r}`}
                                    </button>
                                ))}
                                {hasActiveFilters && (
                                    <button
                                        onClick={resetFilters}
                                        className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Error state */}
                    {error && (
                        <div className="px-4 py-3 bg-destructive/10 border-b shrink-0">
                            <div className="flex items-center gap-2 text-sm text-destructive">
                                <IconAlertCircle className="h-4 w-4 shrink-0" />
                                <span className="text-xs">Failed to load audit logs. {error.message}</span>
                                <Button variant="outline" size="sm" className="ml-auto h-6 text-[11px]"
                                    onClick={() => refetch()}>
                                    Retry
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Entry list */}
                    <div className="flex-1 overflow-y-auto">
                        {isLoading && entries.length === 0 ? (
                            <div className="space-y-1 p-3">
                                {[...Array(8)].map((_, i) => (
                                    <div key={i} className="flex items-start gap-3 p-2.5 animate-pulse">
                                        <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="flex gap-2">
                                                <div className="h-4 w-14 bg-muted rounded" />
                                                <div className="h-4 w-20 bg-muted rounded" />
                                                <div className="h-4 w-12 bg-muted rounded ml-auto" />
                                            </div>
                                            <div className="h-3.5 w-40 bg-muted rounded" />
                                            <div className="h-3 w-24 bg-muted rounded" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : displayEntries.length === 0 && !error ? (
                            <div className="flex flex-col items-center justify-center h-52 text-muted-foreground gap-3">
                                <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                                    {drawerView === 'bookmarks'
                                        ? <IconBookmark className="h-6 w-6 opacity-40" />
                                        : <IconHistory className="h-6 w-6 opacity-40" />
                                    }
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-medium">
                                        {drawerView === 'bookmarks' ? 'No bookmarked entries' : 'No audit entries'}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {drawerView === 'bookmarks'
                                            ? 'Click the bookmark icon on any entry to pin it'
                                            : hasActiveFilters
                                                ? 'Try adjusting your filters'
                                                : 'Resource changes will appear here'}
                                    </p>
                                </div>
                                {hasActiveFilters && drawerView === 'list' && (
                                    <Button variant="outline" size="sm" className="text-xs h-7"
                                        onClick={resetFilters}>
                                        Clear filters
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="divide-y divide-border/50">
                                {displayEntries.map((entry, idx) => {
                                    const url = getResourceUrl(
                                        entry.resourceType ?? '',
                                        entry.namespace ?? '',
                                        entry.resourceName ?? ''
                                    )
                                    const opKey = entry.operationType?.toLowerCase() ?? ''
                                    const opColor = OP_COLORS[opKey] ?? OP_COLORS.update
                                    const ago = entry.createdAt
                                        ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true }).replace('about ', '').replace('less than a minute ago', 'just now')
                                        : ''
                                    const isBookmarked = bookmarkIds.includes(entry.id)

                                    return (
                                        <div
                                            key={entry.id ?? idx}
                                            className={`w-full text-left px-4 py-2.5 transition-colors group relative ${url
                                                ? 'hover:bg-muted/50'
                                                : ''
                                                }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                {/* Status icon */}
                                                <div className={`mt-0.5 shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${entry.success
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                                    }`}>
                                                    {entry.success
                                                        ? <IconCheck className="h-3.5 w-3.5" />
                                                        : <IconAlertCircle className="h-3.5 w-3.5" />
                                                    }
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    {/* Op badge + resource type + timestamp */}
                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className={`text-[10px] font-bold px-1.5 py-[1px] rounded border leading-tight ${opColor}`}>
                                                            {entry.operationType?.toUpperCase() ?? 'OP'}
                                                        </span>
                                                        <span className="text-[11px] font-medium text-foreground/70 truncate">
                                                            {entry.resourceType}
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0 tabular-nums">
                                                            {ago}
                                                        </span>
                                                    </div>

                                                    {/* Resource name — clickable for navigation */}
                                                    <button
                                                        onClick={() => url && handleNavigate(url)}
                                                        className={`flex items-center gap-1 text-xs w-full text-left ${url ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                                                    >
                                                        <span className="font-mono text-foreground/85 truncate font-medium">
                                                            {entry.namespace ? `${entry.namespace}/` : ''}{entry.resourceName}
                                                        </span>
                                                        {url && (
                                                            <IconChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                                                        )}
                                                    </button>

                                                    {/* Operator info + action buttons */}
                                                    <div className="flex items-center gap-1 mt-1">
                                                        {entry.operator && (
                                                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                                <IconUser className="h-2.5 w-2.5" />
                                                                <span>{entry.operator.username}</span>
                                                                {entry.clusterName && (
                                                                    <>
                                                                        <span>·</span>
                                                                        <span>{entry.clusterName}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Action buttons — show on hover */}
                                                        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <button
                                                                            onClick={(e) => handleOpenDetail(entry.id, e)}
                                                                            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                                                        >
                                                                            <IconEye className="h-3 w-3" />
                                                                        </button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="text-[10px]">View detail</TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <button
                                                                            onClick={(e) => handleToggleBookmark(entry.id, e)}
                                                                            className={`h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors ${isBookmarked ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'
                                                                                }`}
                                                                        >
                                                                            {isBookmarked
                                                                                ? <IconBookmarkFilled className="h-3 w-3" />
                                                                                : <IconBookmark className="h-3 w-3" />
                                                                            }
                                                                        </button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="text-[10px]">
                                                                        {isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        </div>
                                                    </div>

                                                    {/* Error message for failed ops */}
                                                    {!entry.success && entry.errorMessage && (
                                                        <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 line-clamp-1 leading-relaxed">
                                                            {entry.errorMessage}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-4 py-2 border-t bg-muted/20 shrink-0">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                                {displayEntries.length > 0
                                    ? drawerView === 'bookmarks'
                                        ? `${displayEntries.length} bookmarked`
                                        : `Showing ${displayEntries.length} of ${(data?.total ?? 0).toLocaleString()}`
                                    : 'No entries'
                                }
                            </span>
                            <div className="flex items-center gap-2">
                                {isOpen && (
                                    <span className="flex items-center gap-1">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        live
                                    </span>
                                )}
                                {notificationsEnabled && !isOpen && (
                                    <span className="flex items-center gap-1">
                                        <IconBell className="h-3 w-3" />
                                        notify on
                                    </span>
                                )}
                                {isAdmin && (
                                    <button
                                        onClick={() => { navigate('/settings?tab=audit'); setIsOpen(false) }}
                                        className="flex items-center gap-0.5 text-primary hover:underline"
                                    >
                                        Full log <IconArrowRight className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>

            {/* Detail Dialog (rendered outside Sheet so it's on top) */}
            <AuditDetailDialog
                entryId={detailEntryId}
                open={detailOpen}
                onOpenChange={setDetailOpen}
            />
        </>
    )
}
