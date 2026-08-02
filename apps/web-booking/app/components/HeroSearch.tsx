'use client'

import { resolveTenant, tenantHeaders } from '../lib/tenant'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMES = [
  '12:00 AM','1:00 AM','2:00 AM','3:00 AM','4:00 AM','5:00 AM',
  '6:00 AM','7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM',
  '12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM',
  '6:00 PM','7:00 PM','8:00 PM','9:00 PM','10:00 PM','11:00 PM',
]

// Tenant is resolved at runtime from the hostname — see app/lib/tenant.ts.
// A build-time constant here meant one deployment per organisation.

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '13px 16px', fontSize: 14,
  border: '1px solid rgba(255,255,255,0.10)', borderRadius: 4,
  background: 'rgba(255,255,255,0.05)', color: '#ffffff',
  outline: 'none', transition: 'border-color 0.2s, background 0.2s',
  appearance: 'none', colorScheme: 'dark', fontWeight: 300,
}

// ── Location Combobox ─────────────────────────────────────────────────────────

interface LocationComboboxProps {
  id: string
  value: string          // short_code stored in form state
  displayValue: string   // human-readable name shown in input
  onSelect: (shortCode: string, displayName: string) => void
  onClear: () => void
  error?: string
  placeholder?: string
  locations: PublicLocation[]
  loading: boolean
}

function LocationCombobox({
  id, value, displayValue, onSelect, onClear, error, placeholder = 'City, airport or zip',
  locations, loading,
}: LocationComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

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

  useEffect(() => {
    setHighlighted(0)
  }, [query])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        // If user typed but didn't select, revert to selected display name
        if (value) setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [value])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setOpen(true)
    if (!e.target.value) onClear()
  }

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

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const inputBorder = error ? '#da291c' : open ? 'rgba(255,255,255,0.40)' : 'rgba(255,255,255,0.10)'
  const inputBg = open ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)'

  const typeLabel: Record<string, string> = {
    AIRPORT: 'Airport', DOWNTOWN: 'Downtown', NEIGHBORHOOD: 'Neighborhood',
    HOTEL: 'Hotel', DEALER: 'Dealer', DROP_HUB: 'Drop Hub', DELIVERY_ONLY: 'Delivery Only',
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Input wrapper */}
      <div style={{ position: 'relative' }}>
        {/* Pin icon */}
        <svg
          style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: value ? '#ffffff' : '#64748b', flexShrink: 0 }}
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
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          style={{
            ...fieldStyle,
            borderColor: inputBorder,
            background: inputBg,
            paddingLeft: 40,
            paddingRight: value ? 36 : 16,
          }}
        />

        {/* Selected value display when closed */}
        {value && !open && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            paddingLeft: 40, paddingRight: 36, pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 14, color: '#ffffff', fontWeight: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              color: '#64748b', display: 'flex', alignItems: 'center',
            }}
            aria-label="Clear location"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 200,
            background: '#181818', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4,
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)', maxHeight: 280, overflowY: 'auto',
            margin: 0, padding: '4px 0', listStyle: 'none',
          }}
        >
          {loading ? (
            <li style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>Loading locations…</li>
          ) : filtered.length === 0 ? (
            <li style={{ padding: '12px 16px', fontSize: 13, color: '#64748b' }}>
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
                background: i === highlighted ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: i === highlighted ? '2px solid rgba(218,41,28,0.7)' : '2px solid transparent',
                transition: 'background 0.1s',
              }}
            >
              {/* Icon */}
              <div style={{ flexShrink: 0, color: i === highlighted ? '#ffffff' : '#475569' }}>
                {loc.location_type === 'AIRPORT' ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5c-1.5-1.5-3.5-1.5-5 0L11 6 2.8 4.2l-2.3 2.3L8 10l-4 4-3-1-1 2 3 2 2 3 2-1-1-3 4-4 3.7 5.5 2.3-2.3z"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                )}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#f1f5f9', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {loc.name}
                </p>
                <p style={{ fontSize: 11.5, color: '#64748b', margin: '1px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {loc.city}{loc.state_province ? `, ${loc.state_province}` : ''}
                  <span style={{ color: '#334155' }}>·</span>
                  {typeLabel[loc.location_type] ?? loc.location_type}
                </p>
              </div>

              {/* Code badge */}
              <span style={{
                flexShrink: 0, fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
                color: '#94a3b8', background: 'rgba(148,163,184,0.08)',
                padding: '2px 6px', borderRadius: 4,
              }}>
                {loc.airport_code ?? loc.short_code}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p style={{ fontSize: 11, color: '#da291c', marginTop: 4 }} role="alert">{error}</p>}
    </div>
  )
}

// ── Main HeroSearch ───────────────────────────────────────────────────────────

interface SearchForm {
  pickup: string        // short_code
  pickupDisplay: string // human-readable name
  dropoff: string
  dropoffDisplay: string
  from: string
  pickup_time: string
  to: string
  return_time: string
  one_way: boolean
}
type ErrKey = 'pickup' | 'dropoff' | 'from' | 'to'

export function HeroSearch() {
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState<SearchForm>({
    pickup: '', pickupDisplay: '', dropoff: '', dropoffDisplay: '',
    from: '', pickup_time: '10:00 AM', to: '', return_time: '10:00 AM', one_way: false,
  })
  const [errors, setErrors] = useState<Partial<Record<ErrKey, string>>>({})
  const [locations, setLocations] = useState<PublicLocation[]>([])
  const [loadingLoc, setLoadingLoc] = useState(true)
  const [tenantMissing, setTenantMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Resolve the workspace first: the API refuses anonymous requests that
    // carry no tenant rather than defaulting to somebody else's catalogue.
    resolveTenant()
      .then((result) => {
        // resolveTenant now reports which of the three states applies rather
        // than returning null for all of them; only a real workspace should
        // proceed to load locations.
        if (result.kind !== 'tenant') {
          if (!cancelled) { setLoadingLoc(false); setTenantMissing(true) }
          return null
        }
        return fetch('/api/v1/locations/public', { headers: tenantHeaders() })
      })
      .then(r => (r ? (r.ok ? r.json() : Promise.reject(r.status)) : null))
      .then((data: PublicLocation[] | null) => {
        if (!cancelled && data) { setLocations(data); setLoadingLoc(false) }
      })
      .catch(() => { if (!cancelled) setLoadingLoc(false) })
    return () => { cancelled = true }
  }, [])

  function validate() {
    const e: Partial<Record<ErrKey, string>> = {}
    if (!form.pickup) e.pickup = 'Select a pickup location'
    if (form.one_way && !form.dropoff) e.dropoff = 'Select a drop-off location'
    if (!form.from) e.from = 'Required'
    if (!form.to) e.to = 'Required'
    if (form.from && form.to && form.from >= form.to) e.to = 'Must be after pickup'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    router.push(`/search?${new URLSearchParams({
      pickup: form.pickup,
      dropoff: form.one_way ? form.dropoff : form.pickup,
      from: form.from,
      pickup_time: form.pickup_time,
      to: form.to,
      return_time: form.return_time,
      one_way: String(form.one_way),
    })}`)
  }

  const onDateFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = 'rgba(218,41,28,0.5)'
    e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
  }
  const onDateBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'
    e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Tab: round trip / one way */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22 }}>
        {[{ label: 'Round Trip', value: false }, { label: 'One Way', value: true }].map(opt => (
          <button key={String(opt.value)} type="button"
            onClick={() => setForm(f => ({ ...f, one_way: opt.value }))}
            style={{
              padding: '6px 16px', borderRadius: 9999, fontSize: 13, fontWeight: 400,
              border: '1px solid',
              borderColor: form.one_way === opt.value ? '#ffffff' : '#303030',
              background: form.one_way === opt.value ? '#ffffff' : 'transparent',
              color: form.one_way === opt.value ? '#181818' : '#666666',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >{opt.label}</button>
        ))}
      </div>

      {/* Location fields */}
      <div style={{ display: 'grid', gridTemplateColumns: form.one_way ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
        {/* Pickup */}
        <div>
          <label htmlFor="hs-pickup" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            Pickup location
          </label>
          <LocationCombobox
            id="hs-pickup"
            value={form.pickup}
            displayValue={form.pickupDisplay}
            onSelect={(code, name) => {
              setForm(f => ({ ...f, pickup: code, pickupDisplay: name }))
              setErrors(v => ({ ...v, pickup: undefined }))
            }}
            onClear={() => setForm(f => ({ ...f, pickup: '', pickupDisplay: '' }))}
            error={errors.pickup}
            locations={locations}
            loading={loadingLoc}
          />
        </div>

        {/* Drop-off (one-way only) */}
        {form.one_way && (
          <div>
            <label htmlFor="hs-dropoff" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Drop-off location
            </label>
            {tenantMissing && (
              <p style={{
                gridColumn: '1 / -1', margin: '0 0 8px', padding: '10px 14px',
                borderRadius: 6, background: 'rgba(218,41,28,0.12)',
                color: '#f3b6b0', fontSize: 13,
              }}>
                No workspace found at this address. Check the link you were given.
              </p>
            )}
            <LocationCombobox
              id="hs-dropoff"
              value={form.dropoff}
              displayValue={form.dropoffDisplay}
              onSelect={(code, name) => {
                setForm(f => ({ ...f, dropoff: code, dropoffDisplay: name }))
                setErrors(v => ({ ...v, dropoff: undefined }))
              }}
              onClear={() => setForm(f => ({ ...f, dropoff: '', dropoffDisplay: '' }))}
              error={errors.dropoff}
              locations={locations}
              loading={loadingLoc}
            />
          </div>
        )}
      </div>

      {/* Dates + times */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr 120px', gap: 12, marginBottom: 22 }}>
        <div>
          <label htmlFor="hs-from" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Pickup date
          </label>
          <input id="hs-from" type="date" value={form.from} min={today}
            style={{ ...fieldStyle, borderColor: errors.from ? '#da291c' : 'rgba(255,255,255,0.10)' }}
            onFocus={onDateFocus} onBlur={onDateBlur}
            onChange={e => { setForm(f => ({ ...f, from: e.target.value })); setErrors(v => ({ ...v, from: undefined })) }}
          />
          {errors.from && <p style={{ fontSize: 11, color: '#da291c', marginTop: 4 }} role="alert">{errors.from}</p>}
        </div>
        <div>
          <label htmlFor="hs-ptime" style={{ fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6, display: 'block' }}>Time</label>
          <select id="hs-ptime" value={form.pickup_time} style={fieldStyle} onFocus={onDateFocus} onBlur={onDateBlur}
            onChange={e => setForm(f => ({ ...f, pickup_time: e.target.value }))}>
            {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hs-to" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Return date
          </label>
          <input id="hs-to" type="date" value={form.to} min={form.from || today}
            style={{ ...fieldStyle, borderColor: errors.to ? '#da291c' : 'rgba(255,255,255,0.10)' }}
            onFocus={onDateFocus} onBlur={onDateBlur}
            onChange={e => { setForm(f => ({ ...f, to: e.target.value })); setErrors(v => ({ ...v, to: undefined })) }}
          />
          {errors.to && <p style={{ fontSize: 11, color: '#da291c', marginTop: 4 }} role="alert">{errors.to}</p>}
        </div>
        <div>
          <label htmlFor="hs-rtime" style={{ fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6, display: 'block' }}>Time</label>
          <select id="hs-rtime" value={form.return_time} style={fieldStyle} onFocus={onDateFocus} onBlur={onDateBlur}
            onChange={e => setForm(f => ({ ...f, return_time: e.target.value }))}>
            {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Submit */}
      <button type="submit" style={{
        width: '100%',
        background: '#da291c',
        color: '#ffffff', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 0,
        cursor: 'pointer', transition: 'background 0.2s',
        letterSpacing: '1.4px', textTransform: 'uppercase', height: 48, fontFamily: 'inherit',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#b01e0a' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#da291c' }}
      >
        Search Available Cars
      </button>
    </form>
  )
}
