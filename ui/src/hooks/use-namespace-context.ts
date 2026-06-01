/**
 * useNamespaceContext - Global namespace context switcher.
 *
 * Provides a single source of truth for the "active namespace" across all list pages.
 * Pinned namespaces always appear first in the switcher, accessible from the header.
 * Any list page can call `useNamespaceContext()` to read/set the active namespace.
 *
 * The active namespace is stored in sessionStorage (survives page refresh within same tab,
 * but not across tabs - intentional: each tab can track different workspaces).
 */
import { useCallback, useEffect, useState } from 'react'
import { usePinnedNamespaces } from './use-pinned-namespaces'
import { useCluster } from '@/contexts/cluster-context'

const SESSION_KEY = 'kite:active-namespace'

export type NamespaceContextValue = {
    /** Currently active namespace. '_all' means all namespaces. */
    activeNamespace: string
    /** Set the global active namespace */
    setActiveNamespace: (ns: string) => void
    /** Pinned namespaces from the user's saved preferences */
    pinned: string[]
    /** Toggle a namespace's pinned state */
    togglePin: (ns: string) => void
    /** Whether a namespace is pinned */
    isPinned: (ns: string) => boolean
    /** Clear the active namespace context (reset to '_all') */
    clearContext: () => void
}

export function useNamespaceContext(): NamespaceContextValue {
    const { currentCluster } = useCluster()
    const [activeNamespace, setActiveNamespaceState] = useState<string>(() => {
        try {
            return sessionStorage.getItem(SESSION_KEY) || '_all'
        } catch {
            return '_all'
        }
    })

    const { pinned, toggle: togglePin, isPinned } = usePinnedNamespaces(currentCluster)

    const setActiveNamespace = useCallback((ns: string) => {
        try {
            sessionStorage.setItem(SESSION_KEY, ns)
        } catch { /* ignore */ }
        setActiveNamespaceState(ns)
    }, [])

    const clearContext = useCallback(() => {
        setActiveNamespace('_all')
    }, [setActiveNamespace])

    // Sync across components in the same tab via storage events
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === SESSION_KEY && e.newValue) {
                setActiveNamespaceState(e.newValue)
            }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    return {
        activeNamespace,
        setActiveNamespace,
        pinned,
        togglePin,
        isPinned,
        clearContext
    }
}