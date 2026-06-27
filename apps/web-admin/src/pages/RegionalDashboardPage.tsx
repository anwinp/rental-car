import { useQuery } from '@tanstack/react-query'

const TENANT_HEADERS = {
  'Content-Type': 'application/json',
  'X-Tenant-ID': '00000000-0000-0000-0000-000000000001',
}

interface Location {
  location_id: string
  name: string
}

interface Vehicle {
  vehicle_id: string
  status: string
  home_location_id?: string
  current_location_id?: string
}

interface Reservation {
  reservation_id: string
  status: string
  pickup_location_id?: string
  return_datetime?: string
  actual_return_datetime?: string
  assigned_vehicle_id?: string
}

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations', { credentials: 'include', headers: TENANT_HEADERS })
  if (!res.ok) throw new Error('Failed to load locations')
  const data = await res.json()
  return Array.isArray(data) ? data : (data.locations ?? data.items ?? [])
}

async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await fetch('/api/v1/fleet/vehicles?limit=200', { credentials: 'include', headers: TENANT_HEADERS })
  if (!res.ok) throw new Error('Failed to load vehicles')
  const data = await res.json()
  return Array.isArray(data) ? data : (data.vehicles ?? data.items ?? [])
}

async function fetchReservations(): Promise<Reservation[]> {
  const PAGE = 100
  const all: Reservation[] = []
  let offset = 0
  while (true) {
    const res = await fetch(`/api/v1/reservations?limit=${PAGE}&offset=${offset}`, { credentials: 'include', headers: TENANT_HEADERS })
    if (!res.ok) throw new Error('Failed to load reservations')
    const data = await res.json()
    const page: Reservation[] = Array.isArray(data) ? data : (data.reservations ?? data.items ?? [])
    all.push(...page)
    if (page.length < PAGE) break
    offset += PAGE
  }
  return all
}

function Skeleton({ h = 60 }: { h?: number }) {
  return <div style={{ height: h, background: 'var(--border)', borderRadius: 4 }} />
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: 'var(--card-bg)', padding: '20px 24px', borderRadius: 0, border: '1px solid var(--border)' }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>{value}</p>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{sub}</p>
    </div>
  )
}

function scoreGrade(utilPct: number): string {
  if (utilPct > 80) return 'A'
  if (utilPct > 70) return 'B+'
  if (utilPct > 60) return 'B'
  return 'C'
}

function scoreColor(grade: string): string {
  if (grade === 'A')  return '#10b981'
  if (grade === 'B+') return '#6366f1'
  if (grade === 'B')  return '#f59e0b'
  return 'var(--text-3)'
}

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE:            '#10b981',
  ON_RENT:              'var(--accent)',
  CHECKED_OUT:          'var(--accent)',
  MAINTENANCE:          '#f59e0b',
  IN_REPAIR:            '#f59e0b',
  CLEANING:             '#6366f1',
  DAMAGE_HOLD:          '#ef4444',
  ADMIN_HOLD:           '#8b5cf6',
  STAGING:              '#64748b',
  RETURNING:            '#0ea5e9',
  READY_FOR_INSPECTION: '#0ea5e9',
  PENDING_DISPOSAL:     '#94a3b8',
  DISPOSED:             '#64748b',
  PENDING_DELIVERY:     '#64748b',
}

interface BranchRow {
  location_id: string
  name: string
  fleet: number
  activeFleet: number
  staging: number
  available: number
  out: number
  maintenance: number
  unavailable: number
  overdue: number
  utilPct: number
  grade: string
  statusBreakdown: Record<string, number>
}

export function RegionalDashboardPage() {
  const now = new Date()
  const nowIso = now.toISOString()

  const locationsQ    = useQuery<Location[]>   ({ queryKey: ['regional-locations'],    queryFn: fetchLocations,    staleTime: 60_000 })
  const vehiclesQ     = useQuery<Vehicle[]>    ({ queryKey: ['regional-vehicles'],     queryFn: fetchVehicles,     staleTime: 60_000 })
  const reservationsQ = useQuery<Reservation[]>({ queryKey: ['regional-reservations'], queryFn: fetchReservations, staleTime: 60_000 })

  const locations    = locationsQ.data    ?? []
  const vehicles     = vehiclesQ.data     ?? []
  const reservations = reservationsQ.data ?? []

  const isLoading = locationsQ.isLoading || vehiclesQ.isLoading || reservationsQ.isLoading
  const hasError  = locationsQ.isError   || vehiclesQ.isError   || reservationsQ.isError

  // Group vehicles by their effective location (current if set, else home)
  const vehiclesByLocation: Record<string, Vehicle[]> = {}
  for (const v of vehicles) {
    const lid = v.current_location_id ?? v.home_location_id
    if (!lid) continue
    if (!vehiclesByLocation[lid]) vehiclesByLocation[lid] = []
    vehiclesByLocation[lid].push(v)
  }

  // Group non-cancelled reservations by pickup location
  const reservationsByLocation: Record<string, Reservation[]> = {}
  for (const r of reservations) {
    if (r.status === 'CANCELLED') continue
    const lid = r.pickup_location_id
    if (!lid) continue
    if (!reservationsByLocation[lid]) reservationsByLocation[lid] = []
    reservationsByLocation[lid].push(r)
  }

  const branchRows: BranchRow[] = locations.map(loc => {
    const locVehicles     = vehiclesByLocation[loc.location_id]     ?? []
    const locReservations = reservationsByLocation[loc.location_id] ?? []

    const statusBreakdown: Record<string, number> = {}
    for (const v of locVehicles) {
      statusBreakdown[v.status] = (statusBreakdown[v.status] ?? 0) + 1
    }

    const fleet        = locVehicles.length
    const staging      = (statusBreakdown['STAGING'] ?? 0) + (statusBreakdown['PENDING_DISPOSAL'] ?? 0) + (statusBreakdown['DISPOSED'] ?? 0)
    const activeFleet  = fleet - staging
    const available    = statusBreakdown['AVAILABLE'] ?? 0
    const out          = (statusBreakdown['ON_RENT'] ?? 0) + (statusBreakdown['CHECKED_OUT'] ?? 0)
    const maintenance  = (statusBreakdown['MAINTENANCE'] ?? 0) + (statusBreakdown['IN_REPAIR'] ?? 0)
    const unavailable  = activeFleet - available - out - maintenance

    // Overdue: CHECKED_OUT reservations past their return_datetime
    const overdue = locReservations.filter(r =>
      r.status === 'CHECKED_OUT' && r.return_datetime && r.return_datetime < nowIso,
    ).length

    // Utilization: on rent ÷ active fleet (staging vehicles excluded from denominator)
    const utilPct = activeFleet > 0 ? Math.round((out / activeFleet) * 100) : 0
    const grade   = scoreGrade(utilPct)

    return { location_id: loc.location_id, name: loc.name, fleet, activeFleet, staging, available, out, maintenance, unavailable, overdue, utilPct, grade, statusBreakdown }
  }).filter(row => row.fleet > 0) // only show locations that have vehicles

  const totalFleet   = vehicles.length
  const activeFleet  = vehicles.filter(v => !['STAGING', 'PENDING_DISPOSAL', 'DISPOSED'].includes(v.status)).length
  const totalOnRent  = branchRows.reduce((s, r) => s + r.out, 0)
  // Weighted avg: total on-rent ÷ total active fleet (not per-branch average, which distorts for small branches)
  const avgUtil      = activeFleet > 0 ? Math.round((totalOnRent / activeFleet) * 100) : 0
  const totalOverdue = reservations.filter(r =>
    r.status === 'CHECKED_OUT' && r.return_datetime && r.return_datetime < nowIso,
  ).length

  const allStatuses = Array.from(new Set(vehicles.map(v => v.status))).sort()

  return (
    <div style={{ maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Regional Overview</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {hasError && (
        <div style={{ background: 'rgba(244,114,114,0.06)', border: '1px solid rgba(244,114,114,0.2)', padding: '10px 16px', borderRadius: 0 }}>
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Some data could not be loaded. Partial results are shown.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={100} />)
        ) : (
          <>
            <StatCard label="Branches" value={String(branchRows.length)} sub={`of ${locations.length} locations with fleet`} />
            <StatCard label="Total Fleet" value={String(totalFleet)} sub={`${activeFleet} active · ${totalFleet - activeFleet} staging`} />
            <StatCard label="Avg Utilization" value={`${avgUtil}%`} sub="on rent ÷ total fleet per branch, averaged" />
            <StatCard label="Total Overdue" value={String(totalOverdue)} sub="checked out past return date" />
          </>
        )}
      </div>

      {/* Branch comparison table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Branch Comparison</p>
        </div>
        {isLoading ? (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={36} />)}
          </div>
        ) : branchRows.length === 0 ? (
          <p style={{ padding: '24px', fontSize: 13, color: 'var(--text-3)' }}>No branches found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Branch', 'Fleet', 'Active', 'Available', 'On Rent', 'Maint.', 'Utilization', 'Overdue', 'Score'].map(col => (
                    <th key={col} style={{ padding: '10px 16px', textAlign: col === 'Branch' ? 'left' : 'right', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...branchRows].sort((a, b) => b.fleet - a.fleet).map(row => {
                  const gc = scoreColor(row.grade)
                  return (
                    <tr key={row.location_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px', color: 'var(--text-1)', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.name}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{row.fleet}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{row.activeFleet}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#10b981', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.available}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.out}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{row.maintenance}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(row.utilPct, 100)}%`, background: row.utilPct > 80 ? '#10b981' : row.utilPct > 60 ? '#f59e0b' : 'var(--accent)', transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ color: 'var(--text-1)', minWidth: 36 }}>{row.utilPct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {row.overdue > 0
                          ? <span style={{ color: '#ef4444', fontWeight: 700 }}>{row.overdue}</span>
                          : <span style={{ color: 'var(--text-3)' }}>0</span>}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-block', minWidth: 32, padding: '2px 8px', borderRadius: 9999, background: `${gc}22`, color: gc, fontWeight: 700, fontSize: 12, textAlign: 'center' }}>
                          {row.grade}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fleet status distribution bars */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Fleet Status by Branch</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            {allStatuses.map(s => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 9999, background: STATUS_COLORS[s] ?? '#64748b' }} />
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={32} />)}
          </div>
        ) : branchRows.length === 0 ? (
          <p style={{ padding: '24px', fontSize: 13, color: 'var(--text-3)' }}>No branches found.</p>
        ) : (
          <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[...branchRows].sort((a, b) => b.fleet - a.fleet).map(row => {
              const total    = row.fleet || 1
              const segments = Object.entries(row.statusBreakdown)
                .filter(([, count]) => count > 0)
                .map(([status, count]) => ({ status, count, pct: (count / total) * 100 }))
              return (
                <div key={row.location_id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ minWidth: 220, maxWidth: 220, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.name}
                  </div>
                  <div style={{ flex: 1, height: 18, display: 'flex', overflow: 'hidden', borderRadius: 0, background: 'var(--border)' }}>
                    {segments.map(seg => (
                      <div
                        key={seg.status}
                        title={`${seg.status.replace(/_/g, ' ')}: ${seg.count}`}
                        style={{ width: `${seg.pct}%`, background: STATUS_COLORS[seg.status] ?? '#64748b', transition: 'width 0.3s' }}
                      />
                    ))}
                  </div>
                  <div style={{ minWidth: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                    {row.fleet}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
