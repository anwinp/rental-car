import { useState, useMemo, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT = '00000000-0000-0000-0000-000000000001'

// ── Types ────────────────────────────────────────────────────────────────────

type ActiveRental = {
  ra_id: string
  ra_number: string
  reservation_id: string | null
  confirmation_number: string | null
  customer_id: string
  customer_name: string
  customer_email: string
  vehicle_id: string
  vehicle_make: string
  vehicle_model: string
  model_year: number
  plate_number: string | null
  status: string
  odometer_out: number
  fuel_level_out_pct: number | null
  created_at: string
  scheduled_return_date: string | null
  reservation_total: number | null
}

type Location = { location_id: string; short_code: string; name: string; city: string; state_province: string }

type CheckInResponse = {
  rental_agreement_id: string; returned_at: string
  time_extension_charge: string | number; fuel_charge: string | number
  mileage_overage_charge: string | number; final_total_estimate: string | number
  vehicle_status: string
}

function toNum(v: string | number | undefined): number {
  return v === undefined ? 0 : Number(v)
}

type DamageLevel = 'GOOD' | 'MINOR' | 'MAJOR'
type Disposition = 'CLEANING' | 'DAMAGE_HOLD' | 'MAINTENANCE'

type Step = 1 | 2 | 3 | 4

// ── API helpers ──────────────────────────────────────────────────────────────

const HEADERS = {
  'Content-Type': 'application/json',
  'X-Tenant-ID': TENANT,
}

async function fetchActiveRentals(): Promise<ActiveRental[]> {
  const res = await fetch('/api/v1/checkout/active-rentals', { credentials: 'include', headers: HEADERS })
  if (!res.ok) throw new Error('Failed to load active rentals')
  return res.json()
}

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations', { credentials: 'include', headers: HEADERS })
  if (!res.ok) return []
  return res.json()
}

async function postCheckIn(body: object): Promise<CheckInResponse> {
  const res = await fetch('/api/v1/checkout/check-in', {
    method: 'POST', credentials: 'include',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).detail ?? 'Check-in failed') }
  return res.json()
}

async function postBlock(body: object) {
  const res = await fetch('/api/v1/fleet/blocks', {
    method: 'POST', credentials: 'include',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).detail ?? 'Block creation failed') }
  return res.json()
}

async function patchVehicle(vehicleId: string, body: object) {
  const res = await fetch(`/api/v1/fleet/vehicles/${vehicleId}`, {
    method: 'PATCH', credentials: 'include',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).detail ?? 'Vehicle update failed') }
  return res.json()
}


// ── Small components ─────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  const steps = ['Find Rental', 'Inspect Vehicle', 'Review & Charges', 'Complete']
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const n = (i + 1) as Step
        const done = step > n; const active = step === n
        return (
          <div key={n} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold shrink-0"
                style={{
                  background: done ? '#10b981' : active ? 'var(--accent)' : 'var(--border)',
                  color: done || active ? '#fff' : 'var(--text-3)',
                }}>
                {done
                  ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : n}
              </div>
              <span className="text-[11.5px] font-medium hidden sm:block truncate"
                style={{ color: active ? 'var(--text-1)' : done ? '#10b981' : 'var(--text-3)' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 mx-3 h-px" style={{ background: done ? '#10b981' : 'var(--border)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function FuelGauge({ value, onChange, readonly }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  const pct = Math.round((value / 8) * 100)
  const color = value <= 1 ? '#ef4444' : value <= 3 ? '#f59e0b' : '#10b981'
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-0.5">
          {Array.from({ length: 8 }, (_, i) => (
            <button key={i} type="button" disabled={readonly}
              onClick={() => onChange?.(i + 1)}
              className="flex-1 h-6 rounded-sm transition-all"
              style={{
                background: i < value ? color : 'var(--border)',
                cursor: readonly ? 'default' : 'pointer',
              }} />
          ))}
        </div>
        <span className="text-[12px] font-bold num w-10 text-right" style={{ color }}>{pct}%</span>
      </div>
      <div className="flex justify-between text-[9.5px]" style={{ color: 'var(--text-3)' }}>
        <span>E</span><span>1/4</span><span>1/2</span><span>3/4</span><span>F</span>
      </div>
      {!readonly && (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          Click a segment to set fuel level
        </p>
      )}
    </div>
  )
}

const DAMAGE_ZONES = [
  { id: 'FRONT',    label: 'Front Bumper',   pos: 'top' },
  { id: 'LEFT',     label: 'Driver Side',    pos: 'mid' },
  { id: 'INTERIOR', label: 'Interior',       pos: 'mid' },
  { id: 'RIGHT',    label: 'Passenger Side', pos: 'mid' },
  { id: 'REAR',     label: 'Rear Bumper',    pos: 'bot' },
  { id: 'GLASS',    label: 'Glass / Roof',   pos: 'bot' },
]

const DAMAGE_STYLE: Record<DamageLevel, { bg: string; border: string; text: string; label: string }> = {
  GOOD:  { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.35)', text: '#10b981', label: 'Good' },
  MINOR: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', text: '#d97706', label: 'Minor' },
  MAJOR: { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.40)',  text: '#ef4444', label: 'Major' },
}

function DamageZoneButton({ zone, value, onChange }: { zone: typeof DAMAGE_ZONES[0]; value: DamageLevel; onChange: (v: DamageLevel) => void }) {
  const s = DAMAGE_STYLE[value]
  const cycle: DamageLevel[] = ['GOOD', 'MINOR', 'MAJOR']
  function next() { onChange(cycle[(cycle.indexOf(value) + 1) % 3]) }
  return (
    <button type="button" onClick={next}
      className="flex flex-col items-center gap-1 rounded-lg p-2.5 text-center transition-colors"
      style={{ background: s.bg, border: `1.5px solid ${s.border}`, cursor: 'pointer' }}>
      <span className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>{zone.label}</span>
      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: s.border, color: s.text }}>{s.label}</span>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-3)' }}>{children}</p>
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ReturnProcessingPage() {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>(1)
  const [search, setSearch] = useState('')

  const [selectedRental, setSelectedRental] = useState<ActiveRental | null>(null)

  // Step 2 form
  const [odometerIn, setOdometerIn] = useState('')
  const [fuelLevel, setFuelLevel] = useState(8)
  const [agentNotes, setAgentNotes] = useState('')
  const [returnLocationId, setReturnLocationId] = useState('')
  const [damageZones, setDamageZones] = useState<Record<string, DamageLevel>>(() =>
    Object.fromEntries(DAMAGE_ZONES.map(z => [z.id, 'GOOD' as DamageLevel]))
  )
  const [disposition, setDisposition] = useState<Disposition>('CLEANING')

  // Step 3 result
  const [checkInResult, setCheckInResult] = useState<CheckInResponse | null>(null)
  const [completed, setCompleted] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const { data: activeRentals = [], isLoading: loadingRentals } = useQuery<ActiveRental[]>({
    queryKey: ['active-rentals'], queryFn: fetchActiveRentals, staleTime: 30_000,
  })

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'], queryFn: fetchLocations, staleTime: 300_000,
  })

  const sortedLocations = useMemo(() => [...locations].sort((a, b) => a.short_code.localeCompare(b.short_code)), [locations])
  const locMap = useMemo(() => Object.fromEntries(locations.map(l => [l.location_id, l])), [locations])

  const filtered = useMemo(() => {
    if (!search) return activeRentals
    const q = search.toLowerCase()
    return activeRentals.filter(r =>
      r.ra_number.toLowerCase().includes(q) ||
      (r.confirmation_number ?? '').toLowerCase().includes(q) ||
      r.customer_name.toLowerCase().includes(q) ||
      r.customer_email.toLowerCase().includes(q) ||
      `${r.vehicle_make} ${r.vehicle_model}`.toLowerCase().includes(q) ||
      (r.plate_number ?? '').toLowerCase().includes(q)
    )
  }, [activeRentals, search])

  const hasDamage = useMemo(() => Object.values(damageZones).some(v => v !== 'GOOD'), [damageZones])
  const majorDamage = useMemo(() => Object.values(damageZones).some(v => v === 'MAJOR'), [damageZones])

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  function selectRental(rental: ActiveRental) {
    setSelectedRental(rental)
    setOdometerIn(String(rental.odometer_out))
    const fuelSegments = rental.fuel_level_out_pct != null
      ? Math.round((rental.fuel_level_out_pct / 100) * 8)
      : 8
    setFuelLevel(Math.max(0, Math.min(8, fuelSegments)))
    setStep(2)
  }

  const processMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRental) throw new Error('No rental selected')

      if (selectedRental.status === 'RETURNED' || selectedRental.status === 'CLOSED') {
        throw new Error(`This rental has already been returned (status: ${selectedRental.status}). Refresh to see updated data.`)
      }

      let checkIn: CheckInResponse | null = null

      if (selectedRental.status === 'ACTIVE' || selectedRental.status === 'EXTENDED') {
        checkIn = await postCheckIn({
          rental_agreement_id: selectedRental.ra_id,
          odometer_in: Number(odometerIn),
          fuel_level_in: fuelLevel,
          agent_notes: agentNotes || null,
        })
        setCheckInResult(checkIn)
      }

      const vehicleId = selectedRental.vehicle_id
      const now = new Date()
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)

      const blockType = disposition === 'CLEANING' ? 'TURNAROUND' : disposition === 'DAMAGE_HOLD' ? 'HOLD' : 'MAINTENANCE'
      const blockReason = disposition === 'CLEANING'
        ? 'Post-return cleaning and inspection'
        : disposition === 'DAMAGE_HOLD'
        ? `Damage hold — ${Object.entries(damageZones).filter(([,v]) => v !== 'GOOD').map(([k]) => k).join(', ')}`
        : 'Mechanical inspection required'

      try {
        await postBlock({
          vehicle_id: vehicleId,
          block_type: blockType,
          start_dt: now.toISOString(),
          end_dt: twoHoursLater.toISOString(),
          reason: blockReason,
          is_hard_block: disposition !== 'CLEANING',
        })
      } catch (blockErr) {
        const msg = blockErr instanceof Error ? blockErr.message : ''
        if (!msg.toLowerCase().includes('available') && !msg.includes('409')) throw blockErr
      }

      const newVehicleStatus = disposition === 'CLEANING' ? 'CLEANING' : disposition === 'DAMAGE_HOLD' ? 'DAMAGE_HOLD' : 'MAINTENANCE'
      const vehiclePatch: Record<string, unknown> = {
        status: newVehicleStatus,
        odometer_current: Number(odometerIn),
      }
      if (returnLocationId) vehiclePatch.current_location_id = returnLocationId
      await patchVehicle(vehicleId, vehiclePatch)

      return checkIn
    },
    onSuccess: () => {
      setCompleted(true)
      setStep(4)
      qc.invalidateQueries({ queryKey: ['active-rentals'] })
      qc.invalidateQueries({ queryKey: ['fleet-vehicles'] })
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  function handleInspectSubmit(e: FormEvent) {
    e.preventDefault()
    if (!odometerIn || Number(odometerIn) < 0) { showToast('Enter a valid odometer reading', false); return }
    if (majorDamage && disposition === 'CLEANING') setDisposition('DAMAGE_HOLD')
    setStep(3)
  }

  function reset() {
    setStep(1); setSearch(''); setSelectedRental(null)
    setOdometerIn(''); setFuelLevel(8); setAgentNotes(''); setReturnLocationId(''); setCompleted(false)
    setCheckInResult(null); setDisposition('CLEANING')
    setDamageZones(Object.fromEntries(DAMAGE_ZONES.map(z => [z.id, 'GOOD' as DamageLevel])))
  }

  // ── Charge estimates ──
  const odometerOut = selectedRental?.odometer_out ?? 0
  const milesDriven = Math.max(0, Number(odometerIn) - odometerOut)
  const fuelOutPct = selectedRental?.fuel_level_out_pct ?? 100
  const fuelNow = Math.round((fuelLevel / 8) * 100)
  const fuelDeficit = Math.max(0, fuelOutPct - fuelNow)
  const fuelCharge = checkInResult ? toNum(checkInResult.fuel_charge) : (fuelDeficit > 12 ? Math.ceil(fuelDeficit / 12.5) * 15 : 0)
  const timeCharge = checkInResult ? toNum(checkInResult.time_extension_charge) : 0
  const mileageCharge = checkInResult ? toNum(checkInResult.mileage_overage_charge) : 0
  const totalExtra = fuelCharge + timeCharge + mileageCharge

  const returnDate = selectedRental?.scheduled_return_date ? new Date(selectedRental.scheduled_return_date) : null
  const now = new Date()
  const isLate = returnDate ? now > returnDate : false
  const isEarlyReturn = returnDate ? now < returnDate : false
  const earlyDays = isEarlyReturn && returnDate
    ? Math.ceil((returnDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const vehicleDesc = selectedRental
    ? `${selectedRental.model_year} ${selectedRental.vehicle_make} ${selectedRental.vehicle_model}`
    : ''

  return (
    <div className="space-y-5 max-w-4xl">
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

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Return Processing</h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          Process vehicle returns, record condition, and release to fleet
        </p>
      </div>

      <StepBar step={step} />

      {/* ── Step 1: Find Rental ── */}
      {step === 1 && (
        <div className="panel p-5 space-y-4">
          <div>
            <SectionLabel>Active Rentals</SectionLabel>
            <p className="text-[12px] mb-3" style={{ color: 'var(--text-3)' }}>
              {loadingRentals ? 'Loading...' : `${activeRentals.length} vehicle${activeRentals.length !== 1 ? 's' : ''} currently out`}
            </p>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="search" placeholder="Search by RA number, customer, vehicle, or plate…"
                value={search} onChange={e => setSearch(e.target.value)}
                className="field-input h-9 pl-8 text-[13px] w-full" />
            </div>
          </div>

          {filtered.length === 0 && !loadingRentals && (
            <div className="py-12 text-center" style={{ color: 'var(--text-3)' }}>
              <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 0 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
                <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
              </svg>
              <p className="text-[13px]">{search ? 'No rentals match your search' : 'No vehicles currently checked out'}</p>
            </div>
          )}

          <div className="space-y-2">
            {filtered.map(rental => {
              const late = rental.scheduled_return_date ? new Date() > new Date(rental.scheduled_return_date) : false
              const isWalkUp = !rental.reservation_id
              return (
                <button key={rental.ra_id} type="button"
                  onClick={() => selectRental(rental)}
                  className="w-full text-left rounded-lg px-4 py-3.5 transition-colors"
                  style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{rental.customer_name}</span>
                        <span className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>{rental.ra_number}</span>
                        {isWalkUp && (
                          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>WALK-UP</span>
                        )}
                        {late && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>OVERDUE</span>
                        )}
                      </div>
                      <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {rental.model_year} {rental.vehicle_make} {rental.vehicle_model}
                        {rental.plate_number ? ` · ${rental.plate_number}` : ''}
                        {rental.scheduled_return_date
                          ? ` · Due ${new Date(rental.scheduled_return_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                          : ' · No due date'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {rental.reservation_total != null
                        ? <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>${Number(rental.reservation_total).toFixed(2)}</p>
                        : <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>—</p>
                      }
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{rental.customer_email}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Step 2: Inspect Vehicle ── */}
      {step === 2 && selectedRental && (
        <form onSubmit={handleInspectSubmit} className="space-y-4">
          {/* Rental summary card */}
          <div className="panel px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>Returning</p>
                <p className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>{selectedRental.customer_name}</p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {selectedRental.ra_number}
                  {selectedRental.confirmation_number ? ` · ${selectedRental.confirmation_number}` : ' · Walk-up'}
                  {' · '}{vehicleDesc}
                  {selectedRental.plate_number ? ` · ${selectedRental.plate_number}` : ''}
                </p>
              </div>
              <div className="text-right">
                <span className="badge-green">RA Found</span>
                <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-3)' }}>{selectedRental.ra_number}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-center" style={{ borderTop: '1px solid var(--border-sub)', paddingTop: 12 }}>
              {[
                { label: 'Checked Out', value: new Date(selectedRental.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) },
                { label: 'Due Back', value: selectedRental.scheduled_return_date
                    ? new Date(selectedRental.scheduled_return_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : 'N/A' },
                { label: 'Base Total', value: selectedRental.reservation_total != null ? `$${Number(selectedRental.reservation_total).toFixed(2)}` : '—' },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
                  <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Early Return Notice */}
          {isEarlyReturn && (
            <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <p className="text-[12px] font-semibold" style={{ color: '#6366f1' }}>Early Return</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                Customer is returning {earlyDays} day{earlyDays !== 1 ? 's' : ''} early. A prorated refund may apply.
              </p>
            </div>
          )}

          {/* Return Details */}
          <div className="panel px-5 py-4 space-y-5">
            <div>
              <SectionLabel>Return Location</SectionLabel>
              <select value={returnLocationId} onChange={e => setReturnLocationId(e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full">
                <option value="">Select location…</option>
                {sortedLocations.map(l => (
                  <option key={l.location_id} value={l.location_id}>{l.short_code} — {l.city}, {l.state_province}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <SectionLabel>Odometer at Return (mi)</SectionLabel>
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                  Out: {selectedRental.odometer_out.toLocaleString()} mi
                </p>
                <input required type="number" min={odometerOut} placeholder="Current mileage"
                  value={odometerIn} onChange={e => setOdometerIn(e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full num" />
                {odometerIn && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {milesDriven.toLocaleString()} miles driven this rental
                  </p>
                )}
              </div>
              <div>
                <SectionLabel>Return Time</SectionLabel>
                <div className="flex items-center gap-1.5 h-9">
                  <span className="text-[13px] font-medium" style={{ color: 'var(--text-1)' }}>
                    {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                    {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                {isLate && (
                  <p className="text-[11px] mt-1 font-medium" style={{ color: 'var(--danger)' }}>
                    Returned after due date — late charges may apply
                  </p>
                )}
              </div>
            </div>

            <div>
              <SectionLabel>Fuel Level at Return</SectionLabel>
              {selectedRental.fuel_level_out_pct != null && (
                <p className="text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>
                  Rented at {selectedRental.fuel_level_out_pct}%
                </p>
              )}
              <FuelGauge value={fuelLevel} onChange={setFuelLevel} />
            </div>
          </div>

          {/* Damage Inspection */}
          <div className="panel px-5 py-4 space-y-4">
            <div>
              <SectionLabel>Vehicle Condition</SectionLabel>
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Click each zone to cycle through Good — Minor damage — Major damage
              </p>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2">
                <DamageZoneButton zone={DAMAGE_ZONES[0]} value={damageZones['FRONT']}
                  onChange={v => setDamageZones(p => ({ ...p, FRONT: v }))} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {['LEFT', 'INTERIOR', 'RIGHT'].map(id => (
                  <DamageZoneButton key={id} zone={DAMAGE_ZONES.find(z => z.id === id)!}
                    value={damageZones[id]} onChange={v => setDamageZones(p => ({ ...p, [id]: v }))} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {['REAR', 'GLASS'].map(id => (
                  <DamageZoneButton key={id} zone={DAMAGE_ZONES.find(z => z.id === id)!}
                    value={damageZones[id]} onChange={v => setDamageZones(p => ({ ...p, [id]: v }))} />
                ))}
              </div>
            </div>

            {hasDamage && (
              <div className="rounded-lg px-3.5 py-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <p className="text-[12px] font-semibold" style={{ color: '#d97706' }}>
                  Damage noted on: {Object.entries(damageZones).filter(([,v]) => v !== 'GOOD').map(([k,v]) => `${DAMAGE_ZONES.find(z=>z.id===k)?.label} (${v.toLowerCase()})`).join(', ')}
                </p>
                {majorDamage && (
                  <p className="text-[11px] mt-0.5" style={{ color: '#d97706' }}>Major damage detected — consider Damage Hold disposition</p>
                )}
              </div>
            )}
          </div>

          {/* Post-return Disposition */}
          <div className="panel px-5 py-4 space-y-3">
            <SectionLabel>Post-Return Disposition</SectionLabel>
            <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Where does this vehicle go after return?</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                { value: 'CLEANING' as Disposition, label: 'Cleaning Queue', desc: 'Standard turnaround — clean and inspect before release', color: '#10b981' },
                { value: 'DAMAGE_HOLD' as Disposition, label: 'Damage Hold', desc: 'Remove from pool for damage assessment', color: '#ef4444' },
                { value: 'MAINTENANCE' as Disposition, label: 'Maintenance', desc: 'Flag for mechanical inspection or repair', color: '#f59e0b' },
              ]).map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setDisposition(opt.value)}
                  className="text-left rounded-lg p-3 transition-colors"
                  style={{
                    border: `1.5px solid ${disposition === opt.value ? opt.color : 'var(--border)'}`,
                    background: disposition === opt.value ? `${opt.color}14` : 'var(--elevated)',
                  }}>
                  <p className="text-[12px] font-semibold" style={{ color: disposition === opt.value ? opt.color : 'var(--text-1)' }}>{opt.label}</p>
                  <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Agent Notes */}
          <div className="panel px-5 py-4">
            <SectionLabel>Agent Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <textarea value={agentNotes} onChange={e => setAgentNotes(e.target.value)}
              rows={2} maxLength={2000} placeholder="Any additional observations or notes…"
              className="field-input w-full px-3 py-2 text-[13px] resize-none" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setStep(1)} className="btn-secondary">Back</button>
            <button type="submit" className="btn-primary">Review Charges</button>
          </div>
        </form>
      )}

      {/* ── Step 3: Review & Charges ── */}
      {step === 3 && selectedRental && (
        <div className="space-y-4">
          <div className="panel px-5 py-4">
            <SectionLabel>Return Summary</SectionLabel>
            <div className="mt-2 space-y-2">
              {[
                { label: 'Customer', value: selectedRental.customer_name },
                { label: 'RA Number', value: selectedRental.ra_number },
                { label: 'Vehicle', value: vehicleDesc },
                { label: 'Return Location', value: returnLocationId ? `${locMap[returnLocationId]?.short_code} — ${locMap[returnLocationId]?.city}` : 'Not specified' },
                { label: 'Mileage at Return', value: `${Number(odometerIn).toLocaleString()} mi (${milesDriven.toLocaleString()} driven)` },
                { label: 'Fuel Level', value: `${Math.round((fuelLevel / 8) * 100)}% (${fuelLevel}/8)` },
                { label: 'Disposition', value: disposition === 'CLEANING' ? 'Cleaning Queue' : disposition === 'DAMAGE_HOLD' ? 'Damage Hold' : 'Maintenance' },
              ].map(row => (
                <div key={row.label} className="flex items-start justify-between gap-4 py-1.5"
                  style={{ borderBottom: '1px solid var(--border-sub)' }}>
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{row.label}</span>
                  <span className="text-[12px] font-medium text-right" style={{ color: 'var(--text-1)' }}>{row.value}</span>
                </div>
              ))}

              {hasDamage && (
                <div className="flex items-start justify-between gap-4 py-1.5">
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>Damage Noted</span>
                  <span className="text-[12px] font-medium text-right" style={{ color: '#d97706' }}>
                    {Object.entries(damageZones).filter(([,v]) => v !== 'GOOD').map(([k,v]) => `${k} (${v})`).join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {isEarlyReturn && (
            <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <p className="text-[12px] font-semibold" style={{ color: '#6366f1' }}>Early Return</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                Customer is returning {earlyDays} day{earlyDays !== 1 ? 's' : ''} early. A prorated refund may apply.
              </p>
            </div>
          )}

          {/* Charges */}
          <div className="panel px-5 py-4">
            <SectionLabel>Charge Estimate</SectionLabel>
            <div className="mt-2 space-y-1.5">
              {[
                { label: 'Base rental', value: selectedRental.reservation_total },
                { label: `Time extension${isLate ? ' (late return)' : ''}`, value: timeCharge, warn: isLate && timeCharge > 0 },
                { label: 'Fuel surcharge', value: fuelCharge, warn: fuelCharge > 0 },
                { label: 'Mileage overage', value: mileageCharge, warn: mileageCharge > 0 },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-1"
                  style={{ borderBottom: '1px solid var(--border-sub)' }}>
                  <span className="text-[12px]" style={{ color: (row as any).warn ? '#d97706' : 'var(--text-2)' }}>{row.label}</span>
                  <span className="text-[12px] font-semibold num" style={{ color: (row as any).warn ? '#d97706' : 'var(--text-1)' }}>
                    {row.value != null ? `$${Number(row.value).toFixed(2)}` : '—'}
                  </span>
                </div>
              ))}
              {totalExtra > 0 && (
                <div className="flex items-center justify-between gap-4 pt-2">
                  <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>Additional Charges</span>
                  <span className="text-[14px] font-bold num" style={{ color: '#d97706' }}>
                    ${totalExtra.toFixed(2)}
                  </span>
                </div>
              )}
              {totalExtra === 0 && (
                <div className="flex items-center gap-2 pt-2 text-[12px] font-medium" style={{ color: '#10b981' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  No additional charges
                </div>
              )}
            </div>
          </div>

          {/* What happens next */}
          <div className="panel px-5 py-4">
            <SectionLabel>What Happens Next</SectionLabel>
            <div className="mt-3 space-y-2">
              {[
                'Return processed — rental agreement closed',
                `Vehicle moved to ${disposition === 'CLEANING' ? 'cleaning queue (TURNAROUND block)' : disposition === 'DAMAGE_HOLD' ? 'damage hold' : 'maintenance queue'}`,
                disposition === 'CLEANING' ? 'Inspection by fleet tech — 2hr window' : 'Fleet team assessment and work order',
                disposition === 'CLEANING' ? 'Vehicle returns to available pool at return location' : 'Vehicle released after clearance',
              ].map((text, n) => (
                <div key={n} className="flex items-start gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full shrink-0 text-[10px] font-bold"
                    style={{ background: 'var(--accent)', color: 'white', marginTop: 1 }}>{n + 1}</div>
                  <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setStep(2)} className="btn-secondary">Back</button>
            <button type="button"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending}
              className="btn-primary">
              {processMutation.isPending ? 'Processing…' : 'Confirm Return'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Complete ── */}
      {step === 4 && completed && selectedRental && (
        <div className="panel px-6 py-8 text-center space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full mx-auto"
            style={{ background: 'rgba(16,185,129,0.15)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div>
            <h2 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>Return Complete</h2>
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
              {selectedRental.customer_name}'s rental has been successfully processed.
            </p>
          </div>

          <div className="rounded-lg px-5 py-4 mx-auto max-w-sm text-left space-y-2"
            style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            {[
              { label: 'RA Number', value: selectedRental.ra_number },
              { label: 'Vehicle', value: vehicleDesc },
              { label: 'Return Location', value: returnLocationId ? `${locMap[returnLocationId]?.short_code} — ${locMap[returnLocationId]?.city}` : 'Not recorded' },
              { label: 'Mileage', value: `${Number(odometerIn).toLocaleString()} mi` },
              { label: 'Fuel', value: `${Math.round((fuelLevel / 8) * 100)}%` },
              { label: 'Disposition', value: disposition === 'CLEANING' ? 'Sent to cleaning queue' : disposition === 'DAMAGE_HOLD' ? 'Damage hold applied' : 'Sent to maintenance' },
              ...(hasDamage ? [{ label: 'Damage Noted', value: Object.entries(damageZones).filter(([,v]) => v !== 'GOOD').map(([k]) => k).join(', ') }] : []),
              ...(totalExtra > 0 ? [{ label: 'Extra Charges', value: `$${totalExtra.toFixed(2)}` }] : []),
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between gap-4 text-[12px]">
                <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
                <span className="font-medium" style={{ color: 'var(--text-1)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {isEarlyReturn && (
            <div className="rounded-lg px-4 py-3 mx-auto max-w-sm" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <p className="text-[12px] font-semibold" style={{ color: '#6366f1' }}>Early Return — Refund Notice</p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>
                Prorated refund will be processed during payment capture.
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 pt-2">
            <button type="button" onClick={reset} className="btn-primary">Process Another Return</button>
          </div>
        </div>
      )}
    </div>
  )
}
