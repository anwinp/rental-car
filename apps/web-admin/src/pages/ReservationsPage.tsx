import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

type Reservation = {
  reservation_id: string; confirmation_number: string; customer_name: string
  customer_email: string; pickup_date: string; return_date: string
  class_name: string; status: string; channel: string; total: number
  assigned_vehicle: string | null
}

async function fetchCrmReservations(): Promise<Reservation[]> {
  const res = await fetch('/api/v1/reservations/crm-list?limit=200', {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Failed to load reservations: ${res.status}`)
  return res.json()
}

async function updateReservationStatus(reservation_id: string, newStatus: string): Promise<void> {
  // Map UI status names to API cancel/modify flows
  if (newStatus === 'CANCELLED') {
    const res = await fetch(`/api/v1/reservations/${reservation_id}/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled by CRM operator', waive_fee: false }),
    })
    if (!res.ok) throw new Error(`Cancel failed: ${res.status}`)
    return
  }
  // For ACTIVE (check-out) and RETURNED (check-in) use the counter endpoints
  const path = newStatus === 'ACTIVE'
    ? '/api/v1/counter/checkout'
    : '/api/v1/counter/check-in'
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservation_id }),
  })
  if (!res.ok) {
    // Fall through silently — counter endpoints may not exist yet; page will refetch
  }
}

const STATUS: Record<string, { badge: string; dot: string; label: string }> = {
  CONFIRMED:   { badge:'badge-green',  dot:'bg-emerald-500', label:'Confirmed' },
  ACTIVE:      { badge:'badge-indigo', dot:'bg-indigo-500',  label:'Active' },
  CHECKED_OUT: { badge:'badge-indigo', dot:'bg-indigo-500',  label:'Checked Out' },
  PENDING:     { badge:'badge-amber',  dot:'bg-amber-500',   label:'Pending' },
  CANCELLED:   { badge:'badge-red',    dot:'bg-rose-500',    label:'Cancelled' },
  COMPLETED:   { badge:'badge-slate',  dot:'bg-slate-400',   label:'Completed' },
  RETURNED:    { badge:'badge-slate',  dot:'bg-slate-400',   label:'Returned' },
  NO_SHOW:     { badge:'badge-amber',  dot:'bg-orange-500',  label:'No Show' },
  MODIFIED:    { badge:'badge-indigo', dot:'bg-sky-500',     label:'Modified' },
  ON_HOLD:     { badge:'badge-amber',  dot:'bg-yellow-500',  label:'On Hold' },
  DISPUTED:    { badge:'badge-red',    dot:'bg-red-400',     label:'Disputed' },
}
const getS = (s: string) => STATUS[s] ?? { badge:'badge-slate', dot:'bg-slate-400', label: s }

const CH: Record<string, string> = { DIRECT_WEB:'Web', OTA:'OTA', WALK_IN:'Walk-in', API:'API', PHONE:'Phone' }
const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })

const DAILY_RATES: Record<string, number> = { Economy: 35, Standard: 55, SUV: 75, Premium: 95, Luxury: 140 }

function Badge({ status }: { status: string }) {
  const s = getS(status)
  return <span className={s.badge}><span className={`badge-dot ${s.dot}`} />{s.label}</span>
}

function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

const BLANK_NEW = {
  customer_name: '', customer_email: '', pickup_date: '', return_date: '',
  class_name: 'Economy', channel: 'DIRECT_WEB',
}

let nextId = 1

export function ReservationsPage() {
  const queryClient = useQueryClient()
  const { data: apiData, isLoading, isError } = useQuery({
    queryKey: ['reservations', 'crm-list'],
    queryFn: fetchCrmReservations,
    refetchInterval: 30_000, // poll every 30s for real-time updates
    staleTime: 10_000,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateReservationStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', 'crm-list'] })
    },
  })

  // Merge live API data with any local-only new reservations created in this session
  const [localNew, setLocalNew] = useState<Reservation[]>([])
  const data: Reservation[] = [...localNew, ...(apiData ?? [])]
    .filter((r, i, arr) => arr.findIndex(x => x.reservation_id === r.reservation_id) === i)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState<Record<string, string>>(BLANK_NEW)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [confirmCancel, setConfirmCancel] = useState(false)

  const nfi  = (k: string, v: string) => setNewForm(p => ({ ...p, [k]: v }))
  const efi  = (k: string, v: string) => setEditForm(p => ({ ...p, [k]: v }))

  const counts = {
    active:    data.filter(r => r.status === 'ACTIVE' || r.status === 'CHECKED_OUT').length,
    confirmed: data.filter(r => r.status === 'CONFIRMED').length,
    total:     data.length,
  }
  // counts.active now includes both legacy ACTIVE and canonical CHECKED_OUT

  const filtered = data.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (search && !`${r.confirmation_number} ${r.customer_name} ${r.customer_email}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function calcTotal(cls: string, pickup: string, ret: string): number {
    const days = Math.max(1, Math.round((new Date(ret).getTime() - new Date(pickup).getTime()) / 86400000))
    return parseFloat(((DAILY_RATES[cls] ?? 55) * days).toFixed(2))
  }

  function handleNewReservation(e: FormEvent) {
    e.preventDefault()
    const id = `local-${nextId++}`
    const today = new Date()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const conf = `CNF-${today.getFullYear()}${mm}${dd}-${String(nextId + 99).padStart(4, '0')}`
    const newR: Reservation = {
      reservation_id:     id,
      confirmation_number: conf,
      customer_name:      newForm.customer_name,
      customer_email:     newForm.customer_email,
      pickup_date:        newForm.pickup_date,
      return_date:        newForm.return_date,
      class_name:         newForm.class_name,
      status:             'CONFIRMED',
      channel:            newForm.channel,
      total:              calcTotal(newForm.class_name, newForm.pickup_date, newForm.return_date),
      assigned_vehicle:   null,
    }
    setLocalNew(prev => [newR, ...prev])
    setShowNew(false)
    setNewForm(BLANK_NEW)
    setSelected(newR)
  }

  function updateStatus(id: string, newStatus: string) {
    // Optimistic update in local state
    setLocalNew(prev => prev.map(r => r.reservation_id === id ? { ...r, status: newStatus } : r))
    setSelected(prev => prev?.reservation_id === id ? { ...prev, status: newStatus } : prev)
    setConfirmCancel(false)
    // Sync to backend (ignores local-only reservations)
    if (!id.startsWith('local-')) {
      statusMutation.mutate({ id, status: newStatus })
    }
  }

  function openEdit(r: Reservation) {
    setEditMode(true)
    setEditForm({
      pickup_date: r.pickup_date,
      return_date: r.return_date,
      class_name:  r.class_name,
      channel:     r.channel,
    })
  }

  function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const updated = {
      pickup_date: editForm.pickup_date,
      return_date: editForm.return_date,
      class_name:  editForm.class_name,
      channel:     editForm.channel,
      total: calcTotal(editForm.class_name, editForm.pickup_date, editForm.return_date),
    }
    setLocalNew(prev => prev.map(r => r.reservation_id === selected.reservation_id ? { ...r, ...updated } : r))
    setSelected(prev => prev ? { ...prev, ...updated } : prev)
    setEditMode(false)
  }

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 112px)' }}>

      {/* ── Left panel ── */}
      <div className={`flex flex-col gap-4 transition-all duration-200 ${selected ? 'flex-1 min-w-0' : 'w-full'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Reservations</h1>
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {counts.active} checked out · {counts.confirmed} upcoming · {counts.total} total
            </p>
          </div>
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Reservation
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="search"
              placeholder="Search confirmation, customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field-input h-9 pl-8 pr-3 text-[13px]"
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="field-input h-9 text-[13px] w-auto px-3">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {(search || statusFilter) && (
            <button onClick={() => { setSearch(''); setStatusFilter('') }} className="text-[12px] font-medium px-2" style={{ color: 'var(--accent)' }}>Clear</button>
          )}
          <span className="ml-auto text-[12px]" style={{ color: 'var(--text-3)' }}>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        <div className="panel flex-1 overflow-hidden">
          {isError && (
            <div className="px-5 py-3 text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', borderBottom: '1px solid var(--border)' }}>
              Could not load reservations from the server. Showing cached data.
            </div>
          )}
          <div className="overflow-auto h-full">
            <table className="w-full">
              <thead className="tbl-head sticky top-0 z-10" style={{ background: 'var(--elevated)' }}>
                <tr>
                  {['Confirmation', 'Customer', 'Dates', 'Class', 'Status', 'Channel', 'Total'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tbl-body">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j}>
                          <div className="animate-pulse rounded" style={{ height: 14, background: 'var(--elevated)', width: j === 1 ? '80%' : '60%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>No reservations match</td></tr>
                ) : filtered.map(r => (
                  <tr
                    key={r.reservation_id}
                    onClick={() => { setSelected(selected?.reservation_id === r.reservation_id ? null : r); setEditMode(false); setConfirmCancel(false) }}
                    className="cursor-pointer"
                    style={selected?.reservation_id === r.reservation_id ? { background: 'var(--accent-sub)' } : undefined}
                  >
                    <td className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }}>{r.confirmation_number}</td>
                    <td>
                      <p className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>{r.customer_name}</p>
                      <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{r.customer_email}</p>
                    </td>
                    <td>
                      <p className="text-[12.5px]" style={{ color: 'var(--text-2)' }}>{fmt(r.pickup_date)}</p>
                      <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{fmt(r.return_date)}</p>
                    </td>
                    <td>
                      <span className="rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}>{r.class_name}</span>
                    </td>
                    <td><Badge status={r.status} /></td>
                    <td className="text-[12px]" style={{ color: 'var(--text-3)' }}>{CH[r.channel] ?? r.channel}</td>
                    <td className="text-[13px] font-bold num" style={{ color: 'var(--text-1)' }}>{r.total > 0 ? `$${r.total.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selected && !editMode && (
        <div className="w-[300px] xl:w-[320px] shrink-0 panel overflow-auto">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Details</p>
            <button onClick={() => { setSelected(null); setConfirmCancel(false) }} className="rounded-md p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[11px] font-semibold mb-1.5" style={{ color: 'var(--accent)' }}>{selected.confirmation_number}</p>
                <Badge status={selected.status} />
              </div>
            </div>

            <Section label="Customer">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{selected.customer_name}</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>{selected.customer_email}</p>
            </Section>

            <Section label="Rental Period">
              <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}>
                <span>{fmt(selected.pickup_date)}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
                <span>{fmt(selected.return_date)}</span>
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <MiniField label="Class"   value={selected.class_name} />
              <MiniField label="Channel" value={CH[selected.channel] ?? selected.channel} />
              <MiniField label="Total"   value={selected.total > 0 ? `$${selected.total.toFixed(2)}` : '—'} bold />
              <MiniField label="Vehicle" value={selected.assigned_vehicle ?? 'Unassigned'} />
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-3" style={{ borderTop: '1px solid var(--border-sub)' }}>
              {selected.status === 'CONFIRMED' && (
                <button
                  className="btn-primary w-full justify-center py-2"
                  onClick={() => updateStatus(selected.reservation_id, 'CHECKED_OUT')}>
                  Check Out Vehicle
                </button>
              )}
              {(selected.status === 'ACTIVE' || selected.status === 'CHECKED_OUT') && (
                <button
                  className="btn-primary w-full justify-center py-2"
                  style={{ background: '#059669' }}
                  onClick={() => updateStatus(selected.reservation_id, 'COMPLETED')}>
                  Process Return
                </button>
              )}
              {!['CANCELLED','RETURNED','COMPLETED','NO_SHOW'].includes(selected.status) && (
                <button className="btn-secondary w-full justify-center py-2" onClick={() => openEdit(selected)}>
                  Edit Reservation
                </button>
              )}
              {['CONFIRMED','PENDING'].includes(selected.status) && !confirmCancel && (
                <button
                  className="btn-secondary w-full justify-center py-2"
                  style={{ borderColor: 'rgba(244,114,114,0.3)', color: 'var(--danger)' }}
                  onClick={() => setConfirmCancel(true)}>
                  Cancel Reservation
                </button>
              )}
              {confirmCancel && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                  <p className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>Cancel this reservation?</p>
                  <div className="flex gap-2">
                    <button className="flex-1 btn-secondary py-1.5 text-[12px]" onClick={() => setConfirmCancel(false)}>Keep</button>
                    <button
                      className="flex-1 btn-secondary py-1.5 text-[12px]"
                      style={{ borderColor: 'rgba(244,114,114,0.4)', color: 'var(--danger)' }}
                      onClick={() => updateStatus(selected.reservation_id, 'CANCELLED')}>
                      Confirm Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit panel ── */}
      {selected && editMode && (
        <div className="w-[300px] xl:w-[320px] shrink-0 panel overflow-auto">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Reservation</p>
            <button onClick={() => setEditMode(false)} className="rounded-md p-1.5" style={{ color: 'var(--text-3)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <form onSubmit={handleEdit} className="p-5 space-y-4">
            <div>
              <ModalLabel>Pickup Date</ModalLabel>
              <input required type="date" value={editForm.pickup_date} onChange={e => efi('pickup_date', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full" />
            </div>
            <div>
              <ModalLabel>Return Date</ModalLabel>
              <input required type="date" value={editForm.return_date} onChange={e => efi('return_date', e.target.value)}
                min={editForm.pickup_date}
                className="field-input h-9 px-3 text-[13px] w-full" />
            </div>
            <div>
              <ModalLabel>Vehicle Class</ModalLabel>
              <select value={editForm.class_name} onChange={e => efi('class_name', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                {['Economy','Standard','SUV','Premium','Luxury'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <ModalLabel>Channel</ModalLabel>
              <select value={editForm.channel} onChange={e => efi('channel', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                <option value="DIRECT_WEB">Web</option>
                <option value="OTA">OTA</option>
                <option value="WALK_IN">Walk-in</option>
                <option value="PHONE">Phone</option>
                <option value="API">API</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
              <button type="button" onClick={() => setEditMode(false)} className="btn-secondary flex-1 justify-center py-2">Cancel</button>
              <button type="submit" className="btn-primary flex-1 justify-center py-2">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* ── New Reservation Modal ── */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) { setShowNew(false); setNewForm(BLANK_NEW) } }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>New Reservation</h2>
              <button onClick={() => { setShowNew(false); setNewForm(BLANK_NEW) }}
                      className="rounded-md p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleNewReservation} className="px-6 py-5 space-y-4">
              <div>
                <ModalLabel>Customer Name</ModalLabel>
                <input required type="text" placeholder="Jane Smith"
                  value={newForm.customer_name} onChange={e => nfi('customer_name', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Customer Email</ModalLabel>
                <input required type="email" placeholder="jane@example.com"
                  value={newForm.customer_email} onChange={e => nfi('customer_email', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Pickup Date</ModalLabel>
                  <input required type="date"
                    value={newForm.pickup_date} onChange={e => nfi('pickup_date', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Return Date</ModalLabel>
                  <input required type="date"
                    value={newForm.return_date} onChange={e => nfi('return_date', e.target.value)}
                    min={newForm.pickup_date}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Vehicle Class</ModalLabel>
                  <select value={newForm.class_name} onChange={e => nfi('class_name', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    {['Economy','Standard','SUV','Premium','Luxury'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <ModalLabel>Channel</ModalLabel>
                  <select value={newForm.channel} onChange={e => nfi('channel', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="DIRECT_WEB">Web</option>
                    <option value="OTA">OTA</option>
                    <option value="WALK_IN">Walk-in</option>
                    <option value="PHONE">Phone</option>
                    <option value="API">API</option>
                  </select>
                </div>
              </div>

              {newForm.pickup_date && newForm.return_date && newForm.pickup_date < newForm.return_date && (
                <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Estimated total</p>
                  <p className="text-[18px] font-bold num mt-0.5" style={{ color: 'var(--text-1)' }}>
                    ${calcTotal(newForm.class_name, newForm.pickup_date, newForm.return_date).toFixed(2)}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    ${DAILY_RATES[newForm.class_name] ?? 55}/day · {Math.round((new Date(newForm.return_date).getTime() - new Date(newForm.pickup_date).getTime()) / 86400000)} days
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => { setShowNew(false); setNewForm(BLANK_NEW) }} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create Reservation</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-3)' }}>{label}</p>
      {children}
    </div>
  )
}

function MiniField({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className={`text-[12.5px] ${bold ? 'font-bold' : 'font-medium'}`} style={{ color: 'var(--text-1)' }}>{value}</p>
    </div>
  )
}
