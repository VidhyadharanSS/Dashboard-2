import { Search as SearchIcon } from 'lucide-react'

import { useGlobalSearch } from './global-search-provider'
import { Button } from './ui/button'

export function Search() {
  const { openSearch } = useGlobalSearch()

  return (
    <Button
      variant="outline"
      className="flex items-center gap-2 px-3 py-2 h-9 w-64 justify-start text-muted-foreground border-border/40 bg-muted/30 hover:bg-muted/50 hover:border-primary/30 shadow-sm transition-all duration-200"
      onClick={openSearch}
    >
      <SearchIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
      <span className="flex-1 text-left text-sm">Search resources...</span>
      <div className="flex items-center gap-0.5 text-xs">
        <kbd className="bg-background/80 text-muted-foreground/70 pointer-events-none flex h-5 items-center justify-center gap-1 rounded-md border border-border/50 px-1.5 font-mono text-[10px] font-medium select-none shadow-sm">
          ⌘
        </kbd>
        <kbd className="bg-background/80 text-muted-foreground/70 pointer-events-none flex h-5 items-center justify-center gap-1 rounded-md border border-border/50 px-1.5 font-mono text-[10px] font-medium select-none shadow-sm aspect-square">
          K
        </kbd>
      </div>
    </Button>
  )
}
