import { useState, useCallback, useEffect } from 'react'

/**
 * A hook that behaves like `useState` but persists its value to sessionStorage.
 * Useful for keeping filter/query states across navigations within the same session.
 *
 * The key is automatically prefixed with the current cluster to avoid cross-cluster collisions.
 */
export function useSessionState<T>(
    key: string,
    defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
    const storageKey = `${localStorage.getItem('current-cluster') || 'default'}-${key}`

    const [state, setStateInternal] = useState<T>(() => {
        try {
            const stored = sessionStorage.getItem(storageKey)
            if (stored !== null) {
                return JSON.parse(stored)
            }
        } catch {
            // Ignore parse errors
        }
        return defaultValue
    })

    // Persist on change
    useEffect(() => {
        try {
            const serialized = JSON.stringify(state)
            const defaultSerialized = JSON.stringify(defaultValue)
            if (serialized === defaultSerialized) {
                sessionStorage.removeItem(storageKey)
            } else {
                sessionStorage.setItem(storageKey, serialized)
            }
        } catch {
            // Ignore storage errors
        }
    }, [state, storageKey, defaultValue])

    const setState = useCallback(
        (value: T | ((prev: T) => T)) => {
            setStateInternal(value)
        },
        []
    )

    const clearState = useCallback(() => {
        setStateInternal(defaultValue)
        try {
            sessionStorage.removeItem(storageKey)
        } catch {
            // Ignore
        }
    }, [defaultValue, storageKey])

    return [state, setState, clearState]
}
