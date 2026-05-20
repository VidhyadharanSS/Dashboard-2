import { Link } from 'react-router-dom'
import {
    IconBox,
    IconLayersIntersect,
    IconRotate,
    IconRepeat,
    IconClock,
    IconChecklist,
    IconNetwork,
    IconCloud,
    IconSettings,
    IconLock,
} from '@tabler/icons-react'
import { Badge } from './ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { useResources } from '@/lib/api'

interface SummaryItem {
    kind: string
    label: string
    icon: any
    path: string
    color: string
    bgColor: string
}

export function WorkloadSummaryCard({ namespace }: { namespace: string }) {

    const summaryItems: SummaryItem[] = [
        { kind: 'deployments', label: 'Deployments', icon: IconLayersIntersect, path: '/deployments', color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
        { kind: 'statefulsets', label: 'StatefulSets', icon: IconRotate, path: '/statefulsets', color: 'text-indigo-500', bgColor: 'bg-indigo-500/10' },
        { kind: 'daemonsets', label: 'DaemonSets', icon: IconRepeat, path: '/daemonsets', color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
        { kind: 'pods', label: 'Pods', icon: IconBox, path: '/pods', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
        { kind: 'jobs', label: 'Jobs', icon: IconChecklist, path: '/jobs', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
        { kind: 'cronjobs', label: 'CronJobs', icon: IconClock, path: '/cronjobs', color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
        { kind: 'services', label: 'Services', icon: IconNetwork, path: '/services', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
        { kind: 'ingresses', label: 'Ingresses', icon: IconCloud, path: '/ingresses', color: 'text-teal-500', bgColor: 'bg-teal-500/10' },
        { kind: 'configmaps', label: 'ConfigMaps', icon: IconSettings, path: '/configmaps', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10' },
        { kind: 'secrets', label: 'Secrets', icon: IconLock, path: '/secrets', color: 'text-rose-500', bgColor: 'bg-rose-500/10' },
    ]

    return (
        <Card className="border-none shadow-sm bg-muted/20 backdrop-blur-sm overflow-hidden">
            <CardHeader className="pb-4 bg-muted/40">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Namespace Overview</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{namespace}</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {summaryItems.map((item) => (
                        <SummaryStat key={item.kind} item={item} namespace={namespace} />
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function SummaryStat({ item, namespace }: { item: SummaryItem, namespace: string }) {
    const { data, isLoading } = useResources(item.kind as any, namespace)
    const count = data?.length || 0

    return (
        <Link
            to={`${item.path}?namespace=${namespace}`}
            className="group flex flex-col items-center justify-center p-3 rounded-xl border border-transparent bg-background/50 hover:bg-background hover:border-primary/20 hover:shadow-md transition-all duration-300"
        >
            <div className={`p-2 rounded-lg ${item.bgColor} group-hover:scale-110 transition-transform duration-300`}>
                <item.icon className={`w-5 h-5 ${item.color}`} />
            </div>
            <div className="mt-2 text-center">
                <p className="text-xl font-bold font-mono tracking-tight">{isLoading ? '…' : count}</p>
                <p className="text-[9px] uppercase font-bold text-muted-foreground tracking-widest leading-tight mt-0.5">{item.label}</p>
            </div>
        </Link>
    )
}
