import { useMemo, useState } from 'react'
import { IconAlertTriangle, IconInfoCircle, IconX } from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'

import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type EventFilter = 'all' | 'Warning' | 'Normal'

/* ─── Compact severity summary bar ─── */
function SeveritySummaryBar({ normal, warning }: { normal: number; warning: number }) {
  const total = normal + warning
  if (total === 0) return null

  const normalPct = (normal / total) * 100
  const warningPct = (warning / total) * 100

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-1.5 rounded-full overflow-hidden bg-muted flex cursor-default">
            {normalPct > 0 && (
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${normalPct}%` }}
              />
            )}
            {warningPct > 0 && (
              <div
                className="h-full bg-amber-500 transition-all duration-500"
                style={{ width: `${warningPct}%` }}
              />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {normal} Normal · {warning} Warning
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function RecentEvents() {
  const { t } = useTranslation()
  const { canAccess } = usePermissions()
  const [filter, setFilter] = useState<EventFilter>('all')
  const { data, isLoading } = useResources('events', undefined, {
    limit: 20,
    disable: !canAccess('events', 'list'),
  })

  const allEvents = useMemo(() => {
    return data
      ?.filter((event) => {
        // Filter events based on access to the involved object
        const kind = (event.involvedObject?.kind || '').toLowerCase() + 's' // simple pluralization
        const ns = event.involvedObject?.namespace || '*'
        if (!event.involvedObject?.kind) return false
        return canAccess(kind as any, 'get', ns)
      })
      .slice()
      .sort((a, b) => {
        const dateA = new Date(
          a.metadata.creationTimestamp || a.firstTimestamp || ''
        )
        const dateB = new Date(
          b.metadata.creationTimestamp || b.firstTimestamp || ''
        )
        return dateB.getTime() - dateA.getTime() // Sort by most recent first
      })
  }, [data, canAccess])

  // Severity counts
  const { normalCount, warningCount } = useMemo(() => {
    let normalCount = 0
    let warningCount = 0
    allEvents?.forEach((e) => {
      if (e.type === 'Warning') warningCount++
      else normalCount++
    })
    return { normalCount, warningCount }
  }, [allEvents])

  // Filtered events
  const events = useMemo(() => {
    if (filter === 'all') return allEvents
    return allEvents?.filter((e) => e.type === filter)
  }, [allEvents, filter])

  const getEventIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'warning':
        return <IconAlertTriangle className="size-4 text-yellow-600" />
      case 'error':
        return <IconX className="size-4 text-red-600" />
      default:
        return <IconInfoCircle className="size-4 text-blue-600" />
    }
  }

  const getEventBadgeVariant = (type: string) => {
    switch (type.toLowerCase()) {
      case 'warning':
        return 'secondary' as const
      case 'error':
        return 'destructive' as const
      default:
        return 'default' as const
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="animate-pulse">
          <div className="h-6  bg-muted rounded w-1/3 mb-2"></div>
          <div className="h-4  bg-muted rounded w-1/2"></div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 scrollbar-hide overflow-auto">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <div className="w-4 h-4  bg-muted rounded-full mt-1"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4  bg-muted rounded w-3/4"></div>
                  <div className="h-3  bg-muted rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!allEvents || allEvents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('overview.recentEvents')}</CardTitle>
          <CardDescription>Latest cluster events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            No recent events
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('overview.recentEvents')}</CardTitle>
            <CardDescription>Latest cluster events</CardDescription>
          </div>
          {/* Filter buttons */}
          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            <Button
              variant={filter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => setFilter('all')}
            >
              All ({(allEvents?.length ?? 0)})
            </Button>
            <Button
              variant={filter === 'Warning' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-[10px] px-2 gap-0.5"
              onClick={() => setFilter('Warning')}
            >
              <IconAlertTriangle className="h-3 w-3 text-amber-500" />
              {warningCount}
            </Button>
            <Button
              variant={filter === 'Normal' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-[10px] px-2 gap-0.5"
              onClick={() => setFilter('Normal')}
            >
              <IconInfoCircle className="h-3 w-3 text-blue-500" />
              {normalCount}
            </Button>
          </div>
        </div>
        {/* Severity bar */}
        <div className="mt-2">
          <SeveritySummaryBar normal={normalCount} warning={warningCount} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-y-auto scrollbar-hide">
          <div className="space-y-4">
            {events && events.length > 0 ? events.map((event, index) => (
              <div
                key={index}
                className="flex items-start gap-3 pb-3 border-b border-border last:border-0"
              >
                <div className="mt-1">{getEventIcon(event.type ?? '')}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={getEventBadgeVariant(event.type ?? '')}
                          className="text-xs"
                        >
                          {event.type ?? ''}
                        </Badge>
                        <span className="text-sm font-medium">
                          {event.reason}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground break-words">
                        {event.message}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span>
                          {event.involvedObject.kind}:{' '}
                          {event.involvedObject.namespace ? (
                            <>{event.involvedObject.namespace}/</>
                          ) : null}
                          {event.involvedObject.name}
                        </span>
                        {event.reportingComponent && (
                          <span className="text-xs">
                            Reporter: {event.reportingComponent}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(
                        new Date(
                          event.metadata.creationTimestamp ||
                          event.firstTimestamp ||
                          ''
                        ),
                        {
                          addSuffix: true,
                        }
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                No {filter !== 'all' ? filter.toLowerCase() : ''} events found
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
