/**
 * Feature: Favorites Quick Access
 *
 * A header dropdown button that shows the user's favorited/starred resources
 * for one-click navigation. Works with the existing favorites system in
 * lib/favorites.ts and hooks/use-favorites.ts.
 *
 * Users can:
 *  - See all starred resources grouped by type
 *  - Click to navigate instantly
 *  - Remove favorites inline
 *  - See an empty state with guidance on how to add favorites
 */

import { useMemo, useState, useCallback, useEffect } from 'react'
import {
    IconStar,
    IconStarFilled,
    IconBox,
    IconLayersIntersect,
    IconNetwork,
    IconSettings,
    IconLock,
    IconCloud,
    IconServer,
    IconChecklist,
    IconRotate,
    IconRepeat,
    IconClock,
    IconX,
    IconChevronRight,
    IconFolders,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useFavorites } from '@/hooks/use-favorites'
import { SearchResult } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const RESOURCE_ICONS: Record<string, React.ElementType> = {
    pods: IconBox,
    deployments: IconLayersIntersect,
    statefulsets: IconRotate,
    daemonsets: IconRepeat,
    services: IconNetwork,
    configmaps: IconSettings,
    secrets: IconLock,
    ingresses: IconCloud,
    nodes: IconServer,
    jobs: IconChecklist,
    cronjobs: IconClock,
    namespaces: IconFolders,
}

const RESOURCE_COLORS: Record<string, string> = {
    pods: 'text-sky-500',
    deployments: 'text-blue-500',
    statefulsets: 'text-indigo-500',
    daemonsets: 'text-purple-500',
    services: 'text-emerald-500',
    configmaps: 'text-yellow-500',
    secrets: 'text-rose-500',
    ingresses: 'text-teal-500',
    nodes: 'text-blue-600',
    jobs: 'text-amber-500',
    cronjobs: 'text-orange-500',
    namespaces: 'text-violet-500',
}

function getResourceRoute(resourceType: string, namespace?: string, name?: string) {
    const type = resourceType.toLowerCase()
    if (namespace && name) return `/${type}/${namespace}/${name}`
    if (name) return `/${type}/_all/${name}`
    return `/${type}`
}

export function FavoritesQuickAccess() {
    const navigate = useNavigate()
    const { favorites, removeFromFavorites } = useFavorites()
    const [open, setOpen] = useState(false)

    // Ctrl+F / Cmd+F shortcut to toggle favorites popover
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                // Only intercept if not inside an input / textarea / editor
                const el = document.activeElement
                const tag = el?.tagName?.toLowerCase()
                if (tag === 'input' || tag === 'textarea' || tag === 'select') return
                if ((el as HTMLElement)?.contentEditable === 'true') return
                if (el?.closest('.cm-editor, .monaco-editor')) return

                e.preventDefault()
                e.stopPropagation()
                setOpen(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [])

    const grouped = useMemo(() => {
        const groups: Record<string, SearchResult[]> = {}
        for (const fav of favorites) {
            const type = fav.resourceType?.toLowerCase() || 'other'
            if (!groups[type]) groups[type] = []
            groups[type].push(fav)
        }
        // Sort groups by count descending
        return Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
    }, [favorites])

    const handleNavigate = useCallback((fav: SearchResult) => {
        const route = getResourceRoute(fav.resourceType, fav.namespace, fav.name)
        navigate(route)
        setOpen(false)
    }, [navigate])

    const handleRemove = useCallback((id: string, name: string, e: React.MouseEvent) => {
        e.stopPropagation()
        removeFromFavorites(id)
        toast.success(`Removed "${name}" from favorites`, { duration: 2000 })
    }, [removeFromFavorites])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="relative h-8 w-8">
                                {favorites.length > 0
                                    ? <IconStarFilled className="h-4 w-4 text-amber-500" />
                                    : <IconStar className="h-4 w-4" />
                                }
                                {favorites.length > 0 && (
                                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white leading-none">
                                        {favorites.length > 9 ? '9+' : favorites.length}
                                    </span>
                                )}
                                <span className="sr-only">Favorites</span>
                            </Button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        Favorite Resources ({favorites.length})
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <PopoverContent align="end" className="w-80 p-0 max-h-[70vh] flex flex-col">
                {/* Header */}
                <div className="px-4 py-2.5 border-b shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <IconStarFilled className="h-4 w-4 text-amber-500" />
                            <span className="text-sm font-semibold">Favorites</span>
                            {favorites.length > 0 && (
                                <Badge variant="secondary" className="text-[10px] h-5">
                                    {favorites.length}
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {favorites.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                            <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                                <IconStar className="h-6 w-6 text-muted-foreground/40" />
                            </div>
                            <p className="text-sm font-medium text-foreground/80">No favorites yet</p>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-[200px]">
                                Star resources from the global search (⌘K) or resource detail pages to access them quickly here.
                            </p>
                        </div>
                    ) : (
                        <div className="py-1.5">
                            {grouped.map(([type, items]) => {
                                const Icon = RESOURCE_ICONS[type] || IconBox
                                const color = RESOURCE_COLORS[type] || 'text-muted-foreground'

                                return (
                                    <div key={type}>
                                        <div className="px-4 py-1.5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                <Icon className={`h-3 w-3 ${color}`} />
                                                {type}
                                                <span className="text-[9px] font-normal">({items.length})</span>
                                            </span>
                                        </div>
                                        {items.map((fav) => (
                                            <button
                                                key={fav.id}
                                                onClick={() => handleNavigate(fav)}
                                                className="w-full flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/50 transition-colors group text-left"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-medium truncate text-foreground/85 group-hover:text-foreground">
                                                        {fav.name}
                                                    </div>
                                                    {fav.namespace && (
                                                        <div className="text-[10px] text-muted-foreground truncate">
                                                            {fav.namespace}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={(e) => handleRemove(fav.id, fav.name, e)}
                                                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                                        title="Remove from favorites"
                                                    >
                                                        <IconX className="h-3 w-3" />
                                                    </button>
                                                    <IconChevronRight className="h-3 w-3 text-muted-foreground" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2 border-t bg-muted/20 shrink-0">
                    <p className="text-[10px] text-muted-foreground text-center">
                        {favorites.length > 0 ? 'Add more via' : 'Star resources from'}{' '}
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">⌘K</kbd> search
                        {' · '}
                        <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono">⌘F</kbd> to toggle
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    )
}
