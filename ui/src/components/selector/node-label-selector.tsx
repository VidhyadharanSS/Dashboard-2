import { useState, useMemo, useEffect } from 'react'
import { Tag, X } from 'lucide-react'
import { Node } from 'kubernetes-types/core/v1'

import { fetchResources } from '@/lib/api'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip'

interface NodeLabelSelectorProps {
    onNodeNamesChange?: (nodeNames: string[] | null) => void
    onLabelsChange?: (labels: string) => void
}

export function NodeLabelSelector({ onNodeNamesChange, onLabelsChange }: NodeLabelSelectorProps) {
    const [nodes, setNodes] = useState<Node[]>([])
    const [selectedLabels, setSelectedLabels] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isForbidden, setIsForbidden] = useState(false)

    useEffect(() => {
        const loadNodes = async () => {
            setIsLoading(true)
            setIsForbidden(false)
            try {
                const response = await fetchResources('nodes')
                // Safely extract items array from any response shape
                if (Array.isArray(response)) {
                    setNodes(response)
                } else if (response && typeof response === 'object' && Array.isArray((response as any).items)) {
                    setNodes((response as any).items)
                } else {
                    setNodes([])
                }
            } catch (error: any) {
                console.error('Failed to fetch nodes for label selector:', error)
                if (error.status === 403) {
                    setIsForbidden(true)
                }
                setNodes([])
            } finally {
                setIsLoading(false)
            }
        }
        loadNodes()
    }, [])

    const labelOptions = useMemo(() => {
        const safeNodes = Array.isArray(nodes) ? nodes : []
        // Count how many nodes carry each key=value label
        const countMap = new Map<string, number>()
        for (const node of safeNodes) {
            const labels = node?.metadata?.labels
            if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
                for (const [key, value] of Object.entries(labels)) {
                    const fullLabel = `${key}=${value}`
                    countMap.set(fullLabel, (countMap.get(fullLabel) ?? 0) + 1)
                }
            }
        }

        const selectedSet = new Set(selectedLabels)
        const total = safeNodes.length

        // Sort: active selections first, then by node count DESC, then alphabetically
        return Array.from(countMap.entries())
            .sort(([aLabel, aCount], [bLabel, bCount]) => {
                const aPin = selectedSet.has(aLabel) ? 0 : 1
                const bPin = selectedSet.has(bLabel) ? 0 : 1
                if (aPin !== bPin) return aPin - bPin
                if (bCount !== aCount) return bCount - aCount
                return aLabel.localeCompare(bLabel)
            })
            .map(([fullLabel, count]) => ({
                value: fullLabel,
                label: fullLabel,
                description: `${count}/${total}`,
            }))
    }, [nodes, selectedLabels])

    const handleLabelsChange = (labels: string[]) => {
        setSelectedLabels(labels)

        if (onNodeNamesChange) {
            // Find nodes that match ANY of the selected labels (Union)
            const safeNodes = Array.isArray(nodes) ? nodes : []
            const matchingNodeNames = safeNodes
                .filter((node) => {
                    return labels.some((label) => {
                        const [key, val] = label.split('=')
                        return node?.metadata?.labels?.[key] === val
                    })
                })
                .map((node) => node?.metadata?.name || '')
                .filter(Boolean)

            onNodeNamesChange(matchingNodeNames)
        }

        if (onLabelsChange) {
            onLabelsChange(labels.join(','))
        }
    }

    const removeLabel = (labelToRemove: string) => {
        handleLabelsChange(selectedLabels.filter((l) => l !== labelToRemove))
    }

    return (
        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-lg max-w-full overflow-hidden">
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex items-center">
                        <Combobox
                            options={labelOptions}
                            values={selectedLabels}
                            onValuesChange={handleLabelsChange}
                            multiple={true}
                            placeholder={isForbidden ? "Unavailable (RBAC)" : "Filter by Node Label"}
                            searchPlaceholder="Search node labels..."
                            emptyText={isForbidden ? "Permission denied (nodes)" : "No labels found."}
                            triggerClassName={cn(
                                "h-8 text-xs min-w-[150px] border-none bg-transparent",
                                isForbidden && "opacity-50 cursor-not-allowed"
                            )}
                            disabled={isLoading || isForbidden}
                        />
                    </div>
                </TooltipTrigger>
                {isForbidden && (
                    <TooltipContent>
                        You don't have permission to list nodes. Node label filtering is disabled.
                    </TooltipContent>
                )}
            </Tooltip>
            {selectedLabels.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                    <div className="h-4 w-px bg-muted-foreground/20 mx-0.5 shrink-0" />
                    {selectedLabels.map((label) => (
                        <Badge
                            key={label}
                            variant="secondary"
                            className="h-6 px-1.5 gap-1 font-normal text-[10px] bg-background/50 whitespace-nowrap shrink-0"
                        >
                            <Tag className="h-2.5 w-2.5" />
                            <span className="max-w-[120px] truncate">{label}</span>
                            <button
                                onClick={() => removeLabel(label)}
                                className="hover:text-destructive transition-colors ml-0.5"
                            >
                                <X className="h-2.5 w-2.5" />
                            </button>
                        </Badge>
                    ))}
                    <button
                        onClick={() => handleLabelsChange([])}
                        className="text-[10px] text-muted-foreground hover:text-foreground px-1 shrink-0"
                    >
                        Clear
                    </button>
                </div>
            )}
        </div>
    )
}
