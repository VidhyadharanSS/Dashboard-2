import { useMemo, useState } from 'react'
import {
    IconDeviceDesktop,
    IconTrash,
    IconKey,
    IconShieldX,
    IconWifi,
    IconDeviceMobile,
    IconDeviceLaptop,
    IconServer,
    IconUsers,
    IconSearch,
    IconX,
    IconSortAscending,
    IconSortDescending,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { deleteSession, useAllSessions, useSessions, UserSession } from '@/lib/api'
import { apiClient } from '@/lib/api-client'

const deleteSessionAdmin = async (id: number): Promise<void> => {
    return apiClient.delete<void>(`/admin/sessions/${id}`)
}

import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Extended session with isCurrent flag from backend
interface SessionWithCurrent extends UserSession {
    isCurrent?: boolean
}

function getDeviceIcon(userAgent: string) {
    const ua = userAgent.toLowerCase()
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return IconDeviceMobile
    if (ua.includes('curl') || ua.includes('python') || ua.includes('go-http') || ua.includes('kite')) return IconServer
    return IconDeviceLaptop
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
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const isAdmin = user?.isAdmin?.() ?? false

    // Admin sees all sessions; regular user sees only their own
    const { data: allSessionsData, isLoading: loadingAll } = useAllSessions({ enabled: isAdmin })
    const { data: userSessionsData, isLoading: loadingUser } = useSessions({ enabled: !isAdmin })

    const isLoading = isAdmin ? loadingAll : loadingUser

    const sessions: SessionWithCurrent[] = useMemo(() => {
        const raw = (isAdmin ? allSessionsData : userSessionsData) as unknown as SessionWithCurrent[] ?? []
        return raw
    }, [isAdmin, allSessionsData, userSessionsData])

    const [searchQuery, setSearchQuery] = useState('')
    const [sortBy, setSortBy] = useState<'lastUsedAt' | 'createdAt'>('lastUsedAt')
    const [sortAsc, setSortAsc] = useState(false)

    const filteredSessions = useMemo(() => {
        let filtered = sessions
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(s => {
                const { browser, os } = parseUserAgent(s.userAgent || '')
                const userName = (s.user as any)?.username || (s.user as any)?.name || ''
                return (
                    browser.toLowerCase().includes(q) ||
                    os.toLowerCase().includes(q) ||
                    (s.ip || '').includes(q) ||
                    userName.toLowerCase().includes(q)
                )
            })
        }
        const sorted = [...filtered].sort((a, b) => {
            const aVal = new Date(sortBy === 'lastUsedAt' ? a.lastUsedAt : a.createdAt).getTime()
            const bVal = new Date(sortBy === 'lastUsedAt' ? b.lastUsedAt : b.createdAt).getTime()
            return sortAsc ? aVal - bVal : bVal - aVal
        })
        return sorted
    }, [sessions, searchQuery, sortBy, sortAsc])

    const deleteMutation = useMutation({
        mutationFn: (id: number) => isAdmin ? deleteSessionAdmin(id) : deleteSession(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['user-sessions'] })
            queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
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
            queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
            toast.success(`${res.revoked} session${res.revoked !== 1 ? 's' : ''} revoked`)
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to revoke sessions')
        }
    })

    // Group sessions by user for admin view
    const groupedByUser = useMemo(() => {
        if (!isAdmin) return null
        const groups: Record<string, SessionWithCurrent[]> = {}
        filteredSessions.forEach(s => {
            const userName = (s.user as any)?.username || (s.user as any)?.name || `User #${s.userId}`
            if (!groups[userName]) groups[userName] = []
            groups[userName].push(s)
        })
        return groups
    }, [isAdmin, filteredSessions])

    const otherSessions = sessions.filter(s => !s.isCurrent)

    if (isLoading) {
        return (
            <Card>
                <CardContent className="pt-6">
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <TooltipProvider>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <CardTitle className="flex items-center gap-2">
                                <IconKey className="h-5 w-5 shrink-0" />
                                {isAdmin
                                    ? t('settings.sessions.titleAdmin', 'All Active Sessions')
                                    : t('settings.sessions.title', 'Active Sessions')
                                }
                                {sessions.length > 0 && (
                                    <Badge variant="secondary" className="ml-1">{sessions.length}</Badge>
                                )}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {isAdmin
                                    ? t('settings.sessions.descriptionAdmin', 'View and manage sessions across all users.')
                                    : t('settings.sessions.description', 'Manage all active sessions. Revoke access from devices you no longer use.')
                                }
                            </CardDescription>
                        </div>
                        {otherSessions.length > 0 && !isAdmin && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => revokeAllMutation.mutate()}
                                        disabled={revokeAllMutation.isPending}
                                        className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30 shrink-0"
                                    >
                                        <IconShieldX className="h-4 w-4" />
                                        Revoke Others
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Revoke all sessions except the current one</TooltipContent>
                            </Tooltip>
                        )}
                    </div>

                    {/* Search and sort toolbar */}
                    {sessions.length > 3 && (
                        <div className="flex items-center gap-2 mt-3">
                            <div className="relative flex-1 max-w-xs">
                                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                    placeholder={isAdmin ? "Search by user, IP, browser..." : "Search sessions..."}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-8 h-8 text-xs"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        <IconX className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant={sortBy === 'lastUsedAt' ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="h-8 text-xs px-2"
                                    onClick={() => {
                                        if (sortBy === 'lastUsedAt') setSortAsc(!sortAsc)
                                        else { setSortBy('lastUsedAt'); setSortAsc(false) }
                                    }}
                                >
                                    Last Active
                                    {sortBy === 'lastUsedAt' && (
                                        sortAsc ? <IconSortAscending className="h-3 w-3 ml-1" /> : <IconSortDescending className="h-3 w-3 ml-1" />
                                    )}
                                </Button>
                                <Button
                                    variant={sortBy === 'createdAt' ? 'secondary' : 'ghost'}
                                    size="sm"
                                    className="h-8 text-xs px-2"
                                    onClick={() => {
                                        if (sortBy === 'createdAt') setSortAsc(!sortAsc)
                                        else { setSortBy('createdAt'); setSortAsc(false) }
                                    }}
                                >
                                    Created
                                    {sortBy === 'createdAt' && (
                                        sortAsc ? <IconSortAscending className="h-3 w-3 ml-1" /> : <IconSortDescending className="h-3 w-3 ml-1" />
                                    )}
                                </Button>
                            </div>
                            {searchQuery && (
                                <Badge variant="outline" className="text-[10px] h-5">
                                    {filteredSessions.length} of {sessions.length}
                                </Badge>
                            )}
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    {sessions.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <IconDeviceDesktop className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-medium">No active sessions found</p>
                            <p className="text-xs mt-1 opacity-70">
                                {isAdmin
                                    ? 'No users have active sessions at the moment.'
                                    : 'Sessions appear here after you log in.'
                                }
                            </p>
                        </div>
                    ) : filteredSessions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <IconSearch className="h-8 w-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No sessions match your search</p>
                        </div>
                    ) : isAdmin && groupedByUser ? (
                        /* Admin grouped view */
                        <div className="space-y-4">
                            {Object.entries(groupedByUser).map(([userName, userSessions]) => (
                                <div key={userName} className="space-y-1.5">
                                    <div className="flex items-center gap-2 px-1">
                                        <IconUsers className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{userName}</span>
                                        <Badge variant="secondary" className="text-[10px] h-4">{userSessions.length}</Badge>
                                    </div>
                                    <div className="space-y-1">
                                        {userSessions.map(session => (
                                            <SessionRow
                                                key={session.id}
                                                session={session}
                                                onDelete={(id) => deleteMutation.mutate(id)}
                                                isDeleting={deleteMutation.isPending}
                                                showUser={false}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* Regular user view */
                        <div className="space-y-1.5">
                            {filteredSessions.map((session) => (
                                <SessionRow
                                    key={session.id}
                                    session={session}
                                    onDelete={(id) => deleteMutation.mutate(id)}
                                    isDeleting={deleteMutation.isPending}
                                    showUser={false}
                                />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </TooltipProvider>
    )
}

function SessionRow({
    session,
    onDelete,
    isDeleting,
    showUser = false,
}: {
    session: SessionWithCurrent
    onDelete: (id: number) => void
    isDeleting: boolean
    showUser?: boolean
}) {
    const DeviceIcon = getDeviceIcon(session.userAgent || '')
    const { browser, os } = parseUserAgent(session.userAgent || '')
    const isExpired = new Date(session.expiresAt) < new Date()

    return (
        <div
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-150 group ${session.isCurrent
                    ? 'bg-primary/5 border-primary/20'
                    : 'hover:bg-muted/40 border-border/50'
                }`}
        >
            <div className={`p-2 rounded-lg shrink-0 ${session.isCurrent ? 'bg-primary/10' : 'bg-muted'}`}>
                <DeviceIcon className={`h-4 w-4 ${session.isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    {showUser && (session.user as any)?.username && (
                        <span className="text-xs font-bold text-primary">{(session.user as any).username}</span>
                    )}
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
                            onClick={() => onDelete(session.id)}
                            disabled={isDeleting}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                            <IconTrash className="h-3.5 w-3.5" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Revoke this session</TooltipContent>
                </Tooltip>
            )}
        </div>
    )
}
