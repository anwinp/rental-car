'use client'

import type React from 'react'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRateQuote } from '@rcm/api-client'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Skeleton,
  Input,
} from '@rcm/ui'
import { useBookingDraft } from '../../lib/bookingDraftStore'
import type { DriverData } from '../../lib/bookingDraftStore'

const TENANT = '00000000-0000-0000-0000-000000000001'

const driverSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  phone: z.string().optional(),
  dob: z.string().optional(),
  dl_number: z.string().optional(),
  dl_state: z.string().optional(),
  dl_country: z.string().default('US'),
})
type DriverFormData = z.infer<typeof driverSchema>

const paymentSchema = z.object({
  card_name: z.string().min(1, 'Name on card is required'),
  card_number: z.string().min(19, 'Enter a valid card number'),
  expiry: z.string().regex(/^\d{2}\/\d{2}$/, 'Format: MM/YY'),
  cvc: z.string().min(3, 'CVC required').max(4),
})
type PaymentFormData = z.infer<typeof paymentSchema>

const EXTRAS = [
  { code: 'CDW', name: 'Collision Damage Waiver', dailyRate: 19.99 },
  { code: 'GPS', name: 'GPS Navigation', dailyRate: 7.99 },
  { code: 'CSS', name: 'Child Safety Seat', dailyRate: 9.99 },
  { code: 'PAI', name: 'Personal Accident Insurance', dailyRate: 4.99 },
  { code: 'RSA', name: 'Roadside Assistance', dailyRate: 3.99 },
]

const STEPS = ['Extras', 'Driver Info', 'Payment', 'Confirmed']

interface BookingPageProps {
  params: { id: string }
  searchParams: { pickup?: string; from?: string; to?: string; dropoff?: string }
}

function formatCardNumber(v: string) {
  return v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()
}
function formatExpiry(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

// Ferrari dark card styles
const cosmosCard: React.CSSProperties = {
  background: '#303030',
  border: '1px solid #303030',
  borderRadius: 0,
  overflow: 'hidden',
}
const cosmosCardHeader: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
}
const cosmosCardBody: React.CSSProperties = { padding: 24 }
const cosmosCardFoot: React.CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid rgba(255,255,255,0.07)',
  display: 'flex',
  justifyContent: 'space-between',
  flexWrap: 'wrap' as const,
  gap: 10,
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 4, color: '#ffffff', fontSize: 14,
  fontWeight: 400, outline: 'none',
  transition: 'border-color 0.15s', fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#969696',
  textTransform: 'uppercase', letterSpacing: '0.1em',
}

export default function BookingPage({ params, searchParams }: BookingPageProps) {
  const classId = params.id
  const pickup = searchParams.pickup ?? ''
  const from = searchParams.from ?? ''
  const to = searchParams.to ?? searchParams.dropoff ?? ''

  const draft = useBookingDraft()
  const [activeStep, setActiveStep] = useState(0)
  const [selectedExtras, setSelectedExtras] = useState<string[]>([])
  const [confirmationNumber, setConfirmationNumber] = useState<string | null>(null)
  const [driverData, setDriverData] = useState<DriverFormData | null>(null)
  const [ageWarning, setAgeWarning] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [promoCode, setPromoCode] = useState('')
  const [promoResult, setPromoResult] = useState<{ discount_type: string; discount_value: number; code: string } | null>(null)
  const [promoError, setPromoError] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)

  useEffect(() => {
    if (draft.selectedExtras.length) setSelectedExtras(draft.selectedExtras)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const daysCount = from && to
    ? Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000))
    : 1

  const { data: quote, isLoading: quoteLoading } = useRateQuote({
    pickup_location_id: pickup,
    pickup_date: from,
    dropoff_date: to,
    class_code: classId,
    extras: selectedExtras,
  })

  const driverForm = useForm<DriverFormData>({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      first_name: draft.driverData?.first_name ?? '',
      last_name: draft.driverData?.last_name ?? '',
      email: draft.driverData?.email ?? '',
      phone: draft.driverData?.phone ?? '',
      dob: draft.driverData?.dob ?? '',
      dl_number: draft.driverData?.dl_number ?? '',
      dl_state: draft.driverData?.dl_state ?? '',
      dl_country: 'US',
    },
  })

  const paymentForm = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { card_name: '', card_number: '', expiry: '', cvc: '' },
  })

  function toggleExtra(code: string) {
    const next = selectedExtras.includes(code)
      ? selectedExtras.filter(c => c !== code)
      : [...selectedExtras, code]
    setSelectedExtras(next)
    draft.setExtras(next)
  }

  async function handleApplyPromo() {
    setPromoError('')
    if (!promoCode.trim()) return
    setPromoLoading(true)
    try {
      const res = await fetch('/api/v1/pricing/quote', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
        body: JSON.stringify({
          pickup_location_id: pickup,
          vehicle_class_id: classId,
          pickup_dt: from,
          dropoff_dt: to,
          extras: selectedExtras.map(code => ({ extra_id: code, quantity: 1 })),
          promo_code: promoCode.trim().toUpperCase(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const discountLine = (data.line_items ?? []).find((l: { type: string; amount: number }) => l.type === 'DISCOUNT')
        if (discountLine) {
          setPromoResult({ discount_type: 'FIXED', discount_value: Math.abs(discountLine.amount), code: promoCode.trim().toUpperCase() })
        } else {
          setPromoError('Code applied but no discount found.')
        }
      } else {
        const err = await res.json().catch(() => ({}))
        setPromoError((err as any).detail || 'Invalid promo code')
      }
    } catch {
      setPromoError('Failed to apply code')
    } finally {
      setPromoLoading(false)
    }
  }

  function handleDriverSubmit(data: DriverFormData) {
    const driverForStore: DriverData = {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone ?? '',
      dob: data.dob ?? '',
      dl_number: data.dl_number ?? '',
      dl_state: data.dl_state ?? '',
      dl_country: data.dl_country ?? 'US',
    }
    setDriverData(data)
    draft.setDriverData(driverForStore)
    setActiveStep(2)
  }

  async function handlePaymentSubmit(_data: PaymentFormData) {
    if (!driverData) return
    setIsPending(true)
    setBookingError(null)
    try {
      const res = await fetch('/api/v1/reservations/guest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT,
        },
        body: JSON.stringify({
          pickup_location: pickup,
          vehicle_class_id: classId,
          pickup_date: from.slice(0, 10),
          dropoff_date: to.slice(0, 10),
          guest_info: {
            first_name: driverData.first_name,
            last_name: driverData.last_name,
            email: driverData.email,
            phone: driverData.phone || null,
          },
          extras: selectedExtras,
        }),
      })
      if (!res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        const msg = ct.includes('application/json')
          ? ((await res.json()) as { detail?: string }).detail ?? res.statusText
          : `${res.status} ${res.statusText}`
        throw new Error(msg)
      }
      const result = await res.json() as { confirmation_number: string; reservation_id: string }
      setConfirmationNumber(result.confirmation_number)
      draft.reset()
      setActiveStep(3)
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Booking failed. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  function checkAge(dob: string) {
    if (!dob) { setAgeWarning(false); return }
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    setAgeWarning(age < 25)
  }

  const extrasTotal = selectedExtras.reduce((sum, code) => {
    const e = EXTRAS.find(x => x.code === code)
    return sum + (e?.dailyRate ?? 0) * daysCount
  }, 0)

  return (
    <div style={{ minHeight: '100vh', background: '#181818', padding: '32px 0' }}>
      <style>{`
        @keyframes rcm-pop{0%{transform:scale(0.7);opacity:0}100%{transform:scale(1);opacity:1}}
      `}</style>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ marginBottom: 36 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8 }}>
            Booking
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', margin: 0 }}>
            Complete Your Booking
          </h1>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', marginBottom: 40 }}>
          {STEPS.map((label, i) => (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {i > 0 && (
                  <div style={{
                    flex: 1, height: 2,
                    background: i <= activeStep ? '#da291c' : 'rgba(255,255,255,0.08)',
                    transition: 'background 0.3s',
                  }} />
                )}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 500, transition: 'all 0.3s',
                  background: i < activeStep
                    ? '#da291c'
                    : i === activeStep
                      ? 'rgba(218,41,28,0.15)'
                      : 'rgba(255,255,255,0.06)',
                  border: i === activeStep
                    ? '2px solid #da291c'
                    : i < activeStep
                      ? 'none'
                      : '2px solid rgba(255,255,255,0.1)',
                  color: i <= activeStep ? '#ffffff' : '#666666',
                }}>
                  {i < activeStep
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                    : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{
                    flex: 1, height: 2,
                    background: i < activeStep ? '#da291c' : 'rgba(255,255,255,0.08)',
                    transition: 'background 0.3s',
                  }} />
                )}
              </div>
              <span style={{
                fontSize: 11, marginTop: 8, fontWeight: i === activeStep ? 500 : 400,
                color: i === activeStep ? '#ffffff' : '#666666',
                letterSpacing: '0.04em',
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: activeStep === 3 ? '1fr' : 'minmax(0,1fr) 300px', gap: 24, alignItems: 'start' }}>

          {/* Main content */}
          <div>

            {/* Step 0: Extras */}
            {activeStep === 0 && (
              <div style={cosmosCard}>
                <div style={cosmosCardHeader}>
                  <h2 style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', margin: 0 }}>Add Extras</h2>
                  <p style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginTop: 4 }}>Customize your rental with optional add-ons.</p>
                </div>
                <div style={cosmosCardBody}>
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="sr-only">Optional extras</legend>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {EXTRAS.map(extra => {
                        const checked = selectedExtras.includes(extra.code)
                        return (
                          <label key={extra.code} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '14px 16px', borderRadius: 0, cursor: 'pointer',
                            border: `1px solid ${checked ? 'rgba(218,41,28,0.4)' : 'rgba(255,255,255,0.07)'}`,
                            background: checked ? 'rgba(218,41,28,0.06)' : 'rgba(255,255,255,0.02)',
                            transition: 'all 0.15s',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleExtra(extra.code)}
                                style={{ display: 'none' }}
                                aria-label={extra.name}
                              />
                              {/* Custom checkbox */}
                              <span style={{
                                width: 18, height: 18, borderRadius: 2, flexShrink: 0,
                                border: `2px solid ${checked ? '#da291c' : 'rgba(255,255,255,0.2)'}`,
                                background: checked ? '#da291c' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                              }}>
                                {checked && (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </span>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 400, color: '#ffffff' }}>{extra.name}</div>
                                <div style={{ fontSize: 12, fontWeight: 400, color: '#666666' }}>{extra.code}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 400, color: checked ? '#da291c' : '#ffffff' }}>
                                ${extra.dailyRate.toFixed(2)}
                              </div>
                              <div style={{ fontSize: 11, fontWeight: 400, color: '#666666' }}>/day</div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                </div>
                <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', marginBottom: 8 }}>Promo Code</p>
                  {promoResult ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>
                        {promoResult.code} — saving ${promoResult.discount_value.toFixed(2)}
                      </span>
                      <button type="button" onClick={() => { setPromoResult(null); setPromoCode('') }}
                        style={{ fontSize: 11, color: '#969696', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Enter promo code"
                        value={promoCode}
                        onChange={e => setPromoCode(e.target.value.toUpperCase())}
                        style={{ flex: 1, height: 44, padding: '0 12px', fontSize: 14,
                          background: 'rgba(255,255,255,0.05)', color: '#ffffff',
                          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4,
                          fontFamily: 'inherit', outline: 'none' }}
                      />
                      <button
                        type="button"
                        disabled={promoLoading || !promoCode.trim()}
                        onClick={handleApplyPromo}
                        style={{ height: 44, padding: '0 16px', fontSize: 13, fontWeight: 700,
                          background: '#da291c', color: '#fff', border: 'none', borderRadius: 0,
                          cursor: promoLoading || !promoCode.trim() ? 'not-allowed' : 'pointer',
                          textTransform: 'uppercase', letterSpacing: '1.4px', fontFamily: 'inherit',
                          opacity: promoLoading || !promoCode.trim() ? 0.6 : 1 }}
                      >
                        {promoLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {promoError && <p style={{ fontSize: 12, color: '#da291c', marginTop: 4 }}>{promoError}</p>}
                </div>
                <div style={{ ...cosmosCardFoot, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setActiveStep(1)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 24px', height: 48, borderRadius: 0,
                      background: '#da291c',
                      color: '#ffffff', fontWeight: 700, border: 'none', cursor: 'pointer',
                      fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
                    }}
                  >
                    Continue to Driver Info
                  </button>
                </div>
              </div>
            )}

            {/* Step 1: Driver Details */}
            {activeStep === 1 && (
              <div style={cosmosCard}>
                <div style={cosmosCardHeader}>
                  <h2 style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', margin: 0 }}>Driver Details</h2>
                  <p style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginTop: 4 }}>Enter the primary driver&apos;s information.</p>
                </div>
                <div style={cosmosCardBody}>
                  <Form {...driverForm}>
                    <form id="driver-form" onSubmit={driverForm.handleSubmit(handleDriverSubmit)} noValidate>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                        <FormField control={driverForm.control} name="first_name" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>First Name *</FormLabel>
                            <FormControl><div><Input placeholder="Jane" {...field} style={inputStyle} /></div></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={driverForm.control} name="last_name" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Last Name *</FormLabel>
                            <FormControl><div><Input placeholder="Smith" {...field} style={inputStyle} /></div></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <FormField control={driverForm.control} name="email" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Email Address *</FormLabel>
                            <FormControl><div><Input type="email" placeholder="jane@example.com" {...field} style={inputStyle} /></div></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={driverForm.control} name="phone" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Phone Number</FormLabel>
                            <FormControl><div><Input type="tel" placeholder="+1 (555) 000-0000" {...field} style={inputStyle} /></div></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={driverForm.control} name="dob" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Date of Birth</FormLabel>
                            <FormControl>
                              <div>
                                <Input
                                  type="date"
                                  max={new Date().toISOString().slice(0, 10)}
                                  {...field}
                                  onChange={e => { field.onChange(e); checkAge(e.target.value) }}
                                  style={inputStyle}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        {ageWarning && (
                          <div role="alert" style={{
                            padding: '10px 14px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid #303030',
                            borderRadius: 0, fontSize: 13, fontWeight: 400,
                            color: '#969696', display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            Young driver surcharge may apply for drivers under 25.
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                          <FormField control={driverForm.control} name="dl_number" render={({ field }) => (
                            <FormItem>
                              <FormLabel style={labelStyle}>Driver License #</FormLabel>
                              <FormControl><div><Input placeholder="D12345678" {...field} style={inputStyle} /></div></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={driverForm.control} name="dl_state" render={({ field }) => (
                            <FormItem>
                              <FormLabel style={labelStyle}>State</FormLabel>
                              <FormControl><div><Input placeholder="CA" maxLength={2} {...field} style={inputStyle} /></div></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      </div>
                    </form>
                  </Form>
                </div>
                <div style={cosmosCardFoot}>
                  <button
                    onClick={() => setActiveStep(0)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 24px', height: 48, borderRadius: 0,
                      background: 'transparent', color: '#ffffff',
                      border: '1px solid #ffffff',
                      fontWeight: 700, cursor: 'pointer', fontSize: 14,
                      letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="submit" form="driver-form"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 24px', height: 48, borderRadius: 0,
                      background: '#da291c',
                      color: '#ffffff', fontWeight: 700, border: 'none', cursor: 'pointer',
                      fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
                    }}
                  >
                    Continue to Payment
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Payment */}
            {activeStep === 2 && (
              <div style={cosmosCard}>
                <div style={cosmosCardHeader}>
                  <h2 style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', margin: 0 }}>Payment</h2>
                  <p style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginTop: 4 }}>Enter your payment details to complete the booking.</p>
                </div>
                <div style={cosmosCardBody}>
                  <Form {...paymentForm}>
                    <form id="payment-form" onSubmit={paymentForm.handleSubmit(handlePaymentSubmit)} noValidate>
                      {/* Card visual */}
                      <div style={{
                        height: 160, borderRadius: 0,
                        background: '#303030',
                        border: '1px solid rgba(255,255,255,0.1)',
                        padding: '24px 28px', marginBottom: 24,
                        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        <div style={{ position: 'absolute', right: -20, top: -20, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} aria-hidden="true" />
                        <div style={{ position: 'absolute', right: 30, bottom: -40, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.02)' }} aria-hidden="true" />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                          <span style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', letterSpacing: '0.12em' }}>RCM</span>
                          <svg width="40" height="26" viewBox="0 0 750 471" fill="none" aria-hidden="true">
                            <circle cx="284" cy="236" r="200" fill="rgba(255,255,255,0.15)" />
                            <circle cx="466" cy="236" r="200" fill="rgba(255,255,255,0.08)" />
                          </svg>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 400, color: '#ffffff', letterSpacing: '0.15em' }}>
                            {paymentForm.watch('card_number') || '•••• •••• •••• ••••'}
                          </div>
                          <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
                            <div>
                              <div style={{ fontSize: 9, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Card Holder</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginTop: 2 }}>{paymentForm.watch('card_name') || 'Your Name'}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Expires</div>
                              <div style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginTop: 2 }}>{paymentForm.watch('expiry') || 'MM/YY'}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <FormField control={paymentForm.control} name="card_name" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Name on Card *</FormLabel>
                            <FormControl><div><Input placeholder="Jane Smith" autoComplete="cc-name" {...field} style={inputStyle} /></div></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={paymentForm.control} name="card_number" render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Card Number *</FormLabel>
                            <FormControl>
                              <div>
                                <Input
                                  placeholder="1234 5678 9012 3456"
                                  inputMode="numeric"
                                  autoComplete="cc-number"
                                  maxLength={19}
                                  {...field}
                                  onChange={e => field.onChange(formatCardNumber(e.target.value))}
                                  style={inputStyle}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          <FormField control={paymentForm.control} name="expiry" render={({ field }) => (
                            <FormItem>
                              <FormLabel style={labelStyle}>Expiry *</FormLabel>
                              <FormControl>
                                <div>
                                  <Input
                                    placeholder="MM/YY"
                                    inputMode="numeric"
                                    autoComplete="cc-exp"
                                    maxLength={5}
                                    {...field}
                                    onChange={e => field.onChange(formatExpiry(e.target.value))}
                                    style={inputStyle}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={paymentForm.control} name="cvc" render={({ field }) => (
                            <FormItem>
                              <FormLabel style={labelStyle}>CVC *</FormLabel>
                              <FormControl>
                                <div>
                                  <Input
                                    type="password"
                                    placeholder="123"
                                    inputMode="numeric"
                                    autoComplete="cc-csc"
                                    maxLength={4}
                                    {...field}
                                    onChange={e => field.onChange(e.target.value.replace(/\D/g, ''))}
                                    style={inputStyle}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                      </div>

                      <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid #303030', borderRadius: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 400, color: '#969696' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        Secured with 256-bit SSL encryption · Demo mode
                      </div>

                      {bookingError && (
                        <div role="alert" style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(241,58,44,0.08)', border: '1px solid rgba(241,58,44,0.25)', borderRadius: 0, fontSize: 13, fontWeight: 400, color: '#f13a2c' }}>
                          {bookingError}
                        </div>
                      )}
                    </form>
                  </Form>
                </div>
                <div style={cosmosCardFoot}>
                  <button
                    onClick={() => setActiveStep(1)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 24px', height: 48, borderRadius: 0,
                      background: 'transparent', color: '#ffffff',
                      border: '1px solid #ffffff',
                      fontWeight: 700, cursor: 'pointer', fontSize: 14,
                      letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    form="payment-form"
                    disabled={isPending}
                    aria-busy={isPending}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 24px', height: 48, borderRadius: 0,
                      background: isPending ? '#8a1a11' : '#da291c',
                      color: '#ffffff', fontWeight: 700, border: 'none',
                      cursor: isPending ? 'not-allowed' : 'pointer',
                      fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
                    }}
                  >
                    {isPending ? 'Confirming…' : 'Confirm & Pay'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Confirmed */}
            {activeStep === 3 && (
              <div style={{ ...cosmosCard, textAlign: 'center' }}>
                <div style={{ padding: '56px 40px' }}>
                  {/* Success icon */}
                  <div style={{ position: 'relative', width: 88, height: 88, margin: '0 auto 24px', animation: 'rcm-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both' }}>
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: 'rgba(3,144,74,0.12)',
                      border: '2px solid rgba(3,144,74,0.3)',
                    }} />
                    <div style={{
                      position: 'absolute', inset: 8, borderRadius: '50%',
                      background: 'rgba(3,144,74,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#03904a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                  </div>

                  <h2 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', marginBottom: 10 }}>Booking Confirmed!</h2>
                  <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginBottom: 32 }}>
                    A confirmation has been sent to{' '}
                    <span style={{ color: '#ffffff', fontWeight: 400 }}>{driverData?.email}</span>
                  </p>

                  {confirmationNumber && (
                    <div style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid #303030',
                      borderRadius: 0, padding: '20px 32px',
                      display: 'inline-block', marginBottom: 36,
                    }}>
                      <p style={{ fontSize: 11, fontWeight: 500, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 10 }}>Confirmation Number</p>
                      <code style={{ fontFamily: 'monospace', fontSize: 30, fontWeight: 500, color: '#ffffff', letterSpacing: '0.12em' }}>
                        {confirmationNumber}
                      </code>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <a
                      href={`/confirmation/${confirmationNumber}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 24px', height: 48, borderRadius: 0,
                        background: 'transparent', color: '#ffffff',
                        border: '1px solid #ffffff',
                        fontWeight: 700, textDecoration: 'none', fontSize: 14,
                        letterSpacing: '1.4px', textTransform: 'uppercase',
                      }}
                    >
                      View Full Details
                    </a>
                    <a
                      href="/"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 24px', height: 48, borderRadius: 0,
                        background: '#da291c',
                        color: '#ffffff', fontWeight: 700, textDecoration: 'none', fontSize: 14,
                        letterSpacing: '1.4px', textTransform: 'uppercase',
                      }}
                    >
                      Book Another Car
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sticky sidebar */}
          {activeStep < 3 && (
            <div style={{
              background: '#303030',
              border: '1px solid #303030',
              borderRadius: 0,
              position: 'sticky',
              top: 80,
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <p style={{ fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 4 }}>Summary</p>
                <h3 style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.02em', margin: 0 }}>Price Breakdown</h3>
                <p style={{ fontSize: 12, fontWeight: 400, color: '#666666', marginTop: 2 }}>{daysCount} day{daysCount !== 1 ? 's' : ''}</p>
              </div>
              <div style={{ padding: 20 }}>
                {quoteLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                  </div>
                ) : quote ? (
                  <>
                    {quote.line_items.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 10 }}>
                        <span style={{ fontWeight: 400, color: item.type === 'tax' || item.type === 'fee' ? '#666666' : '#969696' }}>
                          {item.description}
                        </span>
                        <span style={{ fontWeight: 400, color: item.type === 'discount' ? '#03904a' : '#ffffff' }}>
                          {item.type === 'discount' ? '-' : ''}
                          {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency_code }).format(Math.abs(item.amount))}
                        </span>
                      </div>
                    ))}
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '12px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18 }}>
                      <span style={{ fontWeight: 400, color: '#ffffff' }}>Total</span>
                      <span style={{ fontWeight: 500, color: '#ffffff', letterSpacing: '-0.02em' }}>
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: quote.currency_code }).format(quote.total)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    {selectedExtras.length > 0 && (
                      <>
                        {selectedExtras.map(code => {
                          const e = EXTRAS.find(x => x.code === code)
                          if (!e) return null
                          return (
                            <div key={code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                              <span style={{ fontWeight: 400, color: '#969696' }}>{e.name}</span>
                              <span style={{ fontWeight: 400, color: '#ffffff' }}>${(e.dailyRate * daysCount).toFixed(2)}</span>
                            </div>
                          )
                        })}
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '10px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                          <span style={{ fontWeight: 400, color: '#ffffff' }}>Extras subtotal</span>
                          <span style={{ fontWeight: 500, color: '#ffffff' }}>${extrasTotal.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    {selectedExtras.length === 0 && (
                      <p style={{ fontSize: 13, fontWeight: 400, color: '#666666' }}>Select extras to see pricing.</p>
                    )}
                  </>
                )}

                {(from || to) && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    {from && (
                      <div style={{ fontSize: 12, fontWeight: 400, color: '#666666', marginBottom: 4 }}>
                        <span style={{ color: '#969696', fontWeight: 400 }}>Pickup</span>{' '}
                        {new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                    )}
                    {to && (
                      <div style={{ fontSize: 12, fontWeight: 400, color: '#666666' }}>
                        <span style={{ color: '#969696', fontWeight: 400 }}>Return</span>{' '}
                        {new Date(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
