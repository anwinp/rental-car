import { useState, useEffect, type FormEvent } from 'react'

// ── API helper ────────────────────────────────────────────────────────────────
const TENANT = import.meta.env.VITE_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
async function fetchJSON(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: {
      'X-Tenant-ID': TENANT,
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
type PaymentTerms = 'NET_15' | 'NET_30' | 'NET_60'
type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING'

type BillingAddress = {
  line1: string
  line2?: string
  city: string
  state: string
  zip: string
  country: string
}

type CorporateAccount = {
  account_id: string
  company_name: string
  contact_name: string
  contact_email: string
  contact_phone: string
  credit_limit: number
  outstanding_balance: number
  payment_terms: PaymentTerms
  rate_code: string
  status: AccountStatus
  account_manager: string
  billing_address: BillingAddress
  member_since: string
}

type Reservation = {
  reservation_id: string
  confirmation_number: string
  customer_name: string
  pickup_date: string
  return_date: string
  class_name: string
  status: string
  total: number
}

type Invoice = {
  invoice_id: string
  invoice_number: string
  period: string
  amount: number
  status: 'PAID' | 'UNPAID' | 'OVERDUE'
  issued_date: string
  due_date: string
}

// ── Seed data (used when API returns no accounts) ────────────────────────────
// NOTE: The corporate API is currently a health-only stub. These are demo
// accounts shown until the /corporate CRUD endpoints are implemented.
const SEED_ACCOUNTS: CorporateAccount[] = [
  {
    account_id: 'c1',
    company_name: 'Acme Corporation',
    contact_name: 'Janet Reyes',
    contact_email: 'j.reyes@acme.com',
    contact_phone: '+1-555-0201',
    credit_limit: 25000,
    outstanding_balance: 8450.75,
    payment_terms: 'NET_30',
    rate_code: 'CORP-ACME',
    status: 'ACTIVE',
    account_manager: 'Sarah Thompson',
    billing_address: { line1: '1 Acme Plaza', city: 'Phoenix', state: 'AZ', zip: '85001', country: 'US' },
    member_since: '2022-03-01',
  },
  {
    account_id: 'c2',
    company_name: 'Globex Industries',
    contact_name: 'Marcus Webb',
    contact_email: 'm.webb@globex.com',
    contact_phone: '+1-555-0302',
    credit_limit: 50000,
    outstanding_balance: 42300.00,
    payment_terms: 'NET_60',
    rate_code: 'CORP-GLX',
    status: 'ACTIVE',
    account_manager: 'David Nguyen',
    billing_address: { line1: '500 Industrial Blvd', line2: 'Suite 200', city: 'Houston', state: 'TX', zip: '77001', country: 'US' },
    member_since: '2020-07-15',
  },
  {
    account_id: 'c3',
    company_name: 'Pinnacle Consulting',
    contact_name: 'Rachel Kim',
    contact_email: 'r.kim@pinnacle.co',
    contact_phone: '+1-555-0413',
    credit_limit: 15000,
    outstanding_balance: 14200.50,
    payment_terms: 'NET_30',
    rate_code: 'CORP-PIN',
    status: 'ACTIVE',
    account_manager: 'Sarah Thompson',
    billing_address: { line1: '88 Consulting Row', city: 'Chicago', state: 'IL', zip: '60601', country: 'US' },
    member_since: '2023-01-10',
  },
  {
    account_id: 'c4',
    company_name: 'Apex Logistics',
    contact_name: 'Tom Bradley',
    contact_email: 't.bradley@apexlog.com',
    contact_phone: '+1-555-0504',
    credit_limit: 10000,
    outstanding_balance: 0,
    payment_terms: 'NET_15',
    rate_code: 'CORP-APX',
    status: 'SUSPENDED',
    account_manager: 'David Nguyen',
    billing_address: { line1: '9 Freight Way', city: 'Memphis', state: 'TN', zip: '38101', country: 'US' },
    member_since: '2024-04-22',
  },
  {
    account_id: 'c5',
    company_name: 'SkyBridge Media',
    contact_name: 'Olivia Stern',
    contact_email: 'o.stern@skybridge.com',
    contact_phone: '+1-555-0615',
    credit_limit: 20000,
    outstanding_balance: 0,
    payment_terms: 'NET_30',
    rate_code: 'CORP-SKY',
    status: 'PENDING',
    account_manager: 'Sarah Thompson',
    billing_address: { line1: '77 Media Drive', city: 'Los Angeles', state: 'CA', zip: '90001', country: 'US' },
    member_since: '2026-05-30',
  },
]

const SEED_INVOICES: Invoice[] = [
  { invoice_id: 'i1', invoice_number: 'INV-2026-0047', period: 'May 2026',   amount: 4200.00, status: 'PAID',    issued_date: '2026-06-01', due_date: '2026-06-30' },
  { invoice_id: 'i2', invoice_number: 'INV-2026-0031', period: 'April 2026', amount: 3950.75, status: 'PAID',    issued_date: '2026-05-01', due_date: '2026-05-31' },
  { invoice_id: 'i3', invoice_number: 'INV-2026-0018', period: 'March 2026', amount: 300.00,  status: 'OVERDUE', issued_date: '2026-04-01', due_date: '2026-04-30' },
]

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<AccountStatus, { label: string; color: string; bg: string }> = {
  ACTIVE:    { label: 'Active',    color: 'var(--success)', bg: 'var(--success-bg)' },
  SUSPENDED: { label: 'Suspended', color: 'var(--danger)',  bg: 'var(--danger-bg)'  },
  PENDING:   { label: 'Pending',   color: 'var(--warn)',    bg: 'var(--warn-bg)'    },
}

const INVOICE_STATUS_CFG: Record<Invoice['status'], { color: string; bg: string }> = {
  PAID:    { color: 'var(--success)', bg: 'var(--success-bg)' },
  UNPAID:  { color: 'var(--warn)',    bg: 'var(--warn-bg)'    },
  OVERDUE: { color: 'var(--danger)',  bg: 'var(--danger-bg)'  },
}

const TERMS_LABELS: Record<PaymentTerms, string> = {
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_60: 'Net 60',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

let nextId = SEED_ACCOUNTS.length + 1

// ── Sub-components ────────────────────────────────────────────────────────────
function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md p-1.5 transition-colors"
      style={{ color: 'var(--text-3)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}

function CreditBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--accent)'
  return (
    <div className="w-full" style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
    </div>
  )
}

function StatusBadge({ status }: { status: AccountStatus }) {
  const cfg = STATUS_CFG[status]
  return (
    <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

// ── Blank form state ──────────────────────────────────────────────────────────
const BLANK_FORM = {
  company_name: '', contact_name: '', contact_email: '', contact_phone: '',
  credit_limit: '', payment_terms: 'NET_30' as PaymentTerms, rate_code: 'CORP_STANDARD',
  account_manager: '',
  addr_line1: '', addr_line2: '', addr_city: '', addr_state: '', addr_zip: '', addr_country: 'US',
}

// ── Account Detail Drawer ────────────────────────────────────────────────────
function AccountDrawer({
  account,
  onClose,
  onEdit,
  onToggleStatus,
}: {
  account: CorporateAccount
  onClose: () => void
  onEdit: (a: CorporateAccount) => void
  onToggleStatus: (a: CorporateAccount) => void
}) {
  const [tab, setTab] = useState<'overview' | 'rentals' | 'invoices'>('overview')
  const [rentals, setRentals] = useState<Reservation[]>([])
  const [rentalsLoading, setRentalsLoading] = useState(false)
  const [invoicesList] = useState<Invoice[]>(SEED_INVOICES)

  useEffect(() => {
    if (tab !== 'rentals') return
    setRentalsLoading(true)
    // The reservations CRM list endpoint doesn't currently support filtering by
    // corporate_account_id. We try anyway and gracefully show empty state.
    fetchJSON('/reservations/crm-list?limit=50')
      .then((rows: Reservation[]) => {
        // Filter client-side (field may not exist on all rows)
        setRentals(rows.slice(0, 10))
      })
      .catch(() => setRentals([]))
      .finally(() => setRentalsLoading(false))
  }, [tab])

  const used = account.outstanding_balance
  const limit = account.credit_limit
  const available = Math.max(limit - used, 0)
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0

  const TABS: { key: 'overview' | 'rentals' | 'invoices'; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'rentals',  label: 'Rentals' },
    { key: 'invoices', label: 'Invoices' },
  ]

  return (
    <div className="flex-1 panel overflow-hidden flex flex-col" style={{ minWidth: 0 }}>
      {/* Drawer header */}
      <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                {account.company_name}
              </h2>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold"
                style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--accent)' }}
              >
                {account.rate_code}
              </span>
              <StatusBadge status={account.status} />
            </div>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Member since {fmtDate(account.member_since)} &middot; {TERMS_LABELS[account.payment_terms]}
            </p>
          </div>
          <CloseBtn onClick={onClose} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 py-1.5 rounded text-[12.5px] font-medium transition-colors"
              style={{
                background: tab === t.key ? 'var(--accent)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--text-2)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Drawer body */}
      <div className="flex-1 overflow-auto p-5 space-y-4">

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <>
            {/* Credit utilization */}
            <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Credit Status</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Credit Limit',  value: fmt$(limit)     },
                  { label: 'Outstanding',   value: fmt$(used)      },
                  { label: 'Available',     value: fmt$(available) },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className="text-[15px] font-bold num" style={{ color: 'var(--text-1)' }}>{s.value}</p>
                    <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <CreditBar used={used} limit={limit} />
                <p className="text-[11px] text-right" style={{ color: pct >= 90 ? 'var(--danger)' : 'var(--text-3)' }}>
                  {pct}% utilized
                </p>
              </div>
            </div>

            {/* Contact info */}
            <div className="rounded-lg p-4" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Contact</p>
              <div className="space-y-1.5">
                <Row label="Name"    value={account.contact_name}  />
                <Row label="Email"   value={account.contact_email} />
                <Row label="Phone"   value={account.contact_phone} />
                <Row label="Manager" value={account.account_manager} />
              </div>
            </div>

            {/* Billing address */}
            <div className="rounded-lg p-4" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Billing Address</p>
              <p className="text-[13px]" style={{ color: 'var(--text-1)' }}>{account.billing_address.line1}</p>
              {account.billing_address.line2 && (
                <p className="text-[13px]" style={{ color: 'var(--text-1)' }}>{account.billing_address.line2}</p>
              )}
              <p className="text-[13px]" style={{ color: 'var(--text-1)' }}>
                {account.billing_address.city}, {account.billing_address.state} {account.billing_address.zip}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>{account.billing_address.country}</p>
            </div>

            {/* Account details */}
            <div className="rounded-lg p-4" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Account Details</p>
              <div className="space-y-1.5">
                <Row label="Payment Terms" value={TERMS_LABELS[account.payment_terms]} />
                <Row label="Rate Code"     value={account.rate_code} />
                <Row label="Status"        value={<StatusBadge status={account.status} />} />
              </div>
            </div>
          </>
        )}

        {/* ── Rentals tab ── */}
        {tab === 'rentals' && (
          <div>
            {rentalsLoading ? (
              <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-3)' }}>Loading rentals...</p>
            ) : rentals.length === 0 ? (
              <div className="py-12 text-center" style={{ border: '1px dashed var(--border)', borderRadius: 8 }}>
                <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No rentals linked to this account</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Reservations with this corporate account ID will appear here once the API supports filtering.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rentals.map(r => (
                  <div
                    key={r.reservation_id}
                    className="flex items-center justify-between rounded-lg px-4 py-3"
                    style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                  >
                    <div>
                      <p className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                        {r.confirmation_number}
                      </p>
                      <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {r.customer_name} &middot; {r.class_name}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {fmtDate(r.pickup_date)} – {fmtDate(r.return_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>{fmt$(r.total)}</p>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                      >
                        {r.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Invoices tab ── */}
        {tab === 'invoices' && (
          <div className="space-y-2">
            {invoicesList.length === 0 ? (
              <div className="py-12 text-center" style={{ border: '1px dashed var(--border)', borderRadius: 8 }}>
                <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No invoices generated yet</p>
              </div>
            ) : invoicesList.map(inv => {
              const sc = INVOICE_STATUS_CFG[inv.status]
              return (
                <div
                  key={inv.invoice_id}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                >
                  <div>
                    <p className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--text-1)' }}>
                      {inv.invoice_number}
                    </p>
                    <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {inv.period} &middot; Issued {fmtDate(inv.issued_date)} &middot; Due {fmtDate(inv.due_date)}
                    </p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>{fmt$(inv.amount)}</p>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: sc.bg, color: sc.color }}>
                      {inv.status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Drawer actions */}
      <div className="px-5 py-4 flex flex-wrap gap-2" style={{ borderTop: '1px solid var(--border)' }}>
        <button className="btn-primary" onClick={() => onEdit(account)}>Edit Account</button>
        <button
          className="btn-ghost"
          style={account.status === 'ACTIVE' ? { color: 'var(--danger)', borderColor: 'rgba(244,114,114,0.3)' } : {}}
          onClick={() => onToggleStatus(account)}
        >
          {account.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
        </button>
        <button className="btn-ghost" onClick={() => alert('Invoice generation requires the billing API (currently a stub).')}>
          Generate Invoice
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[12px] shrink-0" style={{ color: 'var(--text-3)' }}>{label}</span>
      {typeof value === 'string' ? (
        <span className="text-[12.5px] font-medium text-right" style={{ color: 'var(--text-1)' }}>{value}</span>
      ) : (
        <span>{value}</span>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function CorporatePage() {
  const [accounts, setAccounts] = useState<CorporateAccount[]>(SEED_ACCOUNTS)
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState<CorporateAccount | null>(null)
  const [apiNote, setApiNote]   = useState<string | null>(null)

  // New account dialog
  const [showNew, setShowNew]   = useState(false)
  const [newForm, setNewForm]   = useState<typeof BLANK_FORM>(BLANK_FORM)
  const nfi = (k: keyof typeof BLANK_FORM, v: string) => setNewForm(p => ({ ...p, [k]: v }))

  // Edit dialog
  const [showEdit, setShowEdit]   = useState(false)
  const [editForm, setEditForm]   = useState<typeof BLANK_FORM>(BLANK_FORM)
  const efi = (k: keyof typeof BLANK_FORM, v: string) => setEditForm(p => ({ ...p, [k]: v }))

  // Attempt to load from API on mount (will fail gracefully until backend is ready)
  useEffect(() => {
    fetchJSON('/corporate')
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
          setAccounts(data as CorporateAccount[])
          setApiNote(null)
        } else {
          setApiNote('Corporate API returned no accounts — showing demo data.')
        }
      })
      .catch(() => {
        setApiNote('Corporate accounts API not yet implemented — showing demo data.')
      })
  }, [])

  // Stats
  const totalAccounts    = accounts.length
  const activeAccounts   = accounts.filter(a => a.status === 'ACTIVE').length
  const totalOutstanding = accounts.reduce((s, a) => s + a.outstanding_balance, 0)
  const nearLimit        = accounts.filter(a => a.credit_limit > 0 && (a.outstanding_balance / a.credit_limit) >= 0.8).length

  const filtered = accounts.filter(a =>
    !search || a.company_name.toLowerCase().includes(search.toLowerCase())
      || a.contact_name.toLowerCase().includes(search.toLowerCase())
      || a.rate_code.toLowerCase().includes(search.toLowerCase())
  )

  function handleToggleStatus(a: CorporateAccount) {
    const next: AccountStatus = a.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    const updated = { ...a, status: next }
    setAccounts(prev => prev.map(x => x.account_id === a.account_id ? updated : x))
    if (selected?.account_id === a.account_id) setSelected(updated)
  }

  function openEdit(a: CorporateAccount) {
    setEditForm({
      company_name:    a.company_name,
      contact_name:    a.contact_name,
      contact_email:   a.contact_email,
      contact_phone:   a.contact_phone,
      credit_limit:    String(a.credit_limit),
      payment_terms:   a.payment_terms,
      rate_code:       a.rate_code,
      account_manager: a.account_manager,
      addr_line1:      a.billing_address.line1,
      addr_line2:      a.billing_address.line2 ?? '',
      addr_city:       a.billing_address.city,
      addr_state:      a.billing_address.state,
      addr_zip:        a.billing_address.zip,
      addr_country:    a.billing_address.country,
    })
    setShowEdit(true)
  }

  function handleNew(e: FormEvent) {
    e.preventDefault()
    const id = String(nextId++)
    const acct: CorporateAccount = {
      account_id:          id,
      company_name:        newForm.company_name,
      contact_name:        newForm.contact_name,
      contact_email:       newForm.contact_email,
      contact_phone:       newForm.contact_phone,
      credit_limit:        Number(newForm.credit_limit) || 0,
      outstanding_balance: 0,
      payment_terms:       newForm.payment_terms,
      rate_code:           newForm.rate_code || 'CORP_STANDARD',
      status:              'PENDING',
      account_manager:     newForm.account_manager,
      billing_address: {
        line1:   newForm.addr_line1,
        line2:   newForm.addr_line2 || undefined,
        city:    newForm.addr_city,
        state:   newForm.addr_state,
        zip:     newForm.addr_zip,
        country: newForm.addr_country,
      },
      member_since: new Date().toISOString().slice(0, 10),
    }
    setAccounts(prev => [acct, ...prev])
    setSelected(acct)
    setShowNew(false)
    setNewForm(BLANK_FORM)
  }

  function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const updated: CorporateAccount = {
      ...selected,
      company_name:    editForm.company_name,
      contact_name:    editForm.contact_name,
      contact_email:   editForm.contact_email,
      contact_phone:   editForm.contact_phone,
      credit_limit:    Number(editForm.credit_limit) || selected.credit_limit,
      payment_terms:   editForm.payment_terms,
      rate_code:       editForm.rate_code,
      account_manager: editForm.account_manager,
      billing_address: {
        line1:   editForm.addr_line1,
        line2:   editForm.addr_line2 || undefined,
        city:    editForm.addr_city,
        state:   editForm.addr_state,
        zip:     editForm.addr_zip,
        country: editForm.addr_country,
      },
    }
    setAccounts(prev => prev.map(a => a.account_id === updated.account_id ? updated : a))
    setSelected(updated)
    setShowEdit(false)
  }

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 112px)' }}>

      {/* API status notice */}
      {apiNote && (
        <div
          className="rounded-lg px-4 py-2.5 text-[12px]"
          style={{ background: 'var(--warn-bg)', border: '1px solid rgba(251,191,36,0.25)', color: 'var(--warn)' }}
        >
          {apiNote}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Corporate Accounts</h1>
        <button className="btn-primary" onClick={() => { setShowNew(true); setNewForm(BLANK_FORM) }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Account
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total Accounts',          value: String(totalAccounts) },
          { label: 'Active Accounts',         value: String(activeAccounts) },
          { label: 'Total Outstanding',       value: fmt$(totalOutstanding) },
          { label: 'Near Credit Limit (80%+)', value: String(nearLimit), warn: nearLimit > 0 },
        ].map(s => (
          <div
            key={s.label}
            className="panel px-4 py-3"
          >
            <p
              className="text-[20px] font-bold num"
              style={{ color: s.warn ? 'var(--warn)' : 'var(--text-1)' }}
            >
              {s.value}
            </p>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Main split view */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Account list */}
        <div className={`flex flex-col gap-3 transition-all duration-200 ${selected ? 'w-80 shrink-0' : 'w-full'}`}>
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder="Search company, contact, rate code..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field-input h-9 pl-8 text-[13px]"
            />
          </div>

          <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
            {filtered.length} account{filtered.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ''}
          </p>

          {/* Account table / card list */}
          <div className="flex-1 overflow-auto space-y-2">
            {filtered.length === 0 ? (
              <div className="panel flex flex-col items-center justify-center py-12" style={{ borderStyle: 'dashed' }}>
                <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No accounts found</p>
                {search && (
                  <button onClick={() => setSearch('')} className="mt-2 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>
                    Clear search
                  </button>
                )}
              </div>
            ) : filtered.map(a => {
              const pct = a.credit_limit > 0 ? Math.round((a.outstanding_balance / a.credit_limit) * 100) : 0
              const isSelected = selected?.account_id === a.account_id
              return (
                <button
                  key={a.account_id}
                  onClick={() => setSelected(a)}
                  className="w-full rounded-lg p-3.5 text-left transition-colors"
                  style={{
                    background: isSelected ? 'var(--accent-sub)' : 'var(--card-bg)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {/* Company row */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {a.company_name}
                      </p>
                      <p className="text-[11.5px] truncate" style={{ color: 'var(--text-3)' }}>
                        {a.contact_name} &middot; {a.contact_email}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>

                  {/* Credit bar */}
                  {!selected && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {fmt$(a.outstanding_balance)} of {fmt$(a.credit_limit)}
                        </span>
                        <span
                          className="text-[10.5px] font-mono font-medium"
                          style={{ color: 'var(--accent)' }}
                        >
                          {a.rate_code}
                        </span>
                      </div>
                      <CreditBar used={a.outstanding_balance} limit={a.credit_limit} />
                      <p className="text-[10.5px]" style={{ color: pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--text-3)' }}>
                        {pct}% of limit used
                      </p>
                    </div>
                  )}

                  {/* Compact view when drawer open */}
                  {selected && (
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      {fmt$(a.outstanding_balance)} outstanding &middot; {TERMS_LABELS[a.payment_terms]}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Detail drawer */}
        {selected && (
          <AccountDrawer
            account={selected}
            onClose={() => setSelected(null)}
            onEdit={openEdit}
            onToggleStatus={handleToggleStatus}
          />
        )}
      </div>

      {/* ── New Account Dialog ── */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNew(false); setNewForm(BLANK_FORM) } }}
        >
          <div className="panel w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>New Corporate Account</h2>
              <CloseBtn onClick={() => { setShowNew(false); setNewForm(BLANK_FORM) }} />
            </div>
            <form onSubmit={handleNew} className="px-6 py-5 space-y-4 overflow-auto" style={{ maxHeight: '80vh' }}>
              <AccountFormFields form={newForm} fi={nfi} />
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => { setShowNew(false); setNewForm(BLANK_FORM) }} className="btn-ghost">Cancel</button>
                <button type="submit" className="btn-primary">Create Account</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Account Dialog ── */}
      {showEdit && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowEdit(false) }}
        >
          <div className="panel w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Account</h2>
              <CloseBtn onClick={() => setShowEdit(false)} />
            </div>
            <form onSubmit={handleEdit} className="px-6 py-5 space-y-4 overflow-auto" style={{ maxHeight: '80vh' }}>
              <AccountFormFields form={editForm} fi={efi} />
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowEdit(false)} className="btn-ghost">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Shared form fields component ──────────────────────────────────────────────
function AccountFormFields({
  form,
  fi,
}: {
  form: typeof BLANK_FORM
  fi: (k: keyof typeof BLANK_FORM, v: string) => void
}) {
  return (
    <>
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Company</p>
        <div className="space-y-3">
          <div>
            <ModalLabel>Company Name</ModalLabel>
            <input
              required type="text" placeholder="Acme Corporation"
              value={form.company_name} onChange={e => fi('company_name', e.target.value)}
              className="field-input h-9 px-3 text-[13px] w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <ModalLabel>Rate Code</ModalLabel>
              <input
                required type="text" placeholder="CORP_STANDARD"
                value={form.rate_code} onChange={e => fi('rate_code', e.target.value.toUpperCase())}
                className="field-input h-9 px-3 text-[13px] font-mono w-full"
              />
            </div>
            <div>
              <ModalLabel>Payment Terms</ModalLabel>
              <select
                value={form.payment_terms}
                onChange={e => fi('payment_terms', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              >
                <option value="NET_15">Net 15</option>
                <option value="NET_30">Net 30</option>
                <option value="NET_60">Net 60</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <ModalLabel>Credit Limit ($)</ModalLabel>
              <input
                required type="number" min="0" step="500" placeholder="10000"
                value={form.credit_limit} onChange={e => fi('credit_limit', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
            <div>
              <ModalLabel>Account Manager</ModalLabel>
              <input
                type="text" placeholder="Jane Smith"
                value={form.account_manager} onChange={e => fi('account_manager', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Primary Contact</p>
        <div className="space-y-3">
          <div>
            <ModalLabel>Contact Name</ModalLabel>
            <input
              required type="text" placeholder="Jane Smith"
              value={form.contact_name} onChange={e => fi('contact_name', e.target.value)}
              className="field-input h-9 px-3 text-[13px] w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <ModalLabel>Email</ModalLabel>
              <input
                required type="email" placeholder="jane@company.com"
                value={form.contact_email} onChange={e => fi('contact_email', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
            <div>
              <ModalLabel>Phone</ModalLabel>
              <input
                type="tel" placeholder="+1-555-0100"
                value={form.contact_phone} onChange={e => fi('contact_phone', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Billing Address</p>
        <div className="space-y-3">
          <div>
            <ModalLabel>Street Line 1</ModalLabel>
            <input
              required type="text" placeholder="123 Main St"
              value={form.addr_line1} onChange={e => fi('addr_line1', e.target.value)}
              className="field-input h-9 px-3 text-[13px] w-full"
            />
          </div>
          <div>
            <ModalLabel>Street Line 2 (optional)</ModalLabel>
            <input
              type="text" placeholder="Suite 100"
              value={form.addr_line2} onChange={e => fi('addr_line2', e.target.value)}
              className="field-input h-9 px-3 text-[13px] w-full"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <ModalLabel>City</ModalLabel>
              <input
                required type="text" placeholder="Phoenix"
                value={form.addr_city} onChange={e => fi('addr_city', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
            <div>
              <ModalLabel>State</ModalLabel>
              <input
                required type="text" placeholder="AZ" maxLength={2}
                value={form.addr_state} onChange={e => fi('addr_state', e.target.value.toUpperCase())}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
            <div>
              <ModalLabel>ZIP</ModalLabel>
              <input
                required type="text" placeholder="85001"
                value={form.addr_zip} onChange={e => fi('addr_zip', e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
          </div>
          <div>
            <ModalLabel>Country</ModalLabel>
            <select
              value={form.addr_country}
              onChange={e => fi('addr_country', e.target.value)}
              className="field-input h-9 px-3 text-[13px] w-full"
            >
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="GB">United Kingdom</option>
              <option value="AU">Australia</option>
            </select>
          </div>
        </div>
      </section>
    </>
  )
}
