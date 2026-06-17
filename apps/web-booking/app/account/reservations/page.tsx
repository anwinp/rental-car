'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '@rcm/api-client'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@rcm/api-client'
import { Skeleton } from '@rcm/ui'

type ResStatus = 'ALL' | 'CONFIRMED' | 'CHECKED_OUT' | 'RETURNED' | 'CANCELLED'

type ReservationItem = {
  reservation_id: string
  confirmation_number: string
  status: string
  pickup_date: string
  dropoff_date: string
  class_name: string
  rate_summary: { total: number; currency_code: string }
}

const STATUS_TABS: ResStatus[] = ['ALL', 'CONFIRMED', 'CHECKED_OUT', 'RETURNED', 'CANCELLED']

function statusBadgeStyle(status: string): React.CSSProperties {
  if (status === 'CONFIRMED' || status === 'CHECKED_OUT') {
    return { background: 'rgba(16,217,160,0.12)', color: '#10d9a0', border: '1px solid rgba(16,217,160,0.2)' }
  }
  if (status === 'CANCELLED') {
    return { background: 'rgba(240,78,78,0.12)', color: '#f04e4e', border: '1px solid rgba(240,78,78,0.2)' }
  }
  if (status === 'RETURNED') {
    return { background: 'rgba(255,255,255,0.07)', color: 'var(--p-text-3)', border: '1px solid rgba(255,255,255,0.12)' }
  }
  return { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }
}

function statusLabel(s: ResStatus): string {
  if (s === 'ALL') return 'All'
  return s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')
}

export default function ReservationsPage() {
  const router = useRouter()
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const [statusFilter, setStatusFilter] = useState<ResStatus>('ALL')

  useEffect(() => {
    if (!userLoading && !user) router.push('/login')
  }, [user, userLoading, router])

  const { data, isLoading } = useQuery({
    queryKey: ['reservations', 'all', statusFilter],
    queryFn: async () => {
      const queryParams: Record<string, string> = {}
      if (statusFilter !== 'ALL') queryParams['status'] = statusFilter
      const { data: d, error } = await (apiClient as never as {
        GET: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).GET('/reservations', { params: { query: queryParams } })
      if (error) throw error
      return d as { items: ReservationItem[] }
    },
    enabled: !!user,
  })

  if (userLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--p-surface)', padding: '48px 16px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <Skeleton className="h-8 w-64 mb-6" />
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full mb-3" />)}
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-surface)', paddingTop: 40, paddingBottom: 60 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 36, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <a href="/account" style={{
              fontSize: 12, fontWeight: 400, color: '#22e2a8',
              textDecoration: 'none', letterSpacing: '0.04em',
              display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12,
            }}>
              ← Account
            </a>
            <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--p-cyan)', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 8 }}>
              Rental History
            </p>
            <h1 style={{ fontSize: 32, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.05em', margin: 0 }}>
              My Reservations
            </h1>
          </div>
          <a href="/" style={{
            padding: '11px 24px', borderRadius: 10,
            background: 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
            color: '#fff', fontWeight: 500, textDecoration: 'none', fontSize: 14,
            boxShadow: '0 0 20px rgba(34,226,168,0.30)',
            alignSelf: 'flex-end',
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
                padding: '7px 18px',
                borderRadius: 100,
                border: '1px solid',
                borderColor: statusFilter === status ? 'rgba(34,226,168,0.5)' : 'rgba(255,255,255,0.1)',
                background: statusFilter === status ? 'rgba(34,226,168,0.10)' : 'transparent',
                color: statusFilter === status ? '#22e2a8' : 'var(--p-text-4)',
                fontSize: 13,
                fontWeight: statusFilter === status ? 500 : 300,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : !data?.items?.length ? (
          <div style={{
            textAlign: 'center', padding: '56px 24px',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 16,
          }}>
            <p style={{ fontWeight: 300, color: 'var(--p-text-3)', marginBottom: 20 }}>
              {statusFilter === 'ALL' ? 'No reservations found.' : `No ${statusLabel(statusFilter).toLowerCase()} reservations.`}
            </p>
            <a href="/" style={{
              padding: '11px 24px', borderRadius: 10,
              background: 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
              color: '#fff', fontWeight: 500, textDecoration: 'none', fontSize: 14,
              boxShadow: '0 0 20px rgba(34,226,168,0.30)',
            }}>
              Search cars
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.items.map(res => (
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
                    {new Date(res.pickup_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' → '}
                    {new Date(res.dropoff_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 400, color: '#22e2a8', marginTop: 3 }}>#{res.confirmation_number}</div>
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
    </div>
  )
}
