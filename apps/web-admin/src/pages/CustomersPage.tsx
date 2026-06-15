import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Skeleton,
} from '@rcm/ui'
import { Input } from '@rcm/ui'

type Customer = {
  customer_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  is_dnr: boolean
  dnr_reason?: string
  loyalty_tier?: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'
  loyalty_points?: number
  total_rentals: number
}

const TIER_COLORS: Record<string, string> = {
  BRONZE: 'text-amber-700 bg-amber-50 border-amber-200',
  SILVER: 'text-slate-600 bg-slate-50 border-slate-200',
  GOLD: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  PLATINUM: 'text-indigo-700 bg-indigo-50 border-indigo-200',
}

function CustomerCard({
  customer,
  onClick,
}: {
  customer: Customer
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`View details for ${customer.first_name} ${customer.last_name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {customer.first_name} {customer.last_name}
          </p>
          <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
          {customer.phone && (
            <p className="text-xs text-muted-foreground">{customer.phone}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {customer.total_rentals} rental{customer.total_rentals !== 1 ? 's' : ''}
            {customer.loyalty_points !== undefined && ` · ${customer.loyalty_points.toLocaleString()} pts`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {customer.is_dnr && (
            <Badge variant="destructive" aria-label="Do Not Rent">
              DNR
            </Badge>
          )}
          {customer.loyalty_tier && (
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_COLORS[customer.loyalty_tier] ?? ''}`}
              aria-label={`Loyalty tier: ${customer.loyalty_tier}`}
            >
              {customer.loyalty_tier}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

const MOCK_CUSTOMERS: Customer[] = [
  { customer_id: '1', first_name: 'Alice', last_name: 'Johnson', email: 'alice@example.com', phone: '+1-555-0101', is_dnr: false, loyalty_tier: 'GOLD', loyalty_points: 4250, total_rentals: 23 },
  { customer_id: '2', first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com', is_dnr: true, dnr_reason: 'Vehicle damage, refused payment', loyalty_tier: undefined, total_rentals: 5 },
  { customer_id: '3', first_name: 'Carol', last_name: 'Davis', email: 'carol@example.com', phone: '+1-555-0303', is_dnr: false, loyalty_tier: 'PLATINUM', loyalty_points: 18500, total_rentals: 87 },
  { customer_id: '4', first_name: 'Dan', last_name: 'Wilson', email: 'dan@example.com', is_dnr: false, loyalty_tier: 'BRONZE', loyalty_points: 320, total_rentals: 3 },
]

export function CustomersPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const { data: customers, isLoading, isFetching } = useQuery({
    queryKey: ['customers', searchQuery],
    queryFn: async () => {
      if (!searchQuery) return MOCK_CUSTOMERS
      const { data } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown }>
      }).GET('/customers', { params: { query: { q: searchQuery, page_size: 20 } } })
      return ((data as { items: Customer[] })?.items ?? MOCK_CUSTOMERS.filter(c =>
        `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(searchQuery.toLowerCase())
      ))
    },
    staleTime: 10_000,
  })

  const displayedCustomers = customers ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Customers</h1>

      {/* Search */}
      <div className="relative">
        <label htmlFor="customer-search" className="sr-only">
          Search customers
        </label>
        <Input
          id="customer-search"
          type="search"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setSelectedCustomer(null)
          }}
          className="pl-10 text-base"
          aria-label="Search customers"
        />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Results list */}
        <div className="lg:col-span-2 space-y-3">
          {(isLoading || isFetching) && !displayedCustomers.length ? (
            <div aria-busy="true" aria-label="Searching..." className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} variant="avatar" />
              ))}
            </div>
          ) : displayedCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {searchQuery ? `No customers found for "${searchQuery}"` : 'Start typing to search.'}
            </p>
          ) : (
            <ul role="list" aria-label="Customer search results">
              {displayedCustomers.map((customer) => (
                <li key={customer.customer_id}>
                  <CustomerCard
                    customer={customer}
                    onClick={() => setSelectedCustomer(customer)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Customer detail */}
        <div className="lg:col-span-3">
          {selectedCustomer ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>
                      {selectedCustomer.first_name} {selectedCustomer.last_name}
                    </CardTitle>
                    <CardDescription>{selectedCustomer.email}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {selectedCustomer.is_dnr && (
                      <Badge variant="destructive">DNR</Badge>
                    )}
                    {selectedCustomer.loyalty_tier && (
                      <Badge variant="outline">{selectedCustomer.loyalty_tier}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="font-medium text-muted-foreground">Phone</dt>
                    <dd>{selectedCustomer.phone ?? 'Not provided'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Total Rentals</dt>
                    <dd className="font-semibold">{selectedCustomer.total_rentals}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Loyalty Points</dt>
                    <dd>{selectedCustomer.loyalty_points?.toLocaleString() ?? '—'}</dd>
                  </div>
                </dl>

                {selectedCustomer.is_dnr && selectedCustomer.dnr_reason && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <p className="font-semibold">Do Not Rent</p>
                    <p className="mt-1">{selectedCustomer.dnr_reason}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button variant="outline" size="sm" disabled>
                    View Rental History
                  </Button>
                  <Button
                    variant={selectedCustomer.is_dnr ? 'outline' : 'destructive'}
                    size="sm"
                    disabled
                  >
                    {selectedCustomer.is_dnr ? 'Remove DNR Flag' : 'Flag as DNR'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed text-muted-foreground">
              <p className="text-sm">Select a customer to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
