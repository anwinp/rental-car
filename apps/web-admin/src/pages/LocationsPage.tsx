import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@rcm/ui/auth'
import { UserRole } from '@rcm/shared-types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Location {
  location_id: string
  name: string
  short_code: string
  location_type: string
  address_line1: string
  address_line2: string | null
  city: string
  state_province: string | null
  country_code: string
  postal_code: string | null
  airport_code: string | null
  phone: string | null
  email: string | null
  timezone: string
  currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface VehicleSummary {
  vehicle_id: string
  home_location_id: string
  status: string
  is_active: boolean
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations?limit=200', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load locations: ${res.status}`)
  return res.json()
}

async function fetchVehicles(): Promise<VehicleSummary[]> {
  const res = await fetch('/api/v1/fleet/vehicles?limit=200', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load vehicles: ${res.status}`)
  return res.json()
}

async function apiCreateLocation(payload: Record<string, unknown>): Promise<Location> {
  const res = await fetch('/api/v1/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err?.detail ?? `Error ${res.status}`)
  }
  return res.json()
}

async function apiUpdateLocation(id: string, payload: Record<string, unknown>): Promise<Location> {
  const res = await fetch(`/api/v1/locations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err?.detail ?? `Error ${res.status}`)
  }
  return res.json()
}

async function apiDeactivateLocation(id: string): Promise<Location> {
  const res = await fetch(`/api/v1/locations/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: string }
    throw new Error(err?.detail ?? `Error ${res.status}`)
  }
  return res.json()
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOCATION_TYPES = [
  'AIRPORT', 'DOWNTOWN', 'NEIGHBORHOOD', 'HOTEL', 'DEALER', 'DROP_HUB', 'DELIVERY_ONLY',
] as const

const TYPE_LABEL: Record<string, string> = {
  AIRPORT: 'Airport', DOWNTOWN: 'Downtown', NEIGHBORHOOD: 'Neighborhood',
  HOTEL: 'Hotel', DEALER: 'Dealer', DROP_HUB: 'Drop Hub', DELIVERY_ONLY: 'Delivery Only',
}

const TYPE_BADGE: Record<string, string> = {
  AIRPORT: 'badge-indigo', DOWNTOWN: 'badge-sky', NEIGHBORHOOD: 'badge-green',
  HOTEL: 'badge-purple', DEALER: 'badge-amber', DROP_HUB: 'badge-slate', DELIVERY_ONLY: 'badge-slate',
}

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo',
]

const BLANK: Record<string, string> = {
  name: '', short_code: '', location_type: 'DOWNTOWN', address_line1: '', address_line2: '',
  city: '', state_province: '', country_code: 'US', postal_code: '', airport_code: '',
  phone: '', email: '', timezone: 'America/New_York', is_active: 'true',
}

const ADMIN_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]

// ── Helpers ───────────────────────────────────────────────────────────────────

function opt(v: string): string | null { return v.trim() || null }

function buildPayload(form: Record<string, string>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: form.name.trim(),
    short_code: form.short_code.trim().toUpperCase(),
    location_type: form.location_type,
    address_line1: form.address_line1.trim(),
    city: form.city.trim(),
    country_code: (form.country_code.trim() || 'US').toUpperCase(),
    timezone: form.timezone || 'America/New_York',
    is_active: form.is_active === 'true',
  }
  if (opt(form.address_line2)) base.address_line2 = opt(form.address_line2)
  if (opt(form.state_province)) base.state_province = opt(form.state_province)
  if (opt(form.postal_code)) base.postal_code = opt(form.postal_code)
  if (opt(form.phone)) base.phone = opt(form.phone)
  if (opt(form.email)) base.email = opt(form.email)
  if (form.location_type === 'AIRPORT' && opt(form.airport_code)) {
    base.airport_code = form.airport_code.trim().toUpperCase()
  }
  return base
}

function locationToForm(loc: Location): Record<string, string> {
  return {
    name: loc.name,
    short_code: loc.short_code,
    location_type: loc.location_type,
    address_line1: loc.address_line1,
    address_line2: loc.address_line2 ?? '',
    city: loc.city,
    state_province: loc.state_province ?? '',
    country_code: loc.country_code,
    postal_code: loc.postal_code ?? '',
    airport_code: loc.airport_code ?? '',
    phone: loc.phone ?? '',
    email: loc.email ?? '',
    timezone: loc.timezone,
    is_active: String(loc.is_active),
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Fl({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </p>
      {children}
    </div>
  )
}

function FInput({
  value, onChange, placeholder, required, disabled, maxLength,
}: { value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; disabled?: boolean; maxLength?: number }) {
  return (
    <input
      className="field-input w-full px-3 py-2 text-[13px]"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      maxLength={maxLength}
    />
  )
}

// ── Location Form Modal ───────────────────────────────────────────────────────

function LocationModal({
  initial,
  editId,
  onClose,
}: {
  initial: Record<string, string>
  editId: string | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>(initial)
  const [apiError, setApiError] = useState<string | null>(null)

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  const createMut = useMutation({
    mutationFn: apiCreateLocation,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['locations'] }); onClose() },
    onError: (e: Error) => setApiError(e.message),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiUpdateLocation(id, payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['locations'] }); onClose() },
    onError: (e: Error) => setApiError(e.message),
  })

  const isPending = createMut.isPending || updateMut.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setApiError(null)
    const payload = buildPayload(form)
    if (editId) {
      updateMut.mutate({ id: editId, payload })
    } else {
      createMut.mutate(payload)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-2xl rounded-xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
            {editId ? 'Edit Location' : 'Add Location'}
          </h2>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md transition-colors" style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="overflow-y-auto px-6 py-5 space-y-5">

            <div className="grid grid-cols-2 gap-4">
              <Fl label="Location Name" required>
                <FInput value={form.name} onChange={v => set('name', v)} placeholder="e.g. JFK International Airport" required />
              </Fl>
              <Fl label="Short Code" required>
                <FInput value={form.short_code} onChange={v => set('short_code', v)} placeholder="e.g. JFK01" required maxLength={10} />
              </Fl>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Fl label="Type" required>
                <select className="field-input w-full px-3 py-2 text-[13px]" value={form.location_type} onChange={e => set('location_type', e.target.value)}>
                  {LOCATION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </Fl>
              {form.location_type === 'AIRPORT' && (
                <Fl label="Airport Code (IATA)" required>
                  <FInput value={form.airport_code} onChange={v => set('airport_code', v)} placeholder="e.g. JFK" required={form.location_type === 'AIRPORT'} maxLength={3} />
                </Fl>
              )}
            </div>

            <div className="pt-1" style={{ borderTop: '1px solid var(--border-sub)' }}>
              <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-3 mt-3" style={{ color: 'var(--text-3)' }}>Address</p>
              <div className="space-y-3">
                <Fl label="Address Line 1" required>
                  <FInput value={form.address_line1} onChange={v => set('address_line1', v)} placeholder="Street address" required />
                </Fl>
                <Fl label="Address Line 2">
                  <FInput value={form.address_line2} onChange={v => set('address_line2', v)} placeholder="Suite, terminal, gate (optional)" />
                </Fl>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Fl label="City" required>
                      <FInput value={form.city} onChange={v => set('city', v)} placeholder="City" required />
                    </Fl>
                  </div>
                  <Fl label="State / Province">
                    <FInput value={form.state_province} onChange={v => set('state_province', v)} placeholder="e.g. NY" maxLength={10} />
                  </Fl>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Fl label="Postal Code">
                    <FInput value={form.postal_code} onChange={v => set('postal_code', v)} placeholder="ZIP / Postal code" />
                  </Fl>
                  <Fl label="Country Code" required>
                    <FInput value={form.country_code} onChange={v => set('country_code', v)} placeholder="US" required maxLength={2} />
                  </Fl>
                </div>
              </div>
            </div>

            <div className="pt-1" style={{ borderTop: '1px solid var(--border-sub)' }}>
              <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-3 mt-3" style={{ color: 'var(--text-3)' }}>Contact & Settings</p>
              <div className="grid grid-cols-2 gap-4">
                <Fl label="Phone">
                  <FInput value={form.phone} onChange={v => set('phone', v)} placeholder="+1 (800) 555-0100" />
                </Fl>
                <Fl label="Email">
                  <FInput value={form.email} onChange={v => set('email', v)} placeholder="location@example.com" />
                </Fl>
                <Fl label="Timezone">
                  <select className="field-input w-full px-3 py-2 text-[13px]" value={form.timezone} onChange={e => set('timezone', e.target.value)}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </Fl>
                <Fl label="Status">
                  <select className="field-input w-full px-3 py-2 text-[13px]" value={form.is_active} onChange={e => set('is_active', e.target.value)}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </Fl>
              </div>
            </div>

            {apiError && (
              <div className="rounded-lg px-3.5 py-3 text-[13px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(244,114,114,0.25)' }}>
                {apiError}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2.5 px-6 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={isPending} className="btn-primary disabled:opacity-50">
              {isPending ? 'Saving…' : editId ? 'Save Changes' : 'Add Location'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ loc, onClose }: { loc: Location; onClose: () => void }) {
  const qc = useQueryClient()
  const [apiError, setApiError] = useState<string | null>(null)

  const deleteMut = useMutation({
    mutationFn: apiDeactivateLocation,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['locations'] }); onClose() },
    onError: (e: Error) => setApiError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex h-11 w-11 items-center justify-center rounded-full mb-4" style={{ background: 'var(--danger-bg)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </div>
        <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-1)' }}>Deactivate Location</h3>
        <p className="text-[13px] mb-1" style={{ color: 'var(--text-2)' }}>
          <strong>{loc.name}</strong> will be deactivated. Existing reservations are not affected.
        </p>
        <p className="text-[12px] mb-5" style={{ color: 'var(--text-3)' }}>
          The location will no longer appear in booking searches or accept new reservations.
        </p>
        {apiError && (
          <p className="text-[12px] mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{apiError}</p>
        )}
        <div className="flex gap-2.5 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => deleteMut.mutate(loc.location_id)}
            disabled={deleteMut.isPending}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--danger)', color: '#fff' }}>
            {deleteMut.isPending ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function LocationsPage() {
  const { user } = useAuth()
  const isAdmin = ADMIN_ROLES.some(r => user?.roles?.includes(r) ?? false)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editLoc, setEditLoc] = useState<Location | null>(null)
  const [deleteLoc, setDeleteLoc] = useState<Location | null>(null)

  const locationsQ = useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 30_000,
  })

  const vehiclesQ = useQuery({
    queryKey: ['vehicles-summary'],
    queryFn: fetchVehicles,
    staleTime: 60_000,
  })

  const inventoryByLocation: Record<string, { total: number; available: number }> = {}
  for (const v of vehiclesQ.data ?? []) {
    if (!v.is_active) continue
    const lid = v.home_location_id
    if (!inventoryByLocation[lid]) inventoryByLocation[lid] = { total: 0, available: 0 }
    inventoryByLocation[lid].total++
    if (v.status === 'AVAILABLE') inventoryByLocation[lid].available++
  }

  const locations = locationsQ.data ?? []

  const filtered = locations.filter(loc => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      loc.name.toLowerCase().includes(q) ||
      loc.short_code.toLowerCase().includes(q) ||
      loc.city.toLowerCase().includes(q) ||
      (loc.airport_code ?? '').toLowerCase().includes(q)
    const matchType = !typeFilter || loc.location_type === typeFilter
    return matchSearch && matchType
  })

  const totalFleet  = Object.values(inventoryByLocation).reduce((s, v) => s + v.total, 0)
  const totalActive = locations.filter(l => l.is_active).length

  function openAdd() { setEditLoc(null); setShowModal(true) }
  function openEdit(loc: Location) { setEditLoc(loc); setShowModal(true) }
  function closeModal() { setShowModal(false); setEditLoc(null) }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Locations</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>Manage rental locations and their fleet inventory</p>
        </div>
        {isAdmin && (
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Location
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Locations', value: locations.length },
          { label: 'Active Locations', value: totalActive },
          { label: 'Total Fleet', value: totalFleet },
        ].map(s => (
          <div key={s.label} className="panel px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{s.label}</p>
            <p className="mt-1.5 text-[26px] font-bold num" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="search"
            placeholder="Search by name, code, city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="field-input w-full pl-8 pr-3 py-2 text-[13px]"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="field-input px-3 py-2 text-[13px]"
        >
          <option value="">All Types</option>
          {LOCATION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden">
        {locationsQ.isLoading ? (
          <div className="p-8 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>Loading…</div>
        ) : locationsQ.isError ? (
          <div className="p-8 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
            Failed to load locations.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Location', 'Type', 'Address', 'Fleet', 'Contact', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                    No locations match your filters.
                  </td>
                </tr>
              ) : filtered.map((loc, i) => {
                const inv = inventoryByLocation[loc.location_id] ?? { total: 0, available: 0 }
                const utilPct = inv.total > 0 ? Math.round(((inv.total - inv.available) / inv.total) * 100) : 0
                return (
                  <tr
                    key={loc.location_id}
                    style={{
                      borderBottom: i < filtered.length - 1 ? '1px solid var(--border-sub)' : 'none',
                    }}
                  >
                    {/* Location name + code */}
                    <td className="px-4 py-3.5">
                      <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text-1)' }}>{loc.name}</p>
                      <p className="text-[11.5px] mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>{loc.short_code}{loc.airport_code ? ` · ${loc.airport_code}` : ''}</p>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3.5">
                      <span className={`badge ${TYPE_BADGE[loc.location_type] ?? 'badge-slate'} text-[11px]`}>
                        {TYPE_LABEL[loc.location_type] ?? loc.location_type}
                      </span>
                    </td>

                    {/* Address */}
                    <td className="px-4 py-3.5">
                      <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{loc.city}{loc.state_province ? `, ${loc.state_province}` : ''}</p>
                      <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{loc.address_line1}</p>
                    </td>

                    {/* Fleet inventory */}
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>{inv.total} vehicles</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="h-1 w-20 rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                          <div className="h-full rounded-full" style={{ width: `${utilPct}%`, background: 'var(--accent)' }} />
                        </div>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {inv.available} avail · {utilPct}% util
                        </p>
                      </div>
                    </td>

                    {/* Contact */}
                    <td className="px-4 py-3.5">
                      {loc.phone && <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{loc.phone}</p>}
                      {loc.email && <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{loc.email}</p>}
                      {!loc.phone && !loc.email && <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <span className={`badge text-[11px] ${loc.is_active ? 'badge-green' : 'badge-slate'}`}>
                        {loc.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(loc)}
                            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                            style={{ color: 'var(--text-3)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-1)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)' }}
                            title="Edit"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          {loc.is_active && (
                            <button
                              onClick={() => setDeleteLoc(loc)}
                              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                              style={{ color: 'var(--text-3)' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--danger-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--danger)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)' }}
                              title="Deactivate"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showModal && (
        <LocationModal
          initial={editLoc ? locationToForm(editLoc) : BLANK}
          editId={editLoc?.location_id ?? null}
          onClose={closeModal}
        />
      )}
      {deleteLoc && (
        <DeleteConfirm loc={deleteLoc} onClose={() => setDeleteLoc(null)} />
      )}
    </div>
  )
}
