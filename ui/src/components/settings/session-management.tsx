import { IconDeviceDesktop, IconTrash, IconKey, IconShieldX, IconWifi, IconMobile, IconMonitor, IconServer } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { deleteSession, useSessions, UserSession } from '@/lib/api'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Extended session with isCurrent flag from backend
interface SessionWithCurrent extends UserSession {
    isCurrent?: boolean
}

function getDeviceIcon(userAgent: string) {
    const ua = userAgent.toLowerCase()
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return IconMobile
    if (ua.includes('curl') || ua.includes('python') || ua.includes('go-http') || ua.includes('kite')) return IconServer
    return IconMonitor
}

function parseUserAgent(ua: string): { browser: string; os: string } {
    let browser = 'Unknown Browser'
    let os = 'Unknown OS'
    if (ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR')) browser = 'Chrome'
    else if (ua.includes('Firefox')) browser = 'Firefox'
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari'
    else if (ua.includes('Edg')) browser = 'Edge'
    else if (ua.includes('curl')) browser = 'cURL'
    else if (ua.includes('python')) browser = 'Python'
    else if (ua.includes('Go-http-client')) browser = 'Go HTTP Client'
    if (ua.includes('Windows')) os = 'Windows'
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS'
    else if (ua.includes('Linux')) os = 'Linux'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
    return { browser, os }
}

export function SessionManagement() {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { data, isLoading } = useSessions()
    const sessions = (data as unknown as SessionWithCurrent[]) ?? []

    const deleteMutation = useMutation({
        mutationFn: (id: number) => deleteSession(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-sessions'] })
            toast.success(t('settings.sessions.deleted', 'Session removed'))
        },
        onError: (err: Error) => {
            toast.error(err.message || t('settings.sessions.deleteError', 'Failed to remove session'))
        }
    })

    const revokeAllMutation = useMutation({
        mutationFn: () => apiClient.delete<{ message: string; revoked: number }>('/users/sessions'),
        onSuccess: (res: { message: string; revoked: number }) => {
            queryClient.invalidateQueries({ queryKey: ['user-sessions'] })
            toast.success(`${res.revoked} session${res.revoked !== 1 ? 's' : ''} revoked`)
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to revoke sessions')
        }
    })

    if (isLoading) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <div className="space-y-3">
                        {[1, 2].map(i => (
                            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    const otherSessions = sessions.filter(s => !s.isCurrent)

    return (
        <TooltipProvider>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <IconKey className="h-5 w-5" />
                                {t('settings.sessions.title', 'Active Sessions')}
                                {sessions.length > 0 && (
                                    <Badge variant="secondary" className="ml-1">{sessions.length}</Badge>
                                )}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {t('settings.sessions.description', 'Manage all active sessions. Revoke access from devices you no longer use.')}
                            </CardDescription>
                        </div>
                        {otherSessions.length > 0 && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => revokeAllMutation.mutate()}
                                        disabled={revokeAllMutation.isPending}
                                        className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                                    >
                                        <IconShieldX className="h-4 w-4" />
                                        Revoke Others
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Revoke all sessions except the current one</TooltipContent>
                            </Tooltip>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {sessions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <IconDeviceDesktop className="h-8 w-8 mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-medium">No active sessions found</p>
                            <p className="text-xs mt-1 opacity-70">Sessions appear here after you log in</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {sessions.map((session: SessionWithCurrent) => {
                                const DeviceIcon = getDeviceIcon(session.userAgent || '')
                                const { browser, os } = parseUserAgent(session.userAgent || '')
                                const isExpired = new Date(session.expiresAt) < new Date()
                                return (
                                    <div
                                        key={session.id}
                                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-150 group animate-stagger-item ${
                                            session.isCurrent
                                                ? 'bg-primary/5 border-primary/20'
                                                : 'hover:bg-muted/40 border-border/50'
                                        }`}
                                    >
                                        <div className={`p-2 rounded-lg shrink-0 ${session.isCurrent ? 'bg-primary/10' : 'bg-muted'}`}>
                                            <DeviceIcon className={`h-4 w-4 ${session.isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium">{browser} on {os}</span>
                                                {session.isCurrent && (
                                                    <Badge className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/20 gap-1">
                                                        <IconWifi className="h-2.5 w-2.5" />
                                                        Current
                                                    </Badge>
                                                )}
                                                {isExpired && (
                                                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
                                                        Expired
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                                <span className="text-xs text-muted-foreground font-mono">{session.ip || 'Unknown IP'}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    Active {formatDistanceToNow(new Date(session.lastUsedAt), { addSuffix: true })}
                                                </span>
                                                {session.expiresAt && !isExpired && (
                                                    <span className="text-xs text-muted-foreground opacity-60">
                                                        Expires {formatDistanceToNow(new Date(session.expiresAt), { addSuffix: true })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {!session.isCurrent && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => deleteMutation.mutate(session.id)}
                                                        disabled={deleteMutation.isPending}
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <IconTrash className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Revoke this session</TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    )
}
