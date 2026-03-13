import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconAlertCircle, IconDownload, IconEye } from '@tabler/icons-react'
import {
  ColumnDef,
  getCoreRowModel,
  PaginationState,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { ResourceHistory } from '@/types/api'
import { useAuditLogs, useAuditLogDetail, useClusterList, useUserList, exportAuditLogs } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedHistory, setSelectedHistory] =
    useState<ResourceHistory | null>(null)
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null)
  const [isDiffOpen, setIsDiffOpen] = useState(false)
  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)

  // Fetch full audit detail (with YAML diffs) only when a specific entry is selected
  const { data: auditDetail, isLoading: isLoadingDetail } = useAuditLogDetail(
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
    undefined,
    undefined,
    undefined,
    undefined,
    startDate || undefined,
    endDate || undefined
  )

  useEffect(() => {
    if (!showCluster && clusterFilter) {
      setClusterFilter('')
    }
  }, [clusterFilter, showCluster])

  const handleUserFilterChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    if (value === 'all') {
      setOperatorId(undefined)
      return
    }
    const parsed = Number(value)
    setOperatorId(Number.isNaN(parsed) ? undefined : parsed)
  }, [])

  const handleSearchChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setSearchQuery(value)
  }, [])

  const handleOperationChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setOperationFilter(value === 'all' ? '' : value)
  }, [])

  const handleClusterChange = useCallback((value: string) => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    setClusterFilter(value === 'all' ? '' : value)
  }, [])

  const getOperationTypeColor = (operationType: string) => {
    switch (operationType.toLowerCase()) {
      case 'create':
        return 'default'
      case 'update':
        return 'secondary'
      case 'delete':
        return 'destructive'
      case 'apply':
        return 'outline'
      default:
        return 'secondary'
    }
  }

  const getOperationTypeLabel = useCallback(
    (operationType: string) => {
      switch (operationType.toLowerCase()) {
        case 'create':
          return t('resourceHistory.create')
        case 'update':
          return t('resourceHistory.update')
        case 'delete':
          return t('resourceHistory.delete')
        case 'apply':
          return t('resourceHistory.apply')
        default:
          return operationType
      }
    },
    [t]
  )

  const columns = useMemo<ColumnDef<ResourceHistory>[]>(
    () => [
      {
        id: 'time',
        header: t('auditLog.table.time', 'Time'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'operator',
        header: t('auditLog.table.operator', 'Operator'),
        cell: ({ row }) => (
          <div className="font-medium">
            {row.original.operator?.username || '-'}
            {row.original.operator?.provider === 'api_key' && (
              <span className="ml-2 text-xs text-muted-foreground italic">
                apikey
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'operationType',
        header: t('auditLog.table.operation', 'Operation'),
        cell: ({ row }) => (
          <Badge variant={getOperationTypeColor(row.original.operationType)}>
            {getOperationTypeLabel(row.original.operationType)}
          </Badge>
        ),
      },
      {
        id: 'resource',
        header: t('auditLog.table.resource', 'Resource'),
        cell: ({ row }) => {
          const resource = row.original
          const name = resource.namespace
            ? `${resource.namespace}/${resource.resourceName}`
            : resource.resourceName
          return (
            <div className="text-sm">
              <div className="font-medium">{name || '-'}</div>
              <div className="text-muted-foreground text-xs">
                {resource.resourceType || '-'}
              </div>
            </div>
          )
        },
      },
      ...(showCluster
        ? [
            {
              id: 'cluster',
              header: t('auditLog.table.cluster', 'Cluster'),
              cell: ({ row }: { row: { original: ResourceHistory } }) => (
                <span className="text-sm text-muted-foreground">
                  {row.original.clusterName || '-'}
                </span>
              ),
            },
          ]
        : []),
      {
        id: 'status',
        header: t('auditLog.table.status', 'Status'),
        cell: ({ row }) => (
          <Badge variant={row.original.success ? 'default' : 'destructive'}>
            {row.original.success
              ? t('auditLog.status.success', 'Success')
              : t('auditLog.status.failed', 'Failed')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: t('auditLog.table.actions', 'Actions'),
        cell: ({ row }) => {
          const item = row.original
          if (!item.success) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedHistory(item)
                  setIsErrorDialogOpen(true)
                }}
                disabled={!item.errorMessage}
              >
                <IconAlertCircle className="w-4 h-4 mr-1" />
                {t('auditLog.actions.viewError', 'View Error')}
              </Button>
            )
          }
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedHistory(item)
                setSelectedHistoryId(item.id)
                setIsDiffOpen(true)
              }}
            >
              <IconEye className="w-4 h-4 mr-1" />
              {t('auditLog.actions.viewDiff', 'View Diff')}
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
    if (isLoading) {
      return (
        <div className="py-10 text-center text-muted-foreground">
          {t('auditLog.loading', 'Loading audit logs...')}
        </div>
      )
    }
    if (error) {
      return (
        <div className="py-10 text-center">
          <p className="text-destructive font-medium">
            {t('auditLog.loadFailed', 'Failed to load audit logs')}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            {error.message || 'An unknown error occurred. Check that you have admin access.'}
          </p>
        </div>
      )
    }
    if ((auditData?.data.length ?? 0) === 0) {
      return (
        <div className="py-10 text-center text-muted-foreground">
          {t('auditLog.empty', 'No audit logs found')}
        </div>
      )
    }
    return null
  })()

  const totalRowCount = auditData?.total ?? 0
  const filteredRowCount = auditData?.data.length ?? 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('auditLog.title', 'Audit Logs')}</CardTitle>
            <p className="text-muted-foreground text-sm">
              {t(
                'auditLog.description',
                'Track who changed resources and review YAML diffs'
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder={t(
                'auditLog.filters.search',
                'Search resource name...'
              )}
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="w-56"
            />
            <Select
              value={operationFilter || 'all'}
              onValueChange={handleOperationChange}
            >
              <SelectTrigger className="w-40">
                <SelectValue
                  placeholder={t(
                    'auditLog.filters.operation',
                    'All operations'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('auditLog.filters.allOperations', 'All operations')}
                </SelectItem>
                <SelectItem value="create">
                  {t('resourceHistory.create')}
                </SelectItem>
                <SelectItem value="update">
                  {t('resourceHistory.update')}
                </SelectItem>
                <SelectItem value="delete">
                  {t('resourceHistory.delete')}
                </SelectItem>
                <SelectItem value="apply">
                  {t('resourceHistory.apply')}
                </SelectItem>
                <SelectItem value="patch">
                  {t('resourceHistory.patch')}
                </SelectItem>
              </SelectContent>
            </Select>
            {showCluster && (
              <Select
                value={clusterFilter || 'all'}
                onValueChange={handleClusterChange}
              >
                <SelectTrigger className="w-48">
                  <SelectValue
                    placeholder={t('auditLog.filters.cluster', 'All clusters')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('auditLog.filters.allClusters', 'All clusters')}
                  </SelectItem>
                  {clusters.map((cluster) => (
                    <SelectItem key={cluster.name} value={cluster.name}>
                      {cluster.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={operatorId ? String(operatorId) : 'all'}
              onValueChange={handleUserFilterChange}
            >
              <SelectTrigger className="w-48">
                <SelectValue
                  placeholder={t('auditLog.filters.user', 'All users')}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('auditLog.filters.allUsers', 'All users')}
                </SelectItem>
                {(usersData?.users ?? []).map((user) => (
                  <SelectItem key={user.id} value={String(user.id)}>
                    {user.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              placeholder="Start date"
              className="w-36"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              placeholder="End date"
              className="w-36"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      exportAuditLogs({
                        operation: operationFilter || undefined,
                        cluster: clusterFilter || undefined,
                        search: searchQuery || undefined,
                        startDate: startDate || undefined,
                        endDate: endDate || undefined,
                      })
                    }
                  >
                    <IconDownload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t('auditLog.actions.export', 'Export CSV')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResourceTableView
          table={table}
          columnCount={columns.length}
          isLoading={isLoading}
          data={auditData?.data}
          allPageSize={totalRowCount}
          emptyState={emptyState}
          hasActiveFilters={
            Boolean(operatorId) ||
            Boolean(searchQuery) ||
            Boolean(operationFilter) ||
            (showCluster && Boolean(clusterFilter))
          }
          filteredRowCount={filteredRowCount}
          totalRowCount={totalRowCount}
          searchQuery={searchQuery}
          pagination={pagination}
          setPagination={setPagination}
          maxBodyHeightClassName="max-h-[600px]"
        />
      </CardContent>

      {selectedHistory && (
        <YamlDiffViewer
          open={isDiffOpen}
          onOpenChange={(open) => {
            setIsDiffOpen(open)
            if (!open) {
              setSelectedHistory(null)
              setSelectedHistoryId(null)
            }
          }}
          original={(auditDetail?.previousYaml || selectedHistory.previousYaml) || ''}
          modified={(auditDetail?.resourceYaml || selectedHistory.resourceYaml) || ''}
          title={`${t('auditLog.diffTitle', 'YAML Diff')} — ${selectedHistory.resourceType}/${selectedHistory.resourceName}`}
          height={560}
        />
      )}

      <Dialog
        open={isErrorDialogOpen}
        onOpenChange={(open) => {
          setIsErrorDialogOpen(open)
          if (!open) {
            setSelectedHistory(null)
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t('auditLog.errorTitle', 'Error Details')}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {selectedHistory?.errorMessage ||
              t('auditLog.noErrorMessage', 'No error message')}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
