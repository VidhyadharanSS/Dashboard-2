import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

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

export interface ComboboxOption {
    value: string
    label: string
    /** Optional secondary info displayed at the trailing edge of each dropdown item (e.g. a count). */
    description?: string
}

interface ComboboxProps {
    options: ComboboxOption[]
    value?: string
    onValueChange?: (value: string) => void
    values?: string[]
    onValuesChange?: (values: string[]) => void
    multiple?: boolean
    placeholder?: string
    searchPlaceholder?: string
    emptyText?: string
    className?: string
    triggerClassName?: string
    disabled?: boolean
}

export function Combobox({
    options,
    value,
    onValueChange,
    values = [],
    onValuesChange,
    multiple = false,
    placeholder = 'Select...',
    searchPlaceholder = 'Search...',
    emptyText = 'No results found.',
    className,
    triggerClassName,
    disabled = false,
}: ComboboxProps) {
    const [open, setOpen] = React.useState(false)

    const selectedLabels = React.useMemo(() => {
        if (multiple) {
            if (values.length === 0) return null
            if (values.length === 1) return options.find((opt) => opt.value === values[0])?.label
            return `${values.length} selected`
        }
        return options.find((opt) => opt.value === value)?.label
    }, [multiple, value, values, options])

    const isSelected = (val: string) => {
        if (multiple) return values.includes(val)
        return value === val
    }

    const handleSelect = (val: string) => {
        if (multiple) {
            const newValues = values.includes(val)
                ? values.filter((v) => v !== val)
                : [...values, val]
            onValuesChange?.(newValues)
        } else {
            onValueChange?.(val)
            setOpen(false)
        }
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn('justify-between font-normal', triggerClassName)}
                    disabled={disabled}
                >
                    <span className="truncate">
                        {selectedLabels ?? placeholder}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className={cn('p-0', className)} align="start">
                <Command>
                    <CommandInput placeholder={searchPlaceholder} autoFocus />
                    <CommandList>
                        <CommandEmpty>{emptyText}</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label}
                                    onSelect={() => handleSelect(option.value)}
                                >
                                    <Check
                                        className={cn(
                                            'mr-2 h-4 w-4 shrink-0',
                                            isSelected(option.value) ? 'opacity-100' : 'opacity-0'
                                        )}
                                    />
                                    <span className="flex-1 truncate">{option.label}</span>
                                    {option.description && (
                                        <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                                            {option.description}
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
