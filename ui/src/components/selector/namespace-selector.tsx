import { useMemo } from 'react'
import { Namespace } from 'kubernetes-types/core/v1'
import { IconPin, IconPinFilled } from '@tabler/icons-react'
import { useCluster } from '@/contexts/cluster-context';
import { useResources } from '@/lib/api'
import { Combobox, ComboboxOption } from '@/components/ui/combobox'
import { usePermissions } from '@/hooks/use-permissions'
import { usePinnedNamespaces } from '@/hooks/use-pinned-namespaces'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function NamespaceSelector({
  selectedNamespace,
  handleNamespaceChange,
  showAll = false,
  className,
}: {
  selectedNamespace?: string
  handleNamespaceChange: (namespace: string) => void
  showAll?: boolean
  className?: string
}) {
  const { data, isLoading } = useResources('namespaces')
  const { canAccessNamespace } = usePermissions()
  const { currentCluster } = useCluster() // You may need to import useCluster
  const { pinned, toggle, isPinned } = usePinnedNamespaces(currentCluster)

  const sortedNamespaces = useMemo(() => {
    const namespaces = (data || [{ metadata: { name: 'default' } }]) as Namespace[]
    const accessible = namespaces.filter((ns: Namespace) => {
      const name = ns.metadata?.name
      return name && canAccessNamespace(name)
    })

    // Sort: pinned first (in pin order), then alphabetical
    const pinnedNs = accessible
      .filter(ns => isPinned(ns.metadata?.name || ''))
      .sort((a, b) => {
        const ai = pinned.indexOf(a.metadata?.name || '')
        const bi = pinned.indexOf(b.metadata?.name || '')
        return ai - bi
      })

    const unpinned = accessible
      .filter(ns => !isPinned(ns.metadata?.name || ''))
      .sort((a, b) => {
        const nameA = a.metadata?.name?.toLowerCase() || ''
        const nameB = b.metadata?.name?.toLowerCase() || ''
        return nameA.localeCompare(nameB)
      })

    return [...pinnedNs, ...unpinned]
  }, [data, canAccessNamespace, pinned, isPinned])

  const options: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = []
    if (showAll) {
      opts.push({ value: '_all', label: 'All Namespaces' })
    }
    sortedNamespaces.forEach((ns: Namespace) => {
      if (ns.metadata?.name) {
        const name = ns.metadata.name
        const pinLabel = isPinned(name) ? '📌 ' : ''
        opts.push({ value: name, label: `${pinLabel}${name}` })
      }
    })
    return opts
  }, [showAll, sortedNamespaces, isPinned])

  return (
    <div className="flex items-center gap-1">
      <Combobox
        options={options}
        value={selectedNamespace}
        onValueChange={handleNamespaceChange}
        placeholder={isLoading ? 'Loading...' : 'Select namespace...'}
        searchPlaceholder="Search namespaces..."
        emptyText="No namespace found."
        triggerClassName={`max-w-48 ${className || ''}`}
        disabled={isLoading}
      />
      {selectedNamespace && selectedNamespace !== '_all' && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => toggle(selectedNamespace)}
              >
                {isPinned(selectedNamespace)
                  ? <IconPinFilled className="h-3.5 w-3.5 text-primary" />
                  : <IconPin className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isPinned(selectedNamespace) ? 'Unpin namespace' : 'Pin namespace to top'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
