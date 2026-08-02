import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Pricing — what this workspace charges.
 *
 * This page previously rendered two hardcoded arrays and made no network calls,
 * so an operator could not set a price at all. The /pricing API has been
 * complete the whole time — eleven working routes — with nothing wired to it.
 *
 * It is deliberately a price GRID rather than a rate-code wizard. The API
 * supports market segments, blackout dates, day-of-week modifiers, advance
 * booking windows and driver-age rules — a model built for an airport counter
 * with a revenue manager. The operator this product serves prices a handful of
 * car types per day with a weekly and monthly discount, and that fits on one
 * screen. The richer fields remain available through the API; they are not what
 * a new workspace should meet first.
 */

// ── Types (mirroring the API responses) ──────────────────────────────────────

interface RateCode {
  rate_code_id: string
  code: string
  description: string
  rate_type: string
  currency: string
  status: string
}

interface ScheduleItem {
  item_id: string
  vehicle_class_id: string
  days_min: number
  price_per_day: string
  price_per_week: string | null
  price_per_month: string | null
  free_miles_per_day: number | null
  overage_rate_per_mile: string | null
}

interface VehicleClass {
  class_id: string
  sipp_prefix: string
  name: string
  is_active: boolean
}

interface Extra {
  extra_id: string
  code: string
  name: string
  extra_type: string | null
  pricing_type: string | null
  default_price: number | null
  is_active: boolean
}

// ── Data access ──────────────────────────────────────────────────────────────

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(await errorText(res))
  return res.json()
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await errorText(res))
  return res.status === 204 ? ({} as T) : res.json()
}

/** Surface the API's own message — those are written for the operator. */
async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const d = body?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg)
  } catch {
    /* fall through to the status code */
  }
  return `Request failed (${res.status})`
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function PricingPage() {
  const qc = useQueryClient()
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')

  const { data: rateCodes = [], isLoading: loadingCodes, error: codesError } =
    useQuery<RateCode[]>({
      queryKey: ['rate-codes'],
      queryFn: () => getJSON<RateCode[]>('/api/v1/pricing/rate-codes'),
      staleTime: 60_000,
    })

  const { data: classes = [] } = useQuery<VehicleClass[]>({
    queryKey: ['vehicle-classes'],
    queryFn: () => getJSON<VehicleClass[]>('/api/v1/catalogue/vehicle-classes'),
    staleTime: 300_000,
  })

  // Default to the workspace's rack rate — the one provisioning creates and the
  // one the storefront quotes from.
  //
  // Match on `code` before `rate_type`: rate_type is not unique, and in seeded
  // data a code named WEEKLY also carries rate_type RACK. Matching on type
  // alone landed on that one — which has no schedule items — so the page opened
  // claiming every car type was unpriced while the real rack rate held 46 rows.
  const [activeCodeId, setActiveCodeId] = useState('')
  useEffect(() => {
    if (!activeCodeId && rateCodes.length) {
      const rack =
        rateCodes.find((r) => r.code.toUpperCase() === 'RACK') ??
        rateCodes.find((r) => r.rate_type === 'RACK') ??
        rateCodes[0]
      setActiveCodeId(rack.rate_code_id)
    }
  }, [rateCodes, activeCodeId])

  const activeCode = rateCodes.find((r) => r.rate_code_id === activeCodeId)

  const { data: schedule = [], isLoading: loadingSchedule } = useQuery<ScheduleItem[]>({
    queryKey: ['rate-schedule', activeCodeId],
    queryFn: () =>
      getJSON<ScheduleItem[]>(`/api/v1/pricing/rate-codes/${activeCodeId}/schedule`),
    enabled: Boolean(activeCodeId),
  })

  const { data: extras = [] } = useQuery<Extra[]>({
    queryKey: ['extras'],
    queryFn: () => getJSON<Extra[]>('/api/v1/catalogue/extras'),
    staleTime: 300_000,
  })

  const savePrice = useMutation({
    mutationFn: (row: PriceDraft) =>
      send(`/api/v1/pricing/rate-codes/${activeCodeId}/schedule`, 'POST', {
        vehicle_class_id: row.classId,
        days_min: 1,
        price_per_day: row.perDay,
        price_per_week: row.perWeek || null,
        price_per_month: row.perMonth || null,
        free_miles_per_day: row.freeMiles === '' ? null : Number(row.freeMiles),
        overage_rate_per_mile: row.overage || null,
      }),
    onSuccess: (_data, row) => {
      setProblem('')
      setNotice(`Saved ${row.className}.`)
      qc.invalidateQueries({ queryKey: ['rate-schedule', activeCodeId] })
    },
    onError: (e: Error) => { setNotice(''); setProblem(e.message) },
  })

  const saveExtra = useMutation({
    mutationFn: (x: Extra) =>
      send(`/api/v1/catalogue/extras/${x.extra_id}`, 'PATCH', {
        code: x.code,
        name: x.name,
        extra_type: x.extra_type ?? 'EQUIPMENT',
        pricing_type: x.pricing_type ?? 'PER_DAY',
        default_price: x.default_price ?? 0,
        is_active: x.is_active,
      }),
    onSuccess: (_data, x) => {
      setProblem('')
      setNotice(`Saved ${x.name}.`)
      qc.invalidateQueries({ queryKey: ['extras'] })
    },
    onError: (e: Error) => { setNotice(''); setProblem(e.message) },
  })

  // One editable row per active class, pre-filled from the schedule. Classes
  // with no price still get a row — that is the point: a class with no schedule
  // item is invisible to the quote engine, and today the operator has no way to
  // discover why a car type never appears on their site.
  const rows: PriceDraft[] = useMemo(() => {
    // A rate code can hold several duration bands per class (1-7 days at one
    // price, 8+ at another). The row shows the BASE band — the lowest days_min
    // — because that is what "per day" means to an operator and what a one-day
    // hire is quoted at.
    //
    // Picking arbitrarily is not harmless: the first version of this took
    // whichever band the map happened to keep last, so it displayed the 8-day
    // discount rate (29.99) under a column headed "Per day" while a one-day
    // hire actually quoted 39.99.
    const byClass = new Map<string, ScheduleItem>()
    for (const s of schedule) {
      const held = byClass.get(s.vehicle_class_id)
      if (!held || s.days_min < held.days_min) byClass.set(s.vehicle_class_id, s)
    }
    const bandCount = new Map<string, number>()
    for (const s of schedule) {
      bandCount.set(s.vehicle_class_id, (bandCount.get(s.vehicle_class_id) ?? 0) + 1)
    }
    return classes
      .filter((c) => c.is_active)
      .map((c) => {
        const s = byClass.get(c.class_id)
        const dec = (v: string | null | undefined) =>
          v == null || v === '' ? '' : Number(v).toFixed(2)
        return {
          classId: c.class_id,
          className: c.name,
          sipp: c.sipp_prefix,
          perDay: dec(s?.price_per_day),
          perWeek: dec(s?.price_per_week),
          perMonth: dec(s?.price_per_month),
          freeMiles: s?.free_miles_per_day == null ? '' : String(s.free_miles_per_day),
          overage: dec(s?.overage_rate_per_mile),
          priced: Boolean(s),
          extraBands: Math.max(0, (bandCount.get(c.class_id) ?? 0) - 1),
        }
      })
  }, [classes, schedule])

  const unpriced = rows.filter((r) => !r.priced).length

  if (codesError) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <Banner kind="error">
          Could not load your pricing. {(codesError as Error).message}
        </Banner>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Pricing
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">What you charge</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">
          A daily price per car type, and optionally a weekly or monthly price for
          longer hires. These are the numbers your booking site quotes.
        </p>
      </header>

      {notice && <Banner kind="ok">{notice}</Banner>}
      {problem && <Banner kind="error">{problem}</Banner>}

      {unpriced > 0 && (
        <Banner kind="warn">
          {unpriced} car {unpriced === 1 ? 'type has' : 'types have'} no price yet.
          Customers cannot book {unpriced === 1 ? 'it' : 'them'} until you set one.
        </Banner>
      )}

      {/* Shown only when there is a genuine choice to make. */}
      {rateCodes.length > 1 && (
        <div className="mt-6 flex items-center gap-3">
          <label htmlFor="ratecode" className="text-sm text-slate-400">Rate</label>
          <select
            id="ratecode"
            value={activeCodeId}
            onChange={(e) => setActiveCodeId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            {rateCodes.map((r) => (
              <option key={r.rate_code_id} value={r.rate_code_id}>
                {r.code} — {r.description}
              </option>
            ))}
          </select>
        </div>
      )}

      <Section
        title="Daily rates"
        description={activeCode ? `${activeCode.code} · ${activeCode.currency}` : undefined}
      >
        {loadingCodes || loadingSchedule ? (
          <p className="px-5 py-6 text-sm text-slate-400">Loading your prices…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">
            No car types yet. Add them under Fleet, then set their prices here.
          </p>
        ) : (
          <PriceTable
            rows={rows}
            currency={activeCode?.currency ?? 'USD'}
            saving={savePrice.isPending}
            onSave={(r) => savePrice.mutate(r)}
          />
        )}
      </Section>

      <Section title="Extras" description="Add-ons offered at booking and at the counter.">
        {extras.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">No extras yet.</p>
        ) : (
          <ExtrasTable
            extras={extras}
            saving={saveExtra.isPending}
            onSave={(x) => saveExtra.mutate(x)}
          />
        )}
      </Section>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

interface PriceDraft {
  classId: string
  className: string
  sipp: string
  perDay: string
  perWeek: string
  perMonth: string
  freeMiles: string
  overage: string
  priced: boolean
  /** Additional duration bands beyond the base one, if any. */
  extraBands: number
}

function PriceTable({
  rows, currency, saving, onSave,
}: {
  rows: PriceDraft[]
  currency: string
  saving: boolean
  onSave: (r: PriceDraft) => void
}) {
  const [draft, setDraft] = useState<Record<string, PriceDraft>>({})

  // Re-seed from the server without clobbering an edit in progress.
  useEffect(() => {
    setDraft((d) => {
      const next = { ...d }
      for (const r of rows) if (!next[r.classId]) next[r.classId] = r
      return next
    })
  }, [rows])

  const set = (id: string, field: keyof PriceDraft, value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...(d[id]), [field]: value } as PriceDraft }))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="px-4 py-3">Car type</th>
            <th className="px-4 py-3">Per day ({currency})</th>
            <th className="px-4 py-3">Per week</th>
            <th className="px-4 py-3">Per month</th>
            <th className="px-4 py-3">Free miles/day</th>
            <th className="px-4 py-3">Over-mileage</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = draft[r.classId] ?? r
            const dirty =
              d.perDay !== r.perDay || d.perWeek !== r.perWeek ||
              d.perMonth !== r.perMonth || d.freeMiles !== r.freeMiles ||
              d.overage !== r.overage
            const valid = d.perDay !== '' && Number(d.perDay) > 0
            return (
              <tr key={r.classId} className="border-t border-slate-800">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{r.className}</div>
                  <div className="text-xs text-slate-500">
                    {r.sipp}
                    {!r.priced && (
                      <span className="ml-2 font-semibold text-amber-400">not priced</span>
                    )}
                    {r.extraBands > 0 && (
                      <span className="ml-2 text-slate-400">
                        +{r.extraBands} longer-hire {r.extraBands === 1 ? 'band' : 'bands'}
                      </span>
                    )}
                  </div>
                </td>
                <Cell value={d.perDay} onChange={(v) => set(r.classId, 'perDay', v)} required />
                <Cell value={d.perWeek} onChange={(v) => set(r.classId, 'perWeek', v)} />
                <Cell value={d.perMonth} onChange={(v) => set(r.classId, 'perMonth', v)} />
                <Cell value={d.freeMiles} onChange={(v) => set(r.classId, 'freeMiles', v)} step="1" />
                <Cell value={d.overage} onChange={(v) => set(r.classId, 'overage', v)} />
                <td className="px-4 py-3">
                  <button
                    onClick={() => onSave(d)}
                    disabled={!dirty || !valid || saving}
                    className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Cell({
  value, onChange, required = false, step = '0.01',
}: {
  value: string
  onChange: (v: string) => void
  required?: boolean
  step?: string
}) {
  return (
    <td className="px-4 py-3">
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={required ? 'required' : '—'}
        className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm tabular-nums text-white focus:border-indigo-500 focus:outline-none"
      />
    </td>
  )
}

function ExtrasTable({
  extras, saving, onSave,
}: {
  extras: Extra[]
  saving: boolean
  onSave: (x: Extra) => void
}) {
  const [draft, setDraft] = useState<Record<string, Extra>>({})
  useEffect(() => {
    setDraft((d) => {
      const next = { ...d }
      for (const x of extras) if (!next[x.extra_id]) next[x.extra_id] = x
      return next
    })
  }, [extras])

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
            <th className="px-4 py-3">Extra</th>
            <th className="px-4 py-3">Charged</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Offered</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {extras.map((x) => {
            const d = draft[x.extra_id] ?? x
            const dirty =
              d.default_price !== x.default_price || d.is_active !== x.is_active
            return (
              <tr key={x.extra_id} className="border-t border-slate-800">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{x.name}</div>
                  <div className="text-xs text-slate-500">{x.code}</div>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {(x.pricing_type ?? 'PER_DAY') === 'PER_DAY' ? 'per day' : 'per rental'}
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number" min="0" step="0.01"
                    value={d.default_price ?? ''}
                    onChange={(e) =>
                      setDraft((s) => ({
                        ...s,
                        [x.extra_id]: {
                          ...d,
                          default_price: e.target.value === '' ? null : Number(e.target.value),
                        },
                      }))
                    }
                    className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm tabular-nums text-white focus:border-indigo-500 focus:outline-none"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={d.is_active}
                    onChange={(e) =>
                      setDraft((s) => ({ ...s, [x.extra_id]: { ...d, is_active: e.target.checked } }))
                    }
                    className="h-4 w-4 accent-indigo-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onSave(d)}
                    disabled={!dirty || saving}
                    className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Section({
  title, description, children,
}: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Banner({ kind, children }: { kind: 'ok' | 'warn' | 'error'; children: ReactNode }) {
  const tone = {
    ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    error: 'border-red-500/30 bg-red-500/10 text-red-300',
  }[kind]
  return <div className={`mt-5 rounded-lg border px-4 py-3 text-sm ${tone}`}>{children}</div>
}

export default PricingPage
