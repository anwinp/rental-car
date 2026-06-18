import { useState, useMemo, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

type ApiVehicle = {
  vehicle_id: string; make: string; model: string; model_year: number
  vin: string; status: string; home_location_id: string
  current_location_id: string | null; vehicle_class_id: string
  plate_number: string | null; odometer_current: number
  is_active: boolean
  is_promo: boolean
  promo_image_url: string | null
  promo_label: string | null
}

type Location = {
  location_id: string; short_code: string; name: string
  city: string; state_province: string
}

type VehicleClass = {
  class_id: string; name: string; sipp_prefix: string; sort_order: number
}

async function fetchVehicles(): Promise<ApiVehicle[]> {
  const res = await fetch('/api/v1/fleet/vehicles?limit=200', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load vehicles')
  return res.json()
}

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load locations')
  return res.json()
}

async function fetchClasses(): Promise<VehicleClass[]> {
  const res = await fetch('/api/v1/fleet/classes', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load vehicle classes')
  return res.json()
}

async function patchVehicle(vehicleId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/v1/fleet/vehicles/${vehicleId}`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).detail ?? 'Update failed') }
  return res.json()
}


async function createVehicle(body: Record<string, unknown>) {
  const res = await fetch('/api/v1/fleet/vehicles', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).detail ?? 'Create failed') }
  return res.json()
}

const STATUS: Record<string, { label: string; badge: string; dot: string; color: string }> = {
  AVAILABLE:             { label:'Available',            badge:'badge-green',  dot:'#10b981', color:'#10b981' },
  ON_RENT:               { label:'On Rent',              badge:'badge-indigo', dot:'#6366f1', color:'#6366f1' },
  MAINTENANCE:           { label:'Maintenance',          badge:'badge-amber',  dot:'#f59e0b', color:'#f59e0b' },
  IN_REPAIR:             { label:'In Repair',            badge:'badge-amber',  dot:'#f59e0b', color:'#f59e0b' },
  DAMAGE_HOLD:           { label:'Damage Hold',          badge:'badge-red',    dot:'#ef4444', color:'#ef4444' },
  CLEANING:              { label:'Cleaning',             badge:'badge-sky',    dot:'#0ea5e9', color:'#0ea5e9' },
  ADMIN_HOLD:            { label:'Admin Hold',           badge:'badge-slate',  dot:'#94a3b8', color:'#94a3b8' },
  STAGING:               { label:'Staging',              badge:'badge-purple', dot:'#8b5cf6', color:'#8b5cf6' },
  RETURNING:             { label:'Returning',            badge:'badge-sky',    dot:'#0ea5e9', color:'#0ea5e9' },
  READY_FOR_INSPECTION:  { label:'Ready for Inspection', badge:'badge-purple', dot:'#8b5cf6', color:'#8b5cf6' },
  PENDING_DISPOSAL:      { label:'Pending Disposal',     badge:'badge-red',    dot:'#ef4444', color:'#ef4444' },
  DISPOSED:              { label:'Disposed',             badge:'badge-slate',  dot:'#94a3b8', color:'#94a3b8' },
  PENDING_DELIVERY:      { label:'Pending Delivery',     badge:'badge-sky',    dot:'#0ea5e9', color:'#0ea5e9' },
}
const getS = (s: string) => STATUS[s] ?? { label: s, badge:'badge-slate', dot:'#94a3b8', color:'#94a3b8' }

function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
      background: ok ? 'rgba(16,185,129,0.15)' : 'var(--danger-bg)',
      color: ok ? '#10b981' : 'var(--danger)',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }}>
      {msg}
    </div>
  )
}

export function FleetPage() {
  const qc = useQueryClient()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editVehicle, setEditVehicle] = useState<ApiVehicle | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [addForm, setAddForm] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const { data: vehicles = [], isLoading: loadingV, error: errV } = useQuery<ApiVehicle[]>({
    queryKey: ['fleet-vehicles'], queryFn: fetchVehicles, staleTime: 60_000,
  })
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'], queryFn: fetchLocations, staleTime: 300_000,
  })
  const { data: classes = [] } = useQuery<VehicleClass[]>({
    queryKey: ['vehicle-classes'], queryFn: fetchClasses, staleTime: 300_000,
  })

  const locMap = useMemo(() =>
    Object.fromEntries(locations.map(l => [l.location_id, l])), [locations])
  const classMap = useMemo(() =>
    Object.fromEntries(classes.map(c => [c.class_id, c])), [classes])
  const sortedClasses = useMemo(() => [...classes].sort((a, b) => a.sort_order - b.sort_order), [classes])
  const sortedLocations = useMemo(() => [...locations].sort((a, b) => a.short_code.localeCompare(b.short_code)), [locations])

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const editMutation = useMutation({
    mutationFn: async ({ vehicle, form }: { vehicle: ApiVehicle; form: Record<string, string> }) => {
      const patch: Record<string, unknown> = {}
      if (form.plate_number !== (vehicle.plate_number ?? '')) patch.plate_number = form.plate_number || null
      if (form.home_location_id !== vehicle.home_location_id) patch.home_location_id = form.home_location_id
      if (Number(form.odometer_current) !== vehicle.odometer_current) patch.odometer_current = Number(form.odometer_current)
      if (form.status !== vehicle.status) patch.status = form.status
      const isPromo = form.is_promo === 'true'
      if (isPromo !== vehicle.is_promo) patch.is_promo = isPromo
      const imageUrl = form.promo_image_url.trim() || null
      if (imageUrl !== vehicle.promo_image_url) patch.promo_image_url = imageUrl
      const promoLabel = form.promo_label.trim() || null
      if (promoLabel !== vehicle.promo_label) patch.promo_label = promoLabel
      if (Object.keys(patch).length === 0) return
      await patchVehicle(vehicle.vehicle_id, patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet-vehicles'] })
      setEditVehicle(null)
      showToast('Vehicle updated', true)
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => createVehicle(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fleet-vehicles'] })
      setShowAdd(false)
      setAddForm({})
      showToast('Vehicle added', true)
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  const active = vehicles.filter(v => v.is_active)
  const counts = {
    total:     active.length,
    available: active.filter(v => v.status === 'AVAILABLE').length,
    onRent:    active.filter(v => v.status === 'ON_RENT').length,
    maint:     active.filter(v => ['MAINTENANCE','DAMAGE_HOLD','ADMIN_HOLD','IN_REPAIR'].includes(v.status)).length,
  }

  const filtered = active.filter(v => {
    if (statusFilter && v.status !== statusFilter) return false
    if (locationFilter && v.home_location_id !== locationFilter) return false
    if (search) {
      const loc = locMap[v.home_location_id]
      const haystack = `${v.plate_number ?? ''} ${v.make} ${v.model} ${v.vin} ${loc?.short_code ?? ''} ${loc?.city ?? ''}`.toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    return true
  })

  function openEdit(v: ApiVehicle) {
    setEditVehicle(v)
    setEditForm({
      plate_number:     v.plate_number ?? '',
      status:           v.status,
      home_location_id: v.home_location_id,
      odometer_current: String(v.odometer_current),
      is_promo:         String(v.is_promo ?? false),
      promo_image_url:  v.promo_image_url ?? '',
      promo_label:      v.promo_label ?? '',
    })
  }

  function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editVehicle) return
    editMutation.mutate({ vehicle: editVehicle, form: editForm })
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const vin = (addForm.vin ?? '').trim()
    if (vin.length !== 17) { showToast('VIN must be exactly 17 characters', false); return }
    addMutation.mutate({
      vin,
      make:             addForm.make,
      model:            addForm.model,
      model_year:       Number(addForm.model_year || new Date().getFullYear()),
      vehicle_class_id: addForm.vehicle_class_id,
      home_location_id: addForm.home_location_id,
      plate_number:     addForm.plate_number || null,
      transmission:     addForm.transmission || 'AUTOMATIC',
      fuel_type:        addForm.fuel_type || 'GASOLINE',
    })
  }

  const efi = (k: string, v: string) => setEditForm(p => ({ ...p, [k]: v }))
  const afi = (k: string, v: string) => setAddForm(p => ({ ...p, [k]: v }))

  function openAdd() {
    setAddForm({
      model_year:       String(new Date().getFullYear()),
      vehicle_class_id: sortedClasses[0]?.class_id ?? '',
      home_location_id: sortedLocations[0]?.location_id ?? '',
      transmission:     'AUTOMATIC',
      fuel_type:        'GASOLINE',
    })
    setShowAdd(true)
  }

  return (
    <div className="space-y-5">
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Fleet</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {loadingV ? 'Loading…' : `${counts.total} vehicles across ${locations.length} location${locations.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button className="btn-primary" onClick={openAdd}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Vehicle
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label:'Total',       value: counts.total,     accent: 'var(--text-1)' },
          { label:'Available',   value: counts.available, accent: '#10b981' },
          { label:'On Rent',     value: counts.onRent,    accent: '#6366f1' },
          { label:'Maintenance', value: counts.maint,     accent: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="panel flex items-baseline gap-3 px-4 py-3.5">
            <span className="text-[1.75rem] font-bold num" style={{ color: s.accent, letterSpacing: '-0.02em' }}>{s.value}</span>
            <span className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {errV && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          Failed to load vehicles. Make sure the API is running.
        </div>
      )}

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="search" placeholder="Search plate, make, model, location…" value={search}
            onChange={e => setSearch(e.target.value)} className="field-input h-9 pl-8 text-[13px]" />
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="field-input h-9 text-[13px] w-auto px-3">
          <option value="">All Statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="field-input h-9 text-[13px] w-auto px-3">
          <option value="">All Locations</option>
          {sortedLocations.map(l => (
            <option key={l.location_id} value={l.location_id}>{l.short_code} — {l.city}</option>
          ))}
        </select>

        {(search || statusFilter || locationFilter) && (
          <button onClick={() => { setSearch(''); setStatusFilter(''); setLocationFilter('') }}
            className="text-[12px] font-medium px-2" style={{ color: 'var(--accent)' }}>
            Clear
          </button>
        )}

        <div className="ml-auto flex rounded-lg p-0.5" style={{ border: '1px solid var(--border)', background: 'var(--elevated)' }}>
          {(['grid', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{ background: view === v ? 'var(--elevated)' : 'transparent', color: view === v ? 'var(--text-1)' : 'var(--text-3)' }}>
              {v === 'grid'
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              }
            </button>
          ))}
        </div>
      </div>

      <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{filtered.length} vehicle{filtered.length !== 1 ? 's' : ''}</p>

      {/* Grid view */}
      {view === 'grid' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(v => {
            const s = getS(v.status)
            const loc = locMap[v.home_location_id]
            const cls = classMap[v.vehicle_class_id]
            return (
              <div key={v.vehicle_id} className="panel cursor-pointer"
                   style={{ transition: 'border-color 100ms' }}
                   onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                   onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
                <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-sub)' }}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>{cls?.name ?? '—'}</span>
                  </div>
                  <span className={s.badge}>{s.label}</span>
                </div>
                <div className="px-4 py-3">
                  <p className="font-semibold text-[14px]" style={{ color: 'var(--text-1)' }}>{v.model_year} {v.make} {v.model}</p>
                  <p className="font-mono text-[11.5px] mt-0.5 tracking-wider" style={{ color: 'var(--text-3)' }}>
                    {v.plate_number ?? 'No plate'}
                  </p>
                  {loc && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{loc.short_code} — {loc.city}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[12px] num" style={{ color: 'var(--text-3)' }}>{v.odometer_current.toLocaleString()} mi</span>
                    <button onClick={() => openEdit(v)} className="btn-secondary px-2.5 py-1 text-[11px]">Edit</button>
                  </div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && !loadingV && (
            <div className="col-span-full py-16 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
              No vehicles match your filters
            </div>
          )}
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="tbl-head">
                <tr>
                  {['Vehicle', 'Plate', 'Class', 'Status', 'Odometer', 'Location', ''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tbl-body">
                {filtered.map(v => {
                  const s = getS(v.status)
                  const loc = locMap[v.home_location_id]
                  const cls = classMap[v.vehicle_class_id]
                  return (
                    <tr key={v.vehicle_id}>
                      <td>
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{v.model_year} {v.make} {v.model}</p>
                        <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{v.vin.trim().slice(-8)}</p>
                      </td>
                      <td className="font-mono text-[12px] font-medium">{v.plate_number ?? '—'}</td>
                      <td>{cls?.name ?? '—'}</td>
                      <td><span className={s.badge}><span className="badge-dot" style={{ background: s.dot }} />{s.label}</span></td>
                      <td className="num">{v.odometer_current.toLocaleString()} mi</td>
                      <td>{loc ? `${loc.short_code} — ${loc.city}` : '—'}</td>
                      <td>
                        <button onClick={() => openEdit(v)} className="btn-secondary px-2.5 py-1 text-[11px]">Edit</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && !loadingV && (
              <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
                No vehicles match your filters
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add Vehicle Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Add Vehicle</h2>
              <button onClick={() => setShowAdd(false)} className="rounded-md p-1.5" style={{ color: 'var(--text-3)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleAdd} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <ModalLabel>Year</ModalLabel>
                  <input required type="number" min="2000" max="2035"
                    value={addForm.model_year ?? ''} onChange={e => afi('model_year', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div className="col-span-2">
                  <ModalLabel>Make</ModalLabel>
                  <input required type="text" placeholder="Toyota"
                    value={addForm.make ?? ''} onChange={e => afi('make', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>

              <div>
                <ModalLabel>Model</ModalLabel>
                <input required type="text" placeholder="Camry"
                  value={addForm.model ?? ''} onChange={e => afi('model', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>

              <div>
                <ModalLabel>VIN <span style={{ fontWeight: 400 }}>(17 characters)</span></ModalLabel>
                <input required type="text" placeholder="1HGBH41JXMN109186" maxLength={17}
                  value={addForm.vin ?? ''} onChange={e => afi('vin', e.target.value.toUpperCase())}
                  className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
                {addForm.vin && addForm.vin.length !== 17 && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--danger)' }}>{addForm.vin.length}/17 characters</p>
                )}
              </div>

              <div>
                <ModalLabel>License Plate <span style={{ fontWeight: 400 }}>(optional)</span></ModalLabel>
                <input type="text" placeholder="ABC-1234"
                  value={addForm.plate_number ?? ''} onChange={e => afi('plate_number', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Class</ModalLabel>
                  <select required value={addForm.vehicle_class_id ?? ''} onChange={e => afi('vehicle_class_id', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    {sortedClasses.map(c => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <ModalLabel>Location</ModalLabel>
                  <select required value={addForm.home_location_id ?? ''} onChange={e => afi('home_location_id', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    {sortedLocations.map(l => <option key={l.location_id} value={l.location_id}>{l.short_code} — {l.city}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Transmission</ModalLabel>
                  <select value={addForm.transmission ?? 'AUTOMATIC'} onChange={e => afi('transmission', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="AUTOMATIC">Automatic</option>
                    <option value="MANUAL">Manual</option>
                    <option value="CVT">CVT</option>
                  </select>
                </div>
                <div>
                  <ModalLabel>Fuel Type</ModalLabel>
                  <select value={addForm.fuel_type ?? 'GASOLINE'} onChange={e => afi('fuel_type', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="GASOLINE">Gasoline</option>
                    <option value="DIESEL">Diesel</option>
                    <option value="HYBRID">Hybrid</option>
                    <option value="BEV">Electric</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={addMutation.isPending}>
                  {addMutation.isPending ? 'Adding…' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Vehicle Modal ── */}
      {editVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setEditVehicle(null) }}>
          <div className="panel w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Vehicle</h2>
                <p className="text-[12px] mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>
                  {editVehicle.model_year} {editVehicle.make} {editVehicle.model}
                </p>
              </div>
              <button onClick={() => setEditVehicle(null)} className="rounded-md p-1.5" style={{ color: 'var(--text-3)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleEdit} className="px-6 py-5 space-y-4">
              <div>
                <ModalLabel>License Plate</ModalLabel>
                <input type="text"
                  value={editForm.plate_number} onChange={e => efi('plate_number', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
              </div>
              <div>
                <ModalLabel>Status</ModalLabel>
                <select value={editForm.status} onChange={e => efi('status', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <ModalLabel>Location</ModalLabel>
                <select value={editForm.home_location_id} onChange={e => efi('home_location_id', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  {sortedLocations.map(l => (
                    <option key={l.location_id} value={l.location_id}>{l.short_code} — {l.city}, {l.state_province}</option>
                  ))}
                </select>
              </div>
              <div>
                <ModalLabel>Odometer (mi)</ModalLabel>
                <input type="number" min="0"
                  value={editForm.odometer_current} onChange={e => efi('odometer_current', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full num" />
              </div>

              {/* Promo section */}
              <div style={{ borderTop: '1px solid var(--border-sub)', paddingTop: 14 }}>
                <p className="text-[11px] font-semibold tracking-wider uppercase mb-3" style={{ color: 'var(--text-3)' }}>
                  Promotional Display
                </p>
                <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editForm.is_promo === 'true'}
                    onChange={e => efi('is_promo', String(e.target.checked))}
                    className="w-4 h-4 accent-red-600"
                  />
                  <span className="text-[13px]" style={{ color: 'var(--text-1)' }}>Feature on homepage</span>
                </label>
                {editForm.is_promo === 'true' && (
                  <>
                    <div className="mb-3">
                      <ModalLabel>Promo Label <span style={{ fontWeight: 400 }}>(badge on image)</span></ModalLabel>
                      <input type="text" placeholder="e.g. Most Requested"
                        value={editForm.promo_label} onChange={e => efi('promo_label', e.target.value)}
                        className="field-input h-9 px-3 text-[13px] w-full" />
                    </div>
                    <div>
                      <ModalLabel>Promo Image URL</ModalLabel>
                      <input type="url" placeholder="https://..."
                        value={editForm.promo_image_url} onChange={e => efi('promo_image_url', e.target.value)}
                        className="field-input h-9 px-3 text-[13px] w-full" />
                      {editForm.promo_image_url && (
                        <img src={editForm.promo_image_url} alt="preview"
                          style={{ marginTop: 8, width: '100%', aspectRatio: '16/9', objectFit: 'cover', border: '1px solid var(--border-sub)' }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setEditVehicle(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" disabled={editMutation.isPending}>
                  {editMutation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
