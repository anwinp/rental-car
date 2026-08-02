import { useEffect, useState } from 'react'

/**
 * Vehicle classes and extras, for a workspace's own administrator.
 *
 * The API for both has existed since the catalogues stopped being global rows
 * shared across every tenant. It had no page, which left a workspace with the
 * classes it was seeded with and no way to price a single add-on — 0 of 45
 * extras across the whole platform carried a price, so nothing could be sold
 * at the counter.
 *
 * Classes carry counts and a can_delete flag from the server. That is the
 * difference between offering a delete that will be refused and offering the
 * thing that actually works: a class still fitted to vehicles is deactivated,
 * not removed, and the button says so before it is pressed.
 */

interface VehicleClass {
  class_id: string
  sipp_prefix: string
  name: string
  description: string | null
  sort_order: number | null
  is_active: boolean
  vehicle_count: number
  reservation_count: number
  can_delete: boolean
}

interface Extra {
  extra_id: string
  code: string
  name: string
  extra_type: string | null
  pricing_type: string | null
  default_price: number | null
  tax_treatment: string | null
  is_active: boolean
}

const API = '/api/v1/catalogue'
const PRICING = ['PER_DAY', 'PER_RENTAL', 'PER_UNIT']
const EXTRA_TYPES = ['EQUIPMENT', 'INSURANCE', 'SERVICE', 'FEE']

const BLANK_CLASS = { sipp_prefix: '', name: '', description: '', sort_order: '99' }
const BLANK_EXTRA = {
  code: '', name: '', extra_type: 'EQUIPMENT',
  pricing_type: 'PER_DAY', default_price: '',
}

export function CataloguePage() {
  const [tab, setTab] = useState<'classes' | 'extras'>('classes')
  const [classes, setClasses] = useState<VehicleClass[] | null>(null)
  const [extras, setExtras] = useState<Extra[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [newClass, setNewClass] = useState({ ...BLANK_CLASS })
  const [newExtra, setNewExtra] = useState({ ...BLANK_EXTRA })
  const [adding, setAdding] = useState(false)
  // extra_id -> the price being typed, so a half-typed number is never sent.
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})

  async function load() {
    try {
      const [c, e] = await Promise.all([
        fetch(`${API}/vehicle-classes`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${API}/extras`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      ])
      setClasses(c); setExtras(e)
    } catch {
      setError('Could not reach the server.')
    }
  }
  useEffect(() => { void load() }, [])

  async function call(url: string, init: RequestInit, ok: string): Promise<boolean> {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(url, { credentials: 'include', ...init })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setNotice(String(body.message ?? ok)); await load(); return true }
      const detail = Array.isArray(body.detail)
        ? body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
        : body.detail
      setError(String(detail ?? 'That did not work.'))
      return false
    } catch {
      setError('Could not reach the server.'); return false
    } finally { setBusy(false) }
  }

  const json = (body: unknown, method = 'POST'): RequestInit => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  async function createClass(e: React.FormEvent) {
    e.preventDefault()
    const ok = await call(`${API}/vehicle-classes`, json({
      sipp_prefix: newClass.sipp_prefix.toUpperCase(),
      name: newClass.name,
      description: newClass.description || null,
      sort_order: Number(newClass.sort_order) || 99,
      is_active: true,
    }), 'Class added.')
    if (ok) { setNewClass({ ...BLANK_CLASS }); setAdding(false) }
  }

  async function createExtra(e: React.FormEvent) {
    e.preventDefault()
    const ok = await call(`${API}/extras`, json({
      code: newExtra.code.toUpperCase(),
      name: newExtra.name,
      extra_type: newExtra.extra_type,
      pricing_type: newExtra.pricing_type,
      default_price: Number(newExtra.default_price) || 0,
      is_active: true,
    }), 'Extra added.')
    if (ok) { setNewExtra({ ...BLANK_EXTRA }); setAdding(false) }
  }

  async function savePrice(x: Extra) {
    const raw = priceDraft[x.extra_id]
    if (raw === undefined || raw.trim() === '') return
    const price = Number(raw)
    if (!Number.isFinite(price) || price < 0) { setError('That is not a price.'); return }
    if (await call(`${API}/extras/${x.extra_id}`, json({ default_price: price }, 'PATCH'), 'Price saved.')) {
      setPriceDraft((d) => { const n = { ...d }; delete n[x.extra_id]; return n })
    }
  }

  async function removeClass(c: VehicleClass) {
    if (c.can_delete) {
      if (!window.confirm(`Delete the ${c.name} class?`)) return
      await call(`${API}/vehicle-classes/${c.class_id}`, { method: 'DELETE' }, 'Class deleted.')
    } else {
      // Not a delete dressed up. The server would refuse, and saying so before
      // the click is better than a red banner after it.
      if (!window.confirm(
        `${c.vehicle_count} vehicle${c.vehicle_count === 1 ? ' is' : 's are'} still in ` +
        `the ${c.name} class, so it cannot be deleted.\n\n` +
        'Hide it instead? It stops appearing on new bookings and existing ' +
        'rentals are untouched.'
      )) return
      await call(`${API}/vehicle-classes/${c.class_id}`, json({ is_active: false }, 'PATCH'), 'Class hidden.')
    }
  }

  const unpriced = (extras ?? []).filter((x) => x.default_price === null || x.default_price === 0)

  const field = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const fs = { background: 'var(--page-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }
  const card = { background: 'var(--card-bg)', border: '1px solid var(--border)' }

  if (!classes || !extras) {
    return <div className="p-8 text-sm" style={{ color: 'var(--text-3)' }}>{error || 'Loading…'}</div>
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Catalogue</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
            The vehicle classes you rent, and the extras you sell alongside them.
          </p>
        </div>
        <button onClick={() => setAdding((v) => !v)} disabled={busy}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
          {adding ? 'Cancel' : tab === 'classes' ? 'New class' : 'New extra'}
        </button>
      </header>

      <div className="mt-5 flex gap-1 rounded-lg p-1" style={{ background: 'var(--card-bg)' }}>
        {(['classes', 'extras'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setAdding(false) }}
                  className="flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize"
                  style={tab === t
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--text-3)' }}>
            {t} ({t === 'classes' ? classes.length : extras.length})
          </button>
        ))}
      </div>

      {notice && <p className="mt-4 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {tab === 'extras' && unpriced.length > 0 && (
        <p className="mt-4 rounded-lg px-3 py-2 text-xs"
           style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
          {unpriced.length} extra{unpriced.length === 1 ? ' has' : 's have'} no price.
          An unpriced extra cannot be added to a booking, so it is invisible to
          your customers and to the counter.
        </p>
      )}

      {adding && tab === 'classes' && (
        <form onSubmit={createClass} className="mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-4" style={card}>
          <label className="text-xs sm:col-span-1" style={{ color: 'var(--text-3)' }}>
            SIPP letter
            <input required maxLength={1} value={newClass.sipp_prefix}
                   onChange={(e) => setNewClass({ ...newClass, sipp_prefix: e.target.value.toUpperCase() })}
                   placeholder="C" className={`${field} mt-1 font-mono uppercase`} style={fs} />
          </label>
          <label className="text-xs sm:col-span-2" style={{ color: 'var(--text-3)' }}>
            Name
            <input required value={newClass.name}
                   onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                   placeholder="Compact" className={`${field} mt-1`} style={fs} />
          </label>
          <label className="text-xs sm:col-span-1" style={{ color: 'var(--text-3)' }}>
            Order
            <input type="number" value={newClass.sort_order}
                   onChange={(e) => setNewClass({ ...newClass, sort_order: e.target.value })}
                   className={`${field} mt-1`} style={fs} />
          </label>
          <label className="text-xs sm:col-span-4" style={{ color: 'var(--text-3)' }}>
            Description
            <input value={newClass.description}
                   onChange={(e) => setNewClass({ ...newClass, description: e.target.value })}
                   placeholder="Four doors, small boot, good on fuel."
                   className={`${field} mt-1`} style={fs} />
          </label>
          <div className="sm:col-span-4">
            <button type="submit" disabled={busy}
                    className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}>Add class</button>
          </div>
        </form>
      )}

      {adding && tab === 'extras' && (
        <form onSubmit={createExtra} className="mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-3" style={card}>
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>
            Code
            <input required maxLength={20} value={newExtra.code}
                   onChange={(e) => setNewExtra({ ...newExtra, code: e.target.value.toUpperCase() })}
                   placeholder="GPS" className={`${field} mt-1 font-mono uppercase`} style={fs} />
          </label>
          <label className="text-xs sm:col-span-2" style={{ color: 'var(--text-3)' }}>
            Name
            <input required value={newExtra.name}
                   onChange={(e) => setNewExtra({ ...newExtra, name: e.target.value })}
                   placeholder="Satellite navigation" className={`${field} mt-1`} style={fs} />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>
            Type
            <select value={newExtra.extra_type}
                    onChange={(e) => setNewExtra({ ...newExtra, extra_type: e.target.value })}
                    className={`${field} mt-1`} style={fs}>
              {EXTRA_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
            </select>
          </label>
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>
            Charged
            <select value={newExtra.pricing_type}
                    onChange={(e) => setNewExtra({ ...newExtra, pricing_type: e.target.value })}
                    className={`${field} mt-1`} style={fs}>
              {PRICING.map((t) => <option key={t} value={t}>{t.replace('_', ' ').toLowerCase()}</option>)}
            </select>
          </label>
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>
            Price
            <input required type="number" min={0} step="0.01" value={newExtra.default_price}
                   onChange={(e) => setNewExtra({ ...newExtra, default_price: e.target.value })}
                   className={`${field} mt-1`} style={fs} />
          </label>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy}
                    className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}>Add extra</button>
          </div>
        </form>
      )}

      {tab === 'classes' && (
        <div className="mt-4 space-y-2">
          {classes.map((c) => (
            <div key={c.class_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
                 style={{ ...card, opacity: c.is_active ? 1 : 0.55 }}>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg font-mono text-sm font-bold"
                      style={{ background: 'var(--accent-sub)', color: 'var(--accent)' }}>
                  {c.sipp_prefix}
                </span>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                    {c.name}{!c.is_active && <span className="ml-2 text-xs" style={{ color: 'var(--text-3)' }}>hidden</span>}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {c.vehicle_count} vehicle{c.vehicle_count === 1 ? '' : 's'} · {c.reservation_count} booking{c.reservation_count === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button disabled={busy}
                        onClick={() => void call(`${API}/vehicle-classes/${c.class_id}`,
                          json({ is_active: !c.is_active }, 'PATCH'),
                          c.is_active ? 'Hidden from new bookings.' : 'Visible again.')}
                        className="rounded-lg px-2.5 py-1 text-xs disabled:opacity-40"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  {c.is_active ? 'Hide' : 'Show'}
                </button>
                <button disabled={busy} onClick={() => void removeClass(c)}
                        title={c.can_delete ? 'Remove this class' : `${c.vehicle_count} vehicles still use it`}
                        className="rounded-lg px-2.5 py-1 text-xs text-red-300 disabled:opacity-40"
                        style={{ border: '1px solid rgba(176,52,31,0.5)' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'extras' && (
        <div className="mt-4 space-y-2">
          {extras.map((x) => {
            const draft = priceDraft[x.extra_id]
            const missing = x.default_price === null || x.default_price === 0
            return (
              <div key={x.extra_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
                   style={{ ...card, opacity: x.is_active ? 1 : 0.55 }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                    {x.name}
                    <span className="ml-2 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{x.code}</span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {(x.extra_type ?? '').toLowerCase()} · {(x.pricing_type ?? '').replace('_', ' ').toLowerCase()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0} step="0.01"
                    value={draft ?? (x.default_price ?? '')}
                    onChange={(e) => setPriceDraft({ ...priceDraft, [x.extra_id]: e.target.value })}
                    onBlur={() => void savePrice(x)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void savePrice(x) }}
                    placeholder="no price"
                    className="w-24 rounded-lg px-2 py-1 text-right font-mono text-sm tabular-nums outline-none"
                    style={{ ...fs, borderColor: missing ? '#f59e0b' : 'var(--border)' }}
                  />
                  <button disabled={busy}
                          onClick={() => void call(`${API}/extras/${x.extra_id}`,
                            json({ is_active: !x.is_active }, 'PATCH'),
                            x.is_active ? 'Hidden.' : 'Visible again.')}
                          className="rounded-lg px-2.5 py-1 text-xs disabled:opacity-40"
                          style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {x.is_active ? 'Hide' : 'Show'}
                  </button>
                  <button disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Delete ${x.name}?`))
                              void call(`${API}/extras/${x.extra_id}`, { method: 'DELETE' }, 'Deleted.')
                          }}
                          className="rounded-lg px-2.5 py-1 text-xs text-red-300 disabled:opacity-40"
                          style={{ border: '1px solid rgba(176,52,31,0.5)' }}>
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
