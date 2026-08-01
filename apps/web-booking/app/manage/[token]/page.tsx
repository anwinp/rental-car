'use client'

import { tenantId } from '../../lib/tenant'

import { useEffect, useState } from 'react'

const opts = { credentials: 'include' as const, headers: { 'X-Tenant-ID': tenantId() } }

type Reservation = {
  reservation_id: string
  confirmation_number: string
  status: string
  pickup_date: string
  dropoff_date: string
  class_name: string
  rate_summary: { total: number; currency_code: string }
  customer: { first_name: string; last_name: string; email: string }
}

type AuthUser = { user_id: string; first_name: string }

// ── Design tokens ────────────────────────────────────────────────────────────
const DIVIDER  = '1px solid rgba(255,255,255,0.07)'
const CARD_BG  = '#242424'
const CARD_BDR = '1px solid rgba(255,255,255,0.08)'

const dlLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#666666',
  textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 5,
  display: 'block',
}
const dlValue: React.CSSProperties = {
  fontSize: 15, fontWeight: 400, color: '#ffffff', lineHeight: 1.4,
}

const inputSt: React.CSSProperties = {
  display: 'block', width: '100%', padding: '0 14px', height: 48,
  background: '#181818', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4,
  color: '#ffffff', fontSize: 14, fontWeight: 400, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 28px', height: 48, borderRadius: 0,
  background: '#da291c', color: '#ffffff', border: 'none',
  fontSize: 13, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
  cursor: 'pointer', fontFamily: 'inherit',
}

const btnGhost: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 28px', height: 48, borderRadius: 0,
  background: 'transparent', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)',
  fontSize: 13, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
  cursor: 'pointer', fontFamily: 'inherit',
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, React.CSSProperties> = {
    CONFIRMED:   { background: 'rgba(3,144,74,0.14)',    color: '#03904a', border: '1px solid rgba(3,144,74,0.28)' },
    CHECKED_OUT: { background: 'rgba(3,144,74,0.14)',    color: '#03904a', border: '1px solid rgba(3,144,74,0.28)' },
    CANCELLED:   { background: 'rgba(218,41,28,0.12)',   color: '#f13a2c', border: '1px solid rgba(218,41,28,0.28)' },
    RETURNED:    { background: 'rgba(255,255,255,0.06)', color: '#969696', border: '1px solid rgba(255,255,255,0.12)' },
  }
  const st = styles[status] ?? { background: 'rgba(255,255,255,0.06)', color: '#969696', border: '1px solid rgba(255,255,255,0.12)' }
  return (
    <span style={{ ...st, padding: '5px 14px', borderRadius: 9999, fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Modal ────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1c1c1c', border: CARD_BDR, borderRadius: 0, width: '100%', maxWidth: 480, padding: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', marginBottom: 24 }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtMoney(amount: number | null | undefined, currency: string) {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)
}

function rentalDays(from: string, to: string) {
  return Math.max(1, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000))
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ManagePage({ params }: { params: { token: string } }) {
  const confirmationNumber = params.token
  const [res, setRes]     = useState<Reservation | null>(null)
  const [user, setUser]   = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const [cancelOpen, setCancelOpen]   = useState(false)
  const [cancelBusy, setCancelBusy]   = useState(false)
  const [cancelDone, setCancelDone]   = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const [modifyOpen, setModifyOpen]   = useState(false)
  const [modifyBusy, setModifyBusy]   = useState(false)
  const [modifyDone, setModifyDone]   = useState(false)
  const [modifyError, setModifyError] = useState<string | null>(null)
  const [newPickup, setNewPickup]     = useState('')
  const [newDropoff, setNewDropoff]   = useState('')

  useEffect(() => {
    async function load() {
      const [resResp, meResp] = await Promise.all([
        fetch(`/api/v1/reservations/public/${confirmationNumber}`, opts),
        fetch('/api/v1/auth/me', opts),
      ])
      if (!resResp.ok) { setError('Reservation not found or link has expired.'); setLoading(false); return }
      const [resData, meData] = await Promise.all([
        resResp.json(),
        meResp.ok ? meResp.json() : null,
      ])
      setRes(resData)
      setUser(meData)
      setNewPickup(resData.pickup_date ?? '')
      setNewDropoff(resData.dropoff_date ?? '')
      setLoading(false)
    }
    load().catch(() => { setError('Unable to load reservation.'); setLoading(false) })
  }, [confirmationNumber])

  async function handleCancel() {
    if (!res) return
    setCancelBusy(true); setCancelError(null)
    const r = await fetch(`/api/v1/reservations/${res.reservation_id}/cancel`, { method: 'POST', ...opts })
    if (r.ok) {
      setCancelDone(true); setCancelOpen(false)
      setRes(prev => prev ? { ...prev, status: 'CANCELLED' } : null)
    } else {
      const d = await r.json().catch(() => ({})) as { detail?: string }
      setCancelError(d.detail ?? 'Cancellation failed.')
    }
    setCancelBusy(false)
  }

  async function handleModify() {
    if (!res || !newPickup || !newDropoff) return
    setModifyBusy(true); setModifyError(null)
    const r = await fetch(`/api/v1/reservations/${res.reservation_id}`, {
      method: 'PATCH',
      ...opts,
      headers: { ...opts.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_dt: `${newPickup}T10:00:00+00:00`, dropoff_dt: `${newDropoff}T10:00:00+00:00` }),
    })
    if (r.ok) { setModifyDone(true); setModifyOpen(false) }
    else {
      const d = await r.json().catch(() => ({})) as { detail?: string }
      setModifyError(d.detail ?? 'Modification failed.')
    }
    setModifyBusy(false)
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 96 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ height: 14, width: 140, background: '#303030', marginBottom: 16 }} />
        <div style={{ height: 36, width: 260, background: '#303030', marginBottom: 8 }} />
        <div style={{ height: 14, width: 200, background: '#242424', marginBottom: 40 }} />
        <div style={{ height: 320, background: CARD_BG, border: CARD_BDR }} />
      </div>
    </div>
  )

  // ── Error state ────────────────────────────────────────────────────────────
  if (error || !res) return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 96 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ background: CARD_BG, border: CARD_BDR, padding: '48px 40px', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(218,41,28,0.1)', border: '1px solid rgba(218,41,28,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#da291c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', marginBottom: 10 }}>Not Found</h1>
          <p style={{ fontSize: 14, color: '#969696', lineHeight: 1.6, marginBottom: 32 }}>
            {error ?? 'This booking link is invalid or has expired.'}
          </p>
          <a href="/" style={{ ...btnGhost, textDecoration: 'none' }}>Back to Home</a>
        </div>
      </div>
    </div>
  )

  const canAct = user && res.status === 'CONFIRMED'
  const days   = res.pickup_date && res.dropoff_date ? rentalDays(res.pickup_date, res.dropoff_date) : null
  const dailyRate = res.rate_summary?.total && days ? res.rate_summary.total / days : null

  return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 80, paddingBottom: 96 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 24px' }}>

        {/* ── Page header ── */}
        <div style={{ marginBottom: 36 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.2px', marginBottom: 10 }}>
            Booking Management
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 34, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', margin: 0 }}>
              {res.class_name}
            </h1>
            <StatusBadge status={res.status} />
          </div>
          <p style={{ fontSize: 13, fontWeight: 400, color: '#666666', marginTop: 8, fontFamily: 'monospace', letterSpacing: '0.04em' }}>
            {res.confirmation_number}
          </p>
        </div>

        {/* ── Banners ── */}
        {cancelDone && (
          <div style={{ background: 'rgba(218,41,28,0.07)', border: '1px solid rgba(218,41,28,0.2)', padding: '14px 20px', marginBottom: 24, fontSize: 14, color: '#f13a2c', lineHeight: 1.5 }}>
            Reservation cancelled. Any applicable refund will be processed within 5–7 business days.
          </div>
        )}
        {modifyDone && (
          <div style={{ background: 'rgba(3,144,74,0.07)', border: '1px solid rgba(3,144,74,0.2)', padding: '14px 20px', marginBottom: 24, fontSize: 14, color: '#03904a', lineHeight: 1.5 }}>
            Dates updated successfully. A confirmation will be sent to your email.
          </div>
        )}

        {/* ── Main card ── */}
        <div style={{ background: CARD_BG, border: CARD_BDR, marginBottom: 12 }}>

          {/* Dates row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '28px 28px 24px' }}>
            <div>
              <span style={dlLabel}>Pick-up</span>
              <span style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', display: 'block' }}>
                {fmtDate(res.pickup_date)}
              </span>
            </div>
            {/* Arrow connector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px' }}>
              <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.15)' }} />
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M1 5h8M6 2l3 3-3 3" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {days && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#666666', letterSpacing: '0.8px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {days}d
                </span>
              )}
              <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.15)' }} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={dlLabel}>Return</span>
              <span style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', display: 'block' }}>
                {fmtDate(res.dropoff_date)}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: DIVIDER, margin: '0 28px' }} />

          {/* Driver + vehicle detail row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 24px', padding: '24px 28px' }}>
            <div>
              <span style={dlLabel}>Driver</span>
              <span style={dlValue}>{res.customer.first_name} {res.customer.last_name}</span>
            </div>
            <div>
              <span style={dlLabel}>Email</span>
              <span style={{ ...dlValue, fontSize: 13, color: '#969696' }}>{res.customer.email}</span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: DIVIDER }} />

          {/* Total row */}
          <div style={{ padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={dlLabel}>Total Charge</span>
              {dailyRate && days && (
                <span style={{ fontSize: 12, color: '#666666' }}>
                  {fmtMoney(dailyRate, res.rate_summary.currency_code)} / day × {days} days
                </span>
              )}
            </div>
            <span style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em' }}>
              {fmtMoney(res.rate_summary?.total, res.rate_summary?.currency_code)}
            </span>
          </div>

          {/* Actions */}
          {canAct && (
            <>
              <div style={{ borderTop: DIVIDER }} />
              <div style={{ padding: '20px 28px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={btnGhost} onClick={() => setModifyOpen(true)}>
                  Modify Dates
                </button>
                <button
                  onClick={() => setCancelOpen(true)}
                  style={{ ...btnGhost, color: '#f13a2c', borderColor: 'rgba(218,41,28,0.3)' }}
                >
                  Cancel Booking
                </button>
              </div>
            </>
          )}

          {!user && res.status === 'CONFIRMED' && (
            <>
              <div style={{ borderTop: DIVIDER }} />
              <div style={{ padding: '20px 28px', background: 'rgba(255,255,255,0.02)' }}>
                <p style={{ fontSize: 13, color: '#969696', marginBottom: 16, lineHeight: 1.5 }}>
                  Sign in to modify or cancel this reservation.
                </p>
                <a href={`/login?return=/manage/${res.confirmation_number}`} style={{ ...btnPrimary, textDecoration: 'none' }}>
                  Sign In
                </a>
              </div>
            </>
          )}
        </div>

        {/* ── Footer links ── */}
        <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
          <a
            href={`/confirmation/${res.confirmation_number}`}
            style={{ fontSize: 13, color: '#666666', textDecoration: 'none', letterSpacing: '0.2px', transition: 'color 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ffffff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#666666' }}
          >
            Full Confirmation
          </a>
          <a
            href="/"
            style={{ fontSize: 13, color: '#666666', textDecoration: 'none', letterSpacing: '0.2px', transition: 'color 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ffffff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#666666' }}
          >
            Back to Home
          </a>
        </div>
      </div>

      {/* ── Modify modal ── */}
      <Modal open={modifyOpen} onClose={() => setModifyOpen(false)} title="Modify Dates">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
          <div>
            <label style={dlLabel}>New Pick-up Date</label>
            <input type="date" value={newPickup} min={new Date().toISOString().slice(0, 10)} onChange={e => { setNewPickup(e.target.value); if (newDropoff && e.target.value >= newDropoff) setNewDropoff('') }} style={inputSt} />
          </div>
          <div>
            <label style={dlLabel}>New Return Date</label>
            <input type="date" value={newDropoff} min={newPickup || new Date().toISOString().slice(0, 10)} onChange={e => setNewDropoff(e.target.value)} style={inputSt} />
          </div>
          {modifyError && (
            <div style={{ fontSize: 13, color: '#f13a2c', padding: '10px 14px', background: 'rgba(218,41,28,0.07)', border: '1px solid rgba(218,41,28,0.2)' }}>
              {modifyError}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={btnGhost} onClick={() => setModifyOpen(false)}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: modifyBusy ? 0.55 : 1 }} onClick={handleModify} disabled={modifyBusy}>
            {modifyBusy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      {/* ── Cancel modal ── */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this booking?">
        <p style={{ fontSize: 14, color: '#969696', lineHeight: 1.65, marginBottom: 8 }}>
          This action cannot be undone.
        </p>
        <p style={{ fontSize: 14, color: '#969696', lineHeight: 1.65, marginBottom: 24 }}>
          Reservation{' '}
          <span style={{ color: '#ffffff', fontFamily: 'monospace' }}>{res.confirmation_number}</span>
          {' '}will be permanently cancelled and any applicable refund processed within 5–7 business days.
        </p>
        {cancelError && (
          <div style={{ fontSize: 13, color: '#f13a2c', padding: '10px 14px', background: 'rgba(218,41,28,0.07)', border: '1px solid rgba(218,41,28,0.2)', marginBottom: 16 }}>
            {cancelError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={btnGhost} onClick={() => setCancelOpen(false)}>Keep Booking</button>
          <button
            style={{ ...btnPrimary, background: cancelBusy ? '#6a1208' : '#b01e0a', opacity: cancelBusy ? 0.7 : 1 }}
            onClick={handleCancel}
            disabled={cancelBusy}
          >
            {cancelBusy ? 'Cancelling…' : 'Yes, Cancel'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
