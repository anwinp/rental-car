import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@rcm/ui/auth'

interface StaffPickup {
  confirmation_number:  string
  customer_name:        string
  vehicle_class:        string
  vehicle:              string | null
  plate:                string | null
  pickup_time:          string
  special_instructions: string | null
  flight_number:        string | null
  channel:              string
}

interface StaffReturn {
  confirmation_number: string
  customer_name:       string
  vehicle:             string | null
  plate:               string | null
  return_time:         string
  is_overdue:          boolean
  days_overdue:        number
}

interface ServiceDue {
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
  is_overdue: boolean
}

interface UpcomingPickup {
  confirmation_number: string
  customer_name:       string
  vehicle_class:       string
  pickup_time:         string
}

interface StaffData {
  pickups_today: StaffPickup[]
  returns_today: StaffReturn[]
  service_due:   ServiceDue[]
  upcoming_week: UpcomingPickup[]
}

function fmt(dt: string) {
  return new Date(dt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const BLOCK_LABELS: Record<string, string> = {
  MAINTENANCE: 'Maintenance', INSPECTION: 'Inspection', RECALL_HOLD: 'Recall Hold',
}

async function fetchStaff(): Promise<StaffData> {
  const res = await fetch('/api/v1/dashboard/staff', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load staff dashboard')
  return res.json()
}

function SectionHeader({ title, count, danger }: { title: string; count: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{title}</p>
      {count > 0 && (
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{
            background: danger ? 'var(--danger-bg)' : 'rgba(99,102,241,0.12)',
            color: danger ? 'var(--danger)' : 'var(--accent)',
          }}
        >
          {count}
        </span>
      )}
    </div>
  )
}

function EmptyRow({ msg }: { msg: string }) {
  return (
    <p className="px-4 py-5 text-center text-sm" style={{ color: 'var(--text-3)' }}>{msg}</p>
  )
}

export function StaffDashboardPage() {
  const { data, isLoading, error } = useQuery<StaffData>({
    queryKey: ['dashboard-staff'],
    queryFn:  fetchStaff,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: damageData } = useQuery<{ items: Array<{ claim_status: string }> }>({
    queryKey: ['damage-open'],
    queryFn: async () => {
      const res = await fetch('/api/v1/damage?status=OPEN', { credentials: 'include' })
      if (!res.ok) return { items: [] }
      const d = await res.json()
      return { items: Array.isArray(d) ? d : (d.items ?? []) }
    },
    staleTime: 60_000,
  })

  const { user } = useAuth()
  const role = user?.role ?? ''
  const isReturnAgent = role === 'SENIOR_AGENT'
  const isManager = ['BRANCH_MANAGER', 'REGIONAL_MANAGER', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(role)

  const returnsQueueCount = data?.returns_today.length ?? 0
  const overdueReturnCount = data?.returns_today.filter(r => r.is_overdue).length ?? 0
  const openDamageCount = damageData?.items.filter(d => d.claim_status === 'OPEN').length ?? (damageData?.items.length ?? 0)

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>
        Loading...
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
        Failed to load staff dashboard.
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {isReturnAgent && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'RETURNS QUEUE', value: returnsQueueCount, sub: 'due today', danger: false },
            { label: 'OVERDUE', value: overdueReturnCount, sub: 'action required', danger: overdueReturnCount > 0 },
            { label: 'OPEN DAMAGE', value: openDamageCount, sub: 'claims', danger: false },
          ].map(card => (
            <div key={card.label} style={{ background: 'var(--card-bg)', padding: '16px 20px', borderRadius: 0, border: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{card.label}</p>
              <p style={{ fontSize: 32, fontWeight: 700, color: card.danger ? 'var(--danger)' : 'var(--text-1)', lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>{card.sub}</p>
            </div>
          ))}
        </div>
      )}
      {isManager && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'PICKUPS TODAY', value: data?.pickups_today.length ?? 0, sub: '', danger: false },
            { label: 'RETURNS TODAY', value: returnsQueueCount, sub: '', danger: false },
            { label: 'OVERDUE RETURNS', value: overdueReturnCount, sub: '', danger: overdueReturnCount > 0 },
          ].map(card => (
            <div key={card.label} style={{ background: 'var(--card-bg)', padding: '16px 20px', borderRadius: 0, border: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>{card.label}</p>
              <p style={{ fontSize: 32, fontWeight: 700, color: card.danger ? 'var(--danger)' : 'var(--text-1)', lineHeight: 1 }}>{card.value}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>{card.sub}</p>
            </div>
          ))}
        </div>
      )}
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
          {isReturnAgent ? 'Returns — Today' : 'Operations — Today'}
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-3)' }}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {' '}&middot;{' '}
          {(data?.pickups_today.length ?? 0)} pickups · {(data?.returns_today.length ?? 0)} returns
          {overdueReturnCount > 0 && ` · ${overdueReturnCount} overdue`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Pickups */}
        <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <SectionHeader title="Pickups Today" count={data?.pickups_today.length ?? 0} />
          {(data?.pickups_today.length ?? 0) === 0 ? (
            <EmptyRow msg="No pickups scheduled." />
          ) : (
            <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
              {data?.pickups_today.map(p => (
                <div key={p.confirmation_number} className="flex items-start gap-3 px-4 py-3">
                  {/* Time indicator */}
                  <div
                    className="shrink-0 rounded-lg px-2 py-1 text-center"
                    style={{ background: 'rgba(99,102,241,0.08)', minWidth: 52 }}
                  >
                    <p className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                      {fmt(p.pickup_time)}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {p.customer_name}
                      </p>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {p.confirmation_number}
                      </span>
                    </div>
                    <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                      {p.vehicle
                        ? p.vehicle + (p.plate ? ` · ${p.plate}` : '')
                        : p.vehicle_class}
                    </p>
                    {p.flight_number && (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        Flight: {p.flight_number}
                      </p>
                    )}
                    {p.special_instructions && (
                      <p className="mt-0.5 text-[11px]" style={{ color: '#d97706' }}>
                        {p.special_instructions}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: 'var(--border)', color: 'var(--text-3)' }}
                    >
                      {p.channel === 'DIRECT_WEB' ? 'Web'
                        : p.channel === 'CALL_CENTER' ? 'Phone'
                        : p.channel === 'OTA' ? 'OTA'
                        : p.channel}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Returns */}
        <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <SectionHeader title="Returns Today" count={data?.returns_today.length ?? 0} danger={overdueReturnCount > 0} />
          {(data?.returns_today.length ?? 0) === 0 ? (
            <EmptyRow msg="No returns expected today." />
          ) : (
            <div className="divide-y">
              {data?.returns_today.map(r => (
                <div
                  key={r.confirmation_number}
                  className="flex items-start gap-3 px-4 py-3"
                  style={{ background: r.is_overdue ? 'var(--danger-bg)' : undefined }}
                >
                  <div
                    className="shrink-0 rounded-lg px-2 py-1 text-center"
                    style={{
                      background: r.is_overdue ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.08)',
                      minWidth: 52,
                    }}
                  >
                    <p
                      className="text-[13px] font-bold tabular-nums"
                      style={{ color: r.is_overdue ? 'var(--danger)' : '#10b981' }}
                    >
                      {fmt(r.return_time)}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {r.customer_name}
                      </p>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {r.confirmation_number}
                      </span>
                    </div>
                    <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                      {r.vehicle ? r.vehicle + (r.plate ? ` · ${r.plate}` : '') : 'Vehicle TBD'}
                    </p>
                  </div>
                  <div className="shrink-0">
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
                        Expected
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Service Due */}
        <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <SectionHeader title="Service Due / Overdue" count={data?.service_due.length ?? 0} danger={(data?.service_due.some(s => s.is_overdue)) ?? false} />
          {(data?.service_due.length ?? 0) === 0 ? (
            <EmptyRow msg="No service items due in the next 48 hours." />
          ) : (
            <div className="divide-y">
              {data?.service_due.map(s => (
                <div
                  key={s.block_id}
                  className="flex items-start gap-3 px-4 py-3"
                  style={{ background: s.is_overdue ? 'var(--danger-bg)' : undefined }}
                >
                  <div
                    className="shrink-0 rounded-lg px-2 py-1 text-center"
                    style={{
                      background: s.is_overdue ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.1)',
                      minWidth: 52,
                    }}
                  >
                    <p
                      className="text-[10px] font-bold uppercase"
                      style={{ color: s.is_overdue ? 'var(--danger)' : '#d97706' }}
                    >
                      {s.location}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {s.make} {s.model} {s.model_year}
                      {s.plate && <span className="font-normal text-[11px] ml-1" style={{ color: 'var(--text-3)' }}>· {s.plate}</span>}
                    </p>
                    <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                      {BLOCK_LABELS[s.block_type] ?? s.block_type.replace(/_/g, ' ')}
                      {' '}&middot;{' '}
                      {fmtDate(s.start_time)} → {fmtDate(s.end_time)}
                    </p>
                    {s.notes && (
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{s.notes}</p>
                    )}
                  </div>
                  {s.is_overdue && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: 'var(--danger)', color: 'white' }}
                    >
                      Overdue
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming this week */}
        <div className="rounded-xl" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <SectionHeader title="Upcoming This Week" count={data?.upcoming_week.length ?? 0} />
          {(data?.upcoming_week.length ?? 0) === 0 ? (
            <EmptyRow msg="No upcoming pickups this week." />
          ) : (
            <div className="divide-y">
              {data?.upcoming_week.map(u => (
                <div key={u.confirmation_number} className="flex items-center gap-3 px-4 py-2.5">
                  <div
                    className="shrink-0 rounded-md px-2 py-1 text-center"
                    style={{ background: 'var(--border)', minWidth: 44 }}
                  >
                    <p className="text-[10px] font-bold" style={{ color: 'var(--text-2)' }}>
                      {new Date(u.pickup_time).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
                    </p>
                    <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                      {new Date(u.pickup_time).getDate()}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: 'var(--text-1)' }}>
                      {u.customer_name}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                      {u.vehicle_class} · {fmt(u.pickup_time)}
                    </p>
                  </div>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>
                    {u.confirmation_number}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
