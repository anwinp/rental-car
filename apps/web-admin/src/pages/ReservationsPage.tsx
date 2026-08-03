import { tenantHeaders } from '../tenant'
import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { describeApiError } from '../apiError'


type Reservation = {
  reservation_id: string; confirmation_number: string; customer_name: string
  customer_email: string; pickup_date: string; return_date: string
  class_name: string; status: string; channel: string; total: number
  assigned_vehicle: string | null
}

type VehicleClass = { class_id: string; name: string }

type Location = { location_id: string; short_code: string; name: string; city: string; state_province: string }

type CancellationPreview = {
  reservation_id: string
  hours_until_pickup: string
  refund_amount: string
  cancellation_fee: string
  policy_tier: string
  deposit_paid: string
}

async function fetchCrmReservations(): Promise<Reservation[]> {
  const res = await fetch('/api/v1/reservations/crm-list?limit=200', {
    credentials: 'include',
    headers: tenantHeaders(),
  })
  if (!res.ok) throw new Error(`Failed to load reservations: ${res.status}`)
  return res.json()
}

async function fetchVehicleClasses(): Promise<VehicleClass[]> {
  const res = await fetch('/api/v1/fleet/classes', {
    credentials: 'include',
    headers: tenantHeaders(),
  })
  if (!res.ok) return []
  return res.json()
}

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations', {
    credentials: 'include',
    headers: tenantHeaders(),
  })
  if (!res.ok) return []
  return res.json()
}

async function fetchCancellationPreview(reservationId: string): Promise<CancellationPreview> {
  const res = await fetch(`/api/v1/reservations/${reservationId}/cancellation-preview`, {
    credentials: 'include',
    headers: tenantHeaders(),
  })
  if (!res.ok) throw new Error('Could not load cancellation preview')
  return res.json()
}

async function cancelReservation(reservationId: string, reason: string, waiveFee: boolean): Promise<void> {
  const res = await fetch(`/api/v1/reservations/${reservationId}/cancel`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ reason, waive_fee: waiveFee }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(describeApiError(e, res.status))
  }
}

async function modifyReservation(
  reservationId: string,
  payload: {
    pickup_dt?: string
    dropoff_dt?: string
    vehicle_class_id?: string
    change_reason?: string
  }
): Promise<void> {
  const res = await fetch(`/api/v1/reservations/${reservationId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(describeApiError(e, res.status))
  }
}

async function updateReservationStatus(reservation_id: string, newStatus: string): Promise<void> {
  if (newStatus === 'CANCELLED') {
    const res = await fetch(`/api/v1/reservations/${reservation_id}/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
      body: JSON.stringify({ reason: 'Cancelled by CRM operator', waive_fee: false }),
    })
    if (!res.ok) throw new Error(`Cancel failed: ${res.status}`)
    return
  }
  // These pointed at /api/v1/counter/*, which is not mounted — every call 404'd
  // and the failure was swallowed below with a comment guessing the endpoints
  // might not exist yet. They do; the prefix is /checkout.
  //
  // The swallowing mattered more than the wrong path: a check-out that silently
  // fails leaves the reservation, the vehicle and the deposit disagreeing about
  // whether the car has left, with nothing shown to the operator.
  const path = newStatus === 'ACTIVE'
    ? '/api/v1/checkout/checkout'
    : '/api/v1/checkout/check-in'
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ reservation_id }),
  })
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* keep the status */
    }
    throw new Error(detail)
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

const CH: Record<string, string> = { DIRECT_WEB:'Web', OTA:'OTA', WALK_IN:'Walk-in', API:'API', PHONE:'Phone', CALL_CENTER:'Call Center', COUNTER:'Counter', WALK_UP:'Walk-up', MOBILE_APP:'Mobile', GDS:'GDS', KIOSK:'Kiosk' }
const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })

const DAILY_RATES: Record<string, number> = { Economy: 35, Standard: 55, SUV: 75, Premium: 95, Luxury: 140 }

const CANCEL_REASONS = [
  { value: 'CUSTOMER_REQUEST', label: 'Customer Request' },
  { value: 'AGENT_ERROR', label: 'Agent Error' },
  { value: 'NO_VEHICLE_AVAILABLE', label: 'No Vehicle Available' },
  { value: 'OTHER', label: 'Other' },
]

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

function isNoShowEligible(r: Reservation): boolean {
  if (r.status !== 'CONFIRMED' && r.status !== 'PENDING') return false
  const pickupMs = new Date(r.pickup_date).getTime()
  // Only eligible once pickup time is more than 2 hours in the past
  return pickupMs < Date.now() - 2 * 60 * 60 * 1000
}

function policyTierLabel(tier: string): string {
  if (tier === 'FULL_REFUND') return 'Full refund'
  if (tier === 'PARTIAL_REFUND') return 'Partial refund'
  if (tier === 'NO_REFUND') return 'No refund'
  return tier
}

export function ReservationsPage() {
  const queryClient = useQueryClient()
  const { data: apiData, isLoading, isError } = useQuery({
    queryKey: ['reservations', 'crm-list'],
    queryFn: fetchCrmReservations,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const { data: vehicleClasses = [] } = useQuery<VehicleClass[]>({
    queryKey: ['fleet-classes'],
    queryFn: fetchVehicleClasses,
    staleTime: 300_000,
  })

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 300_000,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateReservationStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', 'crm-list'] })
    },
  })

  const [localNew, setLocalNew] = useState<Reservation[]>([])
  const data: Reservation[] = [...localNew, ...(apiData ?? [])]
    .filter((r, i, arr) => arr.findIndex(x => x.reservation_id === r.reservation_id) === i)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState<Record<string, string>>(BLANK_NEW)

  // ── Modify drawer state ──────────────────────────────────────────────────────
  const [showModify, setShowModify] = useState(false)
  const [modifyForm, setModifyForm] = useState({
    pickup_date: '', pickup_time: '10:00',
    return_date: '', return_time: '10:00',
    vehicle_class_id: '', change_reason: '',
  })
  const [modifyError, setModifyError] = useState('')
  const [modifySuccess, setModifySuccess] = useState(false)

  const modifyMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: typeof modifyForm }) => {
      const payload: Record<string, string> = {}
      if (form.pickup_date) payload.pickup_dt = `${form.pickup_date}T${form.pickup_time}:00+00:00`
      if (form.return_date) payload.dropoff_dt = `${form.return_date}T${form.return_time}:00+00:00`
      if (form.vehicle_class_id) payload.vehicle_class_id = form.vehicle_class_id
      if (form.change_reason) payload.change_reason = form.change_reason
      await modifyReservation(id, payload)
    },
    onSuccess: () => {
      setModifySuccess(true)
      queryClient.invalidateQueries({ queryKey: ['reservations', 'crm-list'] })
      setTimeout(() => {
        setShowModify(false)
        setModifySuccess(false)
        setModifyError('')
      }, 1500)
    },
    onError: (e: Error) => setModifyError(e.message),
  })

  function openModify(r: Reservation) {
    setModifyForm({
      pickup_date: r.pickup_date,
      pickup_time: '10:00',
      return_date: r.return_date,
      return_time: '10:00',
      vehicle_class_id: '',
      change_reason: '',
    })
    setModifyError('')
    setModifySuccess(false)
    setShowModify(true)
  }

  function handleModify(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    if (selected.reservation_id.startsWith('local-')) {
      const updated = {
        pickup_date: modifyForm.pickup_date,
        return_date: modifyForm.return_date,
        total: calcTotal(selected.class_name, modifyForm.pickup_date, modifyForm.return_date),
      }
      setLocalNew(prev => prev.map(r => r.reservation_id === selected.reservation_id ? { ...r, ...updated } : r))
      setSelected(prev => prev ? { ...prev, ...updated } : prev)
      setShowModify(false)
      return
    }
    modifyMutation.mutate({ id: selected.reservation_id, form: modifyForm })
  }

  const modifyDays = modifyForm.pickup_date && modifyForm.return_date
    ? Math.max(0, Math.round((new Date(modifyForm.return_date).getTime() - new Date(modifyForm.pickup_date).getTime()) / 86400000))
    : null

  // ── No-show action ───────────────────────────────────────────────────────────
  const [confirmNoShow, setConfirmNoShow] = useState(false)

  // ── Cancel modal state ───────────────────────────────────────────────────────
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('CUSTOMER_REQUEST')
  const [cancelReasonOther, setCancelReasonOther] = useState('')
  const [cancelWaiveFee, setCancelWaiveFee] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const { data: cancelPreview, isLoading: previewLoading } = useQuery<CancellationPreview>({
    queryKey: ['cancel-preview', selected?.reservation_id],
    queryFn: () => fetchCancellationPreview(selected!.reservation_id),
    enabled: (showCancel || confirmNoShow) && !!selected && !selected.reservation_id.startsWith('local-'),
    staleTime: 30_000,
  })

  const cancelMutation = useMutation({
    mutationFn: async ({ id, reason, waiveFee }: { id: string; reason: string; waiveFee: boolean }) => {
      await cancelReservation(id, reason, waiveFee)
    },
    onSuccess: () => {
      setShowCancel(false)
      setCancelReason('CUSTOMER_REQUEST')
      setCancelReasonOther('')
      setCancelError('')
      setSelected(prev => prev ? { ...prev, status: 'CANCELLED' } : prev)
      setLocalNew(prev => prev.map(r => r.reservation_id === selected?.reservation_id ? { ...r, status: 'CANCELLED' } : r))
      queryClient.invalidateQueries({ queryKey: ['reservations', 'crm-list'] })
      showToast('Reservation cancelled successfully', true)
    },
    onError: (e: Error) => setCancelError(e.message),
  })

  function openCancel() {
    setCancelReason('CUSTOMER_REQUEST')
    setCancelReasonOther('')
    setCancelWaiveFee(false)
    setCancelError('')
    setShowCancel(true)
  }

  function handleCancel(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const reason = cancelReason === 'OTHER'
      ? `OTHER - ${cancelReasonOther.trim()}`
      : cancelReason
    if (selected.reservation_id.startsWith('local-')) {
      setLocalNew(prev => prev.map(r => r.reservation_id === selected.reservation_id ? { ...r, status: 'CANCELLED' } : r))
      setSelected(prev => prev ? { ...prev, status: 'CANCELLED' } : prev)
      setShowCancel(false)
      showToast('Reservation cancelled', true)
      return
    }
    cancelMutation.mutate({ id: selected.reservation_id, reason, waiveFee: cancelWaiveFee })
  }

  const noShowMutation = useMutation({
    mutationFn: async (id: string) => {
      await cancelReservation(id, 'NO_SHOW - Customer failed to appear for pickup', false)
    },
    onSuccess: () => {
      setConfirmNoShow(false)
      setSelected(prev => prev ? { ...prev, status: 'NO_SHOW' } : prev)
      setLocalNew(prev => prev.map(r => r.reservation_id === selected?.reservation_id ? { ...r, status: 'NO_SHOW' } : r))
      queryClient.invalidateQueries({ queryKey: ['reservations', 'crm-list'] })
      showToast('Reservation marked as no-show', true)
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  // ── Toast ────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  // ── New reservation form (unchanged) ─────────────────────────────────────────
  const nfi = (k: string, v: string) => setNewForm(p => ({ ...p, [k]: v }))

  const counts = {
    active:    data.filter(r => r.status === 'ACTIVE' || r.status === 'CHECKED_OUT').length,
    confirmed: data.filter(r => r.status === 'CONFIRMED').length,
    total:     data.length,
  }

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
    setLocalNew(prev => prev.map(r => r.reservation_id === id ? { ...r, status: newStatus } : r))
    setSelected(prev => prev?.reservation_id === id ? { ...prev, status: newStatus } : prev)
    if (!id.startsWith('local-')) {
      statusMutation.mutate({ id, status: newStatus })
    }
  }

  const canModify = (r: Reservation) => ['CONFIRMED', 'PENDING', 'MODIFIED'].includes(r.status)
  const canCancel = (r: Reservation) => ['CONFIRMED', 'PENDING'].includes(r.status)

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 112px)' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: toast.ok ? 'rgba(16,185,129,0.15)' : 'var(--danger-bg)',
          color: toast.ok ? '#10b981' : 'var(--danger)',
          border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{toast.msg}</div>
      )}

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
                    onClick={() => { setSelected(selected?.reservation_id === r.reservation_id ? null : r); setShowModify(false); setShowCancel(false); setConfirmNoShow(false) }}
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
      {selected && !showModify && (
        <div className="w-[300px] xl:w-[320px] shrink-0 panel overflow-auto">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Details</p>
            <button onClick={() => { setSelected(null); setShowCancel(false); setConfirmNoShow(false) }} className="rounded-md p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
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

              {canModify(selected) && (
                <button className="btn-secondary w-full justify-center py-2" onClick={() => openModify(selected)}>
                  Modify Reservation
                </button>
              )}

              {isNoShowEligible(selected) && !confirmNoShow && (
                <button
                  className="btn-secondary w-full justify-center py-2"
                  style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#d97706' }}
                  onClick={() => setConfirmNoShow(true)}>
                  Mark No-Show
                </button>
              )}
              {confirmNoShow && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <p className="text-[12px] font-medium" style={{ color: '#d97706' }}>Mark customer as no-show?</p>
                  {previewLoading && !cancelPreview && (
                    <div className="space-y-1">
                      {[70, 55, 85].map(w => (
                        <div key={w} className="animate-pulse h-2.5 rounded" style={{ background: 'rgba(245,158,11,0.2)', width: `${w}%` }} />
                      ))}
                    </div>
                  )}
                  {cancelPreview && !previewLoading && (
                    <div className="space-y-1 py-1">
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>No-show fee</span>
                        <span className="font-bold num" style={{ color: parseFloat(cancelPreview.cancellation_fee) > 0 ? '#d97706' : '#10b981' }}>
                          ${parseFloat(cancelPreview.cancellation_fee).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>Customer refund</span>
                        <span className="font-semibold num" style={{ color: 'var(--text-1)' }}>
                          ${parseFloat(cancelPreview.refund_amount).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span style={{ color: 'var(--text-3)' }}>Policy</span>
                        <span className="font-medium" style={{ color: 'var(--text-2)' }}>{policyTierLabel(cancelPreview.policy_tier)}</span>
                      </div>
                    </div>
                  )}
                  {!cancelPreview && !previewLoading && (
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>This will cancel the reservation. A no-show fee may apply per policy.</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button className="flex-1 btn-secondary py-1.5 text-[12px]" onClick={() => setConfirmNoShow(false)}>Back</button>
                    <button
                      className="flex-1 btn-secondary py-1.5 text-[12px]"
                      style={{ borderColor: 'rgba(245,158,11,0.5)', color: '#d97706' }}
                      disabled={noShowMutation.isPending}
                      onClick={() => noShowMutation.mutate(selected.reservation_id)}>
                      {noShowMutation.isPending ? 'Marking…' : 'Confirm No-Show'}
                    </button>
                  </div>
                </div>
              )}

              {canCancel(selected) && (
                <button
                  className="btn-secondary w-full justify-center py-2"
                  style={{ borderColor: 'rgba(244,114,114,0.3)', color: 'var(--danger)' }}
                  onClick={openCancel}>
                  Cancel Reservation
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modify Drawer ── */}
      {selected && showModify && (
        <div className="w-[320px] xl:w-[360px] shrink-0 panel overflow-auto">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Modify Reservation</p>
              <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--accent)' }}>{selected.confirmation_number}</p>
            </div>
            <button onClick={() => { setShowModify(false); setModifyError('') }} className="rounded-md p-1.5" style={{ color: 'var(--text-3)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {modifySuccess ? (
            <div className="p-8 text-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full mx-auto" style={{ background: 'rgba(16,185,129,0.15)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>Reservation updated</p>
            </div>
          ) : (
            <form onSubmit={handleModify} className="p-5 space-y-4">
              <div>
                <ModalLabel>Current Pickup</ModalLabel>
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{fmt(selected.pickup_date)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>New Pickup Date</ModalLabel>
                  <input type="date" value={modifyForm.pickup_date}
                    onChange={e => setModifyForm(p => ({ ...p, pickup_date: e.target.value }))}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Time (UTC)</ModalLabel>
                  <input type="time" value={modifyForm.pickup_time}
                    onChange={e => setModifyForm(p => ({ ...p, pickup_time: e.target.value }))}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>

              <div>
                <ModalLabel>Current Return</ModalLabel>
                <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{fmt(selected.return_date)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>New Return Date</ModalLabel>
                  <input type="date" value={modifyForm.return_date}
                    min={modifyForm.pickup_date || selected.pickup_date}
                    onChange={e => setModifyForm(p => ({ ...p, return_date: e.target.value }))}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Time (UTC)</ModalLabel>
                  <input type="time" value={modifyForm.return_time}
                    onChange={e => setModifyForm(p => ({ ...p, return_time: e.target.value }))}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>

              <div>
                <ModalLabel>Change Vehicle Class</ModalLabel>
                <select value={modifyForm.vehicle_class_id}
                  onChange={e => setModifyForm(p => ({ ...p, vehicle_class_id: e.target.value }))}
                  className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="">Keep current ({selected.class_name})</option>
                  {vehicleClasses.map(c => (
                    <option key={c.class_id} value={c.class_id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <ModalLabel>Pickup / Dropoff Location</ModalLabel>
                <select disabled className="field-input h-9 px-3 text-[13px] w-full opacity-50 cursor-not-allowed">
                  <option>Location changes require re-booking</option>
                </select>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                  {locations.length > 0 ? `${locations.length} locations available` : 'Location changes not supported via modify'}
                </p>
              </div>

              {modifyDays !== null && modifyDays > 0 && (
                <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                  <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Estimated new total</p>
                  <p className="text-[16px] font-bold num mt-0.5" style={{ color: 'var(--text-1)' }}>
                    Total will be recalculated
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {modifyDays} day{modifyDays !== 1 ? 's' : ''} · pricing applied at checkout
                  </p>
                </div>
              )}

              <div>
                <ModalLabel>Reason for Change</ModalLabel>
                <input type="text" value={modifyForm.change_reason} maxLength={500}
                  placeholder="Optional — agent note for audit log"
                  onChange={e => setModifyForm(p => ({ ...p, change_reason: e.target.value }))}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>

              {modifyError && (
                <p className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>{modifyError}</p>
              )}

              <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => { setShowModify(false); setModifyError('') }} className="btn-secondary flex-1 justify-center py-2">Cancel</button>
                <button type="submit" className="btn-primary flex-1 justify-center py-2" disabled={modifyMutation.isPending}>
                  {modifyMutation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── Cancel Modal ── */}
      {showCancel && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowCancel(false) }}>
          <div className="panel w-full max-w-[420px] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Cancel Reservation</h2>
              <button onClick={() => setShowCancel(false)} className="rounded-md p-1.5" style={{ color: 'var(--text-3)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleCancel} className="px-6 py-5 space-y-4">
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>{selected.customer_name}</p>
                <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--accent)' }}>{selected.confirmation_number}</p>
                <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                  {fmt(selected.pickup_date)} — {fmt(selected.return_date)} · {selected.class_name}
                </p>
              </div>

              {previewLoading && (
                <div className="rounded-lg px-4 py-3 space-y-1.5" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                  {[1,2,3].map(i => (
                    <div key={i} className="animate-pulse h-3 rounded" style={{ background: 'var(--border)', width: `${60 + i * 10}%` }} />
                  ))}
                </div>
              )}

              {cancelPreview && !previewLoading && (
                <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'rgba(244,114,114,0.07)', border: '1px solid rgba(244,114,114,0.25)' }}>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: 'var(--text-3)' }}>Cancellation policy</span>
                    <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{policyTierLabel(cancelPreview.policy_tier)}</span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: 'var(--text-3)' }}>Cancellation fee</span>
                    <span className="font-bold num" style={{ color: parseFloat(cancelPreview.cancellation_fee) > 0 ? 'var(--danger)' : '#10b981' }}>
                      ${parseFloat(cancelPreview.cancellation_fee).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: 'var(--text-3)' }}>Customer refund</span>
                    <span className="font-bold num" style={{ color: 'var(--text-1)' }}>${parseFloat(cancelPreview.refund_amount).toFixed(2)}</span>
                  </div>
                  {parseFloat(cancelPreview.cancellation_fee) > 0 && (
                    <label className="flex items-center gap-2 text-[12px] cursor-pointer pt-1">
                      <input type="checkbox" checked={cancelWaiveFee}
                        onChange={e => setCancelWaiveFee(e.target.checked)}
                        className="rounded" />
                      <span style={{ color: 'var(--text-2)' }}>Waive cancellation fee (manager override)</span>
                    </label>
                  )}
                </div>
              )}

              {selected.reservation_id.startsWith('local-') && (
                <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                  <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Local reservation — no fee calculation</p>
                </div>
              )}

              <div>
                <ModalLabel>Reason for Cancellation</ModalLabel>
                <select required value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full">
                  {CANCEL_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {cancelReason === 'OTHER' && (
                <div>
                  <ModalLabel>Additional Details</ModalLabel>
                  <input required type="text" value={cancelReasonOther} maxLength={400}
                    placeholder="Describe the reason…"
                    onChange={e => setCancelReasonOther(e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              )}

              {cancelError && (
                <p className="text-[12px] font-medium" style={{ color: 'var(--danger)' }}>{cancelError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowCancel(false)} className="btn-secondary">Keep Reservation</button>
                <button type="submit"
                  disabled={cancelMutation.isPending || (cancelReason === 'OTHER' && !cancelReasonOther.trim())}
                  className="btn-secondary py-2 px-4"
                  style={{ borderColor: 'rgba(244,114,114,0.4)', color: 'var(--danger)' }}>
                  {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
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
