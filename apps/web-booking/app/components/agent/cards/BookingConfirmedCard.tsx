'use client'

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const fmtDate = (d: string) => {
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

/* ── Booking confirmation — matches /agent-preview ConfirmCard ── */

export function BookingConfirmedCard({ data }: Props) {
  const number = String(data.confirmation_number || '')
  const cls = String(data.vehicle_class_name || '')
  const location = String(data.location || '')
  const dropoffLocation = String(data.dropoff_location || '')
  const oneWay = dropoffLocation && dropoffLocation !== location
  const pickup = String(data.pickup_date || '')
  const dropoff = String(data.dropoff_date || '')
  const total = Number(data.total || 0)
  const email = String(data.email || '')

  const rows: [string, string][] = [
    ['Class', cls],
    ...(oneWay
      ? ([['Pickup', location], ['Drop-off', dropoffLocation]] as [string, string][])
      : ([['Location', location]] as [string, string][])),
    ['Dates', `${fmtDate(pickup)} → ${fmtDate(dropoff)}`],
    ['Total charged', total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })],
  ]

  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(34,197,94,0.20)', borderTop: '2px solid #22c55e', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#22c55e', textTransform: 'uppercase' }}>CONFIRMED</div>
      </div>

      <div style={{ fontSize: 18, fontWeight: 300, color: '#fff', letterSpacing: '0.04em', marginBottom: 12 }}>{number}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.40)', flexShrink: 0 }}>{k}</span>
            <span style={{ color: k === 'Total charged' ? '#fff' : 'rgba(255,255,255,0.80)', fontWeight: k === 'Total charged' ? 500 : 400, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>

      {email && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.40)' }}>
          A confirmation email has been sent to {email}.
        </div>
      )}
    </div>
  )
}
