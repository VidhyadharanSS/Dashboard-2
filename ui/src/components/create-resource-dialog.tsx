import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCircleDot,
  IconCircleX,
  IconCopy,
  IconEye,
  IconFileCode,
  IconLoader2,
  IconPlayerPlay,
  IconSearch,
  IconSparkles,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  applyResource,
  ApplyResultItem,
  useTemplates,
  validateYAML,
  ValidateObjectInfo,
} from '@/lib/api'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SimpleYamlEditor } from '@/components/simple-yaml-editor'

interface CreateResourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DialogView = 'editor' | 'preview' | 'results'

const STATUS_STYLES: Record<string, { icon: typeof IconCheck; color: string; bg: string }> = {
  created: { icon: IconCircleCheck, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  updated: { icon: IconCircleDot, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
  'created (dry-run)': { icon: IconCircleCheck, color: 'text-emerald-600/60 dark:text-emerald-400/60', bg: 'bg-emerald-500/5' },
  'updated (dry-run)': { icon: IconCircleDot, color: 'text-blue-600/60 dark:text-blue-400/60', bg: 'bg-blue-500/5' },
  failed: { icon: IconCircleX, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' },
  skipped: { icon: IconAlertTriangle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
}

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.failed
}

export function CreateResourceDialog({
  open,
  onOpenChange,
}: CreateResourceDialogProps) {
  const { t } = useTranslation()
  const { data: templates = [] } = useTemplates()
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [yamlContent, setYamlContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [view, setView] = useState<DialogView>('editor')
  const [previewObjects, setPreviewObjects] = useState<ValidateObjectInfo[]>([])
  const [applyResults, setApplyResults] = useState<ApplyResultItem[]>([])
  const [applySummary, setApplySummary] = useState<{ message: string; succeeded: number; failed: number; dryRun: boolean } | null>(null)
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set())

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setYamlContent('')
      setSelectedTemplateId('')
      setView('editor')
      setPreviewObjects([])
      setApplyResults([])
      setApplySummary(null)
      setExpandedErrors(new Set())
    }
  }, [open])

  // Keyboard shortcut: Ctrl+Enter to apply from editor
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (view === 'editor' && yamlContent.trim() && !isLoading) {
          handleApply(false)
        } else if (view === 'preview' && !isLoading) {
          handleApply(false)
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        if (view === 'editor' && yamlContent.trim() && !isLoading) {
          handleApply(true) // dry run
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, view, yamlContent, isLoading])

  // Count objects in the YAML (rough estimate by counting "---" separators and kind: lines)
  const estimatedObjectCount = useMemo(() => {
    if (!yamlContent.trim()) return 0
    const docs = yamlContent.split(/^---$/m).filter((doc) => doc.trim().length > 0)
    return docs.length
  }, [yamlContent])

  // Detect resource kinds for quick badges
  const detectedKinds = useMemo(() => {
    if (!yamlContent.trim()) return []
    const matches = yamlContent.match(/^kind:\s*(\S+)/gm) || []
    return [...new Set(matches.map(m => m.replace(/^kind:\s*/, '')))]
  }, [yamlContent])

  const handleTemplateChange = (templateName: string) => {
    if (templateName === 'empty') {
      setYamlContent('')
      setSelectedTemplateId('')
      return
    }
    const template = templates.find((t) => t.name === templateName)
    if (template) {
      setYamlContent(template.yaml)
      setSelectedTemplateId(template.name)
    }
  }

  // Validate & Preview — parse YAML and show identified objects before applying
  const handlePreview = useCallback(async () => {
    if (!yamlContent.trim()) return
    setIsValidating(true)
    try {
      const result = await validateYAML(yamlContent)
      setPreviewObjects(result.objects)
      setView('preview')
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsValidating(false)
    }
  }, [yamlContent, t])

  // Apply resources (with optional dry-run)
  const handleApply = useCallback(async (dryRun: boolean = false) => {
    if (!yamlContent.trim()) return
    setIsLoading(true)
    try {
      const result = await applyResource(yamlContent, dryRun)
      setApplyResults(result.results)
      setApplySummary({
        message: result.message,
        succeeded: result.succeeded,
        failed: result.failed,
        dryRun: result.dryRun,
      })
      setView('results')

      if (!dryRun && result.failed === 0) {
        toast.success(
          result.totalObjects === 1
            ? `${result.results[0]?.kind} "${result.results[0]?.name}" ${result.results[0]?.status} successfully`
            : `${result.succeeded} resource(s) applied successfully`
        )
      } else if (!dryRun && result.failed > 0 && result.succeeded > 0) {
        toast.warning(`${result.succeeded} succeeded, ${result.failed} failed`)
      } else if (!dryRun && result.failed > 0 && result.succeeded === 0) {
        toast.error(`All ${result.failed} resource(s) failed to apply`)
      }
    } catch (err) {
      toast.error(translateError(err, t))
    } finally {
      setIsLoading(false)
    }
  }, [yamlContent, t])

  const handleCancel = () => {
    setYamlContent('')
    setSelectedTemplateId('')
    onOpenChange(false)
  }

  const toggleErrorExpand = (index: number) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleCopyResults = useCallback(() => {
    const text = applyResults.map(r =>
      `${r.status.toUpperCase()} ${r.kind}/${r.name}${r.namespace ? ` (ns: ${r.namespace})` : ''}${r.error ? ` — ${r.error}` : ''}`
    ).join('\n')
    navigator.clipboard.writeText(text)
    toast.success('Results copied to clipboard')
  }, [applyResults])

  const validPreviewCount = previewObjects.filter((o) => o.valid).length
  const invalidPreviewCount = previewObjects.filter((o) => !o.valid).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl sm:!max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFileCode className="h-5 w-5 text-primary" />
            {t('createResource.title', 'Apply Resources')}
            {estimatedObjectCount > 1 && view === 'editor' && (
              <Badge variant="secondary" className="text-[10px] ml-1">
                {estimatedObjectCount} objects
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {view === 'editor' && 'Paste single or multi-document YAML (separated by ---). Each resource will be identified and applied individually.'}
            {view === 'preview' && `${previewObjects.length} resource object(s) identified. Review before applying.`}
            {view === 'results' && (applySummary?.message || 'Apply completed.')}
          </DialogDescription>
        </DialogHeader>

        {/* ─── Step indicator ─── */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1">
            {(['editor', 'preview', 'results'] as const).map((step, i) => {
              const isActive = view === step
              const isPast = (['editor', 'preview', 'results'] as const).indexOf(view) > i
              return (
                <div key={step} className="flex items-center gap-1">
                  {i > 0 && <div className={`h-px w-4 ${isPast || isActive ? 'bg-primary' : 'bg-border'}`} />}
                  <button
                    onClick={() => {
                      if (step === 'editor') setView('editor')
                      if (step === 'preview' && previewObjects.length > 0) setView('preview')
                      if (step === 'results' && applyResults.length > 0) setView('results')
                    }}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-all ${isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : isPast
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                      }`}
                  >
                    {isPast ? (
                      <IconCheck className="h-3 w-3" />
                    ) : (
                      <span className="h-4 w-4 rounded-full border flex items-center justify-center text-[10px]">
                        {i + 1}
                      </span>
                    )}
                    {step === 'editor' ? 'Edit' : step === 'preview' ? 'Preview' : 'Results'}
                  </button>
                </div>
              )
            })}
          </div>
          {/* Detected kinds in editor mode */}
          {view === 'editor' && detectedKinds.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden">
              {detectedKinds.slice(0, 4).map((kind) => (
                <Badge key={kind} variant="outline" className="text-[9px] h-4 font-mono shrink-0">
                  {kind}
                </Badge>
              ))}
              {detectedKinds.length > 4 && (
                <span className="text-[9px] text-muted-foreground">+{detectedKinds.length - 4}</span>
              )}
            </div>
          )}
        </div>

        {/* ─── Editor View ─── */}
        {view === 'editor' && (
          <div className="flex-1 space-y-3 min-h-0">
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="template" className="text-xs">Template</Label>
                <Select
                  value={selectedTemplateId || 'empty'}
                  onValueChange={handleTemplateChange}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder={t('createResource.selectTemplate', 'Select a template')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empty">
                      {t('createResource.emptyTemplate', 'Empty Template')}
                    </SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.name} value={template.name}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Quick info badge */}
              {yamlContent.trim() && (
                <div className="pb-0.5">
                  <Badge variant="outline" className="text-[10px] gap-1 h-6">
                    <IconFileCode className="h-3 w-3" />
                    {estimatedObjectCount} object{estimatedObjectCount !== 1 ? 's' : ''}
                  </Badge>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">YAML Configuration</Label>
                <span className="text-[10px] text-muted-foreground">
                  <kbd className="bg-muted px-1 py-0.5 rounded text-[9px] font-mono">Ctrl+Enter</kbd> to apply
                  {' · '}
                  <kbd className="bg-muted px-1 py-0.5 rounded text-[9px] font-mono">Ctrl+Shift+Enter</kbd> dry run
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Supports multi-document YAML — separate resources with <code className="bg-muted px-1 py-0.5 rounded text-[10px]">---</code>
              </p>
              <div className="min-h-[300px] border rounded-md">
                <SimpleYamlEditor
                  value={yamlContent}
                  onChange={(value) => setYamlContent(value || '')}
                  height="380px"
                />
              </div>
            </div>
          </div>
        )}

        {/* ─── Preview View — Identified Objects ─── */}
        {view === 'preview' && (
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {/* Summary bar */}
            <div className="flex items-center gap-3 bg-muted/40 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <IconSearch className="h-4 w-4 text-primary" />
                {previewObjects.length} object{previewObjects.length !== 1 ? 's' : ''} identified
              </div>
              <div className="flex items-center gap-2 ml-auto text-xs">
                {validPreviewCount > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <IconCircleCheck className="h-3.5 w-3.5" />
                    {validPreviewCount} valid
                  </span>
                )}
                {invalidPreviewCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                    <IconCircleX className="h-3.5 w-3.5" />
                    {invalidPreviewCount} invalid
                  </span>
                )}
              </div>
            </div>

            {/* Object list */}
            <div className="space-y-2">
              {previewObjects.map((obj, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 transition-colors ${obj.valid
                    ? 'border-border hover:border-primary/30 bg-card'
                    : 'border-red-500/30 bg-red-500/5'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${obj.valid
                      ? 'bg-primary/10 text-primary'
                      : 'bg-red-500/10 text-red-600 dark:text-red-400'
                      }`}>
                      {obj.index}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] h-5 font-mono">
                          {obj.kind || '???'}
                        </Badge>
                        <span className="text-sm font-medium truncate">
                          {obj.name || <span className="text-muted-foreground italic">unnamed</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span>apiVersion: {obj.apiVersion || 'missing'}</span>
                        {obj.namespace && (
                          <>
                            <span>·</span>
                            <span>ns: {obj.namespace}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {obj.valid ? (
                        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px] gap-1">
                          <IconCircleCheck className="h-3 w-3" />
                          Valid
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <IconCircleX className="h-3 w-3" />
                          Invalid
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!obj.valid && obj.error && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-500/5 rounded px-2 py-1">
                      {obj.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Results View — Per-Object Apply Status ─── */}
        {view === 'results' && (
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {/* Summary bar */}
            {applySummary && (
              <div className={`rounded-lg px-4 py-3 flex items-center gap-3 ${applySummary.failed === 0
                ? 'bg-emerald-500/10 border border-emerald-500/20'
                : applySummary.succeeded > 0
                  ? 'bg-amber-500/10 border border-amber-500/20'
                  : 'bg-red-500/10 border border-red-500/20'
                }`}>
                {applySummary.failed === 0 ? (
                  <IconCircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <IconAlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium">{applySummary.message}</p>
                  {applySummary.dryRun && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <IconSparkles className="h-3 w-3 text-blue-500" />
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                        Dry-run — no changes were made to the cluster. Click "Apply for Real" to commit.
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs shrink-0">
                  {applySummary.succeeded > 0 && (
                    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25">
                      ✓ {applySummary.succeeded}
                    </Badge>
                  )}
                  {applySummary.failed > 0 && (
                    <Badge variant="destructive">
                      ✕ {applySummary.failed}
                    </Badge>
                  )}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={handleCopyResults}
                        >
                          <IconCopy className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy results to clipboard</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}

            {/* Per-object results */}
            <div className="space-y-2">
              {applyResults.map((result, i) => {
                const style = getStatusStyle(result.status)
                const StatusIcon = style.icon
                const isExpanded = expandedErrors.has(i)

                return (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 transition-colors ${result.status === 'failed'
                      ? 'border-red-500/30'
                      : 'border-border'
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}>
                        <StatusIcon className={`h-4 w-4 ${style.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] h-5 font-mono shrink-0">
                            {result.kind || '???'}
                          </Badge>
                          <span className="text-sm font-medium truncate">{result.name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          {result.namespace && <span>ns: {result.namespace}</span>}
                          {result.apiVersion && (
                            <>
                              {result.namespace && <span>·</span>}
                              <span>{result.apiVersion}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <Badge className={`${style.bg} ${style.color} border text-[10px] capitalize`}>
                          {result.status}
                        </Badge>
                        {result.error && (
                          <button
                            onClick={() => toggleErrorExpand(i)}
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                          >
                            {isExpanded ? (
                              <IconChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <IconChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    {result.error && isExpanded && (
                      <pre className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-500/5 rounded px-3 py-2 whitespace-pre-wrap font-mono leading-relaxed border border-red-500/10">
                        {result.error}
                      </pre>
                    )}
                    {result.error && !isExpanded && (
                      <p className="mt-1.5 text-[11px] text-red-600/80 dark:text-red-400/80 truncate">
                        {result.error}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ─── Footer Actions ─── */}
        <DialogFooter className="flex-shrink-0 gap-2">
          {view === 'editor' && (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
                Cancel
              </Button>

              {/* Preview / Validate button */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={handlePreview}
                      disabled={isValidating || !yamlContent.trim()}
                      className="gap-2"
                    >
                      {isValidating ? (
                        <IconLoader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <IconEye className="h-4 w-4" />
                      )}
                      Preview
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Parse and identify all resource objects</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Dry-run button */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      onClick={() => handleApply(true)}
                      disabled={isLoading || !yamlContent.trim()}
                      className="gap-2"
                    >
                      {isLoading ? (
                        <IconLoader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <IconSearch className="h-4 w-4" />
                      )}
                      Dry Run
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Validate against the cluster without making changes</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Apply button */}
              <Button
                onClick={() => handleApply(false)}
                disabled={isLoading || !yamlContent.trim()}
                className="gap-2"
              >
                {isLoading ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconPlayerPlay className="h-4 w-4" />
                )}
                Apply
                {estimatedObjectCount > 1 && (
                  <Badge variant="secondary" className="text-[10px] h-4 ml-0.5">
                    {estimatedObjectCount}
                  </Badge>
                )}
              </Button>
            </>
          )}

          {view === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setView('editor')}>
                ← Back to Editor
              </Button>

              <Button
                variant="secondary"
                onClick={() => handleApply(true)}
                disabled={isLoading || validPreviewCount === 0}
                className="gap-2"
              >
                {isLoading ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconSearch className="h-4 w-4" />
                )}
                Dry Run
              </Button>

              <Button
                onClick={() => handleApply(false)}
                disabled={isLoading || validPreviewCount === 0}
                className="gap-2"
              >
                {isLoading ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconPlayerPlay className="h-4 w-4" />
                )}
                Apply {validPreviewCount} Object{validPreviewCount !== 1 ? 's' : ''}
              </Button>
            </>
          )}

          {view === 'results' && (
            <>
              <Button variant="outline" onClick={() => setView('editor')}>
                ← Edit Again
              </Button>

              {applySummary?.dryRun && (
                <Button
                  onClick={() => handleApply(false)}
                  disabled={isLoading}
                  className="gap-2"
                >
                  {isLoading ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <IconPlayerPlay className="h-4 w-4" />
                  )}
                  Apply for Real
                </Button>
              )}

              {!applySummary?.dryRun && applySummary?.failed === 0 && (
                <Button onClick={() => onOpenChange(false)} className="gap-2">
                  <IconCheck className="h-4 w-4" />
                  Done
                </Button>
              )}

              {!applySummary?.dryRun && (applySummary?.failed ?? 0) > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => handleApply(false)}
                  disabled={isLoading}
                  className="gap-2"
                >
                  <IconPlayerPlay className="h-4 w-4" />
                  Retry
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

