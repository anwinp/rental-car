import { tenantId } from '../tenant'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const HEADERS = { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId() }

type OTALead = {
  lead_id: string; channel_name: string; ota_booking_ref: string
  customer_name: string; customer_email: string | null
  pickup_date: string | null; return_date: string | null
  vehicle_class_requested: string; status: string; received_at: string | null
  internal_reservation_id: string | null
}

type AvailCheck = { available: boolean; available_count: number }

const CHANNEL_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  BOOKING_COM: { label: 'Booking.com', bg: '#003580', color: '#fff' },
  EXPEDIA:     { label: 'Expedia',     bg: '#ff8000', color: '#000' },
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#d97706', CONFIRMED: '#10b981', REJECTED: '#da291c', EXPIRED: '#666',
}

function OTABadge({ channel }: { channel: string }) {
  const cfg = CHANNEL_CONFIG[channel] ?? { label: channel, bg: 'var(--border)', color: 'var(--text-1)' }
  return (
    <span style={{ background: cfg.bg, color: cfg.color, fontSize: 10, fontWeight: 700,
      padding: '2px 8px', borderRadius: 9999 }}>{cfg.label}</span>
  )
}

export default function OTALeadsPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'CONFIRMED' | 'REJECTED'>('ALL')
  const [availability, setAvailability] = useState<Record<string, AvailCheck>>({})
  const [rejectTarget, setRejectTarget] = useState<OTALead | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data: leads = [], isLoading } = useQuery<OTALead[]>({
    queryKey: ['ota-leads', filter],
    queryFn: () => {
      const params = filter !== 'ALL' ? `?status=${filter}` : ''
      return fetch(`/api/v1/channels/leads${params}`, { credentials: 'include', headers: HEADERS }).then(r => r.json())
    },
    staleTime: 30_000,
  })

  const confirmMutation = useMutation({
    mutationFn: (leadId: string) => fetch(`/api/v1/channels/leads/${leadId}/confirm`, {
      method: 'POST', credentials: 'include', headers: HEADERS,
      body: JSON.stringify({ notify_customer: true }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ota-leads'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ leadId, reason }: { leadId: string; reason: string }) =>
      fetch(`/api/v1/channels/leads/${leadId}/reject`, {
        method: 'POST', credentials: 'include', headers: HEADERS,
        body: JSON.stringify({ reason }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ota-leads'] }); setRejectTarget(null); setRejectReason('') },
  })

  async function checkAvailability(lead: OTALead) {
    if (!lead.pickup_date || !lead.return_date) return
    try {
      // Was /reservations/availability, which is not a route — and it collided
      // with /reservations/{reservation_id}, so the word "availability" was
      // parsed as a UUID and this always came back 422. A lead carries no
      // location, so this asks across the whole fleet.
      const p = new URLSearchParams({
        pickup_dt: `${lead.pickup_date}T00:00:00Z`,
        dropoff_dt: `${lead.return_date}T00:00:00Z`,
      })
      const res = await fetch(`/api/v1/fleet/availability/grid?${p}`,
        { credentials: 'include', headers: HEADERS })
      if (!res.ok) return
      const body = await res.json() as {
        classes: { classCode: string; className: string; availableCount: number }[]
      }
      // The channel sends a class as free text ("SUV", "Intermediate"), so
      // match on name or SIPP code rather than an id the OTA does not know.
      const wanted = lead.vehicle_class_requested.trim().toLowerCase()
      const hit = body.classes.find(
        c => c.className.toLowerCase() === wanted || c.classCode.toLowerCase() === wanted,
      )
      setAvailability(prev => ({
        ...prev,
        [lead.lead_id]: {
          available: (hit?.availableCount ?? 0) > 0,
          available_count: hit?.availableCount ?? 0,
        },
      }))
    } catch {}
  }

  const noChannels = !isLoading && leads.length === 0 && filter === 'ALL'

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Channel Inbox</h1>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['ALL', 'PENDING', 'CONFIRMED', 'REJECTED'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              height: 32, padding: '0 14px', fontSize: 12, fontWeight: 600, borderRadius: 0,
              background: filter === f ? 'var(--text-1)' : 'var(--card-bg)',
              color: filter === f ? 'var(--page-bg)' : 'var(--text-2)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}>{f}</button>
          ))}
        </div>
      </div>

      {noChannels ? (
        <div style={{ padding: '64px 0', textAlign: 'center', background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>No OTA channels configured</p>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>Connect Booking.com or Expedia to receive leads here.</p>
          <a href="/settings" style={{ display: 'inline-block', height: 48, lineHeight: '48px', padding: '0 24px', background: '#da291c', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            Go to Settings
          </a>
        </div>
      ) : isLoading ? (
        <p style={{ color: 'var(--text-3)' }}>Loading leads...</p>
      ) : leads.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No {filter !== 'ALL' ? filter.toLowerCase() : ''} leads.</p>
      ) : (
        <div style={{ border: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 160px 180px 140px 100px 80px 200px', padding: '8px 16px', background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
            {['Source', 'Customer', 'Dates', 'Class', 'Received', 'Status', 'Actions'].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{h}</span>
            ))}
          </div>
          {leads.map(lead => {
            const avail = availability[lead.lead_id]
            return (
              <div key={lead.lead_id} style={{ display: 'grid', gridTemplateColumns: '140px 160px 180px 140px 100px 80px 200px', padding: '12px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                <OTABadge channel={lead.channel_name} />
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>{lead.customer_name}</div>
                  {lead.customer_email && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{lead.customer_email}</div>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {lead.pickup_date} &rarr; {lead.return_date}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{lead.vehicle_class_requested}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {lead.received_at ? new Date(lead.received_at).toLocaleDateString() : ''}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[lead.status] ?? 'var(--text-3)', borderRadius: 9999, padding: '2px 8px', background: 'rgba(0,0,0,0.1)' }}>
                  {lead.status}
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {lead.status === 'PENDING' && (
                    <>
                      {!avail ? (
                        <button onClick={() => checkAvailability(lead)} style={{ height: 28, padding: '0 10px', fontSize: 11, background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 0, cursor: 'pointer' }}>
                          Check Avail
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 600, color: avail.available ? '#10b981' : '#d97706' }}>
                          {avail.available ? `Avail (${avail.available_count})` : 'Unavailable'}
                        </span>
                      )}
                      {avail?.available && (
                        <button onClick={() => confirmMutation.mutate(lead.lead_id)}
                          disabled={confirmMutation.isPending}
                          style={{ height: 28, padding: '0 10px', fontSize: 11, fontWeight: 700, background: '#da291c', color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px' }}>
                          Confirm
                        </button>
                      )}
                      <button onClick={() => setRejectTarget(lead)} style={{ height: 28, padding: '0 10px', fontSize: 11, background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-2)', borderRadius: 0, cursor: 'pointer' }}>
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {rejectTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: 24, width: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-1)' }}>Reject Lead</h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>Reject booking from {rejectTarget.customer_name}?</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection" rows={3}
              style={{ width: '100%', padding: 10, fontSize: 13, background: 'var(--card-bg)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 4, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setRejectTarget(null)} style={{ height: 36, padding: '0 16px', fontSize: 12, background: 'var(--card-bg)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => rejectMutation.mutate({ leadId: rejectTarget.lead_id, reason: rejectReason })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                style={{ height: 36, padding: '0 16px', fontSize: 12, fontWeight: 700, background: '#da291c', color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1.4px' }}>
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
