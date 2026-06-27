import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@rcm/ui'

type EscalationTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface OverdueRental {
  rental_agreement_id: string
  confirmation_number: string
  customer: { first_name: string; last_name: string; email: string; phone?: string }
  vehicle: { plate: string; make: string; model: string; class_name: string }
  scheduled_return: string
  hours_overdue: number
  escalation_tier: EscalationTier
  running_late_fee: number
  currency_code: string
}

const TIER_CONFIG: Record<
  EscalationTier,
  { label: string; badgeVariant: 'warning' | 'destructive' | 'outline' | 'default'; priority: number }
> = {
  LOW: { label: 'Low', badgeVariant: 'outline', priority: 1 },
  MEDIUM: { label: 'Medium', badgeVariant: 'warning', priority: 2 },
  HIGH: { label: 'High', badgeVariant: 'destructive', priority: 3 },
  CRITICAL: { label: 'Critical', badgeVariant: 'destructive', priority: 4 },
}

// Mock data until API is live
const MOCK_OVERDUE: OverdueRental[] = [
  {
    rental_agreement_id: 'RA-001',
    confirmation_number: 'CNF-ABC123',
    customer: { first_name: 'Alice', last_name: 'Walker', email: 'alice@example.com', phone: '+1-555-0100' },
    vehicle: { plate: 'XYZ-789', make: 'Honda', model: 'Civic', class_name: 'Economy' },
    scheduled_return: new Date(Date.now() - 1000 * 3600 * 26).toISOString(),
    hours_overdue: 26,
    escalation_tier: 'HIGH',
    running_late_fee: 130.0,
    currency_code: 'USD',
  },
  {
    rental_agreement_id: 'RA-002',
    confirmation_number: 'CNF-DEF456',
    customer: { first_name: 'Bob', last_name: 'Chen', email: 'bob@example.com', phone: '+1-555-0200' },
    vehicle: { plate: 'LMN-456', make: 'Toyota', model: 'Camry', class_name: 'Standard' },
    scheduled_return: new Date(Date.now() - 1000 * 3600 * 3).toISOString(),
    hours_overdue: 3,
    escalation_tier: 'LOW',
    running_late_fee: 15.0,
    currency_code: 'USD',
  },
  {
    rental_agreement_id: 'RA-003',
    confirmation_number: 'CNF-GHI789',
    customer: { first_name: 'Carol', last_name: 'Davis', email: 'carol@example.com', phone: undefined },
    vehicle: { plate: 'QRS-321', make: 'Ford', model: 'Explorer', class_name: 'SUV' },
    scheduled_return: new Date(Date.now() - 1000 * 3600 * 48).toISOString(),
    hours_overdue: 48,
    escalation_tier: 'CRITICAL',
    running_late_fee: 480.0,
    currency_code: 'USD',
  },
]

function OverdueCard({ rental }: { rental: OverdueRental }) {
  const tier = TIER_CONFIG[rental.escalation_tier]

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">RA #{rental.rental_agreement_id}</p>
            <p className="font-semibold">
              {rental.customer.first_name} {rental.customer.last_name}
            </p>
            <p className="text-sm text-muted-foreground">
              {rental.vehicle.make} {rental.vehicle.model} · {rental.vehicle.plate}
            </p>
          </div>
          <Badge variant={tier.badgeVariant} aria-label={`Escalation tier: ${tier.label}`}>
            {tier.label} Priority
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Scheduled Return</dt>
            <dd className="font-medium">
              {new Date(rental.scheduled_return).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Hours Overdue</dt>
            <dd className="font-bold text-destructive">
              {rental.hours_overdue}h overdue
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Running Late Fee</dt>
            <dd className="font-semibold">
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: rental.currency_code,
              }).format(rental.running_late_fee)}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2" role="group" aria-label={`Actions for ${rental.customer.first_name} ${rental.customer.last_name}`}>
          {rental.customer.phone ? (
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${rental.customer.phone}`}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="mr-1"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                Call
              </a>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <a href={`mailto:${rental.customer.email}`}>Email</a>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled>
            Flag for Escalation
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function OverduePage() {
  // In production: fetch from /reservations?status=ON_RENT&overdue=true
  const { data: rentals = MOCK_OVERDUE, isLoading } = useQuery({
    queryKey: ['rentals', 'overdue'],
    queryFn: async () => MOCK_OVERDUE, // stub
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const sorted = [...rentals].sort(
    (a, b) => TIER_CONFIG[b.escalation_tier].priority - TIER_CONFIG[a.escalation_tier].priority ||
              b.hours_overdue - a.hours_overdue
  )

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '1.4px', textTransform: 'uppercase', color: '#969696' }}>Counter Operations</p>
          <div style={{ width: 32, height: 1, background: '#303030', marginBottom: 12 }} />
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 500, letterSpacing: '0.195px', color: '#ffffff', lineHeight: 1.2 }}>Overdue Rentals</h1>
        </div>
        {!isLoading && (
          <Badge variant={sorted.length > 0 ? 'destructive' : 'success'} aria-live="polite">
            {sorted.length} overdue
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading overdue rentals">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} variant="card" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-lg font-semibold text-green-700">All clear!</p>
            <p className="text-sm text-muted-foreground mt-1">No overdue rentals at this time.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sorted.map((rental) => (
            <OverdueCard key={rental.rental_agreement_id} rental={rental} />
          ))}
        </div>
      )}
    </div>
  )
}
