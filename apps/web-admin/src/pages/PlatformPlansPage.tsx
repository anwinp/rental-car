import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * The plan catalogue.
 *
 * Until migration 074 the set of plans was a CHECK constraint, a separate
 * limits table and a hardcoded literal in the signup insert — three lists that
 * had to agree and did not. Adding a plan meant a schema change, so nobody
 * added one, so they drifted; that is how GROWTH came to be unassignable while
 * PROFESSIONAL was silently unlimited.
 *
 * A plan is now a row. This page edits rows.
 *
 * Two things are shown that a plain CRUD table would leave out, because both
 * are needed *before* acting rather than after: how many workspaces are on each
 * plan, and which plan new signups land on.
 */

interface Plan {
  code: string
  display_name: string
  description: string | null
  max_staff: number | null
  max_vehicles: number | null
  max_locations: number | null
  price_cents: number | null
  currency: string
  billing_period: string
  is_active: boolean
  is_default: boolean
  sort_order: number
  tenants: number
}

interface FeatureDef {
  key: string
  label: string
  blurb: string
}

const PERIODS = ['MONTHLY', 'YEARLY', 'CUSTOM']
const CAPS = [
  { key: 'max_staff', label: 'Team members' },
  { key: 'max_vehicles', label: 'Vehicles' },
  { key: 'max_locations', label: 'Branches' },
] as const

const BLANK = {
  code: '', display_name: '', description: '',
  max_staff: '', max_vehicles: '', max_locations: '',
  price_cents: '', currency: 'USD', billing_period: 'MONTHLY', sort_order: '100',
}

function money(cents: number | null, currency: string, period: string): string {
  // Not priced is not the same as free, and showing "$0.00" for an unpriced
  // plan would be a number somebody quotes to a customer.
  if (cents === null || cents === undefined) return 'not priced'
  const amount = (cents / 100).toLocaleString(undefined, {
    style: 'currency', currency: currency || 'USD',
  })
  if (period === 'CUSTOM') return `${amount} · custom terms`
  return `${amount}/${period === 'YEARLY' ? 'yr' : 'mo'}`
}

function cap(v: number | null): string {
  return v === null || v === undefined ? 'unlimited' : String(v)
}

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ ...BLANK })
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState({ ...BLANK })
  // The vocabulary comes from the server's code registry, never free text: a
  // key with no gate behind it would tick a box and grant nothing.
  const [catalogue, setCatalogue] = useState<FeatureDef[]>([])
  const [granted, setGranted] = useState<Record<string, string[]>>({})

  async function load() {
    try {
      const res = await fetch('/api/v1/platform/plans', { credentials: 'include' })
      if (!res.ok) { setError('Could not load the plan catalogue.'); return }
      setPlans(await res.json())
    } catch {
      setError('Could not reach the server.')
    }
  }
  async function loadFeatures(list: Plan[]) {
    const cat = await fetch('/api/v1/platform/features', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
    setCatalogue(cat)
    const pairs = await Promise.all(
      list.map(async (p) => {
        const r = await fetch(`/api/v1/platform/plans/${p.code}/features`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : { features: [] }))
          .catch(() => ({ features: [] }))
        return [p.code, r.features as string[]] as const
      }),
    )
    setGranted(Object.fromEntries(pairs))
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { if (plans) void loadFeatures(plans) }, [plans?.length])

  async function call(url: string, init: RequestInit, ok: string): Promise<boolean> {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(url, { credentials: 'include', ...init })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setNotice(ok); await load(); return true }
      // Pydantic returns a list of field errors; the server's own refusals are
      // a sentence. Show whichever arrived rather than "[object Object]".
      const detail = Array.isArray(body.detail)
        ? body.detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join('; ')
        : body.detail
      setError(String(detail ?? 'That did not work.'))
      return false
    } catch {
      setError('Could not reach the server.')
      return false
    } finally { setBusy(false) }
  }

  /** Empty string means "leave it out"; the API reads a missing cap as unlimited. */
  function numeric(v: string): number | undefined {
    const t = v.trim()
    if (t === '') return undefined
    const n = Number(t)
    return Number.isFinite(n) ? n : undefined
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const body: Record<string, unknown> = {
      code: draft.code,
      display_name: draft.display_name,
      description: draft.description || null,
      currency: draft.currency,
      billing_period: draft.billing_period,
      sort_order: numeric(draft.sort_order) ?? 100,
    }
    for (const c of CAPS) {
      const n = numeric(draft[c.key])
      if (n !== undefined) body[c.key] = n
    }
    const price = numeric(draft.price_cents)
    if (price !== undefined) body.price_cents = Math.round(price * 100)

    if (await call('/api/v1/platform/plans',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Plan created.')) {
      setAdding(false); setDraft({ ...BLANK })
    }
  }

  function beginEdit(p: Plan) {
    setEditing(p.code)
    setEdit({
      code: p.code,
      display_name: p.display_name,
      description: p.description ?? '',
      max_staff: p.max_staff === null ? '' : String(p.max_staff),
      max_vehicles: p.max_vehicles === null ? '' : String(p.max_vehicles),
      max_locations: p.max_locations === null ? '' : String(p.max_locations),
      price_cents: p.price_cents === null ? '' : String(p.price_cents / 100),
      currency: p.currency,
      billing_period: p.billing_period,
      sort_order: String(p.sort_order),
    })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const body: Record<string, unknown> = {
      display_name: edit.display_name,
      description: edit.description || null,
      currency: edit.currency,
      billing_period: edit.billing_period,
      sort_order: numeric(edit.sort_order) ?? 100,
      // A blank cap means unlimited. In a PATCH body that is indistinguishable
      // from "unchanged", so the fields to clear are named outright.
      unlimited: CAPS.filter((c) => edit[c.key].trim() === '').map((c) => c.key),
    }
    for (const c of CAPS) {
      const n = numeric(edit[c.key])
      if (n !== undefined) body[c.key] = n
    }
    const price = numeric(edit.price_cents)
    if (price !== undefined) body.price_cents = Math.round(price * 100)

    if (await call(`/api/v1/platform/plans/${editing}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Plan updated.')) {
      setEditing(null)
    }
  }

  async function setFlag(code: string, patch: Record<string, unknown>, ok: string) {
    await call(`/api/v1/platform/plans/${code}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
      ok)
  }

  async function toggleFeature(code: string, key: string) {
    const current = granted[code] ?? []
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key]
    // Optimistic, then reconciled from the response. A checkbox that waits for
    // a round trip before moving feels broken on a list this long.
    setGranted({ ...granted, [code]: next })
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/v1/platform/plans/${code}/features`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_code: code, features: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setGranted((g) => ({ ...g, [code]: body.features ?? next }))
        setNotice('Capabilities updated. This applies to everyone on the plan now.')
      } else {
        setGranted({ ...granted, [code]: current })
        setError(String(body.detail ?? 'Could not change capabilities.'))
      }
    } catch {
      setGranted({ ...granted, [code]: current })
      setError('Could not reach the server.')
    } finally { setBusy(false) }
  }

  async function remove(p: Plan) {
    if (!window.confirm(
      `Delete the ${p.display_name} plan?\n\n` +
      'This removes it from the catalogue entirely. If you only want to stop ' +
      'assigning it to new workspaces, archive it instead.'
    )) return
    await call(`/api/v1/platform/plans/${p.code}`, { method: 'DELETE' }, 'Plan deleted.')
  }

  if (!plans) {
    return (
      <div className="mx-auto max-w-5xl p-8 text-sm text-slate-500">
        {error || 'Loading…'}
      </div>
    )
  }

  const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none'
  const label = 'text-xs text-slate-400'

  function editor(
    state: typeof BLANK,
    set: (v: typeof BLANK) => void,
    onSubmit: (e: React.FormEvent) => void,
    submitLabel: string,
    isNew: boolean,
  ) {
    return (
      <form onSubmit={onSubmit}
            className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-3">
        <label className={label}>
          Code
          <input
            required disabled={!isNew} value={state.code}
            onChange={(e) => set({ ...state, code: e.target.value.toUpperCase() })}
            placeholder="GROWTH"
            className={`${field} mt-1 disabled:opacity-50`}
          />
          {!isNew && (
            <span className="mt-1 block text-[11px] text-slate-600">
              Fixed — it appears in logs and exports already written.
            </span>
          )}
        </label>
        <label className={label}>
          Name shown to people
          <input required value={state.display_name}
                 onChange={(e) => set({ ...state, display_name: e.target.value })}
                 placeholder="Growth" className={`${field} mt-1`} />
        </label>
        <label className={label}>
          Order in lists
          <input type="number" value={state.sort_order}
                 onChange={(e) => set({ ...state, sort_order: e.target.value })}
                 className={`${field} mt-1`} />
        </label>

        <label className={`${label} sm:col-span-3`}>
          Description
          <input value={state.description}
                 onChange={(e) => set({ ...state, description: e.target.value })}
                 placeholder="Several branches and a real fleet."
                 className={`${field} mt-1`} />
        </label>

        {CAPS.map((c) => (
          <label key={c.key} className={label}>
            {c.label}
            <input type="number" min={1} value={state[c.key]}
                   onChange={(e) => set({ ...state, [c.key]: e.target.value })}
                   placeholder="unlimited" className={`${field} mt-1`} />
          </label>
        ))}

        <label className={label}>
          Price
          <input type="number" min={0} step="0.01" value={state.price_cents}
                 onChange={(e) => set({ ...state, price_cents: e.target.value })}
                 placeholder="leave blank if not priced" className={`${field} mt-1`} />
        </label>
        <label className={label}>
          Currency
          <input maxLength={3} value={state.currency}
                 onChange={(e) => set({ ...state, currency: e.target.value.toUpperCase() })}
                 className={`${field} mt-1`} />
        </label>
        <label className={label}>
          Billed
          <select value={state.billing_period}
                  onChange={(e) => set({ ...state, billing_period: e.target.value })}
                  className={`${field} mt-1`}>
            {PERIODS.map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
          </select>
        </label>

        <p className="text-xs text-slate-500 sm:col-span-3">
          A blank cap means unlimited. Lowering a cap never disables anything a
          workspace already has — they simply cannot add more.
        </p>
        <div className="flex gap-2 sm:col-span-3">
          <button type="submit" disabled={busy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitLabel}
          </button>
          <button type="button"
                  onClick={() => { setAdding(false); setEditing(null) }}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500">
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <Link to="/platform" className="text-xs text-slate-500 hover:text-slate-300">
        ← All workspaces
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Plans</h1>
          <p className="mt-1 text-sm text-slate-400">
            What a workspace may be sold, and what it may use.
          </p>
        </div>
        <button onClick={() => { setAdding((v) => !v); setEditing(null) }} disabled={busy}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {adding ? 'Cancel' : 'New plan'}
        </button>
      </header>

      {notice && <p className="mt-4 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      {adding && (
        <div className="mt-5">
          {editor(draft, setDraft, create, 'Create plan', true)}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {plans.map((p) => (
          <section key={p.code}
                   className={`rounded-xl border p-5 ${p.is_active ? 'border-slate-800 bg-slate-900/40' : 'border-slate-800/60 bg-slate-900/20'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className={`text-base font-semibold ${p.is_active ? 'text-white' : 'text-slate-400'}`}>
                    {p.display_name}
                  </h2>
                  <span className="font-mono text-[11px] text-slate-500">{p.code}</span>
                  {p.is_default && (
                    <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                      signups land here
                    </span>
                  )}
                  {!p.is_active && (
                    <span className="rounded-full bg-slate-700/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      archived
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="mt-1 text-xs text-slate-500">{p.description}</p>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-slate-200">
                  {money(p.price_cents, p.currency, p.billing_period)}
                </div>
                <div className="text-xs text-slate-500">
                  {p.tenants} workspace{p.tenants === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {CAPS.map((c) => (
                <div key={c.key} className="flex gap-1.5">
                  <dt className="text-slate-500">{c.label}</dt>
                  <dd className="font-mono tabular-nums text-slate-300">
                    {cap(p[c.key])}
                  </dd>
                </div>
              ))}
            </dl>

            {catalogue.length > 0 && (
              <div className="mt-4 border-t border-slate-800/70 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Included capabilities
                </p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {catalogue.map((f) => {
                    const on = (granted[p.code] ?? []).includes(f.key)
                    return (
                      <label key={f.key} title={f.blurb}
                             className="flex cursor-pointer items-start gap-2 text-xs">
                        <input
                          type="checkbox" checked={on} disabled={busy}
                          onChange={() => void toggleFeature(p.code, f.key)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-500"
                        />
                        <span className={on ? 'text-slate-200' : 'text-slate-500'}>
                          {f.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
                {p.tenants > 0 && (
                  <p className="mt-2 text-[11px] text-slate-600">
                    Applies immediately to {p.tenants} workspace{p.tenants === 1 ? '' : 's'} —
                    removing one revokes it mid-session.
                  </p>
                )}
              </div>
            )}

            {editing === p.code ? (
              <div className="mt-4">{editor(edit, setEdit, save, 'Save changes', false)}</div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => beginEdit(p)} disabled={busy}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40">
                  Edit
                </button>
                {!p.is_default && (
                  <button
                    onClick={() => void setFlag(p.code, { is_default: true }, `New signups now get ${p.display_name}.`)}
                    disabled={busy}
                    title="New workspaces will be created on this plan"
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40">
                    Make signup default
                  </button>
                )}
                <button
                  onClick={() => void setFlag(p.code, { is_active: !p.is_active },
                    p.is_active ? 'Archived. Existing workspaces are untouched.' : 'Plan is assignable again.')}
                  disabled={busy}
                  title={p.is_active
                    ? 'Stop assigning it to new workspaces. Everyone on it stays on it.'
                    : 'Allow it to be assigned again.'}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40">
                  {p.is_active ? 'Archive' : 'Unarchive'}
                </button>
                <button
                  onClick={() => void remove(p)} disabled={busy || p.tenants > 0 || p.is_default}
                  title={p.tenants > 0
                    ? `${p.tenants} workspace${p.tenants === 1 ? '' : 's'} on this plan — move them off, or archive it instead.`
                    : p.is_default ? 'Signups land here. Make another plan the default first.'
                    : 'Remove this plan from the catalogue'}
                  className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-300 hover:border-red-700 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-30">
                  Delete
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
