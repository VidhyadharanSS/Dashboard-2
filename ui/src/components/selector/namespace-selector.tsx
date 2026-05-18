import { useMemo, useState, useCallback } from 'react'
import { Namespace } from 'kubernetes-types/core/v1'
import { Check, ChevronsUpDown, X, Pin, PinOff, Star, Sparkles, Filter } from 'lucide-react'
import { IconPin, IconPinFilled, IconGripVertical } from '@tabler/icons-react'
import { useCluster } from '@/contexts/cluster-context'
import { useResources } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/use-permissions'
import { usePinnedNamespaces } from '@/hooks/use-pinned-namespaces'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface NamespaceSelectorProps {
  selectedNamespace?: string
  handleNamespaceChange: (namespace: string) => void
  /** When true, shows "All Namespaces" as an option */
  showAll?: boolean
  className?: string
  /** Enable multi-namespace filter mode (integrated into the same dropdown) */
  multiSelect?: boolean
  /** Controlled multi-namespace values */
  selectedNamespaces?: string[]
  /** Called when multi-namespace values change */
  onNamespacesChange?: (namespaces: string[]) => void
}

export function NamespaceSelector({
  selectedNamespace,
  handleNamespaceChange,
  showAll = false,
  className,
  multiSelect = false,
  selectedNamespaces = [],
  onNamespacesChange,
}: NamespaceSelectorProps) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useResources('namespaces')
  const { canAccessNamespace } = usePermissions()
  const { currentCluster } = useCluster()
  const { pinned, toggle: togglePin, isPinned } = usePinnedNamespaces(currentCluster)
  // Mode toggle: 'single' = pick one namespace, 'multi' = filter by multiple
  const [mode, setMode] = useState<'single' | 'multi'>(
    selectedNamespaces.length > 0 ? 'multi' : 'single'
  )
  const isMultiActive = multiSelect && mode === 'multi' && selectedNamespaces.length > 0

  const sortedNamespaces = useMemo(() => {
    const namespaces = (data || [{ metadata: { name: 'default' } }]) as Namespace[]
    const accessible = namespaces.filter((ns: Namespace) => {
      const name = ns.metadata?.name
      return name && canAccessNamespace(name)
    })

    const pinnedNs = accessible
      .filter(ns => isPinned(ns.metadata?.name || ''))
      .sort((a, b) => {
        const ai = pinned.indexOf(a.metadata?.name || '')
        const bi = pinned.indexOf(b.metadata?.name || '')
        return ai - bi
      })

    const unpinned = accessible
      .filter(ns => !isPinned(ns.metadata?.name || ''))
      .sort((a, b) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''))

    return [...pinnedNs, ...unpinned]
  }, [data, canAccessNamespace, pinned, isPinned])

  const pinnedNames = useMemo(
    () => sortedNamespaces.filter(ns => isPinned(ns.metadata?.name || '')).map(ns => ns.metadata!.name!),
    [sortedNamespaces, isPinned]
  )

  const unpinnedNames = useMemo(
    () => sortedNamespaces.filter(ns => !isPinned(ns.metadata?.name || '')).map(ns => ns.metadata!.name!),
    [sortedNamespaces, isPinned]
  )

  // Multi-select toggle
  const toggleNamespace = useCallback((ns: string) => {
    if (!onNamespacesChange) return
    const next = selectedNamespaces.includes(ns)
      ? selectedNamespaces.filter(n => n !== ns)
      : [...selectedNamespaces, ns]
    onNamespacesChange(next)
  }, [selectedNamespaces, onNamespacesChange])

  const clearMulti = useCallback(() => {
    onNamespacesChange?.([])
    setMode('single')
  }, [onNamespacesChange])

  // Pin management sub-view state
  const [showPinManager, setShowPinManager] = useState(false)

  // Compute display label
  const displayLabel = isMultiActive
    ? `${selectedNamespaces.length} namespace${selectedNamespaces.length > 1 ? 's' : ''} filtered`
    : selectedNamespace === '_all'
      ? 'All Namespaces'
      : selectedNamespace || 'Select namespace...'

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setShowPinManager(false) }}>
        <PopoverTrigger asChild>
          <Button
            variant={isMultiActive ? 'default' : 'outline'}
            role="combobox"
            aria-expanded={open}
            className={cn(
              'justify-between font-normal max-w-52 h-9 gap-1.5',
              isMultiActive && 'shadow-sm',
              className,
            )}
            disabled={isLoading}
          >
            {isMultiActive && <Filter className="h-3 w-3 shrink-0 opacity-70" />}
            <span className="truncate text-sm">
              {isLoading ? 'Loading...' : displayLabel}
            </span>
            {isMultiActive && (
              <Badge
                variant="secondary"
                className="h-4 min-w-[16px] px-1 text-[9px] font-bold rounded-full bg-primary-foreground/20 text-primary-foreground"
              >
                {selectedNamespaces.length}
              </Badge>
            )}
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start" sideOffset={6}>
          {showPinManager ? (
            /* ── Pin Manager View ── */
            <div className="flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-semibold">Manage Pinned Namespaces</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowPinManager(false)}
                >
                  ← Back
                </Button>
              </div>

              {/* Pinned List */}
              <div className="max-h-[220px] overflow-y-auto">
                {pinnedNames.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                    <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center mb-2">
                      <Pin className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                    <p className="text-xs text-muted-foreground">No pinned namespaces yet</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">Pin namespaces for quick access in the header bar</p>
                  </div>
                ) : (
                  <div className="py-1">
                    {pinnedNames.map((name, index) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 group/pin transition-colors"
                      >
                        <IconGripVertical className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                        <span className="text-[10px] text-muted-foreground/40 w-3 shrink-0 tabular-nums font-mono">{index + 1}</span>
                        <IconPinFilled className="h-3 w-3 text-amber-500 shrink-0" />
                        <span className="text-xs font-mono flex-1 truncate">{name}</span>
                        <button
                          onClick={() => togglePin(name)}
                          className="opacity-0 group-hover/pin:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive shrink-0 px-1.5 py-0.5 rounded hover:bg-destructive/10"
                        >
                          <PinOff className="h-3 w-3" />
                          Unpin
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick-pin search */}
              <div className="border-t">
                <Command>
                  <CommandInput placeholder="Search to pin..." className="h-8 text-xs" />
                  <CommandList className="max-h-[140px]">
                    <CommandEmpty className="py-3 text-xs text-center">No matching namespace</CommandEmpty>
                    <CommandGroup heading="Available">
                      {unpinnedNames.map(name => (
                        <CommandItem
                          key={name}
                          value={name}
                          onSelect={() => togglePin(name)}
                          className="gap-2 text-xs"
                        >
                          <Pin className="h-3 w-3 text-muted-foreground/50" />
                          <span className="font-mono truncate">{name}</span>
                          <span className="ml-auto text-[9px] text-muted-foreground">Click to pin</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/20">
                <span className="text-[10px] text-muted-foreground">{pinnedNames.length} pinned</span>
                {pinnedNames.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-2 text-[10px] text-destructive hover:text-destructive"
                    onClick={() => pinnedNames.forEach(n => togglePin(n))}
                  >
                    Clear all pins
                  </Button>
                )}
              </div>
            </div>
          ) : (
            /* ── Main Namespace Selector View ── */
            <Command>
              <CommandInput placeholder="Search namespaces..." autoFocus />
              <CommandList className="max-h-[260px]">
                <CommandEmpty>No namespace found.</CommandEmpty>

                {/* Mode toggle when multiSelect is enabled */}
                {multiSelect && (
                  <CommandGroup>
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <Button
                        variant={mode === 'single' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-[11px] flex-1 gap-1"
                        onClick={() => { setMode('single'); clearMulti() }}
                      >
                        Single
                      </Button>
                      <Button
                        variant={mode === 'multi' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 text-[11px] flex-1 gap-1"
                        onClick={() => setMode('multi')}
                      >
                        <Filter className="h-3 w-3" />
                        Multi-filter
                      </Button>
                    </div>
                  </CommandGroup>
                )}

                {mode === 'multi' && multiSelect ? (
                  /* ── Multi-select checkboxes ── */
                  <>
                    {pinnedNames.length > 0 && (
                      <CommandGroup heading={
                        <span className="flex items-center gap-1.5">
                          <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                          <span>Pinned</span>
                        </span>
                      }>
                        {pinnedNames.map(name => {
                          const isSelected = selectedNamespaces.includes(name)
                          return (
                            <CommandItem key={name} value={name} onSelect={() => toggleNamespace(name)} className="gap-2">
                              <div className={cn(
                                'flex h-4 w-4 items-center justify-center rounded-sm border transition-colors',
                                isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30',
                              )}>
                                {isSelected && <Check className="h-3 w-3" />}
                              </div>
                              <IconPinFilled className="h-3 w-3 text-amber-500 shrink-0" />
                              <span className="font-mono text-xs">{name}</span>
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    )}
                    <CommandGroup heading={pinnedNames.length > 0 ? 'Other' : 'Namespaces'}>
                      {unpinnedNames.map(name => {
                        const isSelected = selectedNamespaces.includes(name)
                        return (
                          <CommandItem key={name} value={name} onSelect={() => toggleNamespace(name)} className="gap-2">
                            <div className={cn(
                              'flex h-4 w-4 items-center justify-center rounded-sm border transition-colors',
                              isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30',
                            )}>
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                            <span className="font-mono text-xs">{name}</span>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </>
                ) : (
                  /* ── Single-select ── */
                  <>
                    {/* All Namespaces option */}
                    {showAll && (
                      <CommandGroup>
                        <CommandItem
                          value="All Namespaces"
                          onSelect={() => { handleNamespaceChange('_all'); setOpen(false) }}
                          className="gap-2"
                        >
                          <Check className={cn('h-3.5 w-3.5', selectedNamespace === '_all' ? 'opacity-100' : 'opacity-0')} />
                          <span className="font-medium">All Namespaces</span>
                        </CommandItem>
                      </CommandGroup>
                    )}

                    {/* Pinned namespaces */}
                    {pinnedNames.length > 0 && (
                      <>
                        <CommandSeparator />
                        <CommandGroup heading={
                          <span className="flex items-center gap-1.5">
                            <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                            <span>Pinned</span>
                          </span>
                        }>
                          {pinnedNames.map(name => (
                            <CommandItem
                              key={name}
                              value={name}
                              onSelect={() => { handleNamespaceChange(name); setOpen(false) }}
                              className="gap-2 group/ns"
                            >
                              <Check className={cn('h-3.5 w-3.5 shrink-0', selectedNamespace === name ? 'opacity-100' : 'opacity-0')} />
                              <IconPinFilled className="h-3 w-3 text-amber-500 shrink-0" />
                              <span className="font-mono text-xs truncate">{name}</span>
                              <button
                                className="ml-auto opacity-0 group-hover/ns:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0 p-0.5 rounded hover:bg-destructive/10"
                                onClick={(e) => { e.stopPropagation(); togglePin(name) }}
                              >
                                <PinOff className="h-3 w-3" />
                              </button>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    )}

                    {/* Unpinned namespaces */}
                    <CommandSeparator />
                    <CommandGroup heading={pinnedNames.length > 0 ? 'Other' : 'Namespaces'}>
                      {unpinnedNames.map(name => (
                        <CommandItem
                          key={name}
                          value={name}
                          onSelect={() => { handleNamespaceChange(name); setOpen(false) }}
                          className="gap-2 group/ns"
                        >
                          <Check className={cn('h-3.5 w-3.5 shrink-0', selectedNamespace === name ? 'opacity-100' : 'opacity-0')} />
                          <span className="font-mono text-xs truncate">{name}</span>
                          <button
                            className="ml-auto opacity-0 group-hover/ns:opacity-100 text-muted-foreground hover:text-amber-500 transition-all shrink-0 p-0.5 rounded hover:bg-amber-500/10"
                            onClick={(e) => { e.stopPropagation(); togglePin(name) }}
                            title="Pin namespace"
                          >
                            <Pin className="h-3 w-3" />
                          </button>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
              <CommandSeparator />
              <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/20">
                <span className="text-[10px] text-muted-foreground">
                  {sortedNamespaces.length} namespaces
                  {mode === 'multi' && selectedNamespaces.length > 0 && (
                    <> · <strong>{selectedNamespaces.length}</strong> selected</>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  {mode === 'multi' && selectedNamespaces.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={clearMulti}>
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => setShowPinManager(true)}
                  >
                    <Sparkles className="h-3 w-3" />
                    Pins{pinnedNames.length > 0 && ` (${pinnedNames.length})`}
                  </Button>
                </div>
              </div>
            </Command>
          )}
        </PopoverContent>
      </Popover>

      {/* Multi-namespace selected chips */}
      {isMultiActive && (
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
          {selectedNamespaces.slice(0, 3).map(ns => (
            <Badge
              key={ns}
              variant="secondary"
              className="h-6 pl-1.5 pr-1 gap-1 font-mono text-[10px] bg-primary/5 border border-primary/15 whitespace-nowrap shrink-0 hover:border-primary/30 transition-colors"
            >
              <span className="max-w-[100px] truncate">{ns}</span>
              <button onClick={() => toggleNamespace(ns)} className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive transition-colors">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
          {selectedNamespaces.length > 3 && (
            <Badge variant="outline" className="h-6 px-1.5 text-[10px] shrink-0">+{selectedNamespaces.length - 3}</Badge>
          )}
          <button onClick={clearMulti} className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 shrink-0 underline-offset-2 hover:underline">
            Clear
          </button>
        </div>
      )}

      {/* Quick pin/unpin button for current namespace */}
      {!isMultiActive && selectedNamespace && selectedNamespace !== '_all' && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isPinned(selectedNamespace) ? 'secondary' : 'ghost'}
                size="icon"
                className={cn(
                  'h-8 w-8 shrink-0 transition-all',
                  isPinned(selectedNamespace) && 'bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 hover:text-amber-600'
                )}
                onClick={() => togglePin(selectedNamespace)}
              >
                {isPinned(selectedNamespace)
                  ? <IconPinFilled className="h-3.5 w-3.5" />
                  : <IconPin className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {isPinned(selectedNamespace)
                ? <span className="flex items-center gap-1"><PinOff className="h-3 w-3" /> Unpin <strong>{selectedNamespace}</strong></span>
                : <span className="flex items-center gap-1"><Pin className="h-3 w-3" /> Pin <strong>{selectedNamespace}</strong> for quick access</span>
              }
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
