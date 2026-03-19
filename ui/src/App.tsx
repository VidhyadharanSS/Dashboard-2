import './App.css'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { AppSidebar } from './components/app-sidebar'
import { GlobalSearch } from './components/global-search'
import {
  GlobalSearchProvider,
  useGlobalSearch,
} from './components/global-search-provider'
import { SiteHeader } from './components/site-header'
import { SidebarInset, SidebarProvider, useSidebar } from './components/ui/sidebar'
import { Toaster } from './components/ui/sonner'
import { ClusterProvider } from './contexts/cluster-context'
import { useCluster } from './hooks/use-cluster'
import { apiClient } from './lib/api-client'

function ClusterAwareApp() {
  const { t } = useTranslation()
  const { currentCluster, isLoading, error } = useCluster()

  useEffect(() => {
    apiClient.setClusterProvider(() => {
      return currentCluster || localStorage.getItem('current-cluster')
    })
  }, [currentCluster])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center space-x-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <span>{t('cluster.loading')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">
          <p>{t('cluster.error', { error: error.message })}</p>
        </div>
      </div>
    )
  }

  return <AppContent />
}

function SidebarFloatingToggle() {
  const { state, toggleSidebar } = useSidebar()
  const isCollapsed = state === 'collapsed'
  return (
    <button
      onClick={toggleSidebar}
      className={`
        fixed bottom-6 z-50 flex items-center gap-1.5 rounded-full
        bg-background/90 backdrop-blur-md border border-border/60
        shadow-lg shadow-black/10 text-muted-foreground hover:text-foreground
        hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10
        transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        group text-xs font-medium
        ${isCollapsed ? 'left-[calc(var(--sidebar-width-icon)+0.5rem)] px-2.5 py-2' : 'left-[calc(var(--sidebar-width)+0.5rem)] px-3 py-2'}
      `}
      title={isCollapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
    >
      {isCollapsed ? (
        <PanelLeftOpen className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
      ) : (
        <>
          <PanelLeftClose className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
          <span className="hidden sm:inline">Collapse</span>
        </>
      )}
    </button>
  )
}

function AppContent() {
  const { isOpen, closeSearch } = useGlobalSearch()
  const [searchParams] = useSearchParams()
  const isIframe = searchParams.get('iframe') === 'true'
  const navigate = useNavigate()

  // Persist sidebar open/closed state in localStorage
  const [sidebarDefaultOpen] = useState(() => {
    const stored = localStorage.getItem('sidebar-open')
    return stored === null ? true : stored === 'true'
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (((e.metaKey || e.ctrlKey) && e.altKey && e.key === 's') ||
        ((e.metaKey || e.ctrlKey) && e.key === ',')) {
        e.preventDefault()
        navigate('/settings')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  if (isIframe) {
    return <Outlet />
  }

  return (
    <>
      <SidebarProvider
        defaultOpen={sidebarDefaultOpen}
        onOpenChange={(open) => localStorage.setItem('sidebar-open', String(open))}
      >
        <AppSidebar variant="inset" />
        <SidebarInset className="h-screen overflow-y-auto scrollbar-hide">
          <SiteHeader />
          <div className="@container/main animate-in fade-in duration-300">
            <div className="flex flex-col gap-4 py-4 md:gap-6">
              <div className="px-4 lg:px-6">
                <Outlet />
              </div>
            </div>
          </div>
        </SidebarInset>
        <SidebarFloatingToggle />
      </SidebarProvider>
      <GlobalSearch open={isOpen} onOpenChange={closeSearch} />
      <Toaster />
    </>
  )
}

function App() {
  return (
    <ClusterProvider>
      <GlobalSearchProvider>
        <ClusterAwareApp />
      </GlobalSearchProvider>
    </ClusterProvider>
  )
}

export default App
