import { tenantId } from '../tenant'
import { useState, useEffect, useCallback, type FormEvent } from 'react'

// ── API helper ────────────────────────────────────────────────────────────────
async function fetchJSON(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: {
      'X-Tenant-ID': tenantId(),
      'Content-Type': 'application/json',
      ...(opts?.headers ?? {}),
    },
    ...opts,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Domain types ──────────────────────────────────────────────────────────────
type RentalAgreement = {
  ra_id: string
  ra_number: string
  reservation_id: string | null
}

type Payment = {
  payment_id: string
  reservation_id: string | null
  rental_agreement_id: string | null
  payment_type: string
  status: string
  amount: string
  refunded_amount: string
  currency: string
  authorized_at: string | null
  captured_at: string | null
  refunded_at: string | null
  created_at: string
  // ra_number added client-side after joining
  ra_number?: string
}

type Customer = {
  customer_id: string; first_name: string; last_name: string; email: string
  phone: string | null; is_dnr: boolean; dnr_reason: string | null
  loyalty_tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | null
  loyalty_points: number; since: string
}

/**
 * The customers API, mapped to what this page renders.
 *
 * The list was seeded from a hardcoded INIT_CUSTOMERS array, so a tenant with
 * 629 real customers saw the same six invented people as an empty one — and
 * "adding" a customer only pushed onto local state, vanishing on refresh. The
 * /customers API has been complete throughout: nine routes including DNR and
 * GDPR erasure.
 *
 * total_rentals and lifetime_value are gone from this type. They were rendered
 * from the fake seed and have no field in the API; they are now derived from
 * the customer's actual reservations instead of being carried as data.
 */
interface ApiCustomer {
  customer_id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  dnr_flag: boolean | null
  loyalty_tier: string | null
  loyalty_points: number | null
  created_at: string | null
}

interface CustomerRental {
  reservation_id: string
  confirmation_number: string
  pickup_date: string | null
  return_date: string | null
  class_name: string | null
  status: string
  total: string | number | null
}

function fromApi(c: ApiCustomer): Customer {
  return {
    customer_id: c.customer_id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email ?? '',
    phone: c.phone,
    is_dnr: Boolean(c.dnr_flag),
    // The list endpoint does not carry the reason; it is kept locally after a
    // flag action and otherwise left blank rather than guessed.
    dnr_reason: null,
    loyalty_tier: (c.loyalty_tier || null) as Customer['loyalty_tier'],
    loyalty_points: c.loyalty_points ?? 0,
    since: (c.created_at ?? '').slice(0, 10),
  }
}

/** Prefer the API's own message — they are written for the operator. */
async function apiError(res: Response): Promise<string> {
  try {
    const b = await res.json()
    if (typeof b?.detail === 'string') return b.detail
    if (Array.isArray(b?.detail) && b.detail[0]?.msg) return String(b.detail[0].msg)
  } catch {
    /* fall through to the status */
  }
  return `Request failed (${res.status})`
}


const TIER: Record<string, { label: string; color: string; bg: string }> = {
  MEMBER:   { label:'Member',   color:'#94a3b8', bg:'rgba(148,163,184,0.10)' },
  BRONZE:   { label:'Bronze',   color:'#f59e0b', bg:'rgba(245,158,11,0.12)'  },
  SILVER:   { label:'Silver',   color:'#94a3b8', bg:'rgba(148,163,184,0.12)' },
  GOLD:     { label:'Gold',     color:'#fbbf24', bg:'rgba(251,191,36,0.12)'  },
  PLATINUM: { label:'Platinum', color:'#a78bfa', bg:'rgba(167,139,250,0.12)' },
}

/**
 * Tier styling for a value that may not be in the map.
 *
 * The hardcoded seed only ever used four tiers, so a bare TIER[x] lookup was
 * always safe. Real data has a fifth — MEMBER, held by 348 of this tenant's
 * customers — and the undefined lookup blanked the whole page. Unknown tiers now
 * render with their own name rather than crashing.
 */
function tierStyle(tier: string | null) {
  if (!tier) return null
  return TIER[tier] ?? {
    label: tier.charAt(0) + tier.slice(1).toLowerCase(),
    color: 'var(--text-3)',
    bg: 'var(--elevated)',
  }
}

const AVATAR_COLORS = ['#8b5cf6','#7c3aed','#0ea5e9','#10b981','#f47272','#f59e0b']
const avatarColor = (id: string) => AVATAR_COLORS[parseInt(id, 10) % AVATAR_COLORS.length]
const initials    = (f: string, l: string) => `${f[0] ?? '?'}${l[0] ?? ''}`.toUpperCase()



function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  )
}

const BLANK = { first_name:'', last_name:'', email:'', phone:'', loyalty_tier:'' }

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search,   setSearch]     = useState('')
  const [selected, setSelected]   = useState<Customer | null>(null)

  // Detail panel tab state
  const [detailTab, setDetailTab] = useState<'profile' | 'payments'>('profile')

  // Payment history state
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentsError,   setPaymentsError]   = useState<string | null>(null)
  const [customerPayments, setCustomerPayments] = useState<Payment[]>([])

  // Real rental history for the selected customer. The panel previously showed
  // a three-row RECENT constant — the same BMW and Toyota for every customer —
  // and derived Total Rentals and Lifetime Value from invented figures.
  const [rentals, setRentals] = useState<CustomerRental[]>([])
  const [rentalsLoading, setRentalsLoading] = useState(false)

  // Add modal
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState<typeof BLANK>(BLANK)
  const afi = (k: keyof typeof BLANK, v: string) => setAddForm(p => ({ ...p, [k]: v }))

  // Edit modal
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState<typeof BLANK>(BLANK)
  const efi = (k: keyof typeof BLANK, v: string) => setEditForm(p => ({ ...p, [k]: v }))

  // DNR flow
  const [showDnrModal, setShowDnrModal] = useState(false)
  const [dnrReason,    setDnrReason]    = useState('')
  const [confirmUnDnr, setConfirmUnDnr] = useState(false)

  // Fetch payments for the selected customer when payments tab is active
  useEffect(() => {
    if (!selected || detailTab !== 'payments') return
    let cancelled = false
    setPaymentsLoading(true)
    setPaymentsError(null)
    setCustomerPayments([]);

    (async () => {
      try {
        const agreements: RentalAgreement[] = await fetchJSON(
          `/checkout/agreements?customer_id=${selected.customer_id}`
        )
        const rasWithReservation = agreements.filter(ra => ra.reservation_id != null)
        if (rasWithReservation.length === 0) {
          if (!cancelled) { setCustomerPayments([]); setPaymentsLoading(false) }
          return
        }
        // Map reservation_id -> ra_number for display
        const resIdToRaNumber: Record<string, string> = {}
        for (const ra of rasWithReservation) {
          if (ra.reservation_id) resIdToRaNumber[ra.reservation_id] = ra.ra_number
        }
        // Fetch payments for all reservations in parallel
        const results = await Promise.allSettled(
          rasWithReservation.map(ra =>
            fetchJSON(`/payments/reservation/${ra.reservation_id}`) as Promise<Payment[]>
          )
        )
        if (cancelled) return
        const all: Payment[] = []
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            const raNumber = rasWithReservation[idx].ra_number
            r.value.forEach(p => all.push({ ...p, ra_number: raNumber }))
          }
        })
        // Sort by date descending
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setCustomerPayments(all)
        setPaymentsLoading(false)
      } catch (err) {
        if (!cancelled) {
          setPaymentsError(err instanceof Error ? err.message : 'Failed to load payments')
          setPaymentsLoading(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [selected?.customer_id, detailTab])

  const filtered = customers.filter(c => {
    if (!search) return true
    return `${c.first_name} ${c.last_name} ${c.email} ${c.phone ?? ''}`.toLowerCase().includes(search.toLowerCase())
  })

  const loadCustomers = useCallback(async (q: string) => {
    setListLoading(true); setListError(null)
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=50` : '?limit=50'
      const res = await fetch(`/api/v1/customers${qs}`, { credentials: 'include' })
      if (!res.ok) throw new Error(await apiError(res))
      setCustomers(((await res.json()) as ApiCustomer[]).map(fromApi))
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load customers.')
      setCustomers([])
    } finally { setListLoading(false) }
  }, [])

  useEffect(() => {
    // Debounced, and searched server-side: the endpoint does fulltext across
    // name, email, phone and licence, which beats filtering one page locally.
    const t = setTimeout(() => { void loadCustomers(search) }, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [search, loadCustomers])

  useEffect(() => {
    if (!selected?.email) { setRentals([]); return }
    let cancelled = false
    setRentalsLoading(true)
    fetch(`/api/v1/reservations/crm-list?search=${encodeURIComponent(selected.email)}&limit=50`,
          { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: CustomerRental[]) => { if (!cancelled) setRentals(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setRentals([]) })
      .finally(() => { if (!cancelled) setRentalsLoading(false) })
    return () => { cancelled = true }
  }, [selected?.email])

  const rentalCount = rentals.length
  const lifetimeValue = rentals.reduce((sum, r) => sum + Number(r.total ?? 0), 0)

  // Keeps selected in sync after edits
  const syncSelected = (updated: Customer) => {
    setCustomers(prev => prev.map(c => c.customer_id === updated.customer_id ? updated : c))
    setSelected(updated)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setListError(null)
    try {
      const res = await fetch('/api/v1/customers', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: addForm.first_name,
          last_name: addForm.last_name,
          email: addForm.email || null,
          phone: addForm.phone || null,
          loyalty_tier: addForm.loyalty_tier || null,
        }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      const created = fromApi((await res.json()) as ApiCustomer)
      setCustomers(prev => [created, ...prev])
      setSelected(created)
      setShowAdd(false)
      setAddForm(BLANK)
    } catch (err) {
      // This could not previously fail: it only mutated local state, so a
      // customer added here disappeared on the next refresh.
      setListError(err instanceof Error ? err.message : 'Could not add that customer.')
    }
  }

  function openEdit() {
    if (!selected) return
    setEditForm({
      first_name:    selected.first_name,
      last_name:     selected.last_name,
      email:         selected.email,
      phone:         selected.phone ?? '',
      loyalty_tier:  selected.loyalty_tier ?? '',
    })
    setShowEdit(true)
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setListError(null)
    try {
      const res = await fetch(`/api/v1/customers/${selected.customer_id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          email: editForm.email || null,
          phone: editForm.phone || null,
          loyalty_tier: editForm.loyalty_tier || null,
        }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      syncSelected(fromApi((await res.json()) as ApiCustomer))
      setShowEdit(false)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not save those changes.')
    }
  }

  async function handleFlagDnr(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    setListError(null)
    try {
      const res = await fetch(`/api/v1/customers/${selected.customer_id}/dnr`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: dnrReason, scope: 'TENANT' }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      // Keep the reason locally: the customer response does not echo it and the
      // panel shows it immediately after flagging.
      syncSelected({ ...fromApi((await res.json()) as ApiCustomer), dnr_reason: dnrReason })
      setShowDnrModal(false)
      setDnrReason('')
    } catch (err) {
      // Do-not-rent is what stops a car going to someone who already damaged
      // one. Failing silently here is worse than not offering the button.
      setListError(err instanceof Error ? err.message : 'Could not flag that customer.')
    }
  }

  async function handleRemoveDnr() {
    if (!selected) return
    setListError(null)
    try {
      const res = await fetch(`/api/v1/customers/${selected.customer_id}/dnr`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!res.ok) throw new Error(await apiError(res))
      syncSelected({ ...fromApi((await res.json()) as ApiCustomer), dnr_reason: null })
      setConfirmUnDnr(false)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not clear that flag.')
    }
  }

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 112px)' }}>

      {/* ── Left panel ── */}
      <div className={`flex flex-col gap-4 transition-all duration-200 ${selected ? 'w-72 shrink-0' : 'w-full'}`}>
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Customers</h1>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {!selected && 'Add Customer'}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="search" placeholder="Search name, email, phone…" value={search}
            onChange={e => setSearch(e.target.value)} className="field-input h-9 pl-8 text-[13px]" />
        </div>

        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          {filtered.length} customer{filtered.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ''}
        </p>

        {/* List */}
        <div className="flex-1 space-y-2 overflow-auto">
            {listError && (
              <div className="panel px-4 py-3" style={{ borderColor: 'var(--danger)' }}>
                <p className="text-[13px]" style={{ color: 'var(--danger)' }}>{listError}</p>
                <button onClick={() => void loadCustomers(search)} className="mt-1 text-[12px] font-medium"
                        style={{ color: 'var(--accent)' }}>Try again</button>
              </div>
            )}
            {listLoading ? (
              <div className="panel flex flex-col items-center justify-center py-12 text-center" style={{ borderStyle: 'dashed' }}>
                <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading customers…</p>
              </div>
            ) : filtered.length === 0 ? (
            <div className="panel flex flex-col items-center justify-center py-12 text-center" style={{ borderStyle: 'dashed' }}>
              <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No customers found</p>
              {search && <button onClick={() => setSearch('')} className="mt-2 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>Clear search</button>}
            </div>
          ) : filtered.map(c => (
            <button
              key={c.customer_id}
              onClick={() => { setSelected(c); setConfirmUnDnr(false); setDetailTab('profile') }}
              className="w-full rounded-lg p-3.5 text-left transition-colors"
              style={{
                background: selected?.customer_id === c.customer_id ? 'var(--accent-sub)' : 'var(--card-bg)',
                border: `1px solid ${selected?.customer_id === c.customer_id ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                     style={{ background: avatarColor(c.customer_id) }}>
                  {initials(c.first_name, c.last_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>{c.first_name} {c.last_name}</p>
                    {c.is_dnr && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>DNR</span>}
                  </div>
                  <p className="text-[12px] truncate" style={{ color: 'var(--text-3)' }}>{c.email}</p>
                </div>
                {c.loyalty_tier && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: tierStyle(c.loyalty_tier)!.bg, color: tierStyle(c.loyalty_tier)!.color }}>
                    {tierStyle(c.loyalty_tier)!.label}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selected && (
        <div className="flex-1 panel overflow-auto">
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex gap-1">
              {(['profile', 'payments'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className="px-3 py-1.5 rounded-md text-[12.5px] font-medium capitalize transition-colors"
                  style={{
                    background: detailTab === tab ? 'var(--accent-sub)' : 'transparent',
                    color: detailTab === tab ? 'var(--accent)' : 'var(--text-3)',
                    border: detailTab === tab ? '1px solid var(--accent)' : '1px solid transparent',
                  }}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            <CloseBtn onClick={() => { setSelected(null); setConfirmUnDnr(false); setDetailTab('profile') }} />
          </div>

          {/* ── Profile tab ── */}
          {detailTab === 'profile' && (
            <div className="p-5 space-y-5">
              {/* Header */}
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                     style={{ background: avatarColor(selected.customer_id) }}>
                  {initials(selected.first_name, selected.last_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>{selected.first_name} {selected.last_name}</h2>
                    {selected.is_dnr && <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>DO NOT RENT</span>}
                    {selected.loyalty_tier && (
                      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                            style={{ background: tierStyle(selected.loyalty_tier)!.bg, color: tierStyle(selected.loyalty_tier)!.color }}>
                        {tierStyle(selected.loyalty_tier)!.label}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-2)' }}>{selected.email}</p>
                  <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{selected.phone ?? 'No phone on file'}</p>
                  <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                    Customer since {new Date(selected.since).toLocaleDateString('en-US', { month:'long', year:'numeric' })}
                  </p>
                </div>
              </div>

              {/* DNR alert */}
              {selected.is_dnr && selected.dnr_reason && (
                <div className="flex items-start gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                  <svg className="mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--danger)' }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <div>
                    <p className="text-[12.5px] font-semibold" style={{ color: 'var(--danger)' }}>Do Not Rent Flag Active</p>
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>{selected.dnr_reason}</p>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label:'Total Rentals',  value: rentalsLoading ? '—' : String(rentalCount) },
                  { label:'Loyalty Points', value: selected.loyalty_points.toLocaleString() },
                  { label:'Lifetime Value', value: rentalsLoading ? '—' : `$${lifetimeValue.toLocaleString('en-US', { minimumFractionDigits:2 })}` },
                ].map(s => (
                  <div key={s.label} className="rounded-lg px-3 py-3 text-center" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                    <p className="text-[18px] font-bold num" style={{ color: 'var(--text-1)' }}>{s.value}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Recent rentals */}
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Recent Rentals</p>
                <div className="space-y-2">
                  {rentalsLoading ? (
                    <p className="text-[13px] py-4 text-center" style={{ color: 'var(--text-3)' }}>Loading…</p>
                  ) : rentalCount === 0 ? (
                    <p className="text-[13px] py-4 text-center" style={{ color: 'var(--text-3)' }}>No rental history</p>
                  ) : rentals.slice(0, 3).map(r => (
                    <div key={r.reservation_id} className="flex items-center justify-between rounded-lg px-4 py-3"
                         style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }}>{r.confirmation_number}</p>
                        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {[r.pickup_date, r.return_date].filter(Boolean).join(' – ') || '—'}{r.class_name ? ` · ${r.class_name}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>
                          ${Number(r.total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                        <p className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--text-3)' }}>{r.status}</p>
                      </div>
                    </div>
                  ))}
                  {rentalCount > 3 && (
                    <button className="w-full rounded-lg py-2 text-[12px] font-medium transition-colors"
                            style={{ border: '1px solid var(--border)', color: 'var(--text-3)' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                      View all {rentalCount} rentals
                    </button>
                  )}
                </div>
              </div>

              {/* Remove DNR confirm */}
              {selected.is_dnr && confirmUnDnr && (
                <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--warn-bg)', border: '1px solid rgba(251,191,36,0.25)' }}>
                  <p className="text-[12px] font-medium" style={{ color: 'var(--warn)' }}>Remove Do Not Rent flag?</p>
                  <div className="flex gap-2">
                    <button className="flex-1 btn-secondary py-1.5 text-[12px]" onClick={() => setConfirmUnDnr(false)}>Keep Flag</button>
                    <button className="flex-1 btn-secondary py-1.5 text-[12px]"
                            style={{ borderColor: 'rgba(251,191,36,0.4)', color: 'var(--warn)' }}
                            onClick={handleRemoveDnr}>Remove DNR</button>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <a href="/reservations" className="btn-primary flex-1 justify-center">New Reservation</a>
                <button className="btn-secondary" onClick={openEdit}>Edit Profile</button>
                {selected.is_dnr ? (
                  <button className="btn-secondary" onClick={() => setConfirmUnDnr(true)}>Remove DNR</button>
                ) : (
                  <button className="btn-secondary" style={{ borderColor: 'rgba(244,114,114,0.3)', color: 'var(--danger)' }}
                          onClick={() => { setShowDnrModal(true); setDnrReason('') }}>
                    Flag DNR
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Payments tab ── */}
          {detailTab === 'payments' && (
            <div className="p-5 space-y-5">
              {paymentsLoading && (
                <div className="flex items-center justify-center py-12">
                  <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading payment history...</p>
                </div>
              )}

              {!paymentsLoading && paymentsError && (
                <div className="rounded-lg px-4 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                  <p className="text-[12.5px] font-semibold" style={{ color: 'var(--danger)' }}>Failed to load payments</p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>{paymentsError}</p>
                </div>
              )}

              {!paymentsLoading && !paymentsError && customerPayments.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg"
                     style={{ border: '1px dashed var(--border)' }}>
                  <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No payment history for this customer</p>
                </div>
              )}

              {!paymentsLoading && !paymentsError && customerPayments.length > 0 && (() => {
                const totalPaid    = customerPayments.filter(p => p.status === 'CAPTURED' || p.status === 'PARTIALLY_CAPTURED').reduce((s, p) => s + Number(p.amount), 0)
                const totalPending = customerPayments.filter(p => p.status === 'AUTHORIZED').reduce((s, p) => s + Number(p.amount), 0)
                const totalRefund  = customerPayments.filter(p => p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED').reduce((s, p) => s + Number(p.refunded_amount), 0)
                const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

                const TYPE_LABEL: Record<string, string> = {
                  PREAUTH: 'Authorization',
                  CAPTURE: 'Capture',
                  INCREMENTAL_AUTH: 'Incr. Auth',
                  REFUND: 'Refund',
                  VOID: 'Void',
                  CHARGEBACK: 'Chargeback',
                  CHARGEBACK_REVERSAL: 'CB Reversal',
                }

                const STATUS_COLOR: Record<string, { color: string; bg: string }> = {
                  AUTHORIZED:          { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
                  CAPTURED:            { color: 'var(--success)', bg: 'rgba(16,185,129,0.12)' },
                  PARTIALLY_CAPTURED:  { color: 'var(--success)', bg: 'rgba(16,185,129,0.12)' },
                  REFUNDED:            { color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' },
                  PARTIALLY_REFUNDED:  { color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' },
                  FAILED:              { color: 'var(--danger)', bg: 'var(--danger-bg)' },
                  VOIDED:              { color: 'var(--text-3)', bg: 'rgba(100,116,139,0.12)' },
                  DECLINED:            { color: 'var(--danger)', bg: 'var(--danger-bg)' },
                  PENDING:             { color: 'var(--text-3)', bg: 'rgba(100,116,139,0.12)' },
                }

                return (
                  <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Total Paid',    value: fmt(totalPaid),    color: 'var(--success)' },
                        { label: 'Pending Auth',  value: fmt(totalPending), color: '#f59e0b' },
                        { label: 'Total Refunded',value: fmt(totalRefund),  color: '#0ea5e9' },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg px-3 py-3 text-center"
                             style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                          <p className="text-[15px] font-bold num" style={{ color: s.color }}>{s.value}</p>
                          <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Payment timeline */}
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Payment Timeline</p>
                      <div className="space-y-2">
                        {customerPayments.map(p => {
                          const sc = STATUS_COLOR[p.status] ?? { color: 'var(--text-3)', bg: 'rgba(100,116,139,0.12)' }
                          const dateStr = new Date(p.authorized_at ?? p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          const isAwaitingCapture = p.status === 'AUTHORIZED'
                          return (
                            <div key={p.payment_id} className="rounded-lg px-4 py-3 space-y-1.5"
                                 style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                                      {TYPE_LABEL[p.payment_type] ?? p.payment_type}
                                    </p>
                                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                          style={{ background: sc.bg, color: sc.color }}>
                                      {p.status.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                  <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{dateStr}</p>
                                  {p.ra_number && (
                                    <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--accent)' }}>{p.ra_number}</p>
                                  )}
                                </div>
                                <p className="text-[14px] font-bold num shrink-0" style={{ color: 'var(--text-1)' }}>
                                  {p.payment_type === 'REFUND' ? '-' : ''}{fmt(Number(p.amount))}
                                </p>
                              </div>
                              {isAwaitingCapture && (
                                <p className="text-[11px] font-medium" style={{ color: '#f59e0b' }}>
                                  Awaiting capture at return
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Add Customer Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) { setShowAdd(false); setAddForm(BLANK) } }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Add Customer</h2>
              <CloseBtn onClick={() => { setShowAdd(false); setAddForm(BLANK) }} />
            </div>
            <form onSubmit={handleAdd} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>First Name</ModalLabel>
                  <input required type="text" placeholder="Jane"
                    value={addForm.first_name} onChange={e => afi('first_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Last Name</ModalLabel>
                  <input required type="text" placeholder="Smith"
                    value={addForm.last_name} onChange={e => afi('last_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div>
                <ModalLabel>Email Address</ModalLabel>
                <input required type="email" placeholder="jane@example.com"
                  value={addForm.email} onChange={e => afi('email', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Phone <span style={{ fontWeight:400 }}>(optional)</span></ModalLabel>
                <input type="tel" placeholder="+1-555-0100"
                  value={addForm.phone} onChange={e => afi('phone', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Loyalty Tier <span style={{ fontWeight:400 }}>(optional)</span></ModalLabel>
                <select value={addForm.loyalty_tier} onChange={e => afi('loyalty_tier', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="">None</option>
                  <option value="BRONZE">Bronze</option>
                  <option value="SILVER">Silver</option>
                  <option value="GOLD">Gold</option>
                  <option value="PLATINUM">Platinum</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => { setShowAdd(false); setAddForm(BLANK) }} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Add Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Profile Modal ── */}
      {showEdit && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowEdit(false) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Profile</h2>
              <CloseBtn onClick={() => setShowEdit(false)} />
            </div>
            <form onSubmit={handleEdit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>First Name</ModalLabel>
                  <input required type="text"
                    value={editForm.first_name} onChange={e => efi('first_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Last Name</ModalLabel>
                  <input required type="text"
                    value={editForm.last_name} onChange={e => efi('last_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div>
                <ModalLabel>Email Address</ModalLabel>
                <input required type="email"
                  value={editForm.email} onChange={e => efi('email', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Phone</ModalLabel>
                <input type="tel" placeholder="No phone on file"
                  value={editForm.phone} onChange={e => efi('phone', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Loyalty Tier</ModalLabel>
                <select value={editForm.loyalty_tier} onChange={e => efi('loyalty_tier', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="">None</option>
                  <option value="BRONZE">Bronze</option>
                  <option value="SILVER">Silver</option>
                  <option value="GOLD">Gold</option>
                  <option value="PLATINUM">Platinum</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowEdit(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Flag DNR Modal ── */}
      {showDnrModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowDnrModal(false) }}>
          <div className="panel w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--danger)' }}>Flag Do Not Rent</h2>
              <CloseBtn onClick={() => setShowDnrModal(false)} />
            </div>
            <form onSubmit={handleFlagDnr} className="px-6 py-5 space-y-4">
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{selected.first_name} {selected.last_name}</p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>{selected.email}</p>
              </div>
              <div>
                <ModalLabel>Reason for DNR flag</ModalLabel>
                <textarea required rows={3} placeholder="Describe the reason this customer should not be rented to…"
                  value={dnrReason} onChange={e => setDnrReason(e.target.value)}
                  className="field-input px-3 py-2 text-[13px] w-full resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowDnrModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" style={{ background: 'var(--danger)', boxShadow: 'none' }}>
                  Flag DNR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
