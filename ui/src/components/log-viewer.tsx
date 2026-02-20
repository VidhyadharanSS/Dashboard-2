import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import {
  IconClearAll,
  IconDownload,
  IconMaximize,
  IconMinimize,
  IconPalette,
  IconSearch,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import { Container, Pod } from 'kubernetes-types/core/v1'
import type { editor } from 'monaco-editor'
import { useTranslation } from 'react-i18next'

import { TERMINAL_THEMES, TerminalTheme } from '@/types/themes'
import {
  AnsiState,
  generateAnsiCss,
  getAnsiClassNames,
  parseAnsi,
} from '@/lib/ansi-parser'
import { useLogsWebSocket } from '@/lib/api'
import { toSimpleContainer } from '@/lib/k8s'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { ConnectionIndicator } from './connection-indicator'
import { NetworkSpeedIndicator } from './network-speed-indicator'
import { MultiContainerSelector } from './selector/multi-container-selector'
import { PodSelector } from './selector/pod-selector'

function LogStreamer({
  namespace,
  podName,
  container,
  options,
  onStatusChange,
}: {
  namespace: string
  podName: string
  container: string
  options: {
    onNewLog: (log: string, container: string) => void
    [key: string]: unknown
  }
  onStatusChange?: (container: string, isConnected: boolean, isLoading: boolean, speed: number) => void
}) {
  const { isConnected, isLoading, downloadSpeed } = useLogsWebSocket(namespace, podName, {
    ...options,
    container,
    onNewLog: (log: string) => options.onNewLog(log, container),
  })

  useEffect(() => {
    onStatusChange?.(container, isConnected, isLoading, downloadSpeed)
  }, [isConnected, isLoading, downloadSpeed, container, onStatusChange])

  return null
}

interface LogViewerProps {
  namespace: string
  podName?: string
  pods?: Pod[]
  labelSelector?: string
  containers?: Container[]
  initContainers?: Container[]
  onClose?: () => void
}

export function LogViewer({
  namespace,
  podName,
  pods,
  containers: _containers,
  initContainers,
  onClose,
  labelSelector,
}: LogViewerProps) {
  const [logTheme, setLogTheme] = useState<TerminalTheme>(() => {
    const saved = localStorage.getItem('log-viewer-theme')
    return (saved as TerminalTheme) || 'classic'
  })
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])
  const [selectedContainers, setSelectedContainers] = useState<string[]>([])
  const [tailLines, setTailLines] = useState(() => {
    const saved = localStorage.getItem('log-viewer-tail-lines')
    return saved ? parseInt(saved, 10) : 100
  })
  const { t } = useTranslation()
  const [timestamps, setTimestamps] = useState(false)
  const [previous, setPrevious] = useState(false)
  const [filterTerm, setFilterTerm] = useState('')
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [wordWrap, setWordWrap] = useState<boolean>(() => {
    const saved = localStorage.getItem('log-viewer-word-wrap')
    if (saved === null) {
      localStorage.setItem('log-viewer-word-wrap', 'true')
      return true
    }
    return saved === 'true'
  })

  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(() => {
    const saved = localStorage.getItem('log-viewer-show-line-numbers')
    return saved === 'true'
  })

  const [errorOnly, setErrorOnly] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [streamStatuses, setStreamStatuses] = useState<Record<string, { isConnected: boolean, isLoading: boolean, speed: number }>>({})

  const handleStatusChange = useCallback((container: string, isConnected: boolean, isLoading: boolean, speed: number) => {
    setStreamStatuses(prev => ({
      ...prev,
      [container]: { isConnected, isLoading, speed }
    }))
  }, [])

  const isConnected = Object.values(streamStatuses).some(s => s.isConnected)
  const isLoading = Object.values(streamStatuses).some(s => s.isLoading)
  const downloadSpeed = Object.values(streamStatuses).reduce((acc, s) => acc + s.speed, 0)

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('log-viewer-font-size')
    return saved ? parseInt(saved, 10) : 14
  })
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [logCount, setLogCount] = useState(0) // Track log count for re-rendering
  const ansiStatesRef = useRef<Record<string, AnsiState>>({})
  const decorationIdsRef = useRef<string[]>([])

  const [rawLogs, setRawLogs] = useState<{ text: string; className: string }[]>([])
  const [followLogs, setFollowLogs] = useState(true)

  const cleanLog = useCallback(() => {
    setRawLogs([])
    setLogCount(0)
    ansiStatesRef.current = {}
    if (editorRef.current) {
      const model = editorRef.current.getModel()
      if (model) {
        model.setValue('')
      }
    }
  }, [])

  const getLogLevelClass = (text: string): string => {
    const lowerText = text.toLowerCase()
    if (
      lowerText.includes('error') ||
      lowerText.includes('failed') ||
      lowerText.includes('stderr')
    )
      return 'ansi-log-error'
    if (lowerText.includes('warn')) return 'ansi-log-warn'
    if (lowerText.includes('info')) return 'ansi-log-info'
    if (
      lowerText.includes('success') ||
      lowerText.includes('ok') ||
      lowerText.includes('ready')
    )
      return 'ansi-log-success'
    return ''
  }

  const appendLog = useCallback((log: string, container?: string) => {
    if (!ansiStatesRef.current[container || 'default']) {
      ansiStatesRef.current[container || 'default'] = {}
    }
    const { segments, finalState } = parseAnsi(log, ansiStatesRef.current[container || 'default'])
    ansiStatesRef.current[container || 'default'] = finalState

    const plainText = segments.map((s) => s.text).join('')
    const ansiClass = segments.map((s) => getAnsiClassNames(s.styles)).join(' ')

    const prefix = container && selectedContainers.length > 1 ? `[${container}] ` : ''
    const fullText = prefix + plainText
    const levelClass = getLogLevelClass(fullText)

    setRawLogs((prev) => {
      const newLogs = [
        ...prev,
        { text: fullText, className: `${ansiClass} ${levelClass}`.trim() },
      ]
      return newLogs.slice(-5000)
    })
    setLogCount((prev) => prev + 1)
  }, [selectedContainers.length])

  // Filtered logs for display
  const filtered = useMemo(() => {
    let result = rawLogs
    if (errorOnly) {
      result = result.filter((l) => l.className.includes('ansi-log-error'))
    }
    if (filterTerm) {
      result = result.filter((l) =>
        l.text.toLowerCase().includes(filterTerm.toLowerCase())
      )
    }
    return result
  }, [rawLogs, errorOnly, filterTerm])

  const errorCount = useMemo(() => {
    return rawLogs.filter((l) => l.className.includes('ansi-log-error')).length
  }, [rawLogs])

  // Update editor content when filtered logs change
  useEffect(() => {
    if (!editorRef.current) return

    const model = editorRef.current.getModel()
    if (!model) return

    const content = filtered.map((l) => l.text).join('\n')
    if (model.getValue() === content) return

    model.setValue(content)

    // Re-apply decorations
    const decorations: editor.IModelDeltaDecoration[] = []
    filtered.forEach((log, index) => {
      if (log.className) {
        decorations.push({
          range: {
            startLineNumber: index + 1,
            startColumn: 1,
            endLineNumber: index + 1,
            endColumn: log.text.length + 1,
          },
          options: {
            inlineClassName: log.className,
          },
        })
      }
    })

    decorationIdsRef.current = model.deltaDecorations(
      decorationIdsRef.current,
      decorations
    )

    if (followLogs) {
      editorRef.current.revealLine(model.getLineCount())
    }
  }, [filtered, followLogs])

  const [selectPodName, setSelectPodName] = useState<string | undefined>(
    podName || pods?.[0]?.metadata?.name || undefined
  )

  useEffect(() => {
    if (podName) {
      if (selectPodName !== podName) {
        setSelectPodName(podName)
      }
      return
    }
    if (pods && pods.length > 0) {
      if (
        selectPodName !== '_all' &&
        (!selectPodName ||
          !pods.find((p) => p.metadata?.name === selectPodName))
      ) {
        setSelectPodName(pods[0].metadata?.name)
      }
    }
  }, [podName, pods, selectPodName])

  useEffect(() => {
    if (containers.length > 0 && selectedContainers.length === 0) {
      setSelectedContainers([containers[0].name])
    }
  }, [containers, selectedContainers])

  // Handle theme change and persist to localStorage
  const handleThemeChange = useCallback((theme: TerminalTheme) => {
    setLogTheme(theme)
    localStorage.setItem('log-viewer-theme', theme)
  }, [])

  // Handle font size change and persist to localStorage
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size)
    localStorage.setItem('log-viewer-font-size', size.toString())
  }, [])

  // Handle tail lines change and persist to localStorage
  const handleTailLinesChange = useCallback((lines: number) => {
    setTailLines(lines)
    if (lines !== -1) {
      localStorage.setItem('log-viewer-tail-lines', lines.toString())
    }
  }, [])

  // Quick theme cycling function
  const cycleTheme = useCallback(() => {
    const themes = Object.keys(TERMINAL_THEMES) as TerminalTheme[]
    const currentIndex = themes.indexOf(logTheme)
    const nextIndex = (currentIndex + 1) % themes.length
    handleThemeChange(themes[nextIndex])
  }, [logTheme, handleThemeChange])

  // Handle editor mount
  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor

    // Configure search widget
    editor.updateOptions({
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: 'never',
        seedSearchStringFromSelection: 'never',
      },
    })
  }, [])

  const commonLogsOptions = useMemo(
    () => ({
      tailLines,
      timestamps,
      previous,
      enabled: !!selectPodName,
      labelSelector,
      onNewLog: appendLog,
      onClear: cleanLog,
    }),
    [
      tailLines,
      timestamps,
      previous,
      selectPodName,
      labelSelector,
      appendLog,
      cleanLog,
    ]
  )

  const clearLogs = cleanLog

  useEffect(() => {
    setIsReconnecting(true)
    const timer = setTimeout(() => setIsReconnecting(false), 500)
    return () => clearTimeout(timer)
  }, [selectedContainers, selectPodName, tailLines, timestamps, previous])

  const refetch = useCallback(() => {
    setStreamStatuses({})
    setIsReconnecting(true)
    setTimeout(() => setIsReconnecting(false), 500)
  }, [])

  const downloadLogs = () => {
    const model = editorRef?.current?.getModel()
    if (model) {
      const content = model.getValue()
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const podFileName = selectPodName || 'all-pods'
      a.download = `${podFileName}-${selectedContainers.join('-') || 'pod'}-logs.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const scrollToBottom = useCallback(() => {
    if (editorRef.current) {
      const model = editorRef.current.getModel()
      if (model) {
        editorRef.current.revealLine(model.getLineCount())
        setShowScrollToBottom(false)
      }
    }
  }, [])

  // Handle fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  const toggleWordWrap = useCallback(() => {
    setWordWrap((prev) => {
      localStorage.setItem('log-viewer-word-wrap', `${!prev}`)
      return !prev
    })
  }, [])

  const toggleShowLineNumbers = useCallback(() => {
    setShowLineNumbers((prev) => {
      localStorage.setItem('log-viewer-show-line-numbers', `${!prev}`)
      return !prev
    })
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F to open Monaco search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        editorRef.current?.getAction('actions.find')?.run()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        toggleFullscreen()
      }
      // Alt/Option + Z to toggle word wrap
      if (e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'Ω')) {
        e.preventDefault()
        toggleWordWrap()
      }
      // Font size shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        handleFontSizeChange(Math.min(24, fontSize + 1))
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        handleFontSizeChange(Math.max(10, fontSize - 1))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        handleFontSizeChange(14) // Reset to default font size
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    filterTerm,
    isFullscreen,
    toggleFullscreen,
    fontSize,
    handleFontSizeChange,
    toggleWordWrap,
  ])

  return (
    <Card
      className={`h-full flex flex-col py-4 gap-0 ${isFullscreen ? 'fixed inset-0 z-50 m-0 rounded-none' : ''} ${wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'} `}
    >
      <style>
        {generateAnsiCss()}
        {`
          .ansi-log-error { color: #f14c4c !important; font-weight: bold; }
          .ansi-log-warn { color: #f5f543 !important; }
          .ansi-log-info { color: #3b8eea !important; }
          .ansi-log-success { color: #23d18b !important; }
        `}
      </style>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Logs</CardTitle>
            <CardDescription>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  {logCount} lines {filterTerm.length > 0 && `(filtered)`}
                </span>
                <ConnectionIndicator
                  isConnected={isConnected}
                  onReconnect={refetch}
                />
                <NetworkSpeedIndicator
                  downloadSpeed={downloadSpeed}
                  uploadSpeed={0}
                />
                {isLoading && <span>Loading...</span>}
                {isReconnecting && (
                  <span className="text-blue-600">Reconnecting...</span>
                )}
              </div>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={'Filter logs...'}
                value={filterTerm}
                onChange={(e) => setFilterTerm(e.target.value)}
                className="pl-8 w-full pr-8"
              />
            </div>

            {/* Error Mode Toggle */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-rose-500/5 border-rose-500/20">
              <Label htmlFor="error-mode" className="text-[10px] font-bold text-rose-600 uppercase">Error Mode</Label>
              <Switch
                id="error-mode"
                checked={errorOnly}
                onCheckedChange={setErrorOnly}
                className="scale-75 data-[state=checked]:bg-rose-500"
              />
              {errorCount > 0 && (
                <Badge variant="destructive" className="h-4 px-1 text-[9px] animate-pulse">
                  {errorCount}
                </Badge>
              )}
            </div>

            {/* Multi-Container Selector */}
            {containers.length > 0 && (
              <MultiContainerSelector
                containers={containers}
                selectedContainers={selectedContainers}
                onContainersChange={setSelectedContainers}
              />
            )}

            {/* Pod Selector */}
            {pods && (
              <PodSelector
                pods={[...pods].sort((a, b) =>
                  (a.metadata?.creationTimestamp || 0) >
                    (b.metadata?.creationTimestamp || 0)
                    ? -1
                    : 1
                )}
                showAllOption={true}
                selectedPod={selectPodName}
                onPodChange={(v) => setSelectPodName(v || '_all')}
              />
            )}

            {/* Quick Theme Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={cycleTheme}
              title={`Current theme: ${TERMINAL_THEMES[logTheme].name}`}
              className="relative"
            >
              <IconPalette className="h-4 w-4" />
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-gray-400"
                style={{
                  backgroundColor: TERMINAL_THEMES[logTheme].background,
                }}
              ></div>
            </Button>

            {/* Settings */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <IconSettings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="tail-lines">Tail Lines</Label>
                    <Select
                      value={tailLines.toString()}
                      onValueChange={(value) =>
                        handleTailLinesChange(Number(value))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                        <SelectItem value="500">500</SelectItem>
                        <SelectItem value="1000">1000</SelectItem>
                        <SelectItem value="-1">All</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="timestamps">Show Timestamps</Label>
                    <Switch
                      id="timestamps"
                      checked={timestamps}
                      onCheckedChange={setTimestamps}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="previous">Previous Container</Label>
                    <Switch
                      id="previous"
                      checked={previous}
                      onCheckedChange={setPrevious}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="word-wrap">Word Wrap</Label>
                    <Switch
                      id="word-wrap"
                      checked={wordWrap}
                      onCheckedChange={toggleWordWrap}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="show-line-numbers">Show Line Numbers</Label>
                    <Switch
                      id="show-line-numbers"
                      checked={showLineNumbers}
                      onCheckedChange={toggleShowLineNumbers}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="follow-logs">Follow Logs</Label>
                    <Switch
                      id="follow-logs"
                      checked={followLogs}
                      onCheckedChange={setFollowLogs}
                    />
                  </div>

                  {/* Log Theme Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="log-theme">Log Theme</Label>
                      <Select
                        value={logTheme}
                        onValueChange={handleThemeChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TERMINAL_THEMES).map(
                            ([key, theme]) => (
                              <SelectItem key={key} value={key}>
                                <div className="flex items-center gap-2">
                                  {theme.name}
                                </div>
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Font Size Selector */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="font-size">Font Size</Label>
                      <Select
                        value={fontSize.toString()}
                        onValueChange={(value) =>
                          handleFontSizeChange(Number(value))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10px</SelectItem>
                          <SelectItem value="11">11px</SelectItem>
                          <SelectItem value="12">12px</SelectItem>
                          <SelectItem value="13">13px</SelectItem>
                          <SelectItem value="14">14px</SelectItem>
                          <SelectItem value="15">15px</SelectItem>
                          <SelectItem value="16">16px</SelectItem>
                          <SelectItem value="18">18px</SelectItem>
                          <SelectItem value="20">20px</SelectItem>
                          <SelectItem value="22">22px</SelectItem>
                          <SelectItem value="24">24px</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Keyboard Shortcuts */}
                  <div className="space-y-2 pt-2 border-t">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Keyboard Shortcuts
                    </Label>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Open Search</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+F
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Toggle Fullscreen</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+Enter
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Toggle Word Wrap</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Alt+Z
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Increase Font Size</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl++
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Decrease Font Size</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+-
                        </kbd>
                      </div>
                      <div className="flex justify-between">
                        <span>Reset Font Size</span>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-xs">
                          Ctrl+0
                        </kbd>
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Clear Logs */}
            <Button
              variant="outline"
              size="sm"
              onClick={clearLogs}
              title="Clear logs"
            >
              <IconClearAll className="h-4 w-4" />
            </Button>

            {/* Download */}
            <Button
              variant="outline"
              size="sm"
              onClick={downloadLogs}
              disabled={logCount === 0}
            >
              <IconDownload className="h-4 w-4" />
            </Button>

            {/* Fullscreen Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
              title={
                isFullscreen ? 'Exit fullscreen (ESC)' : 'Enter fullscreen'
              }
            >
              {isFullscreen ? (
                <IconMinimize className="h-4 w-4" />
              ) : (
                <IconMaximize className="h-4 w-4" />
              )}
            </Button>

            {/* Close */}
            {onClose && (
              <Button variant="outline" size="sm" onClick={onClose}>
                <IconX className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0 relative">
        <Editor
          height={isFullscreen ? 'calc(100dvh - 60px)' : 'calc(100dvh - 255px)'}
          theme={`log-theme-${logTheme}`}
          beforeMount={(monaco) => {
            // Define custom themes for each log theme
            Object.entries(TERMINAL_THEMES).forEach(([key, theme]) => {
              monaco.editor.defineTheme(`log-theme-${key}`, {
                base: key === 'github' ? 'vs' : 'vs-dark',
                inherit: true,
                rules: [
                  { token: '', foreground: theme.foreground.replace('#', '') },
                ],
                colors: {
                  'editor.background': theme.background,
                  'editor.foreground': theme.foreground,
                  'editorCursor.foreground': theme.cursor,
                  'editor.selectionBackground': theme.selection,
                  'editor.lineHighlightBackground': theme.selection,
                },
              })
            })
          }}
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: fontSize,
            wordWrap: wordWrap ? 'on' : 'off',
            lineHeight: 1.7,
            insertSpaces: true,
            fontFamily:
              "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
            lineNumbers: showLineNumbers ? 'on' : 'off',
            glyphMargin: false,
            folding: false,
            renderLineHighlight: 'gutter',
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
              useShadows: false,
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            automaticLayout: true,
            colorDecorators: false,
          }}
          loading={
            <div className="flex items-center justify-center h-full">
              <div className="text-center opacity-60">Loading editor...</div>
            </div>
          }
        />

        {/* Render Log Streamers for each selected container */}
        {selectPodName && selectPodName !== '_all' && selectedContainers.map(container => (
          <LogStreamer
            key={container}
            namespace={namespace}
            podName={selectPodName}
            container={container}
            options={commonLogsOptions}
            onStatusChange={handleStatusChange}
          />
        ))}

        {selectPodName === '_all' && labelSelector && (
          <LogStreamer
            namespace={namespace}
            podName="_all"
            container={selectedContainers[0] || ''}
            options={{ ...commonLogsOptions, labelSelector }}
            onStatusChange={handleStatusChange}
          />
        )}
        {showScrollToBottom && (
          <div
            className={`absolute bottom-4 right-4 shadow-lg z-10  ml-auto w-fit animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ${logTheme === 'github'
              ? 'bg-white/90 text-gray-600 border border-gray-200 shadow-sm'
              : 'bg-gray-800/90 text-gray-300 border border-gray-600 shadow-sm'
              } px-3 py-1.5 text-xs rounded-full backdrop-blur-sm`}
          >
            <Button
              size="sm"
              variant="ghost"
              className={`h-auto p-0 text-xs font-normal ${logTheme === 'github'
                ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-100/70'
                : 'text-gray-300 hover:text-white hover:bg-gray-700/70'
                }`}
              onClick={scrollToBottom}
            >
              ↓ {t('log.jumpToBottom', 'Jump to bottom')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
