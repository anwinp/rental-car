import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  type ColumnDef,
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  Skeleton,
} from '@rcm/ui'
import { Input } from '@rcm/ui'
import { useAdminStore } from '../store/adminStore'

type Vehicle = {
  vehicle_id: string
  plate: string
  vin: string
  make: string
  model: string
  year: number
  class_code: string
  class_name: string
  status: string
  location_id: string
  location_name: string
  odometer: number
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'default' | 'outline'> = {
  AVAILABLE: 'success',
  ON_RENT: 'default',
  MAINTENANCE: 'warning',
  IN_REPAIR: 'warning',
  DAMAGE_HOLD: 'destructive',
  ADMIN_HOLD: 'destructive',
  CLEANING: 'outline',
  STAGING: 'outline',
}

const columns: ColumnDef<Vehicle, unknown>[] = [
  {
    accessorKey: 'plate',
    header: 'Plate',
    cell: ({ row }) => <span className="font-mono font-medium">{row.original.plate}</span>,
  },
  {
    id: 'vin',
    header: 'VIN (last 8)',
    cell: ({ row }) => (
      <span className="font-mono text-sm text-muted-foreground">
        ...{row.original.vin.slice(-8)}
      </span>
    ),
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
        {row.original.status.replace('_', ' ')}
      </Badge>
    ),
  },
  {
    accessorKey: 'location_name',
    header: 'Location',
  },
  {
    accessorKey: 'odometer',
    header: 'Odometer',
    cell: ({ row }) => `${row.original.odometer.toLocaleString()} km`,
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => alert(`Open detail for ${row.original.plate}`)}
        aria-label={`View details for vehicle ${row.original.plate}`}
      >
        View
      </Button>
    ),
  },
]

// Mock data
const MOCK_VEHICLES: Vehicle[] = [
  { vehicle_id: '1', plate: 'ABC-123', vin: '1HGBH41JXMN109186', make: 'Honda', model: 'Civic', year: 2023, class_code: 'EC', class_name: 'Economy', status: 'AVAILABLE', location_id: 'loc-1', location_name: 'Downtown', odometer: 12340 },
  { vehicle_id: '2', plate: 'DEF-456', vin: '2T1BURHE0JC034985', make: 'Toyota', model: 'Corolla', year: 2022, class_code: 'EC', class_name: 'Economy', status: 'ON_RENT', location_id: 'loc-1', location_name: 'Downtown', odometer: 28510 },
  { vehicle_id: '3', plate: 'GHI-789', vin: '1GNEC13Z33R138596', make: 'Chevrolet', model: 'Equinox', year: 2023, class_code: 'SV', class_name: 'SUV', status: 'MAINTENANCE', location_id: 'loc-2', location_name: 'Airport', odometer: 45200 },
  { vehicle_id: '4', plate: 'JKL-012', vin: '4T1BF1FK0HU671325', make: 'Toyota', model: 'Camry', year: 2024, class_code: 'ST', class_name: 'Standard', status: 'AVAILABLE', location_id: 'loc-2', location_name: 'Airport', odometer: 8900 },
  { vehicle_id: '5', plate: 'MNO-345', vin: '1FMCU0GD3GUC25196', make: 'Ford', model: 'Explorer', year: 2023, class_code: 'SV', class_name: 'SUV', status: 'DAMAGE_HOLD', location_id: 'loc-1', location_name: 'Downtown', odometer: 67340 },
]

export function FleetPage() {
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const { activeFilters, setFilter, clearFilters } = useAdminStore()

  const { data: vehicles = MOCK_VEHICLES, isLoading } = useQuery({
    queryKey: ['fleet', 'vehicles', activeFilters],
    queryFn: async () => {
      const { data } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown }>
      }).GET('/fleet/vehicles', {
        params: {
          query: {
            location_id: activeFilters.locationId,
            status: activeFilters.status?.[0],
            class_code: activeFilters.classCode,
          },
        },
      })
      return ((data as { items: Vehicle[] })?.items ?? MOCK_VEHICLES)
    },
    staleTime: 30_000,
    placeholderData: MOCK_VEHICLES,
  })

  const filtered = vehicles.filter((v) => {
    if (activeFilters.status?.length && !activeFilters.status.includes(v.status)) return false
    if (activeFilters.locationId && v.location_id !== activeFilters.locationId) return false
    if (activeFilters.search && !`${v.plate} ${v.make} ${v.model}`.toLowerCase().includes(activeFilters.search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Fleet</h1>
        <DialogRoot open={addVehicleOpen} onOpenChange={setAddVehicleOpen}>
          <DialogTrigger asChild>
            <Button>+ Add Vehicle</Button>
          </DialogTrigger>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Add New Vehicle</DialogTitle>
              <DialogDescription>
                Enter the details for the new vehicle. Required fields are marked.
              </DialogDescription>
            </DialogHeader>
            {/* Multi-step add vehicle form — placeholder */}
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Vehicle entry wizard (5-step form) — implementation pending.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {['Plate', 'VIN', 'Make', 'Model', 'Year', 'Color', 'Class', 'Location'].map((f) => (
                  <div key={f} className="space-y-1">
                    <label className="text-sm font-medium">{f}</label>
                    <Input placeholder={f} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddVehicleOpen(false)}>Cancel</Button>
              <Button onClick={() => setAddVehicleOpen(false)}>Add Vehicle</Button>
            </div>
          </DialogContent>
        </DialogRoot>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="min-w-[200px] flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input
              type="search"
              placeholder="Plate, make, model..."
              value={activeFilters.search ?? ''}
              onChange={(e) => setFilter('search', e.target.value)}
              aria-label="Search vehicles"
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
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="ON_RENT">On Rent</SelectItem>
                <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                <SelectItem value="DAMAGE_HOLD">Damage Hold</SelectItem>
              </SelectContent>
            </SelectRoot>
          </div>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear Filters
          </Button>
        </CardContent>
      </Card>

      {/* DataTable */}
      {isLoading ? (
        <Skeleton variant="table" rows={8} />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          pagination
          caption="Fleet vehicles list"
          emptyMessage="No vehicles match the current filters."
        />
      )}
    </div>
  )
}
