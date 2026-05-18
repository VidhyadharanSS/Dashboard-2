import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Filter, Plus, Trash2, X, ChevronDown, HelpCircle, Sparkles } from 'lucide-react'
import { Node } from 'kubernetes-types/core/v1'

import { fetchResources } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Kubernetes label selector operators
type Operator = '=' | '!=' | 'in' | 'notin' | 'exists' | '!exists'

interface QueryRule {
  id: string
  key: string
  operator: Operator
  values: string[] // empty for exists/!exists
}

const OPERATORS: { value: Operator; label: string; description: string; needsValue: boolean }[] = [
  { value: '=', label: '=', description: 'Equals — label value must match exactly', needsValue: true },
  { value: '!=', label: '≠', description: 'Not equals — label value must not match', needsValue: true },
  { value: 'in', label: 'in', description: 'In set — value is one of the listed values', needsValue: true },
  { value: 'notin', label: 'not in', description: 'Not in set — value is not any of the listed', needsValue: true },
  { value: 'exists', label: 'exists', description: 'Key exists — label key is present (any value)', needsValue: false },
  { value: '!exists', label: '! exists', description: 'Not exists — label key is not present', needsValue: false },
]

// Convert rules to Kubernetes label selector string
function rulesToSelector(rules: QueryRule[]): string {
  return rules
    .filter(r => r.key.trim() !== '')
    .map(rule => {
      const key = rule.key.trim()
      switch (rule.operator) {
        case '=':
          return `${key}=${rule.values[0] || ''}`
        case '!=':
          return `${key}!=${rule.values[0] || ''}`
        case 'in':
          return `${key} in (${rule.values.join(',')})`
        case 'notin':
          return `${key} notin (${rule.values.join(',')})`
        case 'exists':
          return key
        case '!exists':
          return `!${key}`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join(',')
}

// Parse a label selector string back into rules
function selectorToRules(selector: string): QueryRule[] {
  if (!selector.trim()) return []
  const rules: QueryRule[] = []
  // Simple parsing: split by comma, detect operator
  const parts = selector.split(',').map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const id = Math.random().toString(36).slice(2, 9)
    // Check "in" / "notin"
    const inMatch = part.match(/^(.+?)\s+in\s+\((.+)\)$/)
    if (inMatch) {
      rules.push({ id, key: inMatch[1].trim(), operator: 'in', values: inMatch[2].split(',').map(v => v.trim()) })
      continue
    }
    const notinMatch = part.match(/^(.+?)\s+notin\s+\((.+)\)$/)
    if (notinMatch) {
      rules.push({ id, key: notinMatch[1].trim(), operator: 'notin', values: notinMatch[2].split(',').map(v => v.trim()) })
      continue
    }
    // != before =
    if (part.includes('!=')) {
      const [key, ...rest] = part.split('!=')
      rules.push({ id, key: key.trim(), operator: '!=', values: [rest.join('!=').trim()] })
      continue
    }
    if (part.includes('=')) {
      const [key, ...rest] = part.split('=')
      rules.push({ id, key: key.trim(), operator: '=', values: [rest.join('=').trim()] })
      continue
    }
    // !exists
    if (part.startsWith('!')) {
      rules.push({ id, key: part.slice(1).trim(), operator: '!exists', values: [] })
      continue
    }
    // exists
    rules.push({ id, key: part.trim(), operator: 'exists', values: [] })
  }
  return rules
}

interface NodeQuerySelectorProps {
  onSelectorChange: (selector: string) => void
  initialSelector?: string
}

export function NodeQuerySelector({ onSelectorChange, initialSelector = '' }: NodeQuerySelectorProps) {
  const [rules, setRules] = useState<QueryRule[]>(() => selectorToRules(initialSelector))
  const [isOpen, setIsOpen] = useState(false)
  const [nodes, setNodes] = useState<Node[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isForbidden, setIsForbidden] = useState(false)
  const [rawMode, setRawMode] = useState(false)
  const [rawInput, setRawInput] = useState(initialSelector)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch nodes for label key/value suggestions
  useEffect(() => {
    const loadNodes = async () => {
      setIsLoading(true)
      setIsForbidden(false)
      try {
        const response = await fetchResources('nodes')
        // Safely extract items array from any response shape
        const extracted = (() => {
          if (Array.isArray(response)) return response
          if (response && typeof response === 'object' && Array.isArray((response as any).items)) return (response as any).items
          return []
        })()
        setNodes(extracted)
      } catch (error: any) {
        console.error('Failed to fetch nodes:', error)
        if (error.status === 403) setIsForbidden(true)
        setNodes([])
      } finally {
        setIsLoading(false)
      }
    }
    loadNodes()
  }, [])

  // Extract unique label keys and key→values map from nodes
  const { labelKeys, labelValuesMap } = useMemo(() => {
    const keySet = new Set<string>()
    const valMap = new Map<string, Set<string>>()
    const safeNodes = Array.isArray(nodes) ? nodes : []
    for (let i = 0; i < safeNodes.length; i++) {
      const node = safeNodes[i]
      const labels = node?.metadata?.labels
      if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
        const entries = Object.entries(labels)
        for (let j = 0; j < entries.length; j++) {
          const [key, value] = entries[j]
          keySet.add(key)
          if (!valMap.has(key)) valMap.set(key, new Set())
          valMap.get(key)!.add(value)
        }
      }
    }
    return {
      labelKeys: Array.from(keySet).sort(),
      labelValuesMap: valMap,
    }
  }, [nodes])

  // Count matching nodes for current rules
  const matchCount = useMemo(() => {
    const safeNodes = Array.isArray(nodes) ? nodes : []
    if (rules.length === 0) return safeNodes.length
    const selector = rulesToSelector(rules)
    if (!selector) return safeNodes.length

    return safeNodes.filter(node => {
      const labels = node?.metadata?.labels || {}
      return rules.every(rule => {
        const key = rule.key.trim()
        if (!key) return true
        switch (rule.operator) {
          case '=': return labels[key] === (rule.values[0] || '')
          case '!=': return labels[key] !== (rule.values[0] || '')
          case 'in': return rule.values.includes(labels[key] || '')
          case 'notin': return !rule.values.includes(labels[key] || '')
          case 'exists': return key in labels
          case '!exists': return !(key in labels)
          default: return true
        }
      })
    }).length
  }, [rules, nodes])

  const addRule = useCallback(() => {
    setRules(prev => [...prev, {
      id: Math.random().toString(36).slice(2, 9),
      key: '',
      operator: '=' as Operator,
      values: [''],
    }])
  }, [])

  const removeRule = useCallback((id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
  }, [])

  const updateRule = useCallback((id: string, field: keyof QueryRule, value: any) => {
    setRules(prev => prev.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: value }
      // Clear values when switching to exists/!exists
      if (field === 'operator' && (value === 'exists' || value === '!exists')) {
        updated.values = []
      }
      // Reset to single value when switching to = or !=
      if (field === 'operator' && (value === '=' || value === '!=')) {
        updated.values = [updated.values[0] || '']
      }
      return updated
    }))
  }, [])

  const addValueToRule = useCallback((id: string) => {
    setRules(prev => prev.map(r => {
      if (r.id !== id) return r
      return { ...r, values: [...r.values, ''] }
    }))
  }, [])

  const updateValueInRule = useCallback((ruleId: string, valueIndex: number, newVal: string) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r
      const values = [...r.values]
      values[valueIndex] = newVal
      return { ...r, values }
    }))
  }, [])

  const removeValueFromRule = useCallback((ruleId: string, valueIndex: number) => {
    setRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r
      const values = r.values.filter((_, i) => i !== valueIndex)
      return { ...r, values: values.length === 0 ? [''] : values }
    }))
  }, [])

  const applyFilter = useCallback(() => {
    if (rawMode) {
      const parsed = selectorToRules(rawInput)
      setRules(parsed)
      onSelectorChange(rawInput.trim())
    } else {
      const selector = rulesToSelector(rules)
      setRawInput(selector)
      onSelectorChange(selector)
    }
    setIsOpen(false)
  }, [rules, rawMode, rawInput, onSelectorChange])

  const clearAll = useCallback(() => {
    setRules([])
    setRawInput('')
    onSelectorChange('')
  }, [onSelectorChange])

  // Quick presets
  const presets = useMemo(() => [
    { label: 'Control Plane', selector: 'node-role.kubernetes.io/control-plane' },
    { label: 'Workers Only', selector: '!node-role.kubernetes.io/control-plane' },
    { label: 'Linux Nodes', selector: 'kubernetes.io/os=linux' },
    { label: 'AMD64 Arch', selector: 'kubernetes.io/arch=amd64' },
    { label: 'ARM64 Arch', selector: 'kubernetes.io/arch=arm64' },
  ], [])

  const currentSelector = rulesToSelector(rules)
  const hasActiveFilter = currentSelector.length > 0

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={hasActiveFilter ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              "h-8 gap-1.5 text-xs font-medium transition-all",
              hasActiveFilter && "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15",
              isForbidden && "opacity-50 cursor-not-allowed"
            )}
            disabled={isForbidden}
          >
            <Filter className="h-3.5 w-3.5" />
            Query Selector
            {hasActiveFilter && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px] font-bold bg-primary/20 text-primary">
                {rules.length}
              </Badge>
            )}
            <ChevronDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-[520px] p-0" sideOffset={5}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Node Query Selector</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[260px]">
                  <p className="text-xs leading-relaxed">
                    Build Kubernetes label selectors using operators. Supports <code className="bg-muted px-1 rounded">=</code>, <code className="bg-muted px-1 rounded">!=</code>, <code className="bg-muted px-1 rounded">in</code>, <code className="bg-muted px-1 rounded">notin</code>, <code className="bg-muted px-1 rounded">exists</code>, and <code className="bg-muted px-1 rounded">!exists</code>.
                    All rules are AND-combined.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={rawMode ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => {
                  if (!rawMode) {
                    setRawInput(rulesToSelector(rules))
                  } else {
                    setRules(selectorToRules(rawInput))
                  }
                  setRawMode(!rawMode)
                }}
              >
                {rawMode ? 'Visual' : 'Raw'}
              </Button>
            </div>
          </div>

          {rawMode ? (
            /* Raw text mode */
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Label Selector Expression
                </label>
                <Input
                  ref={inputRef}
                  value={rawInput}
                  onChange={e => setRawInput(e.target.value)}
                  placeholder="e.g. kubernetes.io/os=linux,node-role.kubernetes.io/control-plane"
                  className="font-mono text-xs h-9"
                  onKeyDown={e => { if (e.key === 'Enter') applyFilter() }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <p>Syntax: <code className="bg-muted px-1 rounded">key=value</code>, <code className="bg-muted px-1 rounded">key!=value</code>, <code className="bg-muted px-1 rounded">key in (v1,v2)</code>, <code className="bg-muted px-1 rounded">key notin (v1,v2)</code>, <code className="bg-muted px-1 rounded">key</code> (exists), <code className="bg-muted px-1 rounded">!key</code> (not exists)</p>
                <p>Separate multiple expressions with commas (AND logic).</p>
              </div>
            </div>
          ) : (
            /* Visual builder mode */
            <div className="max-h-[350px] overflow-y-auto">
              {/* Quick presets */}
              <div className="px-4 pt-3 pb-2">
                <div className="flex items-center gap-1 mb-2">
                  <Sparkles className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Presets</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {presets.map(preset => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 hover:bg-primary/5 hover:border-primary/30"
                      onClick={() => {
                        const newRules = selectorToRules(preset.selector)
                        setRules(prev => [...prev, ...newRules])
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="border-t" />

              {/* Rules list */}
              <div className="p-4 space-y-2">
                {rules.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Filter className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No filter rules yet</p>
                    <p className="text-[10px]">Add a rule or pick a preset above</p>
                  </div>
                )}

                {rules.map((rule, ruleIndex) => {
                  const opConfig = OPERATORS.find(o => o.value === rule.operator)!
                  const valuesForKey = rule.key ? Array.from(labelValuesMap.get(rule.key) || []).sort() : []
                  const isSetOp = rule.operator === 'in' || rule.operator === 'notin'

                  return (
                    <div key={rule.id} className="group relative rounded-lg border bg-card p-2.5 space-y-2 hover:border-primary/20 transition-colors">
                      {/* Rule number badge */}
                      <div className="absolute -top-2 -left-1.5 bg-primary text-primary-foreground text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                        {ruleIndex + 1}
                      </div>

                      {/* Row 1: Key + Operator */}
                      <div className="flex items-center gap-2">
                        {/* Key input with autocomplete */}
                        <div className="flex-1 relative">
                          <Input
                            value={rule.key}
                            onChange={e => updateRule(rule.id, 'key', e.target.value)}
                            placeholder="Label key..."
                            className="h-7 text-xs font-mono pr-6"
                            list={`keys-${rule.id}`}
                          />
                          <datalist id={`keys-${rule.id}`}>
                            {labelKeys.map(k => (
                              <option key={k} value={k} />
                            ))}
                          </datalist>
                        </div>

                        {/* Operator select */}
                        <Select
                          value={rule.operator}
                          onValueChange={v => updateRule(rule.id, 'operator', v as Operator)}
                        >
                          <SelectTrigger className="w-[100px] h-7 text-xs font-mono">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {OPERATORS.map(op => (
                              <SelectItem key={op.value} value={op.value} className="text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold w-12">{op.label}</span>
                                  <span className="text-muted-foreground text-[10px]">{op.description.split('—')[0]}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Remove button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={() => removeRule(rule.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>

                      {/* Row 2: Values (only for operators that need values) */}
                      {opConfig.needsValue && (
                        <div className="space-y-1.5 pl-0.5">
                          {rule.values.map((val, valIdx) => (
                            <div key={valIdx} className="flex items-center gap-1.5">
                              {isSetOp && (
                                <span className="text-[9px] text-muted-foreground w-3 text-right tabular-nums">{valIdx + 1}</span>
                              )}
                              <div className="flex-1 relative">
                                <Input
                                  value={val}
                                  onChange={e => updateValueInRule(rule.id, valIdx, e.target.value)}
                                  placeholder="Value..."
                                  className="h-6 text-xs font-mono"
                                  list={`vals-${rule.id}-${valIdx}`}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && isSetOp) {
                                      e.preventDefault()
                                      addValueToRule(rule.id)
                                    }
                                  }}
                                />
                                <datalist id={`vals-${rule.id}-${valIdx}`}>
                                  {valuesForKey.map(v => (
                                    <option key={v} value={v} />
                                  ))}
                                </datalist>
                              </div>
                              {isSetOp && rule.values.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => removeValueFromRule(rule.id, valIdx)}
                                >
                                  <X className="h-2.5 w-2.5" />
                                </Button>
                              )}
                            </div>
                          ))}
                          {isSetOp && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 text-[10px] text-muted-foreground hover:text-primary gap-1 px-1"
                              onClick={() => addValueToRule(rule.id)}
                            >
                              <Plus className="h-2.5 w-2.5" />
                              Add value
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Exists/!exists info */}
                      {!opConfig.needsValue && (
                        <p className="text-[10px] text-muted-foreground pl-0.5 italic">
                          {rule.operator === 'exists' ? 'Matches nodes where this label key is present' : 'Matches nodes where this label key is absent'}
                        </p>
                      )}
                    </div>
                  )
                })}

                {/* Add rule button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5 border-dashed hover:border-primary/40 hover:bg-primary/5"
                  onClick={addRule}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Rule
                </Button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/20">
            <div className="flex items-center gap-2">
              {hasActiveFilter && (
                <Badge variant="outline" className="h-5 text-[10px] font-mono">
                  {matchCount} / {nodes.length} nodes
                </Badge>
              )}
              {!hasActiveFilter && nodes.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{nodes.length} nodes total</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasActiveFilter && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAll}>
                  Clear All
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs gap-1" onClick={applyFilter}>
                <Filter className="h-3 w-3" />
                Apply Filter
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Active filter chips */}
      {hasActiveFilter && (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {rules.map(rule => {
            const opConfig = OPERATORS.find(o => o.value === rule.operator)!
            const display = rule.operator === 'exists' ? rule.key
              : rule.operator === '!exists' ? `!${rule.key}`
                : rule.operator === 'in' || rule.operator === 'notin'
                  ? `${rule.key} ${opConfig.label} (${rule.values.join(', ')})`
                  : `${rule.key}${opConfig.label}${rule.values[0] || ''}`
            return (
              <Badge
                key={rule.id}
                variant="secondary"
                className="h-6 px-1.5 gap-1 font-mono text-[10px] bg-primary/5 border border-primary/10 whitespace-nowrap shrink-0"
              >
                <span className="max-w-[160px] truncate">{display}</span>
                <button
                  onClick={() => {
                    removeRule(rule.id)
                    const newRules = rules.filter(r => r.id !== rule.id)
                    onSelectorChange(rulesToSelector(newRules))
                  }}
                  className="hover:text-destructive transition-colors ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )
          })}
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
