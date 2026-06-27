import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@rcm/ui/auth'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManagerKPI {
  active_rentals:      number
  pickups_today:       number
  returns_today:       number
  overdue_returns:     number
  confirmed_this_week: number
  fleet_total:         number
  fleet_available:     number
  fleet_on_rent:       number
  fleet_in_maint:      number
  revenue_today:       number
  revenue_this_month:  number
}

interface ForecastDay { date: string; pickups: number; returns: number; revenue: number }

interface PickupRow {
  confirmation_number: string
  customer_name: string
  vehicle_class: string
  vehicle: string | null
  pickup_time: string
  dropoff_location: string
  channel: string
}

interface ReturnRow {
  confirmation_number: string
  customer_name: string
  vehicle: string | null
  return_time: string
  is_overdue: boolean
  days_overdue: number
}

interface OverdueRow {
  confirmation_number: string
  customer_name: string
  vehicle: string | null
  return_time: string | null
  days_overdue: number
}

interface DashboardData {
  kpi:           ManagerKPI
  forecast:      ForecastDay[]
  pickups:       PickupRow[]
  returns:       ReturnRow[]
  overdue:       OverdueRow[]
  location_name: string | null
  location_code: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dt: string) {
  return new Date(dt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function channelLabel(ch: string) {
  const map: Record<string, string> = {
    DIRECT_WEB: 'Web', MOBILE_APP: 'App', CALL_CENTER: 'Phone',
    COUNTER: 'Counter', WALK_UP: 'Walk-up', OTA: 'OTA',
    GDS: 'GDS', KIOSK: 'Kiosk', API: 'API',
  }
  return map[ch] ?? ch
}

async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch('/api/v1/dashboard/manager', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load dashboard')
  return res.json()
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent = false, danger = false,
}: {
  label: string; value: string; sub: string; accent?: boolean; danger?: boolean
}) {
  const color = danger ? 'var(--danger)' : accent ? 'var(--accent)' : 'var(--text-1)'
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p className="text-[28px] font-bold leading-none tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{sub}</p>
    </div>
  )
}

function ForecastBar({ day, max }: { day: ForecastDay; max: number }) {
  const pct = max > 0 ? (day.pickups / max) * 100 : 0
  const d   = new Date(day.date)
  const isToday = day.date === new Date().toISOString().slice(0, 10)
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ flex: 1 }}>
      <p className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
        {day.pickups > 0 ? day.pickups : ''}
      </p>
      <div className="w-full rounded-t" style={{ height: 60, background: 'var(--border)', position: 'relative', overflow: 'hidden' }}>
        <div
          className="absolute bottom-0 left-0 right-0 rounded-t transition-all"
          style={{
            height: `${Math.max(pct, day.pickups > 0 ? 10 : 0)}%`,
            background: isToday ? 'var(--accent)' : 'rgba(99,102,241,0.45)',
          }}
        />
      </div>
      <p className="text-[10px] font-medium" style={{ color: isToday ? 'var(--accent)' : 'var(--text-2)' }}>
        {d.toLocaleDateString(undefined, { weekday: 'short' })}
      </p>
      <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
        {d.getDate()}
      </p>
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{day.revenue > 0 ? `$${Math.round(day.revenue).toLocaleString()}` : ''}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerDashboardPage() {
  const { user } = useAuth()
  const hr = new Date().getHours()
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard-manager'],
    queryFn:  fetchDashboard,
    staleTime: 60_000,
    refetchInterval: 30_000,
  })

  const kpi = data?.kpi
  const forecast = data?.forecast ?? []
  const maxPickups = Math.max(...forecast.map(f => f.pickups), 1)

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
            {greeting}{user?.first_name ? `, ${user.first_name}` : ''}
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-3)' }}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {data?.location_name && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{ background: 'var(--accent-sub)', border: '1px solid var(--accent)', flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--sb-accent)' }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            <div>
              <p className="text-[11px] font-semibold" style={{ color: 'var(--sb-accent)' }}>
                {data.location_code}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                {data.location_name}
              </p>
            </div>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex h-48 items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>
          Loading dashboard...
        </div>
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          Failed to load dashboard data.
        </div>
      )}

      {!isLoading && kpi && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Active Rentals"   value={String(kpi.active_rentals)}      sub={`of ${kpi.fleet_total} vehicles`} accent />
            <KpiCard label="Pickups Today"    value={String(kpi.pickups_today)}       sub="confirmed" />
            <KpiCard label="Returns Today"    value={String(kpi.returns_today)}       sub={kpi.overdue_returns > 0 ? `${kpi.overdue_returns} overdue` : 'on schedule'} danger={kpi.overdue_returns > 0} />
            <KpiCard label="This Week"        value={String(kpi.confirmed_this_week)} sub="confirmed bookings" />
            <KpiCard label="Revenue Today"    value={fmtMoney(kpi.revenue_today)}     sub="from today's pickups" accent />
            <KpiCard label="Month Revenue"    value={fmtMoney(kpi.revenue_this_month)} sub="month to date" />
          </div>

          {/* Fleet utilization bar */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Fleet Status — {kpi.fleet_total} vehicles
            </p>
            <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
              {[
                { count: kpi.fleet_on_rent,   color: '#6366f1', label: `On rent (${kpi.fleet_on_rent})` },
                { count: kpi.fleet_in_maint,  color: '#f59e0b', label: `Maintenance (${kpi.fleet_in_maint})` },
                { count: kpi.fleet_available, color: '#10b981', label: `Available (${kpi.fleet_available})` },
              ].map(seg => (
                <div
                  key={seg.color}
                  style={{ flex: seg.count, background: seg.color, transition: 'flex 0.3s' }}
                />
              ))}
            </div>
            <div className="mt-2 flex gap-4">
              {[
                { label: 'On Rent',    count: kpi.fleet_on_rent,   color: '#6366f1' },
                { label: 'Available',  count: kpi.fleet_available, color: '#10b981' },
                { label: 'Maintenance', count: kpi.fleet_in_maint, color: '#f59e0b' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{s.label} · {s.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Body: two columns */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
            {/* Left: pickups + returns */}
            <div className="xl:col-span-3 space-y-4">
              {/* Today's pickups */}
              <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Today's Pickups</p>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent)' }}
                  >
                    {data?.pickups.length ?? 0}
                  </span>
                </div>
                {(data?.pickups.length ?? 0) === 0 ? (
                  <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                    No pickups scheduled for today.
                  </p>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
                        <th className="px-4 py-2 text-left font-medium">Confirmation</th>
                        <th className="px-4 py-2 text-left font-medium">Customer</th>
                        <th className="px-4 py-2 text-left font-medium">Class</th>
                        <th className="px-4 py-2 text-left font-medium">Time</th>
                        <th className="px-4 py-2 text-left font-medium">Channel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.pickups.map(p => (
                        <tr key={p.confirmation_number} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="px-4 py-2.5 font-mono font-medium" style={{ color: 'var(--accent)' }}>
                            {p.confirmation_number}
                          </td>
                          <td className="px-4 py-2.5" style={{ color: 'var(--text-1)' }}>{p.customer_name}</td>
                          <td className="px-4 py-2.5" style={{ color: 'var(--text-2)' }}>
                            {p.vehicle ?? p.vehicle_class}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-1)' }}>
                            {fmt(p.pickup_time)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'var(--border)', color: 'var(--text-2)' }}
                            >
                              {channelLabel(p.channel)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Today's returns */}
              <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Today's Returns</p>
                  {kpi.overdue_returns > 0 && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}
                    >
                      {kpi.overdue_returns} overdue
                    </span>
                  )}
                </div>
                {(data?.returns.length ?? 0) === 0 ? (
                  <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                    No returns scheduled for today.
                  </p>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>
                        <th className="px-4 py-2 text-left font-medium">Confirmation</th>
                        <th className="px-4 py-2 text-left font-medium">Customer</th>
                        <th className="px-4 py-2 text-left font-medium">Vehicle</th>
                        <th className="px-4 py-2 text-left font-medium">Due</th>
                        <th className="px-4 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.returns.map(r => (
                        <tr
                          key={r.confirmation_number}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            background: r.is_overdue ? 'var(--danger-bg)' : undefined,
                          }}
                        >
                          <td className="px-4 py-2.5 font-mono font-medium" style={{ color: 'var(--accent)' }}>
                            {r.confirmation_number}
                          </td>
                          <td className="px-4 py-2.5" style={{ color: 'var(--text-1)' }}>{r.customer_name}</td>
                          <td className="px-4 py-2.5" style={{ color: 'var(--text-2)' }}>{r.vehicle ?? '—'}</td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: r.is_overdue ? 'var(--danger)' : 'var(--text-1)' }}>
                            {fmt(r.return_time)}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.is_overdue ? (
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ background: 'var(--danger)', color: 'white' }}
                              >
                                {r.days_overdue > 0 ? `${r.days_overdue}d overdue` : 'Overdue'}
                              </span>
                            ) : (
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
                              >
                                On time
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right: 7-day forecast */}
            <div className="xl:col-span-2">
              <div className="rounded-xl h-full" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>7-Day Forecast</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Pickups per day</p>
                </div>
                <div className="flex items-end gap-2 px-4 py-5" style={{ height: 180 }}>
                  {forecast.map(day => (
                    <ForecastBar key={day.date} day={day} max={maxPickups} />
                  ))}
                </div>
                <div className="px-4 pb-4 space-y-1.5">
                  {forecast.map(day => (
                    <div key={day.date} className="flex items-center justify-between text-[11px]">
                      <span style={{ color: 'var(--text-2)' }}>
                        {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="tabular-nums" style={{ color: 'var(--text-1)' }}>
                        {day.pickups} pickup{day.pickups !== 1 ? 's' : ''}{day.returns > 0 ? ` · ${day.returns} return${day.returns !== 1 ? 's' : ''}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
