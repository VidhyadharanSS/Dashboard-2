/**
 * Feature: Resource Comparison Tool
 *
 * Allows users to select two resources of the same type and compare their YAML
 * side-by-side. Very useful for debugging configuration differences between
 * environments, replicas, or versions.
 *
 * Usage:
 *  - Open via Ctrl+Shift+C or from the Quick Actions widget
 *  - Select resource type, then pick two resources
 *  - View side-by-side YAML with diff highlighting
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    IconArrowsExchange,
    IconCode,
    IconCopy,
    IconCheck,
    IconLoader2,
} from '@tabler/icons-react'
import * as yaml from 'js-yaml'
import { toast } from 'sonner'

import { fetchResource, useResources } from '@/lib/api'
import { ResourceType, ResourceTypeMap } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

const COMPARABLE_TYPES: { value: ResourceType; label: string }[] = [
    { value: 'deployments', label: 'Deployments' },
    { value: 'statefulsets', label: 'StatefulSets' },
    { value: 'daemonsets', label: 'DaemonSets' },
    { value: 'services', label: 'Services' },
    { value: 'configmaps', label: 'ConfigMaps' },
    { value: 'secrets', label: 'Secrets' },
    { value: 'pods', label: 'Pods' },
    { value: 'ingresses', label: 'Ingresses' },
    { value: 'cronjobs', label: 'CronJobs' },
    { value: 'jobs', label: 'Jobs' },
]

interface ResourceCompareDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

/* ─── YAML Diff Line Component ─── */
function DiffView({ left, right }: { left: string; right: string }) {
    const leftLines = left.split('\n')
    const rightLines = right.split('\n')
    const maxLines = Math.max(leftLines.length, rightLines.length)

    // Simple line-by-line diff highlighting
    const lines = useMemo(() => {
        const result: { left: string; right: string; type: 'same' | 'changed' | 'added' | 'removed' }[] = []

        for (let i = 0; i < maxLines; i++) {
            const l = leftLines[i] ?? ''
            const r = rightLines[i] ?? ''

            if (l === r) {
                result.push({ left: l, right: r, type: 'same' })
            } else if (!l && r) {
                result.push({ left: '', right: r, type: 'added' })
            } else if (l && !r) {
                result.push({ left: l, right: '', type: 'removed' })
            } else {
                result.push({ left: l, right: r, type: 'changed' })
            }
        }
        return result
    }, [leftLines, rightLines, maxLines])

    const diffCount = lines.filter(l => l.type !== 'same').length

    return (
        <div className="flex flex-col h-full">
            <div className="px-3 py-1.5 border-b bg-muted/30 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-medium text-muted-foreground">
                    Side-by-side comparison
                </span>
                <Badge variant={diffCount > 0 ? 'destructive' : 'secondary'} className="text-[10px] h-5">
                    {diffCount} difference{diffCount !== 1 ? 's' : ''}
                </Badge>
            </div>
            <div className="flex-1 overflow-auto">
                <div className="grid grid-cols-2 divide-x text-[11px] font-mono leading-relaxed">
                    {/* Left side */}
                    <div>
                        {lines.map((line, i) => (
                            <div
                                key={`l-${i}`}
                                className={`flex min-h-[20px] ${
                                    line.type === 'changed' ? 'bg-amber-500/10' :
                                    line.type === 'removed' ? 'bg-red-500/10' :
                                    line.type === 'added' ? 'bg-muted/20' :
                                    ''
                                }`}
                            >
                                <span className="w-8 text-right pr-2 text-muted-foreground/50 select-none shrink-0 border-r border-border/30">
                                    {i + 1}
                                </span>
                                <pre className="pl-2 whitespace-pre-wrap break-all flex-1">
                                    {line.left || ' '}
                                </pre>
                            </div>
                        ))}
                    </div>
                    {/* Right side */}
                    <div>
                        {lines.map((line, i) => (
                            <div
                                key={`r-${i}`}
                                className={`flex min-h-[20px] ${
                                    line.type === 'changed' ? 'bg-amber-500/10' :
                                    line.type === 'added' ? 'bg-emerald-500/10' :
                                    line.type === 'removed' ? 'bg-muted/20' :
                                    ''
                                }`}
                            >
                                <span className="w-8 text-right pr-2 text-muted-foreground/50 select-none shrink-0 border-r border-border/30">
                                    {i + 1}
                                </span>
                                <pre className="pl-2 whitespace-pre-wrap break-all flex-1">
                                    {line.right || ' '}
                                </pre>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

export function ResourceCompareDialog({ open, onOpenChange }: ResourceCompareDialogProps) {
    const [resourceType, setResourceType] = useState<ResourceType>('deployments')
    const [resource1, setResource1] = useState<string>('')
    const [resource2, setResource2] = useState<string>('')
    const [yaml1, setYaml1] = useState<string>('')
    const [yaml2, setYaml2] = useState<string>('')
    const [loading, setLoading] = useState(false)
    const [compared, setCompared] = useState(false)
    const [copiedSide, setCopiedSide] = useState<'left' | 'right' | null>(null)

    // Fetch resources list
    const { data: resources, isLoading: loadingList } = useResources(resourceType, undefined, {
        disable: !open,
        reduce: true,
    })

    const resourceList = useMemo(() => {
        if (!resources) return []
        return (resources as any[]).map((r: any) => ({
            key: `${r.metadata?.namespace || '_all'}/${r.metadata?.name}`,
            name: r.metadata?.name || '',
            namespace: r.metadata?.namespace || '',
        })).sort((a: any, b: any) => a.key.localeCompare(b.key))
    }, [resources])

    // Reset selections when type changes
    useEffect(() => {
        setResource1('')
        setResource2('')
        setYaml1('')
        setYaml2('')
        setCompared(false)
    }, [resourceType])

    // Reset when dialog closes
    useEffect(() => {
        if (!open) {
            setCompared(false)
            setYaml1('')
            setYaml2('')
        }
    }, [open])

    const handleCompare = useCallback(async () => {
        if (!resource1 || !resource2) return

        setLoading(true)
        setCompared(false)
        try {
            const [ns1, name1] = resource1.split('/')
            const [ns2, name2] = resource2.split('/')

            const [r1, r2] = await Promise.all([
                fetchResource<ResourceTypeMap[typeof resourceType]>(resourceType, name1, ns1 || undefined),
                fetchResource<ResourceTypeMap[typeof resourceType]>(resourceType, name2, ns2 || undefined),
            ])

            // Clean up metadata noise for better comparison
            const clean = (obj: any) => {
                const copy = JSON.parse(JSON.stringify(obj))
                if (copy.metadata) {
                    delete copy.metadata.uid
                    delete copy.metadata.resourceVersion
                    delete copy.metadata.creationTimestamp
                    delete copy.metadata.generation
                    delete copy.metadata.managedFields
                }
                if (copy.status) {
                    delete copy.status  // Remove status for cleaner comparison
                }
                return copy
            }

            setYaml1(yaml.dump(clean(r1), { lineWidth: 120 }))
            setYaml2(yaml.dump(clean(r2), { lineWidth: 120 }))
            setCompared(true)
        } catch (err) {
            toast.error('Failed to fetch resources for comparison')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }, [resource1, resource2, resourceType])

    const handleCopy = useCallback(async (side: 'left' | 'right') => {
        const text = side === 'left' ? yaml1 : yaml2
        await navigator.clipboard.writeText(text)
        setCopiedSide(side)
        setTimeout(() => setCopiedSide(null), 2000)
        toast.success('Copied to clipboard')
    }, [yaml1, yaml2])

    // Register keyboard shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
                // Don't hijack if input focused
                const el = document.activeElement
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
                e.preventDefault()
                onOpenChange(!open)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, onOpenChange])

    const res1Name = resource1 ? resource1.split('/').pop() : ''
    const res2Name = resource2 ? resource2.split('/').pop() : ''

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col p-0">
                <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                        <IconArrowsExchange className="h-4 w-4" />
                        Compare Resources
                    </DialogTitle>
                </DialogHeader>

                {/* Selector bar */}
                <div className="px-6 py-3 border-b bg-muted/20 shrink-0">
                    <div className="flex items-center gap-3">
                        {/* Resource type */}
                        <Select value={resourceType} onValueChange={(v) => setResourceType(v as ResourceType)}>
                            <SelectTrigger className="w-40 h-9 text-xs">
                                <SelectValue placeholder="Type" />
                            </SelectTrigger>
                            <SelectContent>
                                {COMPARABLE_TYPES.map(t => (
                                    <SelectItem key={t.value} value={t.value} className="text-xs">
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Resource A */}
                        <div className="flex-1">
                            <Select value={resource1} onValueChange={setResource1}>
                                <SelectTrigger className="h-9 text-xs">
                                    <SelectValue placeholder="Select resource A..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {loadingList ? (
                                        <SelectItem value="__loading" disabled className="text-xs">
                                            Loading...
                                        </SelectItem>
                                    ) : resourceList.length === 0 ? (
                                        <SelectItem value="__empty" disabled className="text-xs">
                                            No resources found
                                        </SelectItem>
                                    ) : (
                                        resourceList.map((r: any) => (
                                            <SelectItem
                                                key={r.key}
                                                value={r.key}
                                                disabled={r.key === resource2}
                                                className="text-xs"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{r.name}</span>
                                                    {r.namespace && (
                                                        <span className="text-muted-foreground text-[10px]">{r.namespace}</span>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        <IconArrowsExchange className="h-4 w-4 text-muted-foreground shrink-0" />

                        {/* Resource B */}
                        <div className="flex-1">
                            <Select value={resource2} onValueChange={setResource2}>
                                <SelectTrigger className="h-9 text-xs">
                                    <SelectValue placeholder="Select resource B..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {loadingList ? (
                                        <SelectItem value="__loading" disabled className="text-xs">
                                            Loading...
                                        </SelectItem>
                                    ) : resourceList.length === 0 ? (
                                        <SelectItem value="__empty" disabled className="text-xs">
                                            No resources found
                                        </SelectItem>
                                    ) : (
                                        resourceList.map((r: any) => (
                                            <SelectItem
                                                key={r.key}
                                                value={r.key}
                                                disabled={r.key === resource1}
                                                className="text-xs"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{r.name}</span>
                                                    {r.namespace && (
                                                        <span className="text-muted-foreground text-[10px]">{r.namespace}</span>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        <Button
                            size="sm"
                            onClick={handleCompare}
                            disabled={!resource1 || !resource2 || resource1 === resource2 || loading}
                            className="h-9 px-4"
                        >
                            {loading ? (
                                <IconLoader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <IconCode className="h-4 w-4 mr-1.5" />
                                    Compare
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Diff view */}
                <div className="flex-1 overflow-hidden">
                    {!compared ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-16">
                            <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center">
                                <IconArrowsExchange className="h-8 w-8 opacity-30" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium">Select two resources to compare</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Choose the same resource type, pick two instances, and click Compare
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col">
                            {/* Column headers */}
                            <div className="grid grid-cols-2 divide-x border-b shrink-0">
                                <div className="px-3 py-2 flex items-center justify-between bg-red-500/5">
                                    <div className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full bg-red-500" />
                                        <span className="text-xs font-semibold text-foreground/80 truncate">
                                            {res1Name}
                                        </span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => handleCopy('left')}
                                    >
                                        {copiedSide === 'left' ? (
                                            <IconCheck className="h-3 w-3 text-emerald-500" />
                                        ) : (
                                            <IconCopy className="h-3 w-3" />
                                        )}
                                    </Button>
                                </div>
                                <div className="px-3 py-2 flex items-center justify-between bg-emerald-500/5">
                                    <div className="flex items-center gap-2">
                                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                        <span className="text-xs font-semibold text-foreground/80 truncate">
                                            {res2Name}
                                        </span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => handleCopy('right')}
                                    >
                                        {copiedSide === 'right' ? (
                                            <IconCheck className="h-3 w-3 text-emerald-500" />
                                        ) : (
                                            <IconCopy className="h-3 w-3" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                            {/* Diff content */}
                            <div className="flex-1 overflow-auto">
                                <DiffView left={yaml1} right={yaml2} />
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
