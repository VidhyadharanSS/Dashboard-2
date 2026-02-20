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
} from '@tabler/icons-react'
import { Link } from 'react-router-dom'

import { ResourceType, Role, TopologyLink } from '@/types/api'
import { useRelatedResources } from '@/lib/api'
import { getCRDResourcePath, isStandardK8sResource } from '@/lib/k8s'
import { withSubPath } from '@/lib/subpath'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { QuickYamlDialog } from './quick-yaml-dialog'
import { useAuth } from '@/contexts/auth-context'

interface NodeType {
    id: string
    name: string
    type: ResourceType | string
    namespace?: string
    apiVersion?: string
}

const RESOURCE_ICONS: Record<string, React.ReactNode> = {
    ingress: <IconCloud size={20} />,
    ingresses: <IconCloud size={20} />,
    service: <IconNetwork size={20} />,
    services: <IconNetwork size={20} />,
    deployment: <IconServer size={20} />,
    deployments: <IconServer size={20} />,
    statefulset: <IconDatabase size={20} />,
    statefulsets: <IconDatabase size={20} />,
    daemonset: <IconCircles size={20} />,
    daemonsets: <IconCircles size={20} />,
    pod: <IconBox size={20} />,
    pods: <IconBox size={20} />,
    configmap: <IconSettings size={20} />,
    configmaps: <IconSettings size={20} />,
    secret: <IconLock size={20} />,
    secrets: <IconLock size={20} />,
    persistentvolumeclaim: <IconDatabase size={20} />,
    persistentvolumeclaims: <IconDatabase size={20} />,
    persistentvolume: <IconDatabaseExport size={20} />,
    persistentvolumes: <IconDatabaseExport size={20} />,
    storageclass: <IconRoute size={20} />,
    storageclasses: <IconRoute size={20} />,
    node: <IconServer2 size={20} />,
    nodes: <IconServer2 size={20} />,
}

const LAYER_ORDER = [
    ['ingresses', 'ingress'],
    ['services', 'service'],
    ['deployments', 'deployment', 'statefulsets', 'statefulset', 'daemonsets', 'daemonset'],
    ['pods', 'pod'],
    ['configmaps', 'configmap', 'secrets', 'secret', 'persistentvolumeclaims', 'pvc', 'persistentvolumes', 'pv', 'storageclasses', 'node', 'nodes'],
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
    const dragStartRef = useRef<Position>({ x: 0, y: 0 })
    const containerRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)

    const layers = useMemo(() => {
        if (!related) return []

        const rootId = `${resource}:${namespace || ''}:${name}`
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
    }, [related, name, resource, namespace])

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
        const timeout = setTimeout(updatePositions, 100)
        window.addEventListener('resize', updatePositions)
        return () => {
            clearTimeout(timeout)
            window.removeEventListener('resize', updatePositions)
        }
    }, [updatePositions])

    const handleWheel = useCallback((e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const delta = e.deltaY > 0 ? 0.9 : 1.1
            setZoom(prev => Math.min(Math.max(prev * delta, 0.2), 3))
        }
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button === 0) { // Left click for panning
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

    const handleMouseUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.2, 3))
    const handleZoomOut = () => setZoom(prev => Math.max(prev * 0.8, 0.2))
    const handleReset = () => {
        setZoom(1)
        setOffset({ x: 0, y: 0 })
    }

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Loading topology...</div>
    }

    return (
        <Card className="overflow-hidden bg-slate-50/50 dark:bg-slate-900/50 border-dashed relative">
            <div className="absolute top-4 left-4 z-50 flex flex-col gap-2">
                <Button variant="secondary" size="icon" onClick={handleZoomIn} title="Zoom In">
                    <IconZoomIn size={18} />
                </Button>
                <Button variant="secondary" size="icon" onClick={handleZoomOut} title="Zoom Out">
                    <IconZoomOut size={18} />
                </Button>
                <Button variant="secondary" size="icon" onClick={handleReset} title="Reset View">
                    <IconRefresh size={18} />
                </Button>
            </div>

            <CardContent
                className="p-0 relative min-h-[500px] cursor-grab active:cursor-grabbing overflow-hidden"
                ref={containerRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <div
                    ref={contentRef}
                    className="absolute inset-0 transition-transform duration-75"
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                        transformOrigin: '50% 50%',
                    }}
                >
                    <div className="p-8 min-w-full min-h-full inline-block">
                        {/* Connection Lines rendered first to be behind nodes */}
                        {related && <TopologyLines links={related.links || []} positions={nodePositions} />}

                        <div className="flex flex-col items-center justify-between gap-16 relative z-10">
                            {layers.map((layer, lIdx) => (
                                <div key={`layer-${lIdx}`} className="flex justify-center gap-8 flex-wrap w-full">
                                    {layer.map((node) => (
                                        <TopologyNode
                                            key={node.id}
                                            id={node.id}
                                            node={node}
                                            isRoot={node.id === `${resource}:${namespace || ''}:${name}`}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

function TopologyNode({ id, node, isRoot }: { id: string, node: NodeType; isRoot: boolean }) {
    const { user } = useAuth()
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

    const nodeContent = (
        <div
            id={id}
            className={`
                relative flex flex-col items-center p-3 rounded-xl border transition-all duration-300 group z-20 min-w-[100px] cursor-pointer
                ${isRoot
                    ? 'bg-blue-600 text-white border-blue-700 shadow-lg shadow-blue-500/20 scale-110'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:shadow-md'}
            `}
        >
            <div className={`mb-2 ${isRoot ? 'text-white' : 'text-blue-500'}`}>
                {RESOURCE_ICONS[node.type.toLowerCase()] || <IconBox size={20} />}
            </div>
            <div className="text-xs font-bold truncate max-w-[120px]">{node.name}</div>
            <Badge
                variant={isRoot ? 'secondary' : 'outline'}
                className={`mt-1 text-[10px] uppercase px-1 py-0 pointer-events-none ${isRoot ? 'bg-white/20 border-white/30 text-white' : ''}`}
            >
                {node.type}
            </Badge>

            {!isRoot && (
                <Link
                    to={withSubPath(path)}
                    className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-500 text-white rounded-full p-1 shadow-sm"
                    onClick={(e) => e.stopPropagation()}
                >
                    <IconExternalLink size={10} />
                </Link>
            )}
        </div>
    )

    if (hasPermission) {
        return (
            <QuickYamlDialog
                resourceType={node.type as ResourceType}
                name={node.name}
                namespace={node.namespace}
                customTrigger={nodeContent}
            />
        )
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {nodeContent}
                </TooltipTrigger>
                <TooltipContent>
                    <p className="text-xs font-medium">{node.name}</p>
                    <p className="text-[10px] opacity-70 italic">{node.namespace || 'Cluster Scoped'}</p>
                    <p className="text-[10px] text-destructive mt-1">No permission to view YAML</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

function TopologyLines({ links, positions }: { links: TopologyLink[], positions: Record<string, Position> }) {
    const connections = useMemo(() => {
        const lines: { x1: number, y1: number, x2: number, y2: number, label?: string }[] = []

        links.forEach(link => {
            const pos1 = positions[link.source]
            const pos2 = positions[link.target]

            if (pos1 && pos2) {
                lines.push({
                    x1: pos1.x,
                    y1: pos1.y,
                    x2: pos2.x,
                    y2: pos2.y,
                    label: link.label
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
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                >
                    <polygon points="0 0, 10 3.5, 0 7" fill="currentColor" opacity="0.4" />
                </marker>
            </defs>
            {connections.map((line, idx) => (
                <g key={idx}>
                    <path
                        d={`M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`}
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        className="text-blue-500/30"
                        markerEnd="url(#arrowhead)"
                    />
                    {line.label && (
                        <text
                            x={(line.x1 + line.x2) / 2}
                            y={(line.y1 + line.y2) / 2}
                            textAnchor="middle"
                            dy="-5"
                            className="text-[8px] fill-muted-foreground opacity-60 font-medium pointer-events-none"
                        >
                            {line.label}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    )
}
