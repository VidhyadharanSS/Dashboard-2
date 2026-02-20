import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconActivity, IconSettings } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { API_BASE_URL } from '@/lib/api-client'
import { withSubPath } from '@/lib/subpath'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function LiveLogWidget() {
    const { t } = useTranslation()
    const [logs, setLogs] = useState<string[]>([])
    const [logType, setLogType] = useState<'application.log' | 'access.log'>('application.log')
    const [isConnected, setIsConnected] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setLogs([])
        setIsConnected(false)
        const url = withSubPath(`${API_BASE_URL}/admin/system/logs/${logType}`)
        const eventSource = new EventSource(url, { withCredentials: true })

        eventSource.onopen = () => {
            setIsConnected(true)
        }

        eventSource.onmessage = (event) => {
            setLogs((prev) => {
                const newLogs = [...prev, event.data]
                if (newLogs.length > 100) return newLogs.slice(newLogs.length - 100)
                return newLogs
            })
        }

        eventSource.onerror = (err) => {
            console.error('SSE connection error:', err)
            setIsConnected(false)
            eventSource.close()
        }

        return () => {
            eventSource.close()
        }
    }, [logType])

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [logs])

    return (
        <Card className="flex flex-col h-[400px] shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-primary/10 rounded-md">
                        <IconActivity className="h-4 w-4 text-primary" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">{t('dashboard.liveSystemLogs', 'Live System Logs')}</CardTitle>
                </div>
                <div className="flex items-center gap-4">
                    <Tabs value={logType} onValueChange={(v) => setLogType(v as typeof logType)}>
                        <TabsList className="h-8">
                            <TabsTrigger value="application.log" className="text-[10px] h-7 px-2">App</TabsTrigger>
                            <TabsTrigger value="access.log" className="text-[10px] h-7 px-2">Access</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    {!isConnected && <IconSettings className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto pt-4 scrollbar-hide bg-black/95 m-2 rounded-md font-mono text-[11px] text-green-400" ref={scrollRef}>
                <div className="space-y-1">
                    {logs.map((log, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all leading-tight">
                            {log}
                        </div>
                    ))}
                    {logs.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                            <p>{isConnected ? t('dashboard.waitingLogs', 'Waiting for logs...') : t('dashboard.connecting', 'Connecting...')}</p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
