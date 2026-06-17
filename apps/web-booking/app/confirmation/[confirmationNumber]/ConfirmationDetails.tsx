'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import { Skeleton } from '@rcm/ui'

interface ConfirmationDetailsProps {
  confirmationNumber: string
}

export function ConfirmationDetails({ confirmationNumber }: ConfirmationDetailsProps) {
  const { data: managed, isLoading, isError } = useQuery({
    queryKey: ['managed', confirmationNumber],
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/manage/{token}', {
        params: { path: { token: confirmationNumber } },
      })
      if (error) throw error
      return data as {
        reservation: {
          reservation_id: string
          confirmation_number: string
          status: string
          pickup_date: string
          dropoff_date: string
          class_name: string
          customer: { first_name: string; last_name: string; email: string }
          rate_summary: { total: number; currency_code: string }
        }
        invoice_url?: string
      }
    },
    retry: false,
  })

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading confirmation"
        style={{
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          backdropFilter: 'blur(12px)',
          padding: 32,
        }}
      >
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-4 w-64 mb-8" />
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-5 w-full mb-3" />
        ))}
      </div>
    )
  }

  if (isError || !managed) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(240,78,78,0.25)',
        borderRadius: 16,
        backdropFilter: 'blur(12px)',
        padding: 32,
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.03em', marginBottom: 12 }}>Reservation Not Found</h2>
        <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', marginBottom: 24 }}>
          We couldn&apos;t find a reservation with confirmation number{' '}
          <strong style={{ color: 'var(--p-text-1)', fontFamily: 'monospace' }}>{confirmationNumber}</strong>. Please check the number and try again.
        </p>
        <a href="/" style={{
          padding: '11px 24px', borderRadius: 10,
          background: 'transparent', color: 'var(--p-text-2)',
          border: '1px solid rgba(255,255,255,0.12)',
          fontWeight: 400, textDecoration: 'none', fontSize: 14,
          display: 'inline-block',
        }}>
          Back to Home
        </a>
      </div>
    )
  }

  const res = managed.reservation

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`
        @keyframes rcm-pop { 0%{transform:scale(0.7);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes rcm-ripple { 0%{transform:scale(1);opacity:0.6} 100%{transform:scale(1.6);opacity:0} }
      `}</style>

      {/* Success header */}
      <div style={{ textAlign: 'center', paddingTop: 16 }}>
        <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 24px', animation: 'rcm-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both' }}>
          {/* Ripple ring */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid rgba(16,217,160,0.3)',
            animation: 'rcm-ripple 2s ease-out infinite',
          }} aria-hidden="true" />
          {/* Outer ring */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '2px solid rgba(16,217,160,0.2)',
            background: 'rgba(16,217,160,0.06)',
          }} />
          {/* Inner circle */}
          <div style={{
            position: 'absolute', inset: 12, borderRadius: '50%',
            background: 'rgba(16,217,160,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#10d9a0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 10 }}>
          Booking Confirmed
        </p>
        <h1 style={{ fontSize: 36, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.05em', marginBottom: 8 }}>
          You&apos;re all set!
        </h1>
        <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)' }}>
          Confirmation #{res.confirmation_number}
        </p>
      </div>

      {/* Confirmation number hero */}
      <div style={{
        background: 'rgba(34,226,168,0.08)',
        border: '1px solid rgba(34,226,168,0.2)',
        borderRadius: 16,
        padding: '24px 28px',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 12 }}>
          Your Confirmation Number
        </p>
        <code style={{
          fontFamily: 'monospace',
          fontSize: 32,
          fontWeight: 300,
          color: '#22e2a8',
          letterSpacing: '0.12em',
          display: 'block',
          marginBottom: 8,
        }}>
          {res.confirmation_number}
        </code>
        <p style={{ fontSize: 12, fontWeight: 300, color: 'var(--p-text-4)' }}>
          Show this at the rental counter
        </p>
      </div>

      {/* Main reservation card */}
      <div style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
      }}>
        {/* Vehicle + status */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 4 }}>Vehicle</p>
            <span style={{ fontSize: 20, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.03em' }}>{res.class_name}</span>
          </div>
          <span style={{
            padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 500,
            background: 'rgba(16,217,160,0.12)', color: '#10d9a0', border: '1px solid rgba(16,217,160,0.2)',
          }}>
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
              {
                label: 'Total Charge',
                value: new Intl.NumberFormat('en-US', { style: 'currency', currency: res.rate_summary.currency_code }).format(res.rate_summary.total),
                highlight: true,
              },
            ].map(({ label, value, highlight }) => (
              <div key={label}>
                <dt style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</dt>
                <dd style={{ fontSize: 15, fontWeight: 300, color: highlight ? '#22e2a8' : 'var(--p-text-1)', letterSpacing: highlight ? '-0.02em' : 'normal' }}>{value}</dd>
              </div>
            ))}
          </dl>

          {/* What's next */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 16 }}>
              What&apos;s Next
            </p>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { num: 1, strong: 'Check your email', rest: ` — a confirmation has been sent to `, highlight: res.customer.email },
                { num: 2, strong: 'Bring your confirmation', rest: ' — show your confirmation number at the counter' },
                { num: 3, strong: 'Return on time', rest: ' — late returns may incur additional fees' },
              ].map(item => (
                <li key={item.num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span style={{
                    flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                    background: 'rgba(34,226,168,0.12)',
                    border: '1px solid rgba(34,226,168,0.2)',
                    color: '#22e2a8',
                    fontSize: 12, fontWeight: 500,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {item.num}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-2)', lineHeight: '1.6', paddingTop: 3 }}>
                    <strong style={{ color: 'var(--p-text-1)', fontWeight: 400 }}>{item.strong}</strong>
                    {item.rest}
                    {item.highlight && <span style={{ color: '#22e2a8', fontWeight: 400 }}>{item.highlight}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 20 }}>
            <a
              href={`/manage/${confirmationNumber}`}
              style={{
                padding: '11px 20px', borderRadius: 10,
                background: 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
                color: '#fff', fontWeight: 500, textDecoration: 'none', fontSize: 13,
                boxShadow: '0 0 20px rgba(34,226,168,0.35)',
              }}
            >
              Manage Reservation
            </a>
            {managed.invoice_url && (
              <a href={managed.invoice_url} target="_blank" rel="noreferrer" style={{
                padding: '11px 20px', borderRadius: 10,
                background: 'transparent', color: 'var(--p-text-2)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontWeight: 400, textDecoration: 'none', fontSize: 13,
              }}>
                Download Receipt
              </a>
            )}
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
                const a = document.createElement('a')
                a.href = url; a.download = `rental-${res.confirmation_number}.ics`; a.click()
                URL.revokeObjectURL(url)
              }}
              style={{
                padding: '11px 20px', borderRadius: 10,
                background: 'transparent', color: 'var(--p-text-2)',
                border: '1px solid rgba(255,255,255,0.12)',
                fontWeight: 400, cursor: 'pointer', fontSize: 13,
              }}
            >
              Add to Calendar
            </button>
            <a href="/" style={{
              padding: '11px 20px', borderRadius: 10,
              background: 'transparent', color: 'var(--p-text-3)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontWeight: 300, textDecoration: 'none', fontSize: 13,
            }}>
              Back to Home
            </a>
          </div>
        </div>
      </div>

      {/* Account upsell */}
      <div style={{
        background: 'rgba(34,226,168,0.06)',
        border: '1px solid rgba(34,226,168,0.15)',
        borderRadius: 14,
        padding: '18px 22px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-2)', margin: 0 }}>
          Save time next time — create a free account to store your details
        </p>
        <a href="/login" style={{
          padding: '9px 18px', borderRadius: 10,
          background: 'transparent', color: '#22e2a8',
          border: '1px solid rgba(34,226,168,0.3)',
          fontWeight: 400, textDecoration: 'none', fontSize: 13,
        }}>
          Create Account
        </a>
      </div>
    </div>
  )
}
