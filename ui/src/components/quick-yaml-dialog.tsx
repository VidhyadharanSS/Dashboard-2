import { useState } from 'react'
import { IconFileCode } from '@tabler/icons-react'
import * as yaml from 'js-yaml'

import { ResourceType } from '@/types/api'
import { useResource } from '@/lib/api'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'

import { TextViewer } from './text-viewer'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '@/lib/utils'

interface QuickYamlDialogProps {
    resourceType: ResourceType
    namespace?: string
    name: string
    triggerAsText?: boolean
    triggerVariant?: 'outline' | 'ghost' | 'default'
    triggerSize?: 'sm' | 'default' | 'icon'
    customTrigger?: React.ReactNode
    className?: string
}

export function QuickYamlDialog({
    resourceType,
    namespace,
    name,
    triggerAsText = false,
    triggerVariant = 'outline',
    triggerSize = 'sm',
    customTrigger,
    className,
}: QuickYamlDialogProps) {
    const [isOpen, setIsOpen] = useState(false)
    const { data, isLoading } = useResource(resourceType, name, namespace, {
        enabled: isOpen,
    })

    const yamlContent = data ? yaml.dump(data, { indent: 2 }) : ''

    // Icon-only mode: Tooltip wraps outside Dialog so that DialogTrigger's
    // asChild can forward ref + click directly onto the <Button> DOM element.
    // Previously there was a nested DialogTrigger that caused double-toggle (open+close).
    if (!customTrigger && !triggerAsText) {
        return (
            <Tooltip>
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <TooltipTrigger asChild>
                        <DialogTrigger asChild>
                            <Button variant={triggerVariant} size={triggerSize} className={className}>
                                <IconFileCode className="w-4 h-4" />
                            </Button>
                        </DialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>View YAML</TooltipContent>
                    <DialogContent className="!max-w-dvw">
                        <TextViewer
                            title={`${resourceType}/${name} ${namespace ? `-n ${namespace}` : ''} YAML`}
                            value={isLoading ? 'Loading...' : yamlContent}
                        />
                    </DialogContent>
                </Dialog>
            </Tooltip>
        )
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {customTrigger ? (
                    customTrigger
                ) : (
                    <Button variant={triggerVariant} size={triggerSize} className={cn("gap-2", className)}>
                        <IconFileCode className="w-4 h-4" />
                        View YAML
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="!max-w-dvw">
                <TextViewer
                    title={`${resourceType}/${name} ${namespace ? `-n ${namespace}` : ''} YAML`}
                    value={isLoading ? 'Loading...' : yamlContent}
                />
            </DialogContent>
        </Dialog>
    )
}
