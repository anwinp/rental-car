'use client'

import { tenantId } from '../lib/tenant'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { SearchSkeleton } from './SearchSkeleton'

const RED     = '#da291c'
const RED_ACT = '#b01e0a'

interface VehicleClass {
  classId: string
  classCode: string
  className: string
  description: string
  features: string[]
  imageUrl: string | null
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
  { value: 'price_asc',    label: 'Lowest Price',   short: 'Lowest' },
  { value: 'price_desc',   label: 'Highest Price',  short: 'Highest' },
  { value: 'availability', label: 'Most Available', short: 'Available' },
]

const CLASS_TAGLINES: Record<string, string> = {
  MINI: 'City-ready, park anywhere',
  ECON: 'Smart miles, smart spend',
  COMP: 'Right-sized for any road',
  IXXX: 'The sweet spot in comfort',
  FULL: 'Command every journey',
  SUVR: 'Ready for the wild',
  PREM: 'Elevated by design',
  LUXR: 'Where comfort meets craft',
  WXXX: 'Space for every adventure',
  XXXX: 'The extraordinary awaits',
}

// Subtle left-panel tints per class family
const CLASS_TINT: Record<string, string> = {
  MINI: '#1a1f1f', ECON: '#1a1f1f', COMP: '#1a1c1f',
  IXXX: '#1c1c22', FULL: '#1e1c1c',
  SUVR: '#1c1e1a', PREM: '#1f1d17', LUXR: '#1f1d17',
  WXXX: '#1a1e1f', XXXX: '#200a0a',
}

const FEATURE_SHORT: Record<string, string> = {
  'Air Conditioning': 'A/C',
  'Automatic Transmission': 'Automatic',
  'Manual Transmission': 'Manual',
  'Bluetooth': 'Bluetooth',
  'Backup Camera': 'Backup Cam',
  'USB Charging': 'USB',
  'Fuel Efficient': 'Eco',
  'GPS Navigation': 'GPS',
  'Child Seat Compatible': 'Child Seat',
  'All-Wheel Drive': 'AWD',
  'Four-Wheel Drive': '4WD',
  'Heated Seats': 'Heated Seats',
  'Sunroof': 'Sunroof',
  'Apple CarPlay': 'CarPlay',
  'Android Auto': 'Android Auto',
  'Third Row': '3rd Row',
}

function shortFeature(f: string) {
  return FEATURE_SHORT[f] ?? f
}

function daysBetween(a: string, b: string) {
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
}

export function SearchResults({
  pickupLocationId, dropoffLocationId, pickupDate, dropoffDate,
  sort: initialSort = 'price_asc', classFilter: initialFilter = [],
}: SearchResultsProps) {
  const router = useRouter()
  const [classes, setClasses]      = useState<VehicleClass[]>([])
  const [loading, setLoading]      = useState(false)
  const [error, setError]          = useState<string | null>(null)
  const [sort, setSort]            = useState(initialSort)
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
        headers: { 'X-Tenant-ID': tenantId() },
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
  useEffect(() => { setSort(initialSort) }, [initialSort])
  useEffect(() => { setActive(initialFilter) }, [initialFilter])

  if (!enabled) {
    const hasLocation = !!pickupLocationId
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '1.4px', marginBottom: 16 }}>
          {hasLocation ? 'Almost there' : 'Ready to drive?'}
        </p>
        <h2 style={{ fontSize: 40, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', margin: '0 0 12px' }}>
          {hasLocation ? 'Select your dates' : 'Where are you headed?'}
        </h2>
        <p style={{ fontSize: 15, fontWeight: 400, color: '#666', margin: '0 0 36px', lineHeight: 1.6 }}>
          {hasLocation
            ? 'Choose a pickup and return date above to see available vehicles.'
            : 'Enter a pickup location and dates above to find available vehicles.'}
        </p>
        {!hasLocation && (
          <a href="/" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 48, padding: '0 32px', background: RED, color: '#ffffff',
            fontSize: 12, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
            textDecoration: 'none',
          }}>Back to Home</a>
        )}
      </div>
    )
  }

  if (loading) return <SearchSkeleton />

  if (error) {
    return (
      <div role="alert" style={{ background: 'rgba(218,41,28,0.06)', border: '1px solid rgba(218,41,28,0.2)', padding: '28px 32px' }}>
        <p style={{ color: '#f13a2c', fontWeight: 400, fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
          Unable to load vehicles — {error}
        </p>
        <button
          onClick={() => void fetchAvailability()}
          style={{
            padding: '10px 24px', background: 'transparent',
            border: '1px solid rgba(218,41,28,0.4)',
            color: '#da291c', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'inherit',
          }}
        >Try Again</button>
      </div>
    )
  }

  const allClassNames = Array.from(new Set(classes.filter(c => c.availableCount > 0).map(c => c.className)))

  function toggleClass(name: string) {
    setActive(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  let filtered = activeClasses.length > 0
    ? classes.filter(c => activeClasses.includes(c.className))
    : classes

  const sortFn = (a: VehicleClass, b: VehicleClass) => {
    if (sort === 'price_desc')   return b.baseDailyRate - a.baseDailyRate
    if (sort === 'availability') return b.availableCount - a.availableCount
    return a.baseDailyRate - b.baseDailyRate
  }

  const sorted = filtered.filter(c => c.availableCount > 0).sort(sortFn)
  const days      = daysBetween(pickupDate, dropoffDate)

  return (
    <div>
      {/* ── Controls row ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        {/* Sort pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0 }}>
            Sort
          </span>
          <div style={{ display: 'flex', gap: 2 }}>
            {SORT_OPTS.map(o => {
              const active = sort === o.value
              return (
                <button
                  key={o.value}
                  onClick={() => setSort(o.value)}
                  style={{
                    padding: '6px 18px', fontSize: 11, fontWeight: active ? 700 : 400,
                    background: active ? '#ffffff' : 'transparent',
                    color: active ? '#181818' : '#666666',
                    border: '1px solid',
                    borderColor: active ? '#ffffff' : '#303030',
                    cursor: 'pointer', fontFamily: 'inherit',
                    letterSpacing: '0.5px', textTransform: 'uppercase',
                    transition: 'all 0.12s',
                  }}
                >{o.short}</button>
              )
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: '#303030', flexShrink: 0 }} />

          {/* Result count */}
          <p style={{ fontSize: 13, color: '#666', margin: 0 }} aria-live="polite">
            <span style={{ color: sorted.length > 0 ? '#4a9a5a' : '#666', fontWeight: 600 }}>{sorted.length}</span>
            {' available · '}
            <span style={{ color: '#ffffff', fontWeight: 600 }}>{days}</span>
            {' day'}{days !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Class filter chips */}
        {allClassNames.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0 }}>
              Filter
            </span>
            {allClassNames.map(name => {
              const isActive = activeClasses.includes(name)
              return (
                <button
                  key={name}
                  onClick={() => toggleClass(name)}
                  style={{
                    padding: '5px 14px', fontSize: 11, fontWeight: isActive ? 700 : 400,
                    border: '1px solid',
                    borderColor: isActive ? '#ffffff' : '#303030',
                    background: isActive ? '#ffffff' : 'transparent',
                    color: isActive ? '#181818' : '#888',
                    cursor: 'pointer', fontFamily: 'inherit',
                    letterSpacing: '0.3px', transition: 'all 0.12s',
                  }}
                >{name}</button>
              )
            })}
            {activeClasses.length > 0 && (
              <button
                onClick={() => setActive([])}
                style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 400,
                  border: '1px solid rgba(218,41,28,0.35)',
                  background: 'transparent', color: '#da291c',
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.3px',
                }}
              >Clear</button>
            )}
          </div>
        )}
      </div>

      {/* ── Divider ───────────────────────────────────────────────── */}
      <div style={{ height: 1, background: '#282828', marginBottom: 16 }} />

      {/* ── Results ───────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div style={{ padding: '80px 0', textAlign: 'center' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1.4px', marginBottom: 16 }}>No Availability</p>
          <h2 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', margin: '0 0 12px' }}>
            {activeClasses.length > 0 ? 'No vehicles match' : 'No vehicles available'}
          </h2>
          <p style={{ fontSize: 14, color: '#666', margin: '0 0 24px' }}>
            {activeClasses.length > 0
              ? 'Try removing some class filters.'
              : 'All vehicles are booked for these dates. Try different dates or another location.'}
          </p>
          {activeClasses.length > 0 && (
            <button
              onClick={() => setActive([])}
              style={{ fontSize: 11, fontWeight: 700, color: RED, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' }}
            >Clear Filters</button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Available vehicle classes">
          {sorted.map((cls, idx) => (
            <VehicleClassCard
              key={cls.classId}
              vehicleClass={cls}
              days={days}
              index={idx}
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

interface VehicleClassCardProps {
  vehicleClass: VehicleClass
  days: number
  index: number
  onSelect: () => void
}

function VehicleClassCard({ vehicleClass: cls, days, onSelect }: VehicleClassCardProps) {
  const [hovered, setHovered] = useState(false)
  const [btnHov, setBtnHov]   = useState(false)

  const isLow = cls.availableCount <= 3
  const total         = cls.baseDailyRate * days
  const tagline       = CLASS_TAGLINES[cls.classCode] ?? cls.description
  const tint          = CLASS_TINT[cls.classCode] ?? '#1c1c1c'
  const fmt           = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cls.currencyCode || 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
  const fmtDec        = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cls.currencyCode || 'USD' }).format(n)

  const displayFeatures = cls.features.slice(0, 6).map(shortFeature)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#242424',
        border: `1px solid ${hovered ? 'rgba(218,41,28,0.4)' : 'rgba(255,255,255,0.07)'}`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'stretch',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        boxShadow: hovered ? '0 0 0 1px rgba(218,41,28,0.15), 0 8px 32px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.25)',
        position: 'relative',
      }}
    >
      {/* Top accent line (visible on hover) */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: RED,
        opacity: hovered ? 1 : 0,
        transition: 'opacity 0.2s',
        zIndex: 1,
      }} />

      {/* ── LEFT: class identity panel ──────────────────────────── */}
      <div style={{
        width: 200, flexShrink: 0,
        padding: '28px 24px',
        background: `linear-gradient(135deg, ${tint} 0%, #1e1e1e 100%)`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        borderRight: '1px solid rgba(255,255,255,0.05)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Watermark code */}
        <div aria-hidden="true" style={{
          position: 'absolute',
          right: -12, bottom: -8,
          fontSize: 72, fontWeight: 800, letterSpacing: '-0.06em',
          color: hovered ? 'rgba(218,41,28,0.10)' : 'rgba(255,255,255,0.035)',
          userSelect: 'none', pointerEvents: 'none',
          lineHeight: 1, fontFamily: 'inherit',
          transition: 'color 0.25s',
        }}>{cls.classCode}</div>

        {/* Class info */}
        <div style={{ position: 'relative' }}>
          <div style={{
            fontSize: 10, fontWeight: 700,
            color: hovered ? RED : '#555',
            textTransform: 'uppercase', letterSpacing: '1.4px',
            marginBottom: 10, transition: 'color 0.2s',
          }}>{cls.classCode}</div>
          <div style={{
            fontSize: 20, fontWeight: 500,
            color: '#ffffff', letterSpacing: '-0.03em',
            lineHeight: 1.15, marginBottom: 8,
          }}>{cls.className}</div>
          <div style={{
            fontSize: 12, fontWeight: 400,
            color: '#666', lineHeight: 1.4,
          }}>{tagline}</div>
        </div>

        {/* Availability count */}
        <div style={{ position: 'relative', marginTop: 20 }}>
          {isLow ? (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: '#e05a00',
              textTransform: 'uppercase', letterSpacing: '0.8px',
            }}>Only {cls.availableCount} left</span>
          ) : (
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: '#4a9a5a',
              letterSpacing: '0.3px',
            }}>✓ {cls.availableCount} available</span>
          )}
        </div>
      </div>

      {/* ── CENTER: features ────────────────────────────────────── */}
      <div style={{
        flex: 1, padding: '28px 28px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        minWidth: 0,
      }}>
        {/* Feature chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', marginBottom: 0 }}>
          {displayFeatures.map(f => (
            <span
              key={f}
              style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '4px 10px',
                fontSize: 11, fontWeight: 500,
                color: hovered ? '#ccc' : '#888',
                background: hovered ? 'rgba(218,41,28,0.06)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${hovered ? 'rgba(218,41,28,0.15)' : 'rgba(255,255,255,0.07)'}`,
                transition: 'all 0.2s',
                letterSpacing: '0.2px',
                whiteSpace: 'nowrap',
              }}
            >
              {f}
            </span>
          ))}
        </div>

      </div>

      {/* ── RIGHT: price + CTA ──────────────────────────────────── */}
      <div style={{
        width: 196, flexShrink: 0,
        padding: '28px 24px',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'flex-end', gap: 20,
        borderLeft: '1px solid rgba(255,255,255,0.05)',
      }}>
        {/* Pricing */}
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 34, fontWeight: 500,
            color: '#ffffff',
            letterSpacing: '-0.05em', lineHeight: 1,
            marginBottom: 4,
          }}>{fmt(cls.baseDailyRate)}</div>
          <div style={{ fontSize: 11, fontWeight: 400, color: '#555', letterSpacing: '0.2px', marginBottom: 6 }}>
            per day
          </div>
          <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', margin: '8px 0' }} />
          <div style={{ fontSize: 12, fontWeight: 400, color: '#666' }}>
            {fmtDec(total)} total · {days} day{days !== 1 ? 's' : ''}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={onSelect}
          onMouseEnter={() => setBtnHov(true)}
          onMouseLeave={() => setBtnHov(false)}
          aria-label={`Reserve ${cls.className} — ${fmtDec(cls.baseDailyRate)} per day`}
          style={{
            padding: '13px 0', width: '100%',
            background: btnHov ? RED_ACT : RED,
            color: '#ffffff', border: 'none',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            letterSpacing: '1.4px', textTransform: 'uppercase',
            transition: 'background 0.15s', fontFamily: 'inherit',
          }}
        >Reserve →</button>
      </div>
    </div>
  )
}
