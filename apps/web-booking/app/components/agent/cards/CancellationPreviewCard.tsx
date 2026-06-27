'use client'

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }
const label = { color: 'var(--p-text-3)', fontSize: 12 }
const amount = { fontWeight: 600, fontSize: 13, color: 'var(--p-text-1)' }
const divider = { borderTop: '1px solid var(--agent-chip-border)', margin: '6px 0' }

export function CancellationPreviewCard({ data, onAction }: Props) {
  const fee = Number(data.cancellation_fee ?? 0)
  const refund = Number(data.refund_amount ?? 0)
  const policy = String(data.policy_name || 'standard')
  const conf = String(data.confirmation_number || '')

  return (
    <div style={{
      background: 'rgba(240,78,78,0.05)',
      border: '1px solid rgba(240,78,78,0.20)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--p-danger)', marginBottom: 10 }}>
        Cancellation Summary — {conf}
      </div>

      <div style={row}>
        <span style={label}>Policy</span>
        <span style={{ ...amount, textTransform: 'capitalize' }}>{policy.toLowerCase()}</span>
      </div>
      <div style={divider} />
      <div style={row}>
        <span style={label}>Cancellation fee</span>
        <span style={{ ...amount, color: fee > 0 ? 'var(--p-danger)' : 'var(--p-success)' }}>
          {fee > 0 ? `$${fee.toFixed(2)}` : 'Free'}
        </span>
      </div>
      <div style={row}>
        <span style={label}>Refund to card</span>
        <span style={{ ...amount, color: 'var(--p-success)' }}>${refund.toFixed(2)}</span>
      </div>

      {fee === 0 && (
        <div style={{
          marginTop: 10,
          padding: '6px 10px',
          background: 'rgba(34,197,94,0.08)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--p-success)',
        }}>
          Free cancellation — full refund applies
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onAction?.('Yes, cancel my reservation')}
          style={{
            flex: 1,
            padding: '9px 0',
            borderRadius: 6,
            border: '1px solid rgba(240,78,78,0.35)',
            background: 'rgba(240,78,78,0.12)',
            color: 'var(--p-danger)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Confirm Cancellation
        </button>
        <button
          onClick={() => onAction?.('No, keep it')}
          style={{
            flex: 1,
            padding: '9px 0',
            borderRadius: 6,
            border: '1px solid var(--agent-chip-border)',
            background: 'var(--agent-chip-bg)',
            color: 'var(--p-text-2)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Keep Reservation
        </button>
      </div>
    </div>
  )
}
