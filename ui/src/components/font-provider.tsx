/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// 1. Change the available font option to just 'zoho'.
type FontOption = 'zoho'

type FontProviderProps = {
  children: React.ReactNode
  defaultFont?: FontOption
  storageKey?: string
}

type FontProviderState = {
  font: FontOption
  setFont: (font: FontOption) => void
}

// 2. Set the initial state to use 'zoho' by default.
const initialState: FontProviderState = {
  font: 'zoho',
  setFont: () => null,
}

const FontProviderContext = createContext<FontProviderState>(initialState)

export function FontProvider({
  children,
  // 3. Update the default prop to 'zoho'.
  defaultFont = 'zoho',
  storageKey = 'vite-ui-font',
  ...props
}: FontProviderProps) {
  const [font, setFont] = useState<FontOption>(
    () => (localStorage.getItem(storageKey) as FontOption) || defaultFont
  )

  useEffect(() => {
    const root = window.document.documentElement
    // 4. Remove all 'if' conditions. Hard-code the CSS variable to use Zoho Puvi.
    const value = "'Zoho Puvi', var(--font-sans)"
    root.style.setProperty('--app-font-sans', value)
    localStorage.setItem(storageKey, font)
  }, [font, storageKey])

  const value = useMemo(
    () => ({
      font,
      setFont: (f: FontOption) => setFont(f),
    }),
    [font]
  )

  return (
    <FontProviderContext.Provider {...props} value={value}>
      {children}
    </FontProviderContext.Provider>
  )
}

export const useFont = () => {
  const context = useContext(FontProviderContext)
  if (context === undefined)
    throw new Error('useFont must be used within a FontProvider')
  return context
}
