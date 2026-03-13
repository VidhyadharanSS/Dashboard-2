/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'system'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  actualTheme: Omit<Theme, 'system'>
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: 'light',
  setTheme: () => null,
  actualTheme: 'light',
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

/**
 * Resolve the initial theme.
 * If the stored value is 'system' (legacy), resolve it to the OS preference
 * and persist the resolved value so 'system' is never used again.
 */
function resolveInitialTheme(storageKey: string, defaultTheme: Theme): 'light' | 'dark' {
  const stored = localStorage.getItem(storageKey) as Theme | null
  if (stored === 'light' || stored === 'dark') return stored

  // Legacy 'system' or no stored value → resolve from OS preference
  const resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  localStorage.setItem(storageKey, resolved)
  return resolved
}

export function ThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => resolveInitialTheme(storageKey, defaultTheme)
  )

  // actualTheme is always the same as theme now (no 'system')
  const actualTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(actualTheme as string)
  }, [actualTheme])

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      // If someone passes 'system', resolve it immediately
      const resolved: 'light' | 'dark' = newTheme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : newTheme
      localStorage.setItem(storageKey, resolved)
      setTheme(resolved)
    },
    actualTheme,
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
