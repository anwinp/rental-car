import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type Reservation = {
  reservation_id: string
  confirmation_number: string
  customer_name: string
  customer_email?: string
  class_name: string
  pickup_date: string
  return_date: string
  assigned_vehicle: string | null
  status: string
}

type ReservationDetail = {
  reservation_id: string
  customer_id: string
  vehicle_class_id: string
  pickup_location_id: string
  pickup_datetime: string
  return_datetime: string
}

type Vehicle = {
  vehicle_id: string
  make: string
  model: string
  model_year: number
  plate_number: string | null
  vehicle_class_id: string
  class_name?: string
  status: string
  odometer_current: number
  fuel_level_pct: number | null
  current_location_id: string | null
}

type VehicleClass = {
  class_id: string
  name: string
}

type Extra = {
  extra_id: string
  name: string
  default_price: string | number
}

type CheckoutResult = {
  rental_agreement_id: string
  ra_number: string
  vehicle_id: string
  vin: string
  customer_id: string
  status: string
  checked_out_at: string
}

// ── API helpers ───────────────────────────────────────────────────────────────

const TENANT = import.meta.env.VITE_TENANT_ID ?? 'dev'

async function fetchJSON(path: string) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { 'X-Tenant-ID': TENANT },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function postJSON(path: string, body: unknown) {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={i} className="flex items-center flex-1">
            <div className="flex flex-col items-center" style={{ minWidth: 80 }}>
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors"
                style={{
                  background: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--card-bg)',
                  color: done || active ? 'white' : 'var(--text-3)',
                  border: done || active ? 'none' : '1.5px solid var(--border)',
                }}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                ) : i + 1}
              </div>
              <span className="mt-1 text-[10.5px] font-medium text-center" style={{ color: active ? 'var(--accent)' : done ? 'var(--text-2)' : 'var(--text-3)' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px mx-1 -mt-4" style={{ background: done ? 'var(--success)' : 'var(--border)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function FuelGauge({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const LABELS = ['E', '', '1/4', '', '1/2', '', '3/4', '', 'F']
  return (
    <div className="select-none">
      <div className="flex gap-1 mb-1">
        {Array.from({ length: 9 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange?.(i)}
            disabled={!onChange}
            className="flex-1 rounded transition-colors"
            style={{
              height: 28,
              background: i <= value
                ? (value >= 6 ? 'var(--success)' : value >= 3 ? '#f59e0b' : 'var(--danger)')
                : 'var(--page-bg)',
              border: i === value ? '2px solid var(--accent)' : '1.5px solid var(--border)',
              cursor: onChange ? 'pointer' : 'default',
            }}
            aria-label={`Fuel level ${LABELS[i]}`}
          />
        ))}
      </div>
      <div className="flex justify-between px-0.5">
        {LABELS.map((l, i) => (
          <span key={i} className="text-[9px]" style={{ color: 'var(--text-3)', width: '11.1%', textAlign: 'center' }}>{l}</span>
        ))}
      </div>
      <p className="mt-1 text-xs text-center" style={{ color: 'var(--text-3)' }}>
        {['Empty', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', 'Full'][value]}
      </p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const STEPS = ['Find Reservation', 'Select Vehicle', 'Counter Details', 'Confirm']

export function CounterCheckoutPage() {
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const [search, setSearch] = useState('')
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null)
  const [selectedResDetail, setSelectedResDetail] = useState<ReservationDetail | null>(null)
  const [isWalkUp, setIsWalkUp] = useState(false)
  const [walkUpClassId, setWalkUpClassId] = useState('')
  const [walkUpEmail, setWalkUpEmail] = useState('')
  const [walkUpCustomerId, setWalkUpCustomerId] = useState<string | null>(null)
  const [walkUpCustomerName, setWalkUpCustomerName] = useState('')
  const [walkUpFirstName, setWalkUpFirstName] = useState('')
  const [walkUpLastName, setWalkUpLastName] = useState('')
  const [walkUpPhone, setWalkUpPhone] = useState('')
  const [walkUpLookupDone, setWalkUpLookupDone] = useState(false)
  const [walkUpIsNew, setWalkUpIsNew] = useState(false)
  const [walkUpActiveRental, setWalkUpActiveRental] = useState(false)
  const [walkUpBusy, setWalkUpBusy] = useState(false)
  const [walkUpError, setWalkUpError] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [odometerOut, setOdometerOut] = useState('')
  const [fuelLevelOut, setFuelLevelOut] = useState(8)
  const [selectedExtras, setSelectedExtras] = useState<string[]>([])
  const [agentNotes, setAgentNotes] = useState('')
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null)

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: reservations = [], isLoading: resLoading } = useQuery<Reservation[]>({
    queryKey: ['reservations-confirmed'],
    queryFn: () => fetchJSON('/reservations/crm-list?status=CONFIRMED&limit=200'),
    refetchInterval: 30000,
  })

  const { data: availableVehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles-available'],
    queryFn: () => fetchJSON('/fleet/vehicles?status=AVAILABLE&limit=200'),
    enabled: step >= 1,
  })

  const { data: classes = [] } = useQuery<VehicleClass[]>({
    queryKey: ['fleet-classes'],
    queryFn: () => fetchJSON('/fleet/classes'),
  })

  const { data: extras = [] } = useQuery<Extra[]>({
    queryKey: ['extras'],
    queryFn: () => fetchJSON('/pricing/extras').then((r: any) => r.items ?? r),
    enabled: step >= 2,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        odometer_out: Number(odometerOut),
        fuel_level_out: fuelLevelOut,
        extras: selectedExtras,
        agent_notes: agentNotes || null,
        admin_bypass_preauth: true,
      }
      if (isWalkUp) {
        body.walk_up = true
        body.vehicle_class_id = walkUpClassId
        body.customer_id = walkUpCustomerId
      } else {
        body.walk_up = false
        body.reservation_id = selectedRes!.reservation_id
      }
      if (selectedVehicle) {
        body.vehicle_id = selectedVehicle.vehicle_id
      }
      return postJSON('/checkout/checkout', body)
    },
    onSuccess: (data) => {
      setCheckoutResult(data)
      qc.invalidateQueries({ queryKey: ['reservations-confirmed'] })
      qc.invalidateQueries({ queryKey: ['vehicles-available'] })
      qc.invalidateQueries({ queryKey: ['fleet-vehicles'] })
      setStep(4)
    },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────

  const filteredReservations = useCallback(() => {
    if (!search.trim()) return reservations
    const q = search.toLowerCase()
    return reservations.filter(r =>
      r.confirmation_number.toLowerCase().includes(q) ||
      r.customer_name.toLowerCase().includes(q)
    )
  }, [reservations, search])

  const vehiclesForClass = useCallback(() => {
    const classId = isWalkUp ? walkUpClassId : selectedResDetail?.vehicle_class_id
    if (!classId) return availableVehicles
    return availableVehicles.filter(v => v.vehicle_class_id === classId)
  }, [availableVehicles, isWalkUp, walkUpClassId, selectedResDetail])

  const fmtDate = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  // ── Completed ─────────────────────────────────────────────────────────────

  if (step === 4 && checkoutResult) {
    return (
      <div className="page-root" style={{ maxWidth: 560, margin: '0 auto', padding: '2rem 1rem' }}>
        <div className="card p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full mx-auto mb-4"
               style={{ background: 'rgba(34,197,94,.12)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)' }}>Checkout Complete</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>Vehicle has been checked out successfully.</p>

          <div className="rounded-lg p-4 mb-6 text-left space-y-2" style={{ background: 'var(--page-bg)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Rental Agreement</span>
              <span className="font-bold text-lg" style={{ color: 'var(--accent)' }}>{checkoutResult.ra_number}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Vehicle ID</span>
              <span style={{ color: 'var(--text-2)' }}>{checkoutResult.vehicle_id.slice(0, 8).toUpperCase()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>VIN</span>
              <span style={{ color: 'var(--text-2)' }}>{checkoutResult.vin}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Status</span>
              <span style={{ color: 'var(--success)' }}>{checkoutResult.status}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-3)' }}>Checked out at</span>
              <span style={{ color: 'var(--text-2)' }}>{fmtDate(checkoutResult.checked_out_at)}</span>
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <button
              className="btn-primary px-6 py-2.5"
              onClick={() => {
                setStep(0)
                setSelectedRes(null)
                setSelectedResDetail(null)
                setSelectedVehicle(null)
                setSearch('')
                setOdometerOut('')
                setFuelLevelOut(8)
                setSelectedExtras([])
                setAgentNotes('')
                setIsWalkUp(false)
                setWalkUpClassId('')
                setWalkUpEmail('')
                setWalkUpCustomerId(null)
                setWalkUpCustomerName('')
                setWalkUpFirstName('')
                setWalkUpLastName('')
                setWalkUpPhone('')
                setWalkUpLookupDone(false)
                setWalkUpIsNew(false)
                setWalkUpActiveRental(false)
                setWalkUpError('')
                setCheckoutResult(null)
              }}
            >
              New Checkout
            </button>
            <a href="/returns" className="btn-secondary px-6 py-2.5">Process Return</a>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 0: Find Reservation ──────────────────────────────────────────────

  const renderStep0 = () => (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        <button
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!isWalkUp ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setIsWalkUp(false)}
        >
          Pre-booked Reservation
        </button>
        <button
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isWalkUp ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setIsWalkUp(true)}
        >
          Walk-up Customer
        </button>
      </div>

      {isWalkUp ? (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Walk-up Customer</h3>

          {/* Step 1: email lookup */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Customer Email</label>
            <div className="flex gap-2">
              <input
                className="field-input flex-1 text-sm"
                type="email"
                placeholder="customer@example.com"
                value={walkUpEmail}
                onChange={e => { setWalkUpEmail(e.target.value); setWalkUpLookupDone(false); setWalkUpCustomerId(null); setWalkUpActiveRental(false); setWalkUpError('') }}
                disabled={walkUpLookupDone}
              />
              {walkUpLookupDone && (
                <button className="btn-secondary text-xs px-3" onClick={() => { setWalkUpLookupDone(false); setWalkUpCustomerId(null); setWalkUpActiveRental(false); setWalkUpError('') }}>
                  Change
                </button>
              )}
            </div>
          </div>

          {/* Lookup result */}
          {walkUpLookupDone && walkUpCustomerId && !walkUpActiveRental && (
            <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                 style={{ background: walkUpIsNew ? 'rgba(34,197,94,.08)' : 'rgba(99,102,241,.08)', border: `1px solid ${walkUpIsNew ? 'rgba(34,197,94,.2)' : 'rgba(99,102,241,.25)'}`, color: walkUpIsNew ? 'var(--success)' : 'var(--accent)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              {walkUpIsNew ? `New customer created: ${walkUpCustomerName}` : `Existing customer: ${walkUpCustomerName}`}
            </div>
          )}

          {walkUpActiveRental && (
            <div className="rounded-lg px-3 py-2 text-xs flex items-start gap-2"
                 style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,.25)', color: 'var(--danger)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {walkUpCustomerName} already has an active rental. A new checkout cannot be processed until the current rental is returned.
            </div>
          )}

          {/* New customer form */}
          {walkUpLookupDone && walkUpIsNew && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>First Name</label>
                  <input className="field-input w-full text-sm" placeholder="Jane" value={walkUpFirstName} onChange={e => setWalkUpFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Last Name</label>
                  <input className="field-input w-full text-sm" placeholder="Smith" value={walkUpLastName} onChange={e => setWalkUpLastName(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Phone</label>
                <input className="field-input w-full text-sm" placeholder="555-0100" value={walkUpPhone} onChange={e => setWalkUpPhone(e.target.value)} />
              </div>
            </div>
          )}

          {walkUpError && !walkUpActiveRental && (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>{walkUpError}</p>
          )}

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-2)' }}>Vehicle Class</label>
            <select className="field-input w-full text-sm" value={walkUpClassId} onChange={e => setWalkUpClassId(e.target.value)}>
              <option value="">Select class...</option>
              {classes.map(c => <option key={c.class_id} value={c.class_id}>{c.name}</option>)}
            </select>
          </div>

          <button
            className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
            disabled={!walkUpEmail || walkUpBusy || walkUpActiveRental || (walkUpLookupDone && walkUpIsNew && (!walkUpFirstName || !walkUpLastName || !walkUpPhone)) || (walkUpLookupDone && !!walkUpCustomerId && !walkUpClassId)}
            onClick={async () => {
              setWalkUpBusy(true)
              setWalkUpError('')

              try {
                if (!walkUpLookupDone) {
                  // Search by email, then exact-match (endpoint uses fulltext ?q=, not ?email=)
                  // Fulltext search then exact-match email (?email= is ignored by this endpoint)
                  const results: any[] = await fetchJSON(`/customers?q=${encodeURIComponent(walkUpEmail)}&limit=10`)
                  const emailLower = walkUpEmail.trim().toLowerCase()
                  const cust = results.find((c: any) => c.email?.toLowerCase() === emailLower)
                  if (cust) {
                    const name = `${cust.first_name} ${cust.last_name}`
                    setWalkUpCustomerId(cust.customer_id)
                    setWalkUpCustomerName(name)
                    setWalkUpIsNew(false)
                    // Check for active rental
                    const agreements: any[] = await fetchJSON(`/checkout/agreements?customer_id=${cust.customer_id}&status=ACTIVE`)
                    if (agreements.length > 0) {
                      setWalkUpActiveRental(true)
                    }
                    setWalkUpLookupDone(true)
                  } else {
                    // No exact match — new customer, show the creation form
                    setWalkUpIsNew(true)
                    setWalkUpLookupDone(true)
                  }
                  return
                }

                // Create new customer if needed
                if (walkUpIsNew && !walkUpCustomerId) {
                  const cust = await postJSON('/customers', {
                    first_name: walkUpFirstName,
                    last_name: walkUpLastName,
                    email: walkUpEmail,
                    phone: walkUpPhone,
                  })
                  setWalkUpCustomerId(cust.customer_id)
                  setWalkUpCustomerName(`${cust.first_name} ${cust.last_name}`)
                }

                if (!walkUpClassId) return
                setStep(1)
              } catch (err) {
                setWalkUpError(err instanceof Error ? err.message : 'Something went wrong')
              } finally {
                setWalkUpBusy(false)
              }
            }}
          >
            {walkUpBusy ? 'Checking...' : !walkUpLookupDone ? 'Look Up Customer' : walkUpIsNew && !walkUpCustomerId ? 'Create Customer & Continue' : 'Continue to Vehicle Selection'}
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-3)' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              className="field-input w-full pl-9 text-sm"
              placeholder="Search by confirmation number or customer name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {resLoading ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Loading reservations...</p>
          ) : filteredReservations().length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No CONFIRMED reservations found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredReservations().map(r => {
                const isSelected = selectedRes?.reservation_id === r.reservation_id
                return (
                  <div
                    key={r.reservation_id}
                    className="card p-4 transition-all"
                    style={{ border: isSelected ? '2px solid var(--accent)' : undefined, cursor: 'pointer' }}
                    onClick={() => setSelectedRes(r)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{r.confirmation_number}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{r.customer_name}</p>
                        <div className="flex gap-4 mt-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
                          <span>Pick-up: {fmtDate(r.pickup_date)}</span>
                          <span>Return: {fmtDate(r.return_date)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {!isSelected && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(99,102,241,.12)', color: 'var(--accent)' }}>
                            {r.class_name}
                          </span>
                        )}
                        {isSelected && (
                          <button
                            className="btn-primary text-xs px-4 py-1.5"
                            onClick={async e => {
                              e.stopPropagation()
                              try {
                                const detail = await fetchJSON(`/reservations/${r.reservation_id}`)
                                setSelectedResDetail(detail)
                              } catch { /* proceed without detail */ }
                              setStep(1)
                            }}
                          >
                            Continue
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )

  // ── Step 1: Select Vehicle ────────────────────────────────────────────────

  const renderStep1 = () => {
    const vehicles = vehiclesForClass()
    const hasMatch = vehicles.length > 0
    const allAvailable = availableVehicles

    return (
      <div className="space-y-4">
        {!isWalkUp && selectedRes && (
          <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--page-bg)', border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-3)' }}>Reservation: </span>
            <span className="font-medium" style={{ color: 'var(--text-1)' }}>{selectedRes.confirmation_number}</span>
            <span className="mx-2" style={{ color: 'var(--border)' }}>|</span>
            <span style={{ color: 'var(--text-3)' }}>Customer: </span>
            <span className="font-medium" style={{ color: 'var(--text-1)' }}>{selectedRes.customer_name}</span>
            <span className="mx-2" style={{ color: 'var(--border)' }}>|</span>
            <span style={{ color: 'var(--text-3)' }}>Class: </span>
            <span className="font-medium" style={{ color: 'var(--accent)' }}>{selectedRes.class_name}</span>
          </div>
        )}

        {!hasMatch && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', color: '#b45309' }}>
            No available vehicles match the reserved class. Showing all available vehicles — select a suitable upgrade.
          </div>
        )}

        <div className="space-y-2">
          {(hasMatch ? vehicles : allAvailable).map(v => {
            const isSelected = selectedVehicle?.vehicle_id === v.vehicle_id
            return (
              <div
                key={v.vehicle_id}
                className="card p-4 transition-all"
                style={{ border: isSelected ? '2px solid var(--accent)' : undefined, cursor: 'pointer' }}
                onClick={() => {
                  setSelectedVehicle(v)
                  if (v.odometer_current) setOdometerOut(String(v.odometer_current))
                  if (v.fuel_level_pct != null) setFuelLevelOut(Math.round(v.fuel_level_pct / 12.5))
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                      {v.model_year} {v.make} {v.model}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {v.plate_number ?? 'No plate'} · Odometer: {v.odometer_current?.toLocaleString() ?? '—'} mi
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {!isSelected && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(34,197,94,.1)', color: 'var(--success)' }}>
                        AVAILABLE
                      </span>
                    )}
                    {isSelected && (
                      <button
                        className="btn-primary text-xs px-4 py-1.5"
                        onClick={e => { e.stopPropagation(); setStep(2) }}
                      >
                        Continue
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {(hasMatch ? vehicles : allAvailable).length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No available vehicles found.</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary py-2.5 text-sm px-6" onClick={() => setStep(0)}>Back</button>
        </div>
      </div>
    )
  }

  // ── Step 2: Counter Details ───────────────────────────────────────────────

  const renderStep2 = () => (
    <div className="space-y-5">
      {selectedVehicle && (
        <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--page-bg)', border: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-3)' }}>Vehicle: </span>
          <span className="font-medium" style={{ color: 'var(--text-1)' }}>
            {selectedVehicle.model_year} {selectedVehicle.make} {selectedVehicle.model}
          </span>
          <span className="mx-2" style={{ color: 'var(--border)' }}>|</span>
          <span style={{ color: 'var(--text-3)' }}>Plate: </span>
          <span className="font-medium" style={{ color: 'var(--text-1)' }}>{selectedVehicle.plate_number ?? 'None'}</span>
        </div>
      )}

      <div>
        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
          Odometer Out (miles)
        </label>
        <input
          type="number"
          min={0}
          className="field-input w-full text-sm"
          placeholder="e.g. 12500"
          value={odometerOut}
          onChange={e => setOdometerOut(e.target.value)}
        />
      </div>

      <div>
        <label className="text-xs font-medium block mb-2" style={{ color: 'var(--text-2)' }}>
          Fuel Level at Departure
        </label>
        <FuelGauge value={fuelLevelOut} onChange={setFuelLevelOut} />
      </div>

      {extras.length > 0 && (
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: 'var(--text-2)' }}>
            Extras / Add-ons
          </label>
          <div className="grid grid-cols-2 gap-2">
            {extras.map((ex: Extra) => {
              const checked = selectedExtras.includes(ex.extra_id)
              return (
                <button
                  key={ex.extra_id}
                  type="button"
                  onClick={() => setSelectedExtras(prev =>
                    checked ? prev.filter(id => id !== ex.extra_id) : [...prev, ex.extra_id]
                  )}
                  className="flex items-center gap-2 rounded-lg p-2.5 text-left transition-colors"
                  style={{
                    border: checked ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                    background: checked ? 'rgba(99,102,241,.08)' : 'var(--card-bg)',
                  }}
                >
                  <div
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                    style={{
                      background: checked ? 'var(--accent)' : 'transparent',
                      border: checked ? 'none' : '1.5px solid var(--border)',
                    }}
                  >
                    {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  <div>
                    <p className="text-xs font-medium leading-tight" style={{ color: 'var(--text-1)' }}>{ex.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>${Number(ex.default_price).toFixed(2)}/day</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
          Agent Notes <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          className="field-input w-full text-sm"
          rows={3}
          placeholder="Any notes about vehicle condition, customer, etc."
          value={agentNotes}
          onChange={e => setAgentNotes(e.target.value)}
          maxLength={2000}
        />
      </div>

      <div className="flex gap-3 pt-1">
        <button className="btn-secondary flex-1 py-2.5 text-sm" onClick={() => setStep(1)}>Back</button>
        <button
          className="btn-primary flex-1 py-2.5 text-sm"
          disabled={!odometerOut}
          onClick={() => setStep(3)}
        >
          Review & Confirm
        </button>
      </div>
    </div>
  )

  // ── Step 3: Confirm ───────────────────────────────────────────────────────

  const selectedExtraNames = extras
    .filter((e: Extra) => selectedExtras.includes(e.extra_id))
    .map((e: Extra) => e.name)

  const renderStep3 = () => (
    <div className="space-y-5">
      <div className="rounded-lg divide-y" style={{ border: '1px solid var(--border)' }}>
        <Row label="Type" value={isWalkUp ? 'Walk-up Customer' : 'Pre-booked Reservation'} />
        {!isWalkUp && selectedRes && (
          <>
            <Row label="Confirmation" value={selectedRes.confirmation_number} accent />
            <Row label="Customer" value={selectedRes.customer_name} />
            <Row label="Vehicle Class" value={selectedRes.class_name} />
          </>
        )}
        {isWalkUp && (
          <>
            <Row label="Customer" value={`${walkUpFirstName} ${walkUpLastName}`} />
            <Row label="Vehicle Class" value={classes.find(c => c.class_id === walkUpClassId)?.name ?? walkUpClassId} />
          </>
        )}
        {selectedVehicle && (
          <>
            <Row label="Vehicle" value={`${selectedVehicle.model_year} ${selectedVehicle.make} ${selectedVehicle.model}`} />
            <Row label="Plate" value={selectedVehicle.plate_number ?? 'Not recorded'} />
          </>
        )}
        <Row label="Odometer Out" value={`${Number(odometerOut).toLocaleString()} mi`} />
        <Row
          label="Fuel Level Out"
          value={['Empty','1/8','1/4','3/8','1/2','5/8','3/4','7/8','Full'][fuelLevelOut]}
        />
        {selectedExtraNames.length > 0 && (
          <Row label="Extras" value={selectedExtraNames.join(', ')} />
        )}
        {agentNotes && <Row label="Agent Notes" value={agentNotes} />}
      </div>

      {checkoutMutation.isError && (
        <div className="rounded-lg px-3.5 py-3 text-sm" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,.25)', color: 'var(--danger)' }}>
          {checkoutMutation.error instanceof Error ? checkoutMutation.error.message : 'Checkout failed. Please try again.'}
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <button className="btn-secondary flex-1 py-2.5 text-sm" onClick={() => setStep(2)} disabled={checkoutMutation.isPending}>
          Back
        </button>
        <button
          className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
          disabled={checkoutMutation.isPending}
          onClick={() => checkoutMutation.mutate()}
        >
          {checkoutMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Processing...
            </span>
          ) : 'Confirm Checkout'}
        </button>
      </div>
    </div>
  )

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="page-root">
      <div style={{ padding: '0 2rem' }}>
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Counter Checkout</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            Process a vehicle checkout for a pre-booked or walk-up customer.
          </p>
        </div>

        <div className="card p-6">
          <StepIndicator current={step} steps={STEPS} />

          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </div>
      </div>
    </div>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start px-4 py-3 gap-4">
      <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="text-xs font-medium text-right" style={{ color: accent ? 'var(--accent)' : 'var(--text-1)' }}>{value}</span>
    </div>
  )
}
