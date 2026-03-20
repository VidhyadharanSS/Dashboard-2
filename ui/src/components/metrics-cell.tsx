import { useCallback, useMemo } from 'react'

import { MetricsData } from '@/types/api'
import { formatMemory } from '@/lib/utils'

import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

export function MetricCell({
  metrics,
  type,
  limitLabel = 'Limit',
  showPercentage = false,
  useRequestBasedUsage = false,
}: {
  metrics?: MetricsData
  type: 'cpu' | 'memory' | 'gpu'
  limitLabel?: string // e.g., "Limit" or "Capacity"
  showPercentage?: boolean // Whether to show percentage in the display
  useRequestBasedUsage?: boolean // Whether to use request for the main progress bar (e.g., for GPU allocation)
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
    // If useRequestBasedUsage is true, the main percentage is based on request (allocation) vs limit (capacity)
    // Otherwise, it's usage vs limit
    const mainValue = useRequestBasedUsage ? (metricRequest || 0) : metricValue

    const percentage = metricLimit
      ? Math.min((mainValue / metricLimit) * 100, 100)
      : 0

    // Secondary marker logic (if any)
    // If we are showing usage as main bar, then request is the marker (original behavior)
    // If we are showing request as main bar, maybe verify if we need to show usage as marker? 
    // For GPU specifically, usage is often 0 or not useful to show as a marker if main bar is request.
    // Let's keep the marker logic as is for CPU/Memory (request vs limit marker), 
    // but for GPU/RequestBased, we might not need a secondary marker if request IS the main bar.



    const getProgressColor = () => {
      if (percentage > 90) return 'bg-red-500'
      if (percentage > 60) return 'bg-yellow-500'
      return 'bg-blue-500'
    }

    return (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-14 h-2 relative">
              {/* Main Progress Bar Track */}
              <div className="w-full bg-secondary/50 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${useRequestBasedUsage ? 'bg-blue-500' : getProgressColor()
                    }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Secondary Marker */}
              {((useRequestBasedUsage ? metricValue : metricRequest) ?? 0) > 0 && metricLimit && (
                <div
                  className="absolute -top-0.5 h-3 flex items-center justify-center pointer-events-none"
                  style={{
                    left: `${Math.min(
                      (((useRequestBasedUsage ? metricValue : (metricRequest || 0)) / metricLimit) * 100),
                      100
                    )}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="w-0.5 h-3 bg-foreground/50 rounded-sm shadow-sm"></div>
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-sm grid grid-cols-2 gap-x-3 gap-y-0.5 min-w-0">
              <span>Usage:</span>
              <span className="text-right">{formatValue(metricValue)}</span>
              <span>Request:</span>
              <span className="text-right">{formatValue(metricRequest)}</span>
              <span>{limitLabel}:</span>
              <span className="text-right">{formatValue(metricLimit)}</span>
            </div>
          </TooltipContent>
        </Tooltip>
        <span
          className={`${type === 'cpu' ? 'w-[4ch]' : type === 'memory' ? 'w-[10ch]' : 'w-[2ch]'} text-right inline-block text-xs text-muted-foreground whitespace-nowrap tabular-nums`}
        >
          {formatValue(mainValue)}
          {(showPercentage && metricLimit && (mainValue > 0 || useRequestBasedUsage)) && (
            <span className="hidden 2xl:inline text-[10px] opacity-70 ml-1">
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
