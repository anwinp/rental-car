import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

/**
 * One workspace, everything the platform needs to answer a support ticket.
 *
 * The console was a list you could not click into: an email arrived and there
 * was nowhere to look. This is the page every destructive button should live
 * on, and the page that answers the two questions actually asked — "why can't
 * they take a booking" and "which of them can still sign in".
 *
 * Configuration is shown as counts and states. The endpoint deliberately
 * returns no secrets, so this cannot become a way to read a customer's keys.
 */

interface StaffRow {
  user_id: string
  email: string
  role: string
  is_active: boolean
  last_login_at: string | null
  email_verified_at: string | null
  is_mfa_enabled: boolean
  locked_until: string | null
}

interface Detail {
  tenant_id: string
  slug: string
  name: string
  trading_name: string | null
  status: string
  primary_email: string | null
  created_at: string
  deleted_at: string | null
  restore_days_left: number | null
  subscription_tier: string | null
  trial_ends_at: string | null
  currency: string | null
  timezone: string | null
  tos_accepted_at: string | null
  tos_version: string | null
  booking_url: string
  admin_url: string
  counter_url: string
  staff_count: number
  locations: number
  vehicles: number
  reservations: number
  reservations_30d: number
  last_reservation_at: string | null
  active_rate_codes: number
  priced_extras: number
  locations_with_tax: number
  staff: StaffRow[]
  is_self: boolean
}


// Narrower than the database enum on purpose: CUSTOMER, CORPORATE_BOOKER,
// API_PARTNER and AGENT_SERVICE are not employees, and minting one of those
// inside a customer's workspace is not a support action.
const ROLES = [
  'SUPER_ADMIN', 'SYSTEM_ADMIN', 'EXECUTIVE', 'REGIONAL_MANAGER',
  'BRANCH_MANAGER', 'FLEET_MANAGER', 'FINANCE', 'FINANCE_ANALYST',
  'CLAIMS_COORDINATOR', 'SENIOR_AGENT', 'MAINTENANCE_TECH', 'COUNTER_AGENT',
  'READONLY_AUDITOR',
]

function roleLabel(r: string): string {
  return r.replace(/_/g, ' ').toLowerCase()
}

function when(v: string | null | undefined): string {
  if (!v) return 'never'
  const d = new Date(v)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days}d ago`
  return d.toISOString().slice(0, 10)
}

export function PlatformTenantDetailPage() {
  const { tenantId } = useParams()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // Which row has just been sent one, so the button can report what happened
  // rather than snapping back and leaving the operator wondering.
  const [sent, setSent] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ email: '', first_name: '', last_name: '', role: 'COUNTER_AGENT' })
  const [editing, setEditing] = useState<string | null>(null)
  // Fetched, not hardcoded: a plan created in the catalogue has to be
  // assignable here, and a constant is exactly how the four lists drifted
  // apart before migration 074. Archived plans are left out — they are not
  // assignable — but the plan this workspace is already on is kept, so an
  // archived plan does not silently read as a different one in the select.
  const [plans, setPlans] = useState<{ code: string; display_name: string; is_active: boolean }[]>([])
  useEffect(() => {
    fetch('/api/v1/platform/plans', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setPlans)
      .catch(() => setPlans([]))
  }, [])

  async function load() {
    try {
      const res = await fetch(`/api/v1/platform/tenants/${tenantId}`, {
        credentials: 'include',
      })
      if (!res.ok) {
        setError(res.status === 404 ? 'No such workspace.' : 'Could not load.')
        return
      }
      setD(await res.json())
    } catch {
      setError('Could not reach the server.')
    }
  }
  useEffect(() => { void load() }, [tenantId])

  async function changePlan(patch: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/v1/platform/tenants/${tenantId}/plan`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setNotice(String(body.message ?? 'Updated.')); await load() }
      else setError(String(body.detail ?? 'Could not change the plan.'))
    } finally { setBusy(false) }
  }

  async function sendReset(userId: string, email: string) {
    // Confirmed because it lands in somebody else's inbox unprompted. Cheap to
    // undo, but not something to fire from a stray click while reading a page.
    if (!window.confirm(
      `Email a password reset link to ${email}?\n\n` +
      'It goes only to that address, expires in one hour, and signs them out ' +
      'of everything when they use it.'
    )) return

    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(
        `/api/v1/platform/tenants/${tenantId}/staff/${userId}/password-reset`,
        { method: 'POST', credentials: 'include' },
      )
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setNotice(String(body.message ?? 'Link sent.')); setSent(userId) }
      else setError(String(body.detail ?? 'Could not send the link.'))
    } catch {
      setError('Could not reach the server.')
    } finally { setBusy(false) }
  }

  async function call(url: string, init: RequestInit, ok: string): Promise<boolean> {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(url, { credentials: 'include', ...init })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setNotice(String(body.message ?? ok)); await load(); return true }
      setError(String(body.detail ?? 'That did not work.'))
      return false
    } catch {
      setError('Could not reach the server.')
      return false
    } finally { setBusy(false) }
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    const okd = await call(
      `/api/v1/platform/tenants/${tenantId}/staff`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) },
      'Account created.',
    )
    if (okd) {
      setAdding(false)
      setDraft({ email: '', first_name: '', last_name: '', role: 'COUNTER_AGENT' })
    }
  }

  async function patchMember(userId: string, patch: Record<string, unknown>) {
    await call(
      `/api/v1/platform/tenants/${tenantId}/staff/${userId}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
      'Updated.',
    )
  }

  async function verifyWorkspace() {
    if (!window.confirm(
      `Confirm ${d!.name} without the email link?\n\n` +
      'Use this when the owner cannot receive or click the link and you are ' +
      'satisfied they are who they say. It activates the workspace and marks ' +
      'the address confirmed. It does not pay for any plan they chose.'
    )) return
    await call(`/api/v1/platform/tenants/${tenantId}/verify`, { method: 'POST' },
      'Workspace confirmed.')
  }

  async function removeMember(userId: string, email: string) {
    // Named for what it does rather than what the button says. "Delete" would
    // promise erasure this does not perform.
    if (!window.confirm(
      `Remove ${email} from this workspace?\n\n` +
      'They are signed out immediately and can never sign in again. Their ' +
      'record stays attached to the rentals and claims they handled, so that ' +
      'history is not rewritten.'
    )) return
    await call(
      `/api/v1/platform/tenants/${tenantId}/staff/${userId}`,
      { method: 'DELETE' },
      'Removed.',
    )
  }

  if (error && !d) {
    return <div className="mx-auto max-w-5xl p-8 text-sm text-red-300">{error}</div>
  }
  if (!d) {
    return <div className="mx-auto max-w-5xl p-8 text-sm text-slate-500">Loading…</div>
  }

  // Why a workspace cannot sell anything. Ordered the way an operator hits
  // them, so the first unmet item is the one to talk to them about.
  const blockers = [
    { ok: d.locations > 0, label: 'Has a branch' },
    { ok: d.active_rate_codes > 0, label: 'Has an active rate code' },
    { ok: d.vehicles > 0, label: 'Has vehicles' },
    { ok: d.locations_with_tax > 0, label: 'Branches linked to tax' },
    { ok: d.priced_extras > 0, label: 'Extras priced', soft: true },
  ]
  const hard = blockers.filter((b) => !b.ok && !b.soft)

  return (
    <div className="mx-auto max-w-5xl p-8">
      <a href="/platform" className="text-xs text-slate-500 hover:text-slate-300">
        ← All workspaces
      </a>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{d.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{d.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            {d.status.replace('_', ' ').toLowerCase()}
          </span>
          {d.deleted_at && (
            <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-red-300">
              deleted · {d.restore_days_left}d to restore
            </span>
          )}
        </div>
      </header>

      {notice && <p className="mt-4 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      {/* The commonest support call for a new workspace: the confirmation
          email went to spam, or to a shared inbox nobody reads, or the address
          has a typo. Resending it to the address that is not working does not
          help, so this is the way out. */}
      {d.status === 'PENDING_VERIFICATION' && (
        <section className="mt-6 rounded-xl border border-amber-700/50 bg-amber-500/10 p-5">
          <h2 className="text-sm font-semibold text-amber-200">
            Waiting on email confirmation
          </h2>
          <p className="mt-1 text-sm text-amber-100/80">
            Nobody can sign in and the booking site is off until the owner
            confirms {d.primary_email ?? 'their address'}. If they cannot
            receive the link and you are satisfied who they are, confirm it for
            them.
          </p>
          <button
            onClick={() => void verifyWorkspace()} disabled={busy}
            className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            Confirm and activate
          </button>
          {d.subscription_tier && (
            <p className="mt-2 text-xs text-amber-100/60">
              This does not pay for a plan — they will still be asked for that.
            </p>
          )}
        </section>
      )}

      {/* Can they sell? The first question worth answering. */}
      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Can they take a booking?
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {hard.length === 0
            ? 'Yes — everything required is in place.'
            : `No — ${hard.map((b) => b.label.toLowerCase()).join(', ')}.`}
        </p>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {blockers.map((b) => (
            <li key={b.label} className="flex items-center gap-2 text-xs">
              <span className={b.ok ? 'text-emerald-400' : b.soft ? 'text-amber-400' : 'text-red-400'}>
                {b.ok ? '✓' : '✗'}
              </span>
              <span className={b.ok ? 'text-slate-400' : 'text-slate-200'}>{b.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* The three addresses — "our site is down" is usually the wrong host. */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Their addresses
        </h2>
        <dl className="mt-3 space-y-2">
          {[
            ['Booking site', d.booking_url],
            ['Back office', d.admin_url],
            ['Counter', d.counter_url],
          ].map(([label, url]) => (
            <div key={label} className="flex flex-wrap items-baseline gap-x-3">
              <dt className="w-28 text-xs text-slate-500">{label}</dt>
              <dd>
                <a href={url} target="_blank" rel="noreferrer"
                   className="break-all font-mono text-xs text-indigo-300 hover:text-indigo-200">
                  {url}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Commercial */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Plan
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={d.subscription_tier ?? 'STARTER'}
              disabled={busy || d.is_self}
              onChange={(e) => void changePlan({ subscription_tier: e.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              {plans
                .filter((p) => p.is_active || p.code === d.subscription_tier)
                .map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.display_name}{p.is_active ? '' : ' (archived)'}
                  </option>
                ))}
            </select>
            <button
              disabled={busy || d.is_self}
              onClick={() => {
                const until = new Date(Date.now() + 14 * 86_400_000).toISOString()
                void changePlan({ trial_ends_at: until })
              }}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Extend trial 14 days
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Trial ends {d.trial_ends_at ? d.trial_ends_at.slice(0, 10) : '—'} ·{' '}
            {d.currency ?? '—'} · {d.timezone ?? '—'}
          </p>
          {d.is_self && (
            <p className="mt-2 text-xs text-amber-400">
              This is your own workspace — plan changes are blocked here.
            </p>
          )}
        </section>

        {/* Shape of the business */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Activity
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Fleet</dt>
            <dd className="text-right font-mono tabular-nums text-slate-200">{d.vehicles}</dd>
            <dt className="text-slate-500">Branches</dt>
            <dd className="text-right font-mono tabular-nums text-slate-200">{d.locations}</dd>
            <dt className="text-slate-500">Bookings (all time)</dt>
            <dd className="text-right font-mono tabular-nums text-slate-200">{d.reservations}</dd>
            <dt className="text-slate-500">Bookings (30d)</dt>
            <dd className="text-right font-mono tabular-nums text-slate-200">{d.reservations_30d}</dd>
            <dt className="text-slate-500">Last booking</dt>
            <dd className="text-right text-slate-200">{when(d.last_reservation_at)}</dd>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Signed up {when(d.created_at)} · ToS{' '}
            {d.tos_accepted_at ? `${d.tos_version ?? 'accepted'}` : 'not accepted'}
          </p>
        </section>
      </div>

      {/* Who can actually get in — the churn and lockout signal. */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            People ({d.staff.length})
          </h2>
          <button
            disabled={busy}
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {adding ? 'Cancel' : 'Add person'}
          </button>
        </div>
        {/* Said once, here, rather than in a tooltip on every button. An
            operator should know the shape of the power before reaching for it. */}
        <p className="mt-2 text-xs text-slate-500">
          You can add people, change a role, and start a password reset. The
          reset link goes to the address on the account and nowhere else — you
          will not see it, and you cannot set a password yourself. Email
          addresses are not editable here, so a reset can never be pointed
          somewhere new.
        </p>

        {adding && (
          <form onSubmit={addMember}
                className="mt-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Email
              <input
                type="email" required value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Role
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              First name
              <input
                required value={draft.first_name}
                onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="text-xs text-slate-400">
              Last name
              <input
                value={draft.last_name}
                onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <p className="text-xs text-slate-500 sm:col-span-2">
              No password is set here. They get an email with a one-hour link to
              choose their own — which is the only way into the account.
            </p>
            <div className="sm:col-span-2">
              <button
                type="submit" disabled={busy}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Create account and send link
              </button>
            </div>
          </form>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2 text-left font-semibold">Email</th>
                <th className="px-2 py-2 text-left font-semibold">Role</th>
                <th className="px-2 py-2 text-left font-semibold">Last sign-in</th>
                <th className="px-2 py-2 text-left font-semibold">State</th>
                <th className="px-2 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.staff.map((u) => (
                <tr key={u.user_id} className="border-t border-slate-800/70">
                  <td className="px-2 py-2 text-slate-200">{u.email}</td>
                  <td className="px-2 py-2 text-xs text-slate-400">
                    {editing === u.user_id ? (
                      <select
                        autoFocus
                        defaultValue={u.role}
                        disabled={busy}
                        onBlur={() => setEditing(null)}
                        onChange={(e) => {
                          setEditing(null)
                          if (e.target.value !== u.role) {
                            void patchMember(u.user_id, { role: e.target.value })
                          }
                        }}
                        className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditing(u.user_id)}
                        className="rounded px-1 text-left hover:text-white hover:underline"
                        title="Change role"
                      >
                        {roleLabel(u.role)}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-400">{when(u.last_login_at)}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {!u.is_active && <span className="text-amber-400">inactive</span>}
                      {u.locked_until && <span className="text-red-400">locked</span>}
                      {!u.email_verified_at && <span className="text-amber-400">unverified</span>}
                      {u.is_mfa_enabled && <span className="text-emerald-400">MFA</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        disabled={busy || sent === u.user_id || !u.is_active}
                        onClick={() => void sendReset(u.user_id, u.email)}
                        title={
                          u.is_active
                            ? `Email a single-use recovery link to ${u.email}`
                            : 'Reactivate this account first — the link would work and the sign-in would not.'
                        }
                        className="whitespace-nowrap rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {sent === u.user_id ? 'Link sent' : 'Send reset'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void patchMember(u.user_id, { is_active: !u.is_active })}
                        title={u.is_active
                          ? 'Block sign-in and end their sessions. Reversible.'
                          : 'Let them sign in again.'}
                        className="whitespace-nowrap rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
                      >
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void removeMember(u.user_id, u.email)}
                        title="Remove from this workspace"
                        className="whitespace-nowrap rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-300 hover:border-red-700 hover:text-red-200 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
