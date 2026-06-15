import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  type PaginationState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { cn } from '../lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table'
import { Button } from './button'
import { Skeleton } from './skeleton'

export type { ColumnDef }

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Show pagination controls */
  pagination?: boolean
  /** Enable row selection with checkboxes */
  rowSelection?: boolean
  /** Called when selected row IDs change */
  onSelectionChange?: (selectedIds: string[]) => void
  /** Loading state — shows skeleton rows */
  isLoading?: boolean
  /** Empty state content */
  emptyMessage?: string
  /** Caption for accessibility */
  caption?: string
  /** Page size for pagination */
  pageSize?: number
  className?: string
}

function SortIcon({ direction }: { direction: 'asc' | 'desc' | false }) {
  if (!direction) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ml-1 opacity-40"
        aria-hidden="true"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <polyline points="19 12 12 19 5 12" />
      </svg>
    )
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1"
      aria-hidden="true"
    >
      {direction === 'asc' ? (
        <polyline points="18 15 12 9 6 15" />
      ) : (
        <polyline points="6 9 12 15 18 9" />
      )}
    </svg>
  )
}

export function DataTable<TData, TValue>({
  columns,
  data,
  pagination = false,
  rowSelection: enableRowSelection = false,
  onSelectionChange,
  isLoading = false,
  emptyMessage = 'No results found.',
  caption,
  pageSize = 10,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelectionState, setRowSelectionState] = useState<RowSelectionState>({})
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pagination && { getPaginationRowModel: getPaginationRowModel() }),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater) => {
      const newState =
        typeof updater === 'function' ? updater(rowSelectionState) : updater
      setRowSelectionState(newState)
      if (onSelectionChange) {
        const selectedIds = Object.keys(newState).filter((k) => newState[k])
        onSelectionChange(selectedIds)
      }
    },
    onPaginationChange: setPaginationState,
    state: {
      sorting,
      columnVisibility,
      rowSelection: rowSelectionState,
      ...(pagination && { pagination: paginationState }),
    },
    enableRowSelection,
  })

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        <Skeleton variant="table" rows={pageSize > 5 ? 5 : pageSize} />
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      <Table>
        {caption && <caption className="mt-0 mb-2 text-sm text-muted-foreground text-left">{caption}</caption>}
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const isSortable = header.column.getCanSort()
                const sortDir = header.column.getIsSorted()
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={
                      sortDir === 'asc'
                        ? 'ascending'
                        : sortDir === 'desc'
                        ? 'descending'
                        : isSortable
                        ? 'none'
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : isSortable ? (
                      <button
                        className="inline-flex items-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[44px]"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${header.column.id}`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon direction={sortDir} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {pagination && (
        <div className="flex items-center justify-between py-2">
          <div className="text-sm text-muted-foreground">
            {enableRowSelection && (
              <>
                {table.getFilteredSelectedRowModel().rows.length} of{' '}
                {table.getFilteredRowModel().rows.length} row(s) selected.{' '}
              </>
            )}
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
