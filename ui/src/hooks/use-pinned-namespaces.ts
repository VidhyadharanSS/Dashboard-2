import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'kite:pinned-namespaces:'

function load(clusterName: string | null): string[] {
    if (!clusterName) return []
    try {
        const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${clusterName}`)
        if (!raw) return []
        return JSON.parse(raw) as string[]
    } catch {
        return []
    }
}

function save(clusterName: string | null, namespaces: string[]) {
    if (!clusterName) return
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${clusterName}`, JSON.stringify(namespaces))
}

export function usePinnedNamespaces(clusterName: string | null) {
    const [pinned, setPinned] = useState<string[]>(() => load(clusterName))

    // Refresh state when cluster changes
    useEffect(() => {
        setPinned(load(clusterName))
    }, [clusterName])

    // Save to specific cluster key whenever pinned state changes
    useEffect(() => {
        save(clusterName, pinned)
    }, [pinned, clusterName])

    const pin = useCallback((ns: string) => {
        setPinned(prev => prev.includes(ns) ? prev : [ns, ...prev])
    }, [])

    const unpin = useCallback((ns: string) => {
        setPinned(prev => prev.filter(n => n !== ns))
    }, [])

    const toggle = useCallback((ns: string) => {
        setPinned(prev =>
            prev.includes(ns) ? prev.filter(n => n !== ns) : [ns, ...prev]
        )
    }, [])

    const isPinned = useCallback(
        (ns: string) => pinned.includes(ns),
        [pinned]
    )

    return { pinned, pin, unpin, toggle, isPinned }
}