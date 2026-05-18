import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconAlertCircle, IconDownload, IconEye, IconGlobe, IconFilter, IconX, IconCalendar, IconTrash, IconHistory } from '@tabler/icons-react'
import {
  ColumnDef,
  getCoreRowModel,
  PaginationState,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { ResourceHistory } from '@/types/api'
import {
  useAuditLogs,
  useAuditLogDetail,
  useClusterList,
  useUserList,
  exportAuditLogs,
  applyResource,
  purgeOldAuditLogs,
  useAuditFilterOptions,
} from '@/lib/api'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ResourceTableView } from '@/components/resource-table-view'
import { YamlDiffViewer } from '@/components/yaml-diff-viewer'
import { toast } from 'sonner'

const OP_COLORS: Record<string, { badge: string; dot: string }> = {
  create: { badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25', dot: 'bg-emerald-500' },
  update: { badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25', dot: 'bg-blue-500' },
  delete: { badge: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25', dot: 'bg-red-500' },
  patch: { badge: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25', dot: 'bg-sky-500' },
  apply: { badge: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25', dot: 'bg-violet-500' },
  rollback: { badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25', dot: 'bg-amber-500' },
  restart: { badge: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25', dot: 'bg-orange-500' },
}

function getOpColor(op: string) {
  return OP_COLORS[op.toLowerCase()] || { badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' }
}

export function AuditLog() {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [operatorId, setOperatorId] = useState<number | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [operationFilter, setOperationFilter] = useState('')
  const [clusterFilter, setClusterFilter] = useState('')
  const [resourceTypeFilter, setResourceTypeFilter] = useState('')
  const [namespaceFilter, setNamespaceFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedHistory, setSelectedHistory] = useState<ResourceHistory | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [isDiffOpen, setIsDiffOpen] = useState(false)
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [isPurging, setIsPurging] = useState(false)
  const [purgeRetentionDays, setPurgeRetentionDays] = useState(90)
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const { data: filterOptions } = useAuditFilterOptions()

  const { data: auditDetail } = useAuditLogDetail(
    selectedHistoryId,
    { enabled: selectedHistoryId !== null && selectedHistoryId > 0 && isDiffOpen }
  )

  const { data: usersData } = useUserList(1, 200)
  const { data: clusters = [] } = useClusterList()
  const showCluster = clusters.length > 1
  const {
    data: auditData,
    isLoading,
    error,
  } = useAuditLogs(
    pagination.pageIndex + 1,
    pagination.pageSize,
    operatorId,
    searchQuery,
    operationFilter || undefined,
    showCluster ? clusterFilter || undefined : undefined,
    resourceTypeFilter || undefined,
    undefined,
    namespaceFilter || undefined,
    undefined,
    startDate || undefined,
    endDate || undefined
  )

  useEffect(() => {
    if (!showCluster && clusterFilter) setClusterFilter('')
  }, [clusterFilter, showCluster])

  const resetPage = () => setPagination((prev) => ({ ...prev, pageIndex: 0 }))

  const handleUserFilterChange = useCallback((value: string) => {
    resetPage()
    setOperatorId(value === 'all' ? undefined : Number(value) || undefined)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    resetPage()
    setSearchQuery(value)
  }, [])

  const handleOperationChange = useCallback((value: string) => {
    resetPage()
    setOperationFilter(value === 'all' ? '' : value)
  }, [])

  const handleClusterChange = useCallback((value: string) => {
    resetPage()
    setClusterFilter(value === 'all' ? '' : value)
  }, [])

  const handleResourceTypeChange = useCallback((value: string) => {
    resetPage()
    setResourceTypeFilter(value === 'all' ? '' : value)
  }, [])

  const handleNamespaceChange = useCallback((value: string) => {
    resetPage()
    setNamespaceFilter(value === 'all' ? '' : value)
  }, [])

  const getOperationTypeLabel = useCallback((operationType: string) => {
    switch (operationType.toLowerCase()) {
      case 'create': return t('resourceHistory.create')
      case 'update': return t('resourceHistory.update')
      case 'delete': return t('resourceHistory.delete')
      case 'apply': return t('resourceHistory.apply')
      default: return operationType
    }
  }, [t])

  const columns = useMemo<ColumnDef<ResourceHistory>[]>(
    () => [
      {
        id: 'time',
        header: t('auditLog.table.time', 'Time'),
        meta: { width: '12%' },
        cell: ({ row }) => {
          const date = new Date(row.original.createdAt)
          return (
            <div className="flex flex-col">
              <span className="text-xs font-medium tabular-nums">{date.toLocaleTimeString()}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{date.toLocaleDateString()}</span>
            </div>
          )
        },
      },
      {
        id: 'operator',
        header: t('auditLog.table.operator', 'Operator'),
        meta: { width: '20%' },
        cell: ({ row }) => (
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary uppercase shrink-0">
              {(row.original.operator?.username || '?')[0]}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{row.original.operator?.username || row.original.operator?.email || '-'}</div>
              {row.original.operator?.provider === 'api_key' && (
                <span className="text-[10px] text-muted-foreground">via API key</span>
              )}
            </div>
          </div>
        ),
      },
      {
        id: 'operationType',
        header: t('auditLog.table.operation', 'Operation'),
        meta: { width: '10%' },
        cell: ({ row }) => {
          const op = row.original.operationType.toLowerCase()
          const colors = getOpColor(op)
          return (
            <Badge variant="outline" className={`${colors.badge} text-[10px] font-semibold uppercase tracking-wider gap-1.5`}>
              <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
              {getOperationTypeLabel(row.original.operationType)}
            </Badge>
          )
        },
      },
      {
        id: 'resource',
        header: t('auditLog.table.resource', 'Resource'),
        meta: { width: '26%' },
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-[9px] h-4 px-1 font-mono shrink-0">{r.resourceType || '?'}</Badge>
                <span className="text-sm font-medium truncate">{r.resourceName || '-'}</span>
              </div>
              {r.namespace && (
                <span className="text-[10px] text-muted-foreground">ns: {r.namespace}</span>
              )}
            </div>
          )
        },
      },
      ...(showCluster
        ? [{
            id: 'cluster' as const,
            header: t('auditLog.table.cluster', 'Cluster'),
            meta: { width: '10%' },
            cell: ({ row }: { row: { original: ResourceHistory } }) => (
              <Badge variant="outline" className="text-[10px] font-mono truncate">{row.original.clusterName || '-'}</Badge>
            ),
          }]
        : []),
      {
        id: 'status',
        header: t('auditLog.table.status', 'Status'),
        meta: { width: '12%' },
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            {row.original.success ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 text-[10px] gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {t('auditLog.status.success', 'Success')}
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                {t('auditLog.status.failed', 'Failed')}
              </Badge>
            )}
            {row.original.sourceIP && (
              <span className="text-[9px] text-muted-foreground font-mono flex items-center gap-0.5">
                <IconGlobe className="h-2.5 w-2.5" />
                {row.original.sourceIP}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'actions',
        header: t('auditLog.table.actions', 'Actions'),
        meta: { width: '80px' },
        cell: ({ row }) => {
          const item = row.original
          if (!item.success) {
            return (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 hover:bg-red-500/10 hover:text-red-600"
                onClick={() => { setSelectedHistory(item); setIsErrorDialogOpen(true) }}
                disabled={!item.errorMessage}
              >
                <IconAlertCircle className="w-3.5 h-3.5" />
                Error
              </Button>
            )
          }
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary"
              onClick={() => {
                setSelectedHistory(item)
                setSelectedHistoryId(item.id)
                setIsDiffOpen(true)
              }}
            >
              <IconEye className="w-3.5 h-3.5" />
              Diff
            </Button>
          )
        },
      },
    ],
    [getOperationTypeLabel, showCluster, t]
  )

  const table = useReactTable({
    data: auditData?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
    pageCount: Math.ceil((auditData?.total ?? 0) / pagination.pageSize) || 0,
  })

  const emptyState = (() => {
    if (isLoading) return <div className="py-16 text-center text-muted-foreground text-sm">{t('auditLog.loading', 'Loading audit logs...')}</div>
    if (error) return (
      <div className="py-16 text-center">
        <p className="text-destructive font-medium">{t('auditLog.loadFailed', 'Failed to load audit logs')}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{error.message || 'Check admin access.'}</p>
      </div>
    )
    if ((auditData?.data.length ?? 0) === 0) return (
      <div className="py-16 text-center text-muted-foreground">
        <IconHistory className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">{t('auditLog.empty', 'No audit logs found')}</p>
        <p className="text-xs mt-1 opacity-70">Adjust your filters or wait for resource changes to be recorded.</p>
      </div>
    )
    return null
  })()

  const totalRowCount = auditData?.total ?? 0
  const filteredRowCount = auditData?.data.length ?? 0

  const handlePurge = async () => {
    if (isPurging) return
    setIsPurging(true)
    try {
      const result = await purgeOldAuditLogs(purgeRetentionDays)
      toast.success(result.message)
      setShowPurgeConfirm(false)
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to purge audit logs')
    } finally {
      setIsPurging(false)
    }
  }

  const activeFilterCount = [operationFilter, clusterFilter, resourceTypeFilter, namespaceFilter, operatorId, searchQuery, startDate, endDate].filter(Boolean).length

  const clearAllFilters = () => {
    setOperationFilter(''); setClusterFilter(''); setResourceTypeFilter(''); setNamespaceFilter('')
    setOperatorId(undefined); setSearchQuery(''); setStartDate(''); setEndDate('')
    resetPage()
  }

  return (
    <div className="space-y-4 animate-page-enter">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t('auditLog.title', 'Audit Logs')}</h2>
          <p className="text-muted-foreground text-sm mt-0.5">{t('auditLog.description', 'Track who changed resources and review YAML diffs')}</p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => exportAuditLogs({
                    operation: operationFilter || undefined,
                    cluster: showCluster ? (clusterFilter || undefined) : undefined,
                    operatorId: operatorId || undefined,
                    search: searchQuery || undefined,
                    resourceType: resourceTypeFilter || undefined,
                    namespace: namespaceFilter || undefined,
                    startDate: startDate || undefined,
                    endDate: endDate || undefined,
                  })}
                >
                  <IconDownload className="h-3.5 w-3.5" />
                  Export
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('auditLog.actions.export', 'Export filtered logs as CSV')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={() => setShowPurgeConfirm(true)}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  Purge
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete old audit log entries</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Input
              placeholder={t('auditLog.filters.search', 'Search resource name...')}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-9 pl-3 pr-8 text-sm"
            />
            {searchQuery && (
              <button onClick={() => handleSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <IconX className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={operationFilter || 'all'} onValueChange={handleOperationChange}>
            <SelectTrigger className="h-9 w-[135px]">
              <SelectValue placeholder={t('auditLog.filters.operation', 'Operation')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('auditLog.filters.allOperations', 'All operations')}</SelectItem>
              <SelectItem value="create">{t('resourceHistory.create')}</SelectItem>
              <SelectItem value="update">{t('resourceHistory.update')}</SelectItem>
              <SelectItem value="delete">{t('resourceHistory.delete')}</SelectItem>
              <SelectItem value="apply">{t('resourceHistory.apply')}</SelectItem>
              <SelectItem value="patch">{t('resourceHistory.patch')}</SelectItem>
              <SelectItem value="rollback">Rollback</SelectItem>
              <SelectItem value="restart">Restart</SelectItem>
            </SelectContent>
          </Select>

          <Select value={operatorId ? String(operatorId) : 'all'} onValueChange={handleUserFilterChange}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue placeholder={t('auditLog.filters.user', 'All users')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('auditLog.filters.allUsers', 'All users')}</SelectItem>
              {(usersData?.users ?? []).map(user => (
                <SelectItem key={user.id} value={String(user.id)}>{user.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showCluster && (
            <Select value={clusterFilter || 'all'} onValueChange={handleClusterChange}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue placeholder={t('auditLog.filters.cluster', 'All clusters')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('auditLog.filters.allClusters', 'All clusters')}</SelectItem>
                {clusters.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            className="h-9 gap-1.5 relative"
            onClick={() => setShowFilters(prev => !prev)}
          >
            <IconFilter className="h-3.5 w-3.5" />
            More
            {activeFilterCount > 2 && (
              <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </Button>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground gap-1" onClick={clearAllFilters}>
              <IconX className="h-3 w-3" />
              Clear all
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
            <Select value={resourceTypeFilter || 'all'} onValueChange={handleResourceTypeChange}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Resource Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resource types</SelectItem>
                {(filterOptions?.resourceTypes ?? []).sort().map(rt => <SelectItem key={rt} value={rt}>{rt}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={namespaceFilter || 'all'} onValueChange={handleNamespaceChange}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="Namespace" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All namespaces</SelectItem>
                {(filterOptions?.namespaces ?? []).sort().map(ns => <SelectItem key={ns} value={ns}>{ns}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <IconCalendar className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="date" value={startDate}
                onChange={e => { setStartDate(e.target.value); resetPage() }}
                className="h-8 w-[130px] text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date" value={endDate}
                onChange={e => { setEndDate(e.target.value); resetPage() }}
                className="h-8 w-[130px] text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <ResourceTableView
        table={table}
        columnCount={columns.length}
        isLoading={isLoading}
        data={auditData?.data}
        allPageSize={totalRowCount}
        emptyState={emptyState}
        hasActiveFilters={activeFilterCount > 0}
        filteredRowCount={filteredRowCount}
        totalRowCount={totalRowCount}
        searchQuery={searchQuery}
        pagination={pagination}
        setPagination={setPagination}
        maxBodyHeightClassName="max-h-[calc(100vh-340px)]"
      />

      {/* Diff Viewer */}
      {selectedHistory && (
        <YamlDiffViewer
          open={isDiffOpen}
          onOpenChange={(open) => {
            setIsDiffOpen(open)
            if (!open) { setSelectedHistory(null); setSelectedHistoryId(null) }
          }}
          original={(auditDetail?.previousYaml || selectedHistory.previousYaml) || ''}
          modified={(auditDetail?.resourceYaml || selectedHistory.resourceYaml) || ''}
          current={(auditDetail?.resourceYaml || selectedHistory.resourceYaml) || ''}
          title={`${t('auditLog.diffTitle', 'YAML Diff')} \u2014 ${selectedHistory.resourceType}/${selectedHistory.resourceName}`}
          height={560}
          onRollback={async (yamlContent: string) => {
            try {
              setIsRollingBack(true)
              await applyResource(yamlContent)
              toast.success(t('resourceHistory.rollback.success', 'Successfully rolled back resource'))
              setIsDiffOpen(false); setSelectedHistory(null); setSelectedHistoryId(null)
            } catch (err) {
              toast.error(`${t('resourceHistory.rollback.error', 'Failed to rollback')}: ${err instanceof Error ? err.message : 'Unknown error'}`)
            } finally {
              setIsRollingBack(false)
            }
          }}
          isRollingBack={isRollingBack}
        />
      )}

      {/* Error Dialog */}
      <Dialog open={isErrorDialogOpen} onOpenChange={(open) => { setIsErrorDialogOpen(open); if (!open) setSelectedHistory(null) }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('auditLog.errorTitle', 'Error Details')}</DialogTitle>
          </DialogHeader>
          <pre className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap bg-red-500/5 rounded-lg p-4 font-mono leading-relaxed border border-red-500/10 max-h-[400px] overflow-auto">
            {selectedHistory?.errorMessage || t('auditLog.noErrorMessage', 'No error message')}
          </pre>
        </DialogContent>
      </Dialog>

      {/* Purge Confirmation Dialog */}
      <Dialog open={showPurgeConfirm} onOpenChange={setShowPurgeConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconTrash className="h-5 w-5 text-destructive" />
              Purge Old Audit Logs
            </DialogTitle>
            <DialogDescription>
              This will permanently delete audit log entries older than the selected period. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 py-2">
            <span className="text-sm text-muted-foreground">Delete entries older than</span>
            <Select value={String(purgeRetentionDays)} onValueChange={(v) => setPurgeRetentionDays(Number(v))}>
              <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[7, 30, 60, 90, 180, 365].map(d => (
                  <SelectItem key={d} value={String(d)}>{d === 365 ? '1 year' : `${d} days`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPurgeConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handlePurge} disabled={isPurging}>
              {isPurging ? 'Purging...' : 'Purge Logs'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

