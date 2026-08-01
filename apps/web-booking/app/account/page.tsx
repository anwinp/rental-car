'use client'

import { tenantId } from '../lib/tenant'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const opts = { credentials: 'include' as const, headers: { 'X-Tenant-ID': tenantId() } }

type AuthUser = { user_id: string; first_name: string; last_name: string; email: string }
type CustomerProfile = { phone?: string; license_number?: string; loyalty_tier?: string; loyalty_points?: number }
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

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'CONFIRMED' || status === 'CHECKED_OUT')
    return { background: 'rgba(3,144,74,0.12)', color: '#03904a', border: '1px solid rgba(3,144,74,0.25)' }
  if (status === 'CANCELLED')
    return { background: 'rgba(241,58,44,0.12)', color: '#f13a2c', border: '1px solid rgba(241,58,44,0.25)' }
  if (status === 'RETURNED')
    return { background: '#303030', color: '#666666', border: '1px solid #303030' }
  return { background: '#303030', color: '#969696', border: '1px solid #303030' }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(amount: string | null, currency: string) {
  if (!amount) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount))
}

export default function AccountPage() {
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [customer, setCustomer] = useState<CustomerProfile | null>(null)
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [classMap, setClassMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const meResp = await fetch('/api/v1/auth/me', opts)
      if (!meResp.ok) { router.push('/login'); return }
      const me: AuthUser = await meResp.json()
      setUser(me)

      const [custResp, resResp, classResp] = await Promise.all([
        fetch(`/api/v1/customers/${me.user_id}`, opts),
        fetch(`/api/v1/reservations?customer_id=${me.user_id}&limit=3`, opts),
        fetch('/api/v1/fleet/classes', opts),
      ])

      if (custResp.ok) {
        const custData = await custResp.json()
        setCustomer(custData)
      }
      if (resResp.ok) {
        const resData = await resResp.json()
        const items = Array.isArray(resData) ? resData : (resData.items ?? [])
        setReservations(items)
      }
      if (classResp.ok) {
        const classes: VehicleClass[] = await classResp.json()
        const map: Record<string, string> = {}
        classes.forEach(c => { map[c.class_id] = c.name })
        setClassMap(map)
      }
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [router])

  async function handleSignOut() {
    await fetch('/api/v1/auth/logout', { method: 'POST', ...opts }).catch(() => {})
    window.location.href = '/'
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 80 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ height: 40, width: 240, background: '#303030', borderRadius: 0 }} />
        <div style={{ height: 200, background: '#303030', borderRadius: 0 }} />
        <div style={{ height: 160, background: '#303030', borderRadius: 0 }} />
      </div>
    </div>
  )

  if (!user) return null

  const initials = `${user.first_name.charAt(0).toUpperCase()}${user.last_name.charAt(0).toUpperCase()}`

  return (
    <div style={{ minHeight: '100vh', background: '#181818', paddingTop: 48, paddingBottom: 80 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

        {/* Header with avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 48 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: '#303030',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 600, color: '#ffffff', letterSpacing: '0.02em',
            flexShrink: 0, userSelect: 'none',
          }}>
            {initials}
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 6 }}>
              My Account
            </p>
            <h1 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.05em', margin: 0 }}>
              {user.first_name} {user.last_name}
            </h1>
            <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', marginTop: 4 }}>{user.email}</p>
          </div>
        </div>

        {/* Recent reservations */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 6 }}>
                History
              </p>
              <h2 style={{ fontSize: 22, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', margin: 0 }}>
                Recent Reservations
              </h2>
            </div>
            <a href="/account/reservations" style={{
              fontSize: 13, fontWeight: 700, color: '#ffffff', textDecoration: 'none',
              padding: '8px 16px', border: '1px solid #ffffff', borderRadius: 0,
              letterSpacing: '1.1px', textTransform: 'uppercase',
            }}>
              View All
            </a>
          </div>

          {reservations.length === 0 ? (
            <div style={{
              background: '#303030', border: '1px solid #303030', borderRadius: 0,
              padding: '40px 32px', textAlign: 'center',
            }}>
              <p style={{ fontWeight: 400, color: '#969696', marginBottom: 20 }}>No reservations yet.</p>
              <a href="/" style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 24px', height: 48, borderRadius: 0,
                background: '#da291c', color: '#ffffff', fontWeight: 700, textDecoration: 'none',
                fontSize: 14, letterSpacing: '1.4px', textTransform: 'uppercase',
              }}>
                Book a Car
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

        {/* Profile details */}
        <div style={{ background: '#303030', border: '1px solid #303030', borderRadius: 0, padding: 28 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 16 }}>
            Profile
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.03em', marginBottom: 20 }}>
            Account Details
          </h2>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px', marginBottom: 24 }}>
            {[
              { label: 'Name', value: `${user.first_name} ${user.last_name}` },
              { label: 'Email', value: user.email },
              ...(customer?.phone ? [{ label: 'Phone', value: customer.phone }] : []),
              ...(customer?.loyalty_tier ? [{ label: 'Loyalty Tier', value: customer.loyalty_tier }] : []),
              ...(customer?.loyalty_points != null ? [{ label: 'Loyalty Points', value: String(customer.loyalty_points) }] : []),
            ].map(({ label, value }) => (
              <div key={label}>
                <dt style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 4 }}>{label}</dt>
                <dd style={{ fontSize: 14, fontWeight: 400, color: '#ffffff' }}>{value}</dd>
              </div>
            ))}
          </dl>
          <button
            onClick={handleSignOut}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 20px', height: 48, borderRadius: 0,
              background: 'transparent', color: '#ffffff', border: '1px solid rgba(255,255,255,0.25)',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              letterSpacing: '1.4px', textTransform: 'uppercase', fontFamily: 'inherit',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
