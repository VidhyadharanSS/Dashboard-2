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
  IconTextWrap,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
  const [regexFilter, setRegexFilter] = useState(false)
  const [regexError, setRegexError] = useState<string | null>(null)
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
  const [logCount, setLogCount] = useState(0)
  const ansiStatesRef = useRef<Record<string, AnsiState>>({})
  const decorationIdsRef = useRef<string[]>([])

  const [rawLogs, setRawLogs] = useState<{ text: string; className: string }[]>([])
  const [followLogs, setFollowLogs] = useState(true)

  // Performance Optimization: Batching incoming logs
  const logBufferRef = useRef<{ log: string; container?: string }[]>([])
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const cleanLog = useCallback(() => {
    setRawLogs([])
    setLogCount(0)
    ansiStatesRef.current = {}
    logBufferRef.current = []
    if (editorRef.current) {
      const model = editorRef.current.getModel()
      if (model) model.setValue('')
    }
  }, [])

  const getLogLevelClass = (text: string): string => {
    const lowerText = text.toLowerCase()
    if (
      lowerText.includes('error') ||
      lowerText.includes('failed') ||
      lowerText.includes('stderr') ||
      lowerText.includes('exception')
    ) return 'ansi-log-error'
    if (lowerText.includes('warn')) return 'ansi-log-warn'
    if (lowerText.includes('info')) return 'ansi-log-info'
    if (
      lowerText.includes('success') ||
      lowerText.includes('ok') ||
      lowerText.includes('ready')
    ) return 'ansi-log-success'
    return ''
  }

  const flushLogs = useCallback(() => {
    if (logBufferRef.current.length === 0) return

    const processedLogs = logBufferRef.current.map(({ log, container }) => {
      const containerKey = container || 'default'
      if (!ansiStatesRef.current[containerKey]) {
        ansiStatesRef.current[containerKey] = {}
      }

      const { segments, finalState } = parseAnsi(log, ansiStatesRef.current[containerKey])
      ansiStatesRef.current[containerKey] = finalState

      const plainText = segments.map((s) => s.text).join('')
      const ansiClass = segments.map((s) => getAnsiClassNames(s.styles)).join(' ')

      const prefix = container && selectedContainers.length > 1 ? `[${container}] ` : ''
      const fullText = prefix + plainText
      const levelClass = getLogLevelClass(fullText)
      const logLevel = levelClass.replace('ansi-log-', '') as 'error' | 'warn' | 'info' | 'success' | ''

      return {
        text: fullText,
        className: `${ansiClass} ${levelClass} log-line`.trim(),
        level: logLevel,
        timestamp: new Date().getTime()
      }
    })

    setRawLogs((prev) => {
      const newLogs = [...prev, ...processedLogs]
      return newLogs.slice(-10000) // Keep max 10,000 lines
    })

    setLogCount((prev) => prev + processedLogs.length)

    // Clear buffer and timer
    logBufferRef.current = []
    flushTimeoutRef.current = null
  }, [selectedContainers.length])

  const appendLog = useCallback((log: string, container?: string) => {
    logBufferRef.current.push({ log, container })

    if (!flushTimeoutRef.current) {
      // Batch updates every 100ms to prevent UI freezing
      flushTimeoutRef.current = setTimeout(() => {
        flushLogs()
      }, 100)
    }
  }, [flushLogs])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current)
    }
  }, [])

  // Filtered logs for display
  const filtered = useMemo(() => {
    let result = rawLogs
    if (errorOnly) {
      result = result.filter((l) => l.className.includes('ansi-log-error'))
    }
    if (filterTerm) {
      if (regexFilter) {
        try {
          const regex = new RegExp(filterTerm, 'i')
          setRegexError(null)
          result = result.filter((l) => regex.test(l.text))
        } catch (e) {
          setRegexError(String(e))
          // Fall back to plain text
          result = result.filter((l) =>
            l.text.toLowerCase().includes(filterTerm.toLowerCase())
          )
        }
      } else {
        setRegexError(null)
        result = result.filter((l) =>
          l.text.toLowerCase().includes(filterTerm.toLowerCase())
        )
      }
    } else {
      setRegexError(null)
    }
    return result
  }, [rawLogs, errorOnly, filterTerm, regexFilter])

  // Log level statistics for the status bar
  const logStats = useMemo(() => {
    let errors = 0, warns = 0, infos = 0
    for (const l of rawLogs) {
      if (l.className.includes('ansi-log-error')) errors++
      else if (l.className.includes('ansi-log-warn')) warns++
      else if (l.className.includes('ansi-log-info')) infos++
    }
    return { errors, warns, infos }
  }, [rawLogs])

  const errorCount = logStats.errors

  const matchCount = useMemo(() => {
    if (!filterTerm.trim()) return 0
    let count = 0
    const escapedQuery = filterTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedQuery, 'gi')
    filtered.forEach(log => {
      const matches = log.text.match(regex)
      if (matches) count += matches.length
    })
    return count
  }, [filtered, filterTerm])

  const exportSelection = useCallback(() => {
    if (!editorRef.current) return
    const selection = editorRef.current.getSelection()
    const model = editorRef.current.getModel()
    if (selection && model) {
      const selectedText = model.getValueInRange(selection)
      if (selectedText) {
        const blob = new Blob([selectedText], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `selected-logs-${new Date().getTime()}.txt`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    }
  }, [])

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

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        toggleFullscreen()
      }
      if (e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'Ω')) {
        e.preventDefault()
        toggleWordWrap()
      }
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
        handleFontSizeChange(14)
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
    matchCount,
  ])

  return (
    <div
      className={`flex flex-col bg-background border border-border rounded-md overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[100] border-none rounded-none' : 'h-[calc(100dvh-180px)]'
        } ${wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre'}`}
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

      {/* Sleek Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-muted/30 border-b border-border">
        {/* Left Section */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Logs</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {logCount} lines
              {filterTerm.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px] bg-blue-500/10 text-blue-500 border-blue-500/20">
                  {matchCount} match{matchCount !== 1 ? 'es' : ''}
                </Badge>
              )}
            </span>
          </div>

          {/* Restored Connection & Loading Indicators */}
          <div className="flex items-center gap-2">
            <ConnectionIndicator
              isConnected={isConnected}
              onReconnect={refetch}
            />
            <NetworkSpeedIndicator
              downloadSpeed={downloadSpeed}
              uploadSpeed={0}
            />
            {isLoading && <span className="text-[10px] text-muted-foreground animate-pulse">Loading...</span>}
            {isReconnecting && <span className="text-[10px] text-blue-500 animate-pulse">Reconnecting...</span>}
          </div>

          <Button
            variant={timestamps ? "secondary" : "outline"}
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => setTimestamps(!timestamps)}
          >
            Time
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs gap-1.5"
            onClick={exportSelection}
            title="Export Selected Region"
          >
            <IconDownload size={14} />
            <span className="hidden sm:inline">Export Selection</span>
          </Button>

          {/* Inline Search */}
{/* Search / filter */}
          <div className="relative group flex items-center gap-1">
            <div className="relative flex items-center">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder={regexFilter ? "Regex filter..." : "Filter logs..."}
                value={filterTerm}
                onChange={(e) => setFilterTerm(e.target.value)}
                className={`h-8 w-[140px] lg:w-[220px] pl-8 pr-3 text-xs bg-background/50 focus-visible:ring-1 focus-visible:ring-primary shadow-sm ${regexError ? 'border-destructive ring-1 ring-destructive/30' : ''}`}
              />
            </div>
            <Button
              variant={regexFilter ? "default" : "outline"}
              size="sm"
              className="h-8 px-2 text-[10px] font-mono font-bold"
              onClick={() => setRegexFilter(r => !r)}
              title={regexFilter ? 'Regex mode ON — click to switch to plain text' : 'Plain text mode — click to enable regex'}
            >
              .*
            </Button>
            {regexError && (
              <span className="text-[9px] text-destructive max-w-[120px] truncate" title={regexError}>
                Bad regex
              </span>
            )}
          </div>          {/* Log Level Stats */}
          <div className="flex items-center gap-1.5 h-8">
            {logStats.errors > 0 && (
              <button
                onClick={() => { setErrorOnly(true) }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/10 text-red-600 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {logStats.errors} ERR
              </button>
            )}
            {logStats.warns > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-yellow-500/10 text-yellow-600 border border-yellow-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                {logStats.warns} WARN
              </span>
            )}
            {logStats.infos > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                {logStats.infos} INFO
              </span>
            )}
          </div>

          {/* Error Mode Toggle */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-md border bg-rose-500/5 border-rose-500/20 h-8">
            <Label htmlFor="error-mode" className="text-[10px] font-bold text-rose-600 uppercase cursor-pointer">Error Mode</Label>
            <Switch
              id="error-mode"
              checked={errorOnly}
              onCheckedChange={setErrorOnly}
              className="scale-75 data-[state=checked]:bg-rose-500"
            />
            {errorCount > 0 && (
              <Badge variant="destructive" className="h-4 px-1 min-w-[16px] flex items-center justify-center text-[9px] animate-pulse">
                {errorCount}
              </Badge>
            )}
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          {containers.length > 0 && (
            <MultiContainerSelector
              containers={containers}
              selectedContainers={selectedContainers}
              onContainersChange={setSelectedContainers}
            />
          )}

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

          <div className="w-px h-4 bg-border mx-1 hidden sm:block" />

          {/* Quick Actions */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 relative text-muted-foreground hover:text-foreground hidden sm:flex"
                  onClick={cycleTheme}
                >
                  <IconPalette className="h-4 w-4" />
                  <div
                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-border"
                    style={{ backgroundColor: TERMINAL_THEMES[logTheme].background }}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cycle Theme</TooltipContent>
            </Tooltip>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <IconSettings className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="tail-lines">Tail Lines</Label>
                    <Select value={tailLines.toString()} onValueChange={(v) => handleTailLinesChange(Number(v))}>
                      <SelectTrigger className="w-[120px] h-8 text-xs">
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
                    <Label htmlFor="timestamps-pop">Show Timestamps</Label>
                    <Switch id="timestamps-pop" checked={timestamps} onCheckedChange={setTimestamps} />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="previous-pop">Previous Container</Label>
                    <Switch id="previous-pop" checked={previous} onCheckedChange={setPrevious} />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="word-wrap-pop">Word Wrap</Label>
                    <Switch id="word-wrap-pop" checked={wordWrap} onCheckedChange={toggleWordWrap} />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="show-line-numbers">Show Line Numbers</Label>
                    <Switch id="show-line-numbers" checked={showLineNumbers} onCheckedChange={toggleShowLineNumbers} />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="follow-logs">Follow Logs</Label>
                    <Switch id="follow-logs" checked={followLogs} onCheckedChange={setFollowLogs} />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Log Theme</Label>
                      <Select value={logTheme} onValueChange={handleThemeChange}>
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TERMINAL_THEMES).map(([key, theme]) => (
                            <SelectItem key={key} value={key} className="text-xs">
                              {theme.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Font Size</Label>
                      <Select value={fontSize.toString()} onValueChange={(v) => handleFontSizeChange(Number(v))}>
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['10', '11', '12', '13', '14', '15', '16', '18', '20', '22', '24'].map(size => (
                            <SelectItem key={size} value={size} className="text-xs">{size}px</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t">
                    <Label className="text-xs font-bold uppercase text-muted-foreground">Shortcuts</Label>
                    <div className="space-y-1 text-[11px] text-muted-foreground font-mono">
                      <div className="flex justify-between"><span>Search</span><kbd>Ctrl+F</kbd></div>
                      <div className="flex justify-between"><span>Fullscreen</span><kbd>Ctrl+Enter</kbd></div>
                      <div className="flex justify-between"><span>Word Wrap</span><kbd>Alt+Z</kbd></div>
                      <div className="flex justify-between"><span>Zoom In/Out</span><kbd>Ctrl +/-</kbd></div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-8 w-8 text-muted-foreground hover:text-foreground ${wordWrap ? 'bg-primary/10 border-primary/30 text-primary' : ''}`}
                  onClick={toggleWordWrap}
                >
                  <IconTextWrap className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle Word Wrap</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={clearLogs}>
                  <IconClearAll className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear Logs</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={downloadLogs} disabled={logCount === 0}>
                  <IconDownload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download Logs</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hidden sm:flex" onClick={toggleFullscreen}>
                  {isFullscreen ? <IconMinimize className="h-4 w-4" /> : <IconMaximize className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</TooltipContent>
            </Tooltip>

            {onClose && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onClose}>
                    <IconX className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </div>

      {/* Editor Container */}
      <div className="flex-1 w-full h-full relative" style={{ backgroundColor: TERMINAL_THEMES[logTheme].background }}>
        <Editor
          height="100%"
          theme={`log-theme-${logTheme}`}
          beforeMount={(monaco) => {
            Object.entries(TERMINAL_THEMES).forEach(([key, theme]) => {
              monaco.editor.defineTheme(`log-theme-${key}`, {
                base: key === 'github' ? 'vs' : 'vs-dark',
                inherit: true,
                rules: [{ token: '', foreground: theme.foreground.replace('#', '') }],
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
            fontFamily: "'Maple Mono',Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
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
              <div className="text-center opacity-60 text-sm">Loading editor...</div>
            </div>
          }
        />

        {selectPodName && selectPodName !== '_all' && selectedContainers.map((container) => (
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
            className={`absolute bottom-6 right-6 shadow-lg z-10 w-fit animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ${logTheme === 'github'
                ? 'bg-white/90 text-gray-600 border border-gray-200'
                : 'bg-gray-800/90 text-gray-300 border border-gray-600'
              } px-3 py-1 text-xs rounded-full backdrop-blur-sm cursor-pointer hover:opacity-80 transition-opacity`}
            onClick={scrollToBottom}
          >
            ↓ {t('log.jumpToBottom', 'Jump to bottom')}
          </div>
        )}
      </div>
    </div>
  )
}