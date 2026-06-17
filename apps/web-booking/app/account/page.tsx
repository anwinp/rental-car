'use client'

import { useCurrentUser } from '@rcm/api-client'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import { Skeleton } from '@rcm/ui'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

type ReservationItem = {
  reservation_id: string
  confirmation_number: string
  status: string
  pickup_date: string
  dropoff_date: string
  class_name: string
  rate_summary: { total: number; currency_code: string }
}

type ReservationsResponse = {
  items: ReservationItem[]
}

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'CONFIRMED' || status === 'CHECKED_OUT') {
    return { background: 'rgba(16,217,160,0.12)', color: '#10d9a0', border: '1px solid rgba(16,217,160,0.2)' }
  }
  if (status === 'CANCELLED') {
    return { background: 'rgba(240,78,78,0.12)', color: '#f04e4e', border: '1px solid rgba(240,78,78,0.2)' }
  }
  return { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }
}

export default function AccountPage() {
  const router = useRouter()
  const { data: user, isLoading: userLoading } = useCurrentUser()

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login')
    }
  }, [user, userLoading, router])

  const { data: reservations, isLoading: resLoading } = useQuery({
    queryKey: ['reservations', 'recent'],
    queryFn: async () => {
      const { data, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/reservations', { params: { query: { limit: 3 } } })
      if (error) throw error
      return data as ReservationsResponse
    },
    enabled: !!user,
  })

  if (userLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--p-surface)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <Skeleton className="h-8 w-48 mb-6" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 32 }}>
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full mb-3" />)}
        </div>
      </div>
    )
  }

  if (!user) return null

  const loyaltyTier = (user as unknown as Record<string, unknown>)['loyalty_tier'] as string | undefined

  const STATS = [
    { label: 'Total Rentals', value: '12', icon: '🚗' },
    { label: 'Loyalty Points', value: '1,240', icon: '⭐' },
    { label: 'Loyalty Tier', value: loyaltyTier ?? 'Bronze', icon: '🏅' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-surface)', paddingTop: 40, paddingBottom: 60 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p style={{
            fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)',
            textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 10,
          }}>
            My Account
          </p>
          <h1 style={{
            fontSize: 36, fontWeight: 300, color: 'var(--p-text-1)',
            letterSpacing: '-0.05em', margin: 0,
          }}>
            Welcome, {user.first_name}.
          </h1>
          <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', marginTop: 6 }}>{user.email}</p>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 40 }}>
          {STATS.map(stat => (
            <div key={stat.label} style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 16,
              backdropFilter: 'blur(12px)',
              padding: '24px 20px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 24, marginBottom: 10 }} aria-hidden="true">{stat.icon}</div>
              <div style={{ fontSize: 30, fontWeight: 300, color: 'var(--p-brand)', letterSpacing: '-0.04em', lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--p-text-4)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Recent reservations */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 6 }}>History</p>
              <h2 style={{ fontSize: 22, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.04em', margin: 0 }}>Recent Reservations</h2>
            </div>
            <a href="/account/reservations" style={{
              fontSize: 13, fontWeight: 400, color: '#22e2a8',
              textDecoration: 'none', padding: '8px 16px',
              border: '1px solid rgba(34,226,168,0.25)',
              borderRadius: 10,
              transition: 'border-color 0.15s',
            }}>
              View all →
            </a>
          </div>

          {resLoading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : reservations?.items?.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 16, padding: '40px 32px', textAlign: 'center',
            }}>
              <p style={{ fontWeight: 300, color: 'var(--p-text-3)', marginBottom: 20 }}>No reservations yet.</p>
              <a href="/" style={{
                padding: '11px 24px', borderRadius: 10,
                background: 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
                color: '#fff', fontWeight: 500, textDecoration: 'none', fontSize: 14,
                boxShadow: '0 0 20px rgba(34,226,168,0.30)',
              }}>
                Book your first car
              </a>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {reservations?.items?.map(res => (
                <a
                  key={res.reservation_id}
                  href={`/manage/${res.confirmation_number}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 14, padding: '18px 22px',
                    textDecoration: 'none',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,226,168,0.35)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(34,226,168,0.10)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'
                    ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 300, fontSize: 16, color: 'var(--p-text-1)', letterSpacing: '-0.02em' }}>{res.class_name}</div>
                    <div style={{ fontSize: 13, fontWeight: 300, color: 'var(--p-text-3)', marginTop: 3 }}>
                      {new Date(res.pickup_date).toLocaleDateString()} → {new Date(res.dropoff_date).toLocaleDateString()}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 400, color: '#22e2a8', marginTop: 3 }}>
                      #{res.confirmation_number}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                    <span style={{
                      ...statusBadgeStyle(res.status),
                      padding: '3px 10px', borderRadius: 100, fontSize: 12, fontWeight: 500,
                      display: 'inline-block',
                    }}>
                      {res.status}
                    </span>
                    <div style={{ fontSize: 16, fontWeight: 300, color: 'var(--p-text-1)', marginTop: 8, letterSpacing: '-0.02em' }}>
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: res.rate_summary.currency_code }).format(res.rate_summary.total)}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Account details */}
        <div style={{
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          backdropFilter: 'blur(12px)',
          padding: 28,
        }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 16 }}>Profile</p>
          <h2 style={{ fontSize: 20, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.03em', marginBottom: 20 }}>Account Details</h2>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 32px', marginBottom: 24 }}>
            {[
              { label: 'Name', value: `${user.first_name} ${user.last_name}` },
              { label: 'Email', value: user.email },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</dt>
                <dd style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-1)' }}>{value}</dd>
              </div>
            ))}
          </dl>
          <button
            onClick={() => { window.location.href = '/' }}
            style={{
              padding: '9px 20px', borderRadius: 10,
              background: 'transparent', color: 'var(--p-text-3)',
              border: '1px solid rgba(255,255,255,0.12)',
              fontSize: 13, fontWeight: 400, cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
