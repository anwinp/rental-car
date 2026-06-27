'use client'

import { useState } from 'react'

interface VehicleClass {
  class_id: string
  class_code: string
  class_name: string
  description: string
  features: string[]
  available_count: number
  daily_rate: number
  currency_code: string
}

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

/* ── Single selectable vehicle card — matches /agent-preview VehicleCard ── */

function VehicleRow({
  v,
  days,
  onSelect,
}: {
  v: VehicleClass
  days: number
  onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const low = v.available_count <= 1
  const total = Math.round(v.daily_rate * days)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#1e1e1e',
        border: `1px solid ${hovered ? 'rgba(218,41,28,0.45)' : 'rgba(255,255,255,0.08)'}`,
        borderTop: hovered ? '2px solid #da291c' : '2px solid transparent',
        padding: '16px 18px',
        marginTop: 8,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#da291c', textTransform: 'uppercase' }}>{v.class_name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>{v.description}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          {low
            ? <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600, letterSpacing: '0.06em' }}>ONLY {v.available_count} LEFT</div>
            : <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, letterSpacing: '0.06em' }}>✓ {v.available_count} AVAILABLE</div>
          }
        </div>
      </div>

      {/* Silhouette placeholder */}
      <div style={{ height: 44, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0', border: '1px solid rgba(255,255,255,0.04)' }}>
        <svg width="80" height="28" viewBox="0 0 80 28" fill="none" style={{ opacity: 0.35 }}>
          <path d="M4 20h72M10 20c0-4 2-8 6-10h36c4 2 8 6 8 10M22 10l4-6h16l4 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="20" cy="22" r="4" stroke="white" strokeWidth="1.5"/>
          <circle cx="60" cy="22" r="4" stroke="white" strokeWidth="1.5"/>
        </svg>
      </div>

      {/* Features */}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 12 }}>
        {(v.features || []).join(' · ')}
      </div>

      {/* Price + CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 22, fontWeight: 300, color: '#fff', letterSpacing: '-0.03em' }}>${Math.round(v.daily_rate)}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginLeft: 4 }}>/day</span>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>${total} for {days} day{days !== 1 ? 's' : ''}</div>
        </div>
        <button
          onClick={onSelect}
          style={{
            background: hovered ? '#da291c' : 'transparent',
            border: '1px solid rgba(218,41,28,0.60)',
            color: hovered ? '#fff' : '#da291c',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            padding: '0 16px', height: 34,
            cursor: 'pointer', transition: 'all 0.15s',
            fontFamily: 'inherit',
          }}
        >
          SELECT →
        </button>
      </div>
    </div>
  )
}

export function VehicleClassListCard({ data, onAction }: Props) {
  const classes = (data.classes as VehicleClass[]) || []
  const pickupDate = String(data.pickup_date || '')
  const dropoffDate = String(data.dropoff_date || '')

  const days = (() => {
    try {
      const a = new Date(pickupDate), b = new Date(dropoffDate)
      return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000))
    } catch { return 1 }
  })()

  return (
    <div>
      {classes.map(cls => (
        <VehicleRow
          key={cls.class_id}
          v={cls}
          days={days}
          onSelect={() => onAction?.(`Select ${cls.class_name}`)}
        />
      ))}
    </div>
  )
}
