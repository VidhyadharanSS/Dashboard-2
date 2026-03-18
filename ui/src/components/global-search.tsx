import { ComponentType, useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { useSidebarConfig } from '@/contexts/sidebar-config-context'
import {
  IconArrowsHorizontal,
  IconBox,
  IconBoxMultiple,
  IconLayoutDashboard,
  IconLoadBalancer,
  IconLoader,
  IconLock,
  IconMap,
  IconMoon,
  IconNetwork,
  IconPlayerPlay,
  IconRocket,
  IconRoute,
  IconRouter,
  IconSearch,
  IconServer,
  IconServer2,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconSun,
  IconTopologyBus,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { globalSearch, SearchResult } from '@/lib/api'
import { useCluster } from '@/hooks/use-cluster'
import { useFavorites } from '@/hooks/use-favorites'
import { usePermissions } from '@/hooks/use-permissions'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ResourceType } from '@/types/api'
import { useAppearance } from '@/components/appearance-provider'
import { QuickYamlDialog } from './quick-yaml-dialog'

// Define resource types and their display properties
const RESOURCE_CONFIG: Record<
  string,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  pods: { label: 'nav.pods', icon: IconBox },
  deployments: { label: 'nav.deployments', icon: IconRocket },
  services: { label: 'nav.services', icon: IconNetwork },
  configmaps: { label: 'nav.configMaps', icon: IconMap },
  secrets: { label: 'nav.secrets', icon: IconLock },
  namespaces: {
    label: 'nav.namespaces',
    icon: IconBoxMultiple,
  },
  nodes: { label: 'nav.nodes', icon: IconServer2 },
  jobs: { label: 'nav.jobs', icon: IconPlayerPlay },
  ingresses: { label: 'nav.ingresses', icon: IconRouter },
  gateways: { label: 'nav.gateways', icon: IconLoadBalancer },
  httproutes: { label: 'nav.httproutes', icon: IconRoute },
  daemonsets: {
    label: 'nav.daemonsets',
    icon: IconTopologyBus,
  },
  horizontalpodautoscalers: {
    label: 'nav.horizontalpodautoscalers',
    icon: IconArrowsHorizontal,
  },
}

interface SidebarSearchItem {
  id: string
  title: string
  url: string
  Icon: React.ComponentType<{ className?: string }>
  groupLabel?: string
  searchText: string
  isPinned: boolean
}

interface ActionSearchItem {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  searchText: string
  onSelect: () => void
}

const Highlight = ({ text, query }: { text: string; query: string }) => {
  if (!query.trim()) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary/20 text-primary font-bold px-0 rounded">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

interface GlobalSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>([])
  const [isLoading, setIsLoading] = useState(false)
  const [namespaceFilter, setNamespaceFilter] = useState<string>('')
  const navigate = useNavigate()
  const { user } = useAuth()
  const { config, getIconComponent } = useSidebarConfig()
  const { setTheme, actualTheme } = useAppearance()
  const {
    clusters,
    currentCluster,
    setCurrentCluster,
    isSwitching,
    isLoading: isClusterLoading,
  } = useCluster()
  const { canAccess } = usePermissions()

  // Helper to map URL to resource type
  const getResourceFromUrl = useCallback((url: string) => {
    const parts = url.split('?')[0].split('/')
    let base = parts[1]
    if (base === 'persistentvolumeclaims') return 'persistentvolumeclaims'
    if (base === 'persistentvolumes') return 'persistentvolumes'
    if (base === 'storageclasses') return 'storageclasses'
    if (base === 'configmaps') return 'configmaps'
    if (base === 'serviceaccounts') return 'serviceaccounts'
    if (base === 'rolebindings') return 'rolebindings'
    if (base === 'clusterroles') return 'clusterroles'
    if (base === 'clusterrolebindings') return 'clusterrolebindings'
    if (base === 'horizontalpodautoscalers') return 'horizontalpodautoscalers'
    if (base === 'crds' && parts[2]) return 'crs'
    return base || ''
  }, [])

  // Simple theme toggle function
  const toggleTheme = useCallback(() => {
    if (actualTheme === 'dark') {
      setTheme('light')
    } else {
      setTheme('dark')
    }
  }, [actualTheme, setTheme])

  const sidebarItems = useMemo<SidebarSearchItem[]>(() => {
    const overviewTitle = t('nav.overview')
    const items: SidebarSearchItem[] = [
      {
        id: 'sidebar-overview',
        title: overviewTitle,
        url: '/',
        Icon: IconLayoutDashboard,
        groupLabel: undefined,
        searchText: `${overviewTitle} overview dashboard /`.toLowerCase(),
        isPinned: false,
      },
      ...(user?.isAdmin()
        ? [
          {
            id: 'settings',
            title: t('settings.nav', 'Settings'),
            url: '/settings',
            Icon: IconSettings,
            groupLabel: 'Settings',
            searchText:
              `${t('settings.nav', 'Settings')} admin`.toLowerCase(),
            isPinned: false,
          },
          {
            id: 'clusters',
            title: t('settings.tabs.clusters', 'Cluster'),
            url: '/settings?tab=clusters',
            Icon: IconSettings,
            groupLabel: 'Settings',
            searchText:
              `${t('settings.tabs.clusters', 'Cluster')} settings cluster admin`.toLowerCase(),
            isPinned: false,
          },
          {
            id: 'oauth',
            title: t('settings.tabs.oauth', 'OAuth'),
            url: '/settings?tab=oauth',
            Icon: IconSettings,
            groupLabel: 'Settings',
            searchText:
              `${t('settings.tabs.oauth', 'OAuth')} settings oauth admin`.toLowerCase(),
            isPinned: false,
          },
          {
            id: 'rbac',
            title: t('settings.tabs.rbac', 'RBAC'),
            url: '/settings?tab=rbac',
            Icon: IconSettings,
            groupLabel: 'Settings',
            searchText:
              `${t('settings.tabs.rbac', 'RBAC')} settings rbac admin`.toLowerCase(),
            isPinned: false,
          },
          {
            id: 'users',
            title: t('settings.tabs.users', 'User'),
            url: '/settings?tab=users',
            Icon: IconSettings,
            groupLabel: 'Settings',
            searchText:
              `${t('settings.tabs.users', 'User')} settings user admin`.toLowerCase(),
            isPinned: false,
          },
        ]
        : []),
    ]

    if (!config) {
      return items
    }

    const pinnedItems = new Set(config.pinnedItems)

    config.groups.forEach((group) => {
      const groupLabel = group.nameKey
        ? t(group.nameKey, { defaultValue: group.nameKey })
        : ''

      group.items
        .slice()
        .sort((a, b) => a.order - b.order)
        .forEach((item) => {
          const title = item.titleKey
            ? t(item.titleKey, { defaultValue: item.titleKey })
            : item.id
          const Icon = getIconComponent(item.icon) as ComponentType<{
            className?: string | undefined
          }>
          const searchTerms = [title, groupLabel, item.url, item.titleKey]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

          items.push({
            id: item.id,
            title,
            url: item.url,
            Icon,
            groupLabel,
            searchText: searchTerms,
            isPinned: pinnedItems.has(item.id),
          })
        })
    })

    return items.filter(item => {
      if (item.url === '/' || item.url === '/tutorials') return true
      if (item.url === '/settings' || item.url.startsWith('/settings?')) return user?.isAdmin()
      const resource = getResourceFromUrl(item.url)
      return canAccess(resource, 'list')
    })
  }, [config, getIconComponent, t, user, canAccess, getResourceFromUrl])

  const sidebarResults = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) {
      return []
    }

    return sidebarItems
      .map(item => {
        let score = 0
        const titleLower = item.title.toLowerCase()
        if (titleLower === trimmedQuery) score += 1000
        else if (titleLower.startsWith(trimmedQuery)) score += 500
        else if (titleLower.includes(trimmedQuery)) score += 200
        else if (item.searchText.includes(trimmedQuery)) score += 100

        if (item.isPinned) score += 50

        return { ...item, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  }, [query, sidebarItems])

  // Use favorites hook
  const {
    favorites,
    isFavorite,
    toggleFavorite: toggleResourceFavorite,
  } = useFavorites()

  // Handle item selection — declared early so actionItems can reference it
  const handleSelect = useCallback(
    (path: string) => {
      navigate(path)
      onOpenChange(false)
      setQuery('')
      setNamespaceFilter('')
    },
    [navigate, onOpenChange]
  )

  // Detect kubectl-style commands — declared early so actionResults can reference it
  const isKubectlQuery = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    return trimmed.startsWith('kubectl ') || trimmed.startsWith('k get ') || trimmed.startsWith('k describe ')
  }, [query])

  const actionItems: ActionSearchItem[] = useMemo(() => {
    return [
      {
        id: 'toggle-theme',
        label: t('globalSearch.toggleTheme'),
        icon: actualTheme === 'dark' ? IconSun : IconMoon,
        searchText: 'toggle theme switch mode light dark'.toLocaleLowerCase(),
        onSelect: toggleTheme,
      },
      {
        id: 'nav-pods-quick',
        label: 'Go to Pods',
        icon: IconBox,
        searchText: 'go to pods navigation'.toLowerCase(),
        onSelect: () => handleSelect('/pods'),
      },
      {
        id: 'nav-nodes-quick',
        label: 'Go to Nodes',
        icon: IconServer2,
        searchText: 'go to nodes navigation'.toLowerCase(),
        onSelect: () => handleSelect('/nodes'),
      },
      {
        id: 'nav-deployments-quick',
        label: 'Go to Deployments',
        icon: IconRocket,
        searchText: 'go to deployments navigation'.toLowerCase(),
        onSelect: () => handleSelect('/deployments'),
      },
      {
        id: 'nav-tutorial',
        label: 'Developer Manual / Tutorials',
        icon: IconMap,
        searchText: 'docs help manual tutorial developer'.toLowerCase(),
        onSelect: () => handleSelect('/tutorials'),
      },
      {
        id: 'nav-advanced-search',
        label: 'Advanced Search (Expression & kubectl)',
        icon: IconSearch,
        searchText: 'advanced search expression query filter kubernetes resources kubectl get nodes pods'.toLowerCase(),
        onSelect: () => handleSelect('/expression-search'),
      },
      {
        id: 'nav-settings-quick',
        label: 'Open Settings',
        icon: IconSettings,
        searchText: 'settings preferences admin'.toLowerCase(),
        onSelect: () => handleSelect('/settings'),
      },
      ...(clusters.length > 1
        ? clusters
          .filter((cluster) => cluster.name !== currentCluster)
          .map((cluster) => ({
            id: `switch-cluster-${cluster.name}`,
            label: t('globalSearch.switchCluster', { name: cluster.name }),
            icon: IconServer,
            searchText: `switch cluster ${cluster.name}`.toLocaleLowerCase(),
            onSelect: () => {
              if (isSwitching || isClusterLoading || cluster.name === currentCluster) {
                return
              }
              setCurrentCluster(cluster.name)
            },
          }))
        : []),
    ].filter(item => {
      if (item.id === 'toggle-theme' || item.id === 'nav-tutorial' || item.id.startsWith('switch-cluster-')) return true
      if (item.id === 'nav-settings-quick') return user?.isAdmin()
      if (item.id === 'nav-pods-quick') return canAccess('pods', 'list')
      if (item.id === 'nav-nodes-quick') return canAccess('nodes', 'list')
      if (item.id === 'nav-deployments-quick') return canAccess('deployments', 'list')
      return true
    })
  }, [
    actualTheme,
    clusters,
    currentCluster,
    handleSelect,
    isClusterLoading,
    isSwitching,
    setCurrentCluster,
    t,
    toggleTheme,
    user,
    canAccess,
  ])

  // Filter actions based on query
  const actionResults = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) return []

    // If user typed a kubectl command, show a special action at the top
    const kubectlAction: ActionSearchItem[] = isKubectlQuery
      ? [{
          id: 'kubectl-advanced-search',
          label: `Run in Advanced Search: ${query.trim()}`,
          icon: IconSearch,
          searchText: '',
          onSelect: () => {
            handleSelect(`/expression-search?q=${encodeURIComponent(query.trim())}`)
          },
        }]
      : []

    const filtered = actionItems
      .map(item => {
        let score = 0
        const labelLower = item.label.toLowerCase()
        if (labelLower === trimmedQuery) score += 1000
        else if (labelLower.startsWith(trimmedQuery)) score += 500
        else if (labelLower.includes(trimmedQuery)) score += 200
        else if (item.searchText.includes(trimmedQuery)) score += 100
        return { ...item, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))

    return [...kubectlAction, ...filtered]
  }, [actionItems, query, isKubectlQuery, handleSelect])

  // Handle favorite toggle
  const toggleFavorite = useCallback(
    (result: SearchResult, event: React.MouseEvent) => {
      event.stopPropagation()
      toggleResourceFavorite(result)
      const currentQuery = query
      setTimeout(() => {
        if (!currentQuery || currentQuery.length < 2) {
          setResults(favorites)
        }
      }, 0)
    },
    [query, toggleResourceFavorite, favorites]
  )

  // Debounced search function
  const performSearch = useCallback(async (searchQuery: string, namespace?: string) => {
    try {
      setIsLoading(true)
      const response = await globalSearch(searchQuery, {
        limit: 10,
        namespace: namespace || undefined,
      })
      setResults(response.results)
    } catch (error) {
      console.error('Search failed:', error)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Debounce search calls
  useEffect(() => {
    if (query.length > 0) {
      setResults(null)
    }
    if (!query || query.length < 2) {
      if (query.length === 0) {
        setResults(favorites)
      }
      return
    }
    // Don't run API search for kubectl commands — the action item will handle it
    if (isKubectlQuery) {
      setIsLoading(false)
      setResults([])
      return
    }
    setIsLoading(true)
    const timeoutId = setTimeout(() => {
      performSearch(query, namespaceFilter)
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [query, namespaceFilter, performSearch, favorites, isKubectlQuery])

  // Handle pod actions
  const handlePodAction = useCallback(
    (result: SearchResult, tab: 'terminal' | 'logs') => {
      const path = `/${result.resourceType}/${result.namespace}/${result.name}?tab=${tab}`
      handleSelect(path)
    },
    [handleSelect]
  )

  // Clear state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setIsLoading(false)
      setNamespaceFilter('')
    }
  }, [open])

  useEffect(() => {
    if (open && query === '') {
      setResults(favorites) // Show favorites when dialog opens
    }
  }, [open, query, favorites])

  // Get unique namespaces from results
  const availableNamespaces = useMemo(() => {
    if (!results || results.length === 0) return []
    const namespaces = new Set<string>()
    results.forEach(r => {
      if (r.namespace) namespaces.add(r.namespace)
    })
    return Array.from(namespaces).sort()
  }, [results])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-7xl h-[70vh] flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('globalSearch.title')}</DialogTitle>
          <DialogDescription>{t('globalSearch.description')}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <div className="flex items-center gap-2 border-b px-3">
            <CommandInput
              placeholder={t('globalSearch.placeholder')}
              value={query}
              onValueChange={setQuery}
              className="border-0 focus:ring-0 flex-1"
            />
            {availableNamespaces.length > 0 && (
              <div className="flex items-center gap-1 border-l pl-3 py-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground whitespace-nowrap">Filter:</span>
                <select
                  value={namespaceFilter}
                  onChange={(e) => setNamespaceFilter(e.target.value)}
                  className="text-xs border-none bg-transparent focus:ring-0 cursor-pointer font-medium"
                >
                  <option value="">All Namespaces</option>
                  {availableNamespaces.map(ns => (
                    <option key={ns} value={ns}>{ns}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-1.5 border-l pl-3">
              <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                <span className="text-xs">↵</span>
              </kbd>
            </div>
          </div>
          <CommandList>
            <CommandEmpty>
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6">
                  <IconLoader className="h-4 w-4 animate-spin" />
                  <span>{t('globalSearch.searching')}</span>
                </div>
              ) : query.length < 2 ? (
                t('globalSearch.emptyHint')
              ) : (
                t('globalSearch.noResults')
              )}
            </CommandEmpty>

            {sidebarResults.length > 0 && (
              <CommandGroup heading={t('globalSearch.navigation')}>
                {sidebarResults.map((item) => {
                  const Icon = item.Icon
                  return (
                    <CommandItem
                      key={`nav-${item.id}`}
                      value={`${item.title} ${item.groupLabel || ''} ${item.url}`}
                      onSelect={() => handleSelect(item.url)}
                      className="flex items-center gap-3 py-3"
                    >
                      <Icon className="h-4 w-4 text-sidebar-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            <Highlight text={item.title} query={query} />
                          </span>
                          {item.groupLabel ? (
                            <Badge className="text-xs" variant="outline">
                              {item.groupLabel}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {item.url}
                        </div>
                      </div>
                      {item.isPinned ? (
                        <Badge className="text-xs" variant="secondary">
                          {t('sidebar.pinned', 'Pinned')}
                        </Badge>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            {actionResults.length > 0 && (
              <CommandGroup heading={t('globalSearch.actions')}>
                {actionResults.map((actionOption) => (
                  <CommandItem
                    key={actionOption.id}
                    value={`${actionOption.label} theme toggle mode`}
                    onSelect={() => {
                      actionOption.onSelect()
                      onOpenChange(false)
                      setQuery('')
                    }}
                    className="flex items-center gap-3 py-3"
                  >
                    <actionOption.icon className="h-4 w-4 text-sidebar-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {actionOption.label}
                        </span>
                        {actionOption.id === 'toggle-theme' && (
                          <Badge className="text-xs" variant="outline">
                            {actualTheme === 'dark'
                              ? 'Switch to Light'
                              : 'Switch to Dark'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.length > 0 && (
              <CommandGroup
                heading={
                  query.length < 2
                    ? t('globalSearch.favorites')
                    : t('globalSearch.resources')
                }
              >
                {results
                  .filter(result => canAccess(result.resourceType as any, 'get', result.namespace))
                  .map((result) => {
                    const config = RESOURCE_CONFIG[result.resourceType] || {
                      label: result.resourceType,
                      icon: IconBox, // Default icon if not found
                    }
                    const Icon = config.icon
                    const isFav = isFavorite(result.id)
                    const path = result.namespace
                      ? `/${result.resourceType}/${result.namespace}/${result.name}`
                      : `/${result.resourceType}/${result.name}`
                    const isPod = result.resourceType === 'pods'
                    const canExec = result.resourceType === 'pods' && canAccess('pods', 'exec', result.namespace)
                    const canLogs = result.resourceType === 'pods' && canAccess('pods', 'get', result.namespace)
                    return (
                      <CommandItem
                        key={result.id}
                        value={`${result.name} ${result.namespace || ''} ${result.resourceType} ${RESOURCE_CONFIG[result.resourceType]?.label ||
                          result.resourceType
                          }`}
                        onSelect={() => handleSelect(path)}
                        className="flex items-center gap-3 py-3"
                      >
                        <Icon className="h-4 w-4 text-sidebar-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">
                              <Highlight text={result.name} query={query} />
                            </span>
                            <Badge className="text-xs">
                              {RESOURCE_CONFIG[result.resourceType]?.label
                                ? t(
                                  RESOURCE_CONFIG[result.resourceType]
                                    .label as string
                                )
                                : result.resourceType}
                            </Badge>
                          </div>
                          {result.namespace && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Namespace: <Highlight text={result.namespace} query={query} />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isPod && (canExec || canLogs) && (
                            <div className="flex items-center gap-1">
                              {canExec && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handlePodAction(result, 'terminal')
                                  }}
                                  className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                                >
                                  Shell
                                </button>
                              )}
                              {canLogs && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handlePodAction(result, 'logs')
                                  }}
                                  className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                                >
                                  Logs
                                </button>
                              )}
                            </div>
                          )}
                          <QuickYamlDialog
                            resourceType={result.resourceType as ResourceType}
                            name={result.name}
                            namespace={result.namespace}
                            triggerVariant="ghost"
                            triggerSize="icon"
                            className="h-7 w-7 p-0"
                          />
                        </div>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleFavorite(result, e)
                          }}
                          className="p-1 hover:bg-accent rounded transition-colors z-10 relative"
                        >
                          {isFav ? (
                            <IconStarFilled className="h-3 w-3 text-yellow-500" />
                          ) : (
                            <IconStar className="h-3 w-3 text-muted-foreground opacity-50" />
                          )}
                        </button>
                      </CommandItem>
                    )
                  })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
