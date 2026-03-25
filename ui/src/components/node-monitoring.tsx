import { useState } from 'react'
import {
  Activity,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { useResourceUsageHistory } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import CPUUsageChart from './chart/cpu-usage-chart'
import MemoryUsageChart from './chart/memory-usage-chart'
import NetworkUsageChart from './chart/network-usage-chart'

interface NodeMonitoringProps {
  name: string
}

function getLatestValue(data?: { timestamp: string; value: number }[]): number {
  if (!data || data.length === 0) return 0
  return data[data.length - 1]?.value ?? 0
}

function fmtPct(v: number) {
  return `${Math.min(v, 100).toFixed(1)}%`
}

function fmtBytes(bps: number): string {
  if (bps === 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bps) / Math.log(1024))
  return `${(bps / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

interface MetricPillProps {
  icon: React.ElementType
  label: string
  value: string
  color: string
  bgColor: string
  pct?: number
}

function MetricPill({ icon: Icon, label, value, color, bgColor, pct }: MetricPillProps) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border border-border/50 ${bgColor} group hover:shadow-sm transition-all duration-200`}>
      <div className={`p-2 rounded-lg bg-background/80 ${color} group-hover:scale-110 transition-transform duration-200`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
        <p className="text-sm font-bold tabular-nums">{value}</p>
        {pct !== undefined && (
          <div className="mt-1 h-1 rounded-full bg-background/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : color.replace('text-', 'bg-')
              }`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export function NodeMonitoring({ name }: NodeMonitoringProps) {
  const [timeRange, setTimeRange] = useState('1h')
  const [refreshInterval, setRefreshInterval] = useState(30 * 1000)
  const queryClient = useQueryClient()

  const {
    data: resourceUsage,
    isLoading,
    error,
  } = useResourceUsageHistory(timeRange, {
    instance: name,
    staleTime: 10000,
  })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['resource-usage-history', timeRange, name] })
  }

  const latestCPU = getLatestValue(resourceUsage?.cpu)
  const latestMem = getLatestValue(resourceUsage?.memory)
  const latestNetIn = getLatestValue(resourceUsage?.networkIn)
  const latestNetOut = getLatestValue(resourceUsage?.networkOut)

  return (
    <div className="space-y-5">
      {/* ── Header Bar ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Server className="size-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Node Monitoring</h3>
            <p className="text-[11px] text-muted-foreground">{name}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <Clock className="size-3 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: '30m', label: '30 min' },
                { value: '1h', label: '1 hour' },
                { value: '24h', label: '24 hours' },
              ].map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={refreshInterval.toString()} onValueChange={(v) => setRefreshInterval(Number(v))}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <RefreshCw className="size-3 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: '0', label: 'Off' },
                { value: '15000', label: '15s' },
                { value: '30000', label: '30s' },
                { value: '60000', label: '1m' },
              ].map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleRefresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Live Summary Pills ─────────────────────────────────────── */}
      {!isLoading && resourceUsage && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricPill
            icon={Cpu}
            label="CPU Utilization"
            value={fmtPct(latestCPU)}
            color="text-indigo-500"
            bgColor="bg-indigo-500/5"
            pct={latestCPU}
          />
          <MetricPill
            icon={MemoryStick}
            label="Memory Utilization"
            value={fmtPct(latestMem)}
            color="text-emerald-500"
            bgColor="bg-emerald-500/5"
            pct={latestMem}
          />
          <MetricPill
            icon={Network}
            label="Net In"
            value={fmtBytes(latestNetIn)}
            color="text-blue-500"
            bgColor="bg-blue-500/5"
          />
          <MetricPill
            icon={Network}
            label="Net Out"
            value={fmtBytes(latestNetOut)}
            color="text-amber-500"
            bgColor="bg-amber-500/5"
          />
        </div>
      )}

      {/* ── No data / not configured ─────────────────────────────── */}
      {!isLoading && !error && !resourceUsage && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Activity className="size-10 text-muted-foreground/30" />
            <CardTitle className="text-base">No metrics available</CardTitle>
            <CardDescription className="max-w-sm text-xs">
              Prometheus is not configured for this cluster. Configure a Prometheus URL
              in cluster settings to enable node-level metrics.
            </CardDescription>
          </CardContent>
        </Card>
      )}

      {/* ── Charts ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CPUUsageChart
          data={resourceUsage?.cpu || []}
          isLoading={isLoading}
          error={error}
          syncId="node-monitor"
        />
        <MemoryUsageChart
          data={resourceUsage?.memory || []}
          isLoading={isLoading}
          syncId="node-monitor"
        />
        <NetworkUsageChart
          networkIn={resourceUsage?.networkIn || []}
          networkOut={resourceUsage?.networkOut || []}
          isLoading={isLoading}
          syncId="node-monitor"
        />
      </div>
    </div>
  )
}
