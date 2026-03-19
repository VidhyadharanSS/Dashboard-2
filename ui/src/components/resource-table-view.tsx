import React, { useMemo } from 'react'
import {
  flexRender,
  PaginationState,
  Table as TableInstance,
} from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ResourceTableViewProps<T> {
  table: TableInstance<T>
  columnCount: number
  isLoading: boolean
  data?: T[]
  allPageSize?: number
  maxBodyHeightClassName?: string
  containerClassName?: string
  emptyState: React.ReactNode
  hasActiveFilters: boolean
  filteredRowCount: number
  totalRowCount: number
  searchQuery: string
  pagination: PaginationState
  setPagination: React.Dispatch<React.SetStateAction<PaginationState>>
}

const Highlight = ({ text, query }: { text: string; query: string }) => {
  if (!query.trim()) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary/20 text-primary font-bold px-0.5 rounded">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

const ResourceTableRow = React.memo(({ row, searchQuery, isSelected, rowIndex }: { row: any; searchQuery: string; isSelected: boolean; rowIndex: number }) => (
  <TableRow
    data-state={isSelected && 'selected'}
    className="transition-all duration-150 hover:bg-accent/40 group/row"
    style={{ '--stagger-index': rowIndex } as React.CSSProperties}
  >
    {row.getVisibleCells().map((cell: any, index: number) => {
      const content = cell.column.columnDef.cell
        ? flexRender(cell.column.columnDef.cell, cell.getContext())
        : String(cell.getValue() || '-')

      return (
        <TableCell
          key={cell.id}
          className={`align-middle ${index <= 1 ? 'text-left' : 'text-center'}`}
        >
          {typeof content === 'string' ? (
            <Highlight text={content} query={searchQuery} />
          ) : (
            content
          )}
        </TableCell>
      )
    })}
  </TableRow>
), (prev, next) => {
  return prev.isSelected === next.isSelected && prev.searchQuery === next.searchQuery && prev.row.id === next.row.id && prev.rowIndex === next.rowIndex
})

export function ResourceTableView<T>({
  table,
  columnCount,
  isLoading,
  data,
  allPageSize,
  maxBodyHeightClassName = 'max-h-[calc(100vh-210px)]',
  containerClassName = 'flex flex-col gap-3',
  emptyState,
  hasActiveFilters,
  filteredRowCount,
  totalRowCount,
  searchQuery,
  pagination,
  setPagination,
}: ResourceTableViewProps<T>) {
  const renderRows = () => {
    const rows = table.getRowModel().rows

    if (rows.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={columnCount} className="h-24 text-center">
            No results.
          </TableCell>
        </TableRow>
      )
    }

    return rows.map((row, index) => (
      <ResourceTableRow
        key={row.id}
        row={row}
        searchQuery={searchQuery}
        isSelected={row.getIsSelected()}
        rowIndex={index}
      />
    ))
  }

  const matchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0
    let count = 0
    const rows = table.getRowModel().rows
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedQuery, 'gi')

    rows.forEach(row => {
      row.getVisibleCells().forEach(cell => {
        const val = cell.getValue()
        if (typeof val === 'string') {
          const matches = val.match(regex)
          if (matches) count += matches.length
        }
      })
    })
    return count
  }, [table, searchQuery])

  const renderSkeletonRows = () => {
    return Array.from({ length: 5 }).map((_, i) => (
      <TableRow key={`skeleton-${i}`}>
        {table.getAllLeafColumns().map((col, index) => (
          <TableCell
            key={col.id}
            className={`align-middle ${index <= 1 ? 'text-left' : 'text-center'}`}
          >
            <Skeleton className="h-4 w-full opacity-50" />
          </TableCell>
        ))}
      </TableRow>
    ))
  }

  const dataLength = data?.length ?? 0
  const resolvedAllPageSize = allPageSize ?? dataLength

  return (
    <div className={containerClassName}>
      <div className="rounded-xl border border-border/50 overflow-hidden shadow-sm card-elevated card-shine">
        {isLoading && dataLength > 0 && <div className="loading-bar" />}
        <div
          className={`transition-opacity duration-300 ${isLoading && dataLength > 0 ? 'opacity-70' : 'opacity-100'
            }`}
        >
          {emptyState || (
            <div
              className={`relative ${maxBodyHeightClassName} overflow-auto scrollbar-hide`}
            >
              <Table>
                <TableHeader className="bg-muted/40 backdrop-blur-sm sticky top-0 z-10 border-b shadow-[0_1px_0_oklch(0_0_0/0.03)]">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header, index) => (
                        <TableHead
                          key={header.id}
                          className={index <= 1 ? 'text-left' : 'text-center'}
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <Button
                              variant="ghost"
                              onClick={header.column.getToggleSortingHandler()}
                              className={
                                header.column.getIsSorted()
                                  ? 'text-primary'
                                  : ''
                              }
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                              {header.column.getIsSorted() && (
                                <span className="ml-2">
                                  {header.column.getIsSorted() === 'asc'
                                    ? '↑'
                                    : '↓'}
                                </span>
                              )}
                            </Button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody className="**:data-[slot=table-cell]:first:w-0">
                  {isLoading && dataLength === 0 ? (
                    renderSkeletonRows()
                  ) : (
                    renderRows()
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {dataLength > 0 && (
        <div className="flex items-center justify-between px-2 py-1 animate-fade-slide-in">
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {hasActiveFilters ? (
              <>
                Showing {filteredRowCount} of {totalRowCount} row(s)
                {searchQuery && (
                  <span className="ml-1">
                    (filtered by "{searchQuery}" — <strong>{matchCount}</strong> match{matchCount !== 1 ? 'es' : ''} found)
                  </span>
                )}
              </>
            ) : (
              `${totalRowCount} row(s) total.`
            )}
          </div>
          <div className="flex w-full items-center gap-4 lg:w-fit">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Rows per page:
              </span>
              <Select
                value={pagination.pageSize.toString()}
                onValueChange={(value) => {
                  setPagination((prev) => ({
                    ...prev,
                    pageSize: Number(value),
                    pageIndex: 0,
                  }))
                }}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                  {resolvedAllPageSize > 0 && resolvedAllPageSize > 100 && (
                    <SelectItem value={`${resolvedAllPageSize}`}>
                      All ({resolvedAllPageSize})
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>←
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>→
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
