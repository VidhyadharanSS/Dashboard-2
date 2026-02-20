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
  IconMaximize,
  IconMinimize,
  IconPalette,
  IconSearch,
  IconSettings,
  IconTerminal,
} from '@tabler/icons-react'

import {
  ContainerSelector,
} from '@/components/selector/container-selector'
import { PodSelector } from '@/components/selector/pod-selector'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { NetworkSpeedIndicator } from './network-speed-indicator'

// --- Local Helper Functions ---

const getWebSocketUrl = (path: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

const toSimpleContainer = (initContainers: any[] = [], containers: any[] = []) => {
  return [
    ...initContainers.map((c: any) => ({ ...c, isInit: true })),
    ...containers.map((c: any) => ({ ...c, isInit: false })),
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
}

export function Terminal({
  namespace,
  podName,
  nodeName,
  pods,
  containers: _containers = [],
  initContainers = [],
  type = 'pod',
}: TerminalProps) {
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])

  const [selectedPod, setSelectedPod] = useState<string>('')
  const [selectedContainer, setSelectedContainer] = useState<string>('')
  const [isConnected, setIsConnected] = useState(false)
  const [reconnectFlag, setReconnectFlag] = useState(false)
  const [networkSpeed, setNetworkSpeed] = useState({ upload: 0, download: 0 })
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

  const networkStatsRef = useRef({
    lastReset: Date.now(),
    bytesReceived: 0,
    bytesSent: 0,
    lastUpdate: Date.now(),
  })
  const speedUpdateTimerRef = useRef<NodeJS.Timeout | null>(null)
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

  const cycleTheme = useCallback(() => {
    const themes = Object.keys(TERMINAL_THEMES) as TerminalTheme[]
    const currentIndex = themes.indexOf(terminalTheme)
    const nextIndex = (currentIndex + 1) % themes.length
    handleThemeChange(themes[nextIndex])
  }, [terminalTheme, handleThemeChange])

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

  const updateNetworkStats = useCallback(
    (dataSize: number, isOutgoing: boolean) => {
      const stats = networkStatsRef.current

      if (isOutgoing) {
        stats.bytesSent += dataSize
      } else {
        stats.bytesReceived += dataSize
      }
    },
    []
  )

  // Unified terminal and websocket lifecycle
  useEffect(() => {
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
      networkStatsRef.current = {
        lastReset: Date.now(),
        bytesReceived: 0,
        bytesSent: 0,
        lastUpdate: Date.now(),
      }
      setNetworkSpeed({ upload: 0, download: 0 })
      if (speedUpdateTimerRef.current)
        clearInterval(speedUpdateTimerRef.current)
      if (fitAddonRef.current) {
        const { cols, rows } = fitAddonRef.current.proposeDimensions()!
        if (cols && rows) {
          const message = JSON.stringify({ type: 'resize', cols, rows })
          websocket.send(message)
          updateNetworkStats(new Blob([message]).size, true)
        }
      }
      speedUpdateTimerRef.current = setInterval(() => {
        const now = Date.now()
        const stats = networkStatsRef.current
        const timeDiff = (now - stats.lastReset) / 1000
        if (timeDiff > 0) {
          setNetworkSpeed({
            upload: stats.bytesSent / timeDiff,
            download: stats.bytesReceived / timeDiff,
          })
          if (timeDiff >= 3) {
            stats.lastReset = now
            stats.bytesSent = 0
            stats.bytesReceived = 0
          }
        }
      }, 500)

      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      pingTimerRef.current = setInterval(() => {
        if (websocket.readyState === WebSocket.OPEN) {
          const pingMessage = JSON.stringify({ type: 'ping' })
          websocket.send(pingMessage)
          updateNetworkStats(new Blob([pingMessage]).size, true)
        }
      }, 30000)

      terminal.writeln(`\x1b[32mConnected to ${type} terminal!\x1b[0m`)
      terminal.writeln('')
    }

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        const dataSize = new Blob([event.data]).size
        updateNetworkStats(dataSize, false)
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
      setNetworkSpeed({ upload: 0, download: 0 })
      if (speedUpdateTimerRef.current) {
        clearInterval(speedUpdateTimerRef.current)
        speedUpdateTimerRef.current = null
      }
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
        updateNetworkStats(new Blob([message]).size, true)

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
        const { cols, rows } = terminal
        const message = JSON.stringify({ type: 'resize', cols, rows })
        websocket.send(message)
        updateNetworkStats(new Blob([message]).size, true)
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
      if (speedUpdateTimerRef.current)
        clearInterval(speedUpdateTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
    }
  }, [
    selectedPod,
    selectedContainer,
    namespace,
    type,
    updateNetworkStats,
    reconnectFlag,
  ])

  // Clear terminal
  const clearTerminal = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear()
      toast.info('Terminal buffer cleared')
    }
  }, [])

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

  return (
    <Card
      className={`flex flex-col gap-0 py-2 ${isFullscreen ? 'fixed inset-0 z-50 h-[100dvh]' : 'h-[calc(100dvh-180px)]'}`}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <IconTerminal className="h-5 w-5" />
              Terminal
            </CardTitle>
            <ConnectionIndicator
              isConnected={isConnected}
              onReconnect={() => {
                setReconnectFlag((prev) => !prev)
              }}
            />
            <NetworkSpeedIndicator
              uploadSpeed={networkSpeed.upload}
              downloadSpeed={networkSpeed.download}
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="flex items-center bg-muted rounded-md px-2 gap-1 border">
              <IconSearch className="h-4 w-4 text-muted-foreground" />
              <input
                className="bg-transparent border-none outline-none text-sm w-32 md:w-48 py-1"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.shiftKey) findPrevious()
                    else findNext()
                  }
                }}
              />
              <div className="flex items-center gap-0.5 border-l pl-1 ml-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={findPrevious}
                >
                  <IconChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={findNext}
                >
                  <IconChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Container Selector */}
            {containers.length > 1 && (
              <ContainerSelector
                containers={containers}
                showAllOption={false}
                selectedContainer={selectedContainer}
                onContainerChange={handleContainerChange}
              />
            )}

            {/* Pod Selector */}
            {pods && pods.length > 0 && (
              <PodSelector
                pods={pods}
                selectedPod={selectedPod}
                onPodChange={handlePodChange}
              />
            )}

            {/* Quick Theme Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={cycleTheme}
              title={`Current theme: ${TERMINAL_THEMES[terminalTheme].name} (Ctrl+T to cycle)`}
              className="relative"
            >
              <IconPalette className="h-4 w-4" />
              <div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-gray-400"
                style={{
                  backgroundColor: TERMINAL_THEMES[terminalTheme].background,
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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="terminal-theme">Terminal Theme</Label>
                      <Select
                        value={terminalTheme}
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
                                  <div
                                    className="w-3 h-3 rounded-full border border-gray-400"
                                    style={{
                                      backgroundColor: theme.background,
                                    }}
                                  ></div>
                                  <span className="text-sm">{theme.name}</span>
                                </div>
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div
                      className="p-3 rounded space-y-1"
                      style={{
                        backgroundColor:
                          TERMINAL_THEMES[terminalTheme].background,
                        color: TERMINAL_THEMES[terminalTheme].foreground,
                        fontSize: `${fontSize}px`,
                      }}
                    >
                      <div>
                        <span
                          style={{
                            color: TERMINAL_THEMES[terminalTheme].green,
                          }}
                        >
                          user@pod:~$
                        </span>{' '}
                        ls -la
                      </div>
                      <div
                        style={{ color: TERMINAL_THEMES[terminalTheme].blue }}
                      >
                        drwxr-xr-x 3 user user 4096 Dec 9 10:30 .
                      </div>
                      <div
                        style={{ color: TERMINAL_THEMES[terminalTheme].yellow }}
                      >
                        -rw-r--r-- 1 user user 220 Dec 9 10:30 README.md
                      </div>
                      <div
                        style={{ color: TERMINAL_THEMES[terminalTheme].red }}
                      >
                        -rwx------ 1 user user 1024 Dec 9 10:30 script.sh
                      </div>
                    </div>
                  </div>

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

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cursor-style">Cursor Style</Label>
                      <Select
                        value={cursorStyle}
                        onValueChange={handleCursorStyleChange}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="block">Block</SelectItem>
                          <SelectItem value="underline">Underline</SelectItem>
                          <SelectItem value="bar">Bar</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={clearTerminal}>
                    <IconClearAll className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear Terminal</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={copyToClipboard}>
                    <IconCopy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy All</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button variant="outline" size="sm" onClick={toggleFullscreen}>
              {isFullscreen ? (
                <IconMinimize className="h-4 w-4" />
              ) : (
                <IconMaximize className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex h-full min-h-0">
        <div
          ref={terminalRef}
          className="flex-1 h-full min-h-0"
          style={{
            maxHeight: '100%',
            overflow: 'hidden',
            overscrollBehavior: 'none',
            touchAction: 'none',
            position: 'relative',
            isolation: 'isolate',
          }}
        />
      </CardContent>
    </Card>
  )
}