import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    IconSearch,
    IconTerminal,
    IconFileSearch,
    IconBolt,
    IconPlus,
    IconKey,
    IconKeyboard,
} from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useGlobalSearch } from '@/components/global-search-provider'
import { useResources } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import type { Pod } from 'kubernetes-types/core/v1'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function QuickActionsWidget() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { openSearch } = useGlobalSearch()
    const { canAccess } = usePermissions()
    const [selectedPod, setSelectedPod] = useState<string>('')

    const canAccessPodExec = canAccess('pods', 'exec')
    const canAccessPodLogs = canAccess('pods', 'get')

    const { data: pods } = useResources('pods', undefined, {
        refreshInterval: 30000,
        disable: !canAccessPodExec && !canAccessPodLogs
    })

    const runningPods = pods ? (pods as Pod[]).filter(p => p.status?.phase === 'Running') : []

    const handleTerminalAccess = () => {
        if (!selectedPod) return
        const pod = runningPods.find(p => `${p.metadata?.namespace}/${p.metadata?.name}` === selectedPod)
        if (pod) {
            navigate(`/pods/${pod.metadata?.namespace}/${pod.metadata?.name}?tab=terminal`)
        }
    }

    const handleLogsAccess = () => {
        if (!selectedPod) return
        const pod = runningPods.find(p => `${p.metadata?.namespace}/${p.metadata?.name}` === selectedPod)
        if (pod) {
            navigate(`/pods/${pod.metadata?.namespace}/${pod.metadata?.name}?tab=logs`)
        }
    }

    return (
        <Card className="flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-sky-500/10 rounded-md">
                        <IconBolt className="h-4 w-4 text-sky-500" />
                    </div>
                    <CardTitle className="text-sm font-semibold tracking-tight">
                        {t('dashboard.quickActions', 'Quick Actions')}
                    </CardTitle>
                </div>
            </CardHeader>
            <CardContent className="flex-1 pt-3 pb-2 px-3 space-y-3">
                {/* Primary actions grid */}
                <div className="grid grid-cols-2 gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={openSearch}
                                    className="h-auto flex flex-col items-center justify-center gap-1.5 py-3"
                                    variant="outline"
                                >
                                    <IconSearch className="h-5 w-5" />
                                    <span className="text-[10px] font-medium">Search</span>
                                    <Badge variant="secondary" className="h-4 px-1 text-[8px] font-mono">⌘K</Badge>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Search across all Kubernetes resources</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={() => {
                                        // Dispatch keyboard shortcut event for create resource dialog
                                        const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true })
                                        window.dispatchEvent(event)
                                    }}
                                    className="h-auto flex flex-col items-center justify-center gap-1.5 py-3"
                                    variant="outline"
                                >
                                    <IconPlus className="h-5 w-5" />
                                    <span className="text-[10px] font-medium">Create</span>
                                    <Badge variant="secondary" className="h-4 px-1 text-[8px] font-mono">YAML</Badge>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Apply multi-document YAML resources</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={() => navigate('/settings')}
                                    className="h-auto flex flex-col items-center justify-center gap-1.5 py-3"
                                    variant="outline"
                                >
                                    <IconKey className="h-5 w-5" />
                                    <span className="text-[10px] font-medium">Settings</span>
                                    <Badge variant="secondary" className="h-4 px-1 text-[8px]">Admin</Badge>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Manage clusters, RBAC, users, and API keys</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    onClick={() => {
                                        const event = new KeyboardEvent('keydown', { key: '/', ctrlKey: true })
                                        window.dispatchEvent(event)
                                    }}
                                    className="h-auto flex flex-col items-center justify-center gap-1.5 py-3"
                                    variant="outline"
                                >
                                    <IconKeyboard className="h-5 w-5" />
                                    <span className="text-[10px] font-medium">Shortcuts</span>
                                    <Badge variant="secondary" className="h-4 px-1 text-[8px] font-mono">?</Badge>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>View all keyboard shortcuts</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                {/* Pod Quick Access */}
                {(canAccessPodExec || canAccessPodLogs) && (
                    <div className="space-y-2 pt-2 border-t border-border/50">
                        <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Quick Pod Access
                        </Label>
                        <Select value={selectedPod} onValueChange={setSelectedPod}>
                            <SelectTrigger className="w-full h-8 text-xs">
                                <SelectValue placeholder="Select a running pod..." />
                            </SelectTrigger>
                            <SelectContent>
                                {runningPods.slice(0, 25).map(p => (
                                    <SelectItem
                                        key={p.metadata?.uid}
                                        value={`${p.metadata?.namespace}/${p.metadata?.name}`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                                            <span className="font-medium truncate">{p.metadata?.name}</span>
                                            <span className="text-muted-foreground text-[10px]">
                                                {p.metadata?.namespace}
                                            </span>
                                        </div>
                                    </SelectItem>
                                ))}
                                {runningPods.length === 0 && (
                                    <SelectItem value="none" disabled>
                                        No running pods found
                                    </SelectItem>
                                )}
                                {runningPods.length > 25 && (
                                    <SelectItem value="more" disabled>
                                        … and {runningPods.length - 25} more
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                        <div className="grid grid-cols-2 gap-2">
                            {canAccessPodExec && (
                                <Button
                                    onClick={handleTerminalAccess}
                                    disabled={!selectedPod}
                                    className="flex items-center justify-center gap-1.5"
                                    variant="secondary"
                                    size="sm"
                                >
                                    <IconTerminal className="h-3.5 w-3.5" />
                                    <span className="text-xs">Terminal</span>
                                </Button>
                            )}
                            {canAccessPodLogs && (
                                <Button
                                    onClick={handleLogsAccess}
                                    disabled={!selectedPod}
                                    className="flex items-center justify-center gap-1.5"
                                    variant="secondary"
                                    size="sm"
                                >
                                    <IconFileSearch className="h-3.5 w-3.5" />
                                    <span className="text-xs">Logs</span>
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
