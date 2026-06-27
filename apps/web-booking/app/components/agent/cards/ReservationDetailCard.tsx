'use client'

const S = {
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--agent-chip-border)',
    borderRadius: 10,
    padding: '14px 16px',
    fontSize: 13,
  } as React.CSSProperties,
  label: {
    color: 'var(--p-text-3)',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 2,
  },
  value: { color: 'var(--p-text-1)', fontWeight: 500 },
  row: { marginBottom: 10 },
  conf: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--p-brand)',
    marginBottom: 12,
    letterSpacing: '0.04em',
  },
  status: (s: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: s === 'CONFIRMED' ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)',
    color: s === 'CONFIRMED' ? 'var(--p-success)' : 'var(--p-warn)',
    border: `1px solid ${s === 'CONFIRMED' ? 'rgba(34,197,94,0.25)' : 'rgba(251,191,36,0.25)'}`,
  }),
  actions: { display: 'flex', gap: 8, marginTop: 12 },
  btn: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 6,
    border: '1px solid var(--agent-chip-border)',
    background: 'var(--agent-chip-bg)',
    color: 'var(--p-text-2)',
    fontSize: 12,
    cursor: 'pointer',
  } as React.CSSProperties,
  btnDanger: {
    flex: 1,
    padding: '8px 0',
    borderRadius: 6,
    border: '1px solid rgba(240,78,78,0.25)',
    background: 'rgba(240,78,78,0.08)',
    color: 'var(--p-danger)',
    fontSize: 12,
    cursor: 'pointer',
  } as React.CSSProperties,
}

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

export function ReservationDetailCard({ data, onAction }: Props) {
  return (
    <div style={S.card}>
      <div style={S.conf}>{String(data.confirmation_number || '')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 4 }}>
        <div style={S.row}>
          <div style={S.label}>Status</div>
          <span style={S.status(String(data.status || ''))}>{String(data.status || '').replace('_', ' ')}</span>
        </div>
        <div style={S.row}>
          <div style={S.label}>Vehicle</div>
          <div style={S.value}>{String(data.vehicle_class || '—')}</div>
        </div>
        <div style={S.row}>
          <div style={S.label}>Pickup</div>
          <div style={S.value}>{String(data.pickup_date || '—')}</div>
        </div>
        <div style={S.row}>
          <div style={S.label}>Return</div>
          <div style={S.value}>{String(data.dropoff_date || '—')}</div>
        </div>
      </div>
      <div style={S.actions}>
        <button style={S.btn} onClick={() => onAction?.('Change my dates')}>
          Change Dates
        </button>
        <button style={S.btnDanger} onClick={() => onAction?.('Cancel this reservation')}>
          Cancel
        </button>
      </div>
    </div>
  )
}
