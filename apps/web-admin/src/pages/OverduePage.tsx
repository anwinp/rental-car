import { tenantId } from '../tenant'
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type RentalAgreement = {
  ra_id: string
  ra_number: string
  reservation_id: string | null
  customer_id: string
  vehicle_id: string
  vin_at_checkout: string
  status: string
  created_at: string
  updated_at: string
  preauth_amount: string | null
  agent_notes: string | null
}

type CustomerInfo = {
  customer_id: string
  first_name: string
  last_name: string
  email: string
}

type VehicleInfo = {
  vehicle_id: string
  make: string
  model: string
  model_year: number
  plate_number: string | null
}

type ReservationInfo = {
  reservation_id: string
  return_datetime: string
  grand_total: string | null
}

type EnrichedRA = RentalAgreement & {
  customerName: string
  vehicleLabel: string
  expectedReturn: Date
  daysOverdue: number
  estimatedValue: number
}

type SortKey = 'ra_number' | 'customerName' | 'expectedReturn' | 'daysOverdue'

// ── fetchJSON helper ──────────────────────────────────────────────────────────


async function fetchJSON<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: {
      'X-Tenant-ID': tenantId(),
      'Content-Type': 'application/json',
      ...((opts?.headers ?? {}) as Record<string, string>),
    },
    ...opts,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchOverdueRAs(): Promise<RentalAgreement[]> {
  return fetchJSON<RentalAgreement[]>('/checkout/overdue')
}

async function fetchCustomer(customerId: string): Promise<CustomerInfo> {
  return fetchJSON<CustomerInfo>(`/customers/${customerId}`)
}

async function fetchVehicle(vehicleId: string): Promise<VehicleInfo> {
  return fetchJSON<VehicleInfo>(`/fleet/vehicles/${vehicleId}`)
}

async function fetchReservation(reservationId: string): Promise<ReservationInfo> {
  return fetchJSON<ReservationInfo>(`/reservations/${reservationId}`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcDaysOverdue(expected: Date): number {
  const now = Date.now()
  const diff = now - expected.getTime()
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0
}

function overdueBadgeStyle(days: number): React.CSSProperties {
  // 0–1 day: warning amber, 2–4 days: orange, 5+ days: danger red (darkening)
  if (days <= 0) {
    return { background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }
  }
  if (days <= 1) {
    return { background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }
  }
  if (days <= 3) {
    return { background: 'rgba(249,115,22,0.15)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }
  }
  if (days <= 6) {
    return { background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }
  }
  // 7+ days: darkest red
  return { background: 'rgba(185,28,28,0.2)', color: '#dc2626', border: '1px solid rgba(185,28,28,0.4)' }
}

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'EXTENDED') {
    return { background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }
  }
  return { background: 'rgba(99,102,241,0.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.3)' }
}

function formatDate(d: Date): string {
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke={active ? 'var(--accent)' : 'var(--text-3)'}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ marginLeft: 4, flexShrink: 0 }}
    >
      {dir === 'asc' || !active
        ? <path d="M12 5v14M5 12l7-7 7 7" />
        : <path d="M12 19V5M5 12l7 7 7-7" />}
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OverduePage() {
  const [sortKey, setSortKey] = useState<SortKey>('daysOverdue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [flagged, setFlagged] = useState<Set<string>>(new Set())

  // 1. Load overdue RAs (auto-refresh every 60s)
  const {
    data: rawRAs = [],
    isLoading,
    isError,
    error,
    dataUpdatedAt,
  } = useQuery<RentalAgreement[]>({
    queryKey: ['overdue-rentals'],
    queryFn: fetchOverdueRAs,
    refetchInterval: 60_000,
  })

  // 2. Load customer/vehicle/reservation data for each RA
  const { data: enrichedRAs = [] } = useQuery<EnrichedRA[]>({
    queryKey: ['overdue-enriched', rawRAs.map(r => r.ra_id).join(',')],
    queryFn: async () => {
      if (rawRAs.length === 0) return []

      // Deduplicate IDs to avoid redundant fetches
      const uniqueCustomerIds = [...new Set(rawRAs.map(r => r.customer_id))]
      const uniqueVehicleIds  = [...new Set(rawRAs.map(r => r.vehicle_id))]
      const uniqueResIds      = [...new Set(rawRAs.filter(r => r.reservation_id).map(r => r.reservation_id as string))]

      const [customerResults, vehicleResults, reservationResults] = await Promise.all([
        Promise.allSettled(uniqueCustomerIds.map(id => fetchCustomer(id))),
        Promise.allSettled(uniqueVehicleIds.map(id => fetchVehicle(id))),
        Promise.allSettled(uniqueResIds.map(id => fetchReservation(id))),
      ])

      const customerMap = new Map<string, CustomerInfo>()
      customerResults.forEach((r, i) => {
        if (r.status === 'fulfilled') customerMap.set(uniqueCustomerIds[i], r.value)
      })

      const vehicleMap = new Map<string, VehicleInfo>()
      vehicleResults.forEach((r, i) => {
        if (r.status === 'fulfilled') vehicleMap.set(uniqueVehicleIds[i], r.value)
      })

      const reservationMap = new Map<string, ReservationInfo>()
      reservationResults.forEach((r, i) => {
        if (r.status === 'fulfilled') reservationMap.set(uniqueResIds[i], r.value)
      })

      return rawRAs.map((ra): EnrichedRA => {
        const cust = customerMap.get(ra.customer_id)
        const veh  = vehicleMap.get(ra.vehicle_id)
        const res  = ra.reservation_id ? reservationMap.get(ra.reservation_id) : undefined

        const customerName = cust
          ? `${cust.first_name} ${cust.last_name}`
          : `Customer …${ra.customer_id.slice(-6)}`

        const vehicleLabel = veh
          ? `${veh.plate_number ? veh.plate_number + ' — ' : ''}${veh.model_year} ${veh.make} ${veh.model}`
          : ra.vin_at_checkout.trim() || ra.vehicle_id.slice(-8)

        // Expected return: from reservation, or created_at + 24h as proxy
        let expectedReturn: Date
        if (res?.return_datetime) {
          expectedReturn = new Date(res.return_datetime)
        } else {
          expectedReturn = new Date(new Date(ra.created_at).getTime() + 86_400_000)
        }

        const daysOverdue = calcDaysOverdue(expectedReturn)

        // Estimated value: reservation grand_total, or preauth_amount, or 0
        const estimatedValue = res?.grand_total
          ? Number(res.grand_total)
          : ra.preauth_amount
            ? Number(ra.preauth_amount)
            : 0

        return { ...ra, customerName, vehicleLabel, expectedReturn, daysOverdue, estimatedValue }
      })
    },
    enabled: rawRAs.length > 0,
  })

  // 3. Sort
  const sorted = useMemo(() => {
    const items = [...enrichedRAs]
    items.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'ra_number')       cmp = a.ra_number.localeCompare(b.ra_number)
      else if (sortKey === 'customerName') cmp = a.customerName.localeCompare(b.customerName)
      else if (sortKey === 'expectedReturn') cmp = a.expectedReturn.getTime() - b.expectedReturn.getTime()
      else if (sortKey === 'daysOverdue') cmp = a.daysOverdue - b.daysOverdue
      return sortDir === 'asc' ? cmp : -cmp
    })
    return items
  }, [enrichedRAs, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'daysOverdue' ? 'desc' : 'asc')
    }
  }

  function toggleFlag(raId: string) {
    setFlagged(prev => {
      const next = new Set(prev)
      if (next.has(raId)) next.delete(raId)
      else next.add(raId)
      return next
    })
  }

  // 4. Stats
  const totalCount     = sorted.length
  const mostOverdue    = sorted.reduce((max, r) => Math.max(max, r.daysOverdue), 0)
  const totalAtRisk    = sorted.reduce((sum, r) => sum + r.estimatedValue, 0)

  const lastRefreshed = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
    : null

  // ── Column header helper ───────────────────────────────────────────────────
  function ColHeader({ label, colKey }: { label: string; colKey: SortKey }) {
    const active = sortKey === colKey
    return (
      <th
        onClick={() => handleSort(colKey)}
        style={{
          padding: '10px 14px',
          textAlign: 'left',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: active ? 'var(--accent)' : 'var(--text-3)',
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {label}
          <SortIcon active={active} dir={active ? sortDir : 'desc'} />
        </span>
      </th>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-2)', fontSize: 14 }}>
        Loading overdue rentals…
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ padding: '2rem', color: 'var(--danger)', fontSize: 14 }}>
        Failed to load overdue rentals: {(error as Error).message}
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem 2rem', background: 'var(--page-bg)', minHeight: '100%' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-1)' }}>
            Overdue Rentals
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>
            Active rentals past their scheduled return date
            {lastRefreshed && (
              <span style={{ marginLeft: 8 }}>· Last refreshed {lastRefreshed}</span>
            )}
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: '0.5rem', padding: '1rem 1.5rem', minWidth: 160,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
            Overdue Rentals
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '1.75rem', fontWeight: 700, color: totalCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {totalCount}
          </p>
        </div>

        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: '0.5rem', padding: '1rem 1.5rem', minWidth: 160,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
            Most Overdue
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '1.75rem', fontWeight: 700, color: mostOverdue > 3 ? 'var(--danger)' : 'var(--text-1)' }}>
            {mostOverdue}
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-2)', marginLeft: 4 }}>
              {mostOverdue === 1 ? 'day' : 'days'}
            </span>
          </p>
        </div>

        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: '0.5rem', padding: '1rem 1.5rem', minWidth: 220,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
            Estimated Revenue at Risk
          </p>
          <p style={{ margin: '6px 0 0', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-1)' }}>
            ${totalAtRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Empty state */}
      {sorted.length === 0 && !isLoading && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: '0.5rem', padding: '4rem 2rem', textAlign: 'center',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(16,185,129,0.12)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-1)' }}>
            No overdue rentals
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-3)' }}>
            All active rentals are within their scheduled return window.
          </p>
        </div>
      )}

      {/* Table */}
      {sorted.length > 0 && (
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border)',
          borderRadius: '0.5rem', overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.06)' }}>
                  <ColHeader label="RA Number"       colKey="ra_number" />
                  <ColHeader label="Customer"        colKey="customerName" />
                  <th style={{
                    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)',
                    whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
                  }}>
                    Vehicle
                  </th>
                  <ColHeader label="Expected Return" colKey="expectedReturn" />
                  <ColHeader label="Days Overdue"    colKey="daysOverdue" />
                  <th style={{
                    padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)',
                    whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
                  }}>
                    Status
                  </th>
                  <th style={{
                    padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)',
                    whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ra, idx) => (
                  <tr
                    key={ra.ra_id}
                    style={{
                      borderBottom: idx < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                      background: flagged.has(ra.ra_id) ? 'rgba(239,68,68,0.04)' : 'transparent',
                    }}
                  >
                    {/* RA Number */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                        {ra.ra_number}
                      </span>
                    </td>

                    {/* Customer */}
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-1)' }}>
                        {ra.customerName}
                      </span>
                    </td>

                    {/* Vehicle */}
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                        {ra.vehicleLabel}
                      </span>
                    </td>

                    {/* Expected Return */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                        {formatDate(ra.expectedReturn)}
                      </span>
                    </td>

                    {/* Days Overdue */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        ...overdueBadgeStyle(ra.daysOverdue),
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        {ra.daysOverdue === 0 ? '< 1' : ra.daysOverdue} {ra.daysOverdue === 1 ? 'day' : 'days'}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        ...statusBadgeStyle(ra.status),
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        {ra.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        <a
                          href={`/returns?ra_id=${ra.ra_id}`}
                          className="btn-primary"
                          style={{ fontSize: 12, padding: '4px 12px', textDecoration: 'none' }}
                        >
                          Process Return
                        </a>
                        <button
                          onClick={() => toggleFlag(ra.ra_id)}
                          className="btn-ghost"
                          style={{
                            fontSize: 12,
                            padding: '4px 12px',
                            color: flagged.has(ra.ra_id) ? 'var(--danger)' : 'var(--text-2)',
                            borderColor: flagged.has(ra.ra_id) ? 'var(--danger)' : undefined,
                          }}
                          title={flagged.has(ra.ra_id) ? 'Remove collections flag' : 'Flag for collections'}
                        >
                          {flagged.has(ra.ra_id) ? 'Flagged' : 'Flag'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-3)',
          }}>
            {totalCount} overdue rental{totalCount !== 1 ? 's' : ''} · Auto-refreshes every 60 seconds
          </div>
        </div>
      )}
    </div>
  )
}
