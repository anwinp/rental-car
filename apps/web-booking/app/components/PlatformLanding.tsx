'use client'

/**
 * The platform front door — what rcm.ceez.ai serves.
 *
 * This host is deliberately not a workspace ("rcm" is a reserved slug), and
 * nothing had ever been built for it, so the entry point for every prospective
 * customer rendered "No such workspace — check the link you were given."
 *
 * Built to the cinematic-editorial system in app/lib/designTokens.ts: near-black
 * canvas, Rosso Corsa held scarce, Inter 500 for display (the documented
 * substitute for the licensed FerrariSans), sharp 0px corners on every CTA and
 * card, and the explicit 8px spacing ladder.
 *
 * ON THE HERO —
 * The system's strongest signature is a full-bleed cinematic photograph, and
 * there is no licensed fleet photography to use here. Rather than ship a stock
 * image that would misrepresent a real operator's fleet, the hero is built as a
 * cinematic plate in CSS: a low horizon gradient, a vignette, and fine grain,
 * at the same full-bleed proportions a photograph would occupy. Drop a real
 * image into HERO_IMAGE below and it takes over with no other change.
 *
 * ON THE COPY —
 * Every claim is restricted to behaviour verified against the running system.
 *
 * Pricing is now real and is READ, never written here. Plans, prices, caps and
 * included capabilities come from /api/v1/public/plans, which serves the same
 * catalogue the product enforces — so a price on this page cannot disagree with
 * what a customer is actually charged, and a plan added in the console appears
 * here without a deploy. Until migration 074 there were no price columns at
 * all, which is why this section did not exist; hardcoding numbers now would
 * reintroduce exactly the drift that made GROWTH unassignable.
 *
 * The section renders nothing when the catalogue is empty or unreachable. An
 * empty pricing table is worse than no pricing table.
 */

import { useEffect, useState } from 'react'
import { Logo, LogoMark } from './Logo'
import { MAX_WIDTH, color, rounded, space, type as t } from '../lib/designTokens'

/**
 * Full-bleed hero photograph. The system's strongest signature is cinematic
 * imagery carrying the page chrome, and this asset already shipped as the
 * booking site's hero, so it is the product's own art rather than something
 * new brought in.
 *
 * Swap the path to change it; the CSS cinema plate below stays as the fallback
 * if this is ever set back to null.
 */
const HERO_IMAGE: string | null = '/assets/hero_cinema.png'

const ORIGINS = (() => {
  if (typeof window === 'undefined') return { admin: '', signup: '', signin: '' }
  const { protocol, host } = window.location
  const [name, port] = host.split(':')
  const parts = name.split('.').filter(Boolean)
  const admin =
    parts.length >= 3
      ? `${protocol}//${parts[0]}-admin.${parts.slice(1).join('.')}${port ? `:${port}` : ''}`
      : `${protocol}//${name}:3002`
  return { admin, signup: `${admin}/signup`, signin: `${admin}/login` }
})()

const NAV = [
  { label: 'The platform', href: '#platform' },
  { label: 'What it does', href: '#capability' },
  // Sits before "Your data" because it is the question people arrive with.
  { label: 'Pricing', href: '#pricing' },
  { label: 'Your data', href: '#data' },
]

const SURFACES = [
  {
    index: '01',
    tag: 'For your customers',
    name: 'Booking site',
    host: 'yourcompany-rcm.ceez.ai',
    body:
      'A storefront on its own address. Customers search real availability, pick a ' +
      'class and book without calling the counter.',
  },
  {
    index: '02',
    tag: 'For you and your managers',
    name: 'Back office',
    host: 'yourcompany-rcm-admin.ceez.ai',
    body:
      'Fleet, rates, customers, damage claims, payments and reporting. Where the ' +
      'business is actually run.',
  },
  {
    index: '03',
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
      'Condition capture at check-out and check-in, photos held against the vehicle ' +
      'and the claim — the evidence you need when a customer disputes damage.',
  },
  {
    title: 'Make the paperwork real',
    body:
      'The signed rental agreement is rendered once, at handover, and stored — so ' +
      'what you produce later is the document they actually signed.',
  },
  {
    title: 'Know what is out, back and late',
    body:
      'The day view every counter opens first: departures due, returns expected, ' +
      'and the overdue list.',
  },
  {
    title: 'Price it your way',
    body:
      'Your own rate codes, seasonal bands and extras, with tax applied per branch ' +
      'from the jurisdictions that actually govern it.',
  },
]

const SPECS = [
  { value: '3', label: 'Applications per workspace' },
  { value: '12', label: 'Vehicle classes ready to quote' },
  { value: '0', label: 'Records shared between operators' },
]

// ── Primitives ──────────────────────────────────────────────────────────────

function Shell({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        maxWidth: MAX_WIDTH,
        margin: '0 auto',
        padding: `0 ${space.sm}px`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function SectionLabel({ children, onLight }: { children: React.ReactNode; onLight?: boolean }) {
  return (
    <p
      style={{
        ...t.captionUpper,
        color: onLight ? color.muted : color.body,
        margin: `0 0 ${space.sm}px`,
      }}
    >
      {children}
    </p>
  )
}

function ButtonPrimary({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rcm-btn-primary"
      style={{
        ...t.button,
        background: color.primary,
        color: color.onPrimary,
        borderRadius: rounded.none,
        height: 48,
        padding: `0 ${space.md}px`,
        display: 'inline-flex',
        alignItems: 'center',
        textDecoration: 'none',
        border: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </a>
  )
}

function ButtonOutline({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rcm-btn-outline"
      style={{
        ...t.button,
        background: 'transparent',
        color: color.ink,
        border: `1px solid ${color.ink}`,
        borderRadius: rounded.none,
        height: 48,
        padding: `0 ${space.md}px`,
        display: 'inline-flex',
        alignItems: 'center',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </a>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

interface PublicPlan {
  code: string
  name: string
  description: string | null
  price_cents: number | null
  currency: string | null
  billing_period: string
  is_default: boolean
  limits: { staff: number | null; vehicles: number | null; locations: number | null }
  features: string[]
}

function formatPrice(plan: PublicPlan): string {
  return ((plan.price_cents ?? 0) / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: plan.currency || 'USD',
    maximumFractionDigits: 0,
  })
}

function defaultPlanName(plans: PublicPlan[]): string {
  return plans.find((p) => p.is_default)?.name ?? 'the starter plan'
}

export default function PlatformLanding() {
  // Read from the same catalogue the product enforces. A failure leaves the
  // list empty and the section unrendered, rather than showing a price that
  // might be stale or wrong.
  const [plans, setPlans] = useState<PublicPlan[]>([])
  useEffect(() => {
    fetch('/api/v1/public/plans')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PublicPlan[]) => setPlans(Array.isArray(rows) ? rows : []))
      .catch(() => setPlans([]))
  }, [])

  const [year, setYear] = useState('')
  useEffect(() => setYear(String(new Date().getFullYear())), [])

  return (
    <div style={{ background: color.canvas, color: color.ink, minHeight: '100vh' }}>
      <style>{`
        .rcm-btn-primary:active { background: ${color.primaryActive} !important; }
        .rcm-btn-outline:active { background: rgba(255,255,255,0.08); }
        .rcm-nav-link:hover, .rcm-foot-link:hover { color: ${color.ink} !important; }
        .rcm-card:hover { border-color: ${color.body} !important; }
        a:focus-visible, button:focus-visible {
          outline: 2px solid ${color.primary}; outline-offset: 3px;
        }
        /* Cinema plate — a stand-in for full-bleed photography, at the same
           proportions. Replaced wholesale when HERO_IMAGE is set. */
        .rcm-cinema {
          position: absolute; inset: 0;
          background:
            radial-gradient(120% 80% at 50% 8%, rgba(218,41,28,0.10) 0%, transparent 55%),
            radial-gradient(90% 60% at 78% 0%, rgba(255,255,255,0.07) 0%, transparent 60%),
            linear-gradient(180deg, #3c3c3c 0%, #1f1e1d 46%, ${color.canvas} 100%);
        }
        .rcm-cinema::after {
          content: ''; position: absolute; inset: 0;
          background:
            radial-gradient(78% 62% at 50% 42%, transparent 40%, rgba(0,0,0,0.62) 100%),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.016) 0 1px, transparent 1px 3px);
        }
        .rcm-nav-links { display: flex; gap: ${space.md}px; }
        .rcm-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; }
        .rcm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: ${space.lg}px ${space.xl}px; }
        .rcm-specs { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${space.lg}px; }
        /* auto-fit, so the row reflows as plans are added or archived in
           the console rather than needing a column count changed here. */
        .rcm-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                     gap: ${space.xs}px; align-items: stretch; }
        .rcm-hero-h1 { font-size: ${t.displayMega.fontSize}px; }
        .rcm-foot-cols { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: ${space.lg}px; }

        @media (max-width: 1024px) {
          .rcm-hero-h1 { font-size: ${t.displayXl.fontSize}px; letter-spacing: ${t.displayXl.letterSpacing}; }
          .rcm-grid-3 { grid-template-columns: 1fr 1fr; }
          .rcm-foot-cols { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 768px) {
          .rcm-nav-links { display: none; }
          /* Art direction: the crop tightens on the subject rather than
             letting a portrait viewport fill with sky and road. */
          .rcm-hero-img { object-position: 58% 58% !important; }
          .rcm-hero-h1 { font-size: 32px; letter-spacing: -0.6px; }
          .rcm-grid-3, .rcm-grid-2, .rcm-specs, .rcm-plans { grid-template-columns: 1fr; }
          .rcm-grid-2 { gap: ${space.md}px; }
        }
      `}</style>

      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <header
        style={{
          height: 64,
          borderBottom: `1px solid ${color.hairline}`,
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: color.canvas,
        }}
      >
        <Shell
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.md,
          }}
        >
          <a href="/" style={{ color: color.ink, textDecoration: 'none' }}>
            <Logo size={24} />
          </a>

          <nav className="rcm-nav-links" aria-label="Primary">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rcm-nav-link"
                style={{ ...t.navLink, color: color.body, textDecoration: 'none' }}
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <a
              href={ORIGINS.signin}
              className="rcm-nav-link"
              style={{ ...t.navLink, color: color.body, textDecoration: 'none' }}
            >
              Sign in
            </a>
            <ButtonPrimary href={ORIGINS.signup}>Create workspace</ButtonPrimary>
          </div>
        </Shell>
      </header>

      {/* ── Hero: full-bleed cinema band ────────────────────────────────── */}
      <section
        style={{
          position: 'relative',
          minHeight: 640,
          height: '86vh',
          maxHeight: 980,
          display: 'flex',
          alignItems: 'flex-end',
          overflow: 'hidden',
        }}
      >
        {HERO_IMAGE ? (
          <>
            <img
              src={HERO_IMAGE}
              alt=""
              aria-hidden="true"
              className="rcm-hero-img"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                // The subject sits low in the frame; bias the crop downward so a
                // wide viewport keeps the car rather than empty sky.
                objectPosition: 'center 62%',
              }}
            />
            {/* Scrim. Light at the top so the sticky nav stays readable against
                a bright sky, heavy at the bottom where the display type sits —
                the headline floats over the photograph rather than beneath it. */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  // Horizontal first: the copy is left-aligned and the subject
                  // sits centre-right, so darkening the left column keeps the
                  // type legible without flattening the photograph. Body copy
                  // over the bright red panel was close to unreadable without it.
                  `linear-gradient(90deg, rgba(24,24,24,0.92) 0%, rgba(24,24,24,0.72) 34%, ` +
                  `rgba(24,24,24,0.18) 62%, transparent 82%), ` +
                  // Vertical: a touch at the top so the sticky nav holds against
                  // sky, and a deep foot that hands off to the canvas.
                  `linear-gradient(180deg, rgba(24,24,24,0.55) 0%, rgba(24,24,24,0.05) 22%, ` +
                  `rgba(24,24,24,0.45) 62%, rgba(24,24,24,0.9) 88%, ${color.canvas} 100%)`,
              }}
            />
          </>
        ) : (
          <div className="rcm-cinema" aria-hidden />
        )}

        <Shell style={{ position: 'relative', paddingTop: space.super, paddingBottom: space.xxl }}>
          <p style={{ ...t.captionUpper, color: color.ink, opacity: 0.72, margin: `0 0 ${space.sm}px` }}>
            For independent rental operators
          </p>
          <h1
            className="rcm-hero-h1"
            style={{
              fontWeight: t.displayMega.fontWeight,
              lineHeight: t.displayMega.lineHeight,
              letterSpacing: t.displayMega.letterSpacing,
              margin: 0,
              maxWidth: '15ch',
              textWrap: 'balance',
            }}
          >
            Run the whole rental.
          </h1>
          <p
            style={{
              ...t.bodyMd,
              fontSize: 17,
              // Ink on the hero is set narrower than elsewhere so it stays
              // inside the scrimmed left column rather than running across the
              // subject, where it was fighting a bright red panel for contrast.
              color: color.ink,
              opacity: 0.86,
              maxWidth: '42ch',
              margin: `${space.sm}px 0 0`,
            }}
          >
            Fleet, availability, pricing, the counter, damage and the paperwork — in one
            place, for operators running ten to fifty cars. Sign up and three working
            addresses are yours in minutes.
          </p>
          <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginTop: space.lg }}>
            <ButtonPrimary href={ORIGINS.signup}>Create your workspace</ButtonPrimary>
            <ButtonOutline href="#platform">See what you get</ButtonOutline>
          </div>
        </Shell>
      </section>

      {/* ── The three surfaces ──────────────────────────────────────────── */}
      <section id="platform" style={{ padding: `${space.xxl}px 0` }}>
        <Shell>
          <SectionLabel>What you get</SectionLabel>
          <h2
            style={{
              ...t.displayLg,
              margin: `0 0 ${space.xs}px`,
              maxWidth: '20ch',
              textWrap: 'balance',
            }}
          >
            Three applications, one fleet.
          </h2>
          <p style={{ ...t.bodyMd, color: color.body, maxWidth: '62ch', margin: `0 0 ${space.lg}px` }}>
            Each on its own address, all reading the same data. Your staff never work in
            your customers&rsquo; screens, and your customers never see yours.
          </p>
        </Shell>

        <Shell>
          <div className="rcm-grid-3" style={{ background: color.hairline }}>
            {SURFACES.map((s) => (
              <article
                key={s.name}
                className="rcm-card"
                style={{
                  background: color.canvas,
                  border: `1px solid ${color.hairline}`,
                  borderRadius: rounded.none,
                  padding: space.md,
                  transition: 'border-color .15s ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: space.xs,
                  }}
                >
                  {/* Deliberately not the accent. The system reserves Rosso Corsa
                      for primary CTAs, the mark and highlight cells; a fourth
                      use across three repeating card labels would spend the
                      scarcity the palette depends on. */}
                  <p style={{ ...t.captionUpper, color: color.body, margin: 0 }}>{s.tag}</p>
                  <span style={{ ...t.captionUpper, color: color.muted, margin: 0 }}>{s.index}</span>
                </div>
                <h3 style={{ ...t.displayMd, margin: `${space.sm}px 0 ${space.xxs}px` }}>{s.name}</h3>
                <p
                  style={{
                    ...t.caption,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: color.muted,
                    margin: `0 0 ${space.xs}px`,
                    wordBreak: 'break-all',
                  }}
                >
                  {s.host}
                </p>
                <p style={{ ...t.bodyMd, color: color.body, margin: 0 }}>{s.body}</p>
              </article>
            ))}
          </div>
        </Shell>
      </section>

      {/* ── Livery band: the one full-width accent ──────────────────────── */}
      <section style={{ background: color.primary, padding: `${space.xxl}px 0` }}>
        <Shell>
          <p style={{ ...t.captionUpper, color: color.onPrimary, opacity: 0.75, margin: `0 0 ${space.sm}px` }}>
            Isolation by construction
          </p>
          <p
            style={{
              ...t.displayLg,
              color: color.onPrimary,
              margin: 0,
              maxWidth: '26ch',
              textWrap: 'balance',
            }}
          >
            One operator can never read another&rsquo;s bookings, customers or fleet.
          </p>
        </Shell>
      </section>

      {/* ── Capability ──────────────────────────────────────────────────── */}
      <section id="capability" style={{ padding: `${space.xxl}px 0` }}>
        <Shell>
          <SectionLabel>What it does</SectionLabel>
          <div className="rcm-grid-2" style={{ marginTop: space.lg }}>
            {JOBS.map((j) => (
              <div key={j.title}>
                <h3
                  style={{
                    ...t.titleSm,
                    fontSize: 17,
                    margin: 0,
                    paddingBottom: space.xxs,
                    borderBottom: `1px solid ${color.hairline}`,
                    textWrap: 'balance',
                  }}
                >
                  {j.title}
                </h3>
                <p style={{ ...t.bodyMd, color: color.body, margin: `${space.xs}px 0 0` }}>{j.body}</p>
              </div>
            ))}
          </div>
        </Shell>
      </section>

      {/* ── Spec band ───────────────────────────────────────────────────── */}
      <section style={{ borderTop: `1px solid ${color.hairline}`, padding: `${space.xl}px 0` }}>
        <Shell>
          <div className="rcm-specs">
            {SPECS.map((s) => (
              <div key={s.label}>
                <p style={{ ...t.numberDisplay, fontSize: 64, color: color.ink, margin: 0 }}>
                  {s.value}
                </p>
                <p style={{ ...t.captionUpper, color: color.muted, margin: `${space.xxs}px 0 0` }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </Shell>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      {plans.length > 0 && (
        <section id="pricing" style={{ borderTop: `1px solid ${color.hairline}`, padding: `${space.xxl}px 0` }}>
          <Shell>
            <SectionLabel>Pricing</SectionLabel>
            <h2 style={{ ...t.displayLg, color: color.ink, margin: `0 0 ${space.sm}px`, maxWidth: '20ch', textWrap: 'balance' }}>
              Priced by the size of your fleet, not by the seat.
            </h2>
            <p style={{ ...t.bodyMd, color: color.body, maxWidth: '62ch', margin: `0 0 ${space.lg}px` }}>
              Every plan includes the whole rental system — reservations, the counter,
              agreements, damage, pricing and your own booking site. What changes is how
              much of it you can hold, and which integrations are switched on.
            </p>

            {/* Monthly and annual are separate rows in the catalogue rather than
                a toggle, because that is how they are actually sold and billed.
                A toggle would imply a relationship the pricing does not have. */}
            <div className="rcm-plans">
              {plans.map((plan) => {
                const custom = plan.price_cents === null
                const free = plan.price_cents === 0
                return (
                  <div
                    key={plan.code}
                    style={{
                      border: `1px solid ${plan.is_default ? color.primary : color.hairline}`,
                      borderRadius: rounded.none,
                      padding: space.sm,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: space.xs,
                    }}
                  >
                    <div>
                      <p style={{ ...t.captionUpper, color: plan.is_default ? color.primary : color.muted, margin: 0 }}>
                        {plan.name}
                      </p>
                      <p style={{ ...t.numberDisplay, fontSize: 40, color: color.ink, margin: `${space.xxs}px 0 0` }}>
                        {custom ? 'Talk to us' : free ? 'Free' : formatPrice(plan)}
                      </p>
                      {!custom && !free && (
                        <p style={{ ...t.bodyMd, fontSize: 13, color: color.muted, margin: `${space.xxxs}px 0 0` }}>
                          per {plan.billing_period === 'YEARLY' ? 'year' : 'month'}
                        </p>
                      )}
                    </div>

                    {plan.description && (
                      <p style={{ ...t.bodyMd, fontSize: 14, color: color.body, margin: 0 }}>
                        {plan.description}
                      </p>
                    )}

                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: space.xxxs }}>
                      {[
                        ['staff', 'team members'],
                        ['vehicles', 'vehicles'],
                        ['locations', 'branches'],
                      ].map(([key, noun]) => {
                        const v = plan.limits[key as keyof PublicPlan['limits']]
                        return (
                          <li key={key} style={{ ...t.bodyMd, fontSize: 14, color: color.body }}>
                            {v === null ? 'Unlimited' : v} {noun}
                          </li>
                        )
                      })}
                      {plan.features.map((f) => (
                        <li key={f} style={{ ...t.bodyMd, fontSize: 14, color: color.ink }}>
                          {f}
                        </li>
                      ))}
                    </ul>

                    <div style={{ marginTop: 'auto', paddingTop: space.xs }}>
                      {custom ? (
                        <ButtonOutline href="mailto:hello@ceez.ai">Contact us</ButtonOutline>
                      ) : (
                        <ButtonOutline href={`${ORIGINS.signup}?plan=${plan.code}`}>
                          Start free
                        </ButtonOutline>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <p style={{ ...t.bodyMd, fontSize: 13, color: color.muted, margin: `${space.md}px 0 0`, maxWidth: '62ch' }}>
              Every workspace starts on {defaultPlanName(plans)}. Change plan whenever you
              like from inside your own back office — going over a limit never disables
              anything you already have, it only stops you adding more.
            </p>
          </Shell>
        </section>
      )}

      {/* ── Light editorial band: data rights ───────────────────────────── */}
      <section
        id="data"
        style={{ background: color.canvasLight, color: color.bodyOnLight, padding: `${space.xxl}px 0` }}
      >
        <Shell>
          <SectionLabel onLight>Your data</SectionLabel>
          <h2 style={{ ...t.displayLg, margin: `0 0 ${space.sm}px`, maxWidth: '22ch', textWrap: 'balance' }}>
            Leave whenever you want, with everything.
          </h2>
          <p style={{ ...t.bodyMd, fontSize: 15, color: color.bodyOnLight, maxWidth: '68ch', margin: 0 }}>
            Export everything your workspace holds at any time — fleet, customers, bookings,
            agreements, payments and pricing — as a zip of CSV files, with your upcoming
            bookings written in the layout our own importer accepts, so they load straight
            into another system.
          </p>
          <p
            style={{
              ...t.bodyMd,
              fontSize: 15,
              color: color.muted,
              maxWidth: '68ch',
              margin: `${space.xs}px 0 0`,
              paddingTop: space.xs,
              borderTop: `1px solid ${color.hairlineOnLight}`,
            }}
          >
            That export keeps working while an account is past due. Holding a business&rsquo;s
            operating records over an invoice is not a lever we think anyone should have.
          </p>
        </Shell>
      </section>

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <section style={{ padding: `${space.xxl}px 0`, textAlign: 'center' }}>
        <Shell>
          {/* The mark is display:block so it never picks up inline baseline
              spacing in the nav; centring it therefore needs a flex wrapper
              rather than the section's text-align. */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <LogoMark size={34} />
          </div>
          <h2
            style={{
              ...t.displayLg,
              margin: `${space.sm}px auto ${space.xs}px`,
              maxWidth: '20ch',
              textWrap: 'balance',
            }}
          >
            Start with your own workspace.
          </h2>
          <p style={{ ...t.bodyMd, color: color.body, maxWidth: '46ch', margin: `0 auto ${space.lg}px` }}>
            Pick an address, add your branch and your cars, and take a booking the same day.
          </p>
          <ButtonPrimary href={ORIGINS.signup}>Create your workspace</ButtonPrimary>
        </Shell>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: `1px solid ${color.hairline}`, padding: `${space.xl}px 0 ${space.lg}px` }}>
        <Shell>
          <div className="rcm-foot-cols">
            <div>
              <Logo size={26} lockup="full" />
              <p style={{ ...t.bodySm, color: color.muted, margin: `${space.xs}px 0 0`, maxWidth: '34ch' }}>
                Rental management for independent operators.
              </p>
            </div>

            <div>
              <p style={{ ...t.captionUpper, color: color.ink, margin: `0 0 ${space.xs}px` }}>Platform</p>
              {NAV.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  className="rcm-foot-link"
                  style={{ ...t.bodySm, color: color.body, textDecoration: 'none', display: 'block', padding: '5px 0' }}
                >
                  {n.label}
                </a>
              ))}
            </div>

            <div>
              <p style={{ ...t.captionUpper, color: color.ink, margin: `0 0 ${space.xs}px` }}>Workspace</p>
              {[
                { label: 'Create workspace', href: ORIGINS.signup },
                { label: 'Sign in', href: ORIGINS.signin },
              ].map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  className="rcm-foot-link"
                  style={{ ...t.bodySm, color: color.body, textDecoration: 'none', display: 'block', padding: '5px 0' }}
                >
                  {l.label}
                </a>
              ))}
            </div>

            <div>
              <p style={{ ...t.captionUpper, color: color.ink, margin: `0 0 ${space.xs}px` }}>Legal</p>
              {[
                { label: 'Terms', href: '/policies' },
                { label: 'Privacy', href: '/policies' },
              ].map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  className="rcm-foot-link"
                  style={{ ...t.bodySm, color: color.body, textDecoration: 'none', display: 'block', padding: '5px 0' }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>

          <p
            style={{
              ...t.bodySm,
              color: color.muted,
              margin: `${space.lg}px 0 0`,
              paddingTop: space.sm,
              borderTop: `1px solid ${color.hairline}`,
            }}
          >
            © {year} Rental Car Manager
          </p>
        </Shell>
      </footer>
    </div>
  )
}
