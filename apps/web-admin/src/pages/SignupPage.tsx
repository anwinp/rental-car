import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Self-service organisation sign-up.
 *
 * Public route: no tenant exists yet, so nothing here sends a tenant header.
 * The workspace address is checked as the user types, because discovering it is
 * taken after filling in the whole form is the most annoying way to learn it.
 */

type SlugState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; slug: string; bookingUrl?: string }
  | { kind: 'taken'; reason: string }

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
}

/**
 * Provisioning steps, as a new operator should read them.
 *
 * Only two of the four keys the API returns were mapped, so a fresh workspace
 * showed two labelled rows and two bullets with no text beside them — the
 * catalogue clone and the rate bands both rendered blank. Unknown keys now drop
 * out entirely rather than leaving an empty bullet behind.
 */
function provisionedLabel(step: string): string | null {
  // rate_schedule_items carries its count: "rate_schedule_items:12".
  const [key, value] = step.split(':')
  switch (key) {
    case 'catalogues_cloned':
      return 'Vehicle classes and extras added'
    case 'starter_location':
      return 'Starter branch created'
    case 'rack_rate_code':
      return 'Standard rate code created'
    case 'rate_schedule_items':
      return value ? `Priced ${value} vehicle classes` : 'Rate bands created'
    default:
      return null
  }
}

export default function SignupPage() {
  const navigate = useNavigate()

  const [companyName, setCompanyName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [slugState, setSlugState] = useState<SlugState>({ kind: 'idle' })
  // Carried from the pricing page. Recorded as an intention only — the
  // workspace starts on the free default and stays there until a payment
  // clears, so arriving here with ?plan=ENTERPRISE grants nothing.
  const [plans, setPlans] = useState<{ code: string; name: string; price_cents: number | null; currency: string | null; billing_period: string }[]>([])
  const [planCode, setPlanCode] = useState(
    new URLSearchParams(window.location.search).get('plan')?.toUpperCase() ?? '',
  )
  useEffect(() => {
    fetch('/api/v1/public/plans')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPlans(Array.isArray(rows) ? rows : []))
      .catch(() => setPlans([]))
  }, [])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<null | {
    slug: string
    company_name: string
    workspace_url: string
    booking_url?: string
    admin_url?: string
    counter_url?: string
    provisioned: string[]
    verification_required?: boolean
    email_sent?: boolean
    verification_link?: string | null
  }>(null)
  const [resendNote, setResendNote] = useState('')
  const [resending, setResending] = useState(false)

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Suggest an address from the company name until the user edits it directly.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(companyName))
  }, [companyName, slugTouched])

  // Shown before the first availability response lands. Derived from the host
  // this app is served on: rcm-admin.ceez.ai -> "-rcm.ceez.ai", because a
  // workspace sits alongside the platform label rather than below it. Falls
  // back to a plain subdomain on a two-label apex, which is the dev shape.
  const hostSuffix = (() => {
    if (typeof window === 'undefined') return ''
    const [name, port] = window.location.host.split(':')
    const parts = name.split('.').filter(Boolean)
    const tail = port ? `:${port}` : ''
    if (parts.length < 3) return `.${name}${tail}`
    const platform = parts[0].replace(/-admin$/, '')
    return `-${platform}.${parts.slice(1).join('.')}${tail}`
  })()

  useEffect(() => {
    if (slug.length < 3) {
      setSlugState({ kind: 'idle' })
      return
    }
    setSlugState({ kind: 'checking' })
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/public/slug-available?slug=${encodeURIComponent(slug)}`,
        )
        const data = await res.json()
        setSlugState(
          data.available
            ? { kind: 'available', slug: data.slug, bookingUrl: data.booking_url }
            : { kind: 'taken', reason: data.reason ?? 'Not available.' },
        )
      } catch {
        setSlugState({ kind: 'idle' })
      }
    }, 350)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [slug])

  const passwordOk = password.length >= 10 && /[A-Z]/.test(password) && /\d/.test(password)
  const canSubmit =
    companyName.trim().length >= 2 &&
    slugState.kind === 'available' &&
    firstName.trim() &&
    lastName.trim() &&
    email.includes('@') &&
    passwordOk &&
    !submitting

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/v1/public/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName.trim(),
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
          ? data.detail[0]?.msg ?? 'Could not create the workspace.'
          : data?.detail ?? 'Could not create the workspace.'
        setError(String(detail))
        return
      }
      setCreated(data)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success: confirmation pending ─────────────────────────────────────────
  async function handleResend() {
    setResending(true)
    setResendNote('')
    try {
      const res = await fetch('/api/v1/public/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      setResendNote(data.message ?? 'A new link is on its way.')
    } catch {
      setResendNote('Could not reach the server.')
    } finally {
      setResending(false)
    }
  }

  if (created) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/15">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white">
            {created.email_sent === false ? 'Almost there' : 'Check your email'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {created.email_sent === false ? (
              <>
                <strong className="text-slate-200">{created.company_name}</strong> is
                created but not yet active. Confirm the address to activate it and
                sign in.
              </>
            ) : (
              <>
                We sent a confirmation link to{' '}
                <span className="font-medium text-slate-200">{email}</span>. Confirm the
                address to activate{' '}
                <strong className="text-slate-200">{created.company_name}</strong> and
                sign in. The link expires in 24 hours.
              </>
            )}
          </p>

          {created.provisioned?.length > 0 && (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Ready and waiting for you
              </p>
              <ul className="mt-2.5 space-y-1.5">
                {created.provisioned.map(provisionedLabel).filter(Boolean).map((label) => (
                  <li key={label} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(created.booking_url || created.admin_url || created.counter_url) && (
            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Your three addresses
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Customers book on the first, your managers work in the second, and
                the counter runs pick-ups and returns on the third.
              </p>
              <dl className="mt-3 space-y-3">
                {([
                  ['Booking site — for your customers', created.booking_url],
                  ['Back office — for your managers', created.admin_url],
                  ['Counter — pick-up and return', created.counter_url],
                ] as const).map(([label, url]) =>
                  url ? (
                    <div key={label}>
                      <dt className="text-xs font-medium text-slate-400">{label}</dt>
                      <dd>
                        <a href={url}
                           className="break-all font-mono text-xs text-indigo-300 underline underline-offset-2">
                          {url}
                        </a>
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </div>
          )}

          {/* Only rendered when no mail transport was available and nothing was
              actually sent — never merely because this is a dev build. */}
          {created.verification_link && (
            <div className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                No email was sent
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-200/80">
                This environment has no mail transport configured, so use this link to
                confirm the workspace.
              </p>
              <a
                href={created.verification_link}
                className="mt-2.5 inline-block break-all font-mono text-xs text-amber-300 underline underline-offset-2"
              >
                {created.verification_link}
              </a>
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              onClick={handleResend}
              disabled={resending}
              className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700 disabled:text-slate-500"
            >
              {resending ? 'Sending…' : 'Resend email'}
            </button>
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-medium text-indigo-400 hover:text-indigo-300"
            >
              Already confirmed? Sign in
            </button>
          </div>
          {resendNote && <p className="mt-3 text-xs text-slate-400">{resendNote}</p>}
        </div>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen">
      <div
        className="hidden lg:flex w-5/12 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(160deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" />
              <circle cx="7" cy="17" r="2" />
              <circle cx="17" cy="17" r="2" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">RCM</span>
        </div>

        <div className="space-y-6">
          <h1 className="text-3xl font-bold leading-tight text-white">
            Start running your fleet in minutes
          </h1>
          <p className="text-base leading-relaxed text-indigo-200">
            Your own workspace, your own data, isolated from every other
            organisation on the platform.
          </p>
          <ul className="space-y-3">
            {[
              'Your own branch, fleet and pricing',
              'Standard vehicle classes ready to quote',
              'Invite your counter staff and managers',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-indigo-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc"
                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                     className="mt-0.5 flex-none">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-indigo-300/70">© 2026 RCM · Enterprise Fleet Management</p>
      </div>

      <div className="flex w-full items-center justify-center bg-slate-950 px-6 py-12 lg:w-7/12">
        <form onSubmit={handleSubmit} className="w-full max-w-md">
          <h2 className="text-2xl font-bold text-white">Create your workspace</h2>
          <p className="mt-1.5 text-sm text-slate-400">
            Already have one?{' '}
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              Sign in
            </button>
          </p>

          {error && (
            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-slate-300">
                Company name
              </label>
              <input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Harbor Rentals"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-slate-300">
                Workspace address
              </label>
              <div className="mt-1.5 flex items-stretch overflow-hidden rounded-lg border border-slate-700 bg-slate-900 focus-within:border-indigo-500">
                <input
                  id="slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(slugify(e.target.value))
                  }}
                  placeholder="harbor-rentals"
                  className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-600 focus:outline-none"
                />
                {/* The suffix is whatever this deployment actually serves. It
                    was hardcoded to ".rcm.app" — a domain that does not exist
                    here — so the address shown during signup was never the one
                    the workspace got. */}
                <span className="flex items-center border-l border-slate-700 bg-slate-800/60 px-3 font-mono text-xs text-slate-400">
                  {hostSuffix}
                </span>
              </div>
              <p className="mt-1.5 min-h-[1.25rem] text-xs">
                {slugState.kind === 'checking' && (
                  <span className="text-slate-500">Checking availability…</span>
                )}
                {slugState.kind === 'available' && (
                  <span className="text-emerald-400">
                    {slugState.bookingUrl?.replace(/^https?:\/\//, '') ??
                      `${slugState.slug}${hostSuffix}`}{' '}is available
                  </span>
                )}
                {slugState.kind === 'taken' && (
                  <span className="text-amber-400">{slugState.reason}</span>
                )}
                {slugState.kind === 'idle' && slug.length > 0 && slug.length < 3 && (
                  <span className="text-slate-500">At least 3 characters.</span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="first" className="block text-sm font-medium text-slate-300">
                  First name
                </label>
                <input
                  id="first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="last" className="block text-sm font-medium text-slate-300">
                  Last name
                </label>
                <input
                  id="last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300">
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2.5 pr-16 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                At least 10 characters, with a capital letter and a number.
              </p>
            </div>
          </div>

          {/* Chosen here, paid for after the email is confirmed. Charging
              before an address is proven leaves a paid workspace nobody can
              sign into and a refund conversation, so the order is deliberate
              and is stated rather than left to be discovered. */}
          {plans.length > 0 && (
            <div className="mt-6">
              <label htmlFor="plan" className="block text-sm font-medium text-slate-200">
                Plan
              </label>
              <select
                id="plan"
                value={planCode}
                onChange={(e) => setPlanCode(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="">Start free — decide later</option>
                {plans
                  .filter((p) => p.price_cents !== null && p.price_cents > 0)
                  .map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name} — {((p.price_cents ?? 0) / 100).toLocaleString(undefined, {
                        style: 'currency', currency: p.currency || 'USD',
                        maximumFractionDigits: 0,
                      })}/{p.billing_period === 'YEARLY' ? 'yr' : 'mo'}
                    </option>
                  ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                {planCode
                  ? 'Nothing is charged now. Confirm your email address first, then pay — your workspace runs on the free plan until you do.'
                  : 'You can pick a paid plan at any time from inside your workspace.'}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-7 w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            {submitting ? 'Creating your workspace…' : 'Create workspace'}
          </button>
        </form>
      </div>
    </div>
  )
}
