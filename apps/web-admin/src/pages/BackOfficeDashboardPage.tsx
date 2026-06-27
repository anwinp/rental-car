import { useQuery } from '@tanstack/react-query'

interface MaintenanceBlock {
  block_id:   string
  vehicle_id: string
  make:       string
  model:      string
  model_year: number
  plate:      string | null
  location:   string
  block_type: string
  start_time: string
  end_time:   string
  notes:      string | null
  status:     'upcoming' | 'active' | 'overdue'
}

interface DamageClaim {
  claim_id:        string
  claim_reference: string
  vehicle_id:      string
  make:            string
  model:           string
  damage_zone:     string | null
  damage_type:     string | null
  severity:        string
  description:     string | null
  claim_status:    string
  discovered_at:   string
}

interface BlockedVehicle {
  block_id:   string
  vehicle_id: string
  make:       string
  model:      string
  plate:      string | null
  location:   string
  block_type: string
  reason:     string | null
  since:      string
  until:      string
}

interface NoteEntry {
  block_id:   string
  vehicle:    string
  location:   string
  block_type: string
  notes:      string
  created_at: string
}

interface BackOfficeData {
  maintenance:      MaintenanceBlock[]
  damage_claims:    DamageClaim[]
  blocked_vehicles: BlockedVehicle[]
  notes_feed:       NoteEntry[]
}

const BLOCK_COLORS: Record<string, { bg: string; text: string }> = {
  MAINTENANCE: { bg: '#fffbeb', text: '#92400e' },
  INSPECTION:  { bg: '#faf5ff', text: '#6b21a8' },
  RECALL_HOLD: { bg: '#fef2f2', text: '#991b1b' },
  IN_TRANSIT:  { bg: '#f0f9ff', text: '#075985' },
  CHARGING:    { bg: '#ecfdf5', text: '#065f46' },
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  active:   { bg: 'rgba(99,102,241,0.12)', text: 'var(--accent)',  label: 'Active'   },
  upcoming: { bg: 'rgba(16,185,129,0.12)', text: '#10b981',         label: 'Upcoming' },
  overdue:  { bg: 'var(--danger-bg)',      text: 'var(--danger)',   label: 'Overdue'  },
}

function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtRelative(dt: string) {
  const diff = Date.now() - new Date(dt).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

async function fetchBackOffice(): Promise<BackOfficeData> {
  const res = await fetch('/api/v1/dashboard/back-office', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load back-office dashboard')
  return res.json()
}

export function BackOfficeDashboardPage() {
  const { data, isLoading, error } = useQuery<BackOfficeData>({
    queryKey: ['dashboard-back-office'],
    queryFn:  fetchBackOffice,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  if (isLoading) {
    return <div className="flex h-48 items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>Loading...</div>
  }
  if (error) {
    return <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>Failed to load data.</div>
  }

  const byStatus = {
    active:   data?.maintenance.filter(m => m.status === 'active') ?? [],
    upcoming: data?.maintenance.filter(m => m.status === 'upcoming') ?? [],
    overdue:  data?.maintenance.filter(m => m.status === 'overdue') ?? [],
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[
            {
              label: 'ACTIVE MAINTENANCE',
              value: data.maintenance.filter(m => m.status === 'active').length,
              sub: 'vehicles in service',
              danger: false,
            },
            {
              label: 'OVERDUE SERVICE',
              value: data.maintenance.filter(m => m.status === 'overdue').length,
              sub: 'past scheduled date',
              danger: data.maintenance.filter(m => m.status === 'overdue').length > 0,
            },
            {
              label: 'BLOCKED VEHICLES',
              value: data.blocked_vehicles.length,
              sub: 'off-road',
              danger: false,
            },
            {
              label: 'DAMAGE CLAIMS',
              value: data.damage_claims.length,
              sub: 'open claims',
              danger: false,
            },
          ].map(card => (
            <div key={card.label} style={{ background: 'var(--card-bg)', padding: '16px 20px', borderRadius: 0, border: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{card.label}</p>
              <p style={{ fontSize: 32, fontWeight: 700, color: card.danger ? 'var(--danger)' : 'var(--text-1)', lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>{card.sub}</p>
            </div>
          ))}
        </div>
      )}
      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
          Back Office
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-3)' }}>
          {data?.maintenance.length ?? 0} maintenance items
          {' '}&middot;{' '}
          {data?.blocked_vehicles.length ?? 0} blocked vehicles
          {' '}&middot;{' '}
          {data?.damage_claims.length ?? 0} damage claim{data?.damage_claims.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        {/* Left — maintenance + blocked */}
        <div className="xl:col-span-3 space-y-4">
          {/* Maintenance schedule */}
          <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Maintenance Schedule</p>
              <div className="flex gap-2">
                {Object.entries(byStatus).map(([st, items]) => items.length > 0 && (
                  <span
                    key={st}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: STATUS_STYLE[st].bg, color: STATUS_STYLE[st].text }}
                  >
                    {items.length} {STATUS_STYLE[st].label.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>

            {(data?.maintenance.length ?? 0) === 0 ? (
              <p className="px-4 py-5 text-center text-sm" style={{ color: 'var(--text-3)' }}>No maintenance scheduled in this window.</p>
            ) : (
              <div className="divide-y overflow-y-auto" style={{ maxHeight: 360 }}>
                {data?.maintenance.map(m => {
                  const c   = BLOCK_COLORS[m.block_type] ?? { bg: '#f8fafc', text: '#475569' }
                  const ss  = STATUS_STYLE[m.status]
                  return (
                    <div key={m.block_id} className="flex items-start gap-3 px-4 py-3">
                      <div
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: c.bg, color: c.text, border: `1px solid ${c.text}22` }}
                      >
                        {m.block_type.replace(/_/g, ' ')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                          {m.make} {m.model} {m.model_year}
                          {m.plate && <span className="font-normal ml-1 text-[11px]" style={{ color: 'var(--text-3)' }}>· {m.plate}</span>}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                          {m.location} · {fmtDate(m.start_time)} → {fmtDate(m.end_time)}
                        </p>
                        {m.notes && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{m.notes}</p>}
                      </div>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: ss.bg, color: ss.text }}
                      >
                        {ss.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Blocked vehicles */}
          <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                Blocked Vehicles
                {(data?.blocked_vehicles.length ?? 0) > 0 && (
                  <span
                    className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'rgba(245,158,11,0.12)', color: '#d97706' }}
                  >
                    {data?.blocked_vehicles.length}
                  </span>
                )}
              </p>
            </div>
            {(data?.blocked_vehicles.length ?? 0) === 0 ? (
              <p className="px-4 py-5 text-center text-sm" style={{ color: 'var(--text-3)' }}>No blocked vehicles.</p>
            ) : (
              <div className="divide-y">
                {data?.blocked_vehicles.map(b => (
                  <div key={b.block_id} className="flex items-start gap-3 px-4 py-3">
                    <div
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: b.block_type === 'HOLD' ? '#f8fafc' : '#fdf4ff', color: b.block_type === 'HOLD' ? '#475569' : '#701a75' }}
                    >
                      {b.block_type}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {b.make} {b.model}
                        {b.plate && <span className="font-normal ml-1" style={{ color: 'var(--text-3)' }}>· {b.plate}</span>}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                        {b.location} · until {fmtDate(b.until)}
                      </p>
                      {b.reason && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{b.reason}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — damage + notes */}
        <div className="xl:col-span-2 space-y-4">
          {/* Damage claims */}
          <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Damage Claims</p>
            </div>
            {(data?.damage_claims.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ background: 'rgba(16,185,129,0.12)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <p className="text-[12px] font-medium" style={{ color: '#10b981' }}>No open damage claims</p>
              </div>
            ) : (
              <div className="divide-y">
                {data?.damage_claims.map(d => (
                  <div key={d.claim_id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>{d.claim_reference}</p>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: d.severity === 'HIGH' ? 'var(--danger-bg)' : 'rgba(245,158,11,0.12)',
                          color: d.severity === 'HIGH' ? 'var(--danger)' : '#d97706',
                        }}
                      >
                        {d.severity}
                      </span>
                    </div>
                    <p className="text-[12px] font-medium" style={{ color: 'var(--text-1)' }}>{d.make} {d.model}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                      {[d.damage_zone, d.damage_type].filter(Boolean).join(' · ')}
                    </p>
                    {d.description && (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{d.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operational notes feed */}
          <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Operational Notes</p>
            </div>
            {(data?.notes_feed.length ?? 0) === 0 ? (
              <p className="px-4 py-5 text-center text-sm" style={{ color: 'var(--text-3)' }}>No notes recorded.</p>
            ) : (
              <div className="divide-y overflow-y-auto" style={{ maxHeight: 360 }}>
                {data?.notes_feed.map(n => (
                  <div key={n.block_id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {n.vehicle}
                      </p>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        {fmtRelative(n.created_at)}
                      </span>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                      {n.location} · {n.block_type.replace(/_/g, ' ').toLowerCase()}
                    </p>
                    <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-1)' }}>{n.notes}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
