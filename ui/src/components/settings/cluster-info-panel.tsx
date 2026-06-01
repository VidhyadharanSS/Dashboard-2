/**
 * ClusterInfoPanel - draggable floating panel showing cluster details.
 * Replaces the side-sheet approach so no content gets clipped.
 */
import { useCallback, useRef, useState } from 'react'
import {
    IconCheck,
    IconCircleX,
    IconClock,
    IconCloud,
    IconExternalLink,
    IconGripVertical,
    IconInfoCircle,
    IconServer,
    IconShieldCheck,
    IconStack2,
    IconX,
} from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { Cluster } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface ClusterInfoPanelProps {
    cluster: Cluster | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

function InfoRow({
    icon,
    label,
    value,
}: {
    icon?: React.ReactNode
    label: string
    value: React.ReactNode
}) {
    return (
        <div className="flex items-start gap-2 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 w-[128px] pt-0.5">
                {icon && <span className="shrink-0 opacity-60">{icon}</span>}
                {label}
            </div>
            <div className="flex-1 text-sm font-medium text-right min-w-0 break-all">{value}</div>
        </div>
    )
}

function safeAgo(s: string | undefined): string {
    if (!s || s === '' || s.startsWith('0001-01-01')) return '-'
    try {
        const d = new Date(s)
        if (isNaN(d.getTime())) return '-'
        return formatDistanceToNow(d, { addSuffix: true })
    } catch {
        return '-'
    }
}

export function ClusterInfoPanel({
    cluster,
    open,
    onOpenChange,
}: ClusterInfoPanelProps) {
    const { t } = useTranslation()

    const panelRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
    const dragOffset = useRef({ x: 0, y: 0 })
    const isDragging = useRef(false)

    const onDragStart = useCallback((e: React.MouseEvent) => {
        if (!panelRef.current) return
        isDragging.current = true
        const rect = panelRef.current.getBoundingClientRect()
        dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }

        const onMove = (ev: MouseEvent) => {
            if (!isDragging.current) return
            setPos({
                x: Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - dragOffset.current.x)),
                y: Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dragOffset.current.y)),
            })
        }
        const onUp = () => {
            isDragging.current = false
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        e.preventDefault()
    }, [])

    if (!open || !cluster) return null

    const style: React.CSSProperties = pos
        ? { position: 'fixed', left: pos.x, top: pos.y, zIndex: 50 }
        : { position: 'fixed', right: 28, top: 80, zIndex: 50 }

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
                onClick={() => { setPos(null); onOpenChange(false) }}
            />
            <div
                ref={panelRef}
                style={style}
                className="w-[440px] max-h-[calc(100vh-110px)] flex flex-col rounded-xl border border-border bg-popover shadow-2xl overflow-hidden"
            >
                <div
                    onMouseDown={onDragStart}
                    className="flex items-center gap-3 px-4 py-3 bg-muted/50 border-b border-border cursor-grab active:cursor-grabbing select-none shrink-0"
                >
                    <IconGripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <IconServer className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate leading-tight">{cluster.name}</p>
                        {cluster.description && (
                            <p className="text-[11px] text-muted-foreground truncate">{cluster.description}</p>
                        )}
                    </div>
                    <button
                        onClick={() => { setPos(null); onOpenChange(false) }}
                        className="shrink-0 rounded-md p-1 hover:bg-accent transition-colors"
                        aria-label="Close"
                    >
                        <IconX className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-5">
                    <div className="flex flex-wrap gap-1.5 py-3">
                        {cluster.isDefault && (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] gap-0.5">
                                <IconShieldCheck className="h-2.5 w-2.5" />
                                {t('clusterManagement.type.default', 'Default')}
                            </Badge>
                        )}
                        {cluster.inCluster ? (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 text-[10px] gap-0.5">
                                <IconStack2 className="h-2.5 w-2.5" />
                                {t('clusterManagement.type.inCluster', 'In-Cluster')}
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="bg-secondary text-secondary-foreground text-[10px] gap-0.5">
                                <IconCloud className="h-2.5 w-2.5" />
                                {t('clusterManagement.type.external', 'External')}
                            </Badge>
                        )}
                        {cluster.enabled ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-[10px] gap-0.5">
                                <IconCheck className="h-2.5 w-2.5" />
                                {t('clusterManagement.status.enabled', 'Enabled')}
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="bg-secondary text-secondary-foreground text-[10px] gap-0.5">
                                <IconCircleX className="h-2.5 w-2.5" />
                                {t('clusterManagement.status.disabled', 'Disabled')}
                            </Badge>
                        )}
                        {cluster.error && (
                            <Badge variant="destructive" className="gap-0.5 text-[10px]">
                                <IconCircleX className="h-2.5 w-2.5" />
                                Connection Error
                            </Badge>
                        )}
                    </div>

                    <Separator />

                    <div className="divide-y divide-border/50">
                        <InfoRow
                            icon={<IconStack2 className="h-3.5 w-3.5" />}
                            label="K8s Version"
                            value={
                                cluster.error ? (
                                    <span className="text-destructive text-xs break-all">{cluster.error}</span>
                                ) : (
                                    <Badge variant="secondary" className="font-mono">{cluster.version || '-'}</Badge>
                                )
                            }
                        />
                        <InfoRow
                            icon={<IconInfoCircle className="h-3.5 w-3.5" />}
                            label="Cluster ID"
                            value={<span className="font-mono text-muted-foreground">#{cluster.id}</span>}
                        />
                        {cluster.prometheusURL && (
                            <InfoRow
                                icon={<IconExternalLink className="h-3.5 w-3.5" />}
                                label="Prometheus"
                                value={
                                    <a
                                        href={cluster.prometheusURL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline text-xs break-all"
                                    >
                                        {cluster.prometheusURL}
                                    </a>
                                }
                            />
                        )}
                        <InfoRow
                            icon={<IconClock className="h-3.5 w-3.5" />}
                            label="Created"
                            value={<span className="text-muted-foreground text-xs">{safeAgo(cluster.createdAt)}</span>}
                        />
                        <InfoRow
                            icon={<IconClock className="h-3.5 w-3.5" />}
                            label="Last Updated"
                            value={<span className="text-muted-foreground text-xs">{safeAgo(cluster.updatedAt)}</span>}
                        />
                    </div>

                    {cluster.description && (
                        <>
                            <Separator className="my-3" />
                            <div>
                                <p className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
                                    Description
                                </p>
                                <p className="text-sm text-foreground leading-relaxed">{cluster.description}</p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    )
}
