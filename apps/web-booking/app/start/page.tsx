'use client'

/**
 * Creating a workspace, on the marketing site.
 *
 * This used to live only in the back office, so choosing a plan on the pricing
 * page sent a prospective customer to <slug>-rcm-admin.ceez.ai — a back-office
 * hostname, for somebody who has no workspace and no account. Wrong audience,
 * wrong domain, and it looked like being dumped into somebody else's admin
 * panel.
 *
 * The form is short on purpose: everything not needed to create a workspace is
 * asked for later, from inside it. Someone who has just picked a price wants to
 * pay, not fill in a profile.
 *
 * When a paid plan is chosen, the register response carries a Stripe Checkout
 * URL and this page goes straight there. Payment happens on Stripe's own pages;
 * no card field exists anywhere in this codebase.
 */

import { useEffect, useState } from 'react'
import { MAX_WIDTH, color, rounded, space, type as t } from '../lib/designTokens'
import { Logo } from '../components/Logo'

interface PublicPlan {
  code: string
  name: string
  price_cents: number | null
  currency: string | null
  billing_period: string
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function priceLabel(p: PublicPlan): string {
  if (p.price_cents === null) return 'priced by agreement'
  if (p.price_cents === 0) return 'free'
  const amount = (p.price_cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: p.currency || 'USD',
    maximumFractionDigits: 0,
  })
  return `${amount}/${p.billing_period === 'YEARLY' ? 'year' : 'month'}`
}

export default function StartPage() {
  const [plans, setPlans] = useState<PublicPlan[]>([])
  const [planCode, setPlanCode] = useState('')
  const [company, setCompany] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<null | { admin_url: string; email_sent: boolean }>(null)

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('plan')?.toUpperCase() ?? ''
    setPlanCode(wanted)
    fetch('/api/v1/public/plans')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PublicPlan[]) => setPlans(Array.isArray(rows) ? rows : []))
      .catch(() => setPlans([]))
  }, [])

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(company))
  }, [company, slugTouched])

  const chosen = plans.find((p) => p.code === planCode) ?? null
  const paid = Boolean(chosen && chosen.price_cents !== null && chosen.price_cents > 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/v1/public/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: company.trim(),
          slug,
          admin_first_name: firstName.trim(),
          admin_last_name: lastName.trim(),
          admin_email: email.trim(),
          admin_password: password,
          plan_code: planCode || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = Array.isArray(data?.detail)
          ? data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : data?.detail
        setError(String(detail ?? 'Could not create the workspace.'))
        return
      }
      // Straight to Stripe when there is something to pay. Anything else and
      // the workspace is already usable once the address is confirmed.
      if (data.checkout_url) {
        window.location.href = data.checkout_url
        return
      }
      setDone({ admin_url: data.admin_url, email_sent: Boolean(data.email_sent) })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const field: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: `1px solid ${color.hairline}`,
    borderRadius: rounded.none,
    padding: `${space.xxs}px ${space.xs}px`,
    color: color.ink,
    fontSize: 15,
    marginTop: space.xxxs,
  }
  const label: React.CSSProperties = { ...t.captionUpper, color: color.muted }

  return (
    <main style={{ background: color.canvas, color: color.body, minHeight: '100vh' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: `${space.lg}px ${space.sm}px ${space.xxl}px` }}>
        <a href="/" style={{ textDecoration: 'none', display: 'inline-block' }}>
          <Logo size={24} />
        </a>

        {done ? (
          <div style={{ marginTop: space.lg }}>
            <h1 style={{ ...t.displayLg, color: color.ink, margin: `0 0 ${space.xs}px` }}>
              Your workspace is ready.
            </h1>
            <p style={{ ...t.bodyMd, color: color.body, margin: `0 0 ${space.sm}px` }}>
              {done.email_sent
                ? 'Confirm your email address using the link we just sent, then sign in.'
                : 'Confirm your email address, then sign in.'}
            </p>
            <a
              href={done.admin_url}
              style={{
                ...t.button, display: 'inline-block', background: color.primary,
                color: color.onPrimary, padding: `${space.xxs}px ${space.sm}px`,
                borderRadius: rounded.none, textDecoration: 'none',
              }}
            >
              Go to your workspace
            </a>
          </div>
        ) : (
          <>
            <h1 style={{ ...t.displayLg, color: color.ink, margin: `${space.lg}px 0 ${space.xxs}px` }}>
              Create your workspace
            </h1>
            <p style={{ ...t.bodyMd, color: color.body, margin: `0 0 ${space.md}px` }}>
              {paid && chosen
                ? `${chosen.name} — ${priceLabel(chosen)}. You will be taken to Stripe to pay once your workspace is created.`
                : 'Free to start. You can choose a paid plan whenever you need one.'}
            </p>

            <form onSubmit={submit} style={{ display: 'grid', gap: space.xs }}>
              {plans.length > 0 && (
                <div>
                  <label htmlFor="plan" style={label}>Plan</label>
                  <select id="plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}
                          style={{ ...field, background: color.canvas }}>
                    <option value="">Free to start</option>
                    {plans
                      .filter((p) => p.price_cents !== null && p.price_cents > 0)
                      .map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name} — {priceLabel(p)}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="company" style={label}>Company name</label>
                <input id="company" required value={company}
                       onChange={(e) => setCompany(e.target.value)} style={field} />
              </div>

              <div>
                <label htmlFor="slug" style={label}>Web address</label>
                <input id="slug" required value={slug}
                       onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
                       style={field} />
                <p style={{ ...t.bodyMd, fontSize: 13, color: color.muted, margin: `${space.xxxs}px 0 0` }}>
                  {slug ? `${slug}-rcm.ceez.ai` : 'Your booking site address.'}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.xs }}>
                <div>
                  <label htmlFor="fn" style={label}>First name</label>
                  <input id="fn" required value={firstName}
                         onChange={(e) => setFirstName(e.target.value)} style={field} />
                </div>
                <div>
                  <label htmlFor="ln" style={label}>Last name</label>
                  <input id="ln" required value={lastName}
                         onChange={(e) => setLastName(e.target.value)} style={field} />
                </div>
              </div>

              <div>
                <label htmlFor="em" style={label}>Work email</label>
                <input id="em" type="email" required value={email}
                       onChange={(e) => setEmail(e.target.value)} style={field} />
              </div>

              <div>
                <label htmlFor="pw" style={label}>Password</label>
                <input id="pw" type="password" required minLength={10} value={password}
                       autoComplete="new-password"
                       onChange={(e) => setPassword(e.target.value)} style={field} />
                <p style={{ ...t.bodyMd, fontSize: 13, color: color.muted, margin: `${space.xxxs}px 0 0` }}>
                  At least 10 characters.
                </p>
              </div>

              {error && (
                <p style={{ ...t.bodyMd, fontSize: 14, color: '#ff8b7a', margin: 0 }}>{error}</p>
              )}

              <button type="submit" disabled={busy}
                      style={{
                        ...t.button, background: color.primary, color: color.onPrimary,
                        border: 'none', borderRadius: rounded.none,
                        padding: `${space.xs}px ${space.sm}px`, cursor: busy ? 'default' : 'pointer',
                        opacity: busy ? 0.6 : 1, marginTop: space.xxs,
                      }}>
                {busy
                  ? 'Creating…'
                  : paid
                    ? 'Create workspace and pay'
                    : 'Create workspace'}
              </button>

              {paid && (
                <p style={{ ...t.bodyMd, fontSize: 13, color: color.muted, margin: 0 }}>
                  Payment is taken by Stripe. Card details never reach this site.
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  )
}
