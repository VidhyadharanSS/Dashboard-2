import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  RowSelectionState,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import {
  Box,
  Database,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Tag,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import { ResourceType } from '@/types/api'
import { deleteResource, useResources, useResourcesWatch } from '@/lib/api'
import { usePermissions } from '@/hooks/use-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { ConnectionIndicator } from './connection-indicator'
import { ErrorMessage } from './error-message'
import { ResourceTableView } from './resource-table-view'
import { NamespaceSelector } from './selector/namespace-selector'
import { Combobox } from '@/components/ui/combobox'

export interface ResourceTableProps<T> {
  resourceName: string
  resourceType?: ResourceType // Optional, used for fetching resources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  clusterScope?: boolean // If true, don't show namespace selector
  searchQueryFilter?: (item: T, query: string) => boolean // Custom filter function
  showCreateButton?: boolean // If true, show create button
  onCreateClick?: () => void // Callback for create button click
  onBatchRestart?: (rows: T[]) => Promise<void> // Callback for batch restart
  extraToolbars?: React.ReactNode[] // Additional toolbar components
  defaultHiddenColumns?: string[] // Columns to hide by default
  enableLabelFilter?: boolean // If true, show label selector filter input
  headerContent?: (data: T[]) => React.ReactNode // Extra content below title/toolbar but above table
  namespace?: string // Forced namespace
}

export function ResourceTable<T>({
  resourceName,
  resourceType,
  columns,
  clusterScope = false,
  searchQueryFilter,
  showCreateButton = false,
  onCreateClick,
  onBatchRestart,
  extraToolbars = [],
  defaultHiddenColumns = [],
  enableLabelFilter = false,
  headerContent,
  labelSelector,
  namespace: forcedNamespace,
}: ResourceTableProps<T> & { labelSelector?: string }) {
  const [localLabelFilter, setLocalLabelFilter] = React.useState('')
  const [appliedLabelFilter, setAppliedLabelFilter] = React.useState('')
  const { t } = useTranslation()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-columnFilters`
    const savedFilters = sessionStorage.getItem(storageKey)
    return savedFilters ? JSON.parse(savedFilters) : []
  })
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const { canAccess } = usePermissions()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-searchQuery`
    return sessionStorage.getItem(storageKey) || ''
  })
  const [displaySearchQuery, setDisplaySearchQuery] = useState(searchQuery)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Global search focus shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        const target = e.target as HTMLElement
        // Don't focus if already in an input
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Debounce search query update
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(displaySearchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [displaySearchQuery])

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-columnVisibility`
    const savedVisibility = localStorage.getItem(storageKey)
    if (savedVisibility) {
      return JSON.parse(savedVisibility)
    }
    // Set default hidden columns if no saved state
    const initialVisibility: Record<string, boolean> = {}
    defaultHiddenColumns.forEach((colId) => {
      initialVisibility[colId] = false
    })
    return initialVisibility
  })

  const [pagination, setPagination] = useState<PaginationState>(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-pageSize`
    const savedPageSize = sessionStorage.getItem(storageKey)
    return {
      pageIndex: 0,
      pageSize: savedPageSize ? Number(savedPageSize) : 20,
    }
  })
  const [refreshInterval, setRefreshInterval] = useState(5000)

  const [selectedNamespace, setSelectedNamespace] = useState<
    string | undefined
  >(() => {
    // Try to get the stored namespace from localStorage
    const storedNamespace = localStorage.getItem(
      localStorage.getItem('current-cluster') + 'selectedNamespace'
    )
    return clusterScope
      ? undefined // No namespace for cluster scope
      : storedNamespace || 'default' // Default to 'default' if not set
  })

  const [searchParams] = useSearchParams()

  useEffect(() => {
    const nsParam = searchParams.get('namespace')
    if (nsParam && !clusterScope) {
      setSelectedNamespace(nsParam)
      localStorage.setItem(
        localStorage.getItem('current-cluster') + 'selectedNamespace',
        nsParam
      )
    }
  }, [searchParams, clusterScope])

  // Listen for namespace changes dispatched by the global NamespaceQuickSwitch pills in the header.
  // When a pinned namespace pill is clicked it writes to localStorage and fires a StorageEvent
  // so every mounted ResourceTable instantly filters to the chosen namespace.
  useEffect(() => {
    if (clusterScope) return
    const clusterKey = (localStorage.getItem('current-cluster') ?? '') + 'selectedNamespace'
    const onStorage = (e: StorageEvent) => {
      if (e.key === clusterKey && e.newValue !== null) {
        setSelectedNamespace(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clusterScope])
  const [useSSE, setUseSSE] = useState(false)
  const {
    isLoading: queryLoading,
    data: queryData,
    isError: queryIsError,
    error: queryError,
    refetch: queryRefetch,
  } = useResources(
    resourceType ?? (resourceName.toLowerCase() as ResourceType),
    forcedNamespace || selectedNamespace,
    {
      refreshInterval: useSSE ? 0 : refreshInterval, // disable polling when SSE
      reduce: true, // Fetch reduced data for performance
      disable: useSSE, // do not query when using SSE
      labelSelector: labelSelector || appliedLabelFilter || undefined,
    }
  )

  // SSE state (when enabled)
  // SSE watch hook
  const {
    data: watchData,
    isLoading: watchLoading,
    error: watchError,
    isConnected,
    refetch: reconnectSSE,
  } = useResourcesWatch(
    (resourceType ??
      (resourceName.toLowerCase() as ResourceType)) as ResourceType,
    forcedNamespace || selectedNamespace,
    { reduce: true, enabled: useSSE, labelSelector: labelSelector }
  )

  // (moved below after error is defined)

  // Update sessionStorage when search query changes
  useEffect(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-searchQuery`
    if (searchQuery) {
      sessionStorage.setItem(storageKey, searchQuery)
    } else {
      sessionStorage.removeItem(storageKey)
    }
  }, [searchQuery, resourceName])

  // Update sessionStorage when column visibility changes
  useEffect(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-columnVisibility`
    localStorage.setItem(storageKey, JSON.stringify(columnVisibility))
  }, [columnVisibility, resourceName])

  // Update sessionStorage when page size changes
  useEffect(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-pageSize`
    sessionStorage.setItem(storageKey, pagination.pageSize.toString())
  }, [pagination.pageSize, resourceName])

  // Update sessionStorage when column filters changes
  useEffect(() => {
    const currentCluster = localStorage.getItem('current-cluster')
    const storageKey = `${currentCluster}-${resourceName}-columnFilters`
    if (columnFilters.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(columnFilters))
    } else {
      sessionStorage.removeItem(storageKey)
    }
  }, [columnFilters, resourceName])

  // Reset pagination when filters change
  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [columnFilters, searchQuery])

  // Handle namespace change
  const handleNamespaceChange = useCallback(
    (value: string) => {
      if (setSelectedNamespace) {
        localStorage.setItem(
          localStorage.getItem('current-cluster') + 'selectedNamespace',
          value
        )
        setSelectedNamespace(value)
        // Reset pagination and search when changing namespace
        setPagination({ pageIndex: 0, pageSize: pagination.pageSize })
        setSearchQuery('')
      }
    },
    [setSelectedNamespace, pagination.pageSize]
  )

  // Add namespace column when showing all namespaces
  const enhancedColumns = useMemo(() => {
    const selectColumn: ColumnDef<T> = {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }

    const baseColumns = [selectColumn, ...columns]

    // Only add namespace column if not cluster scope, showing all namespaces,
    // and there isn't already a namespace column in the provided columns
    if (!clusterScope && selectedNamespace === '_all') {
      // Check if namespace column already exists in the provided columns
      const hasNamespaceColumn = columns.some((col) => {
        // Check if the column accesses namespace data
        if ('accessorKey' in col && col.accessorKey === 'metadata.namespace') {
          return true
        }
        if ('accessorFn' in col && col.id === 'namespace') {
          return true
        }
        return false
      })

      // Only add namespace column if it doesn't already exist
      if (!hasNamespaceColumn) {
        const namespaceColumn = {
          id: 'namespace',
          header: t('resourceTable.namespace'),
          accessorFn: (row: T) => {
            // Try to get namespace from metadata.namespace
            const metadata = (row as { metadata?: { namespace?: string } })
              ?.metadata
            return metadata?.namespace || '-'
          },
          cell: ({ getValue }: { getValue: () => string }) => (
            <Badge variant="outline" className="ml-2 ">
              {getValue()}
            </Badge>
          ),
        }

        // Insert namespace column after select and first column (typically name)
        const columnsWithNamespace = [...baseColumns]
        columnsWithNamespace.splice(2, 0, namespaceColumn)
        return columnsWithNamespace
      }
    }
    return baseColumns
  }, [columns, clusterScope, selectedNamespace, t])

  const data = useMemo(() => {
    if (useSSE) return watchData
    return queryData
  }, [useSSE, watchData, queryData])
  const isLoading = useSSE ? watchLoading : queryLoading
  const isError = useSSE ? Boolean(watchError) : queryIsError
  const error = useSSE
    ? (watchError as Error | null)
    : (queryError as unknown as Error | null)
  const refetch = useSSE ? reconnectSSE : queryRefetch

  const memoizedData = useMemo(() => {
    let result = (data || []) as T[]

    // When query is empty, still apply external state-based filters
    // (e.g. pill buttons that live outside the search box)
    if (!searchQuery.trim()) {
      return searchQueryFilter ? result.filter(item => searchQueryFilter(item, '')) : result
    }

    const lowerQuery = searchQuery.toLowerCase().trim()

    // Headlamp-style query parsing
    const parts = lowerQuery.split(/\s+/).filter(Boolean)
    const filters: { type: string; value: string }[] = []

    parts.forEach(part => {
      if (part.includes(':')) {
        const [prefix, ...rest] = part.split(':')
        const value = rest.join(':')
        if (value) {
          filters.push({ type: prefix, value })
        }
      } else {
        filters.push({ type: 'text', value: part })
      }
    })

    if (filters.length > 0) {
      result = result.filter(item => {
        const metadata = (item as any)?.metadata || {}
        const status = (item as any)?.status

        return filters.every(f => {
          switch (f.type) {
            case 'n':
            case 'name':
              return metadata.name?.toLowerCase().includes(f.value)
            case 'ns':
            case 'namespace':
              return metadata.namespace?.toLowerCase().includes(f.value)
            case 'l':
            case 'label':
              const labels = metadata.labels || {}
              if (f.value.includes('=')) {
                const [lKey, lVal] = f.value.split('=')
                return labels[lKey]?.toLowerCase() === lVal.toLowerCase()
              }
              return Object.entries(labels).some(([k, v]) =>
                `${k}=${v}`.toLowerCase().includes(f.value)
              )
            case 's':
            case 'status':
              const sStr = typeof status === 'string'
                ? status
                : (status?.phase || status?.conditions?.[0]?.type || '')
              return String(sStr).toLowerCase().includes(f.value)
            case 't':
            case 'type':
              const type = (item as any)?.type || ''
              return String(type).toLowerCase().includes(f.value)
            default:
              if (searchQueryFilter) {
                return searchQueryFilter(item, f.value)
              }
              const itemStr = JSON.stringify(item).toLowerCase()
              return itemStr.includes(f.value)
          }
        })
      })
    }

    // When no search text but an external filter function exists (e.g. status pill buttons),
    // still apply it so external state-based filtering works even without typed query.
    if (filters.length === 0 && searchQueryFilter) {
      result = result.filter(item => searchQueryFilter(item, ''))
    }

    return result
  }, [data, searchQueryFilter, searchQuery])

  useEffect(() => {
    if (!useSSE && error) {
      setRefreshInterval(0)
    }
  }, [useSSE, error])

  // Create table instance using TanStack Table
  const table = useReactTable<T>({
    data: memoizedData,
    columns: enhancedColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => {
      const metadata = (
        row as {
          metadata?: { name?: string; namespace?: string; uid?: string }
        }
      )?.metadata
      if (!metadata?.name) {
        return `row-${Math.random()}`
      }
      return (
        metadata.uid ||
        (metadata.namespace
          ? `${metadata.namespace}/${metadata.name}`
          : metadata.name)
      )
    },
    state: {
      sorting,
      columnFilters,
      globalFilter: searchQuery,
      pagination,
      rowSelection,
      columnVisibility,
    },
    onPaginationChange: setPagination,
    // Let TanStack Table handle pagination automatically based on filtered data
    manualPagination: false,
    // Improve filtering performance and consistency
    globalFilterFn: (row, _columnId, value) => {
      if (searchQueryFilter) {
        return true // Already filtered in memoizedData
      }
      const searchValue = String(value).toLowerCase()

      // Search across all visible columns
      return row.getVisibleCells().some((cell) => {
        const cellValue = String(cell.getValue() || '').toLowerCase()
        return cellValue.includes(searchValue)
      })
    },
    // Add this to prevent unnecessary pagination resets
    autoResetPageIndex: false,
    enableRowSelection: true,
  })

  // Handle batch delete - must be after table is defined
  const handleBatchDelete = useCallback(async () => {
    setIsDeleting(true)
    const selectedRows = table
      .getSelectedRowModel()
      .rows.map((row) => row.original)

    const deletePromises = selectedRows.map((row) => {
      const metadata = (
        row as { metadata?: { name?: string; namespace?: string } }
      )?.metadata
      const name = metadata?.name
      const namespace = clusterScope ? undefined : metadata?.namespace

      if (!name) {
        return Promise.resolve()
      }

      return deleteResource(
        resourceType ?? (resourceName.toLowerCase() as ResourceType),
        name,
        namespace
      )
        .then(() => {
          toast.success(t('resourceTable.deleteSuccess', { name }))
        })
        .catch((error) => {
          console.error(`Failed to delete ${name}:`, error)
          toast.error(
            t('resourceTable.deleteFailed', { name, error: error.message })
          )
          throw error
        })
    })

    try {
      await Promise.allSettled(deletePromises)
      // Reset selection and close dialog
      setRowSelection({})
      setDeleteDialogOpen(false)
      // Refetch data
      if (!useSSE) {
        refetch()
      }
    } finally {
      setIsDeleting(false)
    }
  }, [table, clusterScope, resourceType, resourceName, t, useSSE, refetch])
  // Calculate total and filtered row counts
  const totalRowCount = useMemo(
    () => (data as T[] | undefined)?.length || 0,
    [data]
  )
  const filteredRowCount = useMemo(() => {
    if (!data || (data as T[]).length === 0) return 0
    // Force re-computation when filters change
    void searchQuery // Ensure dependency is used
    void columnFilters // Ensure dependency is used
    return table.getFilteredRowModel().rows.length
  }, [table, data, searchQuery, columnFilters])

  // Check if there are active filters
  const hasActiveFilters = useMemo(() => {
    return Boolean(searchQuery) || columnFilters.length > 0
  }, [searchQuery, columnFilters])

  // Render empty state based on condition
  const renderEmptyState = () => {
    // Only show loading state if there's no existing data
    if (isLoading && (!data || (data as T[]).length === 0)) {
      return (
        <div className="h-72 flex flex-col items-center justify-center">
          <div className="mb-4 bg-muted/30 p-6 rounded-full">
            <Database className="h-12 w-12 text-muted-foreground animate-pulse" />
          </div>
          <h3 className="text-lg font-medium mb-1">
            Loading {resourceName.toLowerCase()}...
          </h3>
          <p className="text-muted-foreground">
            Retrieving data
            {!clusterScope && selectedNamespace
              ? ` from ${selectedNamespace === '_all' ? 'All Namespaces' : `namespace ${selectedNamespace}`}`
              : ''}
          </p>
        </div>
      )
    }

    if (isError) {
      return (
        <ErrorMessage
          resourceName={resourceName}
          error={error}
          refetch={refetch}
        />
      )
    }

    if (data && (data as T[]).length === 0) {
      return (
        <div className="h-72 flex flex-col items-center justify-center">
          <div className="mb-4 bg-muted/30 p-6 rounded-full">
            <Box className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-1">
            No {resourceName.toLowerCase()} found
          </h3>
          <p className="text-muted-foreground">
            {searchQuery
              ? `No results match your search query: "${searchQuery}"`
              : clusterScope
                ? `There are no ${resourceName.toLowerCase()} found`
                : `There are no ${resourceName.toLowerCase()} in the ${selectedNamespace} namespace`}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setSearchQuery('')}
            >
              Clear Search
            </Button>
          )}
        </div>
      )
    }

    return null
  }

  const emptyState = renderEmptyState()

  return (
    <div className="flex flex-col gap-3 animate-page-enter">
      {/* Header: Title (left) + All Controls (right) */}
{}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 animate-fade-slide-in">
        {}
        <div className="shrink-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold capitalize tracking-tight">{resourceName}</h1>
            {data && (data as T[]).length > 0 && (
              <Badge variant="secondary" className="font-mono text-xs tabular-nums bg-muted/60">
                {(data as T[]).length}
              </Badge>
            )}
          </div>
          {!clusterScope && selectedNamespace && (
            <div className="text-muted-foreground flex items-center mt-1.5 text-sm">
              <span>Namespace:</span>
              <Badge variant="outline" className="ml-2 font-medium bg-primary/5 border-primary/20 text-primary">
                {selectedNamespace === '_all'
                  ? 'All Namespaces'
                  : selectedNamespace}
              </Badge>
            </div>
          )}
        </div>        {/* Controls column - two rows stacked */}
        <div className="flex flex-col gap-2 items-end min-w-0">
          {/* Row 1: Filters */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {extraToolbars?.map((toolbar, index) => (
              <React.Fragment key={index}>{toolbar}</React.Fragment>
            ))}
            {/* Watch/Live mode toggle switch */}
            {resourceName === 'Pods' && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">
                  {useSSE ? (
                    <ConnectionIndicator isConnected={isConnected}>
                      {t('resourceTable.watch')}
                    </ConnectionIndicator>
                  ) : (
                    t('resourceTable.watch')
                  )}
                </Label>
                <Switch
                  checked={useSSE}
                  onCheckedChange={(checked) => {
                    setUseSSE(checked)
                    if (checked) {
                      setRefreshInterval(0)
                    } else if (refreshInterval === 0) {
                      setRefreshInterval(5000)
                    }
                  }}
                />
              </div>
            )}
            {/* Refresh interval */}
            <Select
              value={refreshInterval.toString()}
              onValueChange={(value) => {
                setRefreshInterval(Number(value))
                if (Number(value) > 0) setUseSSE(false)
              }}
              disabled={useSSE}
            >
              <SelectTrigger className="h-9 w-[110px]">
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Off</SelectItem>
                <SelectItem value="1000">1s</SelectItem>
                <SelectItem value="5000">5s</SelectItem>
                <SelectItem value="10000">10s</SelectItem>
                <SelectItem value="30000">30s</SelectItem>
              </SelectContent>
            </Select>
            {!clusterScope && (
              <NamespaceSelector
                selectedNamespace={selectedNamespace}
                handleNamespaceChange={handleNamespaceChange}
                showAll={true}
              />
            )}
            {/* Column Filters as searchable comboboxes */}
            {table
              .getAllColumns()
              .filter((column) => {
                const columnDef = column.columnDef as ColumnDef<T> & {
                  enableColumnFilter?: boolean
                }
                return columnDef.enableColumnFilter && column.getCanFilter()
              })
              .map((column) => {
                const columnDef = column.columnDef as ColumnDef<T> & {
                  enableColumnFilter?: boolean
                }
                const uniqueValues = column.getFacetedUniqueValues()
                const filterValue = (column.getFilterValue() as string) || ''
                const headerLabel =
                  typeof columnDef.header === 'string' ? columnDef.header : 'Column'
                const colOptions = [
                  { value: 'all', label: `All ${headerLabel}s` },
                  ...Array.from(uniqueValues.keys())
                    .filter(Boolean)
                    .sort()
                    .map((v) => ({
                      value: String(v),
                      label: `${String(v)} (${uniqueValues.get(v)})`,
                    })),
                ]
                return (
                  <Combobox
                    key={column.id}
                    options={colOptions}
                    value={filterValue || 'all'}
                    onValueChange={(val: string) =>
                      column.setFilterValue(val === 'all' ? '' : val)
                    }
                    placeholder={`Filter ${headerLabel}`}
                    searchPlaceholder={`Search ${headerLabel}...`}
                    emptyText={`No ${headerLabel} found.`}
                    triggerClassName="h-9 max-w-[180px]"
                  />
                )
              })}
            {/* Label Filter */}
            {enableLabelFilter && (
              <div className="flex items-center gap-1">
                <div className="relative">
                  <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Labels: app=nginx"
                    value={localLabelFilter}
                    onChange={(e) => setLocalLabelFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setAppliedLabelFilter(localLabelFilter)
                      } else if (e.key === 'Escape') {
                        setLocalLabelFilter('')
                        setAppliedLabelFilter('')
                      }
                    }}
                    className="pl-8 h-9 w-[180px] text-xs"
                  />
                </div>
                {appliedLabelFilter && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      setLocalLabelFilter('')
                      setAppliedLabelFilter('')
                    }}
                    title="Clear label filter"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                )}
                {localLabelFilter !== appliedLabelFilter && localLabelFilter && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9 px-3 text-xs shrink-0"
                    onClick={() => setAppliedLabelFilter(localLabelFilter)}
                  >
                    Apply
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Search + Batch Actions + Create + Column Toggle */}
          <div className="flex items-center gap-2">
{}
            <div className="relative group/search focus-glow rounded-lg">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60 group-focus-within/search:text-primary transition-colors duration-200" />
              <Input
                ref={searchInputRef}
                placeholder={`Search ${resourceName.toLowerCase()}...`}
                value={displaySearchQuery}
                onChange={(e) => setDisplaySearchQuery(e.target.value)}
                className="pl-9 pr-4 w-[220px] focus:w-[280px] search-expand bg-muted/30 border-border/40 focus:bg-background focus:border-primary/40 shadow-sm"
              />
            </div>            {displaySearchQuery && (
              <Button variant="ghost" size="icon" onClick={() => setDisplaySearchQuery('')} className="h-9 w-9">
                <XCircle className="h-4 w-4" />
              </Button>
            )}
            {table.getSelectedRowModel().rows.length > 0 && (
              <div className="flex gap-2 animate-in fade-in slide-in-from-right-2">
                <div className="bg-primary/5 border border-primary/20 rounded-md p-1 flex gap-1">
                  {onBatchRestart && canAccess(resourceType || (resourceName.toLowerCase() as ResourceType), 'update', selectedNamespace || forcedNamespace) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original)
                        await onBatchRestart(selectedRows)
                        table.toggleAllRowsSelected(false)
                      }}
                      className="h-7 text-xs gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Restart ({table.getSelectedRowModel().rows.length})
                    </Button>
                  )}
                  {canAccess(resourceType || (resourceName.toLowerCase() as ResourceType), 'delete', selectedNamespace || forcedNamespace) && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteDialogOpen(true)}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete ({table.getSelectedRowModel().rows.length})
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRowSelection({})}
                    className="h-7 text-xs"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}
            {searchQuery && filteredRowCount > 0 && Object.keys(rowSelection).length < filteredRowCount && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 border-primary/30 text-primary hover:bg-primary/5"
                onClick={() => {
                  const newSelection: RowSelectionState = {}
                  table.getFilteredRowModel().rows.forEach(row => {
                    newSelection[row.id] = true
                  })
                  setRowSelection(newSelection)
                }}
              >
                Select All Matching ({filteredRowCount})
              </Button>
            )}
            {showCreateButton && onCreateClick && canAccess(resourceType || (resourceName.toLowerCase() as ResourceType), 'create', selectedNamespace || forcedNamespace) && (
              <Button onClick={onCreateClick} className="gap-1">
                <Plus className="h-2 w-2" />
                New
              </Button>
            )}
            {/* Toggle columns Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    const header = column.columnDef.header
                    const headerText = typeof header === 'string' ? header : column.id
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      >
                        {headerText}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {headerContent && headerContent(table.getFilteredRowModel().rows.map((row) => row.original))}

      <ResourceTableView
        table={table}
        columnCount={enhancedColumns.length}
        isLoading={isLoading}
        data={data as T[] | undefined}
        emptyState={emptyState}
        hasActiveFilters={hasActiveFilters}
        filteredRowCount={filteredRowCount}
        totalRowCount={totalRowCount}
        searchQuery={searchQuery}
        pagination={pagination}
        setPagination={setPagination}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resourceTable.confirmDeletion')}</DialogTitle>
            <DialogDescription>
              {t('resourceTable.confirmDeletionMessage', {
                count: table.getSelectedRowModel().rows.length,
                resourceName: resourceName.toLowerCase(),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={isDeleting}
            >
              {isDeleting ? t('resourceTable.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  )
}
