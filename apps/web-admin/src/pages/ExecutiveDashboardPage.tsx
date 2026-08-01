import { tenantHeaders } from '../tenant'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type Period = 'MTD' | 'YESTERDAY' | 'LAST_7_DAYS' | 'LAST_MONTH' | 'LAST_QUARTER' | 'YTD'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'MTD',          label: 'Month to Date' },
  { key: 'YESTERDAY',    label: 'Yesterday' },
  { key: 'LAST_7_DAYS',  label: 'Last 7 Days' },
  { key: 'LAST_MONTH',   label: 'Last Month' },
  { key: 'LAST_QUARTER', label: 'Last Quarter' },
  { key: 'YTD',          label: 'Year to Date' },
]

const REVENUE_SUBLABEL: Record<Period, string> = {
  MTD:          'bookings created this month',
  YESTERDAY:    'bookings created yesterday',
  LAST_7_DAYS:  'bookings over the last 7 days',
  LAST_MONTH:   'bookings created last month',
  LAST_QUARTER: 'bookings created last quarter',
  YTD:          'bookings created this year',
}

const OVERDUE_SUBLABEL: Record<Period, string> = {
  MTD:          'late returns due this month',
  YESTERDAY:    'late returns due yesterday',
  LAST_7_DAYS:  'late returns due in last 7 days',
  LAST_MONTH:   'late returns due last month',
  LAST_QUARTER: 'late returns due last quarter',
  YTD:          'late returns due this year',
}

function getPeriodRange(period: Period, now: Date): { start: string; end: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (period) {
    case 'MTD':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        end: now.toISOString(),
      }
    case 'YESTERDAY': {
      const yStart = new Date(today); yStart.setDate(yStart.getDate() - 1)
      return { start: yStart.toISOString(), end: today.toISOString() }
    }
    case 'LAST_7_DAYS':
      return {
        start: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: now.toISOString(),
      }
    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end   = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: start.toISOString(), end: end.toISOString() }
    }
    case 'LAST_QUARTER': {
      const curQ   = Math.floor(now.getMonth() / 3)
      const prevQ  = curQ === 0 ? 3 : curQ - 1
      const prevQY = curQ === 0 ? now.getFullYear() - 1 : now.getFullYear()
      const start  = new Date(prevQY, prevQ * 3, 1)
      const end    = new Date(prevQY, prevQ * 3 + 3, 1)
      return { start: start.toISOString(), end: end.toISOString() }
    }
    case 'YTD':
      return {
        start: new Date(now.getFullYear(), 0, 1).toISOString(),
        end: now.toISOString(),
      }
  }
}

const TENANT_HEADERS = () => tenantHeaders()
interface Vehicle {
  vehicle_id: string
  status: string
  home_location_id?: string
  current_location_id?: string
}

interface Reservation {
  reservation_id: string
  status: string
  created_at: string
  pickup_datetime?: string
  pickup_location_id?: string
  return_datetime?: string
  actual_return_datetime?: string
  assigned_vehicle_id?: string
  grand_total?: string | number
}

interface DamageClaim {
  claim_id: string
  vehicle_id?: string
  severity?: string
  created_at?: string
  status?: string
  claim_reference?: string
}

interface Location {
  location_id: string
  name: string
}

async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await fetch('/api/v1/fleet/vehicles?limit=200', { credentials: 'include', headers: TENANT_HEADERS() })
  if (!res.ok) throw new Error('Failed to load vehicles')
  const data = await res.json()
  return Array.isArray(data) ? data : (data.vehicles ?? data.items ?? [])
}

async function fetchReservations(): Promise<Reservation[]> {
  const PAGE = 100
  const all: Reservation[] = []
  let offset = 0
  while (true) {
    const res = await fetch(`/api/v1/reservations?limit=${PAGE}&offset=${offset}`, { credentials: 'include', headers: TENANT_HEADERS() })
    if (!res.ok) throw new Error('Failed to load reservations')
    const data = await res.json()
    const page: Reservation[] = Array.isArray(data) ? data : (data.reservations ?? data.items ?? [])
    all.push(...page)
    if (page.length < PAGE) break
    offset += PAGE
  }
  return all
}

async function fetchDamage(): Promise<DamageClaim[]> {
  const res = await fetch('/api/v1/damage/claims', { credentials: 'include', headers: TENANT_HEADERS() })
  if (!res.ok) throw new Error('Failed to load damage claims')
  const data = await res.json()
  return Array.isArray(data) ? data : (data.claims ?? data.items ?? [])
}

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations', { credentials: 'include', headers: TENANT_HEADERS() })
  if (!res.ok) throw new Error('Failed to load locations')
  const data = await res.json()
  return Array.isArray(data) ? data : (data.locations ?? data.items ?? [])
}

const DISPATCHED_STATUSES = new Set(['CHECKED_OUT', 'EXTENDED', 'RETURNED', 'CLOSED'])

function computeAvgDailyUtilization(
  reservations: Reservation[],
  periodStart: string,
  periodEnd: string,
  activeFleet: number,
): { pct: number; daysInPeriod: number } {
  if (activeFleet === 0) return { pct: 0, daysInPeriod: 0 }

  const pStart = new Date(periodStart)
  const pEnd   = new Date(periodEnd)

  // One entry per calendar day — cap at 366 to guard against very long YTD periods
  const dayStarts: number[] = []
  const cur = new Date(pStart.getFullYear(), pStart.getMonth(), pStart.getDate())
  while (cur.getTime() < pEnd.getTime() && dayStarts.length < 366) {
    dayStarts.push(cur.getTime())
    cur.setDate(cur.getDate() + 1)
  }
  if (dayStarts.length === 0) return { pct: 0, daysInPeriod: 0 }

  // Only reservations that represent actual dispatches with a known vehicle + pickup date
  const dispatched = reservations.filter(r =>
    DISPATCHED_STATUSES.has(r.status) &&
    r.assigned_vehicle_id &&
    r.pickup_datetime,
  )

  let totalRate = 0
  for (const dayStart of dayStarts) {
    const dayEnd = dayStart + 86_400_000 // ms in one day
    const onRent = new Set<string>()

    for (const r of dispatched) {
      const rStart = new Date(r.pickup_datetime!).getTime()
      // Use actual return if present, fall back to planned return, then period end
      const rEnd = new Date(r.actual_return_datetime ?? r.return_datetime ?? periodEnd).getTime()
      if (rStart < dayEnd && rEnd > dayStart) {
        onRent.add(r.assigned_vehicle_id!)
      }
    }
    totalRate += onRent.size / activeFleet
  }

  return {
    pct: Math.round((totalRate / dayStarts.length) * 100),
    daysInPeriod: dayStarts.length,
  }
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function Skeleton({ h = 60 }: { h?: number }) {
  return <div style={{ height: h, background: 'var(--border)', borderRadius: 4 }} />
}

function StatCard({ label, value, sub, live }: { label: string; value: string; sub: string; live?: boolean }) {
  return (
    <div style={{ background: 'var(--card-bg)', padding: '20px 24px', borderRadius: 0, border: '1px solid var(--border)', position: 'relative' }}>
      {live && (
        <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--success)', background: 'var(--success-bg)', padding: '2px 6px', borderRadius: 9999 }}>
          Live
        </span>
      )}
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{sub}</p>
    </div>
  )
}

function ErrorNote({ msg }: { msg: string }) {
  return <p style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>{msg}</p>
}

function PanelHeader({ title, count, live }: { title: string; count?: number; live?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{title}</p>
        {live && (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--success)', background: 'var(--success-bg)', padding: '2px 6px', borderRadius: 9999 }}>
            Live
          </span>
        )}
      </div>
      {count !== undefined && (
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>{count}</span>
      )}
    </div>
  )
}

export function ExecutiveDashboardPage() {
  const now = new Date()
  const [period, setPeriod] = useState<Period>('MTD')
  const { start: periodStart, end: periodEnd } = getPeriodRange(period, now)
  const periodLabel = PERIODS.find(p => p.key === period)?.label ?? ''

  const vehiclesQ     = useQuery<Vehicle[]>    ({ queryKey: ['exec-vehicles'],     queryFn: fetchVehicles,     staleTime: 60_000 })
  const reservationsQ = useQuery<Reservation[]>({ queryKey: ['exec-reservations'], queryFn: fetchReservations, staleTime: 60_000 })
  const damageQ       = useQuery<DamageClaim[]>({ queryKey: ['exec-damage'],       queryFn: fetchDamage,       staleTime: 60_000 })
  const locationsQ    = useQuery<Location[]>   ({ queryKey: ['exec-locations'],     queryFn: fetchLocations,    staleTime: 60_000 })

  const vehicles     = vehiclesQ.data     ?? []
  const reservations = reservationsQ.data ?? []
  const damage       = damageQ.data       ?? []
  const locations    = locationsQ.data    ?? []

  // ── Period-filtered reservation slice ───────────────────────────────────────
  const periodRes = reservations.filter(r => r.created_at >= periodStart && r.created_at < periodEnd)

  // Revenue: non-cancelled bookings created in period
  const revenue = periodRes
    .filter(r => r.status !== 'CANCELLED')
    .reduce((sum, r) => sum + parseFloat(String(r.grand_total ?? 0)), 0)

  // Overdue: return_datetime fell within the period AND vehicle came back late (or still out)
  const overdueCount = reservations.filter(r => {
    if (!r.return_datetime) return false
    const dueInPeriod = r.return_datetime >= periodStart && r.return_datetime < periodEnd
    if (!dueInPeriod) return false
    return r.status === 'CHECKED_OUT' ||
      (r.actual_return_datetime != null && r.actual_return_datetime > r.return_datetime)
  }).length

  // Reservations breakdown by status for selected period
  const resByStatus: Record<string, number> = {}
  for (const r of periodRes) {
    resByStatus[r.status] = (resByStatus[r.status] ?? 0) + 1
  }

  // Top locations by pickup volume in period (non-cancelled)
  const pickupsByLoc: Record<string, number> = {}
  for (const r of periodRes) {
    if (r.status !== 'CANCELLED' && r.pickup_location_id) {
      pickupsByLoc[r.pickup_location_id] = (pickupsByLoc[r.pickup_location_id] ?? 0) + 1
    }
  }
  const locationRows = locations
    .map(loc => ({ name: loc.name, count: pickupsByLoc[loc.location_id] ?? 0 }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // Damage claims created in period
  const periodDamage = damage
    .filter(d => d.created_at && d.created_at >= periodStart && d.created_at < periodEnd)
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 5)

  // ── Fleet snapshot (vehicle table — current state only) ─────────────────────
  const nowIso      = now.toISOString()
  const totalFleet  = vehicles.length
  const activeFleet = vehicles.filter(v => !['STAGING', 'PENDING_DISPOSAL', 'DISPOSED'].includes(v.status)).length

  // Average daily utilization: for each day in period, vehicles on rent ÷ active fleet, then averaged
  const { pct: utilizationPct, daysInPeriod } = computeAvgDailyUtilization(
    reservations, periodStart, periodEnd, activeFleet,
  )

  const vehiclesByStatus: Record<string, number> = {}
  for (const v of vehicles) {
    vehiclesByStatus[v.status] = (vehiclesByStatus[v.status] ?? 0) + 1
  }

  // Confirmed pipeline: always forward-looking regardless of selected period
  const confirmedPipeline = reservations
    .filter(r => (r.status === 'CONFIRMED' || r.status === 'PENDING') && (!r.pickup_datetime || r.pickup_datetime >= nowIso))
    .reduce((sum, r) => sum + parseFloat(String(r.grand_total ?? 0)), 0)

  const statusDisplayMap: Record<string, string> = {
    AVAILABLE:            'Available',
    ON_RENT:              'On Rent',
    CHECKED_OUT:          'Checked Out',
    MAINTENANCE:          'Maintenance',
    IN_REPAIR:            'In Repair',
    CLEANING:             'Cleaning',
    DAMAGE_HOLD:          'Damage Hold',
    ADMIN_HOLD:           'Admin Hold',
    STAGING:              'Staging',
    RETURNING:            'Returning',
    READY_FOR_INSPECTION: 'Ready for Inspection',
    PENDING_DISPOSAL:     'Pending Disposal',
    DISPOSED:             'Disposed',
    PENDING_DELIVERY:     'Pending Delivery',
  }

  const fleetStatusGroups = [
    { key: 'AVAILABLE',   color: '#10b981' },
    { key: 'ON_RENT',     color: 'var(--accent)' },
    { key: 'CHECKED_OUT', color: 'var(--accent)' },
    { key: 'MAINTENANCE', color: '#f59e0b' },
    { key: 'IN_REPAIR',   color: '#f59e0b' },
    { key: 'CLEANING',    color: '#6366f1' },
    { key: 'DAMAGE_HOLD', color: '#ef4444' },
    { key: 'ADMIN_HOLD',  color: '#8b5cf6' },
  ].filter(g => vehiclesByStatus[g.key] > 0)

  const maxFleetCount = Math.max(...fleetStatusGroups.map(g => vehiclesByStatus[g.key] ?? 0), 1)

  const isLoading = vehiclesQ.isLoading || reservationsQ.isLoading || damageQ.isLoading || locationsQ.isLoading
  const hasError  = vehiclesQ.isError   || reservationsQ.isError   || damageQ.isError   || locationsQ.isError

  return (
    <div style={{ maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header + period filter */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Executive Overview</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                padding: '6px 14px',
                borderRadius: 9999,
                border: period === p.key ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: period === p.key ? 'var(--accent-sub)' : 'transparent',
                color: period === p.key ? 'var(--sb-accent)' : 'var(--text-3)',
                fontSize: 12,
                fontWeight: period === p.key ? 600 : 400,
                cursor: 'pointer',
                letterSpacing: '0.02em',
                transition: 'all 0.15s',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {hasError && (
        <div style={{ background: 'rgba(244,114,114,0.06)', border: '1px solid rgba(244,114,114,0.2)', padding: '10px 16px', borderRadius: 0 }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Some data could not be loaded. Partial results are shown below.</p>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={100} />)
        ) : (
          <>
            <StatCard
              label={`Revenue — ${periodLabel}`}
              value={reservationsQ.isError ? '—' : fmtMoney(revenue)}
              sub={REVENUE_SUBLABEL[period]}
            />
            <StatCard
              label={`Fleet Utilization — ${periodLabel}`}
              value={(vehiclesQ.isError || reservationsQ.isError) ? '—' : `${utilizationPct}%`}
              sub={`avg daily over ${daysInPeriod} day${daysInPeriod !== 1 ? 's' : ''} · ${activeFleet} active vehicles`}
            />
            <StatCard
              label="Total Fleet"
              value={vehiclesQ.isError ? '—' : String(totalFleet)}
              sub={`${activeFleet} active · ${totalFleet - activeFleet} staging`}
              live
            />
            <StatCard
              label={`Overdue — ${periodLabel}`}
              value={reservationsQ.isError ? '—' : String(overdueCount)}
              sub={OVERDUE_SUBLABEL[period]}
            />
            <StatCard
              label="Confirmed Pipeline"
              value={reservationsQ.isError ? '—' : fmtMoney(confirmedPipeline)}
              sub="upcoming confirmed bookings"
              live
            />
          </>
        )}
      </div>

      {/* Fleet status (live) + Top locations by pickup volume (period) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '20px 24px', borderRadius: 0 }}>
          <PanelHeader title="Fleet by Status" live />
          {vehiclesQ.isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={20} />)}
            </div>
          ) : vehiclesQ.isError ? (
            <ErrorNote msg="Fleet data unavailable." />
          ) : fleetStatusGroups.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No vehicles found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fleetStatusGroups.map(g => {
                const count = vehiclesByStatus[g.key] ?? 0
                const pct   = Math.round((count / maxFleetCount) * 100)
                return (
                  <div key={g.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{statusDisplayMap[g.key] ?? g.key}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{count}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: g.color, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '20px 24px', borderRadius: 0 }}>
          <PanelHeader title={`Top Pickup Locations — ${periodLabel}`} count={locationRows.length > 0 ? locationRows.reduce((s, r) => s + r.count, 0) : undefined} />
          {locationsQ.isLoading || reservationsQ.isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={24} />)}
            </div>
          ) : locationsQ.isError || reservationsQ.isError ? (
            <ErrorNote msg="Location data unavailable." />
          ) : locationRows.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No pickups recorded for this period.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0 0 8px', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Location</th>
                  <th style={{ textAlign: 'right', padding: '0 0 8px', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pickups</th>
                </tr>
              </thead>
              <tbody>
                {locationRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0', color: 'var(--text-1)' }}>{row.name}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Damage claims (period) + Reservations breakdown (period) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '20px 24px', borderRadius: 0 }}>
          <PanelHeader title={`Damage Claims — ${periodLabel}`} count={!damageQ.isError ? periodDamage.length : undefined} />
          {damageQ.isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={40} />)}
            </div>
          ) : damageQ.isError ? (
            <ErrorNote msg="Damage claim data unavailable." />
          ) : periodDamage.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No damage claims for this period.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {periodDamage.map((d, i) => (
                <div key={d.claim_id ?? i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 600, marginBottom: 2 }}>
                      {d.claim_reference ?? `Vehicle ${d.vehicle_id?.slice(0, 8) ?? '—'}`}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {d.created_at ? fmtDate(d.created_at) : '—'}
                    </p>
                  </div>
                  {d.severity && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'var(--border)', color: 'var(--text-2)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {d.severity.replace('GRADE_', 'G').replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '20px 24px', borderRadius: 0 }}>
          <PanelHeader title={`Reservations — ${periodLabel}`} count={!reservationsQ.isError ? periodRes.length : undefined} />
          {reservationsQ.isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h={24} />)}
            </div>
          ) : reservationsQ.isError ? (
            <ErrorNote msg="Reservation data unavailable." />
          ) : Object.keys(resByStatus).length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No reservations for this period.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {Object.entries(resByStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{status.replace(/_/g, ' ')}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
