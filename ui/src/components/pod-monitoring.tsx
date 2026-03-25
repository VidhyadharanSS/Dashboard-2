import { useMemo, useState } from 'react'
import { Container, Pod } from 'kubernetes-types/core/v1'
import {
  Activity,
  AlertCircle,
  BarChart3,
  Clock,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  Network,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { usePodMetrics, useWorkloadMetrics } from '@/lib/api'
import { toSimpleContainer } from '@/lib/k8s'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ContainerSelector } from '@/components/selector/container-selector'

import CPUUsageChart from './chart/cpu-usage-chart'
import DiskIOUsageChart from './chart/disk-io-usage-chart'
import MemoryUsageChart from './chart/memory-usage-chart'
import NetworkUsageChart from './chart/network-usage-chart'
import { PodSelector } from './selector/pod-selector'

interface PodMonitoringProps {
  namespace: string
  podName?: string
  defaultQueryName?: string
  pods?: Pod[]
  containers?: Container[]
  initContainers?: Container[]
  labelSelector?: string
}

// ─── Metric Summary Card ─────────────────────────────────────────────────────

interface MetricSummaryProps {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  color: string
  bgColor: string
}

function MetricSummary({ icon: Icon, label, value, sub, color, bgColor }: MetricSummaryProps) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border border-border/50 ${bgColor} group hover:shadow-sm transition-all duration-200`}>
      <div className={`p-2 rounded-lg bg-background/80 ${color} group-hover:scale-110 transition-transform duration-200`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
        <p className="text-sm font-bold tabular-nums truncate">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  )
}

function getLatestValue(data?: { timestamp: string; value: number }[]): number {
  if (!data || data.length === 0) return 0
  return data[data.length - 1]?.value ?? 0
}

function formatCPUCores(cores: number): string {
  if (cores < 0.001) return '0m'
  if (cores < 1) return `${Math.round(cores * 1000)}m`
  return `${cores.toFixed(3)}`
}

function formatMemMB(mb: number): string {
  if (mb < 1) return '0 MB'
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GiB`
  return `${mb.toFixed(0)} MiB`
}

function formatBytesPerSec(bps: number): string {
  if (bps === 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bps) / Math.log(1024))
  return `${(bps / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PodMonitoring({
  namespace,
  podName,
  defaultQueryName,
  pods,
  containers: _containers = [],
  initContainers = [],
  labelSelector,
}: PodMonitoringProps) {
  const containers = useMemo(() => {
    return toSimpleContainer(initContainers, _containers)
  }, [_containers, initContainers])

  const [selectedPod, setSelectedPod] = useState<string | undefined>(podName || undefined)
  const [timeRange, setTimeRange] = useState('30m')
  const [selectedContainer, setSelectedContainer] = useState<string | undefined>(undefined)
  const [refreshInterval, setRefreshInterval] = useState(30 * 1000)
  const [mode, setMode] = useState<'workload' | 'pod'>('workload')

  const queryClient = useQueryClient()

  const queryPodName = useMemo(() => {
    return (
      selectedPod ||
      podName ||
      defaultQueryName ||
      pods?.[0]?.metadata?.generateName?.split('-').slice(0, -2).join('-') ||
      ''
    )
  }, [selectedPod, podName, defaultQueryName, pods])

  // Workload-wide metrics (uses labelSelector, namespace scoped)
  const {
    data: workloadData,
    isLoading: workloadLoading,
    error: workloadError,
  } = useWorkloadMetrics(namespace, timeRange, {
    labelSelector,
    container: selectedContainer,
    refreshInterval,
    enabled: mode === 'workload' && !!labelSelector,
  })

  // Per-pod metrics
  const {
    data: podData,
    isLoading: podLoading,
    error: podError,
  } = usePodMetrics(namespace, queryPodName, timeRange, {
    container: selectedContainer,
    refreshInterval,
    labelSelector: mode === 'pod' ? labelSelector : undefined,
    enabled: mode === 'pod' || !labelSelector,
  })

  const activeData = (mode === 'workload' && labelSelector) ? workloadData : podData
  const isLoading = (mode === 'workload' && labelSelector) ? workloadLoading : podLoading
  const error = (mode === 'workload' && labelSelector) ? workloadError : podError

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['workload-metrics', namespace] })
    queryClient.invalidateQueries({ queryKey: ['pod-metrics', namespace] })
  }

  // Latest values for summary
  const latestCPU = getLatestValue(activeData?.cpu)
  const latestMem = getLatestValue(activeData?.memory)
  const latestNetIn = getLatestValue(activeData?.networkIn)
  const latestNetOut = getLatestValue(activeData?.networkOut)
  const latestDiskR = getLatestValue(activeData?.diskRead)
  const latestDiskW = getLatestValue(activeData?.diskWrite)

  const timeRangeOptions = [
    { value: '30m', label: '30 min' },
    { value: '1h', label: '1 hour' },
    { value: '24h', label: '24 hours' },
  ]

  const refreshIntervalOptions = [
    { value: '0', label: 'Off' },
    { value: '5000', label: '5s' },
    { value: '10000', label: '10s' },
    { value: '30000', label: '30s' },
    { value: '60000', label: '1m' },
  ]

  const hasPods = pods && pods.length > 0
  const isWorkloadMode = mode === 'workload' && !!labelSelector

  return (
    <div className="space-y-5">
      {/* ── Header Bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <BarChart3 className="size-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Resource Monitoring</h3>
            <p className="text-[11px] text-muted-foreground">
              {isWorkloadMode
                ? `All pods · ${namespace}`
                : queryPodName
                  ? `${queryPodName} · ${namespace}`
                  : namespace}
            </p>
          </div>
          {activeData?.fallback && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1">
                    <Info className="size-2.5" />
                    metrics-server
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Using metrics-server (limited history). Configure Prometheus for richer data.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mode toggle – only show when labelSelector is available */}
          {labelSelector && (
            <div className="flex items-center rounded-lg border border-border/60 overflow-hidden text-xs">
              <button
                onClick={() => setMode('workload')}
                className={`px-3 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${
                  mode === 'workload'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <Activity className="size-3" />
                All Pods
              </button>
              <button
                onClick={() => setMode('pod')}
                className={`px-3 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${
                  mode === 'pod'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <Zap className="size-3" />
                Single Pod
              </button>
            </div>
          )}

          {/* Time range */}
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <Clock className="size-3 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timeRangeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Refresh interval */}
          <Select value={refreshInterval.toString()} onValueChange={(v) => setRefreshInterval(Number(v))}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <RefreshCw className="size-3 mr-1 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {refreshIntervalOptions.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Container filter */}
          <ContainerSelector
            containers={containers}
            selectedContainer={selectedContainer}
            onContainerChange={setSelectedContainer}
          />

          {/* Pod selector – only in pod mode */}
          {mode === 'pod' && hasPods && pods!.length > 1 && (
            <PodSelector
              pods={pods!}
              showAllOption={true}
              selectedPod={selectedPod}
              onPodChange={setSelectedPod}
            />
          )}

          {/* Manual refresh */}
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={handleRefresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Live Metric Summary ─────────────────────────────────────────── */}
      {!isLoading && activeData && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricSummary
            icon={Cpu}
            label="CPU"
            value={formatCPUCores(latestCPU)}
            sub="cores"
            color="text-indigo-500"
            bgColor="bg-indigo-500/5"
          />
          <MetricSummary
            icon={MemoryStick}
            label="Memory"
            value={formatMemMB(latestMem)}
            sub="working set"
            color="text-emerald-500"
            bgColor="bg-emerald-500/5"
          />
          <MetricSummary
            icon={Network}
            label="Net In"
            value={formatBytesPerSec(latestNetIn)}
            sub="recv/s"
            color="text-blue-500"
            bgColor="bg-blue-500/5"
          />
          <MetricSummary
            icon={Network}
            label="Net Out"
            value={formatBytesPerSec(latestNetOut)}
            sub="tx/s"
            color="text-amber-500"
            bgColor="bg-amber-500/5"
          />
          <MetricSummary
            icon={HardDrive}
            label="Disk Read"
            value={formatBytesPerSec(latestDiskR)}
            sub="read/s"
            color="text-purple-500"
            bgColor="bg-purple-500/5"
          />
          <MetricSummary
            icon={HardDrive}
            label="Disk Write"
            value={formatBytesPerSec(latestDiskW)}
            sub="write/s"
            color="text-rose-500"
            bgColor="bg-rose-500/5"
          />
        </div>
      )}

      {/* ── Error State ─────────────────────────────────────────────────── */}
      {error && !isLoading && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="size-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">Failed to load metrics</p>
              <p className="text-xs text-muted-foreground mt-0.5">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Charts ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CPUUsageChart
          data={activeData?.cpu || []}
          isLoading={isLoading}
          syncId="workload-monitor"
          error={error}
        />
        <MemoryUsageChart
          data={activeData?.memory || []}
          isLoading={isLoading}
          syncId="workload-monitor"
        />
        <NetworkUsageChart
          networkIn={activeData?.networkIn || []}
          networkOut={activeData?.networkOut || []}
          isLoading={isLoading}
          syncId="workload-monitor"
        />
        <DiskIOUsageChart
          diskRead={activeData?.diskRead || []}
          diskWrite={activeData?.diskWrite || []}
          isLoading={isLoading}
          syncId="workload-monitor"
        />
      </div>

      {/* ── Empty / no prometheus note ───────────────────────────────── */}
      {!isLoading && !error && !activeData && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <BarChart3 className="size-10 text-muted-foreground/30" />
            <CardTitle className="text-base">No metrics available</CardTitle>
            <CardDescription className="max-w-sm text-xs">
              Prometheus is not configured or no data is available for this workload yet.
              Configure a Prometheus URL in cluster settings to enable historical metrics.
            </CardDescription>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
