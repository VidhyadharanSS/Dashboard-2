// API service for Kubernetes resources

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pod } from 'kubernetes-types/core/v1'

import {
  APIKey,
  AuditLogResponse,
  Cluster,
  ClusterMetrics,
  FetchUserListResponse,
  ImageTagInfo,
  NamespaceMetrics,
  NodeFilesystemMetrics,
  OAuthProvider,
  OverviewData,
  PodMetrics,
  TopologyResponse,
  ResourceHistory,
  ResourceHistoryResponse,
  ResourcesTypeMap,
  ResourceTemplate,
  ResourceType,
  ResourceTypeMap,
  ResourceUsageHistory,
  Role,
  UserItem,
  clusterScopeResources,
} from '@/types/api'

import { API_BASE_URL, apiClient } from './api-client'
import { getWebSocketUrl, withSubPath } from './subpath'
import useWebSocket, { WebSocketMessage } from './useWebSocket'

type ResourcesItems<T extends ResourceType> = ResourcesTypeMap[T]['items']

// Pagination result type
export interface PaginatedResult<T> {
  items: T
  pagination: {
    hasNextPage: boolean
    nextContinueToken?: string
    remainingItems?: number
  }
}

// Generic fetch function with error handling
async function fetchAPI<T>(endpoint: string): Promise<T> {
  try {
    return await apiClient.get<T>(`${endpoint}`)
  } catch (error: unknown) {
    console.error('API request failed:', error)
    throw error
  }
}

export const fetchResources = <T>(
  resource: string,
  namespace?: string,
  opts?: {
    limit?: number
    continueToken?: string
    labelSelector?: string
    fieldSelector?: string
    reduce?: boolean
  }
): Promise<T> => {
  let endpoint = namespace ? `/${resource}/${namespace}` : `/${resource}`
  const params = new URLSearchParams()

  if (opts?.limit) {
    params.append('limit', opts.limit.toString())
  }
  if (opts?.continueToken) {
    params.append('continue', opts.continueToken)
  }
  if (opts?.labelSelector) {
    params.append('labelSelector', opts.labelSelector)
  }
  if (opts?.fieldSelector) {
    params.append('fieldSelector', opts.fieldSelector)
  }
  if (opts?.reduce) {
    params.append('reduce', 'true')
  }

  if (params.toString()) {
    endpoint += `?${params.toString()}`
  }

  return fetchAPI<T>(endpoint)
}

// Search API types
export interface SearchResult {
  id: string
  name: string
  namespace?: string
  resourceType: string
  createdAt: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
}

// Global search API
export const globalSearch = async (
  query: string,
  options?: {
    limit?: number
    namespace?: string
  }
): Promise<SearchResponse> => {
  if (query.length < 2) {
    return { results: [], total: 0 }
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(options?.limit || 50),
  })

  if (options?.namespace) {
    params.append('namespace', options.namespace)
  }

  const endpoint = `/search?${params.toString()}`
  return fetchAPI<SearchResponse>(endpoint)
}

// Scale deployment API
export const scaleDeployment = async (
  namespace: string,
  name: string,
  replicas: number
): Promise<{ message: string; deployment: unknown; replicas: number }> => {
  const endpoint = `/deployments/${namespace}/${name}/scale`
  const response = await apiClient.put<{
    message: string
    deployment: unknown
    replicas: number
  }>(endpoint, {
    replicas,
  })

  return response
}

// Restart resource API
export const restartResource = async (
  resource: ResourceType,
  namespace: string,
  name: string
): Promise<{ message: string }> => {
  const endpoint = `/${resource}/${namespace}/${name}/restart`
  return await apiClient.post(endpoint)
}

export const restartDeployment = (namespace: string, name: string) =>
  restartResource('deployments', namespace, name)

export const restartStatefulSet = (namespace: string, name: string) =>
  restartResource('statefulsets', namespace, name)

// Node operation APIs
export const updateResource = async <T extends ResourceType>(
  resource: T,
  name: string,
  namespace: string | undefined,
  body: ResourceTypeMap[T]
): Promise<void> => {
  const endpoint = `/${resource}/${namespace || '_all'}/${name}`
  await apiClient.put(`${endpoint}`, body)
}

export const resizePod = async (
  namespace: string,
  name: string,
  body: Partial<Pod>
): Promise<void> => {
  const endpoint = `/pods/${namespace || '_all'}/${name}/resize`
  await apiClient.patch(`${endpoint}`, body)
}

type DeepPartial<T> = T extends object
  ? {
    [P in keyof T]?: DeepPartial<T[P]>
  }
  : T
export const patchResource = async <T extends ResourceType>(
  resource: T,
  name: string,
  namespace: string | undefined,
  body: DeepPartial<ResourceTypeMap[T]>
): Promise<void> => {
  const endpoint = `/${resource}/${namespace || '_all'}/${name}`
  await apiClient.patch(`${endpoint}`, body)
}

export const createResource = async <T extends ResourceType>(
  resource: T,
  namespace: string | undefined,
  body: ResourceTypeMap[T]
): Promise<ResourceTypeMap[T]> => {
  const endpoint = `/${resource}/${namespace || '_all'}`
  return await apiClient.post<ResourceTypeMap[T]>(`${endpoint}`, body)
}

export const deleteResource = async <T extends ResourceType>(
  resource: T,
  name: string,
  namespace: string | undefined,
  opts?: {
    force?: boolean
    wait?: boolean
  }
): Promise<void> => {
  const params = new URLSearchParams()
  if (opts?.force) {
    params.append('force', 'true')
  }
  if (opts?.wait === false) {
    params.append('wait', 'false')
  }
  const endpoint = `/${resource}/${namespace || '_all'}/${name}?${params.toString()}`
  await apiClient.delete(endpoint)
}

// Apply resource from YAML
export interface ApplyResourceRequest {
  yaml: string
}

export interface ApplyResourceResponse {
  message: string
  kind: string
  name: string
  namespace?: string
}

export const applyResource = async (
  yaml: string
): Promise<ApplyResourceResponse> => {
  return await apiClient.post<ApplyResourceResponse>('/resources/apply', {
    yaml,
  })
}

export const useResourcesEvents = <T extends ResourceType>(
  resource: T,
  name: string,
  namespace?: string
) => {
  return useQuery({
    queryKey: ['resource-events', resource, namespace, name],
    queryFn: () => {
      const endpoint =
        '/events/resources?' +
        new URLSearchParams({
          resource: resource,
          name: name,
          namespace: namespace || '',
        }).toString()
      return fetchAPI<ResourcesTypeMap['events']>(endpoint)
    },
    select: (data: ResourcesTypeMap['events']): ResourcesItems<'events'> =>
      data.items,
    placeholderData: (prevData) => prevData,
  })
}

export const useResources = <T extends ResourceType>(
  resource: T,
  namespace?: string,
  options?: {
    staleTime?: number
    limit?: number
    labelSelector?: string
    fieldSelector?: string
    refreshInterval?: number
    disable?: boolean
    reduce?: boolean
  }
) => {
  return useQuery({
    queryKey: [
      resource,
      namespace,
      options?.limit,
      options?.labelSelector,
      options?.fieldSelector,
    ],
    queryFn: () => {
      return fetchResources<ResourcesTypeMap[T]>(resource, namespace, {
        limit: options?.limit,
        continueToken: undefined,
        labelSelector: options?.labelSelector,
        fieldSelector: options?.fieldSelector,
        reduce: options?.reduce,
      })
    },
    enabled: !options?.disable,
    select: (data: ResourcesTypeMap[T]): ResourcesItems<T> => data.items,
    placeholderData: (prevData) => prevData,
    refetchInterval: (options?.refreshInterval && options.refreshInterval < 15000 && options.refreshInterval !== 0) ? 15000 : (options?.refreshInterval || 0),
    staleTime: options?.staleTime || (resource === 'crds' ? 10000 : 2000),
  })
}

// Hook: SSE watch for resource lists (initial snapshot + ADDED/MODIFIED/DELETED)
export function useResourcesWatch<T extends ResourceType>(
  resource: T,
  namespace?: string,
  options?: {
    labelSelector?: string
    fieldSelector?: string
    reduce?: boolean
    enabled?: boolean
  }
) {
  const [data, setData] = useState<ResourcesItems<T> | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const buildUrl = useCallback(() => {
    const ns = namespace || '_all'
    const params = new URLSearchParams()
    if (options?.reduce !== false) params.append('reduce', 'true')
    if (options?.labelSelector)
      params.append('labelSelector', options.labelSelector)
    if (options?.fieldSelector)
      params.append('fieldSelector', options.fieldSelector)
    const cluster = localStorage.getItem('current-cluster')
    if (cluster) params.append('x-cluster-name', cluster)
    return withSubPath(
      `${API_BASE_URL}/${resource}/${ns}/watch?${params.toString()}`
    )
  }, [
    resource,
    namespace,
    options?.reduce,
    options?.labelSelector,
    options?.fieldSelector,
  ])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    disconnect()
    setData(undefined)
    if (options?.enabled === false) return
    const url = buildUrl()
    setError(null)
    setIsConnected(false)

    try {
      const es = new EventSource(url, { withCredentials: true })
      eventSourceRef.current = es

      es.onopen = () => {
        setIsConnected(true)
      }

      const getKey = (obj: ResourceTypeMap[T]) => {
        return (
          (obj.metadata?.namespace || '') + '/' + (obj.metadata?.name || '')
        )
      }

      const upsert = (obj: string) => {
        const object = JSON.parse(obj) as ResourceTypeMap[T]
        setData((prev) => {
          const arr = prev ? [...prev] : []
          const key = getKey(object)
          const idx = arr.findIndex(
            (it) => getKey(it as ResourceTypeMap[T]) === key
          )
          if (idx >= 0) arr[idx] = object
          else arr.unshift(object)
          return arr as ResourcesItems<T>
        })
      }

      const remove = (obj: string) => {
        const object = JSON.parse(obj) as ResourceTypeMap[T]
        setData((prev) => {
          const arr = prev ? [...prev] : []
          const key = getKey(object)
          const filtered = arr.filter(
            (it) => getKey(it as ResourceTypeMap[T]) !== key
          )
          return filtered as ResourcesItems<T>
        })
      }

      es.addEventListener('added', (e: MessageEvent<string>) => {
        upsert(e.data)
      })
      es.addEventListener('modified', (e: MessageEvent<string>) => {
        upsert(e.data)
      })
      es.addEventListener('deleted', (e: MessageEvent<string>) => {
        remove(e.data)
      })

      es.addEventListener('error', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data)
          setError(new Error(payload?.error || 'SSE error'))
        } catch {
          setError(new Error('SSE error'))
        }
        setIsLoading(false)
        setIsConnected(false)
      })
      es.addEventListener('close', () => {
        setIsConnected(false)
      })

      es.onerror = () => {
        setIsConnected(false)
      }
    } catch (err) {
      if (err instanceof Error) setError(err)
      setIsLoading(false)
      setIsConnected(false)
    }
  }, [buildUrl, disconnect, options?.enabled])

  const refetch = useCallback(() => {
    disconnect()
    setTimeout(connect, 100)
  }, [disconnect, connect])

  useEffect(() => {
    if (options?.enabled === false) return
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect, options?.enabled])

  return { data, isLoading, error, isConnected, refetch, stop: disconnect }
}

export const fetchResource = <T>(
  resource: string,
  name: string,
  namespace?: string
): Promise<T> => {
  const endpoint = `/${resource}/${namespace || '_all'}/${name}`
  return fetchAPI<T>(endpoint)
}
export const useResource = <T extends keyof ResourceTypeMap>(
  resource: T,
  name: string,
  namespace?: string,
  options?: { staleTime?: number; refreshInterval?: number, enabled?: boolean }
) => {
  const isClusterScoped = clusterScopeResources.includes(resource as ResourceType)
  const ns = isClusterScoped ? '_all' : (namespace || '_all')
  return useQuery({
    queryKey: [resource.slice(0, -1), ns, name], // Remove 's' from resource name for singular
    queryFn: () => {
      return fetchResource<ResourceTypeMap[T]>(resource, name, ns)
    },
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: 'always',
    refetchInterval: (options?.refreshInterval && options.refreshInterval < 15000 && options.refreshInterval !== 0) ? 15000 : (options?.refreshInterval || 0),
    placeholderData: (prevData) => prevData,
    staleTime: options?.staleTime || 1000,
  })
}

// Overview API
const fetchOverview = (): Promise<OverviewData> => {
  return fetchAPI<OverviewData>('/overview')
}

export const useOverview = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
    staleTime: options?.staleTime || 30000, // 30 seconds cache
    refetchInterval: 30000, // Auto refresh every 30 seconds
  })
}

// Resource Usage History API
export const fetchResourceUsageHistory = (
  duration: string,
  instance?: string
): Promise<ResourceUsageHistory> => {
  const endpoint = `/prometheus/resource-usage-history?duration=${duration}`
  if (instance) {
    return fetchAPI<ResourceUsageHistory>(
      `${endpoint}&instance=${encodeURIComponent(instance)}`
    )
  }
  return fetchAPI<ResourceUsageHistory>(endpoint)
}

export const useResourceUsageHistory = (
  duration: string,
  options?: { staleTime?: number; instance?: string; enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['resource-usage-history', duration, options?.instance],
    queryFn: () => fetchResourceUsageHistory(duration, options?.instance),
    enabled: options?.enabled,
    staleTime: options?.staleTime || 10000, // 10 seconds cache
    refetchInterval: 30000, // Auto refresh every 30 seconds for historical data
    retry: 0,
    placeholderData: (prevData) => prevData, // Keep previous data while loading new data
  })
}

// ─── Cluster Metrics API ─────────────────────────────────────────────────────

export const fetchClusterMetrics = (): Promise<ClusterMetrics> => {
  return fetchAPI<ClusterMetrics>('/prometheus/cluster-metrics')
}

export const useClusterMetrics = (options?: {
  staleTime?: number
  enabled?: boolean
  refetchInterval?: number
}) => {
  return useQuery({
    queryKey: ['cluster-metrics'],
    queryFn: fetchClusterMetrics,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 15000,
    refetchInterval: options?.refetchInterval ?? 30000,
    retry: 0,
    placeholderData: (prevData) => prevData,
  })
}

// ─── Namespace Metrics API ────────────────────────────────────────────────────

export const fetchNamespaceMetrics = (): Promise<NamespaceMetrics[]> => {
  return fetchAPI<NamespaceMetrics[]>('/prometheus/namespace-metrics')
}

export const useNamespaceMetrics = (options?: {
  staleTime?: number
  enabled?: boolean
  refetchInterval?: number
}) => {
  return useQuery({
    queryKey: ['namespace-metrics'],
    queryFn: fetchNamespaceMetrics,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 15000,
    refetchInterval: options?.refetchInterval ?? 30000,
    retry: 0,
    placeholderData: (prevData) => prevData,
  })
}

// ─── Node Filesystem Metrics API ─────────────────────────────────────────────

export const fetchNodeFilesystemMetrics = (): Promise<NodeFilesystemMetrics[]> => {
  return fetchAPI<NodeFilesystemMetrics[]>('/prometheus/node-filesystem')
}

export const useNodeFilesystemMetrics = (options?: {
  staleTime?: number
  enabled?: boolean
  refetchInterval?: number
}) => {
  return useQuery({
    queryKey: ['node-filesystem-metrics'],
    queryFn: fetchNodeFilesystemMetrics,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 15000,
    refetchInterval: options?.refetchInterval ?? 60000,
    retry: 0,
    placeholderData: (prevData) => prevData,
  })
}

// Pod monitoring API functions
export const fetchPodMetrics = (
  namespace: string,
  podName: string,
  duration: string,
  container?: string,
  labelSelector?: string
): Promise<PodMetrics> => {
  let endpoint = `/prometheus/pods/${namespace}/${podName}/metrics?duration=${duration}`
  if (container) {
    endpoint += `&container=${encodeURIComponent(container)}`
  }
  if (labelSelector) {
    endpoint += `&labelSelector=${encodeURIComponent(labelSelector)}`
  }
  return fetchAPI<PodMetrics>(endpoint)
}

export const usePodMetrics = (
  namespace: string,
  podName: string,
  duration: string,
  options?: {
    staleTime?: number
    container?: string
    refreshInterval?: number
    labelSelector?: string
  }
) => {
  return useQuery({
    queryKey: [
      'pod-metrics',
      namespace,
      podName,
      duration,
      options?.container,
      options?.labelSelector,
    ],
    queryFn: () =>
      fetchPodMetrics(
        namespace,
        podName,
        duration,
        options?.container,
        options?.labelSelector
      ),
    enabled: !!namespace && !!podName,
    staleTime: options?.staleTime || 10000, // 10 seconds cache
    // 1 second
    refetchInterval: (options?.refreshInterval && options.refreshInterval < 15000) ? 15000 : (options?.refreshInterval || 30000),
    retry: 0,
    placeholderData: (prevData) => prevData,
  })
}

// Pod describe API
export const fetchDescribe = async (
  resourceType: ResourceType,
  name: string,
  namespace?: string
): Promise<{ result: string }> => {
  const endpoint = `/${resourceType}/${namespace ?? '_all'}/${name}/describe`
  return fetchAPI<{ result: string }>(endpoint)
}

export const useDescribe = (
  resourceType: ResourceType,
  name: string,
  namespace?: string,
  options?: { staleTime?: number; enabled?: boolean }
) => {
  return useQuery({
    queryKey: [resourceType, name, namespace, 'describe'],
    queryFn: () => fetchDescribe(resourceType, name, namespace),
    enabled: (options?.enabled ?? true) && !!name,
    staleTime: options?.staleTime || 0,
    retry: 0,
  })
}

// Logs API functions
export interface LogsResponse {
  logs: string[]
  container?: string
  pod: string
  namespace: string
}

// Function to fetch static logs (follow=false)
export const fetchPodLogs = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
  }
): Promise<LogsResponse> => {
  const params = new URLSearchParams()
  params.append('follow', 'false') // Explicitly set follow=false for static logs

  if (options?.container) {
    params.append('container', options.container)
  }
  if (options?.tailLines !== undefined) {
    params.append('tailLines', options.tailLines.toString())
  }
  if (options?.timestamps !== undefined) {
    params.append('timestamps', options.timestamps.toString())
  }
  if (options?.previous !== undefined) {
    params.append('previous', options.previous.toString())
  }
  if (options?.sinceSeconds !== undefined) {
    params.append('sinceSeconds', options.sinceSeconds.toString())
  }

  const endpoint = `/logs/${namespace}/${podName}${params.toString() ? `?${params.toString()}` : ''}`
  return fetchAPI<LogsResponse>(endpoint)
}

// Function to create SSE-based logs connection (follow=true)
export const createLogsSSEStream = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
  },
  onMessage?: (data: string) => void,
  onError?: (error: Error) => void,
  onClose?: () => void,
  onOpen?: () => void
): EventSource => {
  const params = new URLSearchParams()
  params.append('follow', 'true') // Enable streaming

  if (options?.container) {
    params.append('container', options.container)
  }
  if (options?.tailLines !== undefined) {
    params.append('tailLines', options.tailLines.toString())
  }
  if (options?.timestamps !== undefined) {
    params.append('timestamps', options.timestamps.toString())
  }
  if (options?.previous !== undefined) {
    params.append('previous', options.previous.toString())
  }
  if (options?.sinceSeconds !== undefined) {
    params.append('sinceSeconds', options.sinceSeconds.toString())
  }

  const currentCluster = localStorage.getItem('current-cluster')
  if (currentCluster) {
    params.append('x-cluster-name', currentCluster)
  }

  const endpoint = `${API_BASE_URL}/logs/${namespace}/${podName}?${params.toString()}`
  const eventSource = new EventSource(endpoint, {
    withCredentials: true,
  })

  // Handle SSE open event
  eventSource.onopen = () => {
    console.log('SSE connection opened')
    if (onOpen) {
      onOpen()
    }
  }

  // Handle connection established
  eventSource.addEventListener('connected', (event: MessageEvent) => {
    console.log('SSE connection established:', event.data)
  })

  // Handle log messages
  eventSource.addEventListener('log', (event: MessageEvent) => {
    if (onMessage) {
      onMessage(event.data)
    }
  })

  // Handle errors from server
  eventSource.addEventListener('error', (event: MessageEvent) => {
    try {
      const errorData = JSON.parse(event.data)
      if (onError) {
        onError(new Error(errorData.error))
      }
    } catch {
      // This is not a server error event, likely a connection error
      console.warn('SSE error event without valid JSON data')
    }
  })

  // Handle connection close
  eventSource.addEventListener('close', () => {
    eventSource.close()
    if (onClose) {
      onClose()
    }
  })

  // Handle generic SSE errors (connection issues)
  eventSource.onerror = (event) => {
    console.error('SSE connection error:', event)
    if (eventSource.readyState === EventSource.CLOSED) {
      console.log('SSE connection closed')
      if (onClose) {
        onClose()
      }
    } else if (eventSource.readyState === EventSource.CONNECTING) {
      console.log('SSE reconnecting...')
    } else {
      if (onError) {
        onError(new Error('SSE connection error'))
      }
    }
  }

  return eventSource
}

// Pod File Browser API
export interface FileInfo {
  name: string
  isDir: boolean
  size: string
  modTime: string
  mode: string
  uid: string
  gid: string
}

export const podListFiles = async (
  namespace: string,
  podName: string,
  container: string,
  path: string,
  options?: RequestInit
): Promise<FileInfo[]> => {
  const params = new URLSearchParams({
    container,
    path,
  })
  return apiClient.get<FileInfo[]>(
    `/pods/${namespace}/${podName}/files?${params.toString()}`,
    options
  )
}

export const podDownloadFile = (
  namespace: string,
  podName: string,
  container: string,
  path: string
) => {
  const params = new URLSearchParams({
    container,
    path,
  })
  const url = withSubPath(
    `${API_BASE_URL}/pods/${namespace}/${podName}/files/download?${params.toString()}`
  )
  window.open(url, '_blank')
}

export const podPreviewFile = (
  namespace: string,
  podName: string,
  container: string,
  path: string
) => {
  const params = new URLSearchParams({
    container,
    path,
  })
  const url = withSubPath(
    `${API_BASE_URL}/pods/${namespace}/${podName}/files/preview?${params.toString()}`
  )
  window.open(url, '_blank')
}

export const podUploadFile = async (
  namespace: string,
  podName: string,
  container: string,
  path: string,
  file: File
): Promise<void> => {
  const formData = new FormData()
  formData.append('file', file)
  const params = new URLSearchParams({
    container,
    path,
  })

  await apiClient.put(
    `/pods/${namespace}/${podName}/files/upload?${params.toString()}`,
    formData
  )
}

export const fetchTemplates = async (): Promise<ResourceTemplate[]> => {
  return fetchAPI<ResourceTemplate[]>('/templates/')
}

export const createTemplate = async (
  data: Omit<ResourceTemplate, 'ID'>
): Promise<ResourceTemplate> => {
  return apiClient.post<ResourceTemplate>('/admin/templates/', data)
}

export const updateTemplate = async (
  id: number,
  data: Partial<ResourceTemplate>
): Promise<ResourceTemplate> => {
  return apiClient.put<ResourceTemplate>(`/admin/templates/${id}`, data)
}

export const deleteTemplate = async (id: number): Promise<void> => {
  await apiClient.delete(`/admin/templates/${id}`)
}

export const useTemplates = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
    staleTime: options?.staleTime || 30000,
  })
}

export const useLogsStream = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
    enabled?: boolean
    follow?: boolean
  }
) => {
  const [logs, setLogs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [downloadSpeed, setDownloadSpeed] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const networkStatsRef = useRef({
    lastReset: Date.now(),
    bytesReceived: 0,
  })
  const speedUpdateTimerRef = useRef<NodeJS.Timeout | null>(null)

  const stopStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    // Clear speed update timer
    if (speedUpdateTimerRef.current) {
      clearInterval(speedUpdateTimerRef.current)
      speedUpdateTimerRef.current = null
    }

    setIsConnected(false)
    setIsLoading(false)
    setDownloadSpeed(0)
  }, [])

  const startStreaming = useCallback(async () => {
    if (!namespace || !podName || options?.enabled === false) return

    // Close any existing connection first to prevent race conditions
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    try {
      setIsLoading(true)
      setError(null)
      setLogs([]) // Clear previous logs when starting new stream

      if (options?.follow) {
        // Use SSE for follow mode
        const eventSource = createLogsSSEStream(
          namespace,
          podName,
          {
            container: options?.container,
            tailLines: options?.tailLines,
            timestamps: options?.timestamps,
            previous: options?.previous,
            sinceSeconds: options?.sinceSeconds,
          },
          // onMessage callback
          (logLine: string) => {
            // Calculate data size for network speed tracking
            const dataSize = new Blob([logLine]).size
            networkStatsRef.current.bytesReceived += dataSize

            setLogs((prev) => [...prev, logLine])
          },
          // onError callback
          (err: Error) => {
            console.error('SSE error:', err)
            setError(err)
            setIsLoading(false)
            setIsConnected(false)
          },
          // onClose callback
          () => {
            setIsLoading(false)
            setIsConnected(false)
          },
          // onOpen callback
          () => {
            setIsLoading(false)
            setIsConnected(true)
            setError(null)

            // Reset network stats and start speed tracking
            networkStatsRef.current = {
              lastReset: Date.now(),
              bytesReceived: 0,
            }
            setDownloadSpeed(0)

            // Start periodic speed update timer
            if (speedUpdateTimerRef.current) {
              clearInterval(speedUpdateTimerRef.current)
            }
            speedUpdateTimerRef.current = setInterval(() => {
              const now = Date.now()
              const stats = networkStatsRef.current
              const timeDiff = (now - stats.lastReset) / 1000

              if (timeDiff > 0) {
                const downloadSpeedValue = stats.bytesReceived / timeDiff
                setDownloadSpeed(downloadSpeedValue)

                // Reset counters every 3 seconds
                if (timeDiff >= 3) {
                  stats.lastReset = now
                  stats.bytesReceived = 0
                }
              }
            }, 500)
          }
        )

        eventSourceRef.current = eventSource
      } else {
        // Use static fetch for non-follow mode
        const response = await fetchPodLogs(namespace, podName, {
          container: options?.container,
          tailLines: options?.tailLines,
          timestamps: options?.timestamps,
          previous: options?.previous,
          sinceSeconds: options?.sinceSeconds,
        })

        setLogs(response.logs || [])
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err)
      }
    } finally {
      if (!options?.follow) {
        setIsLoading(false)
        setIsConnected(false)
      }
    }
  }, [
    namespace,
    podName,
    options?.container,
    options?.tailLines,
    options?.timestamps,
    options?.previous,
    options?.sinceSeconds,
    options?.enabled,
    options?.follow,
  ])

  const refetch = useCallback(() => {
    stopStreaming()
    setTimeout(startStreaming, 100) // Small delay to ensure cleanup
  }, [stopStreaming, startStreaming])

  useEffect(() => {
    if (options?.enabled !== false) {
      startStreaming()
    }

    return () => {
      stopStreaming()
    }
  }, [startStreaming, stopStreaming, options?.enabled])

  // Cleanup on unmount
  useEffect(() => {
    return stopStreaming
  }, [stopStreaming])

  return {
    logs,
    isLoading,
    error,
    isConnected,
    downloadSpeed,
    refetch,
    stopStreaming,
  }
}

export async function getImageTags(image: string): Promise<ImageTagInfo[]> {
  if (!image) return []
  const resp = await apiClient.get<ImageTagInfo[]>(
    `/image/tags?image=${encodeURIComponent(image)}`
  )
  return resp
}

export function useImageTags(image: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['image-tags', image],
    queryFn: () => getImageTags(image),
    enabled: !!image && (options?.enabled ?? true),
    staleTime: 60 * 1000, // 1 min
    placeholderData: (prev) => prev,
  })
}

export async function getRelatedResources(
  resource: ResourceType,
  name: string,
  namespace?: string
): Promise<TopologyResponse> {
  const resp = await apiClient.get<TopologyResponse>(
    `/${resource}/${namespace ? namespace : '_all'}/${name}/related`
  )
  return resp
}

export function useRelatedResources(
  resource: ResourceType,
  name: string,
  namespace?: string
) {
  return useQuery({
    queryKey: ['related-resources', resource, name, namespace],
    queryFn: () => getRelatedResources(resource, name, namespace),
    staleTime: 60 * 1000, // 1 min
    placeholderData: (prev) => prev,
  })
}

// Initialize API types
export interface InitCheckResponse {
  initialized: boolean
  step: number
}

// Initialize API function
export const fetchInitCheck = (): Promise<InitCheckResponse> => {
  return fetchAPI<InitCheckResponse>('/init_check')
}

export const useInitCheck = () => {
  return useQuery({
    queryKey: ['init-check'],
    queryFn: fetchInitCheck,
    staleTime: 0, // Always fresh
    refetchInterval: 0, // No auto-refresh
  })
}

// Version information
export interface VersionInfo {
  version: string
  buildDate: string
  commitId: string
  hasNewVersion: boolean
  releaseUrl: string
}

export const fetchVersionInfo = (): Promise<VersionInfo> => {
  return fetchAPI<VersionInfo>('/version')
}

export const useVersionInfo = () => {
  return useQuery({
    queryKey: ['version-info'],
    queryFn: fetchVersionInfo,
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchInterval: 0, // No auto-refresh
  })
}

// User registration for initial setup
export interface CreateUserRequest {
  username: string
  email?: string
  password: string
  name?: string
}

export const createSuperUser = async (
  userData: CreateUserRequest
): Promise<void> => {
  await apiClient.post('/admin/users/create_super_user', userData)
}

// Cluster import for initial setup
export interface ImportClustersRequest {
  config: string
  inCluster?: boolean
}

export const importClusters = async (
  request: ImportClustersRequest
): Promise<void> => {
  await apiClient.post('/admin/clusters/import', request)
}

export const useLogsWebSocket = (
  namespace: string,
  podName: string,
  options?: {
    container?: string
    tailLines?: number
    timestamps?: boolean
    previous?: boolean
    sinceSeconds?: number
    enabled?: boolean
    labelSelector?: string
    onNewLog?: (log: string) => void
    onClear?: () => void
  }
) => {
  // Build WebSocket URL
  const buildWebSocketUrl = useCallback(() => {
    if (!options?.enabled || !namespace || !podName) return ''

    const params = new URLSearchParams()

    if (options.container) {
      params.append('container', options.container)
    }
    if (options.tailLines !== undefined) {
      params.append('tailLines', options.tailLines.toString())
    }
    if (options.timestamps !== undefined) {
      params.append('timestamps', options.timestamps.toString())
    }
    if (options.previous !== undefined) {
      params.append('previous', options.previous.toString())
    }
    if (options.sinceSeconds !== undefined) {
      params.append('sinceSeconds', options.sinceSeconds.toString())
    }
    if (options.labelSelector) {
      params.append('labelSelector', options.labelSelector)
    }

    const currentCluster = localStorage.getItem('current-cluster')
    if (currentCluster) {
      params.append('x-cluster-name', currentCluster)
    }

    const wsPath = `/api/v1/logs/${namespace}/${podName}/ws?${params.toString()}`
    return getWebSocketUrl(wsPath)
  }, [
    namespace,
    podName,
    options?.container,
    options?.tailLines,
    options?.timestamps,
    options?.previous,
    options?.sinceSeconds,
    options?.enabled,
    options?.labelSelector,
  ])

  // WebSocket event handlers
  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'log':
          if (message.data && options?.onNewLog) {
            options.onNewLog(message.data)
          }
          break
        case 'error':
          console.error('Log streaming error:', message.data)
          break
        case 'close':
          console.log('Log stream closed:', message.data)
          break
      }
    },
    [options]
  )

  const handleOpen = useCallback(() => {
    console.debug('WebSocket connection opened')
    if (options?.onClear) {
      options.onClear()
    }
  }, [options])

  const handleClose = useCallback(() => {
    console.debug('WebSocket connection closed')
  }, [])

  const handleError = useCallback((event: Event) => {
    console.debug('WebSocket error:', event)
  }, [])

  // Use the generic WebSocket hook
  const [wsState, wsActions] = useWebSocket(
    buildWebSocketUrl,
    {
      onMessage: handleMessage,
      onOpen: handleOpen,
      onClose: handleClose,
      onError: handleError,
    },
    {
      enabled: options?.enabled !== false,
      pingInterval: 20000, // 20 seconds for logs
      reconnectOnClose: true,
      maxReconnectAttempts: 3,
      reconnectInterval: 5000,
    }
  )

  const refetch = useCallback(() => {
    wsActions.reconnect()
    if (options?.onClear) {
      options.onClear()
    }
  }, [wsActions, options])

  const stopStreaming = useCallback(() => {
    wsActions.disconnect()
  }, [wsActions])

  const clearLogs = useCallback(() => {
    if (options?.onClear) {
      options.onClear()
    }
  }, [options])

  return useMemo(
    () => ({
      isLoading: wsState.isConnecting,
      error: wsState.error,
      isConnected: wsState.isConnected,
      downloadSpeed: wsState.networkStats.downloadSpeed,
      refetch,
      stopStreaming,
      clearLogs,
    }),
    [
      wsState.isConnecting,
      wsState.error,
      wsState.isConnected,
      wsState.networkStats.downloadSpeed,
      refetch,
      stopStreaming,
      clearLogs,
    ]
  )
}

export interface ClusterCreateRequest {
  name: string
  description?: string
  config?: string
  prometheusURL?: string
  inCluster?: boolean
  isDefault?: boolean
}

export interface ClusterUpdateRequest extends ClusterCreateRequest {
  enabled?: boolean
}

// Get cluster list for management
export const fetchClusterList = (): Promise<Cluster[]> => {
  return fetchAPI<Cluster[]>('/admin/clusters/')
}

export const useClusterList = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['cluster-list'],
    queryFn: fetchClusterList,
    staleTime: options?.staleTime || 30000, // 30 seconds cache
  })
}

// Create cluster
export const createCluster = async (
  clusterData: ClusterCreateRequest
): Promise<{ id: number; message: string }> => {
  return await apiClient.post<{ id: number; message: string }>(
    '/admin/clusters/',
    clusterData
  )
}

// Update cluster
export const updateCluster = async (
  id: number,
  clusterData: ClusterUpdateRequest
): Promise<{ message: string }> => {
  return await apiClient.put<{ message: string }>(
    `/admin/clusters/${id}`,
    clusterData
  )
}

// Delete cluster
export const deleteCluster = async (
  id: number
): Promise<{ message: string }> => {
  return await apiClient.delete<{ message: string }>(`/admin/clusters/${id}`)
}

// OAuth Provider Management
export interface OAuthProviderCreateRequest {
  name: string
  clientId: string
  clientSecret: string
  authUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  scopes?: string
  issuer?: string
  enabled?: boolean
}

export interface OAuthProviderUpdateRequest extends Omit<
  OAuthProviderCreateRequest,
  'clientSecret'
> {
  clientSecret?: string // Optional when updating
}

// Get OAuth provider list for management
export const fetchOAuthProviderList = (): Promise<OAuthProvider[]> => {
  return fetchAPI<{ providers: OAuthProvider[] }>(
    '/admin/oauth-providers/'
  ).then((response) => response.providers)
}

export const useOAuthProviderList = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['oauth-provider-list'],
    queryFn: fetchOAuthProviderList,
    staleTime: options?.staleTime || 30000, // 30 seconds cache
  })
}

// Create OAuth provider
export const createOAuthProvider = async (
  providerData: OAuthProviderCreateRequest
): Promise<{ provider: OAuthProvider }> => {
  return await apiClient.post<{ provider: OAuthProvider }>(
    '/admin/oauth-providers/',
    providerData
  )
}

// Update OAuth provider
export const updateOAuthProvider = async (
  id: number,
  providerData: OAuthProviderUpdateRequest
): Promise<{ provider: OAuthProvider }> => {
  return await apiClient.put<{ provider: OAuthProvider }>(
    `/admin/oauth-providers/${id}`,
    providerData
  )
}

// Delete OAuth provider
export const deleteOAuthProvider = async (
  id: number
): Promise<{ success: boolean; message: string }> => {
  return await apiClient.delete<{ success: boolean; message: string }>(
    `/admin/oauth-providers/${id}`
  )
}

// Get single OAuth provider
export const fetchOAuthProvider = async (
  id: number
): Promise<OAuthProvider> => {
  return fetchAPI<{ provider: OAuthProvider }>(
    `/admin/oauth-providers/${id}`
  ).then((response) => response.provider)
}

// RBAC API
export const fetchRoleList = async (): Promise<Role[]> => {
  return fetchAPI<{ roles: Role[] }>(`/admin/roles/`).then((resp) => resp.roles)
}

export const useRoleList = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['role-list'],
    queryFn: fetchRoleList,
    staleTime: options?.staleTime || 30000,
  })
}

export const createRole = async (data: Partial<Role>) => {
  return await apiClient.post<{ role: Role }>(`/admin/roles/`, data)
}

export const updateRole = async (id: number, data: Partial<Role>) => {
  return await apiClient.put<{ role: Role }>(`/admin/roles/${id}`, data)
}

export const deleteRole = async (id: number) => {
  return await apiClient.delete<{ success: boolean }>(`/admin/roles/${id}`)
}

export const assignRole = async (
  id: number,
  data: { subjectType: 'user' | 'group' | 'apikey'; subject: string }
) => {
  return await apiClient.post(`/admin/roles/${id}/assign`, data)
}

export const unassignRole = async (
  id: number,
  subjectType: 'user' | 'group',
  subject: string
) => {
  const params = new URLSearchParams({ subjectType, subject })
  return await apiClient.delete(
    `/admin/roles/${id}/assign?${params.toString()}`
  )
}

export const fetchUserList = async (
  page = 1,
  size = 20,
  search = '',
  sortBy = '',
  sortOrder = '',
  role = ''
): Promise<FetchUserListResponse> => {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  })
  if (search) {
    params.set('search', search)
  }
  if (sortBy) {
    params.set('sortBy', sortBy)
  }
  if (sortOrder) {
    params.set('sortOrder', sortOrder)
  }
  if (role) {
    params.set('role', role)
  }
  return fetchAPI<FetchUserListResponse>(`/admin/users/?${params.toString()}`)
}

export const updateUser = async (id: number, data: Partial<UserItem>) => {
  return apiClient.put<{ user: UserItem }>(`/admin/users/${id}`, data)
}

export const deleteUser = async (id: number) => {
  return apiClient.delete<{ success: boolean }>(`/admin/users/${id}`)
}

export const batchDeleteUsers = async (data: { ids: number[] }) => {
  return apiClient.delete<{ deleted: number[]; errors: string[] }>(
    `/admin/users/batch`,
    data
  )
}

export const createPasswordUser = async (data: {
  username: string
  name?: string
  email?: string
  password: string
}) => {
  return apiClient.post<{ user: UserItem }>(`/admin/users/`, data)
}

export const batchCreateUsers = async (data: {
  users: {
    username: string
    name?: string
    email?: string
    password?: string
  }[]
}) => {
  return apiClient.post<{ created: UserItem[]; errors: string[] }>(
    `/admin/users/batch`,
    data
  )
}

export const resetUserPassword = async (id: number, password: string) => {
  return apiClient.post<{ success: boolean }>(
    `/admin/users/${id}/reset_password`,
    { password }
  )
}

export const setUserEnabled = async (id: number, enabled: boolean) => {
  return apiClient.post<{ success: boolean }>(`/admin/users/${id}/enable`, {
    enabled,
  })
}

export const useUserList = (
  page = 1,
  size = 20,
  search = '',
  sortBy = '',
  sortOrder = '',
  role = ''
) => {
  return useQuery<FetchUserListResponse, Error>({
    queryKey: ['user-list', page, size, search, sortBy, sortOrder, role],
    queryFn: () => fetchUserList(page, size, search, sortBy, sortOrder, role),
    staleTime: 20000,
  })
}

export const fetchAuditLogs = async (
  page = 1,
  size = 20,
  operatorId?: number,
  search?: string,
  operation?: string,
  cluster?: string,
  resourceType?: string,
  resourceName?: string,
  namespace?: string,
  startDate?: string,
  endDate?: string
): Promise<AuditLogResponse> => {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  })
  if (operatorId) {
    params.set('operatorId', String(operatorId))
  }
  if (search) {
    params.set('search', search)
  }
  if (operation) {
    params.set('operation', operation)
  }
  if (cluster) {
    params.set('cluster', cluster)
  }
  if (resourceType) {
    params.set('resourceType', resourceType)
  }
  if (resourceName) {
    params.set('resourceName', resourceName)
  }
  if (namespace) {
    params.set('namespace', namespace)
  }
  if (startDate) {
    params.set('startDate', startDate)
  }
  if (endDate) {
    params.set('endDate', endDate)
  }
  return fetchAPI<AuditLogResponse>(`/admin/audit-logs?${params.toString()}`)
}

export const useAuditLogs = (
  page = 1,
  size = 20,
  operatorId?: number,
  search?: string,
  operation?: string,
  cluster?: string,
  resourceType?: string,
  resourceName?: string,
  namespace?: string,
  options?: { staleTime?: number; refetchInterval?: number; enabled?: boolean },
  startDate?: string,
  endDate?: string
) => {
  return useQuery<AuditLogResponse, Error>({
    queryKey: [
      'audit-logs',
      page,
      size,
      operatorId,
      search,
      operation,
      cluster,
      resourceType,
      resourceName,
      namespace,
      startDate,
      endDate,
    ],
    queryFn: () =>
      fetchAuditLogs(
        page,
        size,
        operatorId,
        search,
        operation,
        cluster,
        resourceType,
        resourceName,
        namespace,
        startDate,
        endDate
      ),
    staleTime: options?.staleTime || 20000,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled,
  })
}

// Fetch single audit entry detail (with YAML diffs)
// Uses the admin endpoint so it works from the Settings page without cluster context.
export const fetchAuditLogDetail = async (id: number): Promise<ResourceHistory> => {
  return fetchAPI<ResourceHistory>(`/admin/audit-logs/${id}`)
}

export const useAuditLogDetail = (id: number | null, options?: { enabled?: boolean }) => {
  return useQuery<ResourceHistory, Error>({
    queryKey: ['audit-log-detail', id],
    queryFn: () => fetchAuditLogDetail(id!),
    enabled: (options?.enabled ?? true) && id !== null && id > 0,
    staleTime: 60000,
  })
}

// Audit timeline histogram data
export interface AuditTimelineBucket {
  timestamp: string
  create: number
  update: number
  delete: number
  patch: number
  apply: number
  total: number
}

export const fetchAuditTimeline = async (days: number = 7): Promise<AuditTimelineBucket[]> => {
  return fetchAPI<AuditTimelineBucket[]>(`/audit-logs/timeline?days=${days}`)
}

export const useAuditTimeline = (days: number = 7, options?: { enabled?: boolean; refetchInterval?: number }) => {
  return useQuery<AuditTimelineBucket[], Error>({
    queryKey: ['audit-timeline', days],
    queryFn: () => fetchAuditTimeline(days),
    staleTime: 30000,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled,
  })
}

// Bookmark audit entries (stored in localStorage for simplicity)
export function getBookmarkedAuditIds(): number[] {
  try {
    const stored = localStorage.getItem('audit-bookmarks')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function toggleAuditBookmark(id: number): boolean {
  const bookmarks = getBookmarkedAuditIds()
  const idx = bookmarks.indexOf(id)
  if (idx >= 0) {
    bookmarks.splice(idx, 1)
  } else {
    bookmarks.push(id)
  }
  localStorage.setItem('audit-bookmarks', JSON.stringify(bookmarks))
  return idx < 0 // returns true if added, false if removed
}

export function isAuditBookmarked(id: number): boolean {
  return getBookmarkedAuditIds().includes(id)
}

// User-level audit logs (non-admin, RBAC-filtered, for header drawer)
export const fetchUserAuditLogs = async (
  page = 1,
  size = 50,
  search?: string,
  operation?: string,
  resourceType?: string,
  namespace?: string,
  startDate?: string,
  endDate?: string
): Promise<AuditLogResponse> => {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  })
  if (search) params.set('search', search)
  if (operation) params.set('operation', operation)
  if (resourceType) params.set('resourceType', resourceType)
  if (namespace) params.set('namespace', namespace)
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  return fetchAPI<AuditLogResponse>(`/audit-logs?${params.toString()}`)
}

export const useUserAuditLogs = (
  page = 1,
  size = 50,
  search?: string,
  operation?: string,
  resourceType?: string,
  namespace?: string,
  startDate?: string,
  endDate?: string,
  options?: { staleTime?: number; refetchInterval?: number; enabled?: boolean }
) => {
  return useQuery<AuditLogResponse, Error>({
    queryKey: [
      'user-audit-logs',
      page,
      size,
      search,
      operation,
      resourceType,
      namespace,
      startDate,
      endDate,
    ],
    queryFn: () =>
      fetchUserAuditLogs(
        page,
        size,
        search,
        operation,
        resourceType,
        namespace,
        startDate,
        endDate
      ),
    staleTime: options?.staleTime || 15000,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled,
  })
}

// Audit stats (operation counts)
export interface AuditStatsItem {
  operationType: string
  count: number
}

export interface AuditStatsResponse {
  allTime: AuditStatsItem[]
  last24h: AuditStatsItem[]
  totalAll: number
  total24h: number
}

export const fetchAuditStats = async (): Promise<AuditStatsResponse> => {
  return fetchAPI<AuditStatsResponse>('/audit-logs/stats')
}

export const useAuditStats = (options?: { enabled?: boolean; refetchInterval?: number }) => {
  return useQuery<AuditStatsResponse, Error>({
    queryKey: ['audit-stats'],
    queryFn: fetchAuditStats,
    staleTime: 30000,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled,
  })
}

// Export audit logs (admin only) — downloads as a CSV file via fetch to avoid popup blockers.
// NOTE: The export endpoint streams ALL matching rows with no page/size limit, so we must
// NOT send a `size` parameter — the backend export handler ignores pagination entirely.
export const exportAuditLogs = async (params?: {
  operation?: string
  cluster?: string
  operatorId?: number
  search?: string
  resourceType?: string
  resourceName?: string
  namespace?: string
  startDate?: string
  endDate?: string
}) => {
  const searchParams = new URLSearchParams()
  // Do NOT include page/size — the export endpoint streams unbounded rows
  if (params?.operation) searchParams.set('operation', params.operation)
  if (params?.cluster) searchParams.set('cluster', params.cluster)
  if (params?.operatorId) searchParams.set('operatorId', String(params.operatorId))
  if (params?.search) searchParams.set('search', params.search)
  if (params?.resourceType) searchParams.set('resourceType', params.resourceType)
  if (params?.resourceName) searchParams.set('resourceName', params.resourceName)
  if (params?.namespace) searchParams.set('namespace', params.namespace)
  if (params?.startDate) searchParams.set('startDate', params.startDate)
  if (params?.endDate) searchParams.set('endDate', params.endDate)

  const qs = searchParams.toString()
  const url = withSubPath(`${API_BASE_URL}/admin/audit-logs/export${qs ? `?${qs}` : ''}`)
  try {
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(body || `Export failed (HTTP ${response.status})`)
    }
    const blob = await response.blob()
    const blobUrl = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      document.body.removeChild(a)
      window.URL.revokeObjectURL(blobUrl)
    }, 100)
  } catch (err) {
    // Fallback to window.open
    window.open(url, '_blank')
  }
}

// Audit resource activity — per-resource change history for detail pages
export const fetchAuditResourceActivity = async (
  resourceType: string,
  namespace: string,
  name: string,
  limit = 20
): Promise<{ data: ResourceHistory[] }> => {
  const params = new URLSearchParams({ limit: String(limit) })
  return fetchAPI<{ data: ResourceHistory[] }>(
    `/audit-logs/resource/${resourceType}/${namespace || '_all'}/${name}?${params.toString()}`
  )
}

export const useAuditResourceActivity = (
  resourceType: string,
  namespace: string,
  name: string,
  limit = 20,
  options?: { enabled?: boolean }
) => {
  return useQuery<{ data: ResourceHistory[] }, Error>({
    queryKey: ['audit-resource-activity', resourceType, namespace, name, limit],
    queryFn: () => fetchAuditResourceActivity(resourceType, namespace, name, limit),
    enabled: (options?.enabled ?? true) && !!resourceType && !!name,
    staleTime: 30000,
  })
}

// Audit summary — top operators for a cluster
export interface AuditOperatorActivity {
  operatorId: number
  operatorName: string
  totalChanges: number
  successes: number
  failures: number
  lastActivityAt: string
}

export const fetchAuditSummary = async (
  days = 7
): Promise<{ data: AuditOperatorActivity[]; days: number }> => {
  return fetchAPI<{ data: AuditOperatorActivity[]; days: number }>(
    `/audit-logs/summary?days=${days}`
  )
}

export const useAuditSummary = (
  days = 7,
  options?: { enabled?: boolean; refetchInterval?: number }
) => {
  return useQuery<{ data: AuditOperatorActivity[]; days: number }, Error>({
    queryKey: ['audit-summary', days],
    queryFn: () => fetchAuditSummary(days),
    enabled: options?.enabled ?? true,
    staleTime: 60000,
    refetchInterval: options?.refetchInterval,
  })
}

// Permission introspection
export interface PermissionCheckResult {
  allowed: boolean
  resource: string
  verb: string
  cluster: string
  namespace: string
}

export const checkPermission = async (
  resource: string,
  verb: string,
  cluster: string,
  namespace?: string
): Promise<PermissionCheckResult> => {
  const params = new URLSearchParams({ resource, verb, cluster })
  if (namespace) params.set('namespace', namespace)
  return fetchAPI<PermissionCheckResult>(`/users/permissions/check?${params.toString()}`)
}

export interface MyPermissionsSummary {
  username: string
  isAdmin: boolean
  roles: Array<{
    roleName: string
    clusters: string[]
    namespaces: string[]
    resources: string[]
    verbs: string[]
  }>
}

export const getMyPermissions = async (): Promise<MyPermissionsSummary> => {
  return fetchAPI<MyPermissionsSummary>('/users/permissions')
}

export const useMyPermissions = (options?: { enabled?: boolean }) => {
  return useQuery<MyPermissionsSummary, Error>({
    queryKey: ['my-permissions'],
    queryFn: getMyPermissions,
    enabled: options?.enabled ?? true,
    staleTime: 60000,
  })
}

// ─── Clone Role ──────────────────────────────────────────────────────────────

export const cloneRole = async (
  id: number,
  data: { name?: string; description?: string; cloneAssignments?: boolean }
): Promise<{ role: Role; clonedAssignments: number; sourceRole: string }> => {
  return await apiClient.post(`/admin/roles/${id}/clone`, data)
}

// ─── Effective Permissions (Admin) ───────────────────────────────────────────

export interface EffectivePermissions {
  username: string
  isAdmin: boolean
  roleNames: string[]
  effective: {
    clusters: string[]
    namespaces: string[]
    resources: string[]
    verbs: string[]
  }
}

export const fetchEffectivePermissions = async (
  username: string
): Promise<EffectivePermissions> => {
  return fetchAPI<EffectivePermissions>(
    `/admin/effective-permissions/${encodeURIComponent(username)}`
  )
}

export const useEffectivePermissions = (
  username: string,
  options?: { enabled?: boolean }
) => {
  return useQuery<EffectivePermissions, Error>({
    queryKey: ['effective-permissions', username],
    queryFn: () => fetchEffectivePermissions(username),
    enabled: (options?.enabled ?? true) && !!username,
    staleTime: 30000,
  })
}

// ─── Accessible Namespaces ───────────────────────────────────────────────────

export interface AccessibleNamespacesResponse {
  namespaces: string[]
  hasWildcard: boolean
}

export const fetchAccessibleNamespaces =
  async (): Promise<AccessibleNamespacesResponse> => {
    return fetchAPI<AccessibleNamespacesResponse>('/users/accessible-namespaces')
  }

export const useAccessibleNamespaces = (options?: { enabled?: boolean }) => {
  return useQuery<AccessibleNamespacesResponse, Error>({
    queryKey: ['accessible-namespaces'],
    queryFn: fetchAccessibleNamespaces,
    enabled: options?.enabled ?? true,
    staleTime: 60000,
  })
}

// ─── Audit Log Retention ─────────────────────────────────────────────────────

export interface AuditRetentionInfo {
  totalEntries: number
  oldestEntry: string
  ageBrackets: Array<{ label: string; count: number }>
}

export const fetchAuditRetentionInfo =
  async (): Promise<AuditRetentionInfo> => {
    return fetchAPI<AuditRetentionInfo>('/admin/audit-logs/retention')
  }

export const useAuditRetentionInfo = (options?: { enabled?: boolean }) => {
  return useQuery<AuditRetentionInfo, Error>({
    queryKey: ['audit-retention-info'],
    queryFn: fetchAuditRetentionInfo,
    enabled: options?.enabled ?? true,
    staleTime: 60000,
  })
}

export const purgeOldAuditLogs = async (
  retentionDays: number
): Promise<{
  deleted: number
  retentionDays: number
  cutoffDate: string
  message: string
}> => {
  return await apiClient.delete(
    `/admin/audit-logs/purge?retentionDays=${retentionDays}`
  )
}

// Resource History API
export const fetchResourceHistory = (
  resourceType: string,
  namespace: string,
  name: string,
  page: number = 1,
  pageSize: number = 10
): Promise<ResourceHistoryResponse> => {
  const endpoint = `/${resourceType}/${namespace}/${name}/history?page=${page}&pageSize=${pageSize}`
  return fetchAPI<ResourceHistoryResponse>(endpoint)
}

export const useResourceHistory = (
  resourceType: string,
  namespace: string,
  name: string,
  page: number = 1,
  pageSize: number = 10,
  options?: { enabled?: boolean; staleTime?: number }
) => {
  return useQuery({
    queryKey: [
      'resource-history',
      resourceType,
      namespace,
      name,
      page,
      pageSize,
    ],
    queryFn: () =>
      fetchResourceHistory(resourceType, namespace, name, page, pageSize),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime || 30000, // 30 seconds cache
  })
}

// API Key Management
export interface APIKeyCreateRequest {
  name: string
}

export const fetchAPIKeyList = async (): Promise<APIKey[]> => {
  return fetchAPI<{ apiKeys: APIKey[] }>('/admin/apikeys/').then(
    (response) => response.apiKeys
  )
}

export const useAPIKeyList = (options?: { staleTime?: number }) => {
  return useQuery({
    queryKey: ['apikey-list'],
    queryFn: fetchAPIKeyList,
    staleTime: options?.staleTime || 30000,
  })
}

export const createAPIKey = async (
  data: APIKeyCreateRequest
): Promise<{ apiKey: APIKey }> => {
  return await apiClient.post<{ apiKey: APIKey }>('/admin/apikeys/', data)
}

export const deleteAPIKey = async (
  id: number
): Promise<{ message: string }> => {
  return await apiClient.delete<{ message: string }>(`/admin/apikeys/${id}`)
}

// Session Management
export interface UserSession {
  id: number
  userId: number
  ip: string
  userAgent: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  user?: UserItem
}

export const fetchSessions = async (): Promise<UserSession[]> => {
  return fetchAPI<{ sessions: UserSession[] }>('/users/sessions').then(
    (res) => res.sessions
  )
}

export const fetchAllSessions = async (): Promise<UserSession[]> => {
  return fetchAPI<{ sessions: UserSession[] }>('/admin/sessions').then(
    (res) => res.sessions
  )
}

export const deleteSession = async (id: number): Promise<void> => {
  return apiClient.delete<void>(`/users/sessions/${id}`)
}

export const useSessions = () => {
  return useQuery({
    queryKey: ['user-sessions'],
    queryFn: fetchSessions,
  })
}

export const useAllSessions = () => {
  return useQuery({
    queryKey: ['all-sessions'],
    queryFn: fetchAllSessions,
  })
}

export const usePodFiles = (
  namespace: string,
  podName: string,
  container: string,
  path: string,
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey: ['pod-files', namespace, podName, container, path],
    queryFn: () => podListFiles(namespace, podName, container, path),
    enabled: options?.enabled !== false,
    staleTime: 10000, // 10 seconds cache
  })
}

