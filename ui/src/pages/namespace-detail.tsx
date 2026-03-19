import { useResource } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { ErrorMessage } from '@/components/error-message'
import { EventTable } from '@/components/event-table'
import { LabelsAnno } from '@/components/lables-anno'
import { Badge } from '@/components/ui/badge'
import { WorkloadSummaryCard } from '@/components/workload-summary-card'
import { ResourceTopology } from '@/components/resource-topology'

export function NamespaceDetail(props: { name: string }) {
    const { name } = props

    const {
        data: ns,
        isLoading: isNsLoading,
        isError: isNsError,
        error: nsError,
        refetch: refetchNs,
    } = useResource('namespaces', name)

    if (isNsLoading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground">Loading namespace details...</p>
                </div>
            </div>
        )
    }

    if (isNsError || !ns) {
        return (
            <ErrorMessage
                resourceName="Namespace"
                error={nsError}
                refetch={refetchNs}
            />
        )
    }

    return (
        <div className="space-y-6 animate-page-enter">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
                        <Badge variant="outline" className="text-xs font-mono uppercase">Namespace</Badge>
                    </div>
                    <p className="text-muted-foreground text-sm mt-1">Resource health and workload distribution</p>
                </div>
            </div>

            <ResponsiveTabs
                tabs={[
                    {
                        value: 'overview',
                        label: 'Overview',
                        content: (
                            <div className="space-y-6 animate-in fade-in duration-500">
                                {/* Summary Card (Highest priority) */}
                                <WorkloadSummaryCard namespace={name} />

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <Card className="border-none bg-muted/30 shadow-sm overflow-hidden">
                                        <CardHeader className="pb-2 bg-muted/40">
                                            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                Namespace Metadata
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-6 pt-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Created</Label>
                                                    <p className="text-sm font-medium">{formatDate(ns.metadata?.creationTimestamp || '')}</p>
                                                </div>
                                                <div>
                                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</Label>
                                                    <p className="text-sm font-bold text-green-500 flex items-center gap-1.5">
                                                        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                                        {ns.status?.phase || 'Active'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div>
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">UID</Label>
                                                <p className="text-xs font-mono text-muted-foreground bg-muted/50 p-1.5 rounded truncate">
                                                    {ns.metadata?.uid || 'N/A'}
                                                </p>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card className="border-none bg-muted/30 shadow-sm overflow-hidden">
                                        <CardHeader className="pb-2 bg-muted/40">
                                            <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                                Labels & Annotations
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-4 h-[160px] overflow-y-auto">
                                            <LabelsAnno
                                                labels={ns.metadata?.labels || {}}
                                                annotations={ns.metadata?.annotations || {}}
                                            />
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        ),
                    },
                    {
                        value: 'related',
                        label: 'Related',
                        content: (
                            <div className="h-[calc(100vh-250px)] animate-in fade-in duration-500">
                                <ResourceTopology
                                    resource="namespaces"
                                    name={name}
                                />
                            </div>
                        ),
                    },
                    {
                        value: 'events',
                        label: 'Events',
                        content: (
                            <div className="animate-in fade-in duration-500">
                                <EventTable
                                    resource="namespaces"
                                    namespace={name}
                                    name={name}
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    )
}
