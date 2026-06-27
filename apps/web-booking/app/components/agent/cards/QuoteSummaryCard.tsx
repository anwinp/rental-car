'use client'

import { useEffect, useRef, useState } from 'react'

interface LineItem {
  description: string
  amount: number
}

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const fmtCurrency = (n: number, currency = 'USD') =>
  n.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2 })

const fmtDate = (d: string) => {
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return d }
}

/* ── Quote breakdown card — matches /agent-preview QuoteCard ── */

export function QuoteSummaryCard({ data, onAction }: Props) {
  const quoteToken = data.quote_token as string | null
  const isEstimate = Boolean(data.is_estimate)
  const [secs, setSecs] = useState(30)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isEstimate) return
    intervalRef.current = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isEstimate])

  const expired = !isEstimate && secs === 0
  const total = Number(data.total ?? 0)
  const subtotal = Number(data.subtotal ?? total)
  const taxes = Number(data.taxes ?? 0)
  const currency = String(data.currency || 'USD')
  const className = String(data.vehicle_class_name || '')
  const pickupDate = String(data.pickup_date || '')
  const dropoffDate = String(data.dropoff_date || '')
  const days = Number(data.rental_days ?? 1)
  const dailyRate = Number(data.daily_rate ?? 0)
  const lineItems = (data.line_items as LineItem[]) || []

  // Build display rows — prefer real line items, else synthesise base + tax.
  const rows: [string, string, string][] =
    lineItems.length > 0
      ? lineItems.map(li => [li.description, '', fmtCurrency(li.amount, currency)] as [string, string, string])
      : [
          ['Base rate', `${fmtCurrency(dailyRate, currency)} × ${Math.round(days)} days`, fmtCurrency(subtotal, currency)],
        ]
  if (taxes > 0) rows.push(['Taxes & fees', '', fmtCurrency(taxes, currency)])

  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#da291c', textTransform: 'uppercase' }}>YOUR QUOTE</div>
        {isEstimate && (
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#fbbf24', background: 'rgba(251,191,36,0.10)', padding: '3px 8px' }}>ESTIMATE</div>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)', marginBottom: 12 }}>
        {className} · {fmtDate(pickupDate)} – {fmtDate(dropoffDate)}
      </div>

      {rows.map(([label, sub, amt], i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 6 }}>
          <span>{label}{sub ? <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>{sub}</span> : null}</span>
          <span>{amt}</span>
        </div>
      ))}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '10px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 500, color: '#fff' }}>
        <span>TOTAL</span>
        <span>{fmtCurrency(total, currency)}</span>
      </div>

      {/* Countdown bar */}
      {!isEstimate && (
        <div style={{ marginTop: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: secs < 10 ? '#fbbf24' : 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
            <span>{expired ? 'Quote expired' : 'Quote valid for'}</span>
            {!expired && <span style={{ fontWeight: 600 }}>{secs}s</span>}
          </div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.08)' }}>
            <div style={{ height: '100%', width: `${(secs / 30) * 100}%`, background: secs < 10 ? '#fbbf24' : '#da291c', transition: 'width 1s linear, background 0.3s' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: isEstimate ? 12 : 0 }}>
        {expired ? (
          <button
            onClick={() => onAction?.('Search again')}
            style={{ flex: 1, height: 38, background: 'rgba(240,78,78,0.10)', border: '1px solid rgba(240,78,78,0.30)', color: '#f04e4e', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', fontFamily: 'inherit' }}
          >QUOTE EXPIRED — SEARCH AGAIN</button>
        ) : (
          <>
            <button
              onClick={() => onAction?.('Yes, proceed to book')}
              style={{ flex: 1, height: 38, background: '#da291c', border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', fontFamily: 'inherit' }}
            >CONFIRM BOOKING</button>
            <button
              onClick={() => onAction?.('Choose a different car')}
              style={{ flex: 1, height: 38, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >CHANGE OPTIONS</button>
          </>
        )}
      </div>
    </div>
  )
}
