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
    setTimeout(() => setAnimating(false), 300)

    if (newState) {
      toast.success(`Added "${name}" to favorites`)
    } else {
      toast.success(`Removed "${name}" from favorites`)
    }
  }, [resourceId, name, resourceType, namespace, toggleFavorite])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggle}
            className={`gap-1.5 ${starred ? 'text-amber-500 border-amber-500/30 hover:border-amber-500/50' : ''}`}
          >
            {starred ? (
              <IconStarFilled
                className={`w-4 h-4 text-amber-500 ${animating ? 'scale-125 transition-transform' : 'transition-transform'}`}
              />
            ) : (
              <IconStar
                className={`w-4 h-4 ${animating ? 'scale-125 transition-transform' : 'transition-transform'}`}
              />
            )}
            {starred ? 'Starred' : 'Star'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {starred ? 'Remove from favorites' : 'Add to favorites for quick access'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
