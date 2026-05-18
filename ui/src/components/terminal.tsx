import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal as XTerm } from '@xterm/xterm'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import '@xterm/xterm/css/xterm.css'
import {
  IconChevronDown,
  IconChevronUp,
  IconClearAll,
  IconCopy,
  IconDownload,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTerminal,
  IconX,
} from '@tabler/icons-react'

import { ContainerSelector } from '@/components/selector/container-selector'
import { PodSelector } from '@/components/selector/pod-selector'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TerminalTheme, TERMINAL_THEMES } from '@/types/themes'
import { Pod } from 'kubernetes-types/core/v1'

import { ConnectionIndicator } from './connection-indicator'

import { getWebSocketUrl } from '@/lib/subpath'

const toSimpleContainer = (initContainers: any[] = [], containers: any[] = []) => {
  return [
    ...containers.map((c: any) => ({ ...c, isInit: false })),
    ...initContainers.map((c: any) => ({ ...c, isInit: true })),
  ]
}

interface TerminalProps {
  namespace?: string
  podName?: string
  nodeName?: string
  pods?: Pod[]
  containers?: any[]
  initContainers?: any[]
  type?: 'pod' | 'node'
  requireConfirmation?: boolean
  permissionDeniedMessage?: string
}

export function Terminal({
  namespace,
  podName,
  nodeName,
  pods,
  containers: _containers = [],
  initContainers = [],
  type = 'pod',
  requireConfirmation = false,
  permissionDeniedMessage,
}: TerminalProps) {
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])

  const [selectedPod, setSelectedPod] = useState<string>('')
  const [selectedContainer, setSelectedContainer] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectFlag, setReconnectFlag] = useState(false)
  const [confirmed, setConfirmed] = useState(!requireConfirmation)
  const [connectionDuration, setConnectionDuration] = useState(0)
  const connectionTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [terminalTheme, setTerminalTheme] = useState<TerminalTheme>(() => {
    const saved = localStorage.getItem('terminal-theme')
    return (saved as TerminalTheme) || 'classic'
  })

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('log-viewer-font-size')
    return saved ? parseInt(saved, 10) : 14
  })

  const [cursorStyle, setCursorStyle] = useState<'block' | 'underline' | 'bar'>(
    () => {
      const saved = localStorage.getItem('terminal-cursor-style')
      return (saved as 'block' | 'underline' | 'bar') || 'bar'
    }
  )

  const [searchTerm, setSearchTerm] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchMatchCount, setSearchMatchCount] = useState(0)
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(0)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const pingTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Refs to read settings inside effects without re-triggering WebSocket reconnect
  const terminalThemeRef = useRef(terminalTheme)
  terminalThemeRef.current = terminalTheme
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const cursorStyleRef = useRef(cursorStyle)
  cursorStyleRef.current = cursorStyle


  const countSearchMatches = useCallback((term: string) => {
    if (!term || !xtermRef.current) {
      setSearchMatchCount(0)
      setSearchCurrentIndex(0)
      return
    }
    const buffer = xtermRef.current.buffer.active
    let count = 0
    const lowerTerm = term.toLowerCase()
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      if (line) {
        const text = line.translateToString().toLowerCase()
        let idx = 0
        while ((idx = text.indexOf(lowerTerm, idx)) !== -1) {
          count++
          idx += lowerTerm.length
        }
      }
    }
    setSearchMatchCount(count)
  }, [])

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term)
    if (searchAddonRef.current) {
      if (term) {
        searchAddonRef.current.findNext(term, { decorations: { activeMatchColorOverviewRuler: '#facc15', matchOverviewRuler: '#facc1560' } })
        countSearchMatches(term)
        setSearchCurrentIndex(1)
      } else {
        searchAddonRef.current.clearDecorations()
        setSearchMatchCount(0)
        setSearchCurrentIndex(0)
      }
    }
  }, [countSearchMatches])

  const findNext = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      searchAddonRef.current.findNext(searchTerm, { decorations: { activeMatchColorOverviewRuler: '#facc15', matchOverviewRuler: '#facc1560' } })
      setSearchCurrentIndex(prev => (prev < searchMatchCount ? prev + 1 : 1))
    }
  }, [searchTerm, searchMatchCount])

  const findPrevious = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      searchAddonRef.current.findPrevious(searchTerm, { decorations: { activeMatchColorOverviewRuler: '#facc15', matchOverviewRuler: '#facc1560' } })
      setSearchCurrentIndex(prev => (prev > 1 ? prev - 1 : searchMatchCount))
    }
  }, [searchTerm, searchMatchCount])

  // Auto-select first pod
  useEffect(() => {
    if (!selectedPod && pods && pods.length > 0) {
      setSelectedPod(pods[0]?.metadata?.name || '')
    }
  }, [pods, selectedPod])

  // Auto-select first container
  useEffect(() => {
    if (containers.length > 0 && !selectedContainer) {
      setSelectedContainer(containers[0]?.name || '')
    }
  }, [containers, selectedContainer])

  const handlePodChange = useCallback((pod: string | undefined) => {
    setSelectedPod(pod || '')
    setSelectedContainer('')
  }, [])

  const handleContainerChange = useCallback((container: string | undefined) => {
    setSelectedContainer(container || '')
  }, [])

  const handleThemeChange = useCallback((theme: string) => {
    setTerminalTheme(theme as TerminalTheme)
    localStorage.setItem('terminal-theme', theme)
    if (xtermRef.current) {
      xtermRef.current.options.theme = TERMINAL_THEMES[theme as TerminalTheme]
    }
  }, [])

  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size)
    localStorage.setItem('log-viewer-font-size', size.toString())
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = size
      fitAddonRef.current?.fit()
    }
  }, [])

  const handleCursorStyleChange = useCallback((style: string) => {
    const s = style as 'block' | 'underline' | 'bar'
    setCursorStyle(s)
    localStorage.setItem('terminal-cursor-style', s)
    if (xtermRef.current) {
      xtermRef.current.options.cursorStyle = s
    }
  }, [])

  const clearTerminal = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear()
    }
  }, [])

  const copyToClipboard = useCallback(async () => {
    if (!xtermRef.current) return
    const selection = xtermRef.current.getSelection()
    // If there's a selection, copy that; otherwise copy the entire buffer
    let text = selection
    if (!text) {
      const buffer = xtermRef.current.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (line) lines.push(line.translateToString())
      }
      text = lines.join('\n').trimEnd()
    }
    if (!text) {
      toast.info('Nothing to copy')
      return
    }
    try {
      // Primary: Clipboard API (requires secure context / user gesture)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback: execCommand for non-secure contexts
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        textarea.style.top = '-9999px'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        const success = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (!success) throw new Error('execCommand copy failed')
      }
      toast.success(selection ? 'Selection copied to clipboard' : 'Buffer copied to clipboard')
    } catch {
      toast.error('Failed to copy — try selecting text and using Ctrl+C')
    }
  }, [])

  const downloadBuffer = useCallback(() => {
    if (!xtermRef.current) return
    const buffer = xtermRef.current.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      if (line) lines.push(line.translateToString())
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terminal-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Buffer downloaded')
  }, [])

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  /**
   * Safe fit: uses getBoundingClientRect for reliable measurement.
   */
  const safeFit = useCallback(() => {
    const xterm = xtermRef.current
    const fitAddon = fitAddonRef.current
    const container = terminalRef.current
    if (!xterm || !fitAddon || !container) return

    try {
      // First try FitAddon normally
      const proposed = fitAddon.proposeDimensions()
      if (proposed && proposed.rows > 3 && proposed.cols > 2) {
        fitAddon.fit()
        return
      }

      // Fallback: manually calculate from getBoundingClientRect
      const rect = container.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return

      const core = (xterm as any)._core
      if (!core?._renderService?.dimensions?.css?.cell) return
      const cellWidth = core._renderService.dimensions.css.cell.width
      const cellHeight = core._renderService.dimensions.css.cell.height
      if (cellWidth < 1 || cellHeight < 1) return

      const cols = Math.max(2, Math.floor(rect.width / cellWidth))
      const rows = Math.max(1, Math.floor(rect.height / cellHeight))
      xterm.resize(cols, rows)
    } catch {
      // Silently ignore fit errors
    }
  }, [])

  // Main terminal + WebSocket effect
  useEffect(() => {
    if (!terminalRef.current) return
    if (type === 'node' && !confirmed) return
    if (type === 'pod' && !selectedPod && !podName) return
    if (type === 'pod' && !selectedContainer && containers.length === 0) return

    const terminalThemeConfig = TERMINAL_THEMES[terminalThemeRef.current]

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: cursorStyleRef.current,
      fontFamily: "'Maple Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.3,
      letterSpacing: 0.5,
      theme: terminalThemeConfig,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()

    xterm.loadAddon(fitAddon)
    xterm.loadAddon(searchAddon)
    xterm.loadAddon(webLinksAddon)

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    xterm.open(terminalRef.current)

    // Apply inline styles for xterm element
    const xtermEl = terminalRef.current.querySelector('.xterm') as HTMLElement
    if (xtermEl) {
      xtermEl.style.position = 'absolute'
      xtermEl.style.inset = '0'
      xtermEl.style.width = '100%'
      xtermEl.style.height = '100%'
      xtermEl.style.overflow = 'hidden'
    }

    // Staggered fit attempts
    requestAnimationFrame(() => {
      requestAnimationFrame(() => safeFit())
    })
    const t1 = setTimeout(() => safeFit(), 100)
    const t2 = setTimeout(() => safeFit(), 300)
    const t3 = setTimeout(() => safeFit(), 600)

    // ResizeObserver for responsive fit
    const resizeObserver = new ResizeObserver(() => {
      safeFit()
    })
    resizeObserver.observe(terminalRef.current)

    // Build WebSocket URL
    const currentCluster = localStorage.getItem('current-cluster')
    let wsUrl = ''
    if (type === 'node') {
      wsUrl = getWebSocketUrl(`/api/v1/node-terminal/${encodeURIComponent(nodeName || '')}/ws?x-cluster-name=${currentCluster || ''}`)
    } else {
      const pod = selectedPod || podName || ''
      const container = selectedContainer || containers[0]?.name || ''
      const ns = namespace || ''
      wsUrl = getWebSocketUrl(
        `/api/v1/terminal/${encodeURIComponent(ns)}/${encodeURIComponent(pod)}/ws?container=${encodeURIComponent(container)}&x-cluster-name=${currentCluster || ''}`
      )
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setConnectionDuration(0)
      connectionTimerRef.current = setInterval(() => {
        setConnectionDuration((prev) => prev + 1)
      }, 1000)

      // Send initial resize
      safeFit()
      if (xterm.cols && xterm.rows) {
        try {
          ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }))
        } catch { /* noop */ }
      }

      // Start ping keepalive (20s to survive proxy idle timeouts)
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping' })) } catch { /* noop */ }
        }
      }, 20000)

      xterm.focus()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'stdout':
          case 'stderr':
            xterm.write(msg.data)
            break
          case 'info':
            xterm.writeln(`\x1b[34m${msg.data}\x1b[0m`)
            break
          case 'connected':
            xterm.writeln(`\x1b[32m${msg.data}\x1b[0m`)
            break
          case 'error':
            xterm.writeln(`\r\n\x1b[1;31mError: ${msg.data || 'Connection error'}\x1b[0m`)
            setIsConnected(false)
            break
          case 'ping':
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }))
            }
            break
          case 'pong':
            break
        }
      } catch {
        // If not JSON, write raw
        xterm.write(event.data)
      }
    }

    ws.onclose = (event) => {
      setIsConnected(false)
      if (connectionTimerRef.current) clearInterval(connectionTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      if (event.code !== 1000) {
        xterm.writeln('\r\n\x1b[31mConnection closed unexpectedly\x1b[0m')
      } else {
        xterm.writeln('\r\n\x1b[32mConnection closed\x1b[0m')
      }
    }

    ws.onerror = () => {
      xterm.writeln('\r\n\x1b[31mWebSocket connection error\x1b[0m')
      setIsConnected(false)
    }

    // Send input to server with chunked paste support
    const writeQueue: string[] = []
    let isWriting = false

    const processQueue = () => {
      if (isWriting || writeQueue.length === 0 || ws.readyState !== WebSocket.OPEN) {
        isWriting = false
        return
      }
      isWriting = true
      const chunk = writeQueue.shift()
      if (chunk) {
        try {
          ws.send(JSON.stringify({ type: 'stdin', data: chunk }))
        } catch { /* noop */ }
        setTimeout(() => {
          isWriting = false
          processQueue()
        }, 10)
      } else {
        isWriting = false
      }
    }

    const inputDisposable = xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const CHUNK_SIZE = 512
        if (data.length > CHUNK_SIZE) {
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            writeQueue.push(data.slice(i, i + CHUNK_SIZE))
          }
        } else {
          writeQueue.push(data)
        }
        if (!isWriting) processQueue()
      }
    })

    // Send resize events
    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        } catch { /* noop */ }
      }
    })

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      if (connectionTimerRef.current) clearInterval(connectionTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      ws.close()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      wsRef.current = null
    }
  }, [
    type,
    namespace,
    podName,
    selectedPod,
    selectedContainer,
    nodeName,
    confirmed,
    reconnectFlag,
    safeFit,
  ])

  if (permissionDeniedMessage) {
    return (
      <div className="flex items-center justify-center h-64 border border-dashed rounded-lg">
        <p className="text-sm text-muted-foreground">{permissionDeniedMessage}</p>
      </div>
    )
  }

  if (requireConfirmation && !confirmed) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 border border-dashed rounded-lg">
        <IconTerminal size={32} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center max-w-md">
          This will open a terminal session on the node. Make sure you understand the security implications.
        </p>
        <Button onClick={() => setConfirmed(true)}>Open Terminal</Button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col bg-background border border-border rounded-lg overflow-hidden h-[calc(100dvh-180px)]"
      onMouseDown={() => {
        if (xtermRef.current) xtermRef.current.focus()
      }}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-muted/30 border-b border-border">
        {/* Left */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <IconTerminal size={16} className="text-primary" />
            <span className="font-semibold text-xs">
              {type === 'node' ? 'Node Terminal' : 'Terminal'}
            </span>
            {isConnected && connectionDuration > 0 && (
              <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                {formatDuration(connectionDuration)}
              </span>
            )}
          </div>

          <ConnectionIndicator
            isConnected={isConnected}
            onReconnect={() => setReconnectFlag((f) => !f)}
          />
        </div>

        {/* Right */}
        <div className="flex items-center gap-1.5">
          {pods && pods.length > 0 && (
            <PodSelector
              pods={pods}
              selectedPod={selectedPod}
              onPodChange={handlePodChange}
            />
          )}

          {containers.length > 0 && (
            <ContainerSelector
              containers={containers}
              selectedContainer={selectedContainer}
              onContainerChange={handleContainerChange}
            />
          )}

          <div className="w-px h-4 bg-border" />

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowSearch(s => !s)}
                >
                  <IconSearch size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Search</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={clearTerminal}>
                  <IconClearAll size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={copyToClipboard}>
                  <IconCopy size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Copy</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={downloadBuffer}>
                  <IconDownload size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Download</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                  <IconSettings size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs">Settings</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="p-2 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Theme</Label>
                    <Select value={terminalTheme} onValueChange={handleThemeChange}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TERMINAL_THEMES).map(([key, theme]) => (
                          <SelectItem key={key} value={key} className="text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.background }} />
                              {theme.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Font Size</Label>
                    <Select value={fontSize.toString()} onValueChange={(v) => handleFontSizeChange(Number(v))}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['10', '12', '14', '16', '18'].map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{s}px</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Cursor</Label>
                    <Select value={cursorStyle} onValueChange={handleCursorStyleChange}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="block" className="text-xs">Block</SelectItem>
                        <SelectItem value="underline" className="text-xs">Underline</SelectItem>
                        <SelectItem value="bar" className="text-xs">Bar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  className="text-xs cursor-pointer"
                  onClick={() => {
                    setReconnectFlag((f) => !f)
                    toast.info('Terminal reconnecting...')
                  }}
                >
                  <IconRefresh className="mr-2 h-3.5 w-3.5" />
                  Reconnect
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipProvider>
        </div>
      </div>

      {/* Inline Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20">
          <IconSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            className="flex-1 h-6 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search in terminal..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) findPrevious()
                else findNext()
              }
              if (e.key === 'Escape') {
                setShowSearch(false)
                setSearchTerm('')
                setSearchMatchCount(0)
                setSearchCurrentIndex(0)
                searchAddonRef.current?.clearDecorations()
              }
            }}
          />
          {searchTerm && (
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums whitespace-nowrap shrink-0">
              {searchMatchCount > 0 ? `${searchCurrentIndex} of ${searchMatchCount}` : 'No results'}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={findPrevious} disabled={searchMatchCount === 0}>
            <IconChevronUp className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={findNext} disabled={searchMatchCount === 0}>
            <IconChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setShowSearch(false)
              setSearchTerm('')
              setSearchMatchCount(0)
              setSearchCurrentIndex(0)
              searchAddonRef.current?.clearDecorations()
            }}
          >
            <IconX className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Terminal Area */}
      <div
        className="flex-1 min-h-0 w-full relative"
        style={{ backgroundColor: TERMINAL_THEMES[terminalTheme].background }}
      >
        <div
          ref={terminalRef}
          data-terminal-container
          className="absolute inset-0 outline-none"
          style={{ overscrollBehavior: 'none', touchAction: 'none' }}
        />
      </div>
    </div>
  )
}

