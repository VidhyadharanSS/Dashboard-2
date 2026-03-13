import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    IconBolt,
    IconBox,
    IconBoxMultiple,
    IconArrowsHorizontal,
    IconChevronRight,
    IconLock,
    IconMap,
    IconNetwork,
    IconPlayerPlay,
    IconRocket,
    IconRoute,
    IconRouter,
    IconSearch,
    IconServer2,
    IconSettings2,
    IconTopologyBus,
    IconX,
} from '@tabler/icons-react'
import { AlertCircle, CheckCircle2, Clock, Filter, Loader2 } from 'lucide-react'

import { evaluate, EXPRESSION_EXAMPLES, ExpressionExample, extractFieldPaths, getSuggestions } from '@/lib/expression-engine'
import { fetchResources } from '@/lib/api'
import { ResourceType } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { NamespaceSelector } from '@/components/selector/namespace-selector'
import { usePermissions } from '@/hooks/use-permissions'

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------
interface ResourceDef {
    type: ResourceType
    label: string
    Icon: React.ComponentType<{ className?: string }>
    clusterScope?: boolean
}

const ALL_RESOURCE_DEFS: ResourceDef[] = [
    { type: 'pods', label: 'Pods', Icon: IconBox },
    { type: 'deployments', label: 'Deployments', Icon: IconRocket },
    { type: 'statefulsets', label: 'StatefulSets', Icon: IconRocket },
    { type: 'daemonsets', label: 'DaemonSets', Icon: IconTopologyBus },
    { type: 'jobs', label: 'Jobs', Icon: IconPlayerPlay },
    { type: 'services', label: 'Services', Icon: IconNetwork },
    { type: 'configmaps', label: 'ConfigMaps', Icon: IconMap },
    { type: 'secrets', label: 'Secrets', Icon: IconLock },
    { type: 'ingresses', label: 'Ingresses', Icon: IconRouter },
    { type: 'namespaces', label: 'Namespaces', Icon: IconBoxMultiple, clusterScope: true },
    { type: 'nodes', label: 'Nodes', Icon: IconServer2, clusterScope: true },
    { type: 'persistentvolumeclaims', label: 'PVCs', Icon: IconSettings2 },
    { type: 'persistentvolumes', label: 'PVs', Icon: IconSettings2, clusterScope: true },
    { type: 'rolebindings', label: 'RoleBindings', Icon: IconSettings2 },
    { type: 'clusterroles', label: 'ClusterRoles', Icon: IconSettings2, clusterScope: true },
    { type: 'horizontalpodautoscalers', label: 'HPAs', Icon: IconArrowsHorizontal },
    { type: 'cronjobs', label: 'CronJobs', Icon: IconRoute },
]

const DEFAULT_RESOURCE_TYPES: ResourceType[] = [
    'pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'services', 'configmaps', 'secrets',
]

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------
interface SearchResultItem {
    resourceType: ResourceType
    name: string
    namespace?: string
    raw: unknown
}

// ---------------------------------------------------------------------------
// Expression Search Page
// ---------------------------------------------------------------------------
export function ExpressionSearchPage() {
    const navigate = useNavigate()
    const inputRef = useRef<HTMLInputElement>(null)
    const { canAccess } = usePermissions()

    const [expression, setExpression] = useState('')
    const [selectedNamespace, setSelectedNamespace] = useState('default')

    // Filter resource definitions based on user permissions
    const authorizedResourceDefs = useMemo(() => {
        return ALL_RESOURCE_DEFS.filter(def =>
            canAccess(def.type, 'list', def.clusterScope ? undefined : selectedNamespace)
        )
    }, [canAccess, selectedNamespace])

    const [selectedTypes, setSelectedTypes] = useState<ResourceType[]>([])

    // Update selected types when authorized list changes (e.g. namespace switch)
    useEffect(() => {
        setSelectedTypes(prev => {
            const filtered = prev.filter(t => authorizedResourceDefs.some(d => d.type === t))
            if (filtered.length === 0 && authorizedResourceDefs.length > 0) {
                // Default to authorized core resources
                return authorizedResourceDefs
                    .filter(d => DEFAULT_RESOURCE_TYPES.includes(d.type))
                    .map(d => d.type)
            }
            return filtered
        })
    }, [authorizedResourceDefs])

    const [allItems, setAllItems] = useState<SearchResultItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [loadedAt, setLoadedAt] = useState<Date | null>(null)
    const [expressionError, setExpressionError] = useState<string | null>(null)

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    // Load resources when selected types or namespace changes
    const loadResources = useCallback(async () => {
        if (selectedTypes.length === 0) {
            setAllItems([])
            return
        }

        setIsLoading(true)
        const results: SearchResultItem[] = []

        await Promise.allSettled(
            authorizedResourceDefs.filter((d) => selectedTypes.includes(d.type)).map(async (def) => {
                try {
                    const ns = def.clusterScope ? undefined : selectedNamespace === '_all' ? undefined : selectedNamespace

                    // Double check permission before fetch
                    if (!canAccess(def.type, 'list', ns)) return

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const data = await fetchResources<any>(def.type, ns, { reduce: false })
                    const items: unknown[] = data?.items || []
                    for (const item of items) {
                        const meta = (item as { metadata?: { name?: string; namespace?: string } })?.metadata
                        results.push({
                            resourceType: def.type,
                            name: meta?.name || 'unknown',
                            namespace: meta?.namespace,
                            raw: item,
                        })
                    }
                } catch {
                    // ignore per-resource errors
                }
            })
        )

        setAllItems(results)
        setLoadedAt(new Date())
        setIsLoading(false)
    }, [selectedTypes, selectedNamespace, authorizedResourceDefs, canAccess])

    useEffect(() => {
        loadResources()
    }, [loadResources])

    // Evaluate expression against items
    const filteredItems = useMemo(() => {
        const expr = expression.trim()
        if (!expr) return allItems

        try {
            setExpressionError(null)
            return allItems.filter((item) => evaluate(expr, item.raw))
        } catch (e) {
            setExpressionError(String(e))
            return []
        }
    }, [expression, allItems])

    // Navigate to resource detail
    const handleRowClick = useCallback(
        (item: SearchResultItem) => {
            if (item.namespace) {
                navigate(`/${item.resourceType}/${item.namespace}/${item.name}`)
            } else {
                navigate(`/${item.resourceType}/${item.name}`)
            }
        },
        [navigate]
    )

    const toggleResourceType = useCallback((type: ResourceType) => {
        setSelectedTypes((prev) =>
            prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
        )
    }, [])

    const applyExample = useCallback((ex: ExpressionExample) => {
        setExpression(ex.expression)
        if (ex.resourceHint) {
            setSelectedTypes([ex.resourceHint as ResourceType])
        } else {
            // Re-check defaults against authorized list
            setSelectedTypes(authorizedResourceDefs
                .filter(d => DEFAULT_RESOURCE_TYPES.includes(d.type))
                .map(d => d.type))
        }
        inputRef.current?.focus()
    }, [authorizedResourceDefs])

    const clearExpression = useCallback(() => {
        setExpression('')
        setExpressionError(null)
        inputRef.current?.focus()
    }, [])

    // Auto-complete field paths from loaded resources
    const fieldPaths = useMemo(() => {
        if (allItems.length === 0) return []
        // Sample up to 3 resources to extract paths
        const samples = allItems.slice(0, 3).map(item => item.raw)
        const pathSet = new Set<string>()
        samples.forEach(s => extractFieldPaths(s, '', 4).forEach(p => pathSet.add(p)))
        return Array.from(pathSet).sort()
    }, [allItems])

    // Auto-complete suggestions
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [selectedSuggestion, setSelectedSuggestion] = useState(0)
    const suggestions = useMemo(() => {
        if (!showSuggestions || !expression.trim()) return []
        return getSuggestions(expression, fieldPaths)
    }, [showSuggestions, expression, fieldPaths])

    const applySuggestion = useCallback((suggestion: string) => {
        const parts = expression.trim().split(/\s+/)
        parts[parts.length - 1] = suggestion
        setExpression(parts.join(' ') + ' ')
        setShowSuggestions(false)
        inputRef.current?.focus()
    }, [expression])

    // Pagination for results
    const [resultsPage, setResultsPage] = useState(1)
    const RESULTS_PER_PAGE = 50
    const paginatedItems = useMemo(() => {
        const start = (resultsPage - 1) * RESULTS_PER_PAGE
        return filteredItems.slice(start, start + RESULTS_PER_PAGE)
    }, [filteredItems, resultsPage])
    const totalPages = Math.ceil(filteredItems.length / RESULTS_PER_PAGE)

    // Reset page on filter change
    useEffect(() => { setResultsPage(1) }, [expression, selectedTypes, selectedNamespace])

    const hasExpression = expression.trim().length > 0

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-300">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <IconSearch className="h-6 w-6 text-primary" />
                    Advanced Search
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Filter Kubernetes resources using expression-based queries — supports <code className="text-xs bg-muted px-1 rounded">in</code>, <code className="text-xs bg-muted px-1 rounded">regex</code>, <code className="text-xs bg-muted px-1 rounded">exists()</code>, <code className="text-xs bg-muted px-1 rounded">.age</code>, and more
                </p>
            </div>

            {/* Control Bar */}
            <div className="flex flex-col gap-3">
                {/* Resource type selector + namespace */}
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Resource type multi-select */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 gap-1.5">
                                <Filter className="h-3.5 w-3.5" />
                                Select Resources
                                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs font-bold">
                                    {selectedTypes.length}
                                </Badge>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3" align="start">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase text-muted-foreground">Resource Types</span>
                                <div className="flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => setSelectedTypes(authorizedResourceDefs.map((d) => d.type))}
                                    >
                                        All
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => setSelectedTypes(
                                            authorizedResourceDefs
                                                .filter(d => DEFAULT_RESOURCE_TYPES.includes(d.type))
                                                .map(d => d.type)
                                        )}
                                    >
                                        Default
                                    </Button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                {authorizedResourceDefs.map((def) => (
                                    <div key={def.type} className="flex items-center gap-2 rounded p-1.5 hover:bg-accent cursor-pointer"
                                        onClick={() => toggleResourceType(def.type)}>
                                        <Checkbox
                                            id={`rt-${def.type}`}
                                            checked={selectedTypes.includes(def.type)}
                                            onCheckedChange={() => toggleResourceType(def.type)}
                                        />
                                        <Label htmlFor={`rt-${def.type}`} className="text-xs cursor-pointer font-normal">
                                            {def.label}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Namespace selector */}
                    <NamespaceSelector
                        selectedNamespace={selectedNamespace}
                        handleNamespaceChange={(ns) => setSelectedNamespace(ns)}
                        showAll={true}
                    />

                    {/* Load status */}
                    <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        {isLoading ? (
                            <span className="flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading…
                            </span>
                        ) : loadedAt ? (
                            <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                Loaded {allItems.length.toLocaleString()} items
                            </span>
                        ) : null}
                        {loadedAt && (
                            <span className="flex items-center gap-1 text-muted-foreground/60">
                                <Clock className="h-3 w-3" />
                                {loadedAt.toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                </div>

                {/* Expression Input with Autocomplete */}
                <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <IconSearch className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <Input
                        ref={inputRef}
                        value={expression}
                        onChange={(e) => { setExpression(e.target.value); setShowSuggestions(true); setSelectedSuggestion(0) }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onKeyDown={(e) => {
                            if (showSuggestions && suggestions.length > 0) {
                                if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSuggestion(p => Math.min(p + 1, suggestions.length - 1)) }
                                if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedSuggestion(p => Math.max(p - 1, 0)) }
                                if (e.key === 'Tab' || (e.key === 'Enter' && suggestions[selectedSuggestion])) {
                                    e.preventDefault(); applySuggestion(suggestions[selectedSuggestion])
                                }
                                if (e.key === 'Escape') { setShowSuggestions(false) }
                            }
                        }}
                        placeholder='e.g. status.phase in ("Pending", "Failed") && metadata.name.matches("web-.*")'
                        className={`pl-9 pr-10 h-12 text-base font-mono transition-all ${expressionError
                            ? 'border-destructive ring-1 ring-destructive/30 focus-visible:ring-destructive'
                            : hasExpression
                                ? 'border-primary/50 ring-1 ring-primary/20'
                                : ''
                            }`}
                    />
                    {hasExpression && (
                        <button
                            onClick={clearExpression}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <IconX className="h-4 w-4" />
                        </button>
                    )}

                    {/* Autocomplete dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {suggestions.map((s, idx) => (
                                <button
                                    key={s}
                                    onMouseDown={(e) => { e.preventDefault(); applySuggestion(s) }}
                                    className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors ${idx === selectedSuggestion ? 'bg-accent' : ''}`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Expression Error */}
                {expressionError && (
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="font-mono">{expressionError}</span>
                    </div>
                )}

                {/* Active filter chip */}
                {hasExpression && !expressionError && (
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Showing:</span>
                        <Badge variant="secondary" className="font-mono text-xs gap-1">
                            <IconBolt className="h-3 w-3 text-primary" />
                            {filteredItems.length} results
                        </Badge>
                        <span className="text-muted-foreground">for expression</span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-primary text-xs max-w-xs truncate">
                            {expression}
                        </code>
                    </div>
                )}
            </div>

            {/* Results Table */}
            {hasExpression && !expressionError ? (
                <>
                    <ResultsTable items={paginatedItems} isLoading={isLoading} onRowClick={handleRowClick} />
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-2">
                            <Button variant="outline" size="sm" disabled={resultsPage <= 1} onClick={() => setResultsPage(p => p - 1)}>Previous</Button>
                            <span className="text-xs text-muted-foreground">
                                Page {resultsPage} of {totalPages} ({filteredItems.length} total)
                            </span>
                            <Button variant="outline" size="sm" disabled={resultsPage >= totalPages} onClick={() => setResultsPage(p => p + 1)}>Next</Button>
                        </div>
                    )}
                </>
            ) : !hasExpression ? (
                <ExamplesPanel onApply={applyExample} />
            ) : null}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Results Table
// ---------------------------------------------------------------------------
function ResultsTable({
    items,
    isLoading,
    onRowClick,
}: {
    items: SearchResultItem[]
    isLoading: boolean
    onRowClick: (item: SearchResultItem) => void
}) {
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading resources…</span>
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                <IconSearch className="h-8 w-8 opacity-30" />
                <p className="text-sm">No resources matched the expression</p>
            </div>
        )
    }

    return (
        <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                            Kind
                        </th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                            Name
                        </th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                            Namespace
                        </th>
                        <th className="w-8 px-4 py-2.5" />
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, i) => {
                        const def = ALL_RESOURCE_DEFS.find((d) => d.type === item.resourceType)
                        const Icon = def?.Icon ?? IconBox
                        return (
                            <tr
                                key={`${item.resourceType}-${item.namespace}-${item.name}-${i}`}
                                onClick={() => onRowClick(item)}
                                className="border-b last:border-0 hover:bg-accent/50 cursor-pointer transition-colors group"
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <Icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                                        <Badge variant="outline" className="text-xs capitalize font-normal">
                                            {def?.label ?? item.resourceType}
                                        </Badge>
                                    </div>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs font-medium">{item.name}</td>
                                <td className="px-4 py-3">
                                    {item.namespace ? (
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            {item.namespace}
                                        </Badge>
                                    ) : (
                                        <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <IconChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Examples Panel
// ---------------------------------------------------------------------------
function ExamplesPanel({ onApply }: { onApply: (ex: ExpressionExample) => void }) {
    return (
        <div className="flex flex-col gap-4 mt-2">
            <div className="text-center text-sm text-muted-foreground font-medium">Examples</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {EXPRESSION_EXAMPLES.map((ex, i) => (
                    <ExampleCard key={i} example={ex} onApply={onApply} />
                ))}
            </div>
        </div>
    )
}

function ExampleCard({
    example,
    onApply,
}: {
    example: ExpressionExample
    onApply: (ex: ExpressionExample) => void
}) {
    const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
        Pods: IconBox,
        Pod: IconBox,
        pods: IconBox,
        Deployment: IconRocket,
        deployments: IconRocket,
        configmaps: IconMap,
        ConfigMap: IconMap,
        services: IconNetwork,
        Service: IconNetwork,
        jobs: IconPlayerPlay,
        Job: IconPlayerPlay,
    }
    const Icon = iconMap[example.label] ?? iconMap[example.resourceHint ?? ''] ?? IconBox

    return (
        <button
            onClick={() => onApply(example)}
            className="text-left rounded-lg border bg-card hover:bg-accent/50 hover:border-primary/40 transition-all p-3.5 group cursor-pointer"
        >
            <div className="flex items-center gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-muted-foreground">{example.label}</span>
                </div>
            </div>
            {example.description && (
                <p className="text-xs text-muted-foreground mb-1.5">{example.description}</p>
            )}
            <code className="text-xs font-mono text-foreground/80 group-hover:text-foreground break-all leading-relaxed">
                {example.expression}
            </code>
        </button>
    )
}
