import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Box,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  Gauge,
  HardDrive,
  Info,
  RefreshCw,
  Server,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  useClusterMetrics,
  useNamespaceMetrics,
  useNodeFilesystemMetrics,
  useOverview,
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
  return `${Math.min(pct, 100).toFixed(1)}%`
}

function getUtilColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#10b981'
}

function getUtilClass(pct: number): string {
  if (pct >= 90) return 'text-red-500 dark:text-red-400'
  if (pct >= 70) return 'text-amber-500 dark:text-amber-400'
  return 'text-emerald-500 dark:text-emerald-400'
}

// ─── Radial Gauge ─────────────────────────────────────────────────────────────

function RadialGauge({
  pct,
  label,
  value,
  sub,
}: {
  pct: number
  label: string
  value: string
  sub: string
}) {
  const r = 38
  const circ = 2 * Math.PI * r
  const dash = (Math.min(pct, 100) / 100) * circ * 0.75
  const gap = circ - dash
  const color = getUtilColor(pct)

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative size-24">
        <svg viewBox="0 0 100 100" className="size-full" style={{ transform: 'rotate(-225deg)' }}>
          <circle
            cx="50" cy="50" r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-muted/30"
            strokeDasharray={`${circ * 0.75} ${circ}`}
            strokeLinecap="round"
          />
          <circle
            cx="50" cy="50" r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${dash} ${gap + circ * 0.25}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.7s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-bold tabular-nums leading-none ${getUtilClass(pct)}`}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-sm font-bold tabular-nums">{value}</p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
}

// ─── Status LED ──────────────────────────────────────────────────────────────

function StatusLED({ up, label, latency }: { up: boolean; label: string; latency?: number }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/40">
      <div className="flex items-center gap-2">
        <div className={`size-2.5 rounded-full ${up ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'} ${up ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {latency !== undefined && latency > 0 && (
          <span className="text-[10px] text-muted-foreground font-mono">{latency.toFixed(1)}ms</span>
        )}
        {up
          ? <CheckCircle2 className="size-3.5 text-emerald-500" />
          : <XCircle className="size-3.5 text-red-500" />
        }
      </div>
    </div>
  )
}

function AlertBadge({ count, label, icon: Icon, severity }: {
  count: number
  label: string
  icon: React.ElementType
  severity: 'critical' | 'warning' | 'ok'
}) {
  const colors = {
    critical: 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
    ok: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  }
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl border ${colors[severity]}`}>
      <div className="flex items-center gap-2">
        <Icon className="size-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-xl font-bold tabular-nums">{count}</span>
    </div>
  )
}

// ─── Namespace Section ────────────────────────────────────────────────────────

function NamespaceSection() {
  const { data: nsMetrics, isLoading, error } = useNamespaceMetrics()

  const sorted = useMemo(
    () => [...(nsMetrics ?? [])].sort((a, b) => b.cpuUsage - a.cpuUsage).slice(0, 10),
    [nsMetrics]
  )

  const chartData = useMemo(() =>
    sorted.map((ns) => ({
      name: ns.namespace.length > 14 ? ns.namespace.slice(0, 12) + '…' : ns.namespace,
      fullName: ns.namespace,
      cpu: parseFloat(ns.cpuUsage.toFixed(4)),
      mem: parseFloat((ns.memUsage / 1024 / 1024 / 1024).toFixed(3)),
      pods: ns.podCount,
    })),
    [sorted]
  )

  if (error) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="size-4 text-purple-500" />
            Namespace Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">Prometheus not available</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-purple-500" />
            <CardTitle className="text-sm">Namespace Resource Breakdown</CardTitle>
          </div>
          <Badge variant="secondary" className="text-[10px]">Top {sorted.length}</Badge>
        </div>
        <CardDescription className="text-xs">CPU cores and memory (GiB) per namespace</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-52 bg-muted/30 rounded-xl animate-pulse" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No namespace data</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                formatter={(v: number, name: string) =>
                  name === 'cpu' ? [`${v.toFixed(3)} cores`, 'CPU'] : [`${v.toFixed(3)} GiB`, 'Memory']
                }
                labelFormatter={(_: string, payload: { payload?: { fullName?: string } }[] = []) => payload?.[0]?.payload?.fullName ?? _}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="cpu" name="CPU" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={20} />
              <Bar dataKey="mem" name="Memory (GiB)" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {!isLoading && sorted.length > 0 && (
          <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {sorted.map((ns) => {
              const maxCpu = sorted[0].cpuUsage || 1
              const cpuPct = (ns.cpuUsage / maxCpu) * 100
              return (
                <div key={ns.namespace} className="group flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <Link
                        to={`/pods?namespace=${ns.namespace}`}
                        className="font-medium truncate max-w-[140px] hover:text-primary hover:underline flex items-center gap-1"
                      >
                        {ns.namespace}
                        <ChevronRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                      <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                        <span className="font-mono">{fmtCores(ns.cpuUsage)}</span>
                        <span className="font-mono">{fmtBytes(ns.memUsage)}</span>
                        {ns.podCount > 0 && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                            {ns.podCount}p
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                        style={{ width: `${cpuPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Filesystem Section ───────────────────────────────────────────────────────

function FilesystemSection() {
  const { data: fsMetrics, isLoading, error } = useNodeFilesystemMetrics()

  const sorted = useMemo(
    () => [...(fsMetrics ?? [])].sort((a, b) => b.usedPercent - a.usedPercent),
    [fsMetrics]
  )

  if (error || (!isLoading && sorted.length === 0)) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="size-4 text-orange-500" />
            Node Disk Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            {error ? 'Prometheus not available' : 'No disk data available'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-orange-500" />
          <CardTitle className="text-sm">Node Disk Usage</CardTitle>
        </div>
        <CardDescription className="text-xs">Root filesystem usage per node</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {sorted.map((node) => {
              const pct = node.usedPercent
              const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981'
              const textColor = pct >= 90
                ? 'text-red-600 dark:text-red-400'
                : pct >= 75
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              return (
                <div key={node.node} className="p-2.5 rounded-xl bg-muted/20 border border-border/30 hover:border-border/60 transition-colors">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-medium truncate max-w-[200px] font-mono" title={node.node}>
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
        )}
      </CardContent>
    </Card>
  )
}

function PodDistributionSection({ runningPods, totalPods }: { runningPods: number; totalPods: number }) {
  const pending = Math.max(0, totalPods - runningPods)
  const data = [
    { name: 'Running', value: runningPods, fill: '#10b981' },
    { name: 'Other', value: pending, fill: '#6b7280' },
  ].filter((d) => d.value > 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Box className="size-4 text-blue-500" />
          <CardTitle className="text-sm">Pod Distribution</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <ResponsiveContainer width={100} height={100}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={28} outerRadius={44} paddingAngle={2} dataKey="value">
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-muted-foreground">Running</span>
            <span className="text-xs font-bold ml-auto tabular-nums">{runningPods}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-muted-foreground" />
            <span className="text-xs text-muted-foreground">Other</span>
            <span className="text-xs font-bold ml-auto tabular-nums">{pending}</span>
          </div>
          <div className="h-px bg-border/50 my-1" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Total</span>
            <span className="text-sm font-bold ml-auto tabular-nums">{totalPods}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PrometheusPage() {
  const queryClient = useQueryClient()
  const { data: overview } = useOverview()
  const promEnabled = overview?.prometheusEnabled ?? false

  const { data: cm, isLoading: loadingCluster, error: clusterError } = useClusterMetrics({ enabled: promEnabled })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cluster-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['namespace-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['node-filesystem-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['overview'] })
  }

  if (!promEnabled && overview !== undefined) {
    return (
      <div className="flex flex-col gap-6 animate-page-enter">
        <PageHeader onRefresh={handleRefresh} />
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="p-4 rounded-2xl bg-muted/50">
              <Activity className="size-12 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">Prometheus Not Configured</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-md">
                Configure a Prometheus URL for this cluster in cluster settings to enable real-time metrics.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/settings">Go to Cluster Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const cpuPct = cm?.cpuUsagePercent ?? 0
  const memPct = cm?.memUsagePercent ?? 0
  const restarts = cm?.containerRestarts1h ?? 0
  const oomKills = cm?.oomKills1h ?? 0

  return (
    <div className="flex flex-col gap-6 animate-page-enter">
      <PageHeader onRefresh={handleRefresh} />

      {clusterError && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertTriangle className="size-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Prometheus returned an error. Some metrics may be unavailable.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Row 1: Gauges + Component Health */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-primary" />
              <CardTitle className="text-sm">Cluster Utilization</CardTitle>
            </div>
            <CardDescription className="text-xs">Current resource usage across all nodes</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCluster ? (
              <div className="flex items-center justify-center h-32">
                <div className="h-24 w-24 rounded-full bg-muted/30 animate-pulse" />
              </div>
            ) : (
              <div className="flex items-center justify-around gap-4 flex-wrap">
                <RadialGauge pct={cpuPct} label="CPU" value={fmtCores(cm?.cpuUsageCores ?? 0)} sub={`of ${fmtCores(cm?.cpuTotalCores ?? 0)} cores`} />
                <RadialGauge pct={memPct} label="Memory" value={fmtBytes(cm?.memUsageBytes ?? 0)} sub={`of ${fmtBytes(cm?.memTotalBytes ?? 0)}`} />
                <div className="space-y-2 min-w-[120px]">
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">{cm?.runningPods ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Running Pods</p>
                    <p className="text-xs text-muted-foreground">of {cm?.totalPods ?? 0} total</p>
                  </div>
                  <div className="h-px bg-border/50" />
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className={`text-base font-bold tabular-nums ${restarts > 10 ? 'text-red-500' : restarts > 3 ? 'text-amber-500' : 'text-muted-foreground'}`}>{restarts}</p>
                      <p className="text-[9px] text-muted-foreground leading-tight">Restarts<br />1h</p>
                    </div>
                    <div>
                      <p className={`text-base font-bold tabular-nums ${oomKills > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>{oomKills}</p>
                      <p className="text-[9px] text-muted-foreground leading-tight">OOM<br />1h</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-green-500" />
              <CardTitle className="text-sm">Component Health</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatusLED up={cm?.apiServerUp ?? true} label="API Server" latency={cm?.apiServerLatencyP99Ms} />
            <StatusLED up={cm?.schedulerUp ?? true} label="Scheduler" />
            <StatusLED up={cm?.etcdUp ?? true} label="etcd" />
            <div className="pt-1 space-y-2">
              <AlertBadge
                count={restarts}
                label="Container Restarts (1h)"
                icon={restarts > 10 ? TrendingUp : restarts > 0 ? TrendingDown : CheckCircle2}
                severity={restarts > 10 ? 'critical' : restarts > 3 ? 'warning' : 'ok'}
              />
              <AlertBadge
                count={oomKills}
                label="OOM Kills (1h)"
                icon={oomKills > 0 ? Zap : CheckCircle2}
                severity={oomKills > 0 ? 'critical' : 'ok'}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Pod Distribution + Namespace */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <PodDistributionSection runningPods={cm?.runningPods ?? 0} totalPods={cm?.totalPods ?? 0} />
        <div className="md:col-span-2">
          <NamespaceSection />
        </div>
      </div>

      {/* Row 3: Filesystem */}
      <FilesystemSection />

      {/* Hint */}
      <Card className="border-dashed bg-muted/20">
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="size-5 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Per-workload monitoring lives in each resource's Monitor tab</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Navigate to any Deployment, StatefulSet, DaemonSet, Job, or Pod and click the{' '}
              <strong>Monitor</strong> tab for service-scoped metrics with an "All Pods" aggregate view
              and single-pod drill-down — all RBAC-scoped to your namespace access.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PageHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <BarChart3 className="size-5 text-primary" />
          </div>
          Cluster Metrics
        </h1>
        <p className="text-sm text-muted-foreground">Real-time cluster health &amp; resource utilization</p>
      </div>
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <UITooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={onRefresh}>
                <RefreshCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh all metrics</TooltipContent>
          </UITooltip>
        </TooltipProvider>
        <Badge variant="outline" className="text-xs gap-1.5">
          <Clock className="size-3" />
          Auto-refresh 30s
        </Badge>
      </div>
    </div>
  )
}
