import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
// kubectl command parser — maps `kubectl get <resource> -n <ns> [-l label]`
// to a resource type + namespace + optional label filter expression
// ---------------------------------------------------------------------------
interface KubectlParsedCommand {
    isKubectl: boolean
    verb?: string
    resourceType?: ResourceType
    namespace?: string
    name?: string
    labelSelector?: string
    fieldSelector?: string
    error?: string
}

const KUBECTL_RESOURCE_MAP: Record<string, ResourceType> = {
    po: 'pods', pod: 'pods', pods: 'pods',
    deploy: 'deployments', deployment: 'deployments', deployments: 'deployments',
    svc: 'services', service: 'services', services: 'services',
    ds: 'daemonsets', daemonset: 'daemonsets', daemonsets: 'daemonsets',
    sts: 'statefulsets', statefulset: 'statefulsets', statefulsets: 'statefulsets',
    job: 'jobs', jobs: 'jobs',
    cj: 'cronjobs', cronjob: 'cronjobs', cronjobs: 'cronjobs',
    cm: 'configmaps', configmap: 'configmaps', configmaps: 'configmaps',
    secret: 'secrets', secrets: 'secrets',
    ing: 'ingresses', ingress: 'ingresses', ingresses: 'ingresses',
    no: 'nodes', node: 'nodes', nodes: 'nodes',
    ns: 'namespaces', namespace: 'namespaces', namespaces: 'namespaces',
    pvc: 'persistentvolumeclaims', persistentvolumeclaim: 'persistentvolumeclaims', persistentvolumeclaims: 'persistentvolumeclaims',
    pv: 'persistentvolumes', persistentvolume: 'persistentvolumes', persistentvolumes: 'persistentvolumes',
    hpa: 'horizontalpodautoscalers', horizontalpodautoscaler: 'horizontalpodautoscalers', horizontalpodautoscalers: 'horizontalpodautoscalers',
    sa: 'serviceaccounts', serviceaccount: 'serviceaccounts', serviceaccounts: 'serviceaccounts',
    rb: 'rolebindings', rolebinding: 'rolebindings', rolebindings: 'rolebindings',
    cr: 'clusterroles', clusterrole: 'clusterroles', clusterroles: 'clusterroles',
}

function parseKubectlCommand(input: string): KubectlParsedCommand {
    const trimmed = input.trim()
    if (!trimmed.startsWith('kubectl ') && !trimmed.startsWith('k ')) {
        return { isKubectl: false }
    }

    const parts = trimmed.split(/\s+/)
    const idx = parts[0] === 'kubectl' || parts[0] === 'k' ? 1 : 0

    const verb = parts[idx]?.toLowerCase()
    if (!verb || !['get', 'describe', 'logs'].includes(verb)) {
        return { isKubectl: true, error: `Supported verbs: get, describe, logs (got "${verb}")` }
    }

    const resourceStr = parts[idx + 1]?.toLowerCase()
    if (!resourceStr) {
        return { isKubectl: true, verb, error: 'Missing resource type' }
    }

    // Handle "kubectl get nodes" / "kubectl get pods/<name>"
    let resourceKey = resourceStr
    let inlineName: string | undefined
    if (resourceStr.includes('/')) {
        const [rk, nm] = resourceStr.split('/')
        resourceKey = rk
        inlineName = nm
    }

    const resourceType = KUBECTL_RESOURCE_MAP[resourceKey]
    if (!resourceType) {
        return { isKubectl: true, verb, error: `Unknown resource type: "${resourceStr}"` }
    }

    // Parse remaining name arg and flags
    let namespace: string | undefined
    let name = inlineName
    let labelSelector: string | undefined
    let fieldSelector: string | undefined

    let i = idx + 2
    while (i < parts.length) {
        const arg = parts[i]
        if ((arg === '-n' || arg === '--namespace') && parts[i + 1]) {
            namespace = parts[i + 1]
            i += 2
        } else if (arg === '-A' || arg === '--all-namespaces') {
            namespace = '_all'
            i++
        } else if ((arg === '-l' || arg === '--selector') && parts[i + 1]) {
            labelSelector = parts[i + 1]
            i += 2
        } else if (arg.startsWith('-l=')) {
            labelSelector = arg.slice(3)
            i++
        } else if (arg.startsWith('--field-selector=')) {
            fieldSelector = arg.slice(17)
            i++
        } else if (arg.startsWith('--field-selector') && parts[i + 1]) {
            fieldSelector = parts[i + 1]
            i += 2
        } else if (!arg.startsWith('-') && !name) {
            name = arg
            i++
        } else {
            i++
        }
    }

    return {
        isKubectl: true,
        verb,
        resourceType,
        namespace,
        name,
        labelSelector,
        fieldSelector,
    }
}

// ---------------------------------------------------------------------------
// Expression Search Page
// ---------------------------------------------------------------------------

export function ExpressionSearchPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const inputRef = useRef<HTMLInputElement>(null)
    const { canAccess } = usePermissions()

    // Accept ?q= parameter from global search redirect
    const initialQuery = searchParams.get('q') || ''
    const [expression, setExpression] = useState(initialQuery)
    const [selectedNamespace, setSelectedNamespace] = useState('default')
    const [kubectlParsed, setKubectlParsed] = useState<KubectlParsedCommand>({ isKubectl: false })    // Filter resource definitions based on user permissions
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

    // Parse kubectl commands on expression change
    useEffect(() => {
        const parsed = parseKubectlCommand(expression)
        setKubectlParsed(parsed)

        if (parsed.isKubectl && parsed.resourceType && !parsed.error) {
            // Auto-select the resource type parsed from kubectl command
            if (!selectedTypes.includes(parsed.resourceType)) {
                setSelectedTypes([parsed.resourceType])
            }
            // Auto-set namespace from -n flag
            if (parsed.namespace && parsed.namespace !== selectedNamespace) {
                setSelectedNamespace(parsed.namespace === '_all' ? '_all' : parsed.namespace)
            }
        }
    }, [expression]) // eslint-disable-line react-hooks/exhaustive-deps

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

    // Evaluate expression against items — supports both expressions and kubectl commands
    const filterResult = useMemo(() => {
        const expr = expression.trim()
        if (!expr) return { items: allItems, error: null }

        // If it's a kubectl command, filter by parsed resource type & name
        if (kubectlParsed.isKubectl && !kubectlParsed.error && kubectlParsed.resourceType) {
            let results = allItems.filter(item => item.resourceType === kubectlParsed.resourceType)

            // Filter by name if specified
            if (kubectlParsed.name) {
                const nameLower = kubectlParsed.name.toLowerCase()
                results = results.filter(item => item.name.toLowerCase().includes(nameLower))
            }

            // Filter by label selector if specified
            if (kubectlParsed.labelSelector) {
                const selectors = kubectlParsed.labelSelector.split(',').map(s => s.trim())
                results = results.filter(item => {
                    const labels = (item.raw as { metadata?: { labels?: Record<string, string> } })?.metadata?.labels || {}
                    return selectors.every(sel => {
                        if (sel.includes('!=')) {
                            const [key, val] = sel.split('!=')
                            return labels[key] !== val
                        }
                        if (sel.includes('=')) {
                            const [key, val] = sel.split('=')
                            return labels[key] === val
                        }
                        // Label existence check (bare key)
                        return sel in labels
                    })
                })
            }

            return { items: results, error: null }
        }

        // Standard expression mode
        try {
            return { items: allItems.filter((item) => evaluate(expr, item.raw)), error: null }
        } catch (e) {
            return { items: [] as SearchResultItem[], error: String(e) }
        }
    }, [expression, allItems, kubectlParsed])

    // Sync expression error state from the memoized result (avoids setState inside useMemo)
    useEffect(() => {
        setExpressionError(filterResult.error)
    }, [filterResult.error])

    const filteredItems = filterResult.items

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
        <div className="flex flex-col gap-6 max-w-full animate-in fade-in duration-300">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <IconSearch className="h-6 w-6 text-primary" />
                    Advanced Search
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Filter Kubernetes resources using expression-based queries or{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">kubectl</code> commands — supports{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">kubectl get pods -n default -l app=web</code>,{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">jsonpath</code>,{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">in</code>,{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">regex</code>,{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">exists()</code>,{' '}
                    <code className="text-xs bg-muted px-1 rounded font-mono">.age</code>{' '}and more. All queries are RBAC-scoped.
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
                        placeholder='e.g. kubectl get pods -n default -l app=web  or  status.phase in ("Pending", "Failed")'
                        className={`pl-9 pr-10 h-12 text-base font-mono transition-all shadow-sm bg-muted/20 ${expressionError
                            ? 'border-destructive ring-1 ring-destructive/30 focus-visible:ring-destructive'
                            : hasExpression
                                ? 'border-primary/50 ring-1 ring-primary/20 bg-background'
                                : 'focus:bg-background hover:bg-muted/30'
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

                {/* kubectl mode indicator */}
                {kubectlParsed.isKubectl && (
                    <div className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 ${
                        kubectlParsed.error
                            ? 'text-destructive bg-destructive/5 border border-destructive/20'
                            : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20'
                    }`}>
                        <IconBolt className="h-3.5 w-3.5 shrink-0" />
                        {kubectlParsed.error ? (
                            <span className="font-mono">{kubectlParsed.error}</span>
                        ) : (
                            <span className="font-mono">
                                kubectl mode — {kubectlParsed.verb} {kubectlParsed.resourceType}
                                {kubectlParsed.namespace ? ` -n ${kubectlParsed.namespace}` : ''}
                                {kubectlParsed.name ? ` ${kubectlParsed.name}` : ''}
                                {kubectlParsed.labelSelector ? ` -l ${kubectlParsed.labelSelector}` : ''}
                                <span className="ml-2 opacity-60">(scoped to your RBAC permissions)</span>
                            </span>
                        )}
                    </div>
                )}

                {/* Expression Error */}
                {!kubectlParsed.isKubectl && expressionError && (
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
// Helpers
// ---------------------------------------------------------------------------
function getAge(timestamp: string): string {
    const diff = Date.now() - new Date(timestamp).getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d`
    return `${Math.floor(days / 30)}mo`
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
        <div className="rounded-xl border border-border/50 overflow-hidden overflow-x-auto shadow-sm">
            <table className="w-full text-sm min-w-[600px]">
                <thead>
                    <tr className="border-b bg-muted/50 backdrop-blur-sm">
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                            Kind
                        </th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                            Name
                        </th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                            Namespace
                        </th>
                        <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground hidden lg:table-cell">
                            Age
                        </th>
                        <th className="w-8 px-4 py-2.5" />
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, i) => {
                        const def = ALL_RESOURCE_DEFS.find((d) => d.type === item.resourceType)
                        const Icon = def?.Icon ?? IconBox
                        const meta = (item.raw as { metadata?: { creationTimestamp?: string } })?.metadata
                        const age = meta?.creationTimestamp ? getAge(meta.creationTimestamp) : ''
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
                                <td className="px-4 py-3 font-mono text-xs font-medium max-w-[300px] truncate">{item.name}</td>
                                <td className="px-4 py-3">
                                    {item.namespace ? (
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            {item.namespace}
                                        </Badge>
                                    ) : (
                                        <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground font-mono hidden lg:table-cell">
                                    {age || '—'}
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

const KUBECTL_EXAMPLES: ExpressionExample[] = [
    {
        label: 'kubectl',
        expression: 'kubectl get pods -n default',
        description: 'List all pods in the default namespace',
        resourceHint: 'pods',
    },
    {
        label: 'kubectl',
        expression: 'kubectl get deploy -A',
        description: 'List all deployments across all namespaces',
        resourceHint: 'deployments',
    },
    {
        label: 'kubectl',
        expression: 'kubectl get pods -l app=nginx -n default',
        description: 'Get pods filtered by label selector',
        resourceHint: 'pods',
    },
    {
        label: 'kubectl',
        expression: 'kubectl get nodes',
        description: 'List all cluster nodes (cluster-scoped)',
        resourceHint: 'nodes',
    },
    {
        label: 'kubectl',
        expression: 'kubectl get svc -n kube-system',
        description: 'List services in kube-system',
        resourceHint: 'services',
    },
    {
        label: 'kubectl',
        expression: 'kubectl get cm -A',
        description: 'List all ConfigMaps across namespaces',
        resourceHint: 'configmaps',
    },
]

function ExamplesPanel({ onApply }: { onApply: (ex: ExpressionExample) => void }) {
    return (
        <div className="flex flex-col gap-6 mt-2">
            {/* kubectl examples */}
            <div>
                <div className="text-center text-sm text-muted-foreground font-medium mb-3 flex items-center justify-center gap-2">
                    <Badge variant="secondary" className="text-xs font-mono">kubectl</Badge>
                    Commands (RBAC-scoped)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {KUBECTL_EXAMPLES.map((ex, i) => (
                        <ExampleCard key={`kubectl-${i}`} example={ex} onApply={onApply} />
                    ))}
                </div>
            </div>

            {/* Expression examples */}
            <div>
                <div className="text-center text-sm text-muted-foreground font-medium mb-3">Expression Examples</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {EXPRESSION_EXAMPLES.map((ex, i) => (
                        <ExampleCard key={i} example={ex} onApply={onApply} />
                    ))}
                </div>
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
            className="text-left rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm hover:bg-accent/40 hover:border-primary/30 hover:shadow-md transition-all duration-200 p-4 group cursor-pointer"
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
