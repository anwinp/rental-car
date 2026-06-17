'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface SearchBarProps {
  pickup: string
  from: string
  to: string
  sort: string
  classFilter: string[]
}

export function SearchBar({ pickup, from, to, sort, classFilter }: SearchBarProps) {
  const router = useRouter()
  const [loc, setLoc]         = useState(pickup)
  const [pickupDate, setPickup] = useState(from.slice(0, 10))
  const [returnDate, setReturn] = useState(to.slice(0, 10))
  const [expanded, setExpanded] = useState(false)

  // sync when URL params change (e.g. browser back)
  useEffect(() => { setLoc(pickup) },           [pickup])
  useEffect(() => { setPickup(from.slice(0, 10)) }, [from])
  useEffect(() => { setReturn(to.slice(0, 10)) },   [to])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!loc || !pickupDate || !returnDate) return
    const p = new URLSearchParams()
    p.set('pickup', loc)
    p.set('from', pickupDate)
    p.set('to', returnDate)
    if (sort) p.set('sort', sort)
    if (classFilter.length) p.set('class_filter', classFilter.join(','))
    router.push(`/search?${p.toString()}`)
    setExpanded(false)
  }

  const inputSt: React.CSSProperties = {
    background: '#181818',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 4,
    color: '#ffffff',
    fontSize: 14,
    padding: '0 12px',
    height: 44,
    outline: 'none',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  }

  const labelSt: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: '#666666',
    textTransform: 'uppercase', letterSpacing: '1px',
    display: 'block', marginBottom: 4,
  }

  const days = pickupDate && returnDate
    ? Math.max(1, Math.ceil((new Date(returnDate).getTime() - new Date(pickupDate).getTime()) / 86400000))
    : null

  return (
    <div style={{
      background: '#222222',
      borderBottom: '1px solid #303030',
      position: 'sticky',
      top: 64,
      zIndex: 100,
    }}>
      {/* Compact summary bar — always visible */}
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '0 48px',
        height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', flexShrink: 0 }}>
            Available Vehicles
          </p>
          {pickup && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: '#ffffff', whiteSpace: 'nowrap' }}>{pickup}</span>
              {from && to && (
                <>
                  <span style={{ color: '#303030' }}>·</span>
                  <span style={{ fontSize: 13, fontWeight: 400, color: '#969696', whiteSpace: 'nowrap' }}>
                    {new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' — '}
                    {new Date(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  {days && (
                    <>
                      <span style={{ color: '#303030' }}>·</span>
                      <span style={{ fontSize: 13, fontWeight: 400, color: '#666666' }}>{days} day{days !== 1 ? 's' : ''}</span>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            fontSize: 12, fontWeight: 700, color: expanded ? '#ffffff' : '#969696',
            background: expanded ? '#303030' : 'transparent',
            border: '1px solid', borderColor: expanded ? '#ffffff' : '#303030',
            padding: '7px 20px', cursor: 'pointer', letterSpacing: '1px',
            textTransform: 'uppercase', fontFamily: 'inherit', whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
        >
          {expanded ? 'Cancel' : 'Modify Search'}
        </button>
      </div>

      {/* Expanded search form */}
      {expanded && (
        <div style={{ borderTop: '1px solid #303030', background: '#1a1a1a', padding: '20px 48px 24px' }}>
          <form
            onSubmit={handleSearch}
            style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}
          >
            <div>
              <label style={labelSt}>Pickup Location</label>
              <input
                value={loc}
                onChange={e => setLoc(e.target.value)}
                placeholder="City, airport code, or short code"
                style={inputSt}
                autoFocus
              />
            </div>
            <div>
              <label style={labelSt}>Pickup Date</label>
              <input
                type="date"
                value={pickupDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => {
                  setPickup(e.target.value)
                  if (returnDate && e.target.value >= returnDate) setReturn('')
                }}
                style={inputSt}
              />
            </div>
            <div>
              <label style={labelSt}>Return Date</label>
              <input
                type="date"
                value={returnDate}
                min={pickupDate || new Date().toISOString().slice(0, 10)}
                onChange={e => setReturn(e.target.value)}
                style={inputSt}
              />
            </div>
            <button
              type="submit"
              disabled={!loc || !pickupDate || !returnDate}
              style={{
                height: 44, padding: '0 28px',
                background: (!loc || !pickupDate || !returnDate) ? '#5a0e0a' : '#da291c',
                color: '#ffffff', border: 'none', cursor: (!loc || !pickupDate || !returnDate) ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
                fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'background 0.15s',
              }}
            >
              Search
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
