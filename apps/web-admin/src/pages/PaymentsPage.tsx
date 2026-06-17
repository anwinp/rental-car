import { useState, useMemo, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type RentalAgreement = {
  ra_id: string
  ra_number: string
  reservation_id: string | null
  customer_id: string | null
  vehicle_id: string | null
  status: string
  odometer_out: number | null
  fuel_level_out_pct: number | null
  odometer_in: number | null
  fuel_level_in_pct: number | null
  actual_return_datetime: string | null
  extras_snapshot: { name: string; price?: string | number }[]
  preauth_id: string | null
  preauth_amount: string | number | null
  agent_notes: string | null
  created_at: string
}

type CrmReservation = {
  reservation_id: string
  confirmation_number: string
  customer_name: string
  customer_email: string
  pickup_date: string
  return_date: string
  class_name: string
  status: string
  total: number | null
  assigned_vehicle: string | null
}

type ReservationDetail = {
  reservation_id: string
  grand_total: string | number | null
  base_total: string | number | null
  extras_total: string | number | null
  taxes_snapshot: { description?: string; amount?: string | number; unit_price?: string | number; quantity?: string | number; type?: string }[]
  extras_snapshot: { name: string; price?: string | number }[]
}

type Payment = {
  payment_id: string
  rental_agreement_id: string | null
  reservation_id: string | null
  payment_type: string
  payment_method: string
  status: string
  amount: string | number
  currency: string
  refunded_amount: string | number
  card_last4: string | null
  card_brand: string | null
  authorized_at: string | null
  captured_at: string | null
  auth_expiry_at: string | null
  gateway_payment_id: string | null
}

type CaptureResponse = {
  payment_id: string
  captured_amount: string | number
  stripe_charge_id: string
  captured_at: string
  receipt_url: string | null
}

type Step = 1 | 2 | 3

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT = import.meta.env.VITE_TENANT_ID ?? ''

// ── API helpers ───────────────────────────────────────────────────────────────

async function getJSON(path: string) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { 'X-Tenant-ID': TENANT },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`)
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
    throw new Error((data as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0
  return Number(v)
}

function fmt(v: number): string {
  return v.toFixed(2)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  const steps = ['Find Rental', 'Review Charges', 'Receipt']
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const n = (i + 1) as Step
        const done = step > n
        const active = step === n
        return (
          <div key={n} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold shrink-0"
                style={{
                  background: done ? '#10b981' : active ? 'var(--accent)' : 'var(--border)',
                  color: done || active ? '#fff' : 'var(--text-3)',
                }}
              >
                {done ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : n}
              </div>
              <span
                className="text-[11.5px] font-medium hidden sm:block truncate"
                style={{ color: active ? 'var(--text-1)' : done ? '#10b981' : 'var(--text-3)' }}
              >
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function ChargeRow({
  label,
  value,
  onChange,
  readonly,
  highlight,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  readonly?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2" style={{ borderBottom: '1px solid var(--border-sub)' }}>
      <span className="text-[12px]" style={{ color: highlight ? '#d97706' : 'var(--text-2)' }}>
        {label}
      </span>
      {readonly ? (
        <span className="text-[12px] font-semibold num" style={{ color: highlight ? '#d97706' : 'var(--text-1)' }}>
          ${value}
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={e => onChange?.(e.target.value)}
            className="field-input h-7 w-24 px-2 text-[12px] num text-right"
          />
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PaymentsPage() {
  const qc = useQueryClient()

  const [step, setStep] = useState<Step>(1)
  const [search, setSearch] = useState('')

  const [selectedRes, setSelectedRes] = useState<CrmReservation | null>(null)
  const [selectedRA, setSelectedRA] = useState<RentalAgreement | null>(null)
  const [resDet, setResDet] = useState<ReservationDetail | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadingSelection, setLoadingSelection] = useState(false)

  const [baseAmount, setBaseAmount] = useState('0.00')
  const [extrasAmount, setExtrasAmount] = useState('0.00')
  const [timeExtAmount, setTimeExtAmount] = useState('0.00')
  const [fuelAmount, setFuelAmount] = useState('0.00')
  const [mileageAmount, setMileageAmount] = useState('0.00')
  const [damageAmount, setDamageAmount] = useState('0.00')
  const [depositPaid, setDepositPaid] = useState('0.00')

  const [captureResult, setCaptureResult] = useState<CaptureResponse | null>(null)
  const [capturedPayment, setCapturedPayment] = useState<Payment | null>(null)

  const [showRefund, setShowRefund] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4500)
  }

  const { data: returnedReservations = [], isLoading: loadingList } = useQuery<CrmReservation[]>({
    queryKey: ['returned-reservations'],
    queryFn: () => getJSON('/reservations/crm-list?status=RETURNED&limit=200'),
    staleTime: 30_000,
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return returnedReservations
    const q = search.toLowerCase()
    return returnedReservations.filter(
      r =>
        r.confirmation_number.toLowerCase().includes(q) ||
        r.customer_name.toLowerCase().includes(q) ||
        r.customer_email.toLowerCase().includes(q) ||
        (r.assigned_vehicle ?? '').toLowerCase().includes(q),
    )
  }, [returnedReservations, search])

  const totalCharge = useMemo(
    () =>
      toNum(baseAmount) +
      toNum(extrasAmount) +
      toNum(timeExtAmount) +
      toNum(fuelAmount) +
      toNum(mileageAmount) +
      toNum(damageAmount),
    [baseAmount, extrasAmount, timeExtAmount, fuelAmount, mileageAmount, damageAmount],
  )

  const finalDue = Math.max(0, totalCharge - toNum(depositPaid))

  const authorizedPayment = payments.find(p => p.status === 'AUTHORIZED' && p.payment_type === 'PREAUTH')

  async function selectReservation(res: CrmReservation) {
    setLoadingSelection(true)
    try {
      const [ras, det, pmts] = await Promise.all([
        getJSON(`/checkout/agreements?reservation_id=${res.reservation_id}&status=RETURNED`) as Promise<RentalAgreement[]>,
        getJSON(`/reservations/${res.reservation_id}`) as Promise<ReservationDetail>,
        getJSON(`/payments/reservation/${res.reservation_id}`) as Promise<Payment[]>,
      ])

      const ra: RentalAgreement | null = ras[0] ?? null
      setSelectedRes(res)
      setSelectedRA(ra)
      setResDet(det)
      setPayments(pmts)

      const base = toNum(det.grand_total ?? det.base_total ?? res.total)
      const extras = toNum(det.extras_total)
      const preauth = pmts.find(p => p.payment_type === 'PREAUTH')

      setBaseAmount(fmt(base))
      setExtrasAmount(fmt(extras))
      setTimeExtAmount('0.00')
      setFuelAmount('0.00')
      setMileageAmount('0.00')
      setDamageAmount('0.00')
      setDepositPaid(preauth ? fmt(toNum(preauth.amount)) : '0.00')

      setStep(2)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load rental details', false)
    } finally {
      setLoadingSelection(false)
    }
  }

  const captureMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRA) throw new Error('No rental agreement selected')
      if (!authorizedPayment) throw new Error('No authorized pre-auth found for this rental. Payment capture requires a pre-authorized payment intent.')

      const lineItems = [
        { description: 'Base rental', amount: toNum(baseAmount), type: 'BASE' },
        ...(toNum(extrasAmount) > 0 ? [{ description: 'Extras / add-ons', amount: toNum(extrasAmount), type: 'EXTRAS' }] : []),
        ...(toNum(timeExtAmount) > 0 ? [{ description: 'Time extension charge', amount: toNum(timeExtAmount), type: 'TIME_EXTENSION' }] : []),
        ...(toNum(fuelAmount) > 0 ? [{ description: 'Fuel surcharge', amount: toNum(fuelAmount), type: 'FUEL' }] : []),
        ...(toNum(mileageAmount) > 0 ? [{ description: 'Mileage overage', amount: toNum(mileageAmount), type: 'MILEAGE' }] : []),
        ...(toNum(damageAmount) > 0 ? [{ description: 'Damage charge', amount: toNum(damageAmount), type: 'DAMAGE' }] : []),
      ]

      const result: CaptureResponse = await postJSON('/payments/capture', {
        payment_id: authorizedPayment.payment_id,
        rental_agreement_id: selectedRA.ra_id,
        base_rental_amount: toNum(baseAmount).toFixed(2),
        extras_amount: toNum(extrasAmount).toFixed(2),
        time_extension_amount: toNum(timeExtAmount).toFixed(2),
        fuel_charge_amount: toNum(fuelAmount).toFixed(2),
        mileage_overage_amount: toNum(mileageAmount).toFixed(2),
        damage_charge_amount: toNum(damageAmount).toFixed(2),
        deposit_already_paid: toNum(depositPaid).toFixed(2),
        line_items: lineItems,
      })

      const updatedPayments: Payment[] = await getJSON(`/payments/reservation/${selectedRes!.reservation_id}`)
      const captured = updatedPayments.find(p => p.payment_id === result.payment_id || p.status === 'CAPTURED') ?? null
      setCapturedPayment(captured)

      return result
    },
    onSuccess: result => {
      setCaptureResult(result)
      setStep(3)
      qc.invalidateQueries({ queryKey: ['returned-reservations'] })
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  const refundMutation = useMutation({
    mutationFn: async () => {
      const target = capturedPayment ?? payments.find(p => p.status === 'CAPTURED')
      if (!target) throw new Error('No captured payment to refund')
      if (!refundReason.trim()) throw new Error('Refund reason is required')
      const amt = toNum(refundAmount)
      if (amt <= 0) throw new Error('Enter a valid refund amount')

      const me: { user_id?: string } = await getJSON('/auth/me').catch(() => ({}))
      const initiatedBy = me.user_id ?? '00000000-0000-0000-0001-000000000001'

      return postJSON('/payments/refund', {
        payment_id: target.payment_id,
        amount: amt.toFixed(2),
        reason: refundReason,
        initiated_by: initiatedBy,
      })
    },
    onSuccess: () => {
      showToast('Refund submitted successfully', true)
      setShowRefund(false)
      setRefundAmount('')
      setRefundReason('')
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  function reset() {
    setStep(1)
    setSearch('')
    setSelectedRes(null)
    setSelectedRA(null)
    setResDet(null)
    setPayments([])
    setCaptureResult(null)
    setCapturedPayment(null)
    setShowRefund(false)
    setRefundAmount('')
    setRefundReason('')
  }

  const milesDriven = selectedRA
    ? Math.max(0, toNum(selectedRA.odometer_in) - toNum(selectedRA.odometer_out))
    : 0

  const fuelDeficit = selectedRA
    ? Math.max(0, toNum(selectedRA.fuel_level_out_pct) - toNum(selectedRA.fuel_level_in_pct))
    : 0

  return (
    <div className="space-y-5 max-w-4xl">
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: toast.ok ? 'rgba(16,185,129,0.15)' : 'var(--danger-bg)',
            color: toast.ok ? '#10b981' : 'var(--danger)',
            border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
          Payment Capture
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          Capture final payment and issue receipts for returned rentals
        </p>
      </div>

      <StepBar step={step} />

      {/* ── Step 1: Find Rental ── */}
      {step === 1 && (
        <div className="panel p-5 space-y-4">
          <div>
            <SectionLabel>Returned Rentals Awaiting Payment</SectionLabel>
            <p className="text-[12px] mb-3" style={{ color: 'var(--text-3)' }}>
              {loadingList
                ? 'Loading...'
                : `${returnedReservations.length} returned rental${returnedReservations.length !== 1 ? 's' : ''} — search by RA number, customer name, or email`}
            </p>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="search"
                placeholder="Search by confirmation, customer, email, or plate..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="field-input h-9 pl-8 text-[13px] w-full"
              />
            </div>
          </div>

          {filtered.length === 0 && !loadingList && (
            <div className="py-12 text-center" style={{ color: 'var(--text-3)' }}>
              <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
              <p className="text-[13px]">
                {search ? 'No rentals match your search' : 'No returned rentals awaiting payment capture'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            {filtered.map(res => (
              <button
                key={res.reservation_id}
                type="button"
                disabled={loadingSelection}
                onClick={() => selectReservation(res)}
                className="w-full text-left rounded-lg px-4 py-3.5 transition-colors"
                style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {res.customer_name}
                      </span>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {res.confirmation_number}
                      </span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}
                      >
                        RETURNED
                      </span>
                    </div>
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {res.class_name}
                      {res.assigned_vehicle ? ` · ${res.assigned_vehicle}` : ''}
                      {' · '}Returned {new Date(res.return_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>
                      {res.total != null ? `$${toNum(res.total).toFixed(2)}` : '—'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{res.customer_email}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {loadingSelection && (
            <p className="text-[12px] text-center py-4" style={{ color: 'var(--text-3)' }}>
              Loading rental details...
            </p>
          )}
        </div>
      )}

      {/* ── Step 2: Review Charges ── */}
      {step === 2 && selectedRes && (
        <div className="space-y-4">
          {/* Rental summary */}
          <div className="panel px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
                  Rental
                </p>
                <p className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>{selectedRes.customer_name}</p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {selectedRes.confirmation_number} · {selectedRes.class_name}
                  {selectedRes.assigned_vehicle ? ` · ${selectedRes.assigned_vehicle}` : ''}
                </p>
              </div>
              <div className="text-right">
                {selectedRA ? (
                  <>
                    <span className="badge-green">RA Found</span>
                    <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-3)' }}>
                      {selectedRA.ra_number}
                    </p>
                  </>
                ) : (
                  <span className="badge-amber">No RA on file</span>
                )}
              </div>
            </div>

            {selectedRA && (
              <div className="mt-3 grid grid-cols-4 gap-3 text-center" style={{ borderTop: '1px solid var(--border-sub)', paddingTop: 12 }}>
                {[
                  { label: 'Returned', value: selectedRA.actual_return_datetime ? new Date(selectedRA.actual_return_datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
                  { label: 'Miles Driven', value: `${milesDriven.toLocaleString()} mi` },
                  { label: 'Fuel Delta', value: fuelDeficit > 0 ? `-${fuelDeficit}%` : 'No deficit' },
                  { label: 'Pre-auth', value: authorizedPayment ? `$${fmt(toNum(authorizedPayment.amount))}` : 'None' },
                ].map(s => (
                  <div key={s.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--text-3)' }}>
                      {s.label}
                    </p>
                    <p className="text-[12px] font-semibold num" style={{ color: 'var(--text-1)' }}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment status info */}
          {!authorizedPayment && (
            <div
              className="panel px-4 py-3 flex items-start gap-3"
              style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p className="text-[12px]" style={{ color: '#d97706' }}>
                No authorized pre-auth payment found for this rental. Payment capture requires a pre-authorized Stripe PaymentIntent. Review your payment gateway configuration or the customer's booking.
              </p>
            </div>
          )}

          {authorizedPayment && (
            <div
              className="panel px-4 py-3 flex items-start gap-3"
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" className="mt-0.5 shrink-0">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <p className="text-[12px]" style={{ color: '#10b981' }}>
                Pre-auth hold of ${fmt(toNum(authorizedPayment.amount))} {authorizedPayment.currency}{' '}
                {authorizedPayment.card_brand ? `on ${authorizedPayment.card_brand}` : ''}
                {authorizedPayment.card_last4 ? ` ****${authorizedPayment.card_last4}` : ''} — ready to capture
              </p>
            </div>
          )}

          {/* Charge breakdown */}
          <div className="panel px-5 py-4">
            <SectionLabel>Charge Breakdown</SectionLabel>
            <p className="text-[11.5px] mb-3" style={{ color: 'var(--text-3)' }}>
              Review and adjust amounts before capturing payment.
            </p>

            <ChargeRow label="Base rental" value={baseAmount} onChange={setBaseAmount} />
            <ChargeRow label="Extras / add-ons" value={extrasAmount} onChange={setExtrasAmount} />
            <ChargeRow label="Time extension charge" value={timeExtAmount} onChange={setTimeExtAmount} highlight={toNum(timeExtAmount) > 0} />
            <ChargeRow label="Fuel surcharge" value={fuelAmount} onChange={setFuelAmount} highlight={toNum(fuelAmount) > 0} />
            <ChargeRow label="Mileage overage" value={mileageAmount} onChange={setMileageAmount} highlight={toNum(mileageAmount) > 0} />
            <ChargeRow label="Damage charge" value={damageAmount} onChange={setDamageAmount} highlight={toNum(damageAmount) > 0} />

            <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <ChargeRow label="Deposit / pre-auth already held" value={depositPaid} onChange={setDepositPaid} readonly />
              <div className="flex items-center justify-between gap-4 pt-3">
                <span className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>Total to Capture</span>
                <span className="text-[18px] font-bold num" style={{ color: 'var(--accent)' }}>
                  ${fmt(totalCharge)}
                </span>
              </div>
              {toNum(depositPaid) > 0 && (
                <div className="flex items-center justify-between gap-4 pt-1">
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>Net due after deposit</span>
                  <span className="text-[13px] font-semibold num" style={{ color: finalDue > 0 ? 'var(--text-1)' : '#10b981' }}>
                    ${fmt(finalDue)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Reservation line items if available */}
          {resDet && resDet.taxes_snapshot && resDet.taxes_snapshot.length > 0 && (
            <div className="panel px-5 py-4">
              <SectionLabel>Reservation Rate Breakdown (reference)</SectionLabel>
              <div className="mt-1 space-y-1">
                {resDet.taxes_snapshot.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 py-1" style={{ borderBottom: '1px solid var(--border-sub)' }}>
                    <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      {item.description ?? item.type}
                    </span>
                    <span className="text-[12px] font-medium num" style={{ color: 'var(--text-1)' }}>
                      ${fmt(toNum(item.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={reset} className="btn-secondary">
              Back
            </button>
            <button
              type="button"
              disabled={captureMutation.isPending || !authorizedPayment}
              onClick={() => captureMutation.mutate()}
              className="btn-primary"
              title={!authorizedPayment ? 'No authorized pre-auth found' : undefined}
            >
              {captureMutation.isPending ? 'Capturing...' : `Capture $${fmt(totalCharge)}`}
            </button>
          </div>

          {captureMutation.isError && (
            <div
              className="rounded-lg px-3.5 py-3 text-[12px]"
              style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)' }}
            >
              {captureMutation.error instanceof Error ? captureMutation.error.message : 'Capture failed'}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Receipt ── */}
      {step === 3 && captureResult && selectedRes && (
        <div className="space-y-4">
          {/* Success header */}
          <div className="panel px-6 py-6 text-center space-y-3">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full mx-auto"
              style={{ background: 'rgba(16,185,129,0.15)' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>Payment Captured</h2>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
                ${fmt(toNum(captureResult.captured_amount))} captured at{' '}
                {new Date(captureResult.captured_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {/* Invoice */}
          <div className="panel px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <SectionLabel>Invoice</SectionLabel>
              <button
                type="button"
                className="btn-secondary text-[11px] px-3 py-1.5 flex items-center gap-1.5"
                onClick={() => showToast('PDF download is not yet available', false)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download PDF
              </button>
            </div>

            <div className="space-y-0.5">
              {[
                { label: 'Invoice Number', value: `INV-${captureResult.payment_id.slice(0, 8).toUpperCase()}` },
                { label: 'Rental Agreement', value: selectedRA?.ra_number ?? '—' },
                { label: 'Confirmation', value: selectedRes.confirmation_number },
                { label: 'Customer', value: selectedRes.customer_name },
                { label: 'Captured At', value: new Date(captureResult.captured_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) },
                { label: 'Gateway Reference', value: captureResult.stripe_charge_id },
              ].map(row => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 py-2"
                  style={{ borderBottom: '1px solid var(--border-sub)' }}
                >
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{row.label}</span>
                  <span className="text-[12px] font-medium num" style={{ color: 'var(--text-1)' }}>{row.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-0.5">
              <SectionLabel>Line Items</SectionLabel>
              {[
                { label: 'Base rental', amount: toNum(baseAmount) },
                { label: 'Extras / add-ons', amount: toNum(extrasAmount) },
                { label: 'Time extension charge', amount: toNum(timeExtAmount) },
                { label: 'Fuel surcharge', amount: toNum(fuelAmount) },
                { label: 'Mileage overage', amount: toNum(mileageAmount) },
                { label: 'Damage charge', amount: toNum(damageAmount) },
              ]
                .filter(row => row.amount > 0)
                .map(row => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-4 py-1.5"
                    style={{ borderBottom: '1px solid var(--border-sub)' }}
                  >
                    <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{row.label}</span>
                    <span className="text-[12px] font-semibold num" style={{ color: 'var(--text-1)' }}>
                      ${fmt(row.amount)}
                    </span>
                  </div>
                ))}

              {toNum(depositPaid) > 0 && (
                <div className="flex items-center justify-between gap-4 py-1.5" style={{ borderBottom: '1px solid var(--border-sub)' }}>
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>Deposit held (pre-auth)</span>
                  <span className="text-[12px] font-semibold num" style={{ color: 'var(--text-3)' }}>
                    -${fmt(toNum(depositPaid))}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 pt-3">
                <span className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>Total Captured</span>
                <span className="text-[18px] font-bold num" style={{ color: '#10b981' }}>
                  ${fmt(toNum(captureResult.captured_amount))}
                </span>
              </div>
            </div>
          </div>

          {/* Refund section */}
          <div className="panel px-5 py-4">
            <div className="flex items-center justify-between">
              <SectionLabel>Refund</SectionLabel>
              {!showRefund && (
                <button
                  type="button"
                  className="btn-secondary text-[11px] px-3 py-1.5"
                  onClick={() => setShowRefund(true)}
                >
                  Issue Refund
                </button>
              )}
            </div>

            {!showRefund && (
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Refunds over $500 are queued for manager approval.
              </p>
            )}

            {showRefund && (
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  refundMutation.mutate()
                }}
                className="mt-3 space-y-3"
              >
                <div>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-2)' }}>
                    Refund Amount
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px]" style={{ color: 'var(--text-3)' }}>$</span>
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={fmt(toNum(captureResult.captured_amount))}
                      value={refundAmount}
                      onChange={e => setRefundAmount(e.target.value)}
                      placeholder="0.00"
                      className="field-input h-9 w-32 px-3 text-[13px] num"
                    />
                    <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      max ${fmt(toNum(captureResult.captured_amount))}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-2)' }}>
                    Reason <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    required
                    type="text"
                    maxLength={500}
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    placeholder="Enter reason for refund..."
                    className="field-input h-9 w-full px-3 text-[13px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={refundMutation.isPending}
                    className="btn-primary text-[12px] px-4 py-1.5"
                  >
                    {refundMutation.isPending ? 'Submitting...' : 'Submit Refund'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-[12px] px-4 py-1.5"
                    onClick={() => { setShowRefund(false); setRefundAmount(''); setRefundReason('') }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button type="button" onClick={reset} className="btn-primary">
              Process Another Payment
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
