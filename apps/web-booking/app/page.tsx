'use client'

import { tenantId, cachedTenant } from './lib/tenant'

import { useState, useEffect, useRef } from 'react'

// Read from the theme tokens (defaulting to the Cosmos ferrari red already in
// globals.css) rather than a fixed hex, so the ~10 brand touchpoints on this
// page — the CTA button, the promo band, link colours — all move together
// when a tenant publishes a different brand colour, instead of the hero
// changing while the button it sits above stays the old colour.
const RED = 'var(--p-brand)'
const RED_ACTIVE = 'var(--p-brand-dark)'

interface PromoVehicle {
  vehicle_id: string
  make: string
  model: string
  model_year: number
  trim: string | null
  promo_image_url: string | null
  promo_label: string | null
  status: string
}

const INPUT_DARK: React.CSSProperties = {
  background: '#181818',
  color: '#ffffff',
  border: '1px solid #303030',
  borderRadius: 4,
  padding: '14px 16px',
  height: 48,
  fontFamily: 'inherit',
  fontSize: 14,
  width: '100%',
  outline: 'none',
  colorScheme: 'dark',
}

const LABEL_UPPER: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '1.1px',
  textTransform: 'uppercase',
  color: '#969696',
  marginBottom: 8,
  display: 'block',
}

// ── Location type ─────────────────────────────────────────────────────────────

interface PublicLocation {
  location_id: string
  name: string
  short_code: string
  city: string
  state_province: string | null
  country_code: string
  airport_code: string | null
  location_type: string
}

// ── Location Combobox ─────────────────────────────────────────────────────────

interface LocationComboboxProps {
  id: string
  value: string
  displayValue: string
  onSelect: (shortCode: string, displayName: string) => void
  onClear: () => void
  placeholder?: string
  locations: PublicLocation[]
  loading: boolean
}

function LocationCombobox({
  id, value, displayValue, onSelect, onClear,
  placeholder = 'City, Airport, or Address',
  locations, loading,
}: LocationComboboxProps) {
  const [query, setQuery]           = useState('')
  const [open, setOpen]             = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLUListElement>(null)

  const filtered = query.length === 0
    ? locations
    : locations.filter(loc => {
        const q = query.toLowerCase()
        return (
          loc.name.toLowerCase().includes(q) ||
          loc.city.toLowerCase().includes(q) ||
          loc.short_code.toLowerCase().includes(q) ||
          (loc.airport_code ?? '').toLowerCase().includes(q)
        )
      })

  useEffect(() => { setHighlighted(0) }, [query])

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        if (value) setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [value])

  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  function handleSelect(loc: PublicLocation) {
    onSelect(loc.short_code, loc.name)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); return }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) handleSelect(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const borderColor = open ? '#da291c' : '#303030'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        {/* Pin icon */}
        <svg
          style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: value ? '#da291c' : '#555' }}
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>

        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          autoComplete="off"
          placeholder={value ? displayValue : placeholder}
          value={open || !value ? query : ''}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onClear() }}
          onKeyDown={handleKeyDown}
          style={{
            ...INPUT_DARK,
            borderColor,
            paddingLeft: 40,
            paddingRight: value ? 36 : 16,
            boxSizing: 'border-box',
          }}
        />

        {/* Selected value display overlay */}
        {value && !open && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            paddingLeft: 40, paddingRight: 36, pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 14, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayValue}
            </span>
          </div>
        )}

        {/* Clear button */}
        {value && (
          <button
            type="button"
            onClick={() => { onClear(); setQuery(''); inputRef.current?.focus() }}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', padding: 4, cursor: 'pointer',
              color: '#555', display: 'flex', alignItems: 'center',
            }}
            aria-label="Clear location"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999,
            background: '#1a1a1a', border: '1px solid #303030', borderRadius: 4,
            boxShadow: '0 12px 32px rgba(0,0,0,0.7)', maxHeight: 260, overflowY: 'auto',
            margin: 0, padding: '4px 0', listStyle: 'none',
          }}
        >
          {loading ? (
            <li style={{ padding: '12px 16px', fontSize: 13, color: '#555' }}>Loading locations…</li>
          ) : filtered.length === 0 ? (
            <li style={{ padding: '12px 16px', fontSize: 13, color: '#555' }}>
              {query ? `No locations match "${query}"` : 'No locations available'}
            </li>
          ) : filtered.map((loc, i) => (
            <li
              key={loc.location_id}
              role="option"
              aria-selected={loc.short_code === value}
              onMouseDown={e => { e.preventDefault(); handleSelect(loc) }}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', cursor: 'pointer',
                background: i === highlighted ? 'rgba(218,41,28,0.12)' : 'transparent',
                borderLeft: i === highlighted ? `2px solid ${RED}` : '2px solid transparent',
                transition: 'background 0.1s',
              }}
            >
              {/* Icon */}
              <div style={{ flexShrink: 0, color: i === highlighted ? RED : '#555' }}>
                {loc.location_type === 'AIRPORT' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5c-1.5-1.5-3.5-1.5-5 0L11 6 2.8 4.2l-2.3 2.3L8 10l-4 4-3-1-1 2 3 2 2 3 2-1-1-3 4-4 3.7 5.5 2.3-2.3z"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                )}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {loc.name}
                </p>
                <p style={{ fontSize: 11.5, color: '#555', margin: '1px 0 0' }}>
                  {loc.city}{loc.state_province ? `, ${loc.state_province}` : ''}
                  {loc.location_type && <span style={{ color: '#444' }}> · {loc.location_type === 'AIRPORT' ? 'Airport' : loc.location_type.charAt(0) + loc.location_type.slice(1).toLowerCase()}</span>}
                </p>
              </div>

              {/* Code badge */}
              <span style={{
                flexShrink: 0, fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                color: '#969696', background: 'rgba(255,255,255,0.06)',
                padding: '2px 6px', borderRadius: 3,
              }}>
                {loc.airport_code ?? loc.short_code}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────

function VehicleCard({ make, model, model_year, trim, promo_image_url, promo_label, status }: PromoVehicle) {
  const [hov, setHov] = useState(false)
  const available = status === 'AVAILABLE'
  const displayName = `${model_year} ${make} ${model}${trim ? ' ' + trim : ''}`
  return (
    <div style={{ background: '#ffffff', border: '1px solid #d2d2d2', borderRadius: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}>
      <div>
        {promo_image_url
          ? (
            <div style={{ position: 'relative' }}>
              <img src={promo_image_url} alt={displayName} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
              {promo_label && (
                <span style={{
                  position: 'absolute', top: 12, left: 12,
                  background: RED, color: '#fff',
                  fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                  padding: '4px 10px',
                }}>
                  {promo_label}
                </span>
              )}
            </div>
          )
          : (
            <div style={{ width: '100%', aspectRatio: '16/9', background: '#e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#999' }}>No Image</span>
            </div>
          )
        }
        <div style={{ padding: '20px 20px 0' }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#181818', lineHeight: 1.2, marginBottom: 4 }}>{displayName}</h3>
          {!available && (
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#999' }}>
              Currently Unavailable
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: '16px 20px 20px' }}>
        <a
          href={available ? '/search' : '#'}
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 48, width: '100%',
            border: available ? '1px solid #181818' : '1px solid #cccccc',
            background: available ? (hov ? '#181818' : 'transparent') : 'transparent',
            color: available ? (hov ? '#ffffff' : '#181818') : '#999999',
            fontSize: 13, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
            textDecoration: 'none', cursor: available ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s, color 0.2s', borderRadius: 0,
          }}
        >
          {available ? 'Reserve' : 'Unavailable'}
        </a>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [pickup,        setPickup]        = useState('')
  const [pickupDisplay, setPickupDisplay] = useState('')
  const [dropoff,       setDropoff]       = useState('')
  const [dropoffDisplay,setDropoffDisplay]= useState('')
  const [fromDate,      setFromDate]      = useState('')
  const [toDate,        setToDate]        = useState('')
  const [btnHov,        setBtnHov]        = useState(false)
  const [livHov,        setLivHov]        = useState(false)
  const [promoVehicles, setPromoVehicles] = useState<PromoVehicle[]>([])
  const [loadingPromo,  setLoadingPromo]  = useState(true)
  const [locations,     setLocations]     = useState<PublicLocation[]>([])
  const [loadingLoc,    setLoadingLoc]    = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/fleet/promo', { headers: { 'X-Tenant-ID': tenantId() } })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: PromoVehicle[]) => { if (!cancelled) { setPromoVehicles(data); setLoadingPromo(false) } })
      .catch(() => { if (!cancelled) setLoadingPromo(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/locations/public', { headers: { 'X-Tenant-ID': tenantId() } })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: PublicLocation[]) => { if (!cancelled) { setLocations(data); setLoadingLoc(false) } })
      .catch(() => { if (!cancelled) setLoadingLoc(false) })
    return () => { cancelled = true }
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const p = new URLSearchParams()
    if (pickup)   p.set('pickup',  pickup)
    if (dropoff)  p.set('dropoff', dropoff)
    else if (pickup) p.set('dropoff', pickup)
    if (fromDate) p.set('from',    fromDate)
    if (toDate)   p.set('to',      toDate)
    window.location.href = `/search?${p.toString()}`
  }

  const tenant = cachedTenant()
  const heroHeading = tenant?.hero_heading || 'Drive The Dream.'
  const heroSubheading = tenant?.hero_subheading
    || 'Reserve an exclusive vehicle from our elite fleet. Delivered directly to your estate or private hangar.'

  return (
    <>
      {/* ── 1. CINEMA HERO ──────────────────────────────────────────────────── */}
      {/* Colours read from the --p-* theme tokens rather than fixed hex, so a
          tenant's published theme actually reaches the storefront's single
          highest-visibility surface. Radius reads --tenant-radius so a
          template's shape language (a hairline Marque vs. a pill-shaped
          Voltage) shows up on the booking widget without a style-name branch —
          the server already resolved "pill" to 999px in the generated CSS. */}
      <section style={{ position: 'relative', width: '100%', height: '100vh', minHeight: 900, background: 'var(--p-bg)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
        {/* Full-bleed photo */}
        <img
          src="/assets/hero_cinema.png"
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />
        {/* Bottom gradient */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '60%', background: 'linear-gradient(180deg, transparent, var(--p-bg))', zIndex: 1 }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1280, margin: '0 auto', width: '100%', padding: '0 48px 96px' }}>
          <h1 style={{ fontSize: 'clamp(32px, 5.5vw, 80px)', fontWeight: 500, letterSpacing: '-1.6px', lineHeight: 1.05, color: 'var(--p-text-1)', margin: '0 0 16px' }}>
            {heroHeading}
          </h1>
          <p style={{ fontSize: 16, fontWeight: 400, color: 'var(--p-text-2)', maxWidth: 600, lineHeight: 1.5, margin: 0 }}>
            {heroSubheading}
          </p>

          {/* Booking widget */}
          <form onSubmit={handleSearch} className="booking-grid" style={{ background: 'var(--p-surface-2)', border: '1px solid var(--p-surface-2)', padding: 32, marginTop: 48, display: 'grid', gap: 24, borderRadius: 'var(--tenant-radius)' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="hp-pickup" style={LABEL_UPPER}>Pick-up Location</label>
              <LocationCombobox
                id="hp-pickup"
                value={pickup}
                displayValue={pickupDisplay}
                onSelect={(code, name) => { setPickup(code); setPickupDisplay(name) }}
                onClear={() => { setPickup(''); setPickupDisplay('') }}
                locations={locations}
                loading={loadingLoc}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="hp-dropoff" style={LABEL_UPPER}>Drop-off Location</label>
              <LocationCombobox
                id="hp-dropoff"
                value={dropoff}
                displayValue={dropoffDisplay}
                onSelect={(code, name) => { setDropoff(code); setDropoffDisplay(name) }}
                onClear={() => { setDropoff(''); setDropoffDisplay('') }}
                placeholder="Same as pick-up"
                locations={locations}
                loading={loadingLoc}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="hp-from" style={LABEL_UPPER}>Pick-up Date</label>
              <input id="hp-from" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={INPUT_DARK} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="hp-to" style={LABEL_UPPER}>Drop-off Date</label>
              <input id="hp-to" type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={INPUT_DARK} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                onMouseEnter={() => setBtnHov(true)}
                onMouseLeave={() => setBtnHov(false)}
                style={{
                  background: btnHov ? RED_ACTIVE : RED,
                  color: '#ffffff',
                  fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
                  height: 48, border: 'none', cursor: 'pointer', borderRadius: 0, width: '100%',
                  transition: 'background 0.2s', fontFamily: 'inherit', padding: '0 12px',
                }}
              >
                Check Availability
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ── 2. FLEET (white) ────────────────────────────────────────────────── */}
      <section id="fleet" style={{ background: '#ffffff', color: '#181818', padding: '96px 48px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <h2 style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.36px', color: '#181818', marginBottom: 8 }}>
            Reserve Your Vehicle
          </h2>
          <p style={{ fontSize: 14, color: '#666666', marginBottom: 32 }}>
            Featured vehicles available now. <a href="/search" style={{ color: RED, fontWeight: 600, textDecoration: 'none' }}>See full inventory</a>
          </p>
          {loadingPromo ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 24 }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} style={{ background: '#f0f0f0', aspectRatio: '3/4', border: '1px solid #e0e0e0' }} />
              ))}
            </div>
          ) : promoVehicles.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#999999' }}>No featured vehicles at this time. <a href="/search" style={{ color: RED, textDecoration: 'none', fontWeight: 600 }}>Browse all available vehicles</a></p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 24 }}>
              {promoVehicles.map(v => <VehicleCard key={v.vehicle_id} {...v} />)}
            </div>
          )}
        </div>
      </section>

      {/* ── 3. EDITORIAL (dark) ─────────────────────────────────────────────── */}
      <section id="models" style={{ padding: '96px 48px', maxWidth: 1280, margin: '0 auto' }}>
        <h2 style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.36px', color: '#ffffff', marginBottom: 16 }}>
          White Glove Experience
        </h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', maxWidth: 600, lineHeight: 1.5, marginBottom: 48 }}>
          We go beyond standard rentals. Enjoy 24/7 dedicated concierge service, bespoke driving itineraries, and seamless vehicle delivery directly to your location.
        </p>
        <div className="editorial-grid" style={{ display: 'grid', gap: 32 }}>
          <div>
            <img src="/assets/interior_cinema.png" alt="Luxury Interior Detail" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
            <div style={{ paddingTop: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>Immaculate Preparation</h3>
              <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.5 }}>
                Every vehicle undergoes a rigorous 100-point inspection and professional detailing before hand-off.
              </p>
            </div>
          </div>
          <div>
            <img src="/assets/action_cinema.png" alt="Car in Action" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
            <div style={{ paddingTop: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>Unlimited Thrills</h3>
              <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.5 }}>
                Engineered on the track, our fleet is ready to deliver visceral acceleration and razor-sharp handling.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. LOCATIONS ────────────────────────────────────────────────────── */}
      <section id="locations" style={{ background: '#111111', padding: '96px 48px', borderTop: '1px solid #222222' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 12 }}>
            Rental Locations
          </p>
          <h2 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', marginBottom: 12 }}>
            Available Nationwide
          </h2>
          <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', maxWidth: 520, lineHeight: 1.6, marginBottom: 48 }}>
            Premium vehicles waiting at major airports across the United States. Walk off the jet and into the driver&apos;s seat.
          </p>

          {loadingLoc ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{ height: 160, background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.06)' }} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {[...locations].sort((a, b) => a.city.localeCompare(b.city)).map(loc => (
                <a
                  key={loc.location_id}
                  href={`/search?pickup=${loc.short_code}`}
                  style={{
                    textDecoration: 'none', display: 'block',
                    background: '#181818', border: '1px solid rgba(255,255,255,0.07)',
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = 'rgba(218,41,28,0.45)'
                    el.style.background = '#1e1e1e'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = 'rgba(255,255,255,0.07)'
                    el.style.background = '#181818'
                  }}
                >
                  <div style={{
                    padding: '28px 24px', height: '100%', boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 20,
                  }}>
                    {/* Top: code + type */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <span style={{
                        fontFamily: 'monospace', fontSize: 32, fontWeight: 700,
                        color: 'rgba(255,255,255,0.12)', letterSpacing: '0.04em', lineHeight: 1,
                      }}>
                        {loc.airport_code ?? loc.short_code}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                        color: '#666666', border: '1px solid #303030', padding: '3px 8px',
                      }}>
                        {loc.location_type === 'AIRPORT' ? 'Airport' : loc.location_type.charAt(0) + loc.location_type.slice(1).toLowerCase()}
                      </span>
                    </div>

                    {/* Bottom: name + city + CTA */}
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.01em', marginBottom: 4, lineHeight: 1.3 }}>
                        {loc.name}
                      </p>
                      <p style={{ fontSize: 12, fontWeight: 400, color: '#666666', marginBottom: 16 }}>
                        {loc.city}{loc.state_province ? `, ${loc.state_province}` : ''} · {loc.country_code}
                      </p>
                      <span style={{
                        fontSize: 12, fontWeight: 700, color: RED,
                        letterSpacing: '1px', textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        Search Cars
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── 5. CONCIERGE / ABOUT ────────────────────────────────────────────── */}
      <section id="about" style={{ background: '#181818', borderTop: '1px solid #222222', padding: '96px 48px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
          {/* Left: copy */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 12 }}>
              Concierge Service
            </p>
            <h2 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', marginBottom: 20, lineHeight: 1.15 }}>
              Your personal pit crew, on call 24/7
            </h2>
            <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.7, marginBottom: 16 }}>
              Every reservation comes with a dedicated concierge. From airport handoffs and custom driving routes to hotel coordination and track bookings — we handle the details so you can focus on the road.
            </p>
            <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.7, marginBottom: 40 }}>
              Available via phone, text, or in-app. Response time under 5 minutes, guaranteed.
            </p>
            <a
              href="/search"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                height: 48, padding: '0 32px',
                background: RED, color: '#ffffff',
                fontSize: 13, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
                textDecoration: 'none', borderRadius: 0, transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
            >
              Reserve now
            </a>
          </div>

          {/* Right: service pillars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              { title: 'Airport Meet & Greet',    body: 'Your vehicle is ready at the curb when you land. No queues, no desks.' },
              { title: 'Bespoke Driving Routes',  body: 'Curated itineraries for canyon runs, coastal roads, and track days.' },
              { title: 'Vehicle Delivery',         body: 'We deliver directly to your hotel, residence, or event venue.' },
              { title: 'Priority Modifications',   body: 'Date changes, upgrades, and extras handled instantly — no fees.' },
            ].map(item => (
              <div key={item.title} style={{ background: '#242424', border: '1px solid rgba(255,255,255,0.07)', padding: '20px 24px' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', letterSpacing: '-0.01em', marginBottom: 6 }}>{item.title}</p>
                <p style={{ fontSize: 13, fontWeight: 400, color: '#666666', lineHeight: 1.6 }}>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. LIVERY BAND (red) ────────────────────────────────────────────── */}
      <section style={{ background: RED, padding: '96px 48px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.36px', color: '#ffffff', marginBottom: 16 }}>
          Join The Club
        </h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#ffffff', lineHeight: 1.5, maxWidth: 500, margin: '0 auto 32px' }}>
          Members receive priority booking, exclusive rates, and invitations to track days.
        </p>
        <a
          href="/search"
          onMouseEnter={() => setLivHov(true)}
          onMouseLeave={() => setLivHov(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: livHov ? '#ffffff' : 'transparent',
            color: livHov ? RED : '#ffffff',
            fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
            padding: '14px 32px', height: 48,
            border: '1px solid #ffffff',
            textDecoration: 'none', borderRadius: 0,
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          Apply Now
        </a>
      </section>

      {/* Responsive styles */}
      <style>{`
        .booking-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 1024px) {
          .booking-grid {
            grid-template-columns: 1.5fr 1.5fr 1fr 1fr auto;
            align-items: flex-end;
          }
        }
        .fleet-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .fleet-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (min-width: 1024px) {
          .fleet-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
        .editorial-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 1024px) {
          .editorial-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </>
  )
}
