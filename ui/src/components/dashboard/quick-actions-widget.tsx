import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IconSearch, IconTerminal, IconFileSearch } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useGlobalSearch } from '@/components/global-search-provider'
import { useAuth } from '@/contexts/auth-context'
import { useResources } from '@/lib/api'
import type { Pod } from 'kubernetes-types/core/v1'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

export function QuickActionsWidget() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { openSearch } = useGlobalSearch()
    const { user } = useAuth()
    const [selectedPod, setSelectedPod] = useState<string>('')

    // Check if user has pod exec/log permissions (admin users only)
    const canAccessPodExec = user?.isAdmin()
    const canAccessPodLogs = user?.isAdmin()

    // Fetch running pods if user has permissions
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
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <IconSearch className="h-5 w-5" />
                    {t('dashboard.quickActions', 'Quick Actions')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Search Resources - Available to all users */}
                <Button
                    onClick={openSearch}
                    className="w-full flex items-center justify-center gap-2"
                    variant="outline"
                >
                    <IconSearch className="h-4 w-4" />
                    Search Resources
                    <span className="text-xs text-muted-foreground ml-auto">(⌘K)</span>
                </Button>

                {/* Pod Quick Access - Only for users with permissions */}
                {(canAccessPodExec || canAccessPodLogs) && (
                    <div className="space-y-3 pt-2 border-t">
                        <Label className="text-xs font-medium text-muted-foreground">
                            Quick Pod Access
                        </Label>
                        <Select value={selectedPod} onValueChange={setSelectedPod}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select a running pod..." />
                            </SelectTrigger>
                            <SelectContent>
                                {runningPods.slice(0, 20).map(p => (
                                    <SelectItem
                                        key={p.metadata?.uid}
                                        value={`${p.metadata?.namespace}/${p.metadata?.name}`}
                                    >
                                        <div className="flex flex-col items-start">
                                            <span className="font-medium">{p.metadata?.name}</span>
                                            <span className="text-xs text-muted-foreground">
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
                            </SelectContent>
                        </Select>
                        <div className="grid grid-cols-2 gap-2">
                            {canAccessPodExec && (
                                <Button
                                    onClick={handleTerminalAccess}
                                    disabled={!selectedPod}
                                    className="flex items-center justify-center gap-2"
                                    variant="secondary"
                                    size="sm"
                                >
                                    <IconTerminal className="h-4 w-4" />
                                    Terminal
                                </Button>
                            )}
                            {canAccessPodLogs && (
                                <Button
                                    onClick={handleLogsAccess}
                                    disabled={!selectedPod}
                                    className="flex items-center justify-center gap-2"
                                    variant="secondary"
                                    size="sm"
                                >
                                    <IconFileSearch className="h-4 w-4" />
                                    Logs
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
