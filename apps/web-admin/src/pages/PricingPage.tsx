import { useState } from 'react'
import {
  Badge,
  Button,
  DataTable,
  type ColumnDef,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  Skeleton,
} from '@rcm/ui'
import { useAdminStore } from '../store/adminStore'

type RateCode = {
  rate_code_id: string
  code: string
  name: string
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED'
  valid_from: string
  valid_to: string
  created_at: string
}

type Extra = {
  extra_id: string
  code: string
  name: string
  daily_rate: number
  is_active: boolean
}

const STATUS_VARIANTS: Record<RateCode['status'], 'success' | 'outline' | 'destructive'> = {
  ACTIVE: 'success',
  DRAFT: 'outline',
  EXPIRED: 'destructive',
}

const MOCK_RATE_CODES: RateCode[] = [
  { rate_code_id: '1', code: 'STD-BASE', name: 'Standard Base Rate', status: 'ACTIVE', valid_from: '2026-01-01', valid_to: '2026-12-31', created_at: '2025-12-01' },
  { rate_code_id: '2', code: 'SUMMER26', name: 'Summer 2026 Promotion', status: 'DRAFT', valid_from: '2026-06-01', valid_to: '2026-08-31', created_at: '2026-04-15' },
  { rate_code_id: '3', code: 'CORP-ACME', name: 'ACME Corp Rate', status: 'ACTIVE', valid_from: '2026-01-01', valid_to: '2026-12-31', created_at: '2025-11-20' },
  { rate_code_id: '4', code: 'WINTER25', name: 'Winter 2025', status: 'EXPIRED', valid_from: '2025-12-01', valid_to: '2025-12-31', created_at: '2025-11-01' },
]

const MOCK_EXTRAS: Extra[] = [
  { extra_id: '1', code: 'CDW', name: 'Collision Damage Waiver', daily_rate: 19.99, is_active: true },
  { extra_id: '2', code: 'GPS', name: 'GPS Navigation', daily_rate: 7.99, is_active: true },
  { extra_id: '3', code: 'CSS', name: 'Child Safety Seat', daily_rate: 9.99, is_active: true },
  { extra_id: '4', code: 'PAI', name: 'Personal Accident Insurance', daily_rate: 4.99, is_active: false },
]

const rateCodeColumns: ColumnDef<RateCode, unknown>[] = [
  {
    accessorKey: 'code',
    header: 'Code',
    cell: ({ row }) => <span className="font-mono font-medium">{row.original.code}</span>,
  },
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANTS[row.original.status]}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: 'valid_from',
    header: 'Valid From',
    cell: ({ row }) => new Date(row.original.valid_from).toLocaleDateString(),
  },
  {
    accessorKey: 'valid_to',
    header: 'Valid To',
    cell: ({ row }) => new Date(row.original.valid_to).toLocaleDateString(),
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => alert(`Edit ${row.original.code}`)}
        aria-label={`Edit rate code ${row.original.code}`}
      >
        Edit
      </Button>
    ),
  },
]

export function PricingPage() {
  const [isLoading] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pricing</h1>
        <Button>+ New Rate Code</Button>
      </div>

      <TabsRoot defaultValue="rate-codes">
        <TabsList>
          <TabsTrigger value="rate-codes">Rate Codes</TabsTrigger>
          <TabsTrigger value="extras">Extras</TabsTrigger>
          <TabsTrigger value="promotions">Promotions</TabsTrigger>
        </TabsList>

        <TabsContent value="rate-codes">
          {isLoading ? (
            <Skeleton variant="table" rows={6} />
          ) : (
            <DataTable
              columns={rateCodeColumns}
              data={MOCK_RATE_CODES}
              pagination
              caption="Rate codes"
              emptyMessage="No rate codes found."
            />
          )}
        </TabsContent>

        <TabsContent value="extras">
          <div className="mt-4 space-y-3">
            {MOCK_EXTRAS.map((extra) => (
              <div
                key={extra.extra_id}
                className="flex items-center justify-between rounded-lg border bg-card p-4"
              >
                <div>
                  <p className="font-medium">{extra.name}</p>
                  <p className="text-sm text-muted-foreground">{extra.code}</p>
                </div>
                <div className="flex items-center gap-4">
                  <p className="text-sm font-semibold">${extra.daily_rate.toFixed(2)}/day</p>
                  <Badge variant={extra.is_active ? 'success' : 'outline'}>
                    {extra.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button variant="ghost" size="sm">Edit</Button>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full">+ Add Extra</Button>
          </div>
        </TabsContent>

        <TabsContent value="promotions">
          <div className="mt-4 flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
            <p className="text-sm">Promo code management — coming soon</p>
          </div>
        </TabsContent>
      </TabsRoot>
    </div>
  )
}
