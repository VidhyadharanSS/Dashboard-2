'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface TabItem {
  value: string
  label: React.ReactNode
  content: React.ReactNode
}

interface ResponsiveTabsProps {
  tabs: TabItem[]
  className?: string
  tabsListClassName?: string
}

export function ResponsiveTabs({
  tabs,
  className,
  tabsListClassName,
}: ResponsiveTabsProps) {
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()

  // Stable set of valid tab values (only recompute when tab keys actually change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tabValuesKey = tabs.map(t => t.value).join(',')
  const tabValues = useMemo(() => tabs.map(t => t.value), [tabValuesKey])

  const initialTab = searchParams.get('tab') || tabs[0]?.value || ''
  const [value, setValue] = useState(initialTab)

  // Track whether we are the source of the URL change to avoid echo loops
  const isInternalUpdate = useRef(false)

  // When the user (or code) changes the active tab, update both state and URL
  const onValueChange = useCallback((newValue: string) => {
    setValue(newValue)
    isInternalUpdate.current = true
    setSearchParams(
      (prev) => {
        prev.set('tab', newValue)
        return prev
      },
      { replace: true }
    )
    // Reset the flag after the current tick so the URL-sync effect doesn't echo
    queueMicrotask(() => { isInternalUpdate.current = false })
  }, [setSearchParams])

  // Sync tab state when URL changes externally (e.g. "View Topology" button in overview)
  useEffect(() => {
    if (isInternalUpdate.current) return // we caused this change, skip
    const tabFromUrl = searchParams.get('tab')
    if (tabFromUrl && tabFromUrl !== value && tabValues.includes(tabFromUrl)) {
      setValue(tabFromUrl)
    }
  }, [searchParams, tabValues, value])

  // On mount, write the active tab to the URL if it's not already there
  useEffect(() => {
    const current = searchParams.get('tab')
    if (!current && value) {
      isInternalUpdate.current = true
      setSearchParams(
        (prev) => {
          prev.set('tab', value)
          return prev
        },
        { replace: true }
      )
      queueMicrotask(() => { isInternalUpdate.current = false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentTab = tabs.find((tab) => tab.value === value)

  if (isMobile) {
    return (
      <div className={cn('space-y-4', className)}>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="w-full">
            <SelectValue>{currentTab?.label || 'Select tab'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab.value} value={tab.value}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {currentTab && <div className="space-y-4">{currentTab.content}</div>}
      </div>
    )
  }

  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList
        className={cn(
          '**:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1',
          tabsListClassName
        )}
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="space-y-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
