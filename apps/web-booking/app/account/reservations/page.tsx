'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const TENANT = '00000000-0000-0000-0000-000000000001'
const opts = { credentials: 'include' as const, headers: { 'X-Tenant-ID': TENANT } }

type ResStatus = 'ALL' | 'CONFIRMED' | 'CHECKED_OUT' | 'RETURNED' | 'CANCELLED'

type Reservation = {
  reservation_id: string
  confirmation_number: string
  status: string
  pickup_datetime: string
  return_datetime: string
  vehicle_class_id: string
  grand_total: string | null
  currency: string
}

type VehicleClass = { class_id: string; name: string }

const STATUS_TABS: ResStatus[] = ['ALL', 'CONFIRMED', 'CHECKED_OUT', 'RETURNED', 'CANCELLED']

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'CONFIRMED' || status === 'CHECKED_OUT')
    return { background: 'rgba(3,144,74,0.12)', color: '#03904a', border: '1px solid rgba(3,144,74,0.25)' }
  if (status === 'CANCELLED')
    return { background: 'rgba(241,58,44,0.12)', color: '#f13a2c', border: '1px solid rgba(241,58,44,0.25)' }
  if (status === 'RETURNED')
    return { background: '#303030', color: '#666666', border: '1px solid #303030' }
  return { background: '#303030', color: '#969696', border: '1px solid #303030' }
}

function statusLabel(s: ResStatus): string {
  if (s === 'ALL') return 'All'
  if (s === 'CHECKED_OUT') return 'Checked Out'
  return s.charAt(0) + s.slice(1).toLowerCase()
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(amount: string | null, currency: string) {
  if (!amount) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount))
}

export default function ReservationsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [classMap, setClassMap] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<ResStatus>('ALL')
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    async function init() {
      const meResp = await fetch('/api/v1/auth/me', opts)
      if (!meResp.ok) { router.push('/login'); return }
      const me = await meResp.json() as { user_id: string }
      setUserId(me.user_id)

      const classResp = await fetch('/api/v1/fleet/classes', opts)
      if (classResp.ok) {
        const classes: VehicleClass[] = await classResp.json()
        const map: Record<string, string> = {}
        classes.forEach(c => { map[c.class_id] = c.name })
        setClassMap(map)
      }
      setLoading(false)
    }
    init().catch(() => setLoading(false))
  }, [router])

  useEffect(() => {
    if (!userId) return
    setFetching(true)
    const url = statusFilter === 'ALL'
      ? `/api/v1/reservations?customer_id=${userId}&limit=100`
      : `/api/v1/reservations?customer_id=${userId}&status=${statusFilter}&limit=100`
    fetch(url, opts)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const items = Array.isArray(data) ? data : (data.items ?? [])
        setReservations(items)
      })
      .catch(() => setReservations([]))
      .finally(() => setFetching(false))
  }, [userId, statusFilter])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 80 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ height: 40, width: 240, background: '#303030', borderRadius: 0 }} />
        {[...Array(4)].map((_, i) => <div key={i} style={{ height: 76, background: '#303030', borderRadius: 0 }} />)}
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 48, paddingBottom: 80 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 36, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <a href="/account" style={{
              fontSize: 12, fontWeight: 400, color: '#666666', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12, letterSpacing: '0.04em',
            }}>
              ← Account
            </a>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 8 }}>
              Rental History
            </p>
            <h1 style={{ fontSize: 32, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', margin: 0 }}>
              My Reservations
            </h1>
          </div>
          <a href="/" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 24px', height: 48, borderRadius: 0,
            background: '#da291c', color: '#ffffff', fontWeight: 700, textDecoration: 'none',
            fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase', alignSelf: 'flex-end',
          }}>
            New Booking
          </a>
        </div>

        {/* Status filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28, overflowX: 'auto', paddingBottom: 4 }}>
          {STATUS_TABS.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '7px 18px', borderRadius: 9999, border: '1px solid',
                borderColor: statusFilter === status ? '#ffffff' : '#303030',
                background: statusFilter === status ? '#ffffff' : 'transparent',
                color: statusFilter === status ? '#181818' : '#666666',
                fontSize: 13, fontWeight: statusFilter === status ? 700 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s', fontFamily: 'inherit',
              }}
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>

        {/* Results */}
        {fetching ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[...Array(4)].map((_, i) => <div key={i} style={{ height: 76, background: '#303030', borderRadius: 0 }} />)}
          </div>
        ) : reservations.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '56px 24px',
            background: '#303030', border: '1px solid #303030', borderRadius: 0,
          }}>
            <p style={{ fontWeight: 400, color: '#969696', marginBottom: 20 }}>
              {statusFilter === 'ALL' ? 'No reservations found.' : `No ${statusLabel(statusFilter).toLowerCase()} reservations.`}
            </p>
            <a href="/" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 24px', height: 48, borderRadius: 0,
              background: '#da291c', color: '#ffffff', fontWeight: 700, textDecoration: 'none',
              fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase',
            }}>
              Search Cars
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {reservations.map(res => (
              <a
                key={res.reservation_id}
                href={`/manage/${res.confirmation_number}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#303030', border: '1px solid #303030', borderRadius: 0,
                  padding: '18px 22px', textDecoration: 'none', transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(218,41,28,0.5)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#303030' }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: 16, color: '#ffffff', letterSpacing: '-0.02em' }}>
                    {classMap[res.vehicle_class_id] ?? 'Vehicle'}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 400, color: '#969696', marginTop: 3 }}>
                    {fmtDate(res.pickup_datetime)} → {fmtDate(res.return_datetime)}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#666666', marginTop: 3 }}>
                    #{res.confirmation_number}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                  <span style={{ ...statusBadgeStyle(res.status), padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600, display: 'inline-block' }}>
                    {res.status}
                  </span>
                  <div style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginTop: 8, letterSpacing: '-0.02em' }}>
                    {fmtMoney(res.grand_total, res.currency)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
