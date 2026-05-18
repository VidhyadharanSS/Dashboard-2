import { useCallback, useMemo } from 'react'

import { MetricsData } from '@/types/api'
import { formatMemory } from '@/lib/utils'

import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

// Color tiers: returns both the progress bar color and a text color for the percentage.
// All text colors use dark: variants to ensure sufficient contrast in every theme.
function getTierColors(pct: number): { bar: string; text: string; bg: string; label: string } {
  if (pct >= 95) return { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', label: 'Critical' }
  if (pct >= 80) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', label: 'Warning' }
  if (pct >= 60) return { bar: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-500/10', label: 'Moderate' }
  return { bar: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', label: 'Healthy' }
}

export function MetricCell({
  metrics,
  type,
  limitLabel = 'Limit',
  showPercentage = false,
  useRequestBasedUsage = false,
}: {
  metrics?: MetricsData
  type: 'cpu' | 'memory' | 'gpu'
  limitLabel?: string
  showPercentage?: boolean
  useRequestBasedUsage?: boolean
}) {
  const metricValue =
    type === 'cpu'
      ? metrics?.cpuUsage || 0
      : type === 'memory'
        ? metrics?.memoryUsage || 0
        : metrics?.gpuUsage || 0

  const metricLimit =
    type === 'cpu'
      ? metrics?.cpuLimit
      : type === 'memory'
        ? metrics?.memoryLimit
        : metrics?.gpuLimit

  const metricRequest =
    type === 'cpu'
      ? metrics?.cpuRequest
      : type === 'memory'
        ? metrics?.memoryRequest
        : metrics?.gpuRequest

  const formatValue = useCallback(
    (val?: number) => {
      if (val === undefined || val === null) return '-'
      if (type === 'cpu') return `${val}m`
      if (type === 'memory') return formatMemory(val)
      return `${val}`
    },
    [type]
  )

  return useMemo(() => {
    const mainValue = useRequestBasedUsage ? (metricRequest || 0) : metricValue

    const percentage = metricLimit
      ? Math.min((mainValue / metricLimit) * 100, 100)
      : 0

    const usagePct = metricLimit
      ? Math.min((metricValue / metricLimit) * 100, 100)
      : 0

    const requestPct = metricLimit && metricRequest
      ? Math.min((metricRequest / metricLimit) * 100, 100)
      : 0

    const tier = getTierColors(percentage)

    // Determine secondary marker position (request when showing usage, usage when showing request)
    const markerPct = useRequestBasedUsage ? usagePct : requestPct
    const showMarker = markerPct > 0 && metricLimit && Math.abs(markerPct - percentage) > 3

    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-12 shrink-0 h-2.5 relative cursor-default group/metric">
              {/* Track */}
              <div className="w-full bg-secondary/40 rounded-full h-2.5 overflow-hidden border border-border/30">
                {/* Main progress fill */}
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${useRequestBasedUsage ? 'bg-blue-500/80' : tier.bar}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Secondary marker (request or usage) */}
              {showMarker && (
                <div
                  className="absolute top-0 h-2.5 flex items-center justify-center pointer-events-none"
                  style={{
                    left: `${Math.min(markerPct, 98)}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="w-[2px] h-2.5 bg-foreground/40 rounded-sm" />
                </div>
              )}

              {/* Hover overlay showing exact position */}
              <div className="absolute inset-0 rounded-full opacity-0 group-hover/metric:opacity-100 transition-opacity ring-1 ring-primary/30" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="p-0 overflow-hidden">
            <div className="min-w-[180px]">
              {/* Header with tier color */}
              <div className={`px-3 py-1.5 ${tier.bg} border-b border-border/50`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${tier.text}`}>
                    {type.toUpperCase()} — {tier.label}
                  </span>
                  <span className={`text-sm font-bold tabular-nums ${tier.text}`}>
                    {percentage.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Metrics breakdown */}
              <div className="px-3 py-2 space-y-1.5">
                {/* Usage row */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${tier.bar}`} />
                    <span className="text-muted-foreground">Usage</span>
                  </div>
                  <span className="font-mono font-medium tabular-nums text-foreground">{formatValue(metricValue)}</span>
                </div>

                {/* Request row */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-foreground/30 border border-foreground/40" />
                    <span className="text-muted-foreground">Request</span>
                  </div>
                  <span className="font-mono font-medium tabular-nums text-foreground">{formatValue(metricRequest)}</span>
                </div>

                {/* Limit row */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm border-2 border-muted-foreground/40" />
                    <span className="text-muted-foreground">{limitLabel}</span>
                  </div>
                  <span className="font-mono font-medium tabular-nums text-foreground">{formatValue(metricLimit)}</span>
                </div>

                {/* Over-provisioned / Under-provisioned indicator */}
                {metricRequest !== undefined && metricLimit !== undefined && metricRequest > 0 && metricLimit > 0 && (
                  <div className="pt-1 border-t border-border/50">
                    {metricValue > metricRequest ? (
                      <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 9v4m0 4h.01M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
                        </svg>
                        Usage exceeds request by {formatValue(metricValue - metricRequest)}
                      </div>
                    ) : metricRequest > metricLimit * 0.8 ? (
                      <div className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                        </svg>
                        Request near {limitLabel.toLowerCase()} ({requestPct.toFixed(0)}%)
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Formatted value + optional percentage */}
        <span
          className="text-right inline-block text-xs text-muted-foreground whitespace-nowrap tabular-nums truncate min-w-0 shrink"
        >
          {formatValue(mainValue)}
          {(showPercentage && metricLimit && (mainValue > 0 || useRequestBasedUsage)) && (
            <span className={`text-[10px] ml-0.5 font-medium ${tier.text}`}>
              ({percentage.toFixed(0)}%)
            </span>
          )}
        </span>
      </div>
    )
  }, [
    metricLimit,
    metricValue,
    metricRequest,
    formatValue,
    limitLabel,
    type,
    showPercentage,
    useRequestBasedUsage,
  ])
}

