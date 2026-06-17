'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import {
  Skeleton,
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@rcm/ui'

import type React from 'react'

interface ManagePageProps {
  params: { token: string }
}

type ManagedReservation = {
  reservation: {
    reservation_id: string
    confirmation_number: string
    status: string
    pickup_date: string
    dropoff_date: string
    class_name: string
    customer: { first_name: string; last_name: string; email: string }
    rate_summary: { total: number; currency_code: string }
    extras: Array<{ code: string; name: string; daily_rate: number }>
  }
  can_modify: boolean
  can_cancel: boolean
  modification_deadline?: string
  cancellation_deadline?: string
  invoice_url?: string
}

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'CONFIRMED' || status === 'CHECKED_OUT') {
    return { background: 'rgba(16,217,160,0.12)', color: '#10d9a0', border: '1px solid rgba(16,217,160,0.2)' }
  }
  if (status === 'CANCELLED') {
    return { background: 'rgba(240,78,78,0.12)', color: '#f04e4e', border: '1px solid rgba(240,78,78,0.2)' }
  }
  return { background: 'rgba(255,255,255,0.07)', color: 'var(--p-text-3)', border: '1px solid rgba(255,255,255,0.12)' }
}

const cosmosCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 16,
  backdropFilter: 'blur(12px)',
  overflow: 'hidden',
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10, color: 'var(--p-text-1)', fontSize: 14,
  fontWeight: 300, outline: 'none',
}

const dlLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 500,
  color: 'var(--p-text-4)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 6,
}

const dlValueStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 300, color: 'var(--p-text-1)',
}

function ManageContent({ token }: { token: string }) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false)
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const [modifyDates, setModifyDates] = useState({ pickup: '', dropoff: '' })
  const [modifySubmitted, setModifySubmitted] = useState(false)

  const { data: managed, isLoading, isError } = useQuery({
    queryKey: ['managed', token],
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/manage/{token}', {
        params: { path: { token } },
      })
      if (error) throw error
      return data as ManagedReservation
    },
    retry: false,
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!managed) return
      await (apiClient as never as {
        DELETE: (path: string, opts: unknown) => Promise<{ error: unknown }>
      }).DELETE('/reservations/{reservationId}', {
        params: { path: { reservationId: managed.reservation.reservation_id } },
      })
    },
    onSuccess: () => {
      setCancelConfirmed(true)
      setCancelDialogOpen(false)
    },
  })

  const modifyMutation = useMutation({
    mutationFn: async () => {
      if (!managed) return
      await (apiClient as never as {
        PATCH: (path: string, opts: unknown) => Promise<{ error: unknown }>
      }).PATCH('/reservations/{reservationId}', {
        params: { path: { reservationId: managed.reservation.reservation_id } },
        body: { pickup_date: modifyDates.pickup, dropoff_date: modifyDates.dropoff },
      })
    },
    onSuccess: () => {
      setModifySubmitted(true)
      setModifyDialogOpen(false)
    },
  })

  if (isLoading) {
    return (
      <div style={cosmosCard} aria-busy="true" aria-label="Loading reservation">
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <Skeleton className="h-6 w-48" />
        </div>
        <div style={{ padding: 24 }}>
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-5 w-full mb-3" />)}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ ...cosmosCard, borderColor: 'rgba(240,78,78,0.25)' }}>
        <div style={{ padding: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.03em', marginBottom: 10 }}>Access Denied</h1>
          <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', marginBottom: 24, lineHeight: 1.6 }}>
            This booking link is invalid or has expired. Check your email for a valid manage-booking link.
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
      </div>
    )
  }

  if (cancelConfirmed) {
    return (
      <div style={{ ...cosmosCard, textAlign: 'center' }}>
        <div style={{ padding: '56px 40px' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'rgba(240,78,78,0.1)',
            border: '1px solid rgba(240,78,78,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f04e4e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.04em', marginBottom: 10 }}>Booking Cancelled</h1>
          <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', marginBottom: 32, lineHeight: 1.6 }}>
            Reservation #{managed?.reservation.confirmation_number} has been cancelled.
            Any applicable refund will be processed within 5–7 business days.
          </p>
          <a href="/" style={{
            padding: '11px 24px', borderRadius: 10,
            background: 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
            color: '#fff', fontWeight: 500, textDecoration: 'none', fontSize: 14,
            boxShadow: '0 0 20px rgba(34,226,168,0.35)',
          }}>
            Book a New Car
          </a>
        </div>
      </div>
    )
  }

  if (modifySubmitted) {
    return (
      <div style={{ ...cosmosCard, textAlign: 'center' }}>
        <div style={{ padding: '56px 40px' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'rgba(16,217,160,0.1)',
            border: '1px solid rgba(16,217,160,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10d9a0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.04em', marginBottom: 10 }}>Dates Updated</h1>
          <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', marginBottom: 32, lineHeight: 1.6 }}>
            Your reservation has been updated. A new confirmation will be sent to your email.
          </p>
          <a href="/" style={{
            padding: '11px 24px', borderRadius: 10,
            background: 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
            color: '#fff', fontWeight: 500, textDecoration: 'none', fontSize: 14,
            boxShadow: '0 0 20px rgba(34,226,168,0.35)',
          }}>
            Back to Home
          </a>
        </div>
      </div>
    )
  }

  if (!managed) return null

  const res = managed.reservation

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Page header */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 10 }}>
          Self-Service
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.05em', marginBottom: 6 }}>
          Manage Your Booking
        </h1>
        <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)' }}>
          Confirmation{' '}
          <span style={{ fontFamily: 'monospace', color: '#22e2a8', fontWeight: 400 }}>#{res.confirmation_number}</span>
        </p>
      </div>

      {/* Main reservation card */}
      <div style={cosmosCard}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 6 }}>Vehicle</p>
            <div style={{ fontSize: 20, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.03em' }}>{res.class_name}</div>
            <div style={{ fontSize: 13, fontWeight: 300, color: 'var(--p-text-3)', marginTop: 4 }}>
              {res.customer.first_name} {res.customer.last_name} · {res.customer.email}
            </div>
          </div>
          <span style={{
            ...statusBadgeStyle(res.status),
            padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 500,
            flexShrink: 0, marginLeft: 12,
          }}>
            {res.status}
          </span>
        </div>

        {/* Details grid */}
        <div style={{ padding: 24 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 32px', marginBottom: 20 }}>
            <div>
              <dt style={dlLabelStyle}>Pickup Date</dt>
              <dd style={dlValueStyle}>{new Date(res.pickup_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</dd>
            </div>
            <div>
              <dt style={dlLabelStyle}>Return Date</dt>
              <dd style={dlValueStyle}>{new Date(res.dropoff_date).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</dd>
            </div>
            {res.extras.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <dt style={dlLabelStyle}>Extras</dt>
                <dd style={dlValueStyle}>{res.extras.map(e => e.name).join(', ')}</dd>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <dt style={dlLabelStyle}>Total</dt>
              <dd style={{ fontSize: 28, fontWeight: 300, color: '#22e2a8', letterSpacing: '-0.04em', marginTop: 4 }}>
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: res.rate_summary.currency_code }).format(res.rate_summary.total)}
              </dd>
            </div>
          </dl>

          {(managed.modification_deadline && managed.can_modify) && (
            <p style={{ fontSize: 12, fontWeight: 300, color: 'var(--p-text-4)', marginBottom: 4 }}>
              Modifications allowed until {new Date(managed.modification_deadline).toLocaleString()}.
            </p>
          )}
          {(managed.cancellation_deadline && managed.can_cancel) && (
            <p style={{ fontSize: 12, fontWeight: 300, color: 'var(--p-text-4)' }}>
              Free cancellation until {new Date(managed.cancellation_deadline).toLocaleString()}.
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexWrap: 'wrap', gap: 10,
        }}>
          {managed.invoice_url && (
            <a href={managed.invoice_url} target="_blank" rel="noreferrer" style={{
              padding: '9px 18px', borderRadius: 10,
              background: 'transparent', color: 'var(--p-text-2)',
              border: '1px solid rgba(255,255,255,0.12)',
              fontWeight: 400, textDecoration: 'none', fontSize: 13,
            }}>
              Download Invoice
            </a>
          )}

          {managed.can_modify && (
            <DialogRoot open={modifyDialogOpen} onOpenChange={setModifyDialogOpen}>
              <DialogTrigger asChild>
                <button
                  onClick={() => {
                    setModifyDates({ pickup: res.pickup_date.slice(0, 10), dropoff: res.dropoff_date.slice(0, 10) })
                  }}
                  style={{
                    padding: '9px 18px', borderRadius: 10,
                    background: 'rgba(34,226,168,0.1)',
                    color: '#22e2a8',
                    border: '1px solid rgba(34,226,168,0.25)',
                    fontWeight: 400, cursor: 'pointer', fontSize: 13,
                  }}
                >
                  Modify Dates
                </button>
              </DialogTrigger>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Modify Booking Dates</DialogTitle>
                </DialogHeader>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
                  <div>
                    <label htmlFor="modify-pickup" style={dlLabelStyle}>New Pickup Date</label>
                    <input
                      id="modify-pickup"
                      type="date"
                      value={modifyDates.pickup}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={e => setModifyDates(d => ({ ...d, pickup: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="modify-dropoff" style={dlLabelStyle}>New Return Date</label>
                    <input
                      id="modify-dropoff"
                      type="date"
                      value={modifyDates.dropoff}
                      min={modifyDates.pickup || new Date().toISOString().slice(0, 10)}
                      onChange={e => setModifyDates(d => ({ ...d, dropoff: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  {modifyMutation.isError && (
                    <div role="alert" style={{
                      background: 'rgba(240,78,78,0.08)', border: '1px solid rgba(240,78,78,0.25)',
                      borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 300, color: '#f04e4e',
                    }}>
                      Modification failed. Please try again.
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <button
                    onClick={() => setModifyDialogOpen(false)}
                    style={{
                      padding: '9px 18px', borderRadius: 10,
                      background: 'transparent', color: 'var(--p-text-2)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      fontWeight: 400, cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => modifyMutation.mutate()}
                    disabled={modifyMutation.isPending || !modifyDates.pickup || !modifyDates.dropoff}
                    aria-busy={modifyMutation.isPending}
                    style={{
                      padding: '9px 18px', borderRadius: 10,
                      background: modifyMutation.isPending ? 'rgba(34,226,168,0.4)' : 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
                      color: '#fff', fontWeight: 500, border: 'none',
                      cursor: modifyMutation.isPending ? 'not-allowed' : 'pointer',
                      boxShadow: '0 0 16px rgba(34,226,168,0.3)',
                      fontSize: 13,
                    }}
                  >
                    {modifyMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </DialogFooter>
              </DialogContent>
            </DialogRoot>
          )}

          {managed.can_cancel && (
            <DialogRoot open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
              <DialogTrigger asChild>
                <button style={{
                  padding: '9px 18px', borderRadius: 10,
                  background: 'rgba(240,78,78,0.08)',
                  color: '#f04e4e',
                  border: '1px solid rgba(240,78,78,0.2)',
                  fontWeight: 400, cursor: 'pointer', fontSize: 13,
                }}>
                  Cancel Booking
                </button>
              </DialogTrigger>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Cancel Your Booking?</DialogTitle>
                </DialogHeader>
                <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', lineHeight: 1.6 }}>
                  This action cannot be undone. Reservation{' '}
                  <strong style={{ color: 'var(--p-text-1)', fontFamily: 'monospace', fontWeight: 400 }}>#{res.confirmation_number}</strong>{' '}
                  will be permanently cancelled.
                </p>
                {cancelMutation.isError && (
                  <div role="alert" style={{
                    background: 'rgba(240,78,78,0.08)', border: '1px solid rgba(240,78,78,0.25)',
                    borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 300, color: '#f04e4e',
                  }}>
                    Cancellation failed. Please try again.
                  </div>
                )}
                <DialogFooter>
                  <button
                    onClick={() => setCancelDialogOpen(false)}
                    style={{
                      padding: '9px 18px', borderRadius: 10,
                      background: 'transparent', color: 'var(--p-text-2)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      fontWeight: 400, cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    Keep Booking
                  </button>
                  <button
                    onClick={() => cancelMutation.mutate()}
                    disabled={cancelMutation.isPending}
                    aria-busy={cancelMutation.isPending}
                    style={{
                      padding: '9px 18px', borderRadius: 10,
                      background: 'rgba(240,78,78,0.15)',
                      color: '#f04e4e',
                      border: '1px solid rgba(240,78,78,0.3)',
                      fontWeight: 500, cursor: cancelMutation.isPending ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {cancelMutation.isPending ? 'Cancelling…' : 'Yes, Cancel'}
                  </button>
                </DialogFooter>
              </DialogContent>
            </DialogRoot>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ManagePage({ params }: ManagePageProps) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-surface)', paddingTop: 48, paddingBottom: 60 }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px' }}>
        <ManageContent token={params.token} />
      </div>
    </div>
  )
}
