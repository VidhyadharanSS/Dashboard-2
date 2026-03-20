import { SearchResult } from '@/lib/api'
import { apiClient } from '@/lib/api-client'

const FAVORITES_STORAGE_KEY = 'kite-favorites'

/**
 * Get favorites from localStorage
 */
export const getFavorites = (): SearchResult[] => {
  const cluster = localStorage.getItem('current-cluster') || ''
  try {
    const favorites = localStorage.getItem(cluster + FAVORITES_STORAGE_KEY)
    return favorites ? JSON.parse(favorites) : []
  } catch {
    return []
  }
}

/**
 * Save favorites to localStorage and sync to backend
 */
export const saveFavorites = (favorites: SearchResult[]) => {
  const cluster = localStorage.getItem('current-cluster') || ''
  try {
    const json = JSON.stringify(favorites)
    localStorage.setItem(cluster + FAVORITES_STORAGE_KEY, json)
    // Fire-and-forget sync to backend
    syncFavoritesToBackend(json).catch(() => {})
  } catch (error) {
    console.error('Failed to save favorites:', error)
  }
}

/**
 * Sync favorites to backend (persisted per-user in DB)
 */
async function syncFavoritesToBackend(favoritesJson: string) {
  try {
    await apiClient.post('/users/favorites', { favorites: favoritesJson })
  } catch {
    // Silently fail — localStorage is the primary store
  }
}

/**
 * Load favorites from backend and merge with localStorage
 */
export async function loadFavoritesFromBackend(): Promise<SearchResult[]> {
  try {
    const resp = await apiClient.get<{ favorites: string }>('/users/favorites')
    if (resp.favorites) {
      const backendFavs: SearchResult[] = JSON.parse(resp.favorites)
      const localFavs = getFavorites()
      // Merge: keep all local + add any backend-only entries
      const localIds = new Set(localFavs.map(f => f.id))
      const merged = [...localFavs]
      for (const fav of backendFavs) {
        if (!localIds.has(fav.id)) {
          merged.push(fav)
        }
      }
      // Save merged back to localStorage (skip backend sync to avoid loop)
      const cluster = localStorage.getItem('current-cluster') || ''
      localStorage.setItem(cluster + FAVORITES_STORAGE_KEY, JSON.stringify(merged))
      return merged
    }
  } catch {
    // Fallback to localStorage
  }
  return getFavorites()
}

/**
 * Add a resource to favorites
 */
export const addToFavorites = (resource: SearchResult) => {
  const favorites = getFavorites()
  const favorite: SearchResult = {
    id: resource.id,
    name: resource.name,
    resourceType: resource.resourceType,
    namespace: resource.namespace,
    createdAt: resource.createdAt,
  }

  // Check if already exists
  if (!favorites.some((fav) => fav.id === favorite.id)) {
    favorites.push(favorite)
    saveFavorites(favorites)
  }
}

/**
 * Remove a resource from favorites
 */
export const removeFromFavorites = (resourceId: string) => {
  const favorites = getFavorites()
  const filtered = favorites.filter((fav) => fav.id !== resourceId)
  saveFavorites(filtered)
}

/**
 * Check if a resource is in favorites
 */
export const isFavorite = (resourceId: string): boolean => {
  const favorites = getFavorites()
  return favorites.some((fav) => fav.id === resourceId)
}

/**
 * Toggle favorite status of a resource
 */
export const toggleFavorite = (resource: SearchResult): boolean => {
  if (isFavorite(resource.id)) {
    removeFromFavorites(resource.id)
    return false
  } else {
    addToFavorites(resource)
    return true
  }
}
