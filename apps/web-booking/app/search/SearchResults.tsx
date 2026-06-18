'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { SearchSkeleton } from './SearchSkeleton'

const TENANT = '00000000-0000-0000-0000-000000000001'
const RED     = '#da291c'
const RED_ACT = '#b01e0a'

interface VehicleClass {
  classId: string
  classCode: string
  className: string
  description: string
  features: string[]
  availableCount: number
  baseDailyRate: number
  currencyCode: string
}

interface SearchResultsProps {
  pickupLocationId: string
  dropoffLocationId: string
  pickupDate: string
  dropoffDate: string
  sort?: string
  classFilter?: string[]
}

const SORT_OPTS = [
  { value: 'price_asc',    label: 'Price: Low to High' },
  { value: 'price_desc',   label: 'Price: High to Low' },
  { value: 'availability', label: 'Most Available' },
]

const CLASS_TAGLINES: Record<string, string> = {
  ECON: 'Smart miles, smart spend',
  COMP: 'Right-sized for any road',
  MIDZ: 'The sweet spot in comfort',
  FULL: 'Command every journey',
  SUVR: 'Ready for the wild',
  PREM: 'Elevated by design',
}

function daysBetween(a: string, b: string) {
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

export function SearchResults({
  pickupLocationId, dropoffLocationId, pickupDate, dropoffDate,
  sort: initialSort = 'price_asc', classFilter: initialFilter = [],
}: SearchResultsProps) {
  const router = useRouter()
  const [classes, setClasses]     = useState<VehicleClass[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [sort, setSort]           = useState(initialSort)
  const [activeClasses, setActive] = useState<string[]>(initialFilter)

  const enabled = !!(pickupLocationId && pickupDate && dropoffDate)

  const fetchAvailability = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({
        pickup_location_id:  pickupLocationId,
        dropoff_location_id: dropoffLocationId || pickupLocationId,
        pickup_date:  pickupDate.slice(0, 10),
        dropoff_date: dropoffDate.slice(0, 10),
      })
      const r = await fetch(`/api/v1/fleet/search?${p}`, {
        credentials: 'include',
        headers: { 'X-Tenant-ID': TENANT },
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const data = await r.json() as { classes?: VehicleClass[]; error?: string }
      if (data.error) throw new Error(data.error)
      setClasses(data.classes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vehicles.')
    } finally {
      setLoading(false)
    }
  }, [enabled, pickupLocationId, dropoffLocationId, pickupDate, dropoffDate])

  useEffect(() => { void fetchAvailability() }, [fetchAvailability])

  // sync sort/filter when URL params change (e.g. after Modify Search)
  useEffect(() => { setSort(initialSort) }, [initialSort])
  useEffect(() => { setActive(initialFilter) }, [initialFilter])

  if (!enabled) {
    const hasLocation = !!pickupLocationId
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 16 }}>
          {hasLocation ? pickupLocationId : 'Ready to drive?'}
        </p>
        <h2 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', marginBottom: 12 }}>
          {hasLocation ? 'Select your dates' : 'Where are you headed?'}
        </h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginBottom: 32 }}>
          {hasLocation
            ? 'Choose a pickup and return date above to see available vehicles.'
            : 'Enter a pickup location and dates above to find available vehicles.'}
        </p>
        {!hasLocation && (
          <a href="/" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 48, padding: '0 32px', background: RED, color: '#ffffff',
            fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
            textDecoration: 'none',
          }}>Back to Home</a>
        )}
      </div>
    )
  }

  if (loading) return <SearchSkeleton />

  if (error) {
    return (
      <div role="alert" style={{ background: 'rgba(241,58,44,0.08)', border: '1px solid rgba(241,58,44,0.25)', padding: 24 }}>
        <p style={{ color: '#f13a2c', fontWeight: 400, fontSize: 14, marginBottom: 16 }}>{error}</p>
        <button
          onClick={() => void fetchAvailability()}
          style={{
            padding: '10px 20px', background: 'transparent', border: '1px solid rgba(241,58,44,0.4)',
            color: '#f13a2c', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '0.65px', textTransform: 'uppercase', fontFamily: 'inherit',
          }}
        >Try Again</button>
      </div>
    )
  }

  // Derive unique class names for chip filter
  const allClassNames = Array.from(new Set(classes.map(c => c.className)))

  function toggleClass(name: string) {
    setActive(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  // Filter + sort
  let filtered = activeClasses.length > 0
    ? classes.filter(c => activeClasses.includes(c.className))
    : classes

  const sortFn = (a: VehicleClass, b: VehicleClass) => {
    if (sort === 'price_desc')   return b.baseDailyRate - a.baseDailyRate
    if (sort === 'availability') return b.availableCount - a.availableCount
    return a.baseDailyRate - b.baseDailyRate
  }

  const available = [...filtered.filter(c => c.availableCount > 0)].sort(sortFn)
  const soldOut   = filtered.filter(c => c.availableCount === 0)
  const sorted    = [...available, ...soldOut]
  const days      = daysBetween(pickupDate, dropoffDate)

  return (
    <div>
      {/* Sort + Class chips row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Sort selector */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{
            background: '#303030', border: '1px solid #303030', color: '#ffffff',
            fontSize: 13, fontWeight: 400, padding: '6px 32px 6px 12px', cursor: 'pointer',
            appearance: 'none', WebkitAppearance: 'none', fontFamily: 'inherit',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
            outline: 'none',
          }}
          aria-label="Sort vehicles"
        >
          {SORT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Vertical divider */}
        <div style={{ width: 1, height: 20, background: '#303030', flexShrink: 0 }} />

        {/* Class chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {allClassNames.map(name => {
            const isActive = activeClasses.includes(name)
            const cls = classes.find(c => c.className === name)
            const unavail = cls?.availableCount === 0
            return (
              <button
                key={name}
                onClick={() => toggleClass(name)}
                style={{
                  padding: '5px 14px', fontSize: 12, fontWeight: isActive ? 700 : 400,
                  border: '1px solid',
                  borderColor: isActive ? '#ffffff' : '#303030',
                  background: isActive ? '#ffffff' : 'transparent',
                  color: isActive ? '#181818' : unavail ? '#444444' : '#969696',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                  letterSpacing: '0.3px',
                  opacity: unavail && !isActive ? 0.5 : 1,
                }}
              >
                {name}
              </button>
            )
          })}
          {activeClasses.length > 0 && (
            <button
              onClick={() => setActive([])}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 400,
                border: '1px solid rgba(218,41,28,0.3)',
                background: 'transparent', color: '#da291c',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Count */}
        <p style={{ fontSize: 13, fontWeight: 400, color: '#666666', marginLeft: 'auto', flexShrink: 0 }} aria-live="polite">
          <span style={{ color: '#ffffff', fontWeight: 600 }}>{available.length}</span>
          {' '}available{' · '}
          <span style={{ color: '#ffffff', fontWeight: 600 }}>{days}</span>
          {' '}day{days !== 1 ? 's' : ''}
        </p>
      </div>

      {sorted.length === 0 ? (
        <div style={{ padding: '60px 0', textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', marginBottom: 12 }}>No vehicles match</h2>
          <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginBottom: 20 }}>
            {activeClasses.length > 0 ? 'Try removing some filters.' : 'Try adjusting your dates or location.'}
          </p>
          {activeClasses.length > 0 && (
            <button
              onClick={() => setActive([])}
              style={{ fontSize: 13, fontWeight: 700, color: RED, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' }}
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Available vehicle classes">
          {sorted.map(cls => (
            <VehicleClassCard
              key={cls.classId}
              vehicleClass={cls}
              days={days}
              onSelect={() => router.push(
                `/booking/${cls.classId}?pickup=${pickupLocationId}&dropoff=${dropoffLocationId}&from=${pickupDate}&to=${dropoffDate}`
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface VehicleClassCardProps { vehicleClass: VehicleClass; days: number; onSelect: () => void }

function VehicleClassCard({ vehicleClass: cls, days, onSelect }: VehicleClassCardProps) {
  const [hovered, setHovered] = useState(false)
  const [btnHov, setBtnHov]   = useState(false)
  const isUnavailable = cls.availableCount === 0
  const isLow         = !isUnavailable && cls.availableCount <= 3
  const total         = cls.baseDailyRate * days
  const tagline       = CLASS_TAGLINES[cls.classCode] ?? cls.description
  const fmt           = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cls.currencyCode || 'USD' }).format(n)

  return (
    <div
      onMouseEnter={() => { if (!isUnavailable) setHovered(true) }}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#303030',
        border: `1px solid ${hovered ? 'rgba(218,41,28,0.5)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'stretch',
        opacity: isUnavailable ? 0.45 : 1,
        transition: 'border-color 0.2s, opacity 0.2s',
      }}
    >
      {/* Left — class code + name */}
      <div style={{
        width: 196, flexShrink: 0, padding: '28px 24px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          fontSize: 68, fontWeight: 700, letterSpacing: '-0.04em',
          color: hovered ? 'rgba(218,41,28,0.12)' : 'rgba(255,255,255,0.04)',
          userSelect: 'none', pointerEvents: 'none', whiteSpace: 'nowrap',
          transition: 'color 0.2s',
        }}>{cls.classCode}</div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: hovered ? RED : '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 8, transition: 'color 0.2s' }}>
            {cls.classCode}
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 6 }}>
            {cls.className}
          </div>
          <div style={{ fontSize: 12, fontWeight: 400, color: '#969696', lineHeight: 1.4 }}>{tagline}</div>
        </div>
      </div>

      {/* Center — features */}
      <div style={{ flex: 1, padding: '24px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
        {cls.description && cls.description !== tagline && (
          <p style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginBottom: 14, lineHeight: 1.5 }}>{cls.description}</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
          {cls.features.slice(0, 5).map(f => (
            <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 400, color: '#969696' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={hovered ? RED : '#666666'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transition: 'stroke 0.2s' }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {isUnavailable && (
            <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(241,58,44,0.1)', color: '#f13a2c', border: '1px solid rgba(241,58,44,0.2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Sold Out
            </span>
          )}
          {isLow && (
            <span style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: '#969696', border: '1px solid rgba(255,255,255,0.1)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Only {cls.availableCount} left
            </span>
          )}
        </div>
      </div>

      {/* Right — price + CTA */}
      <div style={{
        width: 196, flexShrink: 0, padding: '24px 20px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: 14,
        borderLeft: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 30, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', lineHeight: 1 }}>
            {fmt(cls.baseDailyRate)}
          </div>
          <div style={{ fontSize: 11, fontWeight: 400, color: '#666666', marginTop: 4 }}>
            per day · {fmt(total)} total
          </div>
        </div>
        {isUnavailable ? (
          <button
            disabled
            style={{
              padding: '12px 16px', width: '100%',
              background: 'transparent', color: '#444444',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: 12, fontWeight: 600, cursor: 'not-allowed',
              letterSpacing: '0.65px', textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >Sold Out</button>
        ) : (
          <button
            onClick={onSelect}
            onMouseEnter={() => setBtnHov(true)}
            onMouseLeave={() => setBtnHov(false)}
            aria-label={`Reserve ${cls.className}`}
            style={{
              padding: '12px 16px', width: '100%',
              background: btnHov ? RED_ACT : RED,
              color: '#ffffff', border: 'none',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '1.1px', textTransform: 'uppercase',
              transition: 'background 0.2s', fontFamily: 'inherit',
            }}
          >Reserve</button>
        )}
      </div>
    </div>
  )
}
