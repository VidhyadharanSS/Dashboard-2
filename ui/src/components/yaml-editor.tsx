import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { IconCheck, IconEdit, IconLoader, IconLock, IconX } from '@tabler/icons-react'
import { formatHex } from 'culori'
import * as yaml from 'js-yaml'
import { editor as monacoEditor } from 'monaco-editor'

import { ResourceType, ResourceTypeMap } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  diffForbiddenInYaml,
  isWorkloadKind,
  LOCKED_WORKLOAD_FIELD_LABELS,
} from '@/lib/workload-policy'

import { useAppearance } from './appearance-provider'
import { YamlDiffViewer } from './yaml-diff-viewer'
import { IconAnalyze } from '@tabler/icons-react'

interface YamlEditorProps<T extends ResourceType> {
  /** The YAML content to edit */
  value: string
  /** Whether the editor is in read-only mode by default */
  readOnly?: boolean
  /** Whether to show the edit controls */
  showControls?: boolean
  /** Card title */
  title?: string
  /** Minimum height of the editor */
  minHeight?: number
  /** Callback when YAML content changes */
  onChange?: (value: string) => void
  /** Callback when save is clicked */
  onSave?: (value: ResourceTypeMap[T]) => void
  /** Callback when cancel is clicked */
  onCancel?: () => void
  /** Whether save operation is in progress */
  isSaving?: boolean
  /** Whether there are unsaved edits (shows a warning banner) */
  unsaved?: boolean
  /** Custom class name for the card */
  className?: string
}

export function YamlEditor<T extends ResourceType>({
  value,
  readOnly = false,
  showControls = true,
  title = 'YAML Configuration',
  onChange,
  onSave,
  onCancel,
  isSaving = false,
  unsaved = false,
  className,
}: YamlEditorProps<T>) {
  const [isEditing, setIsEditing] = useState(true)
  const [editorValue, setEditorValue] = useState(value)
  const [isValidYaml, setIsValidYaml] = useState(true)
  const [validationError, setValidationError] = useState<string>('')
  const [policyViolations, setPolicyViolations] = useState<string[]>([])
  const { actualTheme, colorTheme } = useAppearance()
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const [isDiffVisible, setIsDiffVisible] = useState(false)
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // The original YAML at first render is the security baseline. Forbidden
  // fields are diffed against this baseline on Save; any change is rejected
  // client-side regardless of caller role. Mirrors the server-side validator
  // in pkg/handlers/resource_apply_handler.go::validateWorkloadFields.
  const baselineYamlRef = useRef<string>(value)
  useEffect(() => {
    // Refresh baseline only when the editor is not in edit mode AND the value
    // changed (background poll). Once the user starts editing, the baseline
    // is frozen for the duration of the edit session.
    if (!isEditing) {
      baselineYamlRef.current = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const isWorkloadDoc = useMemo(() => {
    try {
      return isWorkloadKind(yaml.load(editorValue))
    } catch {
      return false
    }
  }, [editorValue])

  const getCardBackgroundColor = () => {
    const card = getComputedStyle(document.documentElement)
      .getPropertyValue('--card')
      .trim()
    if (!card) {
      return actualTheme === 'dark' ? '#18181b' : '#ffffff'
    }
    return formatHex(card) || (actualTheme === 'dark' ? '#18181b' : '#ffffff')
  }

  // Update editor value when value prop changes - but ONLY when the user
  // has not started editing. Without this guard the YamlEditor's own internal
  // state would also get reset by background polls, even after the parent-level
  // isDirty flag is set.
  useEffect(() => {
    if (!isEditing || editorValue === '') {
      setEditorValue(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Validate YAML on content change with debounce for error display
  useEffect(() => {
    // Immediate validation for isValidYaml state
    try {
      yaml.load(editorValue)
      setIsValidYaml(true)
      setValidationError('') // Clear error immediately when valid
    } catch (error) {
      setIsValidYaml(false) // Set invalid state immediately

      // Clear previous timeout
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }

      // Delay showing the error message
      validationTimeoutRef.current = setTimeout(() => {
        setValidationError(
          error instanceof Error ? error.message.split('\n')[0] : 'Invalid YAML'
        )
      }, 1000) // 1 second delay only for error message display
    }

    // Cleanup timeout on unmount
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [editorValue])

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || ''
    setEditorValue(newValue)
    // Clear any prior policy-violation banner - the user is now editing again
    // and should get a fresh re-check on the next Save click.
    if (policyViolations.length > 0) setPolicyViolations([])
    onChange?.(newValue)
  }

  const handleEdit = () => {
    setIsEditing(true)
    // Focus the editor after setting editing mode
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus()
      }
    }, 100)
  }

  const handleSave = () => {
    if (!isValidYaml) return
    // Enforce the workload field policy client-side. The server enforces the
    // same policy authoritatively; this check exists so the user gets
    // immediate feedback and we never transmit a request that mutates a
    // protected field.
    const violations = diffForbiddenInYaml(baselineYamlRef.current, editorValue)
    if (violations.length > 0) {
      setPolicyViolations(violations)
      return
    }
    setPolicyViolations([])
    onSave?.(yaml.load(editorValue) as ResourceTypeMap[T])
    if (!readOnly) {
      setIsEditing(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    onCancel?.()
  }

  const handleEditorDidMount = (editor: monacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }

  const effectiveReadOnly = readOnly || !isEditing

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {title}
            {unsaved && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">
                ● Unsaved edits - live updates paused
              </span>
            )}
          </CardTitle>
        </div>
        <div className="flex items-center gap-4">
          {showControls && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsDiffVisible(true)}
                    className="border-amber-500/30 hover:border-amber-500 text-amber-600 dark:text-amber-400"
                  >
                    <IconAnalyze className="w-4 h-4 mr-2" />
                    View Changes
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isValidYaml || isSaving}
                  >
                    {isSaving ? (
                      <IconLoader className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <IconCheck className="w-4 h-4 mr-2" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    <IconX className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEdit}
                  disabled={readOnly}
                >
                  <IconEdit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {!isValidYaml && validationError && (
            <div className="px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{validationError}</p>
            </div>
          )}
          {isWorkloadDoc && isEditing && !effectiveReadOnly && (
            <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2 font-medium mb-1">
                <IconLock className="w-3.5 h-3.5" />
                Read-only fields (security policy - applies to all roles):
              </div>
              <ul className="list-disc pl-5 leading-relaxed">
                {LOCKED_WORKLOAD_FIELD_LABELS.map((p) => (
                  <li key={p}>
                    <code className="font-mono">{p}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {policyViolations.length > 0 && (
            <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-md">
              <p className="text-sm font-medium text-destructive mb-1">
                Save blocked: the following protected fields were modified.
                Revert them to their original values to save.
              </p>
              <ul className="list-disc pl-5 text-xs text-destructive font-mono">
                {policyViolations.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="overflow-hidden h-[calc(100dvh-300px)]">
            <Editor
              key={`yaml-editor-${colorTheme}-${actualTheme}`} // Force remount on theme change
              language="yaml"
              theme={
                actualTheme === 'dark'
                  ? `custom-dark-${colorTheme}`
                  : `custom-vs-${colorTheme}`
              }
              value={editorValue}
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
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                readOnly: effectiveReadOnly,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                lineNumbers: 'on',
                folding: true,
                renderLineHighlight: effectiveReadOnly ? 'none' : 'line',
                tabSize: 2,
                insertSpaces: true,
                fontSize: 14,
                fontFamily:
                  "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
                acceptSuggestionOnCommitCharacter: false,
                acceptSuggestionOnEnter: 'off',
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                // Disable unnecessary features for YAML editing
                parameterHints: { enabled: false },
                hover: { enabled: false },
                contextmenu: false,
                // Better scrolling behavior
                smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on',
                multiCursorModifier: 'alt',
                accessibilitySupport: 'off',
                quickSuggestionsDelay: 500,
                links: false,
                colorDecorators: false,
              }}
            />
          </div>
        </div>
      </CardContent>

      <YamlDiffViewer
        original={value}
        modified={editorValue}
        open={isDiffVisible}
        onOpenChange={setIsDiffVisible}
        title="Review YAML Changes"
        height={700}
      />
    </Card>
  )
}
