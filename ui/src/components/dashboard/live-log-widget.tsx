import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  IconActivity,
  IconAlertCircle,
  IconLoader,
  IconRefresh,
  IconCircleFilled,
  IconPlayerPause,
  IconPlayerPlay,
  IconClearAll,
  IconDownload,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { API_BASE_URL } from '@/lib/api-client'
import { withSubPath } from '@/lib/subpath'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ConnState = 'connecting' | 'connected' | 'error' | 'closed'
type LogFile = 'application.log' | 'access.log'

function getLogColor(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('fatal') || l.includes('panic') || l.includes('critical'))
    return 'text-red-400'
  if (l.includes('warn')) return 'text-yellow-400'
  if (l.includes('info')) return 'text-sky-400'
  if (l.includes('debug') || l.includes('trace')) return 'text-gray-500'
  if (l.includes('success') || l.includes('ok') || l.includes('started') || l.includes('running'))
    return 'text-emerald-400'
  return 'text-gray-300'
}

function getLogLevelBadge(line: string): { label: string; className: string } | null {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('fatal') || l.includes('panic'))
    return { label: 'ERR', className: 'bg-red-500/20 text-red-400 border-red-500/30' }
  if (l.includes('warn'))
    return { label: 'WRN', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
  if (l.includes('info'))
    return { label: 'INF', className: 'bg-sky-500/20 text-sky-400 border-sky-500/30' }
  if (l.includes('debug'))
    return { label: 'DBG', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
  return null
}

export function LiveLogWidget() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<string[]>([])
  const [logFile, setLogFile] = useState<LogFile>('application.log')
  const [connState, setConnState] = useState<ConnState>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const [warnCount, setWarnCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const autoScrollRef = useRef(true)
  const isPausedRef = useRef(false)
  const pendingLogsRef = useRef<string[]>([])
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track whether we received at least one log line (distinguishes "empty file" from "no file")
  const hasReceivedDataRef = useRef(false)

  isPausedRef.current = isPaused

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    hasReceivedDataRef.current = false
    setConnState('connecting')
    setErrorMsg('')

    const url = withSubPath(`${API_BASE_URL}/admin/system/logs/${logFile}`)
    const es = new EventSource(url, { withCredentials: true })
    esRef.current = es

    // onopen fires once the server returns HTTP 200 and starts the SSE stream.
    // We can safely mark the connection as "connected" here — even if no log
    // lines have been emitted yet (e.g. empty file, slow server).
    es.onopen = () => {
      setConnState('connected')
    }

    es.onmessage = (event) => {
      // Also flip to connected when the very first message arrives, in case
      // onopen was suppressed by an HTTP proxy that buffers headers.
      if (!hasReceivedDataRef.current) {
        hasReceivedDataRef.current = true
        setConnState('connected')
      }

      const line: string = event.data
      const lower = line.toLowerCase()
      if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
        setErrorCount(c => c + 1)
      } else if (lower.includes('warn')) {
        setWarnCount(c => c + 1)
      }

      if (isPausedRef.current) {
        pendingLogsRef.current.push(line)
        setPendingCount(pendingLogsRef.current.length)
        return
      }

      setLogs((prev) => {
        const next = [...prev, line]
        return next.length > 500 ? next.slice(next.length - 500) : next
      })
    }

    es.onerror = () => {
      /**
       * onerror fires in two scenarios:
       *   CLOSED (2)     → permanent failure (non-200, network error, or CORS).
       *                    The browser does NOT auto-retry.
       *   CONNECTING (0) → server closed a valid stream; browser is auto-retrying.
       *
       * Only show the error state on permanent failures when we've never
       * received data — avoids false alarms from stream-end / log rotation.
       */
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
        if (hasReceivedDataRef.current) {
          // Clean close after receiving data — auto-reconnect (log rotation, restart)
          setConnState('closed')
          retryTimeoutRef.current = setTimeout(() => {
            setRetryCount(c => c + 1)
          }, 3000)
        } else {
          // Never received data — file may not exist yet or access denied
          setConnState('error')
          setErrorMsg(
            'Could not connect to log stream. The log file may not exist yet or access was denied.'
          )
        }
      } else {
        // CONNECTING — browser is auto-retrying after a clean server close
        setConnState('connecting')
      }
    }
  }, [logFile])

  useEffect(() => {
    setLogs([])
    setErrorCount(0)
    setWarnCount(0)
    setPendingCount(0)
    pendingLogsRef.current = []
    connect()
    return () => {
      esRef.current?.close()
      esRef.current = null
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
    }
  }, [connect, retryCount])

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current && !isPaused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, isPaused])

  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 60
  }

  const handleRetry = () => {
    setLogs([])
    setErrorCount(0)
    setWarnCount(0)
    setPendingCount(0)
    setRetryCount(c => c + 1)
  }

  const handlePauseResume = () => {
    setIsPaused(prev => {
      if (prev) {
        const pending = pendingLogsRef.current
        pendingLogsRef.current = []
        setPendingCount(0)
        setLogs(cur => {
          const next = [...cur, ...pending]
          return next.length > 500 ? next.slice(next.length - 500) : next
        })
      }
      return !prev
    })
  }

  const handleClear = () => {
    setLogs([])
    setErrorCount(0)
    setWarnCount(0)
    pendingLogsRef.current = []
    setPendingCount(0)
  }

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${logFile}-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const connIndicator = () => {
    if (connState === 'connected')
      return <IconCircleFilled className="h-2.5 w-2.5 text-emerald-500 animate-pulse" />
    if (connState === 'connecting' || connState === 'closed')
      return <IconLoader className="h-3 w-3 animate-spin text-yellow-400" />
    return <IconAlertCircle className="h-3 w-3 text-destructive" />
  }

  const connLabel = () => {
    if (connState === 'connected') return isPaused ? 'Paused' : 'Live'
    if (connState === 'connecting') return 'Connecting…'
    if (connState === 'closed') return 'Reconnecting…'
    return 'Error'
  }

  return (
    <Card className="flex flex-col h-[420px] shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <IconActivity className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-sm font-semibold tracking-tight">
            {t('dashboard.liveSystemLogs', 'Live System Logs')}
          </CardTitle>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
            {connIndicator()}
            {connLabel()}
          </span>
          {errorCount > 0 && (
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] font-bold bg-red-500/10 text-red-400 border-red-500/30"
            >
              {errorCount} ERR
            </Badge>
          )}
          {warnCount > 0 && (
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] font-bold bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
            >
              {warnCount} WRN
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Select
            value={logFile}
            onValueChange={(v) => {
              setLogFile(v as LogFile)
              setRetryCount(c => c + 1)
            }}
          >
            <SelectTrigger className="h-7 w-[130px] text-[11px] border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="application.log" className="text-xs">
                application.log
              </SelectItem>
              <SelectItem value="access.log" className="text-xs">
                access.log
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handlePauseResume}
            title={isPaused ? 'Resume' : 'Pause'}
          >
            {isPaused ? (
              <IconPlayerPlay className="h-3.5 w-3.5" />
            ) : (
              <IconPlayerPause className="h-3.5 w-3.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            title="Clear"
            disabled={logs.length === 0}
          >
            <IconClearAll className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleDownload}
            title="Download logs"
            disabled={logs.length === 0}
          >
            <IconDownload className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleRetry}
            title="Reconnect"
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent
        className="flex-1 overflow-auto pt-2 pb-2 px-3 bg-[#0d1117] m-2 rounded-md font-mono text-[11px] leading-snug min-h-0"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {connState === 'error' ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <IconAlertCircle className="h-7 w-7 text-destructive/60" />
            <p className="text-muted-foreground text-center text-[11px] max-w-[240px] leading-relaxed">
              {errorMsg}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleRetry}
            >
              <IconRefresh className="h-3 w-3" />
              Retry
            </Button>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 gap-2">
            {connState === 'connecting' ? (
              <>
                <IconLoader className="h-4 w-4 animate-spin" />
                <p className="text-[11px]">{t('dashboard.connecting', 'Connecting…')}</p>
                <p className="text-[10px] opacity-60">Waiting for the first log entry…</p>
              </>
            ) : (
              <p className="text-[11px]">{t('dashboard.waitingLogs', 'Waiting for logs…')}</p>
            )}
          </div>
        ) : (
          <div className="space-y-px">
            {logs.map((log, i) => {
              const level = getLogLevelBadge(log)
              return (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 whitespace-pre-wrap break-all leading-snug py-px group hover:bg-white/5 rounded-sm px-0.5 ${getLogColor(log)}`}
                >
                  {level && (
                    <span
                      className={`shrink-0 mt-[1px] text-[9px] font-bold px-1 py-px rounded border ${level.className}`}
                    >
                      {level.label}
                    </span>
                  )}
                  <span className="flex-1">{log}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* Paused indicator banner */}
      {isPaused && pendingCount > 0 && (
        <div
          className="mx-2 mb-1.5 px-3 py-1 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-[10px] text-yellow-400 font-medium flex items-center justify-between cursor-pointer"
          onClick={handlePauseResume}
        >
          <span>
            Paused — {pendingCount} new line{pendingCount !== 1 ? 's' : ''} buffered
          </span>
          <span className="underline">Resume</span>
        </div>
      )}
    </Card>
  )
}                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
