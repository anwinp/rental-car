import { useEffect, useState } from 'react'

/**
 * What this workspace is on, and how much of it is used.
 *
 * Built because the caps existed, were enforced, and appeared nowhere. A
 * workspace discovered its 25-vehicle limit by being refused mid-task, with no
 * page showing the number and no warning on the way up — the platform console
 * knew all of it and the people paying did not. Enforcement a customer cannot
 * see is indistinguishable from a bug.
 *
 * Reachable by every member, not just administrators. The counter agent who
 * cannot add a vehicle is the one who needs to know why, and "ask your manager"
 * when the answer is a number on their own account is not a boundary.
 */

interface CapUsage {
  used: number
  limit: number | null
  at_warning: boolean
  at_limit: boolean
}

interface FeatureRow {
  key: string
  label: string
  blurb: string
  included: boolean
}

interface PlanInfo {
  plan: string | null
  plan_code: string | null
  price_cents: number | null
  currency: string | null
  billing_period: string | null
  status: string | null
  term_ends_at: string | null
  days_left: number | null
  usage: { staff: CapUsage; vehicles: CapUsage; locations: CapUsage }
  features: FeatureRow[]
}

const CAPS: { key: keyof PlanInfo['usage']; label: string; noun: string }[] = [
  { key: 'staff', label: 'Team members', noun: 'people' },
  { key: 'vehicles', label: 'Vehicles', noun: 'vehicles' },
  { key: 'locations', label: 'Branches', noun: 'branches' },
]

function money(cents: number | null, currency: string | null, period: string | null): string {
  // "Not priced" rather than "$0.00" — a zero here is a number somebody would
  // repeat to a colleague as though it were the price.
  if (cents === null || cents === undefined) return 'No price set'
  const amount = (cents / 100).toLocaleString(undefined, {
    style: 'currency', currency: currency || 'USD',
  })
  if (period === 'CUSTOM') return `${amount} · custom terms`
  return `${amount} / ${period === 'YEARLY' ? 'year' : 'month'}`
}

export function PlanUsagePage() {
  const [d, setD] = useState<PlanInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/v1/tenants/my/plan', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) { setError('Could not load your plan.'); return }
        setD(await r.json())
      })
      .catch(() => setError('Could not reach the server.'))
  }, [])

  if (error) return <div className="p-8 text-sm text-red-300">{error}</div>
  if (!d) return <div className="p-8 text-sm" style={{ color: 'var(--text-3)' }}>Loading…</div>

  const included = d.features.filter((f) => f.included)
  const excluded = d.features.filter((f) => !f.included)

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>
          Your plan
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
          What is included, and how much of it you are using.
        </p>
      </header>

      <section className="mt-6 rounded-xl p-5"
               style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-1)' }}>
              {d.plan ?? 'No plan'}
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
              {money(d.price_cents, d.currency, d.billing_period)}
            </p>
          </div>
          {d.term_ends_at ? (
            <div className="text-right">
              <div className="text-sm font-medium"
                   style={{ color: (d.days_left ?? 99) <= 7 ? '#f59e0b' : 'var(--text-2)' }}>
                {(d.days_left ?? 0) <= 0
                  ? 'Ends today'
                  : `${d.days_left} day${d.days_left === 1 ? '' : 's'} remaining`}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                until {new Date(d.term_ends_at).toISOString().slice(0, 10)}
              </div>
            </div>
          ) : (
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>No end date</div>
          )}
        </div>

        {/* Said plainly, because the consequence is severe and the recovery
            link arrives by email to an address the reader may not watch. */}
        {d.term_ends_at && (d.days_left ?? 99) <= 7 && (
          <p className="mt-4 rounded-lg px-3 py-2 text-xs"
             style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
            When this ends, sign-in stops and your booking site stops taking
            reservations. Nothing is deleted, and everything returns when you
            renew — but the renewal link is emailed to the workspace owner, so
            make sure that address is one somebody reads.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-xl p-5"
               style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-3)' }}>
          Usage
        </h2>
        <div className="mt-4 space-y-4">
          {CAPS.map(({ key, label, noun }) => {
            const u = d.usage[key]
            const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0
            const colour = u.at_limit ? '#ef4444' : u.at_warning ? '#f59e0b' : 'var(--accent)'
            return (
              <div key={key}>
                <div className="flex items-baseline justify-between text-sm">
                  <span style={{ color: 'var(--text-2)' }}>{label}</span>
                  <span className="font-mono tabular-nums text-xs"
                        style={{ color: 'var(--text-3)' }}>
                    {u.used} {u.limit === null ? '· unlimited' : `of ${u.limit}`}
                  </span>
                </div>
                {u.limit !== null && (
                  <>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                         style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all"
                           style={{ width: `${pct}%`, background: colour }} />
                    </div>
                    {u.at_limit ? (
                      <p className="mt-1.5 text-xs text-red-400">
                        You have reached this limit — adding more {noun} needs a
                        larger plan. Nothing you already have is affected.
                      </p>
                    ) : u.at_warning ? (
                      <p className="mt-1.5 text-xs" style={{ color: '#fbbf24' }}>
                        {u.limit - u.used} left before you reach the limit.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-4 rounded-xl p-5"
               style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-3)' }}>
          Capabilities
        </h2>

        <ul className="mt-4 space-y-2.5">
          {included.map((f) => (
            <li key={f.key} className="flex items-start gap-2.5">
              <span className="mt-0.5 text-emerald-400">✓</span>
              <span>
                <span className="text-sm" style={{ color: 'var(--text-1)' }}>{f.label}</span>
                <span className="block text-xs" style={{ color: 'var(--text-3)' }}>{f.blurb}</span>
              </span>
            </li>
          ))}
        </ul>

        {/* What an upgrade would add, not merely what is missing. A list of
            locked doors with no indication of what is behind them is a worse
            page than no list at all. */}
        {excluded.length > 0 && (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider"
               style={{ color: 'var(--text-3)' }}>
              Not included on {d.plan}
            </p>
            <ul className="mt-3 space-y-2.5">
              {excluded.map((f) => (
                <li key={f.key} className="flex items-start gap-2.5 opacity-60">
                  <span className="mt-0.5" style={{ color: 'var(--text-3)' }}>—</span>
                  <span>
                    <span className="text-sm" style={{ color: 'var(--text-2)' }}>{f.label}</span>
                    <span className="block text-xs" style={{ color: 'var(--text-3)' }}>{f.blurb}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="mt-5 text-xs" style={{ color: 'var(--text-3)' }}>
        To change plan, contact support. Self-serve upgrades are not available yet.
      </p>
    </div>
  )
}
