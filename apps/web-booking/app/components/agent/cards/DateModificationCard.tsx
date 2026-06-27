'use client'

import { useState } from 'react'

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

export function DateModificationCard({ data, onAction }: Props) {
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')
  const conf = String(data.confirmation_number || '')

  const inputStyle = {
    width: '100%',
    background: 'var(--agent-input-bg)',
    border: '1px solid var(--agent-input-border)',
    borderRadius: 6,
    padding: '8px 10px',
    color: 'var(--p-text-1)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  const handleSubmit = () => {
    if (pickup && dropoff) {
      onAction?.(`Change dates to pickup ${pickup} dropoff ${dropoff}`)
    }
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--agent-chip-border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--p-text-1)', marginBottom: 12 }}>
        Modify Dates — {conf}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--p-text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          New Pickup Date
        </div>
        <input type="date" style={inputStyle} value={pickup} onChange={e => setPickup(e.target.value)} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--p-text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          New Return Date
        </div>
        <input type="date" style={inputStyle} value={dropoff} onChange={e => setDropoff(e.target.value)} />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!pickup || !dropoff}
        style={{
          width: '100%',
          padding: '9px 0',
          borderRadius: 6,
          border: 'none',
          background: pickup && dropoff ? 'var(--p-brand)' : 'rgba(255,255,255,0.06)',
          color: pickup && dropoff ? '#fff' : 'var(--p-text-3)',
          fontSize: 13,
          fontWeight: 600,
          cursor: pickup && dropoff ? 'pointer' : 'not-allowed',
        }}
      >
        Request Date Change
      </button>
    </div>
  )
}
