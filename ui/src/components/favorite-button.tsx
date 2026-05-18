/**
 * Reusable "Add to Favorites" button for workload overview pages.
 * Uses the favorites system in lib/favorites.ts to star/unstar resources.
 */
import { useCallback, useState } from 'react'
import { IconStar, IconStarFilled } from '@tabler/icons-react'
import { toast } from 'sonner'

import { SearchResult } from '@/lib/api'
import { useFavorites } from '@/hooks/use-favorites'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface FavoriteButtonProps {
  resourceType: string
  name: string
  namespace?: string
}

export function FavoriteButton({ resourceType, name, namespace }: FavoriteButtonProps) {
  const { isFavorite, toggleFavorite } = useFavorites()
  const [animating, setAnimating] = useState(false)

  const resourceId = namespace
    ? `${resourceType}/${namespace}/${name}`
    : `${resourceType}/${name}`

  const starred = isFavorite(resourceId)

  const handleToggle = useCallback(() => {
    const resource: SearchResult = {
      id: resourceId,
      name,
      resourceType,
      namespace,
      createdAt: new Date().toISOString(),
    }

    const newState = toggleFavorite(resource)
    setAnimating(true)
    setTimeout(() => setAnimating(false), 500)

    if (newState) {
      toast.success(`⭐ "${name}" added to favorites`, { duration: 2500 })
    } else {
      toast.success(`Removed "${name}" from favorites`, { duration: 2000 })
    }
  }, [resourceId, name, resourceType, namespace, toggleFavorite])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={starred ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggle}
            className={`
              gap-1.5 relative overflow-hidden transition-all duration-300
              ${starred
                ? 'bg-amber-500/15 text-amber-600 border-amber-400/40 hover:bg-amber-500/25 hover:border-amber-400/60 dark:text-amber-400 dark:border-amber-500/30 dark:hover:bg-amber-500/20'
                : 'hover:border-amber-400/40 hover:text-amber-500'
              }
            `}
          >
            {starred ? (
              <IconStarFilled
                className={`w-4 h-4 text-amber-500 transition-transform duration-300 ${animating ? 'scale-130' : ''}`}
                style={animating ? { transform: 'scale(1.3) rotate(15deg)' } : undefined}
              />
            ) : (
              <IconStar
                className={`w-4 h-4 transition-transform duration-300 ${animating ? 'scale-110' : ''}`}
              />
            )}
            <span className="text-xs font-medium">{starred ? 'Starred' : 'Star'}</span>
            {/* Subtle shine animation on star */}
            {animating && starred && (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-300/20 to-transparent animate-shimmer pointer-events-none" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {starred
            ? 'Remove from favorites'
            : 'Add to favorites for quick access via ⌘K or ⌘F'
          }
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
