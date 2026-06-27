'use client'

interface LineItem {
  label: string
  amount: number
  is_charge: boolean
}

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const fmtCurrency = (n: number) =>
  n > 0 ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'None'

export function ReceiptBreakdownCard({ data, onAction }: Props) {
  const conf = String(data.confirmation_number || '')
  const milesDriven = Number(data.miles_driven ?? 0)
  const freeMiles = Number(data.free_miles ?? 0)
  const overageMiles = Number(data.overage_miles ?? 0)
  const overageCharge = Number(data.overage_charge ?? 0)
  const fuelOut = Number(data.fuel_level_out ?? 1)
  const fuelIn = Number(data.fuel_level_in ?? 1)
  const fuelSurcharge = Number(data.fuel_surcharge ?? 0)
  const lateMinutes = Number(data.late_minutes ?? 0)
  const lateCharge = Number(data.late_charge ?? 0)
  const subtotal = Number(data.subtotal ?? 0)
  const lineItems = (data.line_items as LineItem[]) || []

  const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }
  const labelStyle = { fontSize: 12, color: 'var(--p-text-3)' }
  const valueStyle = { fontSize: 12, fontWeight: 500, color: 'var(--p-text-1)' }
  const divider = { borderTop: '1px solid var(--agent-chip-border)', margin: '8px 0' }

  const fuelPct = (n: number) => `${(n * 100).toFixed(0)}%`

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--agent-chip-border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--p-text-1)', marginBottom: 12 }}>
        Return Breakdown{conf ? ` — ${conf}` : ''}
      </div>

      {/* Mileage */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--p-text-3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Mileage</div>
        <div style={rowStyle}>
          <span style={labelStyle}>Miles driven</span>
          <span style={valueStyle}>{milesDriven.toFixed(0)} mi</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Included miles</span>
          <span style={valueStyle}>{freeMiles.toFixed(0)} mi</span>
        </div>
        {overageMiles > 0 && (
          <div style={rowStyle}>
            <span style={labelStyle}>Overage charge</span>
            <span style={{ ...valueStyle, color: 'var(--p-danger)' }}>{fmtCurrency(overageCharge)}</span>
          </div>
        )}
      </div>

      <div style={divider} />

      {/* Fuel */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--p-text-3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Fuel</div>
        <div style={rowStyle}>
          <span style={labelStyle}>Level at pickup</span>
          <span style={valueStyle}>{fuelPct(fuelOut)}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Level at return</span>
          <span style={{ ...valueStyle, color: fuelIn < fuelOut ? 'var(--p-warn)' : 'var(--p-text-1)' }}>{fuelPct(fuelIn)}</span>
        </div>
        {fuelSurcharge > 0 && (
          <div style={rowStyle}>
            <span style={labelStyle}>Fuel surcharge</span>
            <span style={{ ...valueStyle, color: 'var(--p-danger)' }}>{fmtCurrency(fuelSurcharge)}</span>
          </div>
        )}
      </div>

      {lateMinutes > 0 && (
        <>
          <div style={divider} />
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--p-text-3)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Late Return</div>
            <div style={rowStyle}>
              <span style={labelStyle}>Late by</span>
              <span style={valueStyle}>{lateMinutes} min</span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Late charge</span>
              <span style={{ ...valueStyle, color: 'var(--p-danger)' }}>{fmtCurrency(lateCharge)}</span>
            </div>
          </div>
        </>
      )}

      <div style={{ ...divider, borderTopColor: 'rgba(255,255,255,0.15)' }} />
      <div style={{ ...rowStyle }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--p-text-1)' }}>Additional Charges</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: subtotal > 0 ? 'var(--p-danger)' : 'var(--p-success)' }}>
          {subtotal > 0 ? fmtCurrency(subtotal) : 'None'}
        </span>
      </div>

      {subtotal === 0 && (
        <div style={{
          marginTop: 10, padding: '7px 10px', borderRadius: 6,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.20)',
          fontSize: 12, color: 'var(--p-success)',
        }}>
          No additional charges — clean return!
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onAction?.('Explain these charges')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6,
            border: '1px solid var(--agent-chip-border)',
            background: 'var(--agent-chip-bg)',
            color: 'var(--p-text-2)', fontSize: 12, cursor: 'pointer',
          }}
        >
          Explain
        </button>
        {subtotal > 0 && (
          <button
            onClick={() => onAction?.('Request courtesy credit')}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 6,
              border: '1px solid rgba(218,41,28,0.25)',
              background: 'rgba(218,41,28,0.08)',
              color: 'var(--p-brand)', fontSize: 12, cursor: 'pointer',
            }}
          >
            Request Credit
          </button>
        )}
      </div>
    </div>
  )
}
