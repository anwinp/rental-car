'use client'

import { useState } from 'react'

const CLASS_OPTIONS = ['Economy', 'Compact', 'Midsize', 'Standard', 'SUV', 'Premium']

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
  pickupTime?: string
  returnTime?: string
  oneWay?: string
  mobile?: boolean
}

export function FilterPanel({
  classFilter, sort, pickup, dropoff, from, to,
  pickupTime, returnTime, oneWay, mobile,
}: FilterPanelProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [localSort, setLocalSort] = useState(sort)
  const [localFilters, setLocalFilters] = useState<string[]>(classFilter)
  const [applyHov, setApplyHov] = useState(false)

  function buildUrl(newClassFilter: string[], newSort: string): string {
    const params = new URLSearchParams()
    if (pickup)       params.set('pickup',       pickup)
    if (dropoff)      params.set('dropoff',      dropoff)
    if (from)         params.set('from',         from)
    if (to)           params.set('to',           to)
    if (pickupTime)   params.set('pickup_time',  pickupTime)
    if (returnTime)   params.set('return_time',  returnTime)
    if (oneWay)       params.set('one_way',      oneWay)
    if (newClassFilter.length > 0) params.set('class_filter', newClassFilter.join(','))
    if (newSort)      params.set('sort',         newSort)
    return `/search?${params.toString()}`
  }

  function applyFilters() {
    window.location.href = buildUrl(localFilters, localSort)
  }

  function toggleFilter(cls: string) {
    setLocalFilters(prev => prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls])
  }

  const SECTION_LABEL: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#969696',
    textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 16,
  }

  const panelContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Sort */}
      <div>
        <p style={SECTION_LABEL}>Sort By</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {SORT_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 400, color: localSort === opt.value ? '#ffffff' : '#969696', transition: 'color 0.15s' }}
            >
              <span
                onClick={() => setLocalSort(opt.value)}
                style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                  border: `2px solid ${localSort === opt.value ? RED : 'rgba(255,255,255,0.25)'}`,
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

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

      {/* Class filter */}
      <div>
        <p style={SECTION_LABEL}>Vehicle Class</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CLASS_OPTIONS.map(cls => {
            const checked = localFilters.includes(cls)
            return (
              <label
                key={cls}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 400, color: checked ? '#ffffff' : '#969696', transition: 'color 0.15s' }}
              >
                <span
                  onClick={() => toggleFilter(cls)}
                  style={{
                    width: 16, height: 16, borderRadius: 0, flexShrink: 0, cursor: 'pointer',
                    border: `2px solid ${checked ? RED : 'rgba(255,255,255,0.25)'}`,
                    background: checked ? RED : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  {checked && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </span>
                <input type="checkbox" checked={checked} onChange={() => toggleFilter(cls)} style={{ display: 'none' }} />
                {cls}
              </label>
            )
          })}
        </div>
        {localFilters.length > 0 && (
          <button
            onClick={() => setLocalFilters([])}
            style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: RED, background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.5px', textTransform: 'uppercase' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Apply */}
      <button
        onClick={applyFilters}
        onMouseEnter={() => setApplyHov(true)}
        onMouseLeave={() => setApplyHov(false)}
        style={{
          padding: '14px 0', width: '100%', borderRadius: 0,
          background: applyHov ? RED_ACTIVE : RED,
          color: '#ffffff', border: 'none',
          fontWeight: 700, fontSize: 14, cursor: 'pointer',
          letterSpacing: '1.4px', textTransform: 'uppercase',
          transition: 'background 0.2s',
          fontFamily: 'inherit',
        }}
      >
        Apply Filters
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
            padding: '11px 20px', fontSize: 13, fontWeight: 600,
            background: 'transparent', color: '#969696',
            border: '1px solid #969696', cursor: 'pointer',
            letterSpacing: '0.65px', textTransform: 'uppercase',
            fontFamily: 'inherit',
          }}
        >
          {mobileOpen ? 'Hide Filters' : 'Show Filters'}
          {localFilters.length > 0 ? ` (${localFilters.length})` : ''}
        </button>
        {mobileOpen && (
          <div style={{ marginTop: 12, background: '#303030', border: '1px solid rgba(255,255,255,0.08)', padding: 24 }}>
            {panelContent}
          </div>
        )}
      </>
    )
  }

  return (
    <div style={{ background: '#303030', border: '1px solid rgba(255,255,255,0.08)', padding: 24, position: 'sticky', top: 144 }}>
      <p style={{ ...SECTION_LABEL, marginBottom: 24 }}>Filters</p>
      {panelContent}
    </div>
  )
}
