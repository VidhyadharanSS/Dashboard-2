import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconActivity, IconAlertCircle, IconLoader, IconRefresh, IconCircleFilled } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { API_BASE_URL } from '@/lib/api-client'
import { withSubPath } from '@/lib/subpath'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'

type ConnState = 'connecting' | 'connected' | 'error' | 'closed'

function getLogColor(line: string): string {
    const l = line.toLowerCase()
    if (l.includes('error') || l.includes('fatal') || l.includes('panic')) return 'text-red-400'
    if (l.includes('warn')) return 'text-yellow-400'
    if (l.includes('info')) return 'text-blue-400'
    if (l.includes('debug')) return 'text-gray-400'
    return 'text-green-400'
}

export function LiveLogWidget() {
    const { t } = useTranslation()
    const [logs, setLogs] = useState<string[]>([])
    const [logType, setLogType] = useState<'application.log' | 'access.log'>('application.log')
    const [connState, setConnState] = useState<ConnState>('connecting')
    const [errorMsg, setErrorMsg] = useState('')
    const [retryCount, setRetryCount] = useState(0)
    const scrollRef = useRef<HTMLDivElement>(null)
    const esRef = useRef<EventSource | null>(null)
    const autoScrollRef = useRef(true)

    const connect = useCallback(() => {
        // Close any existing connection
        if (esRef.current) {
            esRef.current.close()
            esRef.current = null
        }

        setConnState('connecting')
        setErrorMsg('')

        const url = withSubPath(`${API_BASE_URL}/admin/system/logs/${logType}`)
        const es = new EventSource(url, { withCredentials: true })
        esRef.current = es

        // EventSource.onopen fires when the HTTP connection is established,
        // but the server might still be buffering. Mark as connected immediately
        // so the UI doesn't show "Connecting..." forever.
        es.onopen = () => {
            setConnState('connected')
        }

        es.onmessage = (event) => {
            // Also set connected on first message — handles cases where
            // onopen didn't fire (some proxy configurations strip SSE headers).
            setConnState('connected')
            setLogs((prev) => {
                const next = [...prev, event.data]
                // Keep last 200 lines in memory
                return next.length > 200 ? next.slice(next.length - 200) : next
            })
        }

        es.onerror = () => {
            // EventSource.onerror fires for both network errors AND when the server
            // closes the connection (status != 200). readyState tells us which:
            //   CONNECTING (0) → browser is auto-retrying
            //   CLOSED (2)     → permanent failure
            if (es.readyState === EventSource.CLOSED) {
                setConnState('error')
                setErrorMsg('Connection to log stream failed. The log file may not exist yet.')
                esRef.current = null
            } else {
                // readyState == CONNECTING: browser will auto-retry after ~3s
                setConnState('connecting')
            }
        }
    }, [logType])

    // Connect / reconnect when logType changes or manual retry triggered
    useEffect(() => {
        setLogs([])
        connect()
        return () => {
            esRef.current?.close()
            esRef.current = null
        }
    }, [connect, logType, retryCount])

    // Auto-scroll to bottom when new logs arrive (if user hasn't scrolled up)
    useEffect(() => {
        if (autoScrollRef.current && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [logs])

    const handleScroll = () => {
        if (!scrollRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
        // Consider "at bottom" if within 40px
        autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40
    }

    const handleRetry = () => {
        setLogs([])
        setRetryCount(c => c + 1)
    }

    const handleTabChange = (v: string) => {
        setLogs([])
        setLogType(v as typeof logType)
    }

    return (
        <Card className="flex flex-col h-[400px] shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-primary/10 rounded-md">
                        <IconActivity className="h-4 w-4 text-primary" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        {t('dashboard.liveSystemLogs', 'Live System Logs')}
                    </CardTitle>
                    {/* Connection indicator dot */}
                    <span className="flex items-center gap-1 text-[10px]">
                        {connState === 'connected' && (
                            <IconCircleFilled className="h-2 w-2 text-green-500" />
                        )}
                        {connState === 'connecting' && (
                            <IconLoader className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                        {connState === 'error' && (
                            <IconAlertCircle className="h-3 w-3 text-destructive" />
                        )}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Tabs value={logType} onValueChange={handleTabChange}>
                        <TabsList className="h-8">
                            <TabsTrigger value="application.log" className="text-[10px] h-7 px-2">App</TabsTrigger>
                            <TabsTrigger value="access.log" className="text-[10px] h-7 px-2">Access</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRetry} title="Reconnect">
                        <IconRefresh className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent
                className="flex-1 overflow-auto pt-2 pb-2 px-3 scrollbar-hide bg-black/95 m-2 rounded-md font-mono text-[11px]"
                ref={scrollRef}
                onScroll={handleScroll}
            >
                {connState === 'error' ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <IconAlertCircle className="h-6 w-6 text-destructive/60" />
                        <p className="text-muted-foreground text-center text-[11px] max-w-[220px]">{errorMsg}</p>
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleRetry}>
                            <IconRefresh className="h-3 w-3" />
                            Retry
                        </Button>
                    </div>
                ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50 gap-2">
                        {connState === 'connecting'
                            ? <><IconLoader className="h-4 w-4 animate-spin" /><p className="text-[11px]">{t('dashboard.connecting', 'Connecting...')}</p></>
                            : <p className="text-[11px]">{t('dashboard.waitingLogs', 'Waiting for logs...')}</p>
                        }
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {logs.map((log, i) => (
                            <div key={i} className={`whitespace-pre-wrap break-all leading-snug ${getLogColor(log)}`}>
                                {log}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
