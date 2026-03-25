import { useState, useMemo } from 'react'
import {
  IconActivity,
  IconAlertTriangle,
  IconBox,
  IconCheck,
  IconCpu,
  IconDatabase,
  IconDeviceDesktopAnalytics,
  IconHardDrive,
  IconRefresh,
  IconServer,
  IconTimeline,
  IconX,
} from '@tabler/icons-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts'
import { useQueryClient } from '@tanstack/react-query'

import {
  useClusterMetrics,
  useNamespaceMetrics,
  useNodeFilesystemMetrics,
  useOverview,
  useResourceUsageHistory,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function fmtCores(cores: number): string {
  if (cores < 0.001) return '0m'
  if (cores < 1) return `${Math.round(cores * 1000)}m`
  return `${cores.toFixed(2)}`
}

function fmtPct(pct: number): string {
  return `${Math.round(pct)}%`
}

function getBarColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#10b981'
}

// ─── Metric Stat Card ─────────────────────────────────────────────────────────

interface MetricStatProps {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  color?: string
  badge?: { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  pct?: number
}

function MetricStat({ icon: Icon, label, value, sub, color = 'text-primary', badge, pct }: MetricStatProps) {
  return (
    <Card className="group hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className={`p-2 rounded-lg bg-muted/50 group-hover:scale-110 transition-transform duration-200`}>
            <Icon className={`size-5 ${color}`} />
          </div>
          {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        </div>
        <CardDescription className="text-xs mt-1">{label}</CardDescription>
        <CardTitle className="text-2xl font-bold tabular-nums">{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
      {pct !== undefined && (
        <CardContent className="pt-0">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: getBarColor(pct) }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{fmtPct(pct)} utilization</p>
        </CardContent>
      )}
    </Card>
  )
}

// ─── Time-series chart ────────────────────────────────────────────────────────

interface TimeSeriesChartProps {
  title: string
  description?: string
  data: { timestamp: string; value: number }[]
  isLoading?: boolean
  unit?: string
  color?: string
  formatValue?: (v: number) => string
}

function TimeSeriesChart({
  title,
  description,
  data,
  isLoading,
  color = '#6366f1',
  formatValue,
}: TimeSeriesChartProps) {
  const chartData = useMemo(
    () =>
      data.map((pt) => ({
        time: new Date(pt.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        value: pt.value,
      })),
    [data]
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="h-40 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={formatValue} />
              <Tooltip
                formatter={(v: number) => [formatValue ? formatValue(v) : v.toFixed(2), title]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${title})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Status Indicator ─────────────────────────────────────────────────────────

function StatusIndicator({ up, label }: { up: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`size-2 rounded-full ${up ? 'bg-emerald-500' : 'bg-red-500'} ${up ? 'animate-pulse' : ''}`} />
      <span className="text-xs font-medium">{label}</span>
      {up ? (
        <IconCheck className="size-3 text-emerald-500" />
      ) : (
        <IconX className="size-3 text-red-500" />
      )}
    </div>
  )
}

// ─── Namespace Metrics Table ──────────────────────────────────────────────────

function NamespaceMetricsSection() {
  const { data: nsMetrics, isLoading, error } = useNamespaceMetrics()

  const sorted = useMemo(
    () =>
      [...(nsMetrics ?? [])].sort((a, b) => b.cpuUsage - a.cpuUsage),
    [nsMetrics]
  )

  const maxCpu = useMemo(
    () => Math.max(...sorted.map((n) => n.cpuUsage), 0.001),
    [sorted]
  )
  const maxMem = useMemo(
    () => Math.max(...sorted.map((n) => n.memUsage), 1),
    [sorted]
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Namespace Resource Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Prometheus not available or no data
          </p>
        </CardContent>
      </Card>
    )
  }

  const chartData = sorted.slice(0, 12).map((ns) => ({
    name: ns.namespace.length > 16 ? ns.namespace.slice(0, 14) + '…' : ns.namespace,
    fullName: ns.namespace,
    cpu: parseFloat(ns.cpuUsage.toFixed(4)),
    memGiB: parseFloat((ns.memUsage / 1024 / 1024 / 1024).toFixed(3)),
    pods: ns.podCount,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <IconDatabase className="size-4 text-purple-500" />
          <CardTitle className="text-sm">Namespace Resource Usage</CardTitle>
        </div>
        <CardDescription className="text-xs">
          CPU (cores) and memory (GiB) usage per namespace — top {chartData.length}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No namespace data</p>
        ) : (
          <div className="space-y-4">
            {/* Bar chart */}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v: number, name: string) =>
                    name === 'cpu' ? [`${v.toFixed(3)} cores`, 'CPU'] : [`${v.toFixed(3)} GiB`, 'Memory']
                  }
                  labelFormatter={(label, payload) =>
                    payload?.[0]?.payload?.fullName ?? label
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="cpu" name="CPU (cores)" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="memGiB" name="Memory (GiB)" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Detailed rows */}
            <div className="space-y-2">
              {sorted.slice(0, 10).map((ns) => {
                const cpuPct = (ns.cpuUsage / maxCpu) * 100
                const memPct = (ns.memUsage / maxMem) * 100
                return (
                  <div key={ns.namespace} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium truncate max-w-[160px]">{ns.namespace}</span>
                      <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                        <span>CPU {fmtCores(ns.cpuUsage)}</span>
                        <span>Mem {fmtBytes(ns.memUsage)}</span>
                        {ns.podCount > 0 && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {ns.podCount} pods
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                          style={{ width: `${cpuPct}%` }}
                        />
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${memPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Node Filesystem Section ──────────────────────────────────────────────────

function NodeFilesystemSection() {
  const { data: fsMetrics, isLoading, error } = useNodeFilesystemMetrics()

  const sorted = useMemo(
    () => [...(fsMetrics ?? [])].sort((a, b) => b.usedPercent - a.usedPercent),
    [fsMetrics]
  )

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error || sorted.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <IconHardDrive className="size-4 text-orange-500" />
            <CardTitle className="text-sm">Node Filesystem Usage</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            {error ? 'Prometheus not available or no data' : 'No filesystem data'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <IconHardDrive className="size-4 text-orange-500" />
          <CardTitle className="text-sm">Node Filesystem Usage</CardTitle>
        </div>
        <CardDescription className="text-xs">Disk usage at root mountpoint per node</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sorted.map((node) => {
            const pct = node.usedPercent
            const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981'
            const textColor = pct >= 90
              ? 'text-red-600 dark:text-red-400'
              : pct >= 75
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'
            return (
              <div key={node.node} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate max-w-[200px]" title={node.node}>
                    {node.node}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">
                      {fmtBytes(node.usedBytes)} / {fmtBytes(node.totalBytes)}
                    </span>
                    <span className={`font-bold tabular-nums ${textColor}`}>
                      {fmtPct(pct)}
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PrometheusPage() {
  const [timeRange, setTimeRange] = useState<'30m' | '1h' | '24h'>('1h')
  const queryClient = useQueryClient()

  const { data: overview } = useOverview()
  const promEnabled = overview?.prometheusEnabled ?? false

  const {
    data: clusterMetrics,
    isLoading: loadingCluster,
    error: clusterError,
  } = useClusterMetrics({ enabled: promEnabled })

  const {
    data: resourceUsage,
    isLoading: loadingUsage,
  } = useResourceUsageHistory(timeRange, { enabled: promEnabled })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cluster-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['namespace-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['node-filesystem-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['resource-usage-history'] })
  }

  // ── Not enabled ──────────────────────────────────────────────────────────
  if (!promEnabled && overview !== undefined) {
    return (
      <div className="flex flex-col gap-6 animate-page-enter">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gradient flex items-center gap-3">
            <IconDeviceDesktopAnalytics className="size-8" />
            Prometheus Metrics
          </h1>
          <p className="text-muted-foreground text-sm">Real-time cluster observability</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <IconActivity className="size-12 text-muted-foreground/40" />
            <div className="text-center">
              <h3 className="text-lg font-semibold">Prometheus Not Configured</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-md">
                Configure a Prometheus URL for this cluster in the cluster settings to enable
                real-time metrics, namespace breakdowns, and historical usage charts.
              </p>
            </div>
            <Button variant="outline" onClick={() => (window.location.href = '/settings')}>
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Main layout ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 animate-page-enter">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gradient flex items-center gap-3">
            <IconDeviceDesktopAnalytics className="size-8" />
            Prometheus Metrics
          </h1>
          <p className="text-muted-foreground text-sm">
            Real-time cluster observability — auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={timeRange}
            onValueChange={(v) => setTimeRange(v as '30m' | '1h' | '24h')}
          >
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30m">Last 30 min</SelectItem>
              <SelectItem value="1h">Last 1 hour</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
            </SelectContent>
          </Select>
          <TooltipProvider>
            <UITooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleRefresh}>
                  <IconRefresh className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh all metrics</TooltipContent>
            </UITooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Prometheus unavailable banner */}
      {clusterError && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-3">
            <IconAlertTriangle className="size-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Prometheus is configured but returned an error. Some metrics may be unavailable.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Row 1: Cluster-level stat cards ── */}
      <div className="grid grid-cols-2 gap-4 @xl/main:grid-cols-3 @5xl/main:grid-cols-6">
        <MetricStat
          icon={IconCpu}
          label="CPU Usage"
          value={loadingCluster ? '…' : fmtCores(clusterMetrics?.cpuUsageCores ?? 0)}
          sub={`of ${fmtCores(clusterMetrics?.cpuTotalCores ?? 0)} cores`}
          color="text-indigo-500"
          pct={clusterMetrics?.cpuUsagePercent}
        />
        <MetricStat
          icon={IconServer}
          label="Memory Usage"
          value={loadingCluster ? '…' : fmtBytes(clusterMetrics?.memUsageBytes ?? 0)}
          sub={`of ${fmtBytes(clusterMetrics?.memTotalBytes ?? 0)}`}
          color="text-emerald-500"
          pct={clusterMetrics?.memUsagePercent}
        />
        <MetricStat
          icon={IconBox}
          label="Running Pods"
          value={loadingCluster ? '…' : String(clusterMetrics?.runningPods ?? 0)}
          sub={`of ${clusterMetrics?.totalPods ?? 0} total`}
          color="text-blue-500"
        />
        <MetricStat
          icon={IconTimeline}
          label="Container Restarts"
          value={loadingCluster ? '…' : String(clusterMetrics?.containerRestarts1h ?? 0)}
          sub="last hour"
          color={
            (clusterMetrics?.containerRestarts1h ?? 0) > 10
              ? 'text-red-500'
              : (clusterMetrics?.containerRestarts1h ?? 0) > 3
                ? 'text-amber-500'
                : 'text-muted-foreground'
          }
          badge={
            (clusterMetrics?.containerRestarts1h ?? 0) > 10
              ? { label: 'High', variant: 'destructive' }
              : undefined
          }
        />
        <MetricStat
          icon={IconAlertTriangle}
          label="OOM Kills"
          value={loadingCluster ? '…' : String(clusterMetrics?.oomKills1h ?? 0)}
          sub="last hour"
          color={
            (clusterMetrics?.oomKills1h ?? 0) > 0 ? 'text-red-500' : 'text-muted-foreground'
          }
          badge={
            (clusterMetrics?.oomKills1h ?? 0) > 0
              ? { label: 'Alert', variant: 'destructive' }
              : { label: 'OK', variant: 'secondary' }
          }
        />
        <Card className="group hover:shadow-md transition-all duration-200">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <IconActivity className="size-5 text-green-500" />
            </div>
            <CardDescription className="text-xs mt-1">Component Status</CardDescription>
            <div className="space-y-1.5 pt-1">
              <StatusIndicator up={clusterMetrics?.apiServerUp ?? true} label="API Server" />
              <StatusIndicator up={clusterMetrics?.schedulerUp ?? true} label="Scheduler" />
              <StatusIndicator up={clusterMetrics?.etcdUp ?? true} label="etcd" />
            </div>
          </CardHeader>
          {clusterMetrics?.apiServerLatencyP99Ms !== undefined &&
            clusterMetrics.apiServerLatencyP99Ms > 0 && (
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  API P99 latency:{' '}
                  <span className="font-mono font-medium">
                    {clusterMetrics.apiServerLatencyP99Ms.toFixed(1)} ms
                  </span>
                </p>
              </CardContent>
            )}
        </Card>
      </div>

      {/* ── Row 2: Time-series charts ── */}
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
        <TimeSeriesChart
          title="CPU Usage %"
          description={`Cluster-wide CPU utilization over last ${timeRange}`}
          data={resourceUsage?.cpu ?? []}
          isLoading={loadingUsage}
          color="#6366f1"
          formatValue={(v) => `${v.toFixed(1)}%`}
        />
        <TimeSeriesChart
          title="Memory Usage %"
          description={`Cluster-wide memory utilization over last ${timeRange}`}
          data={resourceUsage?.memory ?? []}
          isLoading={loadingUsage}
          color="#10b981"
          formatValue={(v) => `${v.toFixed(1)}%`}
        />
      </div>

      {/* ── Row 3: Network charts ── */}
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
        <TimeSeriesChart
          title="Network In (bytes/s)"
          description="Cluster-wide inbound network traffic"
          data={resourceUsage?.networkIn ?? []}
          isLoading={loadingUsage}
          color="#3b82f6"
          formatValue={(v) => fmtBytes(v) + '/s'}
        />
        <TimeSeriesChart
          title="Network Out (bytes/s)"
          description="Cluster-wide outbound network traffic"
          data={resourceUsage?.networkOut ?? []}
          isLoading={loadingUsage}
          color="#f59e0b"
          formatValue={(v) => fmtBytes(v) + '/s'}
        />
      </div>

      {/* ── Row 4: Namespace + Filesystem ── */}
      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-2">
        <NamespaceMetricsSection />
        <NodeFilesystemSection />
      </div>
    </div>
  )
}
