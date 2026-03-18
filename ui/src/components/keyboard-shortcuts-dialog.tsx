/**
 * Feature: Keyboard Shortcuts Panel
 *
 * Press `?` (when not focused on an input) to open a dialog showing all
 * available keyboard shortcuts. Also registers the shortcuts themselves.
 *
 * Shortcuts:
 *  - ? : Open this dialog
 *  - Ctrl+K / Cmd+K : Global search
 *  - Ctrl+J / Cmd+J : Create resource
 *  - Ctrl+Shift+E : Open Live Events drawer
 *  - Ctrl+Shift+A : Open Audit Log drawer
 *  - G then H : Go to Overview (home)
 *  - G then P : Go to Pods
 *  - G then D : Go to Deployments
 *  - G then S : Go to Services
 *  - G then N : Go to Nodes
 *  - Escape : Close any open dialog/drawer
 */

import { useCallback, useEffect, useState } from 'react'
import {
    IconCommand,
    IconKeyboard,
    IconArrowRight,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'


interface ShortcutGroup {
    title: string
    shortcuts: {
        keys: string[]
        description: string
    }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        title: 'General',
        shortcuts: [
            { keys: ['?'], description: 'Show keyboard shortcuts' },
            { keys: ['Ctrl', 'K'], description: 'Open global search' },
            { keys: ['Ctrl', 'F'], description: 'Open favorites' },
            { keys: ['Ctrl', 'J'], description: 'Create new resource' },
            { keys: ['Esc'], description: 'Close dialogs & drawers' },
        ],
    },
    {
        title: 'Drawers',
        shortcuts: [
            { keys: ['Ctrl', 'Shift', 'E'], description: 'Toggle Live Events' },
            { keys: ['Ctrl', 'Shift', 'A'], description: 'Toggle Audit Log' },
        ],
    },
    {
        title: 'Navigation (press G then...)',
        shortcuts: [
            { keys: ['G', 'H'], description: 'Go to Overview (Home)' },
            { keys: ['G', 'P'], description: 'Go to Pods' },
            { keys: ['G', 'D'], description: 'Go to Deployments' },
            { keys: ['G', 'S'], description: 'Go to Services' },
            { keys: ['G', 'N'], description: 'Go to Nodes' },
            { keys: ['G', 'I'], description: 'Go to Ingresses' },
            { keys: ['G', 'C'], description: 'Go to ConfigMaps' },
            { keys: ['G', 'J'], description: 'Go to Jobs' },
        ],
    },
]

const NAV_MAP: Record<string, string> = {
    h: '/',
    p: '/pods',
    d: '/deployments',
    s: '/services',
    n: '/nodes',
    i: '/ingresses',
    c: '/configmaps',
    j: '/jobs',
}

function KeyBadge({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground shadow-sm">
            {children}
        </kbd>
    )
}

export function KeyboardShortcutsDialog() {
    const [open, setOpen] = useState(false)
    const navigate = useNavigate()
    const [waitingForNav, setWaitingForNav] = useState(false)
    const [navTimeout, setNavTimeout] = useState<NodeJS.Timeout | null>(null)

    const isInputFocused = useCallback(() => {
        const el = document.activeElement
        if (!el) return false
        const tag = el.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
        if ((el as HTMLElement).contentEditable === 'true') return true
        // Check if inside a CodeMirror or Monaco editor
        if (el.closest('.cm-editor, .monaco-editor')) return true
        return false
    }, [])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger in inputs
            if (isInputFocused()) return

            // ? key — open shortcuts dialog
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault()
                setOpen(prev => !prev)
                return
            }

            // Ctrl+Shift+E — toggle Live Events drawer
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
                e.preventDefault()
                // Dispatch custom event for the LiveEventDrawer
                window.dispatchEvent(new CustomEvent('toggle-events-drawer'))
                return
            }

            // Ctrl+Shift+A — toggle Audit Log drawer
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
                e.preventDefault()
                window.dispatchEvent(new CustomEvent('toggle-audit-drawer'))
                return
            }

            // G key — start navigation sequence
            if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                if (!waitingForNav) {
                    setWaitingForNav(true)
                    const t = setTimeout(() => setWaitingForNav(false), 1500)
                    setNavTimeout(t)
                    return
                }
            }

            // Second key in nav sequence
            if (waitingForNav && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                const route = NAV_MAP[e.key.toLowerCase()]
                if (route) {
                    e.preventDefault()
                    navigate(route)
                }
                setWaitingForNav(false)
                if (navTimeout) clearTimeout(navTimeout)
                return
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isInputFocused, waitingForNav, navTimeout, navigate])

    // Cleanup nav timeout on unmount
    useEffect(() => {
        return () => {
            if (navTimeout) clearTimeout(navTimeout)
        }
    }, [navTimeout])

    return (
        <>
            {/* Navigation hint toast */}
            {waitingForNav && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background shadow-2xl border">
                        <KeyBadge>G</KeyBadge>
                        <IconArrowRight className="h-3 w-3 opacity-60" />
                        <span className="text-sm font-medium">Press a key to navigate...</span>
                        <span className="text-xs opacity-60 ml-2">
                            H=home P=pods D=deploy S=svc N=nodes
                        </span>
                    </div>
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                            <IconKeyboard className="h-4 w-4" />
                            Keyboard Shortcuts
                        </DialogTitle>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-5 pr-1">
                        {SHORTCUT_GROUPS.map((group) => (
                            <div key={group.title}>
                                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                                    {group.title}
                                </h3>
                                <div className="space-y-1.5">
                                    {group.shortcuts.map((shortcut, idx) => (
                                        <div
                                            key={idx}
                                            className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
                                        >
                                            <span className="text-sm text-foreground/85">
                                                {shortcut.description}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0 ml-4">
                                                {shortcut.keys.map((key, ki) => (
                                                    <span key={ki} className="flex items-center gap-1">
                                                        {ki > 0 && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {group.title.includes('Navigation') ? 'then' : '+'}
                                                            </span>
                                                        )}
                                                        <KeyBadge>
                                                            {key === 'Ctrl' ? (
                                                                <span className="flex items-center gap-0.5">
                                                                    <IconCommand className="h-3 w-3" /> 
                                                                </span>
                                                            ) : key}
                                                        </KeyBadge>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="pt-3 border-t mt-2">
                        <p className="text-[11px] text-muted-foreground text-center">
                            Press <KeyBadge>?</KeyBadge> anytime to toggle this panel
                        </p>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
