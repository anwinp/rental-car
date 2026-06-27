import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@rcm/ui/auth'
import SignaturePad from 'signature_pad'

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
  total?: number
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

const TENANT = '00000000-0000-0000-0000-000000000001'

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

// ── ShiftSummaryBar ───────────────────────────────────────────────────────────

function ShiftSummaryBar() {
  const { data: confirmedRes } = useQuery<any[]>({
    queryKey: ['shift-confirmed'],
    queryFn: async () => {
      const res = await fetch('/api/v1/reservations?status=CONFIRMED', {
        credentials: 'include',
        headers: { 'X-Tenant-ID': TENANT },
      })
      if (!res.ok) return []
      const d = await res.json()
      return Array.isArray(d) ? d : (d.items ?? [])
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const { data: checkedOutRes } = useQuery<any[]>({
    queryKey: ['shift-checkedout'],
    queryFn: async () => {
      const res = await fetch('/api/v1/reservations?status=CHECKED_OUT', {
        credentials: 'include',
        headers: { 'X-Tenant-ID': TENANT },
      })
      if (!res.ok) return []
      const d = await res.json()
      return Array.isArray(d) ? d : (d.items ?? [])
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  const todayQueue = (confirmedRes ?? []).filter(r => {
    const pDate = r.pickup_datetime ?? r.pickup_date ?? ''
    return pDate.startsWith(todayStr)
  })

  const todayCheckouts = (checkedOutRes ?? []).filter(r => {
    const coDate = r.checked_out_at ?? r.pickup_datetime ?? r.pickup_date ?? ''
    return coDate.startsWith(todayStr)
  })

  const futurePickups = todayQueue
    .filter(r => new Date(r.pickup_datetime ?? r.pickup_date ?? 0) > now)
    .sort((a, b) => new Date(a.pickup_datetime ?? a.pickup_date ?? 0).getTime() - new Date(b.pickup_datetime ?? b.pickup_date ?? 0).getTime())

  const nextPickup = futurePickups[0]
  const nextPickupTime = nextPickup
    ? new Date(nextPickup.pickup_datetime ?? nextPickup.pickup_date ?? 0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null

  const shiftDate = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div style={{
      background: 'var(--card-bg)',
      border: '1px solid var(--border)',
      borderRadius: 0,
      padding: '0 20px',
      height: 48,
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      marginBottom: 20,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>SHIFT</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{shiftDate}</span>
      </div>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>QUEUE TODAY</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{todayQueue.length}</span>
      </div>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>DONE TODAY</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>{todayCheckouts.length}</span>
      </div>

      {nextPickupTime && (
        <>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>NEXT PICKUP</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#da291c' }}>{nextPickupTime}</span>
            {nextPickup.confirmation_number && (
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>{nextPickup.confirmation_number}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
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

// ── Location picker (when agent has multiple) ─────────────────────────────────

type Location = { location_id: string; short_code: string; city: string; name: string }

// ── Main Page ─────────────────────────────────────────────────────────────────

const STEPS = ['Find Reservation', 'Select Vehicle', 'Counter Details', 'Payment', 'Confirm']

export function CounterCheckoutPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null)
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
  const [paymentCardLast4, setPaymentCardLast4] = useState('')
  const [paymentCardType, setPaymentCardType] = useState('VISA')
  const [depositAmount, setDepositAmount] = useState('250.00')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sigPadRef = useRef<SignaturePad | null>(null)
  const [sigSaved, setSigSaved] = useState(false)
  const [sigError, setSigError] = useState('')

  useEffect(() => {
    if (step === 5 && canvasRef.current && !sigPadRef.current) {
      sigPadRef.current = new SignaturePad(canvasRef.current, {
        backgroundColor: '#ffffff',
        penColor: '#000000',
      })
    }
    if (step !== 5) {
      sigPadRef.current = null
    }
  }, [step])

  async function handleSaveSignature() {
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
      setSigError('Please sign before saving.')
      return
    }
    setSigError('')
    const dataUrl = sigPadRef.current.toDataURL('image/png')
    const raId = checkoutResult?.rental_agreement_id
    if (!raId) return

    try {
      const urlRes = await fetch('/api/v1/checkout/signature-upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
        body: JSON.stringify({ ra_id: raId }),
      })
      const { upload_url, s3_key } = await urlRes.json()

      const blob = await (await fetch(dataUrl)).blob()
      await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/png' } })

      const hashBuf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

      await fetch(`/api/v1/checkout/agreements/${raId}/signature`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
        body: JSON.stringify({ s3_key, signature_hash: hashHex }),
      })
      setSigSaved(true)
    } catch {
      setSigError('Failed to save signature. Please try again.')
    }
  }

  // ── Derive active location from user profile ──────────────────────────────

  const userLocationIds: string[] = (user?.location_ids ?? []).map(String)

  useEffect(() => {
    if (!activeLocationId && userLocationIds.length > 0) {
      setActiveLocationId(userLocationIds[0])
    }
  }, [userLocationIds.join(',')])

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: allLocations = [] } = useQuery<Location[]>({
    queryKey: ['locations-list'],
    queryFn: () => fetchJSON('/locations'),
  })

  const activeLocation = allLocations.find(l => l.location_id === activeLocationId)

  const locParam = activeLocationId ? `&location_id=${activeLocationId}` : ''

  const { data: reservations = [], isLoading: resLoading } = useQuery<Reservation[]>({
    queryKey: ['reservations-confirmed', activeLocationId],
    queryFn: () => fetchJSON(`/reservations/crm-list?status=CONFIRMED&limit=200${locParam}`),
    refetchInterval: 30000,
  })

  const { data: availableVehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['vehicles-available', activeLocationId],
    queryFn: () => fetchJSON(`/fleet/vehicles?status=AVAILABLE&limit=200${activeLocationId ? `&location_id=${activeLocationId}` : ''}`),
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
      setStep(5)
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  const customerName = isWalkUp
    ? `${walkUpFirstName} ${walkUpLastName}`.trim()
    : (selectedRes?.customer_name ?? '')
  const customerEmail = isWalkUp ? walkUpEmail : (selectedRes?.customer_email ?? '')
  const returnDate = isWalkUp ? '' : (selectedRes?.return_date ?? '')

  const resetAll = () => {
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
    setPaymentCardLast4('')
    setPaymentCardType('VISA')
    setDepositAmount('250.00')
    setSigSaved(false)
    setSigError('')
    sigPadRef.current = null
  }

  // ── Completed — Rental Contract ───────────────────────────────────────────

  if (step === 5 && checkoutResult) {
    const checkedOutAt = new Date(checkoutResult.checked_out_at)
    const locationLabel = activeLocation
      ? `${activeLocation.city || activeLocation.name}${activeLocation.short_code ? ` (${activeLocation.short_code})` : ''}`
      : 'Counter'
    const vehicleLabel = selectedVehicle
      ? `${selectedVehicle.model_year} ${selectedVehicle.make} ${selectedVehicle.model}`
      : ''
    const extrasList = extras
      .filter((e: Extra) => selectedExtras.includes(e.extra_id))
      .map((e: Extra) => ({ name: e.name, price: Number(e.default_price) }))

    const printContract = () => {
      const w = window.open('', '_blank', 'width=800,height=1000')
      if (!w) return
      w.document.write(`<!DOCTYPE html><html><head><title>Rental Agreement ${checkoutResult.ra_number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 12px; color: #111; padding: 32px; max-width: 750px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #444; margin: 20px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #111; padding-bottom: 16px; }
  .ra-number { font-size: 20px; font-weight: 800; color: #1a1a8c; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .field { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #e0e0e0; }
  .label { color: #555; }
  .val { font-weight: 600; text-align: right; }
  .terms { font-size: 10px; color: #555; line-height: 1.5; margin-top: 8px; }
  .sig-block { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 32px; }
  .sig-line { border-bottom: 1.5px solid #111; margin-bottom: 4px; height: 40px; }
  .sig-label { font-size: 10px; color: #555; }
  .badge { display: inline-block; background: #e8eaff; color: #1a1a8c; font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 3px; }
  @media print { body { padding: 16px; } button { display: none; } }
</style></head><body>
<div class="header">
  <div>
    <h1>RCM Rentals</h1>
    <div style="font-size:11px;color:#666;margin-top:4px">${locationLabel}</div>
  </div>
  <div style="text-align:right">
    <div class="ra-number">${checkoutResult.ra_number}</div>
    <div style="font-size:11px;color:#666;margin-top:2px">RENTAL AGREEMENT</div>
    <div style="font-size:11px;color:#666">${checkedOutAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
  </div>
</div>

<h2>Customer</h2>
<div class="grid-2">
  <div class="field"><span class="label">Name</span><span class="val">${customerName}</span></div>
  <div class="field"><span class="label">Email</span><span class="val">${customerEmail || '—'}</span></div>
</div>

<h2>Vehicle</h2>
<div class="grid-2">
  <div class="field"><span class="label">Vehicle</span><span class="val">${vehicleLabel}</span></div>
  <div class="field"><span class="label">Plate</span><span class="val">${selectedVehicle?.plate_number ?? '—'}</span></div>
  <div class="field"><span class="label">VIN</span><span class="val">${checkoutResult.vin}</span></div>
  <div class="field"><span class="label">Odometer Out</span><span class="val">${Number(odometerOut).toLocaleString()} mi</span></div>
  <div class="field"><span class="label">Fuel Level</span><span class="val">${['Empty','1/8','1/4','3/8','1/2','5/8','3/4','7/8','Full'][fuelLevelOut]}</span></div>
</div>

<h2>Rental Period</h2>
<div class="grid-2">
  <div class="field"><span class="label">Check-out</span><span class="val">${checkedOutAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
  ${returnDate ? `<div class="field"><span class="label">Return by</span><span class="val">${new Date(returnDate).toLocaleDateString('en-US', { dateStyle: 'medium' })}</span></div>` : ''}
  <div class="field"><span class="label">Pickup Location</span><span class="val">${locationLabel}</span></div>
  ${!isWalkUp && selectedRes?.confirmation_number ? `<div class="field"><span class="label">Confirmation #</span><span class="val">${selectedRes.confirmation_number}</span></div>` : ''}
</div>

<h2>Payment</h2>
<div class="grid-2">
  <div class="field"><span class="label">Security Deposit</span><span class="val">$${Number(depositAmount).toFixed(2)}</span></div>
  <div class="field"><span class="label">Card</span><span class="val">${paymentCardType} ···· ${paymentCardLast4 || '????'}</span></div>
  <div class="field"><span class="label">Pre-Auth Status</span><span class="val"><span class="badge">CAPTURED</span></span></div>
  <div class="field"><span class="label">Balance Due</span><span class="val">At return</span></div>
</div>

${extrasList.length > 0 ? `<h2>Add-ons</h2><div class="grid-2">${extrasList.map(e => `<div class="field"><span class="label">${e.name}</span><span class="val">$${e.price.toFixed(2)}/day</span></div>`).join('')}</div>` : ''}

${agentNotes ? `<h2>Agent Notes</h2><p style="font-size:11px;color:#444;margin-top:4px">${agentNotes}</p>` : ''}

<h2>Terms &amp; Conditions</h2>
<p class="terms">The renter agrees to return the vehicle in the same condition as received, with the same fuel level, to the designated location by the agreed return date. Renter is liable for all damages, traffic violations, and tolls incurred during the rental period. The security deposit will be released upon satisfactory return of the vehicle. Renter must be at least 21 years of age and hold a valid driver's license. Smoking, off-road use, and towing are prohibited. Additional charges apply for late returns, excessive mileage, and fuel discrepancies.</p>

<div class="sig-block">
  <div>
    <div class="sig-line"></div>
    <div class="sig-label">Customer Signature &amp; Date</div>
  </div>
  <div>
    <div class="sig-line"></div>
    <div class="sig-label">Agent Signature &amp; Date — ${user?.first_name ?? ''} ${user?.last_name ?? ''}</div>
  </div>
</div>

<div style="margin-top:32px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:12px">
  RCM Fleet Management · Agreement ${checkoutResult.ra_number} · Printed ${new Date().toLocaleString()}
</div>
<script>window.onload=()=>window.print()</script>
</body></html>`)
      w.document.close()
    }

    return (
      <div className="page-root" style={{ padding: '2rem' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          {/* Success banner */}
          <div className="flex items-center gap-3 rounded-lg px-4 py-3 mb-6"
               style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)' }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                 style={{ background: 'rgba(34,197,94,.15)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Checkout complete</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Agreement {checkoutResult.ra_number} is active</p>
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn-primary text-xs px-4 py-1.5" onClick={printContract}>
                Print Contract
              </button>
              <button className="btn-secondary text-xs px-4 py-1.5" onClick={resetAll}>
                New Checkout
              </button>
            </div>
          </div>

          {/* Contract preview */}
          <div className="card p-6 space-y-5" style={{ fontFamily: 'system-ui, sans-serif' }}>
            {/* Header */}
            <div className="flex items-start justify-between pb-4" style={{ borderBottom: '2px solid var(--border)' }}>
              <div>
                <p className="text-xl font-black tracking-widest uppercase" style={{ color: 'var(--text-1)' }}>RCM Rentals</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{locationLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black" style={{ color: 'var(--accent)' }}>{checkoutResult.ra_number}</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>RENTAL AGREEMENT</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>{checkedOutAt.toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
              </div>
            </div>

            {/* Customer */}
            <Section label="Customer">
              <Row label="Name" value={customerName} accent />
              {customerEmail && <Row label="Email" value={customerEmail} />}
            </Section>

            {/* Vehicle */}
            <Section label="Vehicle">
              <Row label="Vehicle" value={vehicleLabel} />
              <Row label="Plate" value={selectedVehicle?.plate_number ?? '—'} />
              <Row label="VIN" value={checkoutResult.vin} />
              <Row label="Odometer Out" value={`${Number(odometerOut).toLocaleString()} mi`} />
              <Row label="Fuel Level" value={['Empty','1/8','1/4','3/8','1/2','5/8','3/4','7/8','Full'][fuelLevelOut]} />
            </Section>

            {/* Rental Period */}
            <Section label="Rental Period">
              <Row label="Check-out" value={fmtDate(checkoutResult.checked_out_at)} />
              {returnDate && <Row label="Return by" value={new Date(returnDate).toLocaleDateString('en-US', { dateStyle: 'medium' })} />}
              <Row label="Location" value={locationLabel} />
              {!isWalkUp && selectedRes?.confirmation_number && (
                <Row label="Confirmation #" value={selectedRes.confirmation_number} />
              )}
            </Section>

            {/* Payment */}
            <Section label="Payment">
              <Row label="Security Deposit" value={`$${Number(depositAmount).toFixed(2)}`} />
              <Row label="Card" value={`${paymentCardType} ···· ${paymentCardLast4 || '????'}`} />
              <Row label="Pre-Auth" value="CAPTURED" accent />
              <Row label="Balance Due" value="Calculated at return" />
            </Section>

            {/* Add-ons */}
            {extrasList.length > 0 && (
              <Section label="Add-ons">
                {extrasList.map(e => (
                  <Row key={e.name} label={e.name} value={`$${e.price.toFixed(2)}/day`} />
                ))}
              </Section>
            )}

            {agentNotes && (
              <Section label="Agent Notes">
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>{agentNotes}</p>
              </Section>
            )}

            {/* Terms */}
            <Section label="Terms & Conditions">
              <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                The renter agrees to return the vehicle in the same condition as received, with the same fuel level, to the designated location by the agreed return date. Renter is liable for all damages, traffic violations, and tolls incurred during the rental period. The security deposit will be released upon satisfactory return. Renter must hold a valid driver's license. Smoking and off-road use are prohibited.
              </p>
            </Section>

            {/* Signatures */}
            <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Customer Signature</p>
              {!sigSaved ? (
                <>
                  <canvas ref={canvasRef} width={400} height={120}
                    style={{ border: '1.5px solid var(--text-1)', display: 'block', background: '#fff', touchAction: 'none' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" onClick={() => sigPadRef.current?.clear()}
                      style={{ height: 36, padding: '0 16px', fontSize: 12, background: 'var(--card-bg)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}>
                      Clear
                    </button>
                    <button type="button" onClick={handleSaveSignature}
                      style={{ height: 36, padding: '0 16px', fontSize: 12, fontWeight: 700, background: '#da291c', color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.4px' }}>
                      Save Signature
                    </button>
                  </div>
                  {sigError && <p style={{ fontSize: 12, color: '#da291c', marginTop: 4 }}>{sigError}</p>}
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>Signature saved</p>
              )}
            </div>
            <div className="grid grid-cols-1 pt-2">
              <p className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                Agent: {user?.first_name} {user?.last_name}
              </p>
            </div>

            <p className="text-[10px] text-center pt-2" style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
              RCM Fleet Management · Agreement {checkoutResult.ra_number} · {checkedOutAt.toLocaleString()}
            </p>
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

  // ── Step 3: Payment ──────────────────────────────────────────────────────

  const renderStep3 = () => {
    const cardTypes = ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER']
    const canProceed = paymentCardLast4.length === 4 && /^\d{4}$/.test(paymentCardLast4)

    return (
      <div className="space-y-5">
        {/* Context bar */}
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

        {/* Pre-auth / deposit */}
        <div className="rounded-lg p-4 space-y-4" style={{ border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Security Deposit (Pre-Authorization)</h3>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(245,158,11,.1)', color: '#b45309' }}>
              Hold — not charged
            </span>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
              Deposit Amount ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="field-input w-full text-sm"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
            />
            <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-3)' }}>
              Standard deposit is $250. Adjust for premium vehicles or corporate accounts.
            </p>
          </div>
        </div>

        {/* Card details */}
        <div className="rounded-lg p-4 space-y-4" style={{ border: '1px solid var(--border)', background: 'var(--card-bg)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Payment Method</h3>

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>Card Type</label>
            <div className="flex gap-2">
              {cardTypes.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPaymentCardType(t)}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg transition-colors"
                  style={{
                    border: paymentCardType === t ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                    background: paymentCardType === t ? 'rgba(99,102,241,.08)' : 'var(--page-bg)',
                    color: paymentCardType === t ? 'var(--accent)' : 'var(--text-2)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
              Last 4 Digits
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              className="field-input w-full text-sm tracking-widest"
              placeholder="0000"
              value={paymentCardLast4}
              onChange={e => setPaymentCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </div>

          <div className="rounded-lg px-3 py-2.5 text-xs flex items-start gap-2"
               style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)', color: 'var(--text-2)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" className="mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            Card is swiped/tapped at the terminal. Only the last 4 digits are recorded here for reference. Full payment is settled at vehicle return.
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button className="btn-secondary flex-1 py-2.5 text-sm" onClick={() => setStep(2)}>Back</button>
          <button
            className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50"
            disabled={!canProceed}
            onClick={() => setStep(4)}
          >
            Payment Collected — Review & Confirm
          </button>
        </div>
      </div>
    )
  }

  // ── Step 4: Confirm ───────────────────────────────────────────────────────

  const selectedExtraNames = extras
    .filter((e: Extra) => selectedExtras.includes(e.extra_id))
    .map((e: Extra) => e.name)

  const renderStep4 = () => (
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
        <Row label="Payment" value={`${paymentCardType} ···· ${paymentCardLast4}`} />
        <Row label="Deposit" value={`$${Number(depositAmount).toFixed(2)} pre-auth`} />
      </div>

      {checkoutMutation.isError && (
        <div className="rounded-lg px-3.5 py-3 text-sm" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,.25)', color: 'var(--danger)' }}>
          {checkoutMutation.error instanceof Error ? checkoutMutation.error.message : 'Checkout failed. Please try again.'}
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <button className="btn-secondary flex-1 py-2.5 text-sm" onClick={() => setStep(3)} disabled={checkoutMutation.isPending}>
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

  const agentLocations = allLocations.filter(l => userLocationIds.includes(l.location_id))

  if (userLocationIds.length === 0) {
    return (
      <div className="page-root" style={{ padding: '2rem' }}>
        <div className="card p-8 text-center" style={{ maxWidth: 480, margin: '0 auto' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.75" className="mx-auto mb-3">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-1)' }}>No Location Assigned</h2>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            Your account has not been assigned to a location yet. Contact your branch manager to get set up.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-root">
      <ShiftSummaryBar />
      <div style={{ padding: '0 2rem' }}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Counter Checkout</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
              Process a vehicle checkout for a pre-booked or walk-up customer.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {agentLocations.length > 1 ? (
              <select
                className="field-input text-sm py-1.5 px-3"
                value={activeLocationId ?? ''}
                onChange={e => { setActiveLocationId(e.target.value); setStep(0); setSelectedRes(null) }}
              >
                {agentLocations.map(l => (
                  <option key={l.location_id} value={l.location_id}>
                    {l.city || l.name || l.short_code}
                  </option>
                ))}
              </select>
            ) : activeLocation && (
              <div className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                   style={{ background: 'rgba(99,102,241,.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,.2)' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                {activeLocation.city || activeLocation.name || activeLocation.short_code}
              </div>
            )}
          </div>
        </div>

        <div className="card p-6">
          <StepIndicator current={step} steps={STEPS} />

          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>
      </div>
    </div>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start px-4 py-3 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="text-xs font-medium text-right" style={{ color: accent ? 'var(--accent)' : 'var(--text-1)' }}>{value}</span>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-2"
         style={{ color: 'var(--text-3)' }}>{label}</p>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {children}
      </div>
    </div>
  )
}
