/**
 * ImageUpdateDialog - One-click container image tag update.
 *
 * Triggered from ContainerTable via an "Update Image" button.
 * Shows the current image, validates the new tag, previews the diff,
 * then applies via a JSON merge patch.
 */
import { useState } from 'react'
import { IconCheck, IconLoader, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { patchResource } from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ImageUpdateDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Resource type - deployments, statefulsets, daemonsets */
    resourceType: 'deployments' | 'statefulsets' | 'daemonsets'
    resourceName: string
    namespace: string
    containerName: string
    currentImage: string
    containerIndex: number
    isInitContainer?: boolean
    /** Called after successful update so parent can start rollout monitor */
    onSuccess?: () => void
}

function splitImage(image: string): { registry: string; name: string; tag: string } {
    // e.g. registry.example.com/namespace/image:tag
    const lastColon = image.lastIndexOf(':')
    const lastSlash = image.lastIndexOf('/')
    if (lastColon > lastSlash) {
        return { registry: '', name: image.slice(0, lastColon), tag: image.slice(lastColon + 1) }
    }
    return { registry: '', name: image, tag: 'latest' }
}

export function ImageUpdateDialog({
    open,
    onOpenChange,
    resourceType,
    resourceName,
    namespace,
    containerName,
    currentImage,
    containerIndex,
    isInitContainer = false,
    onSuccess,
}: ImageUpdateDialogProps) {
    const { t } = useTranslation()
    const { name: imageName, tag: currentTag } = splitImage(currentImage)

    const [newTag, setNewTag] = useState(currentTag)
    const [isSaving, setIsSaving] = useState(false)

    const newImage = newTag ? `${imageName}:${newTag}` : imageName
    const isChanged = newImage !== currentImage
    const isValidTag = /^[a-zA-Z0-9._\-]+$/.test(newTag.trim())

    const handleApply = async () => {
        if (!isChanged || !isValidTag) return
        setIsSaving(true)
        try {
            const containerKey = isInitContainer ? 'initContainers' : 'containers'
            const patch = {
                spec: {
                    template: {
                        spec: {
                            [containerKey]: Array.from({ length: containerIndex + 1 }).map((_, i) =>
                                i === containerIndex
                                    ? { name: containerName, image: newImage }
                                    : undefined
                            ).filter(Boolean),
                        },
                    },
                },
            }
            await patchResource(resourceType, resourceName, namespace, patch)
            toast.success(`Image updated: ${containerName} → ${newImage}`)
            onOpenChange(false)
            onSuccess?.()
        } catch (error) {
            toast.error(translateError(error, t))
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md overflow-hidden">
                <DialogHeader className="pr-8">
                    <DialogTitle className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span>Update Container Image</span>
                        <Badge variant="outline" className="text-xs font-mono shrink-0 max-w-[180px] truncate">{containerName}</Badge>
                    </DialogTitle>
                    <DialogDescription>
                        Change the image tag for <strong>{containerName}</strong> in <strong>{resourceName}</strong>.
                        This will trigger a rolling update.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 overflow-hidden">
                    {/* Current image display */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Current image</Label>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 overflow-hidden min-w-0">
                            <span className="text-xs font-mono text-muted-foreground truncate min-w-0 flex-1">{imageName}</span>
                            <Badge variant="secondary" className="text-xs font-mono shrink-0">:{currentTag}</Badge>
                        </div>
                    </div>

                    {/* New tag input */}
                    <div className="space-y-1.5">
                        <Label htmlFor="image-tag" className="text-xs">New tag</Label>
                        <div className="flex items-stretch rounded-md border shadow-sm focus-within:ring-1 focus-within:ring-primary h-10 overflow-hidden min-w-0">
                            <div className="bg-muted/50 px-3 flex items-center border-r select-none shrink min-w-0 max-w-[55%] overflow-hidden">
                                <span className="text-xs font-mono text-muted-foreground truncate block">
                                    {imageName.length > 35 ? '…' + imageName.slice(-30) : imageName}:
                                </span>
                            </div>
                            <Input
                                id="image-tag"
                                className="border-0 rounded-none focus-visible:ring-0 shadow-none h-full font-mono text-sm px-3 min-w-0 flex-1"
                                value={newTag}
                                onChange={(e) => setNewTag(e.target.value)}
                                placeholder="tag"
                                onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                                autoFocus
                            />
                        </div>
                        {newTag && !isValidTag && (
                            <p className="text-[10px] text-destructive pl-1">Tag contains invalid characters</p>
                        )}
                    </div>

                    {/* Preview of change */}
                    {isChanged && (
                        <div className="px-3 py-2.5 rounded-md border border-primary/20 bg-primary/5 space-y-1.5 overflow-hidden">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Preview</p>
                            <div className="flex flex-col gap-1 text-xs font-mono overflow-hidden min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-muted-foreground shrink-0 text-[10px]">FROM</span>
                                    <span className="text-destructive/80 line-through truncate min-w-0">{currentImage}</span>
                                </div>
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-muted-foreground shrink-0 text-[10px]">TO</span>
                                    <span className="text-primary font-semibold truncate min-w-0">{newImage}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                        <IconX className="h-4 w-4 mr-1" />
                        Cancel
                    </Button>
                    <Button
                        onClick={handleApply}
                        disabled={!isChanged || !isValidTag || isSaving}
                    >
                        {isSaving
                            ? <><IconLoader className="h-4 w-4 mr-2 animate-spin" /> Updating…</>
                            : <><IconCheck className="h-4 w-4 mr-1" /> Apply Update</>
                        }
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

