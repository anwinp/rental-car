'use client'

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const badge = (status: string) => {
  const map: Record<string, { bg: string; color: string }> = {
    OPEN: { bg: 'rgba(251,191,36,0.10)', color: 'var(--p-warn)' },
    ESTIMATE_SENT: { bg: 'rgba(59,130,246,0.10)', color: '#60a5fa' },
    REPAIR_IN_PROGRESS: { bg: 'rgba(139,92,246,0.10)', color: '#a78bfa' },
    PAID: { bg: 'rgba(34,197,94,0.10)', color: 'var(--p-success)' },
    DISPUTED: { bg: 'rgba(240,78,78,0.10)', color: 'var(--p-danger)' },
  }
  const s = map[status] || { bg: 'rgba(255,255,255,0.06)', color: 'var(--p-text-3)' }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {status?.replace(/_/g, ' ')}
    </span>
  )
}

const fmtCurrency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function DamageComparisonCard({ data, onAction }: Props) {
  const zone = String(data.zone || '').replace(/_/g, ' ')
  const dmgType = String(data.damage_type || '')
  const severity = String(data.severity || '').replace(/_/g, ' ')
  const estimate = Number(data.estimate_amount ?? 0)
  const deductible = Number(data.deductible ?? 0)
  const confidence = Number(data.confidence ?? 0)
  const autoSettled = Boolean(data.auto_settled)
  const status = String(data.status || 'OPEN')
  const preUrl = data.pre_photo_url as string | null
  const postUrl = data.post_photo_url as string | null

  const rowStyle = { display: 'flex', justifyContent: 'space-between', padding: '5px 0' }
  const labelStyle = { fontSize: 12, color: 'var(--p-text-3)' }
  const valueStyle = { fontSize: 12, fontWeight: 500, color: 'var(--p-text-1)' }
  const divider = { borderTop: '1px solid var(--agent-chip-border)', margin: '6px 0' }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--agent-chip-border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--p-text-1)' }}>Damage Claim</div>
        {badge(status)}
      </div>

      {/* Photo comparison */}
      {(preUrl || postUrl) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[{ url: preUrl, label: 'Pre-Rental' }, { url: postUrl, label: 'Post-Rental' }].map(({ url, label }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: 'var(--p-text-3)', marginBottom: 4 }}>{label}</div>
              {url ? (
                <img src={url} alt={label} style={{
                  width: '100%', aspectRatio: '4/3', objectFit: 'cover',
                  borderRadius: 6, border: '1px solid var(--agent-chip-border)',
                }} />
              ) : (
                <div style={{
                  width: '100%', aspectRatio: '4/3', borderRadius: 6,
                  border: '1px dashed var(--agent-chip-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: 'var(--p-text-3)',
                }}>No photo</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Damage details */}
      <div style={divider} />
      {zone && (
        <div style={rowStyle}>
          <span style={labelStyle}>Zone</span>
          <span style={valueStyle}>{zone}</span>
        </div>
      )}
      {dmgType && dmgType !== 'NONE' && (
        <div style={rowStyle}>
          <span style={labelStyle}>Type</span>
          <span style={valueStyle}>{dmgType}</span>
        </div>
      )}
      {severity && severity !== 'NONE' && (
        <div style={rowStyle}>
          <span style={labelStyle}>Severity</span>
          <span style={valueStyle}>{severity}</span>
        </div>
      )}
      {confidence > 0 && (
        <div style={rowStyle}>
          <span style={labelStyle}>AI Confidence</span>
          <span style={{ ...valueStyle, color: confidence >= 0.85 ? 'var(--p-success)' : 'var(--p-warn)' }}>
            {(confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}
      {estimate > 0 && (
        <>
          <div style={divider} />
          <div style={rowStyle}>
            <span style={labelStyle}>Repair estimate</span>
            <span style={valueStyle}>{fmtCurrency(estimate)}</span>
          </div>
          {deductible > 0 && (
            <div style={rowStyle}>
              <span style={labelStyle}>Deductible</span>
              <span style={valueStyle}>{fmtCurrency(deductible)}</span>
            </div>
          )}
        </>
      )}

      {autoSettled && (
        <div style={{
          marginTop: 10, padding: '7px 10px', borderRadius: 6,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.20)',
          fontSize: 12, color: 'var(--p-success)',
        }}>
          Automatically settled — minor damage policy applied
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onAction?.('View LOU calculation')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6,
            border: '1px solid var(--agent-chip-border)',
            background: 'var(--agent-chip-bg)',
            color: 'var(--p-text-2)', fontSize: 12, cursor: 'pointer',
          }}
        >
          LOU Details
        </button>
        <button
          onClick={() => onAction?.('Dispute this claim')}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 6,
            border: '1px solid rgba(240,78,78,0.25)',
            background: 'rgba(240,78,78,0.08)',
            color: 'var(--p-danger)', fontSize: 12, cursor: 'pointer',
          }}
        >
          Dispute Claim
        </button>
      </div>
    </div>
  )
}
