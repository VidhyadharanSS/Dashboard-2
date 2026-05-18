import { useState } from 'react'
import { IconClipboardText } from '@tabler/icons-react'

import { ResourceType } from '@/types/api'
import { useDescribe } from '@/lib/api'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { TextViewer } from './text-viewer'
import { Button } from './ui/button'

interface DescribeDialogProps {
  resourceType: ResourceType
  namespace?: string
  name: string
  /** Render as a compact icon-only button (for table rows) */
  triggerVariant?: 'outline' | 'ghost' | 'default'
  triggerSize?: 'sm' | 'icon'
  /** When true, show only the icon with a tooltip (compact mode) */
  compact?: boolean
}

export function DescribeDialog({
  resourceType,
  namespace,
  name,
  triggerVariant = 'outline',
  triggerSize = 'sm',
  compact = false,
}: DescribeDialogProps) {
  const [isDescribeOpen, setIsDescribeOpen] = useState(false)
  const { data: describeText } = useDescribe(resourceType, name, namespace, {
    enabled: isDescribeOpen,
    staleTime: 0,
  })

  // In compact mode, we render Tooltip OUTSIDE Dialog so that DialogTrigger's
  // asChild can forward its ref + click directly onto the <Button> DOM element.
  // Wrapping DialogTrigger around a <Tooltip> provider broke asChild forwarding.
  if (compact) {
    return (
      <Tooltip>
        <Dialog open={isDescribeOpen} onOpenChange={setIsDescribeOpen}>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                variant={triggerVariant}
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <IconClipboardText className="w-3.5 h-3.5" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Describe</TooltipContent>
          <DialogContent className="!max-w-dvw">
            <TextViewer
              title={`kubectl describe ${resourceType} ${namespace ? `-n ${namespace}` : ''} ${name}`}
              value={describeText?.result || ''}
            />
          </DialogContent>
        </Dialog>
      </Tooltip>
    )
  }

  return (
    <Dialog open={isDescribeOpen} onOpenChange={setIsDescribeOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <IconClipboardText className="w-4 h-4" />
          Describe
        </Button>
      </DialogTrigger>
      <DialogContent className="!max-w-dvw">
        <TextViewer
          title={`kubectl describe ${resourceType} ${namespace ? `-n ${namespace}` : ''} ${name}`}
          value={describeText?.result || ''}
        />
      </DialogContent>
    </Dialog>
  )
}
