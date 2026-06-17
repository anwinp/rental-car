import { useState, type FormEvent } from 'react'

type Vehicle = {
  vehicle_id: string; plate: string; vin: string; make: string; model: string
  year: number; class_code: string; class_name: string; status: string
  location_id: string; location_name: string; odometer: number; last_service: string | null
}

const INIT_VEHICLES: Vehicle[] = [
  { vehicle_id:'1',  plate:'ABC-1234', vin:'1HGBH41JXMN109186', make:'Honda',      model:'Civic',         year:2023, class_code:'EC', class_name:'Economy',  status:'AVAILABLE',   location_id:'loc-1', location_name:'Downtown', odometer:12340,  last_service:'2026-04-10' },
  { vehicle_id:'2',  plate:'XYZ-5678', vin:'2T1BURHE0JC034985', make:'Toyota',     model:'Corolla',       year:2022, class_code:'EC', class_name:'Economy',  status:'ON_RENT',     location_id:'loc-1', location_name:'Downtown', odometer:28510,  last_service:'2026-03-20' },
  { vehicle_id:'3',  plate:'DEF-9012', vin:'1GNEC13Z33R138596', make:'Chevrolet',  model:'Equinox',       year:2023, class_code:'SV', class_name:'SUV',      status:'MAINTENANCE', location_id:'loc-2', location_name:'Airport',  odometer:45200,  last_service:'2026-01-15' },
  { vehicle_id:'4',  plate:'GHI-3456', vin:'4T1BF1FK0HU671325', make:'Toyota',     model:'Camry',         year:2024, class_code:'ST', class_name:'Standard', status:'AVAILABLE',   location_id:'loc-2', location_name:'Airport',  odometer:8900,   last_service:'2026-05-01' },
  { vehicle_id:'5',  plate:'JKL-7890', vin:'1FMCU0GD3GUC25196', make:'Ford',       model:'Explorer',      year:2023, class_code:'SV', class_name:'SUV',      status:'DAMAGE_HOLD', location_id:'loc-1', location_name:'Downtown', odometer:67340,  last_service:'2025-12-01' },
  { vehicle_id:'6',  plate:'MNO-1234', vin:'1G1ZD5ST7JF102345', make:'Chevrolet',  model:'Malibu',        year:2022, class_code:'ST', class_name:'Standard', status:'ON_RENT',     location_id:'loc-3', location_name:'Midtown',  odometer:34120,  last_service:'2026-02-28' },
  { vehicle_id:'7',  plate:'PQR-5678', vin:'2HGFC2F59JH543210', make:'Honda',      model:'Accord',        year:2023, class_code:'ST', class_name:'Standard', status:'CLEANING',    location_id:'loc-2', location_name:'Airport',  odometer:19800,  last_service:'2026-04-22' },
  { vehicle_id:'8',  plate:'STU-9012', vin:'1N4BL4EW0KC123456', make:'Nissan',     model:'Altima',        year:2024, class_code:'ST', class_name:'Standard', status:'AVAILABLE',   location_id:'loc-3', location_name:'Midtown',  odometer:5200,   last_service:'2026-05-15' },
  { vehicle_id:'9',  plate:'VWX-3456', vin:'5YJSA1E26MF123456', make:'Tesla',      model:'Model 3',       year:2024, class_code:'PR', class_name:'Premium',  status:'ON_RENT',     location_id:'loc-1', location_name:'Downtown', odometer:22100,  last_service:'2026-03-10' },
  { vehicle_id:'10', plate:'YZA-7890', vin:'1C4RJFBG3KC654321', make:'Jeep',       model:'Grand Cherokee',year:2022, class_code:'SV', class_name:'SUV',      status:'AVAILABLE',   location_id:'loc-2', location_name:'Airport',  odometer:51000,  last_service:'2026-01-30' },
  { vehicle_id:'11', plate:'BCD-1234', vin:'3VW217AT0JM123456', make:'Volkswagen', model:'Jetta',         year:2023, class_code:'EC', class_name:'Economy',  status:'MAINTENANCE', location_id:'loc-3', location_name:'Midtown',  odometer:38500,  last_service:'2025-11-20' },
  { vehicle_id:'12', plate:'EFG-5678', vin:'WBA5A5C51ED654321', make:'BMW',        model:'3 Series',      year:2024, class_code:'LX', class_name:'Luxury',   status:'AVAILABLE',   location_id:'loc-1', location_name:'Downtown', odometer:14200,  last_service:'2026-04-05' },
]

const CLASS_MAP: Record<string, string> = { EC:'Economy', ST:'Standard', SV:'SUV', PR:'Premium', LX:'Luxury' }
const LOC_MAP:   Record<string, string> = { 'loc-1':'Downtown', 'loc-2':'Airport', 'loc-3':'Midtown' }

type StatusCfg = { label: string; badge: string; dot: string; color: string }

const STATUS: Record<string, StatusCfg> = {
  AVAILABLE:   { label:'Available',   badge:'badge-green',  dot:'#10b981', color:'#10b981' },
  ON_RENT:     { label:'On Rent',     badge:'badge-indigo', dot:'#6366f1', color:'#6366f1' },
  MAINTENANCE: { label:'Maintenance', badge:'badge-amber',  dot:'#f59e0b', color:'#f59e0b' },
  DAMAGE_HOLD: { label:'Damage Hold', badge:'badge-red',    dot:'#ef4444', color:'#ef4444' },
  CLEANING:    { label:'Cleaning',    badge:'badge-sky',    dot:'#0ea5e9', color:'#0ea5e9' },
  ADMIN_HOLD:  { label:'Admin Hold',  badge:'badge-slate',  dot:'#94a3b8', color:'#94a3b8' },
  STAGING:     { label:'Staging',     badge:'badge-purple', dot:'#8b5cf6', color:'#8b5cf6' },
}
const getS = (s: string): StatusCfg => STATUS[s] ?? { label: s, badge:'badge-slate', dot:'#94a3b8', color:'#94a3b8' }

const BLANK: Record<string, string> = {
  year: String(new Date().getFullYear()), make:'', model:'',
  plate:'', vin:'', class_code:'EC', location_id:'loc-1', status:'AVAILABLE',
}

function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

export function FleetPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>(INIT_VEHICLES)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string, string>>(BLANK)
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})

  const fi  = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const efi = (k: string, v: string) => setEditForm(p => ({ ...p, [k]: v }))

  const counts = {
    total:     vehicles.length,
    available: vehicles.filter(v => v.status === 'AVAILABLE').length,
    onRent:    vehicles.filter(v => v.status === 'ON_RENT').length,
    maint:     vehicles.filter(v => ['MAINTENANCE','DAMAGE_HOLD','ADMIN_HOLD'].includes(v.status)).length,
  }

  const filtered = vehicles.filter(v => {
    if (statusFilter && v.status !== statusFilter) return false
    if (locationFilter && v.location_id !== locationFilter) return false
    if (search && !`${v.plate} ${v.make} ${v.model} ${v.vin}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const newV: Vehicle = {
      vehicle_id:    String(Date.now()),
      plate:         form.plate.toUpperCase(),
      vin:           form.vin || `VIN${Date.now()}`,
      make:          form.make,
      model:         form.model,
      year:          Number(form.year),
      class_code:    form.class_code,
      class_name:    CLASS_MAP[form.class_code] ?? form.class_code,
      status:        form.status,
      location_id:   form.location_id,
      location_name: LOC_MAP[form.location_id] ?? 'Unknown',
      odometer:      0,
      last_service:  null,
    }
    setVehicles(prev => [newV, ...prev])
    setShowAdd(false)
    setForm(BLANK)
  }

  function openEdit(v: Vehicle) {
    setEditVehicle(v)
    setEditForm({
      plate:       v.plate,
      status:      v.status,
      location_id: v.location_id,
      odometer:    String(v.odometer),
    })
  }

  function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!editVehicle) return
    setVehicles(prev => prev.map(v =>
      v.vehicle_id === editVehicle.vehicle_id
        ? { ...v,
            plate:         editForm.plate.toUpperCase(),
            status:        editForm.status,
            location_id:   editForm.location_id,
            location_name: LOC_MAP[editForm.location_id] ?? 'Unknown',
            odometer:      Number(editForm.odometer),
          }
        : v
    ))
    setEditVehicle(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Fleet</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>{counts.total} vehicles across 3 locations</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
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

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="search" placeholder="Search plate, make, model…" value={search}
            onChange={e => setSearch(e.target.value)} className="field-input h-9 pl-8 text-[13px]" />
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="field-input h-9 text-[13px] w-auto px-3">
          <option value="">All Statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} className="field-input h-9 text-[13px] w-auto px-3">
          <option value="">All Locations</option>
          <option value="loc-1">Downtown</option>
          <option value="loc-2">Airport</option>
          <option value="loc-3">Midtown</option>
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
            return (
              <div key={v.vehicle_id} className="panel cursor-pointer"
                   style={{ transition: 'border-color 100ms' }}
                   onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                   onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
                <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border-sub)' }}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>{v.class_name}</span>
                  </div>
                  <span className={s.badge}>{s.label}</span>
                </div>
                <div className="px-4 py-3">
                  <p className="font-semibold text-[14px]" style={{ color: 'var(--text-1)' }}>{v.year} {v.make} {v.model}</p>
                  <p className="font-mono text-[11.5px] mt-0.5 tracking-wider" style={{ color: 'var(--text-3)' }}>{v.plate}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[12px] num" style={{ color: 'var(--text-3)' }}>{v.odometer.toLocaleString()} mi</span>
                    <button
                      onClick={() => openEdit(v)}
                      className="btn-secondary px-2.5 py-1 text-[11px]">
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-full py-16 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>No vehicles match your filters</div>
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
                  {['Vehicle', 'Plate', 'Class', 'Status', 'Odometer', 'Location', 'Last Service', ''].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tbl-body">
                {filtered.map(v => {
                  const s = getS(v.status)
                  return (
                    <tr key={v.vehicle_id}>
                      <td>
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{v.year} {v.make} {v.model}</p>
                        <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>{v.vin.slice(-8)}</p>
                      </td>
                      <td className="font-mono text-[12px] font-medium">{v.plate}</td>
                      <td>{v.class_name}</td>
                      <td><span className={s.badge}><span className="badge-dot" style={{ background: s.dot }} />{s.label}</span></td>
                      <td className="num">{v.odometer.toLocaleString()} mi</td>
                      <td>{v.location_name}</td>
                      <td>{v.last_service ? new Date(v.last_service).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '—'}</td>
                      <td>
                        <button onClick={() => openEdit(v)} className="btn-secondary px-2.5 py-1 text-[11px]">Edit</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>No vehicles match your filters</div>
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
              <button onClick={() => setShowAdd(false)} className="rounded-md p-1.5 transition-colors"
                      style={{ color: 'var(--text-3)' }}
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
                    value={form.year} onChange={e => fi('year', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div className="col-span-2">
                  <ModalLabel>Make</ModalLabel>
                  <input required type="text" placeholder="Toyota"
                    value={form.make} onChange={e => fi('make', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>

              <div>
                <ModalLabel>Model</ModalLabel>
                <input required type="text" placeholder="Camry"
                  value={form.model} onChange={e => fi('model', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>License Plate</ModalLabel>
                  <input required type="text" placeholder="ABC-1234"
                    value={form.plate} onChange={e => fi('plate', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
                </div>
                <div>
                  <ModalLabel>VIN <span style={{ fontWeight: 400 }}>(optional)</span></ModalLabel>
                  <input type="text" placeholder="1HGBH41J…"
                    value={form.vin} onChange={e => fi('vin', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full font-mono" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <ModalLabel>Class</ModalLabel>
                  <select value={form.class_code} onChange={e => fi('class_code', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="EC">Economy</option>
                    <option value="ST">Standard</option>
                    <option value="SV">SUV</option>
                    <option value="PR">Premium</option>
                    <option value="LX">Luxury</option>
                  </select>
                </div>
                <div>
                  <ModalLabel>Location</ModalLabel>
                  <select value={form.location_id} onChange={e => fi('location_id', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="loc-1">Downtown</option>
                    <option value="loc-2">Airport</option>
                    <option value="loc-3">Midtown</option>
                  </select>
                </div>
                <div>
                  <ModalLabel>Status</ModalLabel>
                  <select value={form.status} onChange={e => fi('status', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="AVAILABLE">Available</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="STAGING">Staging</option>
                    <option value="ADMIN_HOLD">Admin Hold</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => { setShowAdd(false); setForm(BLANK) }} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Add Vehicle</button>
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
                <p className="text-[12px] mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>{editVehicle.year} {editVehicle.make} {editVehicle.model}</p>
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
                <input required type="text"
                  value={editForm.plate} onChange={e => efi('plate', e.target.value)}
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
                <select value={editForm.location_id} onChange={e => efi('location_id', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="loc-1">Downtown</option>
                  <option value="loc-2">Airport</option>
                  <option value="loc-3">Midtown</option>
                </select>
              </div>
              <div>
                <ModalLabel>Odometer (mi)</ModalLabel>
                <input type="number" min="0"
                  value={editForm.odometer} onChange={e => efi('odometer', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full num" />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setEditVehicle(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
