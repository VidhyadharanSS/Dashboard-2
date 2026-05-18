import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'kite:pinned-namespaces:'

/**
 * Custom event name used to broadcast pinned-namespace changes to ALL
 * hook instances within the **same tab**.  `StorageEvent` only fires
 * in *other* tabs, so we need this for same-tab synchronization between
 * the namespace-selector (where pin/unpin buttons live) and the
 * NamespaceQuickSwitch header pills.
 */
const PINNED_CHANGE_EVENT = 'kite:pinned-namespaces-changed'

function storageKey(clusterName: string | null): string {
    return `${STORAGE_KEY_PREFIX}${clusterName ?? ''}`
}

function load(clusterName: string | null): string[] {
    if (!clusterName) return []
    try {
        const raw = localStorage.getItem(storageKey(clusterName))
        if (!raw) return []
        return JSON.parse(raw) as string[]
    } catch {
        return []
    }
}

function save(clusterName: string | null, namespaces: string[]) {
    if (!clusterName) return
    localStorage.setItem(storageKey(clusterName), JSON.stringify(namespaces))
}

/**
 * Broadcast a pinned-namespace change so every mounted `usePinnedNamespaces`
 * instance in the same tab re-reads from localStorage immediately.
 */
function broadcastChange(clusterName: string | null) {
    window.dispatchEvent(
        new CustomEvent(PINNED_CHANGE_EVENT, { detail: { clusterName } })
    )
}

export function usePinnedNamespaces(clusterName: string | null) {
    const [pinned, setPinned] = useState<string[]>(() => load(clusterName))

    // Refresh state when cluster changes
    useEffect(() => {
        setPinned(load(clusterName))
    }, [clusterName])

    // ── Same-tab sync: listen for changes from other hook instances ──
    useEffect(() => {
        const onPinnedChange = (e: Event) => {
            const detail = (e as CustomEvent).detail
            // Only react if the change is for our cluster (or no cluster specified)
            if (!detail?.clusterName || detail.clusterName === clusterName) {
                setPinned(load(clusterName))
            }
        }

        // Same-tab broadcast
        window.addEventListener(PINNED_CHANGE_EVENT, onPinnedChange)

        // Cross-tab sync (StorageEvent fires only in other tabs)
        const onStorage = (e: StorageEvent) => {
            if (e.key === storageKey(clusterName)) {
                setPinned(load(clusterName))
            }
        }
        window.addEventListener('storage', onStorage)

        return () => {
            window.removeEventListener(PINNED_CHANGE_EVENT, onPinnedChange)
            window.removeEventListener('storage', onStorage)
        }
    }, [clusterName])

    /**
     * Internal helper: update state → persist → broadcast to other instances.
     * The broadcast triggers a re-read in every other mounted hook, so the
     * header pills update the instant a pin/unpin happens in the selector.
     */
    const updatePinned = useCallback((updater: (prev: string[]) => string[]) => {
        setPinned(prev => {
            const next = updater(prev)
            save(clusterName, next)
            // Broadcast AFTER save so listeners read the fresh value
            setTimeout(() => broadcastChange(clusterName), 0)
            return next
        })
    }, [clusterName])

    const pin = useCallback((ns: string) => {
        updatePinned(prev => prev.includes(ns) ? prev : [ns, ...prev])
    }, [updatePinned])

    const unpin = useCallback((ns: string) => {
        updatePinned(prev => prev.filter(n => n !== ns))
    }, [updatePinned])

    const toggle = useCallback((ns: string) => {
        updatePinned(prev =>
            prev.includes(ns) ? prev.filter(n => n !== ns) : [ns, ...prev]
        )
    }, [updatePinned])

    const isPinned = useCallback(
        (ns: string) => pinned.includes(ns),
        [pinned]
    )

    return { pinned, pin, unpin, toggle, isPinned }
}
