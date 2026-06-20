'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

/* ─────────────────────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────────────────────── */

type ScenarioId = 'booking' | 'manage' | 'dispute'

interface VehicleOption {
  cls: string
  tagline: string
  features: string[]
  pricePerDay: number
  total: number
  days: number
  available: number
  low?: boolean
}

interface QuoteData {
  cls: string
  route: string
  dates: string
  baseRate: number
  days: number
  cdw: number
  gps: number
  tax: number
  total: number
}

interface ConfirmData {
  number: string
  cls: string
  location: string
  dates: string
  vehicle: string
  total: number
}

interface ReservationData {
  number: string
  cls: string
  location: string
  dates: string
  status: string
  total: number
}

interface FuelData {
  prePct: number
  postPct: number
  preLabel: string
  postLabel: string
  charge: number
}

type CardPayload =
  | { kind: 'vehicles'; vehicles: VehicleOption[] }
  | { kind: 'quote'; quote: QuoteData }
  | { kind: 'confirm'; confirm: ConfirmData }
  | { kind: 'reservation'; reservation: ReservationData }
  | { kind: 'fuel'; fuel: FuelData }
  | { kind: 'dispute' }

interface ChatMessage {
  id: string
  role: 'agent' | 'user'
  text: string
  card?: CardPayload
  chips?: string[]
}

interface ScenarioStep {
  trigger: string | null   // null = first auto-message
  thinking: string | null
  text: string
  card?: CardPayload
  chips?: string[]
}

/* ─────────────────────────────────────────────────────────────────────────────
   SCENARIO DATA
───────────────────────────────────────────────────────────────────────────── */

const SCENARIOS: Record<ScenarioId, { label: string; sub: string; steps: ScenarioStep[] }> = {
  booking: {
    label: 'Book a Car',
    sub: 'Customer books Economy at LAX, Jul 4–7',
    steps: [
      {
        trigger: null,
        thinking: null,
        text: 'Welcome to RCM Rentals. I can help you book, modify, or manage your rental. What can I help you with today?',
        chips: ['Book a car', 'Manage booking', 'Return a rental', 'Dispute a charge'],
      },
      {
        trigger: 'Book a car',
        thinking: 'Checking available classes at LAX…',
        text: 'I found 3 classes available at LAX for July 4–7 (3 days). Which works for you?',
        card: {
          kind: 'vehicles',
          vehicles: [
            { cls: 'Economy', tagline: 'Smart miles, smart spend', features: ['A/C', 'Automatic', 'Bluetooth', 'Backup Cam'], pricePerDay: 36, total: 108, days: 3, available: 2 },
            { cls: 'Compact', tagline: 'More room, same economy', features: ['A/C', 'Auto', 'Bluetooth', 'CarPlay'], pricePerDay: 44, total: 132, days: 3, available: 4 },
            { cls: 'Full-Size SUV', tagline: 'Space for every journey', features: ['A/C', '4WD', 'CarPlay', 'Sunroof'], pricePerDay: 89, total: 267, days: 3, available: 1, low: true },
          ],
        },
        chips: ['Economy → $36/day', 'Compact → $44/day', 'SUV → $89/day'],
      },
      {
        trigger: 'Economy → $36/day',
        thinking: 'Calculating your rate…',
        text: "Here's your quote for Economy class at LAX, July 4–7. Review and confirm when you're ready.",
        card: {
          kind: 'quote',
          quote: { cls: 'Economy', route: 'LAX → LAX', dates: 'Jul 4 – Jul 7', baseRate: 36.08, days: 3, cdw: 12.00, gps: 8.50, tax: 10.62, total: 139.36 },
        },
        chips: ['Confirm booking', 'Change options'],
      },
      {
        trigger: 'Confirm booking',
        thinking: 'Securing your reservation…',
        text: 'Your booking is confirmed. See you at LAX on July 4.',
        card: {
          kind: 'confirm',
          confirm: { number: 'RCM-20260704-ABCDE', cls: 'Economy', location: 'Los Angeles (LAX)', dates: 'Jul 4 · 10:00 AM → Jul 7 · 10:00 AM', vehicle: 'Toyota Corolla or similar', total: 139.36 },
        },
        chips: ['Add extras', 'Email confirmation', "I'm done"],
      },
    ],
  },

  manage: {
    label: 'Manage Booking',
    sub: 'Customer extends their return date by 2 days',
    steps: [
      {
        trigger: null,
        thinking: null,
        text: 'I can help you modify or cancel your booking. Share your confirmation number or the email you booked with.',
        chips: ['Use confirmation number', 'Use my email'],
      },
      {
        trigger: 'Use confirmation number',
        thinking: 'Looking up your reservation…',
        text: 'Found your booking. Economy at LAX, July 4–7. What do you need?',
        card: {
          kind: 'reservation',
          reservation: { number: 'RCM-20260704-ABCDE', cls: 'Economy', location: 'Los Angeles (LAX)', dates: 'Jul 4 – Jul 7 · 3 days', status: 'CONFIRMED', total: 139.36 },
        },
        chips: ['Extend return date', 'Cancel booking', 'Add extras'],
      },
      {
        trigger: 'Extend return date',
        thinking: 'Checking availability and recalculating…',
        text: 'I can extend your return to July 9 (+2 days). New total is $215.00 — an increase of $75.64.',
        card: {
          kind: 'quote',
          quote: { cls: 'Economy (extended)', route: 'LAX → LAX', dates: 'Jul 4 – Jul 9', baseRate: 36.08, days: 5, cdw: 12.00, gps: 8.50, tax: 17.72, total: 215.00 },
        },
        chips: ['Confirm extension', 'Keep original dates'],
      },
      {
        trigger: 'Confirm extension',
        thinking: 'Updating your reservation…',
        text: 'Done. Your return is now July 9 at 10:00 AM. The $75.64 difference will be charged to your Visa ••4521.',
        card: {
          kind: 'confirm',
          confirm: { number: 'RCM-20260704-ABCDE', cls: 'Economy', location: 'Los Angeles (LAX)', dates: 'Jul 4 · 10:00 AM → Jul 9 · 10:00 AM', vehicle: 'Toyota Corolla or similar', total: 215.00 },
        },
        chips: ['Email updated confirmation', "I'm done"],
      },
    ],
  },

  dispute: {
    label: 'Dispute a Charge',
    sub: 'Customer questions a fuel surcharge after return',
    steps: [
      {
        trigger: null,
        thinking: null,
        text: "I can review any post-rental charge. What's your confirmation number?",
        chips: ['RCM-20260704-ABCDE'],
      },
      {
        trigger: 'RCM-20260704-ABCDE',
        thinking: 'Retrieving your rental record and inspection photos…',
        text: 'I found a $20.00 fuel surcharge on this rental. Here\'s the fuel level recorded at pickup vs. return.',
        card: {
          kind: 'fuel',
          fuel: { prePct: 100, postPct: 75, preLabel: 'FULL', postLabel: '¾ TANK', charge: 20.00 },
        },
        chips: ['Dispute this charge', 'Charge is correct'],
      },
      {
        trigger: 'Dispute this charge',
        thinking: 'Filing your dispute…',
        text: "I've logged your dispute for the $20.00 fuel charge. Our team will review the sensor data and receipt and respond within 1 business day.",
        card: { kind: 'dispute' },
        chips: ['Talk to a person', 'Email dispute reference', "I'm done"],
      },
    ],
  },
}

/* ─────────────────────────────────────────────────────────────────────────────
   CARD COMPONENTS
───────────────────────────────────────────────────────────────────────────── */

function VehicleCard({ v, onSelect }: { v: VehicleOption; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#1e1e1e',
        border: `1px solid ${hovered ? 'rgba(218,41,28,0.45)' : 'rgba(255,255,255,0.08)'}`,
        borderTop: hovered ? '2px solid #da291c' : '2px solid transparent',
        padding: '16px 18px',
        marginTop: 8,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#da291c', textTransform: 'uppercase' }}>{v.cls}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>{v.tagline}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {v.low
            ? <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600, letterSpacing: '0.06em' }}>ONLY {v.available} LEFT</div>
            : <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, letterSpacing: '0.06em' }}>✓ {v.available} AVAILABLE</div>
          }
        </div>
      </div>

      {/* Silhouette placeholder */}
      <div style={{ height: 44, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0', border: '1px solid rgba(255,255,255,0.04)' }}>
        <svg width="80" height="28" viewBox="0 0 80 28" fill="none" style={{ opacity: 0.35 }}>
          <path d="M4 20h72M10 20c0-4 2-8 6-10h36c4 2 8 6 8 10M22 10l4-6h16l4 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="20" cy="22" r="4" stroke="white" strokeWidth="1.5"/>
          <circle cx="60" cy="22" r="4" stroke="white" strokeWidth="1.5"/>
        </svg>
      </div>

      {/* Features */}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 12 }}>
        {v.features.join(' · ')}
      </div>

      {/* Price + CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 22, fontWeight: 300, color: '#fff', letterSpacing: '-0.03em' }}>${v.pricePerDay}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginLeft: 4 }}>/day</span>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>${v.total} for {v.days} days</div>
        </div>
        <button
          onClick={onSelect}
          style={{
            background: hovered ? '#da291c' : 'transparent',
            border: '1px solid rgba(218,41,28,0.60)',
            color: hovered ? '#fff' : '#da291c',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            padding: '0 16px', height: 34,
            cursor: 'pointer', transition: 'all 0.15s',
            fontFamily: 'inherit',
          }}
        >
          SELECT →
        </button>
      </div>
    </div>
  )
}

function QuoteCard({ q, onConfirm, onChange }: { q: QuoteData; onConfirm: () => void; onChange?: () => void }) {
  const [secs, setSecs] = useState(30)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const rows: [string, string, string][] = [
    ['Base rate', `$${q.baseRate.toFixed(2)} × ${q.days} days`, `$${(q.baseRate * q.days).toFixed(2)}`],
    ['CDW coverage', 'Per day', `$${(q.cdw * q.days).toFixed(2)}`],
    ['GPS navigation', 'Per rental', `$${q.gps.toFixed(2)}`],
    ['Tax (8.25%)', '', `$${q.tax.toFixed(2)}`],
  ]
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#da291c', textTransform: 'uppercase', marginBottom: 10 }}>YOUR QUOTE</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)', marginBottom: 12 }}>{q.cls} · {q.route} · {q.dates}</div>
      {rows.map(([label, sub, amt]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 6 }}>
          <span>{label}{sub ? <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>{sub}</span> : null}</span>
          <span>{amt}</span>
        </div>
      ))}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '10px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 500, color: '#fff' }}>
        <span>TOTAL</span>
        <span>${q.total.toFixed(2)}</span>
      </div>
      {/* Countdown bar */}
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: secs < 10 ? '#fbbf24' : 'rgba(255,255,255,0.35)', marginBottom: 4 }}>
          <span>Quote valid for</span>
          <span style={{ fontWeight: 600 }}>{secs}s</span>
        </div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.08)' }}>
          <div style={{ height: '100%', width: `${(secs / 30) * 100}%`, background: secs < 10 ? '#fbbf24' : '#da291c', transition: 'width 1s linear, background 0.3s' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onConfirm}
          style={{ flex: 1, height: 38, background: '#da291c', border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', fontFamily: 'inherit' }}
        >CONFIRM BOOKING</button>
        {onChange && (
          <button
            onClick={onChange}
            style={{ flex: 1, height: 38, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >CHANGE OPTIONS</button>
        )}
      </div>
    </div>
  )
}

function ConfirmCard({ c }: { c: ConfirmData }) {
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(34,197,94,0.20)', borderTop: '2px solid #22c55e', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#22c55e', textTransform: 'uppercase' }}>CONFIRMED</div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 300, color: '#fff', letterSpacing: '0.04em', marginBottom: 12 }}>{c.number}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[['Class', c.cls], ['Location', c.location], ['Dates', c.dates], ['Vehicle', c.vehicle], ['Total charged', `$${c.total.toFixed(2)}`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.40)' }}>{k}</span>
            <span style={{ color: k === 'Total charged' ? '#fff' : 'rgba(255,255,255,0.80)', fontWeight: k === 'Total charged' ? 500 : 400, textAlign: 'right', maxWidth: '55%' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReservationCard({ r }: { r: ReservationData }) {
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase' }}>YOUR BOOKING</div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#22c55e', background: 'rgba(34,197,94,0.10)', padding: '3px 8px' }}>● {r.status}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 10, letterSpacing: '0.02em' }}>{r.number}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {[['Class', r.cls], ['Location', r.location], ['Dates', r.dates], ['Total', `$${r.total.toFixed(2)}`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.40)' }}>{k}</span>
            <span style={{ color: 'rgba(255,255,255,0.80)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FuelCard({ f }: { f: FuelData }) {
  const GaugeBar = ({ pct, label, good }: { pct: number; label: string; good: boolean }) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', marginBottom: 6 }}>
        {good ? 'PICKUP' : 'RETURN'}
      </div>
      <div style={{ height: 80, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'flex-end', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: `${pct}%`, background: good ? 'rgba(34,197,94,0.30)' : 'rgba(251,191,36,0.30)', borderTop: `1px solid ${good ? '#22c55e' : '#fbbf24'}`, transition: 'height 0.8s ease-out' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 16, fontWeight: 300, color: '#fff' }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: 10, color: good ? '#22c55e' : '#fbbf24', fontWeight: 600, textAlign: 'center', marginTop: 4 }}>{pct}%</div>
    </div>
  )
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(251,191,36,0.20)', borderTop: '2px solid #fbbf24', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#fbbf24', textTransform: 'uppercase', marginBottom: 12 }}>FUEL COMPARISON</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <GaugeBar pct={f.prePct} label={f.preLabel} good={true} />
        <div style={{ display: 'flex', alignItems: 'center', paddingTop: 36, color: 'rgba(255,255,255,0.30)', fontSize: 18 }}>→</div>
        <GaugeBar pct={f.postPct} label={f.postLabel} good={false} />
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: 'rgba(255,255,255,0.50)' }}>Fuel surcharge applied</span>
          <span style={{ color: '#fbbf24', fontWeight: 600 }}>${f.charge.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Vehicle returned at 75% (2 steps below contracted 100%)</div>
      </div>
    </div>
  )
}

function DisputeCard() {
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid rgba(139,92,246,0.20)', borderTop: '2px solid #8b5cf6', padding: '16px 18px', marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#8b5cf6', textTransform: 'uppercase', marginBottom: 10 }}>DISPUTE FILED</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { step: '1', done: true,  label: 'Dispute logged', sub: 'Reference #DSP-20260705-001' },
          { step: '2', done: false, label: 'Sensor data review', sub: 'Est. 1 business day' },
          { step: '3', done: false, label: 'Decision & refund', sub: 'If upheld, refund in 3–5 days' },
        ].map(row => (
          <div key={row.step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 20, height: 20, flexShrink: 0, borderRadius: '50%', background: row.done ? 'rgba(139,92,246,0.20)' : 'rgba(255,255,255,0.05)', border: `1px solid ${row.done ? '#8b5cf6' : 'rgba(255,255,255,0.10)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: row.done ? '#8b5cf6' : 'rgba(255,255,255,0.25)' }}>
              {row.done ? '✓' : row.step}
            </div>
            <div>
              <div style={{ fontSize: 12, color: row.done ? '#fff' : 'rgba(255,255,255,0.45)', fontWeight: row.done ? 500 : 400 }}>{row.label}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginTop: 1 }}>{row.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   PROGRESS BAR
───────────────────────────────────────────────────────────────────────────── */

function ProgressMessage({ phrase }: { phrase: string }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t1 = setTimeout(() => setWidth(70), 60)
    return () => clearTimeout(t1)
  }, [])
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Monogram />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>RCM</div>
        <div style={{ overflow: 'hidden', height: 2, background: 'rgba(255,255,255,0.06)', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${width}%`, background: '#da291c', transition: 'width 0.4s ease-out' }} />
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.40)', fontStyle: 'italic' }}>{phrase}</div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   MONOGRAM
───────────────────────────────────────────────────────────────────────────── */

function Monogram({ mode = 'default' }: { mode?: 'default' | 'damage' | 'payment' }) {
  const bg = mode === 'damage'
    ? 'linear-gradient(135deg,#b45309 0%,#7c2d12 100%)'
    : mode === 'payment'
      ? 'linear-gradient(135deg,#15803d 0%,#14532d 100%)'
      : 'linear-gradient(135deg,#da291c 0%,#7a1208 100%)'
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 500, color: '#fff', letterSpacing: 0 }}>
      R
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   CHAT MESSAGE
───────────────────────────────────────────────────────────────────────────── */

function MessageRow({ msg, onChipClick }: { msg: ChatMessage; onChipClick: (chip: string) => void }) {
  const mono = msg.card?.kind === 'fuel' || msg.card?.kind === 'dispute' ? 'damage' : msg.card?.kind === 'confirm' ? 'payment' : 'default'
  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ maxWidth: '80%', background: 'rgba(218,41,28,0.12)', border: '1px solid rgba(218,41,28,0.20)', padding: '10px 14px', fontSize: 13, color: 'rgba(255,255,255,0.90)', lineHeight: 1.55 }}>
          {msg.text}
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20 }}>
      <Monogram mode={mono} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 6 }}>RCM</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', lineHeight: 1.65 }}>{msg.text}</div>

        {/* Cards */}
        {msg.card?.kind === 'vehicles' && (
          <div>
            {msg.card.vehicles.map(v => (
              <VehicleCard key={v.cls} v={v} onSelect={() => onChipClick(`${v.cls} → $${v.pricePerDay}/day`)} />
            ))}
          </div>
        )}
        {msg.card?.kind === 'quote' && <QuoteCard q={msg.card.quote} onConfirm={() => onChipClick('Confirm booking')} onChange={() => onChipClick('Change options')} />}
        {msg.card?.kind === 'confirm' && <ConfirmCard c={msg.card.confirm} />}
        {msg.card?.kind === 'reservation' && <ReservationCard r={msg.card.reservation} />}
        {msg.card?.kind === 'fuel' && <FuelCard f={msg.card.fuel} />}
        {msg.card?.kind === 'dispute' && <DisputeCard />}

        {/* Chips */}
        {msg.chips && msg.chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {msg.chips.map(chip => (
              <button
                key={chip}
                onClick={() => onChipClick(chip)}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.72)',
                  fontSize: 11, fontWeight: 500, letterSpacing: '0.02em',
                  padding: '0 12px', height: 30,
                  cursor: 'pointer', transition: 'all 0.12s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(218,41,28,0.10)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(218,41,28,0.35)'
                  ;(e.currentTarget as HTMLElement).style.color = '#fff'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.10)'
                  ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.72)'
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   FAKE SEARCH RESULTS (background content — shows site context)
───────────────────────────────────────────────────────────────────────────── */

function FakeSiteContent() {
  return (
    <div style={{ padding: '88px 40px 40px', maxWidth: 700 }}>
      {/* Search bar */}
      <div style={{ background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginBottom: 2 }}>PICKUP</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)' }}>Los Angeles (LAX)</div>
        </div>
        <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginBottom: 2 }}>DATES</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)' }}>Jul 4 – Jul 7</div>
        </div>
        <button style={{ height: 36, padding: '0 20px', background: '#da291c', border: 'none', color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', fontFamily: 'inherit' }}>MODIFY SEARCH</button>
      </div>

      {/* Results header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>AVAILABLE VEHICLES</div>
          <div style={{ fontSize: 20, fontWeight: 300, color: '#fff', marginTop: 2 }}>3 classes · Los Angeles</div>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Sort: Recommended</div>
      </div>

      {/* Placeholder vehicle rows */}
      {[
        { cls: 'Economy', price: '$36', sub: '$108 for 3 days', avail: '2 available', dim: false },
        { cls: 'Compact', price: '$44', sub: '$132 for 3 days', avail: '4 available', dim: true },
        { cls: 'Full-Size SUV', price: '$89', sub: '$267 for 3 days', avail: 'Only 1 left', dim: true },
      ].map(row => (
        <div key={row.cls} style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.06)', padding: '18px 20px', marginBottom: 10, opacity: row.dim ? 0.45 : 0.75, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 70, height: 32, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="48" height="20" viewBox="0 0 80 28" fill="none" style={{ opacity: 0.30 }}>
                <path d="M4 20h72M10 20c0-4 2-8 6-10h36c4 2 8 6 8 10M22 10l4-6h16l4 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="20" cy="22" r="4" stroke="white" strokeWidth="1.5"/>
                <circle cx="60" cy="22" r="4" stroke="white" strokeWidth="1.5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.70)', textTransform: 'uppercase' }}>{row.cls}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{row.avail}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 300, color: 'rgba(255,255,255,0.65)' }}>{row.price}<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginLeft: 3 }}>/day</span></div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)' }}>{row.sub}</div>
          </div>
        </div>
      ))}

      <div style={{ marginTop: 24, fontSize: 11, color: 'rgba(255,255,255,0.20)', lineHeight: 1.6 }}>
        All rates include unlimited miles within the continental US. Taxes and fees calculated at checkout.
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────────────── */

export default function AgentPreviewPage() {
  const [scenario, setScenario] = useState<ScenarioId>('booking')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinking, setThinking] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [inputVal, setInputVal] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const steps = SCENARIOS[scenario].steps

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  // Load first message on mount / scenario change
  useEffect(() => {
    const first = SCENARIOS[scenario].steps[0]
    const id = Math.random().toString(36).slice(2)
    setMessages([{ id, role: 'agent', text: first.text, card: first.card, chips: first.chips }])
    setStepIndex(1)
    setThinking(null)
    scrollToBottom()
  }, [scenario, scrollToBottom])

  const advance = useCallback((trigger: string) => {
    if (stepIndex >= steps.length) return

    const step = steps[stepIndex]
    // Only advance if the trigger matches or it's the right step
    const userMsgId = Math.random().toString(36).slice(2)

    // Add user message
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', text: trigger }])
    setStepIndex(i => i + 1)

    if (step.thinking) {
      setThinking(step.thinking)
      scrollToBottom()
      setTimeout(() => {
        setThinking(null)
        const agentId = Math.random().toString(36).slice(2)
        setMessages(prev => [...prev, { id: agentId, role: 'agent', text: step.text, card: step.card, chips: step.chips }])
        scrollToBottom()
      }, 1600)
    } else {
      const agentId = Math.random().toString(36).slice(2)
      setMessages(prev => [...prev, { id: agentId, role: 'agent', text: step.text, card: step.card, chips: step.chips }])
      scrollToBottom()
    }
  }, [stepIndex, steps, scrollToBottom])

  const handleChip = useCallback((chip: string) => {
    advance(chip)
  }, [advance])

  const handleSend = () => {
    if (!inputVal.trim()) return
    const val = inputVal.trim()
    setInputVal('')
    advance(val)
  }

  const canAdvance = stepIndex < steps.length && !thinking

  const ChatPanel = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#161616' }}>
      {/* Panel header */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Monogram />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '0.04em' }}>RCM</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>● Online · Avg reply &lt;5s</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setScenario(scenario); setMessages([]); setStepIndex(0); setTimeout(() => { const first = SCENARIOS[scenario].steps[0]; setMessages([{ id: Math.random().toString(36).slice(2), role: 'agent', text: first.text, card: first.card, chips: first.chips }]); setStepIndex(1) }, 10) }}
            title="Restart scenario"
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.40)', fontSize: 10, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.06em' }}
          >RESET</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}>
        {messages.map(msg => (
          <MessageRow key={msg.id} msg={msg} onChipClick={handleChip} />
        ))}
        {thinking && <ProgressMessage phrase={thinking} />}
        <div ref={bottomRef} />
      </div>

      {/* Step advance hint */}
      {canAdvance && !thinking && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(218,41,28,0.04)' }}>
          <div style={{ fontSize: 10, color: 'rgba(218,41,28,0.70)', letterSpacing: '0.06em', textAlign: 'center' }}>
            Click a quick reply chip above, or type a message below to continue the demo
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', background: '#161616', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Type a message…"
            style={{ flex: 1, height: 40, background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.10)', color: '#fff', fontSize: 13, padding: '0 14px', fontFamily: 'inherit', outline: 'none' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(218,41,28,0.35)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputVal.trim() || !!thinking}
            style={{
              width: 40, height: 40, flexShrink: 0,
              background: inputVal.trim() && !thinking ? '#da291c' : 'rgba(255,255,255,0.06)',
              border: 'none', cursor: inputVal.trim() && !thinking ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: inputVal.trim() && !thinking ? 1 : 0.3 }}>
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.20)', textAlign: 'center', marginTop: 8 }}>
          RCM Agent · Powered by Claude · End-to-end encrypted
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#181818', color: '#fff', fontFamily: 'Inter, -apple-system, sans-serif' }}>
      {/* ── Preview banner ── */}
      <div style={{ background: 'rgba(218,41,28,0.12)', borderBottom: '1px solid rgba(218,41,28,0.25)', padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 12, position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#da291c', animation: 'pulse 2s infinite' }} />
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#da291c', textTransform: 'uppercase' }}>AGENT UI PREVIEW</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginLeft: 4 }}>— Mock page, no API calls, read-only demo</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Link href="/" style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textDecoration: 'none', letterSpacing: '0.06em' }}>← Back to Site</Link>
        </div>
      </div>

      {/* ── Fake Navbar ── */}
      <header style={{ position: 'fixed', top: 32, left: 0, width: '100%', height: 56, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', background: '#181818', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff' }}>RCM</div>
        <nav style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {['Reserve', 'Experience', 'Locations', 'Concierge'].map(l => (
            <div key={l} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>{l}</div>
          ))}
          <div style={{ height: 28, borderLeft: '1px solid rgba(255,255,255,0.10)' }} />
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#fff', background: '#da291c', padding: '0 16px', height: 30, display: 'flex', alignItems: 'center' }}>CREATE ACCOUNT</div>
        </nav>
      </header>

      {/* ── Scenario tabs ── */}
      <div style={{ position: 'fixed', top: 88, left: 0, right: 0, zIndex: 150, background: '#181818', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 40px', display: 'flex', gap: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.30)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', marginRight: 24 }}>
          SCENARIO:
        </div>
        {(Object.entries(SCENARIOS) as [ScenarioId, typeof SCENARIOS[ScenarioId]][]).map(([id, s]) => (
          <button
            key={id}
            onClick={() => setScenario(id)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: scenario === id ? '2px solid #da291c' : '2px solid transparent',
              color: scenario === id ? '#fff' : 'rgba(255,255,255,0.45)',
              fontSize: 12, fontWeight: scenario === id ? 600 : 400,
              letterSpacing: '0.04em',
              padding: '12px 20px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {s.label}
            <span style={{ display: 'block', fontSize: 9, color: 'rgba(255,255,255,0.30)', fontWeight: 400, marginTop: 2, letterSpacing: '0.03em' }}>{s.sub}</span>
          </button>
        ))}

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(v => !v)}
          style={{ marginLeft: 'auto', background: mobileOpen ? '#da291c' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '0 14px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'center', height: 30 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          {mobileOpen ? 'HIDE CHAT' : 'SHOW CHAT'}
        </button>
      </div>

      {/* ── Main layout ── */}
      <div style={{ paddingTop: 140, display: 'flex', height: '100vh', overflow: 'hidden' }}>

        {/* LEFT — site content */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          <FakeSiteContent />

          {/* Mobile: floating "Ask RCM" bar at bottom */}
          <div className="md:hidden" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#181818', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 20px' }}>
            <button
              onClick={() => setMobileOpen(true)}
              style={{ width: '100%', height: 44, background: 'rgba(218,41,28,0.12)', border: '1px solid rgba(218,41,28,0.30)', color: '#da291c', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              ASK RCM
            </button>
          </div>
        </div>

        {/* RIGHT — desktop chat panel (always visible on md+) */}
        <div
          className="hidden md:flex"
          style={{ width: 400, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.06)', flexDirection: 'column', height: '100%' }}
        >
          <ChatPanel />
        </div>

        {/* Mobile slide-up sheet */}
        {mobileOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', flexDirection: 'column' }}>
            {/* Backdrop */}
            <div
              onClick={() => setMobileOpen(false)}
              style={{ flex: 1, background: 'rgba(0,0,0,0.65)' }}
            />
            {/* Sheet */}
            <div style={{ height: '82vh', background: '#161616', borderTop: '1px solid rgba(255,255,255,0.10)', display: 'flex', flexDirection: 'column' }}>
              {/* Drag handle */}
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
                <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <ChatPanel />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Legend / annotations panel ── */}
      <div style={{ position: 'fixed', bottom: 20, left: 20, zIndex: 300, background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', padding: '14px 18px', maxWidth: 260, display: 'none' }} className="lg:block">
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', marginBottom: 10 }}>UI ANNOTATIONS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[
            { dot: '#da291c', label: 'Agent monogram — R in red gradient' },
            { dot: '#da291c', label: 'Progress bar — sweeps on API call' },
            { dot: 'rgba(255,255,255,0.12)', label: 'Quick reply chips — disappear on select' },
            { dot: '#22c55e', label: 'Confirmation card — green top border' },
            { dot: '#fbbf24', label: 'Damage/fuel card — amber top border' },
            { dot: '#8b5cf6', label: 'Dispute card — violet top border' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.dot, flexShrink: 0 }} />
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.50)', lineHeight: 1.4 }}>{r.label}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
      `}</style>
    </div>
  )
}
