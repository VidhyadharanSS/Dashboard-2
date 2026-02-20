import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { SimpleContainer } from '@/types/k8s'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'

interface MultiContainerSelectorProps {
    containers: SimpleContainer
    selectedContainers: string[]
    onContainersChange: (containerNames: string[]) => void
    placeholder?: string
}

export function MultiContainerSelector({
    containers,
    selectedContainers,
    onContainersChange,
    placeholder = 'Select containers...',
}: MultiContainerSelectorProps) {
    const [open, setOpen] = useState(false)

    const toggleContainer = (name: string) => {
        const newSelected = selectedContainers.includes(name)
            ? selectedContainers.filter((c) => c !== name)
            : [...selectedContainers, name]
        onContainersChange(newSelected)
    }

    const selectAll = () => {
        onContainersChange(containers.map((c) => c.name))
    }

    const selectNone = () => {
        onContainersChange([])
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="min-w-[200px] max-w-[400px] h-auto py-2 justify-between"
                >
                    <div className="flex flex-wrap gap-1">
                        {selectedContainers.length === 0 ? (
                            <span className="text-muted-foreground">{placeholder}</span>
                        ) : selectedContainers.length === containers.length ? (
                            <Badge variant="secondary">All Containers</Badge>
                        ) : (
                            selectedContainers.map((name) => (
                                <Badge key={name} variant="secondary" className="text-[10px] px-1">
                                    {name}
                                </Badge>
                            ))
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0">
                <Command>
                    <CommandInput placeholder="Search containers..." />
                    <div className="flex items-center justify-between px-2 py-1 border-b">
                        <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">Select All</Button>
                        <Button variant="ghost" size="sm" onClick={selectNone} className="text-xs h-7">Clear</Button>
                    </div>
                    <CommandList>
                        <CommandEmpty>No containers found.</CommandEmpty>
                        <CommandGroup>
                            {containers.map((container) => (
                                <CommandItem
                                    key={container.name}
                                    value={container.name}
                                    onSelect={() => toggleContainer(container.name)}
                                >
                                    <Check
                                        className={cn(
                                            'mr-2 h-4 w-4',
                                            selectedContainers.includes(container.name)
                                                ? 'opacity-100'
                                                : 'opacity-0'
                                        )}
                                    />
                                    <div className="flex flex-col">
                                        <span className="font-medium">
                                            {container.name}
                                            {container.init && (
                                                <span className="text-xs text-muted-foreground ml-1">
                                                    (init)
                                                </span>
                                            )}
                                        </span>
                                        {container.image && (
                                            <span className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">
                                                {container.image}
                                            </span>
                                        )}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
