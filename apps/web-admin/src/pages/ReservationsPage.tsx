import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  type ColumnDef,
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  Skeleton,
} from '@rcm/ui'
import { Input } from '@rcm/ui'
import { useAdminStore } from '../store/adminStore'

type Reservation = {
  reservation_id: string
  confirmation_number: string
  customer_name: string
  pickup_date: string
  class_name: string
  status: string
  source: string
  total: number
  currency_code: string
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'default' | 'outline'> = {
  CONFIRMED: 'success',
  ON_RENT: 'default',
  PENDING: 'warning',
  CANCELLED: 'destructive',
  NO_SHOW: 'destructive',
  CLOSED: 'outline',
  QUOTE: 'outline',
}

const SOURCE_VARIANTS: Record<string, 'default' | 'outline'> = {
  DIRECT: 'default',
  OTA: 'outline',
  WALK_IN: 'outline',
  API: 'outline',
}

const MOCK_RESERVATIONS: Reservation[] = [
  { reservation_id: '1', confirmation_number: 'CNF-ABC001', customer_name: 'Alice Johnson', pickup_date: '2026-06-20', class_name: 'Economy', status: 'CONFIRMED', source: 'DIRECT', total: 189.99, currency_code: 'USD' },
  { reservation_id: '2', confirmation_number: 'CNF-ABC002', customer_name: 'Bob Smith', pickup_date: '2026-06-21', class_name: 'SUV', status: 'ON_RENT', source: 'OTA', total: 447.50, currency_code: 'USD' },
  { reservation_id: '3', confirmation_number: 'CNF-ABC003', customer_name: 'Carol Davis', pickup_date: '2026-06-22', class_name: 'Standard', status: 'PENDING', source: 'DIRECT', total: 267.00, currency_code: 'USD' },
  { reservation_id: '4', confirmation_number: 'CNF-ABC004', customer_name: 'Dan Wilson', pickup_date: '2026-06-18', class_name: 'Economy', status: 'CANCELLED', source: 'DIRECT', total: 0, currency_code: 'USD' },
  { reservation_id: '5', confirmation_number: 'CNF-ABC005', customer_name: 'Eve Martinez', pickup_date: '2026-06-19', class_name: 'Luxury', status: 'CLOSED', source: 'WALK_IN', total: 825.00, currency_code: 'USD' },
]

const columns: ColumnDef<Reservation, unknown>[] = [
  {
    accessorKey: 'confirmation_number',
    header: 'Confirmation #',
    cell: ({ row }) => <span className="font-mono font-medium">{row.original.confirmation_number}</span>,
  },
  {
    accessorKey: 'customer_name',
    header: 'Customer',
  },
  {
    accessorKey: 'pickup_date',
    header: 'Pickup Date',
    cell: ({ row }) => new Date(row.original.pickup_date).toLocaleDateString(),
  },
  {
    accessorKey: 'class_name',
    header: 'Class',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANTS[row.original.status] ?? 'outline'}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: 'source',
    header: 'Source',
    cell: ({ row }) => (
      <Badge variant={SOURCE_VARIANTS[row.original.source] ?? 'outline'}>
        {row.original.source}
      </Badge>
    ),
  },
  {
    accessorKey: 'total',
    header: 'Total',
    cell: ({ row }) =>
      row.original.total > 0
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: row.original.currency_code }).format(row.original.total)
        : '—',
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => alert(`Open detail for ${row.original.confirmation_number}`)}
        aria-label={`View details for reservation ${row.original.confirmation_number}`}
      >
        View
      </Button>
    ),
  },
]

export function ReservationsPage() {
  const { activeFilters, setFilter, clearFilters } = useAdminStore()
  const [isLoading] = useState(false)

  const filtered = MOCK_RESERVATIONS.filter((r) => {
    if (activeFilters.status?.length && !activeFilters.status.includes(r.status)) return false
    if (activeFilters.search &&
      !`${r.confirmation_number} ${r.customer_name}`.toLowerCase().includes(activeFilters.search.toLowerCase())
    ) return false
    return true
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reservations</h1>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="min-w-[220px] flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input
              type="search"
              placeholder="Confirmation # or customer name..."
              value={activeFilters.search ?? ''}
              onChange={(e) => setFilter('search', e.target.value)}
              aria-label="Search reservations"
            />
          </div>
          <div className="min-w-[140px] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <SelectRoot
              value={activeFilters.status?.[0] ?? ''}
              onValueChange={(v) => setFilter('status', v ? [v] : [])}
            >
              <SelectTrigger aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                <SelectItem value="ON_RENT">On Rent</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
              </SelectContent>
            </SelectRoot>
          </div>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton variant="table" rows={8} />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          pagination
          caption="Reservations list"
          emptyMessage="No reservations match the current filters."
        />
      )}
    </div>
  )
}
