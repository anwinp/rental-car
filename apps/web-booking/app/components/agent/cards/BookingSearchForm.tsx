'use client'

import { useState } from 'react'

interface Location {
  name: string
  short_code: string
  city?: string
}

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const plusDaysISO = (base: string, days: number) => {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const labelStyle = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)',
  textTransform: 'uppercase' as const, marginBottom: 5, display: 'block',
}
const fieldStyle = {
  width: '100%', background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff', fontSize: 13, padding: '9px 11px', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box' as const,
}

export function BookingSearchForm({ data, onAction }: Props) {
  const locations = (data.locations as Location[]) || []
  const [pickupLoc, setPickupLoc] = useState(locations[0]?.name || '')
  // Empty string = "Same as pickup" (round-trip).
  const [dropoffLoc, setDropoffLoc] = useState('')
  const [pickup, setPickup] = useState(plusDaysISO(todayISO(), 1))
  const [dropoff, setDropoff] = useState(plusDaysISO(todayISO(), 4))
  const [error, setError] = useState('')

  const submit = () => {
    if (!pickupLoc) { setError('Please choose a pickup location.'); return }
    if (!pickup || !dropoff) { setError('Please choose both dates.'); return }
    if (dropoff <= pickup) { setError('Return date must be after pickup.'); return }
    setError('')
    const dropLoc = dropoffLoc || pickupLoc
    onAction?.(`__rcm_book__ pickup_location=${pickupLoc} || dropoff_location=${dropLoc} || pickup=${pickup} || dropoff=${dropoff}`)
  }

  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.08)', borderTop: '2px solid #da291c', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#da291c', textTransform: 'uppercase', marginBottom: 14 }}>
        FIND YOUR CAR
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Pickup Location</label>
        <select value={pickupLoc} onChange={e => setPickupLoc(e.target.value)} style={fieldStyle}>
          {locations.map(l => (
            <option key={l.short_code} value={l.name}>
              {l.name}{l.city ? ` — ${l.city}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Drop-off Location</label>
        <select value={dropoffLoc} onChange={e => setDropoffLoc(e.target.value)} style={fieldStyle}>
          <option value="">Same as pickup</option>
          {locations.map(l => (
            <option key={l.short_code} value={l.name}>
              {l.name}{l.city ? ` — ${l.city}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Pickup Date</label>
          <input type="date" value={pickup} min={todayISO()}
            onChange={e => setPickup(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Return Date</label>
          <input type="date" value={dropoff} min={pickup}
            onChange={e => setDropoff(e.target.value)} style={fieldStyle} />
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#f04e4e', marginBottom: 10 }}>{error}</div>
      )}

      <button
        onClick={submit}
        style={{
          width: '100%', height: 40, background: '#da291c', border: 'none', color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        SEARCH AVAILABILITY →
      </button>
    </div>
  )
}
