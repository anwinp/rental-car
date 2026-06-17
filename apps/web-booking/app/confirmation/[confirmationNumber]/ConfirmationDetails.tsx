'use client'

import { useEffect, useState } from 'react'

const TENANT = '00000000-0000-0000-0000-000000000001'

interface ConfirmationDetailsProps {
  confirmationNumber: string
}

type ReservationData = {
  reservation_id: string
  confirmation_number: string
  status: string
  pickup_date: string
  dropoff_date: string
  class_name: string
  customer: { first_name: string; last_name: string; email: string }
  rate_summary: { total: number; currency_code: string }
}

export function ConfirmationDetails({ confirmationNumber }: ConfirmationDetailsProps) {
  const [res, setRes] = useState<ReservationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(`/api/v1/reservations/public/${confirmationNumber}`, {
      credentials: 'include',
      headers: { 'X-Tenant-ID': TENANT },
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setRes(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [confirmationNumber])

  if (loading) return (
    <div style={{ background: '#303030', border: '1px solid #303030', borderRadius: 0, padding: 32 }}>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ height: 16, background: 'rgba(255,255,255,0.06)', borderRadius: 0, marginBottom: 16, width: i === 0 ? '40%' : i === 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )

  if (error || !res) return (
    <div style={{ background: '#303030', border: '1px solid rgba(241,58,44,0.25)', borderRadius: 0, padding: 32 }}>
      <h2 style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', marginBottom: 12 }}>Reservation Not Found</h2>
      <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginBottom: 24 }}>
        We couldn&apos;t find a reservation with confirmation number{' '}
        <strong style={{ color: '#ffffff', fontFamily: 'monospace' }}>{confirmationNumber}</strong>. Please check the number and try again.
      </p>
      <a href="/" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 24px', height: 48, borderRadius: 0,
        background: 'transparent', color: '#ffffff', border: '1px solid #ffffff',
        fontWeight: 700, textDecoration: 'none', fontSize: 14,
        letterSpacing: '1.4px', textTransform: 'uppercase',
      }}>Back to Home</a>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`@keyframes rcm-pop{0%{transform:scale(0.7);opacity:0}100%{transform:scale(1);opacity:1}}`}</style>

      {/* Success header */}
      <div style={{ textAlign: 'center', paddingTop: 16 }}>
        <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 24px', animation: 'rcm-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(3,144,74,0.2)', background: 'rgba(3,144,74,0.06)' }} />
          <div style={{ position: 'absolute', inset: 12, borderRadius: '50%', background: 'rgba(3,144,74,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#03904a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 10 }}>Booking Confirmed</p>
        <h1 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', marginBottom: 8 }}>You&apos;re all set!</h1>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696' }}>Confirmation #{res.confirmation_number}</p>
      </div>

      {/* Confirmation number hero */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #303030', borderRadius: 0, padding: '24px 28px', textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 12 }}>Your Confirmation Number</p>
        <code style={{ fontFamily: 'monospace', fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '0.12em', display: 'block', marginBottom: 8 }}>
          {res.confirmation_number}
        </code>
        <p style={{ fontSize: 12, fontWeight: 400, color: '#666666' }}>Show this at the rental counter</p>
      </div>

      {/* Main reservation card */}
      <div style={{ background: '#303030', border: '1px solid #303030', borderRadius: 0, overflow: 'hidden' }}>
        {/* Vehicle + status */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 4 }}>Vehicle Class</p>
            <span style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em' }}>{res.class_name}</span>
          </div>
          <span style={{ padding: '4px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600, background: 'rgba(3,144,74,0.12)', color: '#03904a', border: '1px solid rgba(3,144,74,0.25)' }}>
            {res.status}
          </span>
        </div>

        {/* Info grid */}
        <div style={{ padding: 24 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            {[
              { label: 'Pickup Date', value: new Date(res.pickup_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' }) },
              { label: 'Return Date', value: new Date(res.dropoff_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' }) },
              { label: 'Primary Driver', value: `${res.customer.first_name} ${res.customer.last_name}` },
              { label: 'Total Charge', value: new Intl.NumberFormat('en-US', { style: 'currency', currency: res.rate_summary.currency_code }).format(res.rate_summary.total), highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label}>
                <dt style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 6 }}>{label}</dt>
                <dd style={{ fontSize: 15, fontWeight: highlight ? 500 : 400, color: '#ffffff', letterSpacing: highlight ? '-0.02em' : 'normal' }}>{value}</dd>
              </div>
            ))}
          </dl>

          {/* What's next */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 16 }}>What&apos;s Next</p>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { num: 1, strong: 'Check your email', rest: ' — a confirmation has been sent to ', highlight: res.customer.email },
                { num: 2, strong: 'Bring your confirmation', rest: ' — show your confirmation number at the counter' },
                { num: 3, strong: 'Return on time', rest: ' — late returns may incur additional fees' },
              ].map(item => (
                <li key={item.num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#969696', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.num}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: '1.6', paddingTop: 3 }}>
                    <strong style={{ color: '#ffffff', fontWeight: 500 }}>{item.strong}</strong>
                    {item.rest}
                    {item.highlight && <span style={{ color: '#ffffff' }}>{item.highlight}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
            <a href={`/manage/${confirmationNumber}`} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 20px', height: 48, borderRadius: 0,
              background: '#da291c', color: '#ffffff', fontWeight: 700, textDecoration: 'none',
              fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase',
            }}>Manage Reservation</a>
            <button
              onClick={() => {
                const start = new Date(res.pickup_date).toISOString().replace(/[-:]/g, '').split('.')[0]
                const end = new Date(res.dropoff_date).toISOString().replace(/[-:]/g, '').split('.')[0]
                const ics = [
                  'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
                  `DTSTART:${start}Z`, `DTEND:${end}Z`,
                  `SUMMARY:Rental Car Pickup - ${res.class_name}`,
                  `DESCRIPTION:Confirmation #${res.confirmation_number}`,
                  'END:VEVENT', 'END:VCALENDAR',
                ].join('\n')
                const blob = new Blob([ics], { type: 'text/calendar' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = `rental-${res.confirmation_number}.ics`; a.click()
                URL.revokeObjectURL(url)
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 20px', height: 48, borderRadius: 0,
                background: 'transparent', color: '#ffffff', border: '1px solid #ffffff',
                fontWeight: 700, cursor: 'pointer', fontSize: 14,
                letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
              }}
            >Add to Calendar</button>
            <a href="/" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 20px', height: 48, borderRadius: 0,
              background: 'transparent', color: '#969696', border: '1px solid #303030',
              fontWeight: 400, textDecoration: 'none', fontSize: 14,
            }}>Back to Home</a>
          </div>
        </div>
      </div>

      {/* Account upsell */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #303030', borderRadius: 0, padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', margin: 0 }}>
          Save time next time — create a free account to store your details
        </p>
        <a href="/signup" style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 18px', height: 48, borderRadius: 0,
          background: 'transparent', color: '#ffffff', border: '1px solid #ffffff',
          fontWeight: 700, textDecoration: 'none', fontSize: 14,
          letterSpacing: '1.4px', textTransform: 'uppercase',
        }}>Create Account</a>
      </div>
    </div>
  )
}
