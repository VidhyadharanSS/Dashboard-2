import * as React from 'react'
import { useMemo } from 'react'
import Icon from '@/assets/icon.svg'
import { useSidebarConfig } from '@/contexts/sidebar-config-context'
import { CollapsibleContent } from '@radix-ui/react-collapsible'
import { IconLayoutDashboard, IconSearch, IconChartBar } from '@tabler/icons-react'
import { ChevronDown, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { usePermissions } from '@/hooks/use-permissions'


import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

import { ClusterSelector } from './cluster-selector'
import { Collapsible, CollapsibleTrigger } from './ui/collapsible'


export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const { config, isLoading, getIconComponent } = useSidebarConfig()
  const { canAccess } = usePermissions()

  // Helper to map URL to resource type
  const getResourceFromUrl = (url: string) => {
    const parts = url.split('/')
    const base = parts[1] // e.g. "pods", "deployments"
    if (base === 'persistentvolumeclaims') return 'persistentvolumeclaims'
    if (base === 'persistentvolumes') return 'persistentvolumes'
    if (base === 'storageclasses') return 'storageclasses'
    if (base === 'configmaps') return 'configmaps'
    if (base === 'serviceaccounts') return 'serviceaccounts'
    if (base === 'rolebindings') return 'rolebindings'
    if (base === 'clusterroles') return 'clusterroles'
    if (base === 'clusterrolebindings') return 'clusterrolebindings'
    if (base === 'horizontalpodautoscalers') return 'horizontalpodautoscalers'
    return base
  }


  const pinnedItems = useMemo(() => {
    if (!config) return []
    return config.groups
      .flatMap((group) => group.items)
      .filter((item) => config.pinnedItems.includes(item.id))
  }, [config])

  const visiblePinnedItems = useMemo(() => {
    return pinnedItems.filter((item) => {
      const resource = getResourceFromUrl(item.url)
      return canAccess(resource, 'list')
    })
  }, [pinnedItems, canAccess])

  const visibleGroups = useMemo(() => {
    if (!config) return []
    return config.groups
      .filter((group) => group.visible)
      .sort((a, b) => a.order - b.order)
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => !config.pinnedItems.includes(item.id))
          .filter((item) => {
            const resource = getResourceFromUrl(item.url)
            return canAccess(resource, 'list')
          })
          .sort((a, b) => a.order - b.order),
      }))
      .filter((group) => group.items.length > 0)
  }, [config, canAccess])

  const isActive = (url: string) => {
    if (url === '/') {
      return location.pathname === '/'
    }
    if (url === '/crds') {
      return location.pathname == '/crds'
    }
    return location.pathname.startsWith(url)
  }

  const handleMenuItemClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  if (isLoading || !config) {
    return (
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/" onClick={handleMenuItemClick}>
                  <span className="text-base font-semibold">Kites</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <div className="p-4 text-center text-muted-foreground">
            {t('common.loading', 'Loading...')}
          </div>
        </SidebarContent>
      </Sidebar>
    )
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40 bg-sidebar/70 backdrop-blur-xl" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-accent/50 transition-colors"
            >
              <Link to="/" onClick={handleMenuItemClick}>
                <div className="relative flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <img src={Icon} alt="Kites Logo" className="h-8 w-8" />
                    <div className="flex flex-col">
                      <span className="text-base font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        Kites
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('nav.overview')}
                asChild
                isActive={isActive('/')}
                className="transition-all duration-200 hover:bg-accent/60 active:scale-95 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:shadow-sm"
              >
                <Link to="/" onClick={handleMenuItemClick}>
                  <IconLayoutDashboard className="text-sidebar-primary" />
                  <span className="font-medium">{t('nav.overview')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Repositioned Tutorials link */}
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('nav.tutorials', 'Tutorials')}
                asChild
                isActive={isActive('/tutorials')}
                className="transition-all duration-200 hover:bg-accent/60 active:scale-95 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:shadow-sm"
              >
                <Link to="/tutorials" onClick={handleMenuItemClick}>
                  <BookOpen className="text-sidebar-primary h-4 w-4" />
                  <span className="font-medium">{t('nav.tutorials', 'Tutorials')}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* Advanced Search link */}
{}
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Advanced Search"
                asChild
                isActive={isActive('/expression-search')}
                className="transition-all duration-200 hover:bg-accent/60 active:scale-95 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:shadow-sm"
              >
                <Link to="/expression-search" onClick={handleMenuItemClick}>
                  <IconSearch className="text-sidebar-primary h-4 w-4" />
                  <span className="font-medium">Advanced Search</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {}
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Prometheus Metrics"
                asChild
                isActive={isActive('/prometheus')}
                className="transition-all duration-200 hover:bg-accent/60 active:scale-95 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:shadow-sm"
              >
                <Link to="/prometheus" onClick={handleMenuItemClick}>
                  <IconChartBar className="text-sidebar-primary h-4 w-4" />
                  <span className="font-medium">Metrics</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {visiblePinnedItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t('sidebar.pinned', 'Pinned')}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visiblePinnedItems.map((item) => {
                  const IconComponent = getIconComponent(item.icon)
                  const title = item.titleKey
                    ? t(item.titleKey, { defaultValue: item.titleKey })
                    : ''
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        tooltip={title}
                        asChild
                        isActive={isActive(item.url)}
                      >
                        <Link to={item.url} onClick={handleMenuItemClick}>
                          <IconComponent className="text-sidebar-primary" />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleGroups.map((group) => (
          <Collapsible
            key={group.id}
            defaultOpen={!group.collapsed}
            className="group/collapsible"
          >
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors group-data-[state=open]:text-foreground">
                  <span className="uppercase tracking-wide text-xs font-bold">
                    {group.nameKey
                      ? t(group.nameKey, { defaultValue: group.nameKey })
                      : ''}
                  </span>
                  <ChevronDown className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent className="flex flex-col gap-2">
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const IconComponent = getIconComponent(item.icon)
                      const title = item.titleKey
                        ? t(item.titleKey, { defaultValue: item.titleKey })
                        : ''
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            tooltip={title}
                            asChild
                            isActive={isActive(item.url)}
                          >
                            <Link to={item.url} onClick={handleMenuItemClick}>
                              <IconComponent className="text-sidebar-primary" />
                              <span>{title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-gradient-to-r from-muted/40 to-muted/20 border border-border/40 backdrop-blur-sm transition-all duration-200 hover:border-border/60 hover:shadow-sm">
          <ClusterSelector />
        </div>
        <div className="group-data-[collapsible=icon]:hidden flex items-center justify-center px-2 py-1">
          <kbd className="text-[10px] text-muted-foreground/60 font-mono">
            ⌘B to toggle sidebar
          </kbd>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
