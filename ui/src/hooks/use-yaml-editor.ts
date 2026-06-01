import { useCallback, useEffect, useRef, useState } from 'react'
import * as yaml from 'js-yaml'

/**
 * useYamlEditor - Safely manages YAML editor state for Kubernetes resource detail pages.
 *
 * ### Problem solved
 * All detail pages poll server state every N seconds via `useResource`. Without this hook
 * the `useEffect([data])` that seeds the YAML editor would fire on every background refetch,
 * silently overwriting any in-progress user edits - making the editor unusable during high
 * pod-churn scenarios (OOM storms, CrashLoopBackOff cascades, rollouts).
 *
 * ### How it works
 * - On initial data load (empty editor), YAML is set from server.
 * - Once the user types anything, `isDirty` is set to `true`.
 * - While `isDirty`, server updates are **ignored** for the editor.
 * - After a successful save, `isDirty` resets to `false` and the editor re-syncs.
 * - Call `discard()` to manually reset to latest server YAML.
 */
export function useYamlEditor<T>(data: T | undefined) {
    const [yamlContent, setYamlContent] = useState('')
    const isDirtyRef = useRef(false)
    const [isDirty, setIsDirty] = useState(false)

    useEffect(() => {
        if (data !== undefined && !isDirtyRef.current) {
            setYamlContent(yaml.dump(data, { indent: 2 }))
        }
    }, [data])

    const onChange = useCallback((content: string) => {
        setYamlContent(content)
        isDirtyRef.current = true
        setIsDirty(true)
    }, [])

    const markSaved = useCallback(() => {
        isDirtyRef.current = false
        setIsDirty(false)
    }, [])

    const discard = useCallback(() => {
        if (data !== undefined) {
            setYamlContent(yaml.dump(data, { indent: 2 }))
        }
        isDirtyRef.current = false
        setIsDirty(false)
    }, [data])

    return { yamlContent, setYamlContent, onChange, isDirty, markSaved, discard }
}
