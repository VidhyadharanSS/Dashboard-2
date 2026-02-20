import { useState } from 'react'
import { IconFileCode } from '@tabler/icons-react'
import * as yaml from 'js-yaml'

import { ResourceType } from '@/types/api'
import { useResource } from '@/lib/api'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'

import { TextViewer } from './text-viewer'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface QuickYamlDialogProps {
    resourceType: ResourceType
    namespace?: string
    name: string
    triggerAsText?: boolean
    triggerVariant?: 'outline' | 'ghost' | 'default'
    triggerSize?: 'sm' | 'default' | 'icon'
    customTrigger?: React.ReactNode
}

export function QuickYamlDialog({
    resourceType,
    namespace,
    name,
    triggerAsText = false,
    triggerVariant = 'outline',
    triggerSize = 'sm',
    customTrigger,
}: QuickYamlDialogProps) {
    const [isOpen, setIsOpen] = useState(false)
    const { data, isLoading } = useResource(resourceType, name, namespace, {
        enabled: isOpen,
    })

    const yamlContent = data ? yaml.dump(data, { indent: 2 }) : ''

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {customTrigger ? (
                    customTrigger
                ) : triggerAsText ? (
                    <Button variant={triggerVariant} size={triggerSize} className="gap-2">
                        <IconFileCode className="w-4 h-4" />
                        View YAML
                    </Button>
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant={triggerVariant} size={triggerSize}>
                                <IconFileCode className="w-4 h-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>View YAML</TooltipContent>
                    </Tooltip>
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
