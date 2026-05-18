import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Box,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
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
  Legend,
  AreaChart,
  Area,
} from 'recharts'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  useClusterMetrics,
  useNamespaceMetrics,
  useNodeFilesystemMetrics,
  useOverview,
  useResourceUsageHistory,
  useResources,
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
  if (!bytes || !isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function fmtCores(cores: number): string {
  if (!cores || !isFinite(cores) || cores <= 0) return '0m'
  if (cores < 1) return `${Math.round(cores * 1000)}m`
  return `${cores.toFixed(2)}`
}

function fmtPct(pct: number): string {
  if (!isFinite(pct)) return '0.0%'
  return `${Math.min(Math.max(pct, 0), 100).toFixed(1)}%`
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
  icon: Icon,
}: {
  pct: number
  label: string
  value: string
  sub: string
  icon?: React.ElementType
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
          {Icon && <Icon className="size-3.5 text-muted-foreground mb-0.5" />}
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

// ─── Resource History Chart ──────────────────────────────────────────────────

function ResourceHistorySection() {
  const [duration, setDuration] = useState('1h')
  const durations = [
    { label: '1h', value: '1h' },
    { label: '6h', value: '6h' },
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
  ]
  const { data: history, isLoading, error } = useResourceUsageHistory(duration, { enabled: true })

  const chartData = useMemo(() => {
    if (!history?.cpu || !history?.memory) return []
    return history.cpu
      .map((cpu, i) => ({
        time: new Date(cpu.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          ...(duration === '7d' ? { day: '2-digit', month: 'short' } : {}),
        }),
        cpu: isFinite(cpu.value) ? parseFloat(Math.max(0, cpu.value).toFixed(3)) : 0,
        mem: history.memory[i] && isFinite(history.memory[i].value)
          ? parseFloat(Math.max(0, history.memory[i].value / 1024 / 1024 / 1024).toFixed(2))
          : 0,
      }))
      .filter((d) => d.cpu > 0 || d.mem > 0)
  }, [history, duration])

  if (error) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="size-4 text-blue-500" />
            Resource Usage History
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
            <TrendingUp className="size-4 text-blue-500" />
            <CardTitle className="text-sm">Resource Usage History</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {durations.map((d) => (
              <Button
                key={d.value}
                variant={duration === d.value ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setDuration(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
        <CardDescription className="text-xs">CPU (cores) and memory (GiB) over time</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-52 bg-muted/30 rounded-xl animate-pulse" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No history data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
              <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                formatter={(v: number, name: string) =>
                  name === 'cpu' ? [`${v.toFixed(3)} cores`, 'CPU'] : [`${v.toFixed(2)} GiB`, 'Memory']
                }
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Area type="monotone" dataKey="cpu" name="CPU" stroke="#6366f1" fill="url(#cpuGradient)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="mem" name="Memory (GiB)" stroke="#10b981" fill="url(#memGradient)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Node Comparison Table ───────────────────────────────────────────────────

function NodeComparisonSection() {
  const { data: nodesRaw } = useResources('nodes', undefined, { staleTime: 15000, refreshInterval: 30000 })
  type NodeItem = { name: string; node: any; metrics: any }

  const [sortField, setSortField] = useState<'name' | 'cpu' | 'mem' | 'pods'>('cpu')
  const [sortAsc, setSortAsc] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const DEFAULT_VISIBLE = 5

  const nodes: NodeItem[] = useMemo(() => {
    if (!nodesRaw) return []
    return (nodesRaw as any[]).map((n: any) => ({
      name: n.node?.metadata?.name || n.metadata?.name || '?',
      node: n.node || n,
      metrics: n.metrics || {},
    }))
  }, [nodesRaw])

  const sorted = useMemo(() => {
    const arr = [...nodes]
    arr.sort((a, b) => {
      let va = 0, vb = 0
      if (sortField === 'name') {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
      }
      if (sortField === 'cpu') {
        va = (a.metrics.cpuLimit > 0 && isFinite(a.metrics.cpuUsage)) ? (a.metrics.cpuUsage / a.metrics.cpuLimit) * 100 : 0
        vb = (b.metrics.cpuLimit > 0 && isFinite(b.metrics.cpuUsage)) ? (b.metrics.cpuUsage / b.metrics.cpuLimit) * 100 : 0
      } else if (sortField === 'mem') {
        va = (a.metrics.memoryLimit > 0 && isFinite(a.metrics.memoryUsage)) ? (a.metrics.memoryUsage / a.metrics.memoryLimit) * 100 : 0
        vb = (b.metrics.memoryLimit > 0 && isFinite(b.metrics.memoryUsage)) ? (b.metrics.memoryUsage / b.metrics.memoryLimit) * 100 : 0
      } else if (sortField === 'pods') {
        va = a.metrics.pods || 0
        vb = b.metrics.pods || 0
      }
      return sortAsc ? va - vb : vb - va
    })
    return arr
  }, [nodes, sortField, sortAsc])

  const visibleNodes = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE)
  const hasMore = sorted.length > DEFAULT_VISIBLE

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc(!sortAsc)
    else { setSortField(field); setSortAsc(false) }
  }

  if (nodes.length === 0) return null

  // Compute cluster-wide averages
  const avgCpu = nodes.length > 0
    ? nodes.reduce((sum, n) => sum + (n.metrics.cpuLimit > 0 ? (n.metrics.cpuUsage / n.metrics.cpuLimit) * 100 : 0), 0) / nodes.length
    : 0
  const avgMem = nodes.length > 0
    ? nodes.reduce((sum, n) => sum + (n.metrics.memoryLimit > 0 ? (n.metrics.memoryUsage / n.metrics.memoryLimit) * 100 : 0), 0) / nodes.length
    : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-violet-500" />
            <CardTitle className="text-sm">Node Resource Comparison</CardTitle>
            <Badge variant="secondary" className="text-[10px] h-5">{nodes.length} nodes</Badge>
          </div>
          <Link to="/nodes">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1">
              View all <ChevronRight className="size-3" />
            </Button>
          </Link>
        </div>
        <CardDescription className="text-xs">Per-node CPU, memory, and pod allocation</CardDescription>
        {/* Cluster averages summary bar */}
        <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-xs">
            <Cpu className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">Avg CPU:</span>
            <span className={`font-bold tabular-nums ${getUtilClass(avgCpu)}`}>{fmtPct(avgCpu)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <MemoryStick className="size-3 text-muted-foreground" />
            <span className="text-muted-foreground">Avg Memory:</span>
            <span className={`font-bold tabular-nums ${getUtilClass(avgMem)}`}>{fmtPct(avgMem)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border/40">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  <div className="flex items-center gap-1">Node <ArrowUpDown className="size-3" /></div>
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('cpu')}>
                  <div className="flex items-center gap-1"><Cpu className="size-3" /> CPU <ArrowUpDown className="size-3" /></div>
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('mem')}>
                  <div className="flex items-center gap-1"><MemoryStick className="size-3" /> Memory <ArrowUpDown className="size-3" /></div>
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('pods')}>
                  <div className="flex items-center gap-1"><Box className="size-3" /> Pods <ArrowUpDown className="size-3" /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleNodes.map((n) => {
                const m = n.metrics
                const cpuPct = m.cpuLimit > 0 ? (m.cpuUsage / m.cpuLimit) * 100 : 0
                const memPct = m.memoryLimit > 0 ? (m.memoryUsage / m.memoryLimit) * 100 : 0
                const podPct = m.podsLimit > 0 ? (m.pods / m.podsLimit) * 100 : 0
                return (
                  <tr key={n.name} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
                    <td className="py-1.5 px-3">
                      <Link to={`/nodes/_all/${n.name}`} className="font-mono text-[11px] font-medium text-primary hover:underline truncate max-w-[150px] block">
                        {n.name}
                      </Link>
                    </td>
                    <td className="py-1.5 px-3">
                      <div className="space-y-0.5 min-w-[120px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {fmtCores(m.cpuUsage / 1000)}/{fmtCores(m.cpuLimit / 1000)}
                          </span>
                          <span className={`text-[11px] font-bold tabular-nums ${getUtilClass(cpuPct)}`}>{fmtPct(cpuPct)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(cpuPct, 100)}%`, backgroundColor: getUtilColor(cpuPct) }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-1.5 px-3">
                      <div className="space-y-0.5 min-w-[120px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {fmtBytes(m.memoryUsage)}/{fmtBytes(m.memoryLimit)}
                          </span>
                          <span className={`text-[11px] font-bold tabular-nums ${getUtilClass(memPct)}`}>{fmtPct(memPct)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(memPct, 100)}%`, backgroundColor: getUtilColor(memPct) }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-1.5 px-3">
                      <div className="space-y-0.5 min-w-[60px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground font-mono">{m.pods || 0}/{m.podsLimit || '?'}</span>
                          <span className={`text-[11px] font-bold tabular-nums ${getUtilClass(podPct)}`}>{m.podsLimit > 0 ? fmtPct(podPct) : '-'}</span>
                        </div>
                        {m.podsLimit > 0 && (
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(podPct, 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Show more / collapse button */}
        {hasMore && (
          <div className="flex justify-center py-2 border-t border-border/30">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? (
                <>
                  <TrendingDown className="size-3" />
                  Show top {DEFAULT_VISIBLE} only
                </>
              ) : (
                <>
                  <TrendingUp className="size-3" />
                  Show all {sorted.length} nodes
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {sorted.map((node) => {
              const pct = node.usedPercent
              const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981'
              const textColor = pct >= 90
                ? 'text-red-600 dark:text-red-400'
                : pct >= 75
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              return (
                <div key={node.node} className="p-2.5 rounded-lg bg-muted/20 border border-border/30 hover:border-border/60 transition-colors overflow-hidden">
                  <div className="flex items-center justify-between text-xs mb-1.5 gap-2 min-w-0">
                    <Link to={`/nodes/_all/${node.node}`} className="font-medium font-mono text-[11px] hover:text-primary hover:underline truncate min-w-0 shrink" title={node.node}>
                      {node.node}
                    </Link>
                    <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                      <span className="text-muted-foreground whitespace-nowrap">
                        {fmtBytes(node.usedBytes)}/{fmtBytes(node.totalBytes)}
                      </span>
                      <span className={`font-bold tabular-nums whitespace-nowrap ${textColor}`}>
                        {fmtPct(pct)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
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
    queryClient.invalidateQueries({ queryKey: ['resource-usage-history'] })
    queryClient.invalidateQueries({ queryKey: ['overview'] })
    queryClient.invalidateQueries({ queryKey: ['nodes'] })
  }

  // Show loading skeleton until we know if prometheus is configured
  if (overview === undefined) {
    return (
      <div className="flex flex-col gap-6 animate-page-enter">
        <PageHeader onRefresh={handleRefresh} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 h-48 bg-muted/30 rounded-xl animate-pulse" />
          <div className="h-48 bg-muted/30 rounded-xl animate-pulse" />
        </div>
      </div>
    )
  }

  if (!promEnabled) {
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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
              <div className="flex items-center justify-around gap-6 flex-wrap">
                <RadialGauge pct={cpuPct} label="CPU" value={fmtCores(cm?.cpuUsageCores ?? 0)} sub={`of ${fmtCores(cm?.cpuTotalCores ?? 0)} cores`} icon={Cpu} />
                <RadialGauge pct={memPct} label="Memory" value={fmtBytes(cm?.memUsageBytes ?? 0)} sub={`of ${fmtBytes(cm?.memTotalBytes ?? 0)}`} icon={MemoryStick} />
                <div className="space-y-3 min-w-[130px]">
                  <div className="text-center p-3 rounded-xl bg-muted/20 border border-border/30">
                    <p className="text-2xl font-bold tabular-nums">{cm?.runningPods ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Running Pods</p>
                    <p className="text-xs text-muted-foreground">of {cm?.totalPods ?? 0} total</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="p-2 rounded-lg bg-muted/10 border border-border/20">
                      <p className={`text-base font-bold tabular-nums ${restarts > 10 ? 'text-red-500' : restarts > 3 ? 'text-amber-500' : 'text-muted-foreground'}`}>{restarts}</p>
                      <p className="text-[9px] text-muted-foreground leading-tight">Restarts 1h</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/10 border border-border/20">
                      <p className={`text-base font-bold tabular-nums ${oomKills > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>{oomKills}</p>
                      <p className="text-[9px] text-muted-foreground leading-tight">OOM 1h</p>
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
            <div className="pt-2 space-y-2">
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

      {/* Row 2: Resource Usage History */}
      <ResourceHistorySection />

      {/* Row 3: Namespace Breakdown + Filesystem side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <NamespaceSection />
        <FilesystemSection />
      </div>

      {/* Row 4: Node Comparison (full width, collapsible) */}
      <NodeComparisonSection />
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
