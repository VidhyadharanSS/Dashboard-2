import { useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { formatHex } from 'culori'
import * as yaml from 'js-yaml'
import { editor as monacoEditor } from 'monaco-editor'
import { useTranslation } from 'react-i18next'
import { IconRotate2, IconAlertTriangle } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useAppearance } from './appearance-provider'

interface YamlDiffViewerProps {
  /** Original YAML content */
  original: string
  /** Modified YAML content */
  modified: string
  /** Current YAML content (for current vs modified diff) */
  current?: string
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog is closed */
  onOpenChange: (open: boolean) => void
  /** Callback when user wants to rollback to a specific version */
  onRollback?: (yamlContent: string) => void
  /** Whether rollback operation is in progress */
  isRollingBack?: boolean
  /** Dialog title */
  title?: string
  /** Height of the diff editor */
  height?: number
}

type DiffMode = 'previous-vs-modified' | 'current-vs-modified'

export function YamlDiffViewer({
  original,
  modified,
  current,
  open,
  onOpenChange,
  onRollback,
  isRollingBack = false,
  title = 'YAML Diff',
  height = 600,
}: YamlDiffViewerProps) {
  const { t } = useTranslation()
  const { actualTheme, colorTheme } = useAppearance()

  const getCardBackgroundColor = () => {
    const card = getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim()
    if (!card) {
      return actualTheme === 'dark' ? '#18181b' : '#ffffff'
    }
    return formatHex(card) || (actualTheme === 'dark' ? '#18181b' : '#ffffff')
  }
  const editorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('previous-vs-modified')
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false)
  const [pendingRollbackYaml, setPendingRollbackYaml] = useState<string | null>(null)
  const [pendingRollbackLabel, setPendingRollbackLabel] = useState<string>('')

  const handleEditorDidMount = (editor: monacoEditor.IStandaloneDiffEditor) => {
    editorRef.current = editor
  }

  // Remove status field from YAML content
  const removeStatusField = (yamlContent: string): string => {
    if (!yamlContent.trim()) return yamlContent

    try {
      const parsed = yaml.load(yamlContent)
      if (parsed && typeof parsed === 'object') {
        // Remove status field recursively
        const removeStatus = (obj: unknown): unknown => {
          if (obj && typeof obj === 'object') {
            if (Array.isArray(obj)) {
              return obj.map(removeStatus)
            } else {
              const result: Record<string, unknown> = {}
              for (const [key, value] of Object.entries(obj)) {
                if (key !== 'status') {
                  result[key] = removeStatus(value)
                }
              }
              return result
            }
          }
          return obj
        }

        const cleaned = removeStatus(parsed)
        return yaml.dump(cleaned, { indent: 2, sortKeys: true })
      }
    } catch (error) {
      console.error('Failed to remove status field from YAML:', error)
    }

    return yamlContent
  }

  // Determine which content to show based on diff mode
  const getDiffContent = () => {
    if (diffMode === 'current-vs-modified' && current) {
      return {
        original: removeStatusField(current),
        modified: removeStatusField(modified),
      }
    }
    return {
      original: removeStatusField(original),
      modified: removeStatusField(modified),
    }
  }

  const { original: leftContent, modified: rightContent } = getDiffContent()

  // Handle rollback button clicks — open confirmation dialog
  const handleRollbackClick = (yamlContent: string, label: string) => {
    if (onRollback) {
      setPendingRollbackYaml(yamlContent)
      setPendingRollbackLabel(label)
      setRollbackConfirmOpen(true)
    }
  }

  const confirmRollback = () => {
    if (onRollback && pendingRollbackYaml) {
      onRollback(pendingRollbackYaml)
      setRollbackConfirmOpen(false)
      setPendingRollbackYaml(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-6xl sm:!max-w-6xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="text-lg font-bold">{title}</span>
            <div className="flex items-center gap-2 mr-4">
              {current && (
                <>
                  {diffMode === 'current-vs-modified' && (
                    <Button
                      onClick={() => handleRollbackClick(modified, 'modified version')}
                      disabled={isRollingBack}
                      variant="default"
                      size="sm"
                    >
                      <IconRotate2 className={`w-4 h-4 mr-2 ${isRollingBack ? 'animate-spin' : ''}`} />
                      {t('resourceHistory.rollback.modified')}
                    </Button>
                  )}

                  {diffMode === 'previous-vs-modified' && (
                    <>
                      <Button
                        onClick={() => handleRollbackClick(original, 'previous version')}
                        disabled={isRollingBack}
                        variant="default"
                        size="sm"
                      >
                        <IconRotate2 className={`w-4 h-4 mr-2 ${isRollingBack ? 'animate-spin' : ''}`} />
                        {t('resourceHistory.rollback.previous')}
                      </Button>
                      <Button
                        onClick={() => handleRollbackClick(modified, 'modified version')}
                        disabled={isRollingBack}
                        variant="secondary"
                        size="sm"
                      >
                        <IconRotate2 className={`w-4 h-4 mr-2 ${isRollingBack ? 'animate-spin' : ''}`} />
                        {t('resourceHistory.rollback.modified')}
                      </Button>
                    </>
                  )}

                  <Select
                    value={diffMode}
                    onValueChange={(value: DiffMode) => setDiffMode(value)}
                  >
                    <SelectTrigger className="max-w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="previous-vs-modified">
                        {t('resourceHistory.previousVsModified')}
                      </SelectItem>
                      <SelectItem value="current-vs-modified">
                        {t('resourceHistory.currentVsModified')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <DiffEditor
            height={height}
            language="yaml"
            beforeMount={(monaco) => {
              const cardBgColor = getCardBackgroundColor()
              monaco.editor.defineTheme(`custom-dark-${colorTheme}`, {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                  'editor.background': cardBgColor,
                },
              })
              monaco.editor.defineTheme(`custom-vs-${colorTheme}`, {
                base: 'vs',
                inherit: true,
                rules: [],
                colors: {
                  'editor.background': cardBgColor,
                },
              })
            }}
            theme={
              actualTheme === 'dark'
                ? `custom-dark-${colorTheme}`
                : `custom-vs-${colorTheme}`
            }
            options={{
              readOnly: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              folding: true,
              lineNumbers: 'relative',
              fontSize: 14,
              fontFamily:
                "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
              renderSideBySide: true,
              enableSplitViewResizing: true,
              renderOverviewRuler: true,
              overviewRulerBorder: true,
              overviewRulerLanes: 2,
            }}
            onMount={handleEditorDidMount}
            original={leftContent}
            modified={rightContent}
          />
        </div>
      </DialogContent>

      {/* Rollback Confirmation Dialog */}
      <Dialog open={rollbackConfirmOpen} onOpenChange={(open) => {
        if (!open) { setRollbackConfirmOpen(false); setPendingRollbackYaml(null) }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconAlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Rollback
            </DialogTitle>
            <DialogDescription>
              You are about to rollback this resource to the <strong className="text-foreground">{pendingRollbackLabel}</strong>.
              This will apply the selected YAML configuration to the cluster, replacing the current state.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ This action will modify the live resource in your cluster. Ensure you have reviewed the diff carefully before proceeding.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setRollbackConfirmOpen(false); setPendingRollbackYaml(null) }} disabled={isRollingBack}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={isRollingBack}
              onClick={confirmRollback}
              className="gap-1.5"
            >
              <IconRotate2 className={`h-4 w-4 ${isRollingBack ? 'animate-spin' : ''}`} />
              {isRollingBack ? 'Rolling back...' : 'Confirm Rollback'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
