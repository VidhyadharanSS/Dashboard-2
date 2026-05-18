import { useCallback, useEffect, useMemo, useState } from 'react'
import { Filter, Loader2, Plus, Tag, Trash2, X } from 'lucide-react'

import { fetchResources } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import {
  type Operator,
  type QueryRule,
  createRule,
  matchesRule,
  rulesToSelector,
  selectorToRules,
  splitSelectorParts,
} from './workload-query-selector.utils'

export type { Operator, QueryRule }
export { splitSelectorParts, selectorToRules, rulesToSelector, matchesRule }

/**
 * Safely extract an items array from any API response shape.
 * Handles: plain arrays, { items: [...] }, null/undefined, and non-object values.
 */
function extractItemsArray(data: unknown): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items
  }
  return []
}

interface WorkloadQuerySelectorProps {
  resourceType: string
  namespace?: string
  onSelectorChange: (selector: string) => void
  initialSelector?: string
  presets?: { label: string; selector: string }[]
}

const DEFAULT_PRESETS = [
  { label: 'App', selector: 'app' },
  { label: 'Part-of', selector: 'app.kubernetes.io/part-of' },
  { label: 'Managed By', selector: 'app.kubernetes.io/managed-by' },
]

const OPERATORS: { value: Operator; label: string; needsValue: boolean }[] = [
  { value: '=', label: '=', needsValue: true },
  { value: '!=', label: '!=', needsValue: true },
  { value: 'in', label: 'in', needsValue: true },
  { value: 'notin', label: 'notin', needsValue: true },
  { value: 'exists', label: 'exists', needsValue: false },
  { value: '!exists', label: '!exists', needsValue: false },
]

export function WorkloadQuerySelector({
  resourceType,
  namespace,
  onSelectorChange,
  initialSelector = '',
  presets = DEFAULT_PRESETS,
}: WorkloadQuerySelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [rules, setRules] = useState<QueryRule[]>(() => selectorToRules(initialSelector))
  const [rawInput, setRawInput] = useState(initialSelector)

  useEffect(() => {
    setRules(selectorToRules(initialSelector))
    setRawInput(initialSelector)
  }, [initialSelector])

  // Fetch resources to discover label keys/values
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setIsLoading(true)
    fetchResources(resourceType, namespace)
      .then((data: unknown) => {
        if (cancelled) return
        // Safely extract items array from any response shape
        const extracted = extractItemsArray(data)
        setItems(extracted)
      })
      .catch(() => { if (!cancelled) setItems([]) })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [isOpen, resourceType, namespace])

  const appliedSelector = useMemo(() => rulesToSelector(rules), [rules])

  useEffect(() => {
    setRawInput(appliedSelector)
    onSelectorChange(appliedSelector)
  }, [appliedSelector, onSelectorChange])

  // Extract all label keys and their values from fetched items
  const labelMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const safeItems = Array.isArray(items) ? items : []
    for (let i = 0; i < safeItems.length; i++) {
      const item = safeItems[i]
      const labels = item?.metadata?.labels
      if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
        const entries = Object.entries(labels)
        for (let j = 0; j < entries.length; j++) {
          const [key, val] = entries[j]
          if (!map.has(key)) map.set(key, new Set())
          map.get(key)!.add(String(val))
        }
      }
    }
    return map
  }, [items])

  const labelKeys = useMemo(() => Array.from(labelMap.keys()).sort(), [labelMap])

  // Count matches
  const matchCount = useMemo(() => {
    if (rules.length === 0) return items.length
    return items.filter((item) => {
      const labels = (item?.metadata?.labels || {}) as Record<string, string>
      return rules.every((rule) => matchesRule(labels, rule))
    }).length
  }, [items, rules])

  const updateRule = useCallback((id: string, updater: (current: QueryRule) => QueryRule) => {
    setRules((current) => current.map((rule) => rule.id === id ? updater(rule) : rule))
  }, [])

  const addRule = useCallback((presetSelector?: string) => {
    if (presetSelector) {
      setRules((current) => [...current, ...selectorToRules(presetSelector)])
      return
    }
    setRules((current) => [...current, createRule()])
  }, [])

  const removeRule = useCallback((id: string) => {
    setRules((current) => current.filter((rule) => rule.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setRules([])
    setRawInput('')
  }, [])

  const applyRawSelector = useCallback(() => {
    setRules(selectorToRules(rawInput))
  }, [rawInput])

  const hasFilter = !!appliedSelector

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 gap-1.5 text-xs font-normal shrink-0 transition-colors',
              hasFilter && 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'
            )}
          >
            <Tag className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Labels</span>
            {hasFilter && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-bold ml-0.5">
                {matchCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[380px] p-0" align="start">
          {/* Header */}
          <div className="px-3 py-2.5 border-b bg-muted/30">
            <p className="text-xs font-semibold">Filter by Labels</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Select a label key and value, or type a raw selector below
            </p>
          </div>

          <div className="p-3 space-y-3">
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.selector}
                  onClick={() => addRule(preset.selector)}
                  className="px-2 py-0.5 text-[10px] rounded-full border bg-muted/40 text-muted-foreground hover:bg-muted border-border/60 hover:text-foreground transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {rules.map((rule) => {
                const values = Array.from(labelMap.get(rule.key) || []).sort()
                const operator = OPERATORS.find((item) => item.value === rule.operator)
                return (
                  <div key={rule.id} className="grid grid-cols-[1.5fr_0.9fr_1.6fr_auto] gap-2 items-start">
                    <Select
                      value={rule.key}
                      onValueChange={(value) => updateRule(rule.id, (current) => ({
                        ...current,
                        key: value,
                        values: current.operator === 'exists' || current.operator === '!exists' ? [] : current.values.length > 0 ? current.values : [''],
                      }))}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono">
                        <SelectValue placeholder={isLoading ? 'Loading labels...' : 'Select label key'} />
                      </SelectTrigger>
                      <SelectContent>
                        {labelKeys.map((key) => (
                          <SelectItem key={key} value={key} className="font-mono text-xs">
                            {key}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={rule.operator}
                      onValueChange={(value: Operator) => updateRule(rule.id, (current) => ({
                        ...current,
                        operator: value,
                        values: OPERATORS.find((item) => item.value === value)?.needsValue
                          ? current.values.length > 0 ? current.values : ['']
                          : [],
                      }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map((item) => (
                          <SelectItem key={item.value} value={item.value} className="text-xs">
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {operator?.needsValue ? (
                      rule.operator === 'in' || rule.operator === 'notin' ? (
                        <Input
                          value={rule.values.join(',')}
                          onChange={(event) => updateRule(rule.id, (current) => ({
                            ...current,
                            values: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                          }))}
                          placeholder={values.slice(0, 3).join(',') || 'value-a,value-b'}
                          className="h-8 text-xs font-mono"
                        />
                      ) : (
                        <Input
                          value={rule.values[0] || ''}
                          onChange={(event) => updateRule(rule.id, (current) => ({
                            ...current,
                            values: [event.target.value],
                          }))}
                          placeholder={values[0] || 'value'}
                          className="h-8 text-xs font-mono"
                          list={`selector-values-${rule.id}`}
                        />
                      )
                    ) : (
                      <div className="h-8 px-2 rounded-md border bg-muted/40 text-[10px] text-muted-foreground flex items-center">
                        No value needed
                      </div>
                    )}

                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRule(rule.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>

                    {values.length > 0 && (rule.operator === '=' || rule.operator === '!=') && (
                      <datalist id={`selector-values-${rule.id}`}>
                        {values.map((value) => <option key={value} value={value} />)}
                      </datalist>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" className="h-8 text-xs gap-1.5" onClick={() => addRule()}>
                <Plus className="h-3.5 w-3.5" />
                Add Rule
              </Button>
              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>

            <div className="space-y-1.5 pt-2 border-t">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Raw Selector</label>
              <div className="flex gap-1.5">
                <Input
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder="app=nginx,tier notin (frontend,canary),!debug"
                  className="h-8 text-xs font-mono"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2 text-xs shrink-0"
                  onClick={applyRawSelector}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/20">
            <span className="text-[10px] text-muted-foreground">
              {hasFilter ? (
                <><span className="font-semibold text-primary">{matchCount}</span> / {(Array.isArray(items) ? items : []).length} match</>
              ) : (
                <>{(Array.isArray(items) ? items : []).length} {resourceType} total</>
              )}
            </span>
            {hasFilter && (
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={clearAll}>
                <X className="h-2.5 w-2.5" />
                Clear
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active filter chips */}
      {hasFilter && (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
          {splitSelectorParts(appliedSelector).slice(0, 3).map((rule) => (
            <Badge
              key={rule}
              variant="secondary"
              className="h-5 pl-1.5 pr-1 gap-1 font-mono text-[10px] bg-primary/5 border border-primary/15 whitespace-nowrap shrink-0"
            >
              <span className="max-w-[140px] truncate">{rule.trim()}</span>
            </Badge>
          ))}
          {splitSelectorParts(appliedSelector).length > 3 && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] shrink-0">
              +{splitSelectorParts(appliedSelector).length - 3}
            </Badge>
          )}
          <button
            onClick={clearAll}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1 shrink-0"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
