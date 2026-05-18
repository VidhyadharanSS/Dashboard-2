import { useState, useMemo, useEffect, useRef } from 'react'
import { Check, ChevronsUpDown, Loader2, Tag, X, ShieldOff } from 'lucide-react'

import { fetchResources } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
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

/**
 * Safely extract an items array from any API response shape.
 */
function extractItemsArray(data: unknown): any[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items
  }
  return []
}

interface WorkloadLabelSelectorProps {
  /** The k8s resource type used to discover labels, e.g. "deployments", "pods" */
  resourceType: string
  /** Namespace to scope label discovery. Pass "_all" for all namespaces. */
  namespace?: string
  /** Called whenever the set of selected labels changes. Value is a k8s label selector string */
  onLabelsChange?: (labels: string) => void
  /** Placeholder text */
  placeholder?: string
}

export function WorkloadLabelSelector({
  resourceType,
  namespace,
  onLabelsChange,
  placeholder,
}: WorkloadLabelSelectorProps) {
  const [items, setItems] = useState<any[]>([])
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isForbidden, setIsForbidden] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setIsForbidden(false)
      try {
        const response = await fetchResources(resourceType as any, namespace)
        setItems(extractItemsArray(response))
      } catch (error: any) {
        console.error(`Failed to fetch ${resourceType} for label selector:`, error)
        if (error.status === 403) setIsForbidden(true)
        setItems([])
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [resourceType, namespace])

  // Group labels by key for organized display
  const labelGroups = useMemo(() => {
    const safeItems = Array.isArray(items) ? items : []
    const labelMap = new Map<string, Set<string>>()
    for (let i = 0; i < safeItems.length; i++) {
      const item = safeItems[i]
      const labels = item?.metadata?.labels
      if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
        const entries = Object.entries(labels)
        for (let j = 0; j < entries.length; j++) {
          const [key, value] = entries[j]
          if (!labelMap.has(key)) labelMap.set(key, new Set())
          labelMap.get(key)!.add(value as string)
        }
      }
    }

    const groups: { key: string; values: { full: string; value: string }[] }[] = []
    const sortedKeys = Array.from(labelMap.keys()).sort()
    for (let i = 0; i < sortedKeys.length; i++) {
      const key = sortedKeys[i]
      const values = Array.from(labelMap.get(key)!).sort()
      groups.push({
        key,
        values: values.map(v => ({ full: `${key}=${v}`, value: v })),
      })
    }
    return groups
  }, [items])

  const allOptions = useMemo(() => {
    return labelGroups.flatMap(g => g.values.map(v => v.full))
  }, [labelGroups])

  const handleToggle = (fullLabel: string) => {
    const next = selectedLabels.includes(fullLabel)
      ? selectedLabels.filter(l => l !== fullLabel)
      : [...selectedLabels, fullLabel]
    setSelectedLabels(next)
    onLabelsChange?.(next.join(','))
  }

  const handleClearAll = () => {
    setSelectedLabels([])
    onLabelsChange?.('')
  }

  const handleRemoveLabel = (label: string) => {
    const next = selectedLabels.filter(l => l !== label)
    setSelectedLabels(next)
    onLabelsChange?.(next.join(','))
  }

  const hasActive = selectedLabels.length > 0

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Trigger button */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                ref={triggerRef}
                variant={hasActive ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-8 gap-1.5 text-xs font-medium shrink-0 transition-all',
                  hasActive && 'shadow-sm',
                  isForbidden && 'opacity-50 cursor-not-allowed',
                )}
                disabled={isLoading || isForbidden}
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isForbidden ? (
                  <ShieldOff className="h-3.5 w-3.5" />
                ) : (
                  <Tag className="h-3.5 w-3.5" />
                )}
                {placeholder || 'Labels'}
                {hasActive && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'h-4 min-w-[16px] px-1 text-[9px] font-bold rounded-full',
                      hasActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/20 text-primary',
                    )}
                  >
                    {selectedLabels.length}
                  </Badge>
                )}
                <ChevronsUpDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          {isForbidden && (
            <TooltipContent>
              You don't have permission to list {resourceType}. Label filtering is disabled.
            </TooltipContent>
          )}
        </Tooltip>
        <PopoverContent className="w-[320px] p-0" align="start" sideOffset={6}>
          <Command>
            <CommandInput placeholder={`Search ${resourceType} labels...`} />
            <CommandList className="max-h-[280px]">
              <CommandEmpty>
                {isLoading ? 'Loading labels...' : 'No labels discovered.'}
              </CommandEmpty>
              {labelGroups.map((group) => (
                <CommandGroup key={group.key} heading={group.key}>
                  {group.values.map(({ full, value }) => {
                    const isSelected = selectedLabels.includes(full)
                    return (
                      <CommandItem
                        key={full}
                        value={full}
                        onSelect={() => handleToggle(full)}
                        className="gap-2"
                      >
                        <div className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-sm border transition-colors',
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30',
                        )}>
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        <span className="font-mono text-xs truncate">{value}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
            </CommandList>
            {(hasActive || allOptions.length > 0) && (
              <>
                <CommandSeparator />
                <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/30">
                  <span className="text-[10px] text-muted-foreground">
                    {allOptions.length} label{allOptions.length !== 1 ? 's' : ''} discovered
                  </span>
                  {hasActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                      onClick={handleClearAll}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
              </>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected label chips — visible inline */}
      {hasActive && (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
          {selectedLabels.slice(0, 3).map((label) => (
            <Badge
              key={label}
              variant="secondary"
              className="h-6 pl-1.5 pr-1 gap-1 font-mono text-[10px] bg-primary/5 border border-primary/15 whitespace-nowrap shrink-0 group/chip hover:border-primary/30 transition-colors"
            >
              <span className="max-w-[140px] truncate">{label}</span>
              <button
                onClick={() => handleRemoveLabel(label)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
          {selectedLabels.length > 3 && (
            <Badge variant="outline" className="h-6 px-1.5 text-[10px] shrink-0">
              +{selectedLabels.length - 3}
            </Badge>
          )}
          <button
            onClick={handleClearAll}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 shrink-0 underline-offset-2 hover:underline transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
