import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import {
    IconBox,
    IconCircles,
    IconCloud,
    IconDatabase,
    IconExternalLink,
    IconLock,
    IconNetwork,
    IconServer,
    IconServer2,
    IconSettings,
    IconDatabaseExport,
    IconRoute,
    IconZoomIn,
    IconZoomOut,
    IconRefresh,
    IconMaximize,
    IconMinimize,
    IconSearch,
    IconX,
    IconPhoto,
} from '@tabler/icons-react'
import { Link, useNavigate } from 'react-router-dom'

import { ResourceType, Role, TopologyLink } from '@/types/api'
import { useRelatedResources } from '@/lib/api'
import { getCRDResourcePath, isStandardK8sResource } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/auth-context'
import { useAppearance } from '@/components/appearance-provider'

interface NodeType {
    id: string
    name: string
    type: ResourceType | string
    namespace?: string
    apiVersion?: string
}

const RESOURCE_ICONS: Record<string, React.ReactNode> = {
    ingress: <IconCloud size={18} />,
    ingresses: <IconCloud size={18} />,
    service: <IconNetwork size={18} />,
    services: <IconNetwork size={18} />,
    deployment: <IconServer size={18} />,
    deployments: <IconServer size={18} />,
    statefulset: <IconDatabase size={18} />,
    statefulsets: <IconDatabase size={18} />,
    daemonset: <IconCircles size={18} />,
    daemonsets: <IconCircles size={18} />,
    pod: <IconBox size={18} />,
    pods: <IconBox size={18} />,
    configmap: <IconSettings size={18} />,
    configmaps: <IconSettings size={18} />,
    secret: <IconLock size={18} />,
    secrets: <IconLock size={18} />,
    persistentvolumeclaim: <IconDatabase size={18} />,
    persistentvolumeclaims: <IconDatabase size={18} />,
    persistentvolume: <IconDatabaseExport size={18} />,
    persistentvolumes: <IconDatabaseExport size={18} />,
    storageclass: <IconRoute size={18} />,
    storageclasses: <IconRoute size={18} />,
    node: <IconServer2 size={18} />,
    nodes: <IconServer2 size={18} />,
    namespace: <IconServer2 size={18} />,
    namespaces: <IconServer2 size={18} />,
}

// Color mapping per resource type for visual differentiation
const RESOURCE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    deployments: { bg: 'bg-blue-500/10 dark:bg-blue-500/20', border: 'border-blue-400/50', text: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' },
    statefulsets: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', border: 'border-indigo-400/50', text: 'text-indigo-600 dark:text-indigo-400', badge: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' },
    daemonsets: { bg: 'bg-purple-500/10 dark:bg-purple-500/20', border: 'border-purple-400/50', text: 'text-purple-600 dark:text-purple-400', badge: 'bg-purple-500/20 text-purple-700 dark:text-purple-300' },
    pods: { bg: 'bg-sky-500/10 dark:bg-sky-500/20', border: 'border-sky-400/50', text: 'text-sky-600 dark:text-sky-400', badge: 'bg-sky-500/20 text-sky-700 dark:text-sky-300' },
    services: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', border: 'border-emerald-400/50', text: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
    ingresses: { bg: 'bg-teal-500/10 dark:bg-teal-500/20', border: 'border-teal-400/50', text: 'text-teal-600 dark:text-teal-400', badge: 'bg-teal-500/20 text-teal-700 dark:text-teal-300' },
    configmaps: { bg: 'bg-yellow-500/10 dark:bg-yellow-500/20', border: 'border-yellow-400/50', text: 'text-yellow-600 dark:text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' },
    secrets: { bg: 'bg-rose-500/10 dark:bg-rose-500/20', border: 'border-rose-400/50', text: 'text-rose-600 dark:text-rose-400', badge: 'bg-rose-500/20 text-rose-700 dark:text-rose-300' },
    persistentvolumeclaims: { bg: 'bg-orange-500/10', border: 'border-orange-400/50', text: 'text-orange-600 dark:text-orange-400', badge: 'bg-orange-500/20 text-orange-700 dark:text-orange-300' },
    persistentvolumes: { bg: 'bg-amber-500/10', border: 'border-amber-400/50', text: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-500/20 text-amber-700' },
    nodes: { bg: 'bg-slate-500/10', border: 'border-slate-400/50', text: 'text-slate-600 dark:text-slate-400', badge: 'bg-slate-500/20 text-slate-700 dark:text-slate-300' },
    namespaces: { bg: 'bg-violet-500/10', border: 'border-violet-400/50', text: 'text-violet-600 dark:text-violet-400', badge: 'bg-violet-500/20 text-violet-700 dark:text-violet-300' },
}

const DEFAULT_COLOR = { bg: 'bg-muted/60', border: 'border-border', text: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' }

const LAYER_ORDER = [
    ['namespaces', 'namespace'],
    ['nodes', 'node'],
    ['ingresses', 'ingress'],
    ['services', 'service'],
    ['deployments', 'deployment', 'statefulsets', 'statefulset', 'daemonsets', 'daemonset'],
    ['pods', 'pod'],
    ['configmaps', 'configmap', 'secrets', 'secret', 'persistentvolumeclaims', 'pvc', 'persistentvolumes', 'pv', 'storageclasses'],
]

interface Position {
    x: number
    y: number
}

export function ResourceTopology({
    resource,
    name,
    namespace,
}: {
    resource: ResourceType
    name: string
    namespace?: string
}) {
    const { data: related, isLoading } = useRelatedResources(resource, name, namespace)
    const [nodePositions, setNodePositions] = useState<Record<string, Position>>({})
    const [zoom, setZoom] = useState(1)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [hoveredNode, setHoveredNode] = useState<string | null>(null)
    const [showLegend, setShowLegend] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [showSearch, setShowSearch] = useState(false)
    const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set())
    const searchInputRef = useRef<HTMLInputElement>(null)
    const dragStartRef = useRef<Position>({ x: 0, y: 0 })
    const containerRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    const rootId = `${resource}:${namespace || ''}:${name}`

    const layers = useMemo(() => {
        if (!related) return []

        const nodes: NodeType[] = [
            { id: rootId, name, type: resource, namespace },
            ...(related.nodes || []).map((r) => ({
                id: `${r.type}:${r.namespace || ''}:${r.name}`,
                name: r.name,
                type: r.type,
                namespace: r.namespace,
                apiVersion: r.apiVersion,
            })),
        ]

        const result: NodeType[][] = LAYER_ORDER.map(() => [])

        nodes.forEach(node => {
            const type = node.type.toLowerCase()
            const layerIdx = LAYER_ORDER.findIndex(layer => layer.includes(type))
            if (layerIdx !== -1) {
                result[layerIdx].push(node)
            } else {
                result[2].push(node)
            }
        })

        return result.filter(layer => layer.length > 0)
    }, [related, name, resource, namespace, rootId])

    const updatePositions = useCallback(() => {
        if (!contentRef.current || !containerRef.current) return
        const contentRect = contentRef.current.getBoundingClientRect()
        const newPositions: Record<string, Position> = {}

        layers.flat().forEach(node => {
            const element = document.getElementById(node.id)
            if (element) {
                const rect = element.getBoundingClientRect()
                newPositions[node.id] = {
                    x: (rect.left - contentRect.left + rect.width / 2) / zoom,
                    y: (rect.top - contentRect.top + rect.height / 2) / zoom,
                }
            }
        })

        setNodePositions(newPositions)
    }, [layers, zoom])

    useEffect(() => {
        const timeout = setTimeout(updatePositions, 150)
        window.addEventListener('resize', updatePositions)
        return () => {
            clearTimeout(timeout)
            window.removeEventListener('resize', updatePositions)
        }
    }, [updatePositions])

    // Update search highlights
    useEffect(() => {
        if (!searchQuery.trim()) {
            setHighlightedNodes(new Set())
            return
        }
        const q = searchQuery.toLowerCase()
        const matched = new Set<string>()
        layers.flat().forEach(node => {
            if (node.name.toLowerCase().includes(q) || node.type.toLowerCase().includes(q)) {
                matched.add(node.id)
            }
        })
        setHighlightedNodes(matched)
    }, [searchQuery, layers])

    // Focus search input when opened
    useEffect(() => {
        if (showSearch) {
            setTimeout(() => searchInputRef.current?.focus(), 50)
        }
    }, [showSearch])

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const delta = e.deltaY > 0 ? 0.9 : 1.1
            setZoom(prev => Math.min(Math.max(prev * delta, 0.2), 3))
        }
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button === 0) {
            setIsDragging(true)
            dragStartRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
        }
    }, [offset])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (isDragging) {
            setOffset({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            })
        }
    }, [isDragging])

    const handleMouseUp = useCallback(() => setIsDragging(false), [])
    const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 3))
    const handleZoomOut = () => setZoom(prev => Math.max(prev * 0.8, 0.2))
    const handleReset = () => { setZoom(1); setOffset({ x: 0, y: 0 }) }

    // Compute which nodes are connected to the hovered node
    const connectedNodes = useMemo(() => {
        if (!hoveredNode || !related?.links) return new Set<string>()
        const connected = new Set<string>()
        connected.add(hoveredNode)
        related.links.forEach(link => {
            if (link.source === hoveredNode) connected.add(link.target)
            if (link.target === hoveredNode) connected.add(link.source)
        })
        return connected
    }, [hoveredNode, related?.links])

    // Unique resource types for legend
    const uniqueTypes = useMemo(() => {
        if (!related) return []
        const types = new Set<string>()
        types.add(resource)
        related.nodes?.forEach(n => types.add(n.type.toLowerCase()))
        return Array.from(types)
    }, [related, resource])

    const totalNodes = (related?.nodes?.length || 0) + 1

    const { actualTheme } = useAppearance()

    // Export topology as image (SVG or PNG based on format param)
    const handleExportImage = useCallback(async (format: 'svg' | 'png' = 'png') => {
        if (!contentRef.current) return
        try {
            const el = contentRef.current
            const rect = el.getBoundingClientRect()
            const bgColor = actualTheme === 'dark' ? '#0f172a' : '#f8fafc'
            const fgColor = actualTheme === 'dark' ? '#e2e8f0' : '#1e293b'
            const dateStr = new Date().toISOString().slice(0, 10)

            if (format === 'png') {
                // Direct canvas rendering — avoids foreignObject CORS issues entirely
                const scale = 2
                const canvas = document.createElement('canvas')
                canvas.width = rect.width * scale
                canvas.height = rect.height * scale
                const ctx = canvas.getContext('2d')
                if (!ctx) return

                ctx.scale(scale, scale)

                // Background
                ctx.fillStyle = bgColor
                ctx.fillRect(0, 0, rect.width, rect.height)

                // Render SVG lines first
                const svgEl = el.querySelector('svg')
                if (svgEl) {
                    const svgClone = svgEl.cloneNode(true) as SVGSVGElement
                    svgClone.setAttribute('width', String(rect.width))
                    svgClone.setAttribute('height', String(rect.height))
                    // Inline styles for standalone rendering
                    svgClone.querySelectorAll('[class*="fill-"]').forEach(node => {
                        const computed = getComputedStyle(node as Element)
                        ;(node as SVGElement).style.fill = computed.fill
                    })
                    svgClone.querySelectorAll('[class*="text-"]').forEach(node => {
                        const computed = getComputedStyle(node as Element)
                        ;(node as SVGElement).style.stroke = computed.color
                    })
                    const svgData = new XMLSerializer().serializeToString(svgClone)
                    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
                    const svgUrl = URL.createObjectURL(svgBlob)

                    await new Promise<void>((resolve) => {
                        const img = new Image()
                        img.onload = () => {
                            ctx.drawImage(img, 0, 0, rect.width, rect.height)
                            URL.revokeObjectURL(svgUrl)
                            resolve()
                        }
                        img.onerror = () => {
                            URL.revokeObjectURL(svgUrl)
                            resolve()
                        }
                        img.src = svgUrl
                    })
                }

                // Render each node card onto the canvas
                const nodes = el.querySelectorAll('[id]')
                const contentRect = el.getBoundingClientRect()
                nodes.forEach(node => {
                    const nodeEl = node as HTMLElement
                    if (!nodeEl.className || typeof nodeEl.className !== 'string') return
                    if (!nodeEl.className.includes('rounded-xl')) return

                    const nodeRect = nodeEl.getBoundingClientRect()
                    const x = nodeRect.left - contentRect.left
                    const y = nodeRect.top - contentRect.top
                    const w = nodeRect.width
                    const h = nodeRect.height

                    const computed = getComputedStyle(nodeEl)
                    const isRoot = nodeEl.className.includes('bg-primary')

                    // Node background
                    ctx.fillStyle = isRoot ? (actualTheme === 'dark' ? '#3b82f6' : '#2563eb') : (actualTheme === 'dark' ? '#1e293b' : '#ffffff')
                    ctx.strokeStyle = isRoot ? 'transparent' : (actualTheme === 'dark' ? '#475569' : '#cbd5e1')
                    ctx.lineWidth = 2

                    // Rounded rectangle
                    const radius = 12
                    ctx.beginPath()
                    ctx.moveTo(x + radius, y)
                    ctx.lineTo(x + w - radius, y)
                    ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
                    ctx.lineTo(x + w, y + h - radius)
                    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
                    ctx.lineTo(x + radius, y + h)
                    ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
                    ctx.lineTo(x, y + radius)
                    ctx.quadraticCurveTo(x, y, x + radius, y)
                    ctx.closePath()
                    ctx.fill()
                    if (!isRoot) ctx.stroke()

                    // Shadow for root
                    if (isRoot) {
                        ctx.shadowColor = 'rgba(59, 130, 246, 0.25)'
                        ctx.shadowBlur = 12
                        ctx.fill()
                        ctx.shadowColor = 'transparent'
                        ctx.shadowBlur = 0
                    }

                    // Node name text
                    const nameEl = nodeEl.querySelector('.truncate')
                    if (nameEl) {
                        ctx.fillStyle = isRoot ? '#ffffff' : (actualTheme === 'dark' ? '#e2e8f0' : '#1e293b')
                        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
                        ctx.textAlign = 'center'
                        const text = nameEl.textContent || ''
                        const maxWidth = w - 16
                        let displayText = text
                        while (ctx.measureText(displayText).width > maxWidth && displayText.length > 3) {
                            displayText = displayText.slice(0, -4) + '...'
                        }
                        ctx.fillText(displayText, x + w / 2, y + h / 2 + 2)
                    }

                    // Type badge text
                    const badgeEl = nodeEl.querySelector('.uppercase')
                    if (badgeEl) {
                        ctx.fillStyle = isRoot ? 'rgba(255,255,255,0.7)' : (actualTheme === 'dark' ? '#94a3b8' : '#64748b')
                        ctx.font = 'bold 8px system-ui, -apple-system, sans-serif'
                        ctx.textAlign = 'center'
                        ctx.fillText((badgeEl.textContent || '').toUpperCase(), x + w / 2, y + h / 2 + 16)
                    }
                })

                // Watermark
                ctx.fillStyle = actualTheme === 'dark' ? 'rgba(148,163,184,0.3)' : 'rgba(100,116,139,0.2)'
                ctx.font = '10px system-ui, -apple-system, sans-serif'
                ctx.textAlign = 'right'
                ctx.fillText(`Kites Topology — ${name} — ${dateStr}`, rect.width - 12, rect.height - 8)

                // Export as PNG blob
                canvas.toBlob((blob) => {
                    if (!blob) return
                    const pngUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = pngUrl
                    a.download = `topology-${name}-${actualTheme}-${dateStr}.png`
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(pngUrl)
                }, 'image/png')
                return
            }

            // SVG export via foreignObject (used as fallback and explicit SVG export)
            const styles = Array.from(document.styleSheets)
                .map(sheet => {
                    try { return Array.from(sheet.cssRules).map(r => r.cssText).join('\n') }
                    catch { return '' }
                })
                .join('\n')

            const svgData = `
                <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
                    <style>${styles}</style>
                    <rect width="100%" height="100%" fill="${bgColor}" />
                    <foreignObject width="100%" height="100%">
                        <div xmlns="http://www.w3.org/1999/xhtml"
                             style="color: ${fgColor}; font-family: system-ui, sans-serif;"
                             class="${actualTheme === 'dark' ? 'dark' : ''}">
                            ${el.outerHTML}
                        </div>
                    </foreignObject>
                </svg>
            `

            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
            const svgUrl = URL.createObjectURL(svgBlob)
            const a = document.createElement('a')
            a.href = svgUrl
            a.download = `topology-${name}-${dateStr}.svg`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(svgUrl)
        } catch (err) {
            console.error('Failed to export topology:', err)
        }
    }, [name, actualTheme])

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Building topology graph...</p>
            </div>
        )
    }

    if (!related || totalNodes <= 1) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
                <div className="rounded-full bg-muted/50 p-4">
                    <IconServer2 size={32} className="text-muted-foreground/50" />
                </div>
                <div>
                    <p className="font-medium text-foreground">No related resources found</p>
                    <p className="text-sm text-muted-foreground mt-1">
                        This {resource} doesn't have discoverable related resources yet.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <Card className={`overflow-hidden bg-dot-pattern bg-slate-50/50 dark:bg-slate-950/50 border relative ${isFullscreen ? 'fixed inset-4 z-50' : ''}`}>
            {/* Toolbar */}
            <div className="absolute top-3 left-3 z-50 flex flex-col gap-1.5">
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleZoomIn} title="Zoom In">
                    <IconZoomIn size={15} />
                </Button>
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleZoomOut} title="Zoom Out">
                    <IconZoomOut size={15} />
                </Button>
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={handleReset} title="Reset View">
                    <IconRefresh size={15} />
                </Button>
                <Button
                    variant={showSearch ? "default" : "secondary"}
                    size="icon"
                    className="h-8 w-8 shadow-md"
                    onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery('') }}
                    title="Search nodes"
                >
                    <IconSearch size={15} />
                </Button>
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={() => setIsFullscreen(f => !f)} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
                    {isFullscreen ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
                </Button>
                <div className="h-px w-6 bg-border/50 self-center" />
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-md" onClick={() => handleExportImage('png')} title="Export as PNG">
                    <IconPhoto size={15} />
                </Button>
            </div>

            {/* Search bar */}
            {showSearch && (
                <div className="absolute top-3 left-14 z-50 flex items-center gap-1 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg px-2 py-1">
                    <IconSearch size={13} className="text-muted-foreground shrink-0" />
                    <input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search by name or type…"
                        className="bg-transparent text-xs outline-none w-44 placeholder:text-muted-foreground/50"
                    />
                    {searchQuery && (
                        <>
                            <span className="text-[10px] text-muted-foreground font-medium">
                                {highlightedNodes.size} match{highlightedNodes.size !== 1 ? 'es' : ''}
                            </span>
                            <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
                                <IconX size={12} />
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Stats badge + Legend toggle + Export options */}
            <div className="absolute top-3 right-3 z-50 flex flex-col items-end gap-1.5">
                <Badge variant="secondary" className="text-xs shadow-md">
                    {totalNodes} resource{totalNodes !== 1 ? 's' : ''} · {related?.links?.length || 0} link{(related?.links?.length || 0) !== 1 ? 's' : ''}
                </Badge>
                <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" className="h-7 text-xs shadow-md px-2" onClick={() => handleExportImage('png')} title="Export PNG">
                        PNG
                    </Button>
                    <Button variant="secondary" size="sm" className="h-7 text-xs shadow-md px-2" onClick={() => handleExportImage('svg')} title="Export SVG">
                        SVG
                    </Button>
                </div>
                <Button variant="secondary" size="sm" className="h-7 text-xs shadow-md px-2" onClick={() => setShowLegend(l => !l)}>
                    {showLegend ? 'Hide' : 'Show'} Legend
                </Button>
                {showLegend && (
                    <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 min-w-[140px]">
                        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Resource Types</div>
                        <div className="flex flex-col gap-1.5">
                            {uniqueTypes.map(type => {
                                const colors = RESOURCE_COLORS[type] || DEFAULT_COLOR
                                return (
                                    <div key={type} className="flex items-center gap-2">
                                        <div className={`w-3 h-3 rounded-sm border ${colors.border} ${colors.bg}`} />
                                        <span className="text-xs capitalize">{type.replace(/s$/, '')}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Zoom level indicator */}
            <div className="absolute bottom-3 left-3 z-50">
                <Badge variant="outline" className="text-xs font-mono opacity-60">
                    {Math.round(zoom * 100)}%
                </Badge>
            </div>

            <CardContent
                className={`p-0 relative ${isFullscreen ? 'h-full' : 'min-h-[520px]'} cursor-grab active:cursor-grabbing overflow-hidden`}
                ref={containerRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <div
                    ref={contentRef}
                    className="absolute inset-0"
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                        transformOrigin: '50% 50%',
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                    }}
                >
                    <div className="p-10 min-w-full min-h-full inline-block">
                        {/* Connection Lines */}
                        {related && <TopologyLines links={related.links || []} positions={nodePositions} hoveredNode={hoveredNode} connectedNodes={connectedNodes} />}

                        {/* Layered nodes */}
                        <div className="flex flex-col items-center justify-start gap-12 relative z-10">
                            {layers.map((layer, lIdx) => (
                                <div key={`layer-${lIdx}`} className="flex justify-center gap-6 flex-wrap w-full">
                                    {layer.map((node) => {
                                        const isSearchMatch = highlightedNodes.size > 0 && highlightedNodes.has(node.id)
                                        const isSearchDimmed = highlightedNodes.size > 0 && !highlightedNodes.has(node.id)
                                        return (
                                        <TopologyNode
                                            key={node.id}
                                            id={node.id}
                                            node={node}
                                            isRoot={node.id === rootId}
                                            isHighlighted={hoveredNode ? connectedNodes.has(node.id) : (highlightedNodes.size === 0 || isSearchMatch)}
                                            isDimmed={(hoveredNode !== null && !connectedNodes.has(node.id)) || isSearchDimmed}
                                            isSearchMatch={isSearchMatch}
                                            onHover={setHoveredNode}
                                        />
                                        )
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </CardContent>

            {/* Hint text */}
            <div className="absolute bottom-3 right-3 z-50 text-[10px] text-muted-foreground/50 hidden md:block">
                Scroll + Ctrl to zoom · Drag to pan · Click to open overview · Hover for connections
            </div>
        </Card>
    )
}

function TopologyNode({ id, node, isRoot, isHighlighted, isDimmed, isSearchMatch, onHover }: {
    id: string
    node: NodeType
    isRoot: boolean
    isHighlighted?: boolean
    isDimmed?: boolean
    isSearchMatch?: boolean
    onHover?: (id: string | null) => void
}) {
    const { user } = useAuth()
    const navigate = useNavigate()
    const path = useMemo(() => {
        if (isStandardK8sResource(node.type as ResourceType)) {
            return `/${node.type}/${node.namespace ? `${node.namespace}/` : ''}${node.name}`
        }
        return getCRDResourcePath(node.type, node.apiVersion!, node.namespace, node.name)
    }, [node])

    const hasPermission = useMemo(() => {
        if (!user) return false
        if (user.isAdmin()) return true

        return user.roles?.some((role: Role) => {
            const hasResource = role.name === 'admin' || role.name === 'viewer' ||
                role.resources?.some((r: string) => r === '*' || r === node.type || r === node.type.toLowerCase())
            const hasVerb = role.name === 'admin' || role.name === 'viewer' ||
                role.verbs?.some((v: string) => v === '*' || v === 'get' || v === 'list')
            const hasNamespace = !node.namespace || role.namespaces?.includes(node.namespace) || role.namespaces?.includes('*')

            return hasResource && hasVerb && hasNamespace
        }) || false
    }, [user, node])

    // Navigate to the resource's overview page on click
    const handleNodeClick = useCallback(() => {
        if (hasPermission) {
            navigate(path)
        }
    }, [hasPermission, navigate, path])

    const colors = RESOURCE_COLORS[node.type.toLowerCase()] || DEFAULT_COLOR

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        id={id}
                        onClick={handleNodeClick}
                        onMouseEnter={() => onHover?.(id)}
                        onMouseLeave={() => onHover?.(null)}
                        className={`
                            relative flex flex-col items-center p-3 pt-4 rounded-xl border-2 transition-all duration-200 group z-20 min-w-[110px] max-w-[130px] select-none
                            ${hasPermission ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}
                            ${isRoot
                                ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/25 scale-110 ring-4 ring-primary/20'
                                : `${colors.bg} ${colors.border} hover:shadow-lg hover:border-primary/50 hover:scale-105 bg-background dark:bg-card`
                            }
                            ${isDimmed ? 'opacity-25 scale-95' : ''}
                            ${isHighlighted && !isRoot && !isDimmed ? 'ring-2 ring-primary/30' : ''}
                            ${isSearchMatch ? 'ring-2 ring-amber-400/80 border-amber-400/60 shadow-amber-400/20 shadow-md' : ''}
                        `}
                    >
                        {/* Icon */}
                        <div className={`mb-2 ${isRoot ? 'text-primary-foreground' : colors.text}`}>
                            {RESOURCE_ICONS[node.type.toLowerCase()] || <IconBox size={18} />}
                        </div>

                        {/* Name */}
                        <div className={`text-xs font-semibold truncate max-w-[100px] text-center leading-tight ${isRoot ? 'text-primary-foreground' : 'text-foreground'}`}>
                            {node.name}
                        </div>

                        {/* Type badge */}
                        <div className={`mt-1.5 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full ${isRoot ? 'bg-white/20 text-primary-foreground' : colors.badge}`}>
                            {node.type.replace(/s$/, '')}
                        </div>

                        {/* Namespace chip */}
                        {node.namespace && !isRoot && (
                            <div className="mt-1 text-[8px] text-muted-foreground/60 font-mono truncate max-w-[100px]">
                                {node.namespace}
                            </div>
                        )}

                        {/* External link / Open in new tab */}
                        {!isRoot && hasPermission && (
                            <Link
                                to={withSubPath(path)}
                                className="absolute -top-3 -right-3 opacity-0 group-hover:opacity-100 transition-all duration-200 bg-primary/90 hover:bg-primary text-primary-foreground rounded-full p-1.5 shadow-md hover:scale-110 z-50 flex items-center justify-center"
                                onClick={(e) => e.stopPropagation()}
                                title={`Open ${node.type} overview`}
                            >
                                <IconExternalLink size={12} strokeWidth={2.5} />
                            </Link>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px]">
                    <p className="text-xs font-semibold">{node.name}</p>
                    <p className="text-[10px] opacity-70">{node.type.replace(/s$/, '')} · {node.namespace || 'Cluster Scoped'}</p>
                    {hasPermission ? (
                        <p className="text-[10px] text-primary mt-1">Click to open overview · Hover for connections</p>
                    ) : (
                        <p className="text-[10px] text-destructive mt-1">No permission to view</p>
                    )}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

function TopologyLines({ links, positions, hoveredNode, connectedNodes }: {
    links: TopologyLink[]
    positions: Record<string, Position>
    hoveredNode: string | null
    connectedNodes: Set<string>
}) {
    const connections = useMemo(() => {
        const lines: { x1: number, y1: number, x2: number, y2: number, label?: string, isCurved: boolean, source: string, target: string }[] = []

        links.forEach(link => {
            const pos1 = positions[link.source]
            const pos2 = positions[link.target]

            if (pos1 && pos2) {
                lines.push({
                    x1: pos1.x,
                    y1: pos1.y,
                    x2: pos2.x,
                    y2: pos2.y,
                    label: link.label,
                    isCurved: Math.abs(pos1.x - pos2.x) > 50,
                    source: link.source,
                    target: link.target,
                })
            }
        })
        return lines
    }, [links, positions])

    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-0">
            <defs>
                <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                >
                    <polygon points="0 0, 8 3, 0 6" className="fill-blue-500/40" />
                </marker>
                <marker
                    id="arrowhead-highlight"
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                >
                    <polygon points="0 0, 8 3, 0 6" className="fill-blue-500" />
                </marker>
                {/* Animated flow dot for highlighted connections */}
                <circle id="flow-dot" r="3" className="fill-primary" />
            </defs>
            {connections.map((line, idx) => {
                const mx = (line.x1 + line.x2) / 2
                const my = (line.y1 + line.y2) / 2
                const pathD = line.isCurved
                    ? `M ${line.x1} ${line.y1} Q ${mx} ${line.y1} ${line.x2} ${line.y2}`
                    : `M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`

                const isHighlighted = hoveredNode !== null &&
                    connectedNodes.has(line.source) && connectedNodes.has(line.target)
                const isDimmed = hoveredNode !== null && !isHighlighted

                return (
                    <g key={idx} style={{ opacity: isDimmed ? 0.1 : 1, transition: 'opacity 0.2s ease' }}>
                        <path
                            d={pathD}
                            stroke="currentColor"
                            strokeWidth={isHighlighted ? 2.5 : 1.5}
                            fill="none"
                            className={isHighlighted ? 'text-primary' : 'text-blue-500/25'}
                            markerEnd={isHighlighted ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)'}
                            strokeDasharray="none"
                            style={{ transition: 'all 0.2s ease' }}
                        />
                        {/* Animated flow indicator on highlighted lines */}
                        {isHighlighted && (
                            <>
                                <path id={`path-${idx}`} d={pathD} fill="none" stroke="none" />
                                <circle r="3" className="fill-primary">
                                    <animateMotion dur="2s" repeatCount="indefinite" path={pathD} />
                                </circle>
                            </>
                        )}
                        {line.label && (
                            <text
                                x={mx}
                                y={my - 6}
                                textAnchor="middle"
                                className={`text-[9px] font-medium pointer-events-none ${isHighlighted ? 'fill-primary' : 'fill-muted-foreground/50'}`}
                            >
                                {line.label}
                            </text>
                        )}
                    </g>
                )
            })}
        </svg>
    )
}
