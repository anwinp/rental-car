'use client'

/**
 * The platform front door — what rcm.ceez.ai serves.
 *
 * This host is deliberately not a workspace ("rcm" is a reserved slug), and
 * nothing had ever been built for it, so the entry point for every prospective
 * customer rendered "No such workspace — check the link you were given." The
 * only route to signing up was rcm-admin.ceez.ai/signup, which nothing linked
 * to and nobody could guess.
 *
 * Every claim below is deliberately restricted to behaviour verified against
 * the running system. There is no pricing here: PRODUCT_PLAN.md records that no
 * price columns exist anywhere in the product and that the tier points are
 * unvalidated assumptions, so publishing a number would be inventing a
 * commercial promise. Nothing here claims online payment capture or booking
 * import either — both are still unbuilt.
 */

import { useEffect, useState } from 'react'

const ADMIN_ORIGIN = (() => {
  if (typeof window === 'undefined') return ''
  const { protocol, host } = window.location
  const [name, port] = host.split(':')
  const parts = name.split('.').filter(Boolean)
  // rcm.ceez.ai -> rcm-admin.ceez.ai. In development the booking app runs on
  // its own port, so fall back to the conventional admin port instead.
  if (parts.length >= 3) {
    return `${protocol}//${parts[0]}-admin.${parts.slice(1).join('.')}${port ? `:${port}` : ''}`
  }
  return `${protocol}//${name}:3002`
})()

const INK = '#e8e6e3'
const INK_2 = '#9a9691'
const INK_3 = '#6b6762'
const GROUND = '#131211'
const CARD = '#1b1a18'
const RULE = '#2a2825'
const ACCENT = '#c8763c'

const SURFACES = [
  {
    tag: 'For your customers',
    name: 'Booking site',
    host: 'yourcompany-rcm.ceez.ai',
    body:
      'A storefront on its own address. Customers search your real availability, ' +
      'pick a class and book without calling the counter.',
  },
  {
    tag: 'For you and your managers',
    name: 'Back office',
    host: 'yourcompany-rcm-admin.ceez.ai',
    body:
      'Fleet, rates, customers, damage claims, payments and reporting. Where the ' +
      'business is actually run.',
  },
  {
    tag: 'For the desk',
    name: 'Counter',
    host: 'yourcompany-rcm-counter.ceez.ai',
    body:
      'Check-out and check-in, condition photos, fuel and odometer, signature ' +
      'capture. Built for one screen and a queue.',
  },
]

const JOBS = [
  {
    title: 'Never promise a car you do not have',
    body:
      'Availability is computed against real vehicles, holds and blocks — not a ' +
      'spreadsheet someone forgot to update.',
  },
  {
    title: 'Take the deposit, not just the booking',
    body:
      'Deposit authorisation and release are part of the rental, with the amounts ' +
      'recorded against the agreement.',
  },
  {
    title: 'Prove what the car looked like',
    body:
      'Condition capture at check-out and check-in, with photos held against the ' +
      'vehicle and the claim — the evidence you need when a customer disputes damage.',
  },
  {
    title: 'Make the paperwork real',
    body:
      'The signed rental agreement is rendered as a PDF once, at handover, and ' +
      'stored — so what you produce later is the document they actually signed.',
  },
  {
    title: 'Know what is out, back and late',
    body:
      'The day view every counter opens first: departures, returns, and the ' +
      'overdue list.',
  },
]

function Rule() {
  return <div style={{ height: 1, background: RULE }} />
}

export default function PlatformLanding() {
  const [year, setYear] = useState('')
  useEffect(() => setYear(String(new Date().getFullYear())), [])

  const signup = `${ADMIN_ORIGIN}/signup`
  const signin = `${ADMIN_ORIGIN}/login`

  return (
    <div style={{ minHeight: '100vh', background: GROUND, color: INK }}>
      <style>{`
        .rcm-cta { transition: background .15s ease, transform .15s ease; }
        .rcm-cta:hover { background: #d9884a; }
        .rcm-link:hover { color: ${INK} !important; }
        .rcm-surface { transition: border-color .15s ease; }
        .rcm-surface:hover { border-color: ${ACCENT}55 !important; }
        @media (max-width: 820px) {
          .rcm-grid { grid-template-columns: 1fr !important; }
          .rcm-hero-h1 { font-size: 40px !important; }
        }
      `}</style>

      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header
        style={{
          borderBottom: `1px solid ${RULE}`,
          position: 'sticky',
          top: 0,
          background: `${GROUND}f2`,
          backdropFilter: 'blur(8px)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 5,
                background: ACCENT,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                fontSize: 13,
                color: GROUND,
              }}
            >
              R
            </div>
            <span style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
              Rental Car Manager
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <a
              href={signin}
              className="rcm-link"
              style={{ color: INK_2, fontSize: 14, textDecoration: 'none' }}
            >
              Sign in
            </a>
            <a
              href={signup}
              className="rcm-cta"
              style={{
                background: ACCENT,
                color: GROUND,
                fontWeight: 600,
                fontSize: 14,
                padding: '9px 16px',
                borderRadius: 6,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Create your workspace
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '96px 24px 72px' }}>
        <p
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: ACCENT,
            margin: '0 0 20px',
          }}
        >
          For independent rental operators
        </p>
        <h1
          className="rcm-hero-h1"
          style={{
            fontSize: 58,
            lineHeight: 1.04,
            letterSpacing: '-0.035em',
            fontWeight: 700,
            margin: 0,
            maxWidth: '17ch',
            textWrap: 'balance',
          }}
        >
          Run the whole rental, not just the booking.
        </h1>
        <p
          style={{
            marginTop: 24,
            fontSize: 19,
            lineHeight: 1.6,
            color: INK_2,
            maxWidth: '58ch',
          }}
        >
          Fleet, availability, pricing, the counter, damage and the paperwork — in
          one place, for operators running ten to fifty cars. Sign up and you get
          three working addresses of your own, in minutes.
        </p>

        <div
          style={{
            marginTop: 36,
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <a
            href={signup}
            className="rcm-cta"
            style={{
              background: ACCENT,
              color: GROUND,
              fontWeight: 600,
              fontSize: 15,
              padding: '13px 24px',
              borderRadius: 7,
              textDecoration: 'none',
            }}
          >
            Create your workspace
          </a>
          <a
            href={signin}
            className="rcm-link"
            style={{
              color: INK_2,
              fontSize: 15,
              textDecoration: 'none',
              padding: '13px 4px',
            }}
          >
            Already have one? Sign in →
          </a>
        </div>
      </section>

      <Rule />

      {/* ── The three surfaces ───────────────────────────────────────────── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '72px 24px' }}>
        <h2
          style={{
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: INK_3,
            margin: '0 0 8px',
          }}
        >
          What you get
        </h2>
        <p style={{ margin: '0 0 32px', color: INK_2, fontSize: 15, maxWidth: '62ch' }}>
          Three separate applications, each on its own address, all reading the same
          fleet. Your staff never work in your customers&rsquo; screens.
        </p>

        <div
          className="rcm-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}
        >
          {SURFACES.map((s) => (
            <div
              key={s.name}
              className="rcm-surface"
              style={{
                background: CARD,
                border: `1px solid ${RULE}`,
                borderRadius: 10,
                padding: '22px 20px',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  letterSpacing: '0.09em',
                  textTransform: 'uppercase',
                  color: ACCENT,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {s.tag}
              </p>
              <h3
                style={{
                  margin: '10px 0 0',
                  fontSize: 19,
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                }}
              >
                {s.name}
              </h3>
              <p
                style={{
                  margin: '6px 0 14px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  color: INK_3,
                  wordBreak: 'break-all',
                }}
              >
                {s.host}
              </p>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.62, color: INK_2 }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Rule />

      {/* ── The jobs ─────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '72px 24px' }}>
        <h2
          style={{
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: INK_3,
            margin: '0 0 32px',
          }}
        >
          What it does
        </h2>
        <div
          className="rcm-grid"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px 48px' }}
        >
          {JOBS.map((j) => (
            <div key={j.title}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16.5,
                  fontWeight: 600,
                  letterSpacing: '-0.012em',
                  textWrap: 'balance',
                }}
              >
                {j.title}
              </h3>
              <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.65, color: INK_2 }}>
                {j.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Rule />

      {/* ── Your data ────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '72px 24px' }}>
        <div
          style={{
            background: CARD,
            border: `1px solid ${RULE}`,
            borderLeft: `3px solid ${ACCENT}`,
            borderRadius: 10,
            padding: '28px 28px',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Your data stays yours
          </h2>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 15,
              lineHeight: 1.65,
              color: INK_2,
              maxWidth: '68ch',
            }}
          >
            Every workspace is isolated at the database level, not by a filter someone
            can forget — one company can never read another&rsquo;s bookings, customers
            or fleet. You can export everything you hold at any time, as a zip of CSVs,
            with your upcoming bookings written in the layout our own importer accepts.
            That export works while an account is past due. Holding a business&rsquo;s
            operating records over an invoice is not a lever we think anyone should have.
          </p>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '24px 24px 96px',
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            margin: '0 0 10px',
            textWrap: 'balance',
          }}
        >
          Start with your own workspace
        </h2>
        <p style={{ margin: '0 auto 26px', color: INK_2, fontSize: 15.5, maxWidth: '48ch' }}>
          Pick an address, add your first branch and your cars, and take a booking the
          same day.
        </p>
        <a
          href={signup}
          className="rcm-cta"
          style={{
            background: ACCENT,
            color: GROUND,
            fontWeight: 600,
            fontSize: 15,
            padding: '13px 26px',
            borderRadius: 7,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Create your workspace
        </a>
      </section>

      <Rule />
      <footer
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '24px 24px 40px',
          color: INK_3,
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <span>© {year} Rental Car Manager</span>
        <a href={signin} className="rcm-link" style={{ color: INK_3, textDecoration: 'none' }}>
          Sign in
        </a>
      </footer>
    </div>
  )
}
