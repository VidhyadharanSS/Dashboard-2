import { useMemo, useState, useCallback } from 'react'
import { Check, Filter, X, Download, ChevronDown, ChevronRight, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { IconSearch } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Role } from '@/types/api'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

/* ─── Resource Groups ─── */
const RESOURCE_GROUPS: { label: string; color: string; bgColor: string; resources: string[] }[] = [
    {
        label: 'Workloads',
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10',
        resources: ['pods', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs'],
    },
    {
        label: 'Networking',
        color: 'text-violet-500',
        bgColor: 'bg-violet-500/10',
        resources: ['services', 'ingresses', 'endpoints'],
    },
    {
        label: 'Configuration',
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
        resources: ['configmaps', 'secrets'],
    },
    {
        label: 'Storage',
        color: 'text-cyan-500',
        bgColor: 'bg-cyan-500/10',
        resources: ['persistentvolumes', 'persistentvolumeclaims', 'storageclasses'],
    },
    {
        label: 'Cluster',
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-500/10',
        resources: ['nodes', 'namespaces', 'events'],
    },
    {
        label: 'RBAC & Auth',
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
        resources: ['serviceaccounts', 'roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'],
    },
    {
        label: 'Autoscaling',
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/10',
        resources: ['horizontalpodautoscalers'],
    },
]

/* ─── Verb categories ─── */
const VERB_CATEGORIES = [
    { label: 'READ', verbs: ['get', 'list', 'watch'], color: 'text-blue-500', bg: 'bg-blue-500/8' },
    { label: 'WRITE', verbs: ['create', 'update', 'patch'], color: 'text-amber-500', bg: 'bg-amber-500/8' },
    { label: 'DELETE', verbs: ['delete'], color: 'text-red-500', bg: 'bg-red-500/8' },
    { label: 'SPECIAL', verbs: ['log', 'exec'], color: 'text-purple-500', bg: 'bg-purple-500/8' },
]

const ALL_VERBS = VERB_CATEGORIES.flatMap(c => c.verbs)

interface RBACPermissionMatrixProps {
    role: Role
}

export function RBACPermissionMatrix({ role }: RBACPermissionMatrixProps) {
    useTranslation() // keep i18n context active
    const [searchQuery, setSearchQuery] = useState('')
    const [showOnlyAllowed, setShowOnlyAllowed] = useState(false)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

    const hasPermission = useCallback((res: string, verb: string) => {
        const resFound =
            role.resources.includes('*') ||
            role.resources.some((r) => r.toLowerCase() === res.toLowerCase())
        if (!resFound) return false

        const verbFound =
            role.verbs.includes('*') ||
            role.verbs.some((v) => v.toLowerCase() === verb.toLowerCase())
        return verbFound
    }, [role.resources, role.verbs])

    // Build groups with extras
    const groupedResources = useMemo(() => {
        const knownResources = new Set(RESOURCE_GROUPS.flatMap(g => g.resources))
        const extras = role.resources.filter(
            (r) => r !== '*' && !knownResources.has(r.toLowerCase())
        )
        const groups = [...RESOURCE_GROUPS]
        if (extras.length > 0) {
            groups.push({
                label: 'Custom',
                color: 'text-gray-500',
                bgColor: 'bg-gray-500/10',
                resources: extras,
            })
        }
        return groups
    }, [role.resources])

    // All resources from groups
    const allResources = useMemo(() => groupedResources.flatMap(g => g.resources), [groupedResources])

    // Compute coverage statistics
    const totalCells = allResources.length * ALL_VERBS.length
    const allowedCells = useMemo(() => {
        let count = 0
        for (const res of allResources) {
            for (const verb of ALL_VERBS) {
                if (hasPermission(res, verb)) count++
            }
        }
        return count
    }, [allResources, hasPermission])
    const coveragePct = totalCells > 0 ? Math.round((allowedCells / totalCells) * 100) : 0

    const isWildcard = role.resources.includes('*') && role.verbs.includes('*')

    const toggleGroup = useCallback((label: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(label)) next.delete(label)
            else next.add(label)
            return next
        })
    }, [])

    // Export as CSV
    const handleExport = useCallback(() => {
        const header = ['Resource', ...ALL_VERBS].join(',')
        const rows = allResources.map(res =>
            [res, ...ALL_VERBS.map(v => hasPermission(res, v) ? '✓' : '✗')].join(',')
        )
        const csv = [header, ...rows].join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${role.name}-permissions.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success('Permission matrix exported as CSV')
    }, [allResources, hasPermission, role.name])

    // Filter resources by search query
    const filterResource = useCallback((res: string) => {
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            if (!res.toLowerCase().includes(q)) return false
        }
        if (showOnlyAllowed) {
            return ALL_VERBS.some(v => hasPermission(res, v))
        }
        return true
    }, [searchQuery, showOnlyAllowed, hasPermission])

    // Compute a permission summary per resource for the overview
    const getResourceSummary = useCallback((res: string) => {
        const allowed = ALL_VERBS.filter(v => hasPermission(res, v))
        return {
            total: ALL_VERBS.length,
            allowed: allowed.length,
            verbs: allowed,
            isFullAccess: allowed.length === ALL_VERBS.length,
            isReadOnly: allowed.every(v => ['get', 'list', 'watch'].includes(v)) && allowed.length > 0,
            isNoAccess: allowed.length === 0,
        }
    }, [hasPermission])

    return (
        <div className="space-y-5">
            {/* ── Header Stats ── */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5 bg-card border rounded-xl px-4 py-2.5">
                        {isWildcard ? (
                            <ShieldAlert className="h-5 w-5 text-amber-500" />
                        ) : coveragePct >= 80 ? (
                            <ShieldCheck className="h-5 w-5 text-emerald-500" />
                        ) : (
                            <Shield className="h-5 w-5 text-blue-500" />
                        )}
                        <div>
                            <span className="text-sm font-bold">{role.name}</span>
                            <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                                {role.clusters.join(', ')} · {role.namespaces.join(', ')}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[11px] h-6 gap-1.5 font-mono">
                            {allowedCells}/{totalCells} permissions
                        </Badge>
                        <Badge variant="outline" className={`text-[11px] h-6 font-bold ${coveragePct >= 90 ? 'border-amber-500/30 text-amber-600' :
                                coveragePct >= 50 ? 'border-blue-500/30 text-blue-600' :
                                    'border-emerald-500/30 text-emerald-600'
                            }`}>
                            {coveragePct}%
                        </Badge>
                        {isWildcard && (
                            <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[11px] h-6 gap-1.5">
                                <ShieldAlert className="h-3 w-3" />
                                Full Wildcard Access
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Coverage bar */}
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ${coveragePct >= 90 ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
                                coveragePct >= 50 ? 'bg-gradient-to-r from-blue-400 to-blue-500' :
                                    'bg-gradient-to-r from-emerald-400 to-emerald-500'
                            }`}
                        style={{ width: `${coveragePct}%` }}
                    />
                </div>
            </div>

            {/* ── Filters ── */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                    <IconSearch className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Filter resources..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-8 pl-8 text-xs"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>
                <button
                    onClick={() => setShowOnlyAllowed(!showOnlyAllowed)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${showOnlyAllowed
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'text-muted-foreground hover:text-foreground border-border hover:border-primary/50'
                        }`}
                >
                    <Filter className="h-3 w-3" />
                    Allowed only
                </button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={handleExport}
                >
                    <Download className="h-3 w-3" />
                    Export CSV
                </Button>
            </div>

            {/* ── Permission Matrix Grid ── */}
            <div className="border rounded-xl overflow-hidden bg-card">
                {/* Header */}
                <div className="grid items-end border-b bg-muted/40"
                    style={{ gridTemplateColumns: `200px repeat(${ALL_VERBS.length}, minmax(52px, 1fr))` }}>
                    <div className="px-4 py-2.5 text-xs font-bold text-muted-foreground">
                        Resource
                    </div>
                    {VERB_CATEGORIES.map((cat) =>
                        cat.verbs.map((verb, vi) => (
                            <div key={verb} className="text-center py-2.5 px-1">
                                {vi === 0 && (
                                    <div className={`text-[8px] font-black uppercase tracking-widest ${cat.color} mb-1`}>
                                        {cat.label}
                                    </div>
                                )}
                                <div className={`text-[10px] font-semibold capitalize ${cat.color}`}>{verb}</div>
                            </div>
                        ))
                    )}
                </div>

                {/* Body */}
                <div className="divide-y divide-border/50">
                    {groupedResources.map((group) => {
                        const filteredResources = group.resources.filter(filterResource)
                        if (filteredResources.length === 0) return null
                        const isCollapsed = collapsedGroups.has(group.label)
                        const groupAllowed = group.resources.reduce((sum, res) =>
                            sum + ALL_VERBS.filter(v => hasPermission(res, v)).length, 0)
                        const groupTotal = group.resources.length * ALL_VERBS.length
                        const groupPct = groupTotal > 0 ? Math.round((groupAllowed / groupTotal) * 100) : 0

                        return (
                            <div key={group.label}>
                                {/* Group header */}
                                <button
                                    onClick={() => toggleGroup(group.label)}
                                    className="w-full flex items-center gap-2.5 px-4 py-2 bg-muted/20 hover:bg-muted/40 transition-colors border-b border-border/30"
                                >
                                    {isCollapsed ? (
                                        <ChevronRight className={`h-3.5 w-3.5 ${group.color}`} />
                                    ) : (
                                        <ChevronDown className={`h-3.5 w-3.5 ${group.color}`} />
                                    )}
                                    <span className={`text-xs font-bold ${group.color}`}>{group.label}</span>
                                    <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                                        {filteredResources.length}
                                    </Badge>
                                    {/* Mini permission bar */}
                                    <div className="flex-1 max-w-[120px] h-1 bg-muted rounded-full overflow-hidden ml-auto mr-2">
                                        <div
                                            className={`h-full rounded-full ${group.color.replace('text-', 'bg-').replace('/500', '-500')}`}
                                            style={{ width: `${groupPct}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground font-mono tabular-nums w-8 text-right">
                                        {groupPct}%
                                    </span>
                                </button>

                                {/* Resource rows */}
                                {!isCollapsed && filteredResources.map((res) => {
                                    const summary = getResourceSummary(res)
                                    return (
                                        <div
                                            key={res}
                                            className="grid items-center hover:bg-muted/20 transition-colors"
                                            style={{ gridTemplateColumns: `200px repeat(${ALL_VERBS.length}, minmax(52px, 1fr))` }}
                                        >
                                            {/* Resource name */}
                                            <div className="px-4 py-2 flex items-center gap-2">
                                                <span className="text-xs font-medium truncate">{res}</span>
                                                {summary.isFullAccess && (
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Full access" />
                                                )}
                                                {summary.isReadOnly && !summary.isFullAccess && (
                                                    <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-blue-500/5 text-blue-500 border-blue-500/20">RO</Badge>
                                                )}
                                            </div>
                                            {/* Permission cells */}
                                            {ALL_VERBS.map((verb) => {
                                                const allowed = hasPermission(res, verb)
                                                return (
                                                    <div key={verb} className="flex justify-center py-2">
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className={`h-6 w-6 rounded-md flex items-center justify-center transition-all ${allowed
                                                                            ? 'bg-emerald-500/15 hover:bg-emerald-500/25 hover:scale-110'
                                                                            : 'bg-transparent hover:bg-muted/40'
                                                                        }`}>
                                                                        {allowed ? (
                                                                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                                                        ) : (
                                                                            <X className="h-2.5 w-2.5 text-muted-foreground/20" />
                                                                        )}
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent className="text-[10px]">
                                                                    <span className={allowed ? 'text-emerald-400' : 'text-red-400'}>
                                                                        {allowed ? '✓' : '✗'}
                                                                    </span>{' '}
                                                                    {role.name} {allowed ? 'can' : 'cannot'} <strong>{verb}</strong> {res}
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}

                    {allResources.filter(filterResource).length === 0 && (
                        <div className="text-center py-12 text-sm text-muted-foreground">
                            <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                            No resources match your filter
                        </div>
                    )}
                </div>
            </div>

            {/* ── Legend ── */}
            <div className="flex items-center gap-5 text-[10px] text-muted-foreground pt-1 flex-wrap">
                <span className="flex items-center gap-1.5">
                    <div className="h-5 w-5 rounded-md bg-emerald-500/15 flex items-center justify-center">
                        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    Allowed
                </span>
                <span className="flex items-center gap-1.5">
                    <div className="h-5 w-5 rounded-md flex items-center justify-center">
                        <X className="h-2.5 w-2.5 text-muted-foreground/30" />
                    </div>
                    Denied
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Full verb access
                </span>
                <span className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-blue-500/5 text-blue-500 border-blue-500/20">RO</Badge>
                    Read-only
                </span>
                <span className="ml-auto text-muted-foreground/50">
                    Click group headers to collapse/expand
                </span>
            </div>
        </div>
    )
}
