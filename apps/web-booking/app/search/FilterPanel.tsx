'use client'

import { useState } from 'react'

const SORT_OPTIONS = [
  { value: 'price_asc',    label: 'Price: Low to High' },
  { value: 'price_desc',   label: 'Price: High to Low' },
  { value: 'availability', label: 'Most Available' },
]

const RED = '#da291c'
const RED_ACTIVE = '#b01e0a'

interface FilterPanelProps {
  classFilter: string[]
  sort: string
  pickup?: string
  dropoff?: string
  from?: string
  to?: string
  mobile?: boolean
}

export function FilterPanel({ classFilter, sort, pickup, dropoff, from, to, mobile }: FilterPanelProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [localSort, setLocalSort]   = useState(sort)
  const [applyHov, setApplyHov]     = useState(false)

  function buildUrl(newSort: string): string {
    const params = new URLSearchParams()
    if (pickup) params.set('pickup', pickup)
    if (dropoff) params.set('dropoff', dropoff)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (classFilter.length) params.set('class_filter', classFilter.join(','))
    params.set('sort', newSort)
    return `/search?${params.toString()}`
  }

  const LABEL: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#666666',
    textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 14,
    display: 'block',
  }

  const panelContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <span style={LABEL}>Sort By</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SORT_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 400, color: localSort === opt.value ? '#ffffff' : '#969696', transition: 'color 0.15s' }}
            >
              <span
                onClick={() => setLocalSort(opt.value)}
                style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                  border: `2px solid ${localSort === opt.value ? RED : 'rgba(255,255,255,0.2)'}`,
                  background: localSort === opt.value ? RED : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                {localSort === opt.value && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
              </span>
              <input type="radio" name="sort" value={opt.value} checked={localSort === opt.value} onChange={() => setLocalSort(opt.value)} style={{ display: 'none' }} />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={() => { window.location.href = buildUrl(localSort) }}
        onMouseEnter={() => setApplyHov(true)}
        onMouseLeave={() => setApplyHov(false)}
        style={{
          padding: '12px 0', width: '100%',
          background: applyHov ? RED_ACTIVE : RED,
          color: '#ffffff', border: 'none',
          fontWeight: 700, fontSize: 13, cursor: 'pointer',
          letterSpacing: '1.4px', textTransform: 'uppercase',
          transition: 'background 0.2s', fontFamily: 'inherit',
        }}
      >
        Apply Sort
      </button>
    </div>
  )

  if (mobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(o => !o)}
          aria-expanded={mobileOpen}
          style={{
            padding: '9px 18px', fontSize: 12, fontWeight: 700,
            background: 'transparent', color: '#969696',
            border: '1px solid #303030', cursor: 'pointer',
            letterSpacing: '0.65px', textTransform: 'uppercase', fontFamily: 'inherit',
          }}
        >
          {mobileOpen ? 'Hide Sort' : 'Sort'}
        </button>
        {mobileOpen && (
          <div style={{ marginTop: 10, background: '#303030', border: '1px solid rgba(255,255,255,0.08)', padding: 20 }}>
            {panelContent}
          </div>
        )}
      </>
    )
  }

  return (
    <div style={{ background: '#303030', border: '1px solid rgba(255,255,255,0.06)', padding: 20, position: 'sticky', top: 136 }}>
      <span style={{ ...LABEL, marginBottom: 20 }}>Sort</span>
      {panelContent}
    </div>
  )
}
