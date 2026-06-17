'use client'

import { useAvailability } from '@rcm/api-client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SearchSkeleton } from './SearchSkeleton'

interface VehicleClass {
  classId: string
  classCode: string
  className: string
  description: string
  features: string[]
  imageUrl?: string
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

const RED = '#da291c'
const RED_ACTIVE = '#b01e0a'

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000))
}

const CLASS_TAGLINES: Record<string, string> = {
  ECON: 'Smart miles, smart spend',
  COMP: 'Right-sized for any road',
  MIDZ: 'The sweet spot in comfort',
  FULL: 'Command every journey',
  SUVR: 'Ready for the wild',
  PREM: 'Elevated by design',
}

export function SearchResults({
  pickupLocationId, dropoffLocationId, pickupDate, dropoffDate,
  sort = 'price_asc', classFilter = [],
}: SearchResultsProps) {
  const router = useRouter()
  const enabled = !!(pickupLocationId && pickupDate && dropoffDate)

  const { data, isLoading, isError, error } = useAvailability(
    { pickup_location_id: pickupLocationId, dropoff_location_id: dropoffLocationId || pickupLocationId, pickup_date: pickupDate, dropoff_date: dropoffDate },
    enabled
  )

  if (!enabled) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#969696', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 16 }}>Ready to drive?</p>
        <h2 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.36px', marginBottom: 12 }}>Where are you headed?</h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginBottom: 32 }}>Enter a pickup location and dates to find available vehicles.</p>
        <a
          href="/"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 48, padding: '0 32px',
            background: RED, color: '#ffffff',
            fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
            textDecoration: 'none', borderRadius: 0,
          }}
        >
          Back to Search
        </a>
      </div>
    )
  }

  if (isLoading) return <SearchSkeleton />

  if (isError) {
    return (
      <div role="alert" style={{ background: 'rgba(240,78,78,0.08)', border: '1px solid rgba(240,78,78,0.25)', padding: 24 }}>
        <p style={{ color: '#f04e4e', fontWeight: 400, fontSize: 14, marginBottom: 16 }}>
          {error instanceof Error ? error.message : 'Failed to load availability.'}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 20px', background: 'transparent',
            border: '1px solid rgba(240,78,78,0.4)', color: '#f04e4e',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', borderRadius: 0,
            letterSpacing: '0.65px', textTransform: 'uppercase', fontFamily: 'inherit',
          }}
        >
          Try Again
        </button>
      </div>
    )
  }

  let classes: VehicleClass[] = (data?.classes ?? []) as VehicleClass[]
  if (classFilter.length > 0) {
    classes = classes.filter(c =>
      classFilter.some(f =>
        c.className.toLowerCase().includes(f.toLowerCase()) ||
        c.classCode.toLowerCase().includes(f.toLowerCase())
      )
    )
  }

  const available = classes.filter(c => c.availableCount > 0)
  const soldOut   = classes.filter(c => c.availableCount === 0)
  const sortFn = (a: VehicleClass, b: VehicleClass) => {
    if (sort === 'price_desc')  return b.baseDailyRate - a.baseDailyRate
    if (sort === 'availability') return b.availableCount - a.availableCount
    return a.baseDailyRate - b.baseDailyRate
  }
  available.sort(sortFn)
  const sorted = [...available, ...soldOut]
  const days = pickupDate && dropoffDate ? daysBetween(pickupDate, dropoffDate) : 1

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <h2 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.36px', marginBottom: 12 }}>No vehicles available</h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginBottom: 24 }}>
          {classFilter.length > 0
            ? 'No vehicles match the selected filters. Try removing some filters.'
            : 'Try adjusting your dates or location.'}
        </p>
        <a href="/" style={{ color: RED, fontSize: 14, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Modify Search
        </a>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginBottom: 24 }} aria-live="polite">
        <span style={{ color: '#ffffff', fontWeight: 600 }}>{available.length}</span> vehicle class{available.length !== 1 ? 'es' : ''} available
        {days > 0 && <> &middot; <span style={{ color: '#ffffff', fontWeight: 600 }}>{days}</span> day{days !== 1 ? 's' : ''}</>}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Available vehicle classes">
        {sorted.map(cls => (
          <VehicleClassCard
            key={cls.classId}
            vehicleClass={cls}
            days={days}
            onSelect={() => router.push(`/booking/${cls.classId}?pickup=${pickupLocationId}&dropoff=${dropoffLocationId}&from=${pickupDate}&to=${dropoffDate}`)}
          />
        ))}
      </div>
    </div>
  )
}

interface VehicleClassCardProps { vehicleClass: VehicleClass; days: number; onSelect: () => void }

function VehicleClassCard({ vehicleClass: cls, days, onSelect }: VehicleClassCardProps) {
  const [hovered, setHovered] = useState(false)
  const [btnHov, setBtnHov]   = useState(false)
  const isUnavailable = cls.availableCount === 0
  const isLow = !isUnavailable && cls.availableCount <= 3
  const total = cls.baseDailyRate * days
  const tagline = CLASS_TAGLINES[cls.classCode] ?? cls.description
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cls.currencyCode }).format(n)

  return (
    <div
      onMouseEnter={() => { if (!isUnavailable) setHovered(true) }}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#303030',
        border: `1px solid ${hovered ? 'rgba(218,41,28,0.5)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'stretch',
        opacity: isUnavailable ? 0.5 : 1,
        transition: 'border-color 0.2s',
      }}
    >
      {/* Left — class code + name */}
      <div style={{
        width: 200, flexShrink: 0,
        padding: '28px 24px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Large watermark */}
        <div aria-hidden="true" style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          fontSize: 72, fontWeight: 700, letterSpacing: '-0.04em',
          color: hovered ? 'rgba(218,41,28,0.12)' : 'rgba(255,255,255,0.04)',
          userSelect: 'none', pointerEvents: 'none', whiteSpace: 'nowrap',
          transition: 'color 0.2s',
        }}>
          {cls.classCode}
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: hovered ? RED : '#969696', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 8, transition: 'color 0.2s' }}>
            {cls.classCode}
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 6 }}>
            {cls.className}
          </div>
          <div style={{ fontSize: 12, fontWeight: 400, color: '#969696', lineHeight: 1.4 }}>
            {tagline}
          </div>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={hovered ? RED : '#969696'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transition: 'stroke 0.2s' }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {f}
            </li>
          ))}
        </ul>

        {/* Status badges */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {isUnavailable && (
            <span style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, background: 'rgba(240,78,78,0.12)', color: '#f04e4e', border: '1px solid rgba(240,78,78,0.2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Sold Out
            </span>
          )}
          {isLow && (
            <span style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              {cls.availableCount} Left
            </span>
          )}
        </div>
      </div>

      {/* Right — price + CTA */}
      <div style={{
        width: 196, flexShrink: 0,
        padding: '24px 20px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end',
        gap: 14,
        borderLeft: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', lineHeight: 1 }}>
            {fmt(cls.baseDailyRate)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 400, color: '#969696', marginTop: 4 }}>
            / day &middot; {fmt(total)} total
          </div>
        </div>

        {isUnavailable ? (
          <button
            style={{
              padding: '12px 16px', borderRadius: 0, width: '100%',
              background: 'transparent', color: '#969696',
              border: '1px solid rgba(255,255,255,0.15)',
              fontSize: 13, fontWeight: 600, cursor: 'not-allowed',
              letterSpacing: '0.65px', textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            Notify Me
          </button>
        ) : (
          <button
            onClick={onSelect}
            onMouseEnter={() => setBtnHov(true)}
            onMouseLeave={() => setBtnHov(false)}
            aria-label={`Book ${cls.className}`}
            style={{
              padding: '12px 16px', borderRadius: 0, width: '100%',
              background: btnHov ? RED_ACTIVE : RED,
              color: '#ffffff', border: 'none',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '1.1px', textTransform: 'uppercase',
              transition: 'background 0.2s', fontFamily: 'inherit',
            }}
          >
            Reserve
          </button>
        )}
      </div>
    </div>
  )
}
