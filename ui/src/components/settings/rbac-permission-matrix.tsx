import { useMemo, useState } from 'react'
import { Check, Filter, X } from 'lucide-react'
import { IconSearch, IconShieldCheck } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Role } from '@/types/api'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

const COMMON_RESOURCES = [
    'pods',
    'deployments',
    'statefulsets',
    'daemonsets',
    'replicasets',
    'services',
    'configmaps',
    'secrets',
    'ingresses',
    'jobs',
    'cronjobs',
    'nodes',
    'namespaces',
    'persistentvolumes',
    'persistentvolumeclaims',
    'events',
    'serviceaccounts',
    'roles',
    'rolebindings',
    'clusterroles',
    'clusterrolebindings',
    'storageclasses',
    'horizontalpodautoscalers',
]

const VERBS = ['get', 'list', 'create', 'update', 'patch', 'delete', 'log', 'exec', 'watch']

const VERB_COLORS: Record<string, string> = {
    get: 'text-blue-600 dark:text-blue-400',
    list: 'text-blue-600 dark:text-blue-400',
    watch: 'text-sky-600 dark:text-sky-400',
    create: 'text-emerald-600 dark:text-emerald-400',
    update: 'text-amber-600 dark:text-amber-400',
    patch: 'text-amber-600 dark:text-amber-400',
    delete: 'text-red-600 dark:text-red-400',
    log: 'text-purple-600 dark:text-purple-400',
    exec: 'text-orange-600 dark:text-orange-400',
}

interface RBACPermissionMatrixProps {
    role: Role
}

export function RBACPermissionMatrix({ role }: RBACPermissionMatrixProps) {
    const { t } = useTranslation()
    const [searchQuery, setSearchQuery] = useState('')
    const [showOnlyAllowed, setShowOnlyAllowed] = useState(false)

    const hasPermission = (res: string, verb: string) => {
        const resFound =
            role.resources.includes('*') ||
            role.resources.some((r) => r.toLowerCase() === res.toLowerCase())
        if (!resFound) return false

        const verbFound =
            role.verbs.includes('*') ||
            role.verbs.some((v) => v.toLowerCase() === verb.toLowerCase())
        return verbFound
    }

    const sortedResources = useMemo(() => {
        // Add any custom resources from the role that are not in COMMON_RESOURCES
        const extras = role.resources.filter(
            (r) => r !== '*' && !COMMON_RESOURCES.includes(r.toLowerCase())
        )
        return [...COMMON_RESOURCES, ...extras]
    }, [role.resources])

    const filteredResources = useMemo(() => {
        let list = sortedResources
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            list = list.filter(r => r.toLowerCase().includes(q))
        }
        if (showOnlyAllowed) {
            list = list.filter(res => VERBS.some(v => hasPermission(res, v)))
        }
        return list
    }, [sortedResources, searchQuery, showOnlyAllowed])

    // Compute coverage statistics
    const totalCells = sortedResources.length * VERBS.length
    const allowedCells = useMemo(() => {
        let count = 0
        for (const res of sortedResources) {
            for (const verb of VERBS) {
                if (hasPermission(res, verb)) count++
            }
        }
        return count
    }, [sortedResources, role.resources, role.verbs])
    const coveragePct = totalCells > 0 ? Math.round((allowedCells / totalCells) * 100) : 0

    const isWildcard = role.resources.includes('*') && role.verbs.includes('*')

    return (
        <div className="space-y-4">
            {/* Stats bar */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
                    <IconShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-xs font-medium">{role.name}</span>
                </div>
                <Badge variant="outline" className="text-[10px] h-5">
                    {allowedCells}/{totalCells} permissions ({coveragePct}%)
                </Badge>
                {isWildcard && (
                    <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[10px] h-5 gap-1">
                        ⚠ Full Wildcard Access
                    </Badge>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        Clusters: {role.clusters.join(', ')}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        NS: {role.namespaces.join(', ')}
                    </span>
                </div>
            </div>

            {/* Coverage bar */}
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${
                        coveragePct >= 90 ? 'bg-amber-500' : coveragePct >= 50 ? 'bg-blue-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${coveragePct}%` }}
                />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
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
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-all ${
                        showOnlyAllowed
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'text-muted-foreground hover:text-foreground border-border hover:border-primary/50'
                    }`}
                >
                    <Filter className="h-3 w-3" />
                    Allowed only
                </button>
            </div>

            {/* Permission Matrix Table */}
            <div className="border rounded-md overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead className="w-[180px] font-bold text-xs sticky left-0 bg-muted/50 z-10">
                                {t('rbac.matrix.resource', 'Resource')}
                            </TableHead>
                            {VERBS.map((v) => (
                                <TableHead key={v} className="text-center font-bold capitalize text-[11px] px-2">
                                    <span className={VERB_COLORS[v] || ''}>
                                        {v}
                                    </span>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredResources.map((res) => {
                            const allowedCount = VERBS.filter(v => hasPermission(res, v)).length
                            return (
                                <TableRow key={res} className="hover:bg-muted/30">
                                    <TableCell className="font-medium text-xs sticky left-0 bg-card z-10">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate">{res}</span>
                                            {allowedCount === VERBS.length && (
                                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                            )}
                                        </div>
                                    </TableCell>
                                    {VERBS.map((v) => {
                                        const allowed = hasPermission(res, v)
                                        return (
                                            <TableCell key={v} className="text-center p-1.5">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className="flex justify-center">
                                                                {allowed ? (
                                                                    <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center transition-all hover:bg-green-500/20 hover:scale-110">
                                                                        <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                                                                    </div>
                                                                ) : (
                                                                    <div className="h-6 w-6 rounded-full bg-muted/20 flex items-center justify-center">
                                                                        <X className="h-2.5 w-2.5 text-muted-foreground/30" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="text-[10px]">
                                                            {allowed
                                                                ? `${role.name} can ${v} ${res}`
                                                                : `${role.name} cannot ${v} ${res}`}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </TableCell>
                                        )
                                    })}
                                </TableRow>
                            )
                        })}
                        {filteredResources.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={VERBS.length + 1} className="text-center py-8 text-sm text-muted-foreground">
                                    No resources match your filter
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
                <span className="flex items-center gap-1">
                    <div className="h-4 w-4 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
                    </div>
                    Allowed
                </span>
                <span className="flex items-center gap-1">
                    <div className="h-4 w-4 rounded-full bg-muted/20 flex items-center justify-center">
                        <X className="h-2 w-2 text-muted-foreground/30" />
                    </div>
                    Denied
                </span>
                <span className="flex items-center gap-1 ml-auto">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Full verb access
                </span>
            </div>
        </div>
    )
}
