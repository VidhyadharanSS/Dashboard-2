import { useMemo } from 'react'
import { IconAlertTriangle, IconInfoCircle, IconLoader, IconTag, IconNote } from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'

import { ResourceType, RelatedResource } from '@/types/api'
import { useResourcesEvents, useRelatedResources } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/* ─── Compact Events Card for sidebar ─── */
export function SidebarEvents(props: {
  resource: ResourceType
  name: string
  namespace?: string
}) {
  const { data: events, isLoading } = useResourcesEvents(
    props.resource,
    props.name,
    props.namespace
  )

  const recentEvents = useMemo(() => {
    if (!events) return []
    return [...events]
      .sort((a, b) => {
        const dateA = new Date(a.lastTimestamp || a.eventTime || a.metadata?.creationTimestamp || '').getTime()
        const dateB = new Date(b.lastTimestamp || b.eventTime || b.metadata?.creationTimestamp || '').getTime()
        return dateB - dateA
      })
      .slice(0, 5)
  }, [events])

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Events
          <span className="text-muted-foreground font-normal">({events?.length || 0})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <IconLoader className="w-3.5 h-3.5 animate-spin" />
            Loading...
          </div>
        ) : recentEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">No recent events</p>
        ) : (
          <div className="space-y-2">
            {recentEvents.map((event, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                {event.type === 'Warning' ? (
                  <IconAlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <IconInfoCircle className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground font-medium truncate">{event.reason}</p>
                  <p className="text-muted-foreground truncate">{event.message}</p>
                  <p className="text-muted-foreground/70 text-[10px]">
                    {event.lastTimestamp || event.eventTime
                      ? formatDistanceToNow(new Date(event.lastTimestamp || event.eventTime || ''), { addSuffix: true })
                      : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Compact Related Resources Card for sidebar ─── */
export function SidebarRelatedResources(props: {
  resource: ResourceType
  name: string
  namespace?: string
}) {
  const { data: relatedData, isLoading } = useRelatedResources(
    props.resource,
    props.name,
    props.namespace
  )

  const items = relatedData?.nodes || []

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          Related Resources
          <span className="text-muted-foreground font-normal">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <IconLoader className="w-3.5 h-3.5 animate-spin" />
            Loading...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">No related resources</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item: RelatedResource, idx: number) => (
              <div key={idx} className="flex items-center justify-between text-xs gap-2">
                <Badge variant="secondary" className="text-[10px] shrink-0">{item.type}</Badge>
                <span className="text-foreground font-medium truncate">{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Compact Labels Card for sidebar ─── */
export function SidebarLabels(props: { labels: Record<string, string> }) {
  const entries = Object.entries(props.labels || {})
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <IconTag className="w-3.5 h-3.5" />
          Labels
          <span className="text-muted-foreground font-normal">({entries.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">No labels</p>
        ) : (
          <div className="space-y-1">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-muted-foreground truncate">{key}</span>
                <span className="font-medium text-foreground truncate max-w-[50%] text-right">{value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Compact Annotations Card for sidebar ─── */
export function SidebarAnnotations(props: { annotations: Record<string, string> }) {
  const entries = Object.entries(props.annotations || {})
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <IconNote className="w-3.5 h-3.5" />
          Annotations
          <span className="text-muted-foreground font-normal">({entries.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">No annotations</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-muted-foreground truncate">{key}</span>
                <span className="font-medium text-foreground truncate max-w-[50%] text-right">
                  {value.length > 50 ? value.slice(0, 50) + '...' : value}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

