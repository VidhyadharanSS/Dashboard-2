import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal as XTerm } from '@xterm/xterm'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import '@xterm/xterm/css/xterm.css'
import {
  IconChevronDown,
  IconChevronUp,
  IconClearAll,
  IconCopy,
  IconDownload,
  IconMaximize,
  IconMinimize,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTerminal,
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
import { translateError } from '@/lib/utils'
import { TerminalTheme, TERMINAL_THEMES } from '@/types/themes'
import { Pod } from 'kubernetes-types/core/v1'

import { ConnectionIndicator } from './connection-indicator'

// --- Local Helper Functions ---

const getWebSocketUrl = (path: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

const toSimpleContainer = (initContainers: any[] = [], containers: any[] = []) => {
  // Main containers first so the first main container is auto-selected,
  // followed by init containers at the end.
  return [
    ...containers.map((c: any) => ({ ...c, isInit: false })),
    ...initContainers.map((c: any) => ({ ...c, isInit: true })),
  ]
}

// --- End Helpers ---

interface TerminalProps {
  namespace?: string
  podName?: string
  nodeName?: string
  pods?: Pod[]
  containers?: any[]
  initContainers?: any[]
  type?: 'pod' | 'node'
  /** If true, shows a confirmation dialog before connecting (for node terminals) */
  requireConfirmation?: boolean
  /** Permission gate message if user doesn't have access */
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

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Buffering for paste support
  const writeQueue = useRef<string[]>([])
  const isWriting = useRef(false)
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null)

  const { t } = useTranslation()

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term)
    if (searchAddonRef.current) {
      if (term) {
        searchAddonRef.current.findNext(term)
      } else {
        searchAddonRef.current.clearDecorations()
      }
    }
  }, [])

  const findNext = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      searchAddonRef.current.findNext(searchTerm)
    }
  }, [searchTerm])

  const findPrevious = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      searchAddonRef.current.findPrevious(searchTerm)
    }
  }, [searchTerm])

  // Initialize pod/container state on props change
  useEffect(() => {
    setSelectedPod(podName || pods?.[0]?.metadata?.name || '')
  }, [podName, pods])

  useEffect(() => {
    if (containers.length === 0) {
      setSelectedContainer('')
      return
    }

    setSelectedContainer((current) => {
      if (!current || !containers.find((c: any) => c.name === current)) {
        return containers[0].name
      }
      return current
    })
  }, [containers])

  // Handle theme change and persist to localStorage
  const handleThemeChange = useCallback((theme: TerminalTheme) => {
    setTerminalTheme(theme)
    localStorage.setItem('terminal-theme', theme)
    if (xtermRef.current) {
      const currentTheme = TERMINAL_THEMES[theme]
      xtermRef.current.options.theme = {
        background: currentTheme.background,
        foreground: currentTheme.foreground,
        cursor: currentTheme.cursor,
        selectionBackground: currentTheme.selection,
        black: currentTheme.black,
        red: currentTheme.red,
        green: currentTheme.green,
        yellow: currentTheme.yellow,
        blue: currentTheme.blue,
        magenta: currentTheme.magenta,
        cyan: currentTheme.cyan,
        white: currentTheme.white,
        brightBlack: currentTheme.brightBlack,
        brightRed: currentTheme.brightRed,
        brightGreen: currentTheme.brightGreen,
        brightYellow: currentTheme.brightYellow,
        brightBlue: currentTheme.brightBlue,
        brightMagenta: currentTheme.brightMagenta,
        brightCyan: currentTheme.brightCyan,
        brightWhite: currentTheme.brightWhite,
      }
      xtermRef.current.refresh(0, xtermRef.current.rows - 1)
    }
  }, [])

  // Handle font size change and persist to localStorage
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size)
    localStorage.setItem('log-viewer-font-size', size.toString())
    if (xtermRef.current && fitAddonRef.current) {
      xtermRef.current.options.fontSize = size
      setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit()
        }
      }, 100)
    }
  }, [])

  const handleCursorStyleChange = useCallback(
    (style: 'block' | 'underline' | 'bar') => {
      setCursorStyle(style)
      localStorage.setItem('terminal-cursor-style', style)
      if (xtermRef.current) {
        xtermRef.current.options.cursorStyle = style
      }
    },
    []
  )

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v)
    setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    }, 200)
  }, [])

  const handleContainerChange = useCallback((containerName?: string) => {
    if (containerName) setSelectedContainer(containerName)
  }, [])

  const handlePodChange = useCallback((podName?: string) => {
    setSelectedPod(podName || '')
  }, [])

  // Track connection duration
  useEffect(() => {
    if (isConnected) {
      setConnectionDuration(0)
      connectionTimerRef.current = setInterval(() => {
        setConnectionDuration(prev => prev + 1)
      }, 1000)
    } else {
      if (connectionTimerRef.current) {
        clearInterval(connectionTimerRef.current)
        connectionTimerRef.current = null
      }
    }
    return () => {
      if (connectionTimerRef.current) clearInterval(connectionTimerRef.current)
    }
  }, [isConnected])

  // Unified terminal and websocket lifecycle
  useEffect(() => {
    if (!confirmed) return
    if (type === 'pod') {
      if (!pods || pods.length === 0) if (!selectedPod) return
      if (!selectedContainer) return
    }
    if (type === 'node' && !nodeName) return
    if (!terminalRef.current) return

    if (xtermRef.current) xtermRef.current.dispose()
    if (wsRef.current) wsRef.current.close()

    // Clear write queue on new connection
    writeQueue.current = []
    isWriting.current = false

    const currentTheme = TERMINAL_THEMES[terminalTheme]
    const terminal = new XTerm({
      fontFamily: '"Maple Mono", Monaco, Menlo, "Ubuntu Mono", monospace',
      fontSize,
      theme: {
        background: currentTheme.background,
        foreground: currentTheme.foreground,
        cursor: currentTheme.cursor,
        selectionBackground: currentTheme.selection,
        black: currentTheme.black,
        red: currentTheme.red,
        green: currentTheme.green,
        yellow: currentTheme.yellow,
        blue: currentTheme.blue,
        magenta: currentTheme.magenta,
        cyan: currentTheme.cyan,
        white: currentTheme.white,
        brightBlack: currentTheme.brightBlack,
        brightRed: currentTheme.brightRed,
        brightGreen: currentTheme.brightGreen,
        brightYellow: currentTheme.brightYellow,
        brightBlue: currentTheme.brightBlue,
        brightMagenta: currentTheme.brightMagenta,
        brightCyan: currentTheme.brightCyan,
        brightWhite: currentTheme.brightWhite,
      },
      cursorBlink: true,
      allowTransparency: true,
      cursorStyle,
      scrollback: 10000,
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(terminalRef.current)
    fitAddon.fit()
    xtermRef.current = terminal
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    if (terminal.element) {
      terminal.element.style.overscrollBehavior = 'none'
      terminal.element.style.touchAction = 'none'
      terminal.element.addEventListener(
        'wheel',
        (e) => {
          e.stopPropagation()
          e.preventDefault()
        },
        { passive: false }
      )
    }

    const handleResize = () => fitAddon.fit()
    window.addEventListener('resize', handleResize)

    // WebSocket connection
    setIsConnected(false)
    const currentCluster = localStorage.getItem('current-cluster')
    const wsPath =
      type === 'pod'
        ? `/api/v1/terminal/${namespace}/${selectedPod}/ws?container=${selectedContainer}&x-cluster-name=${currentCluster}`
        : `/api/v1/node-terminal/${nodeName}/ws?x-cluster-name=${currentCluster}`
    const wsUrl = getWebSocketUrl(wsPath)
    const websocket = new WebSocket(wsUrl)
    wsRef.current = websocket

    websocket.onopen = () => {
      setIsConnected(true)

      if (fitAddonRef.current) {
        const { cols, rows } = fitAddonRef.current.proposeDimensions()!
        if (cols && rows) {
          const message = JSON.stringify({ type: 'resize', cols, rows })
          websocket.send(message)
        }
      }

      // Aggressive keepalive: send ping every 15s to keep the connection alive
      // through corporate proxies (which often have 30-60s idle timeouts).
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      pingTimerRef.current = setInterval(() => {
        if (websocket.readyState === WebSocket.OPEN) {
          const pingMessage = JSON.stringify({ type: 'ping' })
          websocket.send(pingMessage)
        }
      }, 15000)

      terminal.writeln(`\x1b[32mConnected to ${type} terminal!\x1b[0m\r\n`)
    }

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        switch (message.type) {
          case 'stdout':
          case 'stderr':
            terminal.write(message.data)
            break
          case 'info':
            terminal.writeln(`\x1b[34m${message.data}\x1b[0m`)
            break
          case 'connected':
            terminal.writeln(`\x1b[32m${message.data}\x1b[0m`)
            break
          case 'error':
            terminal.writeln(
              `\x1b[31mError: ${translateError(new Error(message.data), t)}\x1b[0m`
            )
            setIsConnected(false)
            break
          case 'pong':
            break
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error)
      terminal.writeln('\x1b[31mWebSocket connection error\x1b[0m')
      setIsConnected(false)
    }

    websocket.onclose = (event) => {
      setIsConnected(false)
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current)
        pingTimerRef.current = null
      }
      if (event.code !== 1000) {
        terminal.writeln('\x1b[31mConnection closed unexpectedly\x1b[0m')
      } else {
        terminal.writeln('\x1b[32mConnection closed\x1b[0m')
      }
    }

    // Process the write queue sequentially with a delay
    const processQueue = () => {
      if (
        isWriting.current ||
        writeQueue.current.length === 0 ||
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN
      ) {
        isWriting.current = false
        return
      }

      isWriting.current = true
      const chunk = writeQueue.current.shift()

      if (chunk) {
        const message = JSON.stringify({ type: 'stdin', data: chunk })
        wsRef.current.send(message)

        // Add 10ms delay between chunks to prevent overwhelming the pty/vi
        setTimeout(() => {
          isWriting.current = false // Allow next chunk
          processQueue()
        }, 10)
      } else {
        isWriting.current = false
      }
    }

    terminal.onData((data) => {
      if (websocket.readyState === WebSocket.OPEN) {
        // Chunk large inputs (paste) into smaller packets (e.g. 512 bytes)
        const CHUNK_SIZE = 512
        if (data.length > CHUNK_SIZE) {
          for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            writeQueue.current.push(data.slice(i, i + CHUNK_SIZE))
          }
        } else {
          writeQueue.current.push(data)
        }

        // Trigger queue processing if not already running
        if (!isWriting.current) {
          processQueue()
        }
      }
    })

    const handleTerminalResize = () => {
      if (fitAddonRef.current && websocket.readyState === WebSocket.OPEN) {
        fitAddonRef.current.fit()
        const { cols, rows } = terminal
        if (cols && rows) {
          const message = JSON.stringify({ type: 'resize', cols, rows })
          websocket.send(message)
        }
      }
    }

    let resizeObserver: ResizeObserver | null = null
    if (fitAddonRef.current && terminal.element) {
      resizeObserver = new ResizeObserver(handleTerminalResize)
      resizeObserver.observe(terminal.element)
    }

    const handleWheelEvent = (e: WheelEvent | TouchEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }

    const currentTerminalRef = terminalRef.current
    if (currentTerminalRef) {
      currentTerminalRef.addEventListener('wheel', handleWheelEvent, {
        passive: false,
      })
      currentTerminalRef.addEventListener('touchmove', handleWheelEvent, {
        passive: false,
      })
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      if (currentTerminalRef) {
        currentTerminalRef.removeEventListener('wheel', handleWheelEvent)
        currentTerminalRef.removeEventListener('touchmove', handleWheelEvent)
      }
      terminal.dispose()
      websocket.close()
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
    }
  }, [
    confirmed,
    selectedPod,
    selectedContainer,
    namespace,
    type,
    reconnectFlag,
    terminalTheme,
    fontSize,
    cursorStyle,
  ])

  // Format connection duration
  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // Clear terminal
  const clearTerminal = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear()
      toast.info('Terminal buffer cleared')
    }
  }, [])
>
  const copyToClipboard = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.selectAll()
      const selection = xtermRef.current.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
        toast.success('Terminal buffer copied to clipboard')
      } else {
        toast.error('Terminal buffer is empty')
      }
      xtermRef.current.clearSelection()
    }
  }, [])

  // Download the entire terminal buffer as a text file
  const downloadBuffer = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.selectAll()
      const selection = xtermRef.current.getSelection()
      xtermRef.current.clearSelection()
      if (!selection) {
        toast.error('Terminal buffer is empty')
        return
      }
      const blob = new Blob([selection], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const podOrNode = type === 'node' ? (nodeName || 'node') : (selectedPod || 'pod')
      a.download = `terminal-${podOrNode}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Terminal buffer downloaded')
    }
  }, [type, nodeName, selectedPod])
  // Permission denied gate
  if (permissionDeniedMessage) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-180px)] border rounded-md bg-muted/10">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <IconTerminal size={32} className="text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Access Denied</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md">{permissionDeniedMessage}</p>
      </div>
    )
  }

  // Confirmation gate for node terminals
  if (!confirmed) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-180px)] border rounded-md bg-muted/10">
        <div className="rounded-full bg-amber-500/10 p-4 mb-4">
          <IconTerminal size={32} className="text-amber-500" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Node Terminal Access</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-1">
          You are about to open a <strong>privileged terminal</strong> on node <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{nodeName}</code>.
        </p>
        <p className="text-xs text-muted-foreground text-center max-w-md mb-4">
          This creates a privileged pod with host access. The pod will be automatically cleaned up when the session ends.
          All commands are audited.
        </p>
        <div className="flex gap-3">
          <Button
            variant="default"
            onClick={() => setConfirmed(true)}
            className="gap-2"
          >
            <IconTerminal size={16} />
            Connect to Node
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col bg-background border border-border rounded-md overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[100] border-none rounded-none' : 'h-[calc(100dvh-180px)]'
        }`}
    >
      {/* Sleek Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-muted/30 border-b border-border">

        {/* Left Section */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <IconTerminal size={18} className="text-primary" />
            <span className="font-semibold text-sm">
              {type === 'node' ? 'Node Terminal' : 'Terminal'}
            </span>
            {isConnected && connectionDuration > 0 && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {formatDuration(connectionDuration)}
              </span>
            )}
          </div>

          <div className="w-px h-4 bg-border" />

          <ConnectionIndicator
            isConnected={isConnected}
            onReconnect={() => setReconnectFlag((f) => !f)}
          />

          {/* Inline Search */}
          <div className="relative group ml-2 flex items-center">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="h-8 w-[160px] lg:w-[220px] rounded-md border border-input bg-background/50 px-8 py-1 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              placeholder="Search terminal..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) findPrevious()
                  else findNext()
                }
              }}
            />
            {searchTerm && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={findPrevious}>
                  <IconChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={findNext}>
                  <IconChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
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

          <div className="w-px h-4 bg-border mx-1" />

          {/* Actions */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={clearTerminal}>
                  <IconClearAll size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear Buffer</TooltipContent>
            </Tooltip>
>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={copyToClipboard}>
                  <IconCopy size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy All</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={downloadBuffer}>
                  <IconDownload size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download Buffer</TooltipContent>
            </Tooltip>

            <DropdownMenu>              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <IconSettings size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Terminal Settings</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="p-3 space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Theme</Label>
                    <Select value={terminalTheme} onValueChange={handleThemeChange}>
                      <SelectTrigger className="h-8 text-xs">
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
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Font Size</Label>
                    <Select value={fontSize.toString()} onValueChange={(v) => handleFontSizeChange(Number(v))}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['10', '12', '14', '16', '18'].map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{s}px</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Cursor</Label>
                    <Select value={cursorStyle} onValueChange={handleCursorStyleChange}>
                      <SelectTrigger className="h-8 text-xs">
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
                    toast.info('Terminal reset requested')
                  }}
                >
                  <IconRefresh className="mr-2 h-3.5 w-3.5" />
                  Reset Connection
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={toggleFullscreen}>
                  {isFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Terminal Container */}
      <div
        className="flex-1 w-full h-full relative"
        style={{ backgroundColor: TERMINAL_THEMES[terminalTheme].background }}
      >
        <div
          ref={terminalRef}
          className="absolute inset-0 p-2 overflow-hidden outline-none"
          style={{ overscrollBehavior: 'none', touchAction: 'none' }}
        />
      </div>
    </div>
  )
}