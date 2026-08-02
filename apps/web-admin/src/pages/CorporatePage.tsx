import { useEffect, useState } from 'react'

/**
 * Corporate accounts — negotiated rates, bookers and billing terms.
 *
 * What was here before was 992 lines built on SEED_ACCOUNTS and SEED_INVOICES:
 * invented companies with invented invoices, calling an endpoint that did not
 * exist. That is why the page was hidden behind VITE_SHOW_UNBUILT, and hiding
 * it was right — showing an operator fabricated customers and fabricated debts
 * is worse than showing nothing.
 *
 * This is driven entirely by /corporate/accounts and /corporate/invoices.
 *
 * The invoice controls are shaped by one rule from the API: an issued invoice
 * is immutable. So the buttons offered change with status rather than the same
 * row always offering the same actions — a draft can be regenerated or thrown
 * away, an issued invoice can only be paid or voided, and a mistake after issue
 * becomes a void with a stated reason. The UI does not offer an edit that the
 * server would refuse.
 */

interface Account {
  corporate_account_id: string
  name: string
  cdp_code: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  payment_terms_days: number
  credit_limit_cents: number | null
  currency: string
  bill_to_account: boolean
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  notes: string | null
  created_at: string
  booker_count: number
  reservation_count: number
  has_negotiated_rates: boolean
}

interface Booker {
  booker_id: string
  email: string
  full_name: string | null
  may_bill_to_account: boolean
  created_at: string
}

interface InvoiceLine {
  line_id: string
  description: string
  reference: string | null
  line_date: string | null
  quantity: number
  unit_cents: number
  amount_cents: number
}

interface Invoice {
  invoice_id: string
  corporate_account_id: string
  account_name: string | null
  invoice_number: string
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID'
  period_start: string
  period_end: string
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
  voided_at: string | null
  void_reason: string | null
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  currency: string
  line_count: number
  has_pdf: boolean
  notes: string | null
  created_at: string
  lines?: InvoiceLine[]
}

const API = '/api/v1/corporate'

const BLANK = {
  name: '', cdp_code: '', contact_name: '', contact_email: '', contact_phone: '',
  payment_terms_days: '30', credit_limit: '', bill_to_account: false, notes: '',
}

function money(cents: number | null, currency: string): string {
  if (cents === null || cents === undefined) return 'no limit'
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
  })
}

function exact(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency', currency: currency || 'USD',
  })
}

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

/** The previous whole calendar month — what a billing run almost always means. */
function lastMonth(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(end) }
}

const STATUS_STYLE: Record<Invoice['status'], { bg: string; fg: string }> = {
  DRAFT: { bg: 'rgba(148,163,184,0.16)', fg: '#94a3b8' },
  ISSUED: { bg: 'rgba(59,130,246,0.16)', fg: '#60a5fa' },
  PAID: { bg: 'rgba(16,185,129,0.16)', fg: '#34d399' },
  VOID: { bg: 'rgba(176,52,31,0.18)', fg: '#f87171' },
}

export function CorporatePage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [selected, setSelected] = useState<Account | null>(null)
  const [bookers, setBookers] = useState<Booker[]>([])
  const [form, setForm] = useState({ ...BLANK })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [bookerEmail, setBookerEmail] = useState('')
  const [bookerName, setBookerName] = useState('')
  const [bookerBills, setBookerBills] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [expandedInvoice, setExpandedInvoice] = useState<Invoice | null>(null)
  const [billing, setBilling] = useState(false)
  const [period, setPeriod] = useState(lastMonth())
  const [invoiceNote, setInvoiceNote] = useState('')

  async function load() {
    try {
      const r = await fetch(`${API}/accounts?include_closed=true`, { credentials: 'include' })
      if (r.status === 402) { setError('Corporate accounts is not included in your plan.'); setAccounts([]); return }
      setAccounts(r.ok ? await r.json() : [])
    } catch { setAccounts([]) }
  }
  useEffect(() => { void load() }, [])

  async function loadBookers(id: string) {
    const r = await fetch(`${API}/accounts/${id}/bookers`, { credentials: 'include' })
      .then((x) => (x.ok ? x.json() : []))
      .catch(() => [])
    setBookers(r)
  }

  async function call(path: string, init: RequestInit, ok: string): Promise<unknown | null> {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`${API}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setNotice(ok); await load(); return body }
      const detail = Array.isArray(body.detail)
        ? body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
        : body.detail
      setError(String(detail ?? 'That did not work.'))
      return null
    } catch {
      setError('Could not reach the server.'); return null
    } finally { setBusy(false) }
  }

  function payload() {
    const limit = form.credit_limit.trim()
    return {
      name: form.name.trim(),
      cdp_code: form.cdp_code.trim() || null,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      payment_terms_days: Number(form.payment_terms_days) || 30,
      // Entered in whole currency units, stored in minor units.
      credit_limit_cents: limit === '' ? null : Math.round(Number(limit) * 100),
      bill_to_account: form.bill_to_account,
      notes: form.notes.trim() || null,
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const r = await call('/accounts', { method: 'POST', body: JSON.stringify(payload()) }, 'Account created.')
    if (r) { setAdding(false); setForm({ ...BLANK }) }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    const r = await call(`/accounts/${selected.corporate_account_id}`,
      { method: 'PATCH', body: JSON.stringify(payload()) }, 'Saved.')
    if (r) { setEditing(false); setSelected(r as Account) }
  }

  function beginEdit(a: Account) {
    setSelected(a); setEditing(true); setAdding(false)
    setForm({
      name: a.name,
      cdp_code: a.cdp_code ?? '',
      contact_name: a.contact_name ?? '',
      contact_email: a.contact_email ?? '',
      contact_phone: a.contact_phone ?? '',
      payment_terms_days: String(a.payment_terms_days),
      credit_limit: a.credit_limit_cents === null ? '' : String(a.credit_limit_cents / 100),
      bill_to_account: a.bill_to_account,
      notes: a.notes ?? '',
    })
  }

  async function loadInvoices(id: string) {
    const r = await fetch(`${API}/invoices?account_id=${id}`, { credentials: 'include' })
      .then((x) => (x.ok ? x.json() : []))
      .catch(() => [])
    setInvoices(r)
  }

  async function open(a: Account) {
    setSelected(a); setEditing(false); setAdding(false)
    setExpandedInvoice(null); setBilling(false)
    await Promise.all([loadBookers(a.corporate_account_id), loadInvoices(a.corporate_account_id)])
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    const r = await call('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        corporate_account_id: selected.corporate_account_id,
        period_start: period.start,
        period_end: period.end,
        notes: invoiceNote.trim() || null,
      }),
    }, 'Draft invoice created.') as Invoice | null
    if (r) {
      setBilling(false); setInvoiceNote('')
      setExpandedInvoice(r)
      // An empty draft is the common and confusing outcome: it means every
      // rental in the window was already billed, or none were placed on the
      // account. Say which rather than showing a zero and leaving them to guess.
      if (r.line_count === 0) {
        setNotice(
          `${r.invoice_number} is empty — no unbilled rentals were placed on ` +
          'this account in that period.'
        )
      }
      await loadInvoices(selected.corporate_account_id)
    }
  }

  async function issue(inv: Invoice) {
    if (!window.confirm(
      `Issue ${inv.invoice_number} for ${exact(inv.total_cents, inv.currency)}?\n\n` +
      'It becomes final: the amounts and line items are frozen, the PDF is ' +
      'generated, and the only correction after this is a void.'
    )) return
    const r = await call(`/invoices/${inv.invoice_id}/issue`, { method: 'POST' },
      'Invoice issued.') as Invoice | null
    if (r && selected) { setExpandedInvoice(r); await loadInvoices(selected.corporate_account_id) }
  }

  async function markPaid(inv: Invoice) {
    const r = await call(`/invoices/${inv.invoice_id}/paid`, { method: 'POST' },
      'Marked paid.') as Invoice | null
    if (r && selected) { setExpandedInvoice(r); await loadInvoices(selected.corporate_account_id) }
  }

  async function voidInvoice(inv: Invoice) {
    const reason = window.prompt(
      `Void ${inv.invoice_number}? The reason is kept on the invoice and its ` +
      'rentals become billable again.\n\nReason:'
    )
    if (!reason || reason.trim().length < 3) return
    const r = await call(`/invoices/${inv.invoice_id}/void`,
      { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      'Invoice voided.') as Invoice | null
    if (r && selected) { setExpandedInvoice(r); await loadInvoices(selected.corporate_account_id) }
  }

  async function openInvoice(inv: Invoice) {
    if (expandedInvoice?.invoice_id === inv.invoice_id) { setExpandedInvoice(null); return }
    const full = await fetch(`${API}/invoices/${inv.invoice_id}`, { credentials: 'include' })
      .then((x) => (x.ok ? x.json() : null))
      .catch(() => null)
    setExpandedInvoice(full ?? inv)
  }

  async function downloadPdf(inv: Invoice) {
    // The tab is opened synchronously on the click, before the await — a
    // popup blocker will not allow window.open once the fetch has resolved.
    const tab = window.open('', '_blank', 'noopener')
    setError('')
    try {
      const res = await fetch(`${API}/invoices/${inv.invoice_id}/pdf`, { credentials: 'include' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        tab?.close()
        setError(String(body.detail ?? 'The PDF could not be fetched.'))
        return
      }
      if (tab) tab.location.href = body.url
      else window.location.href = body.url  // blocked: navigate here instead
    } catch {
      tab?.close()
      setError('Could not reach the server.')
    }
  }

  async function addBooker(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    const r = await call(`/accounts/${selected.corporate_account_id}/bookers`,
      { method: 'POST', body: JSON.stringify({
        email: bookerEmail.trim(), full_name: bookerName.trim() || null,
        may_bill_to_account: bookerBills,
      }) }, 'Booker added.')
    if (r) {
      setBookerEmail(''); setBookerName(''); setBookerBills(false)
      await loadBookers(selected.corporate_account_id)
    }
  }

  async function revokeBooker(b: Booker) {
    if (!selected) return
    if (!window.confirm(`Stop ${b.email} booking on this account?`)) return
    await call(`/accounts/${selected.corporate_account_id}/bookers/${b.booker_id}`,
      { method: 'DELETE' }, 'Booker removed.')
    await loadBookers(selected.corporate_account_id)
  }

  async function close(a: Account) {
    if (!window.confirm(
      `Close ${a.name}?\n\n` +
      'It stops being offered at the counter. Its bookings and their billing ' +
      'history are unchanged.'
    )) return
    if (await call(`/accounts/${a.corporate_account_id}`, { method: 'DELETE' }, 'Account closed.')) {
      setSelected(null)
    }
  }

  const field = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const fs = { background: 'var(--page-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }
  const card = { background: 'var(--card-bg)', border: '1px solid var(--border)' }
  const lbl = 'text-xs'
  const lblS = { color: 'var(--text-3)' }

  if (!accounts) {
    return <div className="p-8 text-sm" style={{ color: 'var(--text-3)' }}>{error || 'Loading…'}</div>
  }

  function editor(onSubmit: (e: React.FormEvent) => void, submitLabel: string) {
    return (
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-xl p-4 sm:grid-cols-2" style={card}>
        <label className={lbl} style={lblS}>
          Company name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                 className={`${field} mt-1`} style={fs} />
        </label>
        <label className={lbl} style={lblS}>
          CDP code
          <input value={form.cdp_code}
                 onChange={(e) => setForm({ ...form, cdp_code: e.target.value.toUpperCase() })}
                 placeholder="NORTHWIND" className={`${field} mt-1 font-mono`} style={fs} />
          <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-3)' }}>
            The code a booker quotes to get their negotiated rate. It must also
            be set on a rate code, or they will be quoted the public price.
          </span>
        </label>
        <label className={lbl} style={lblS}>
          Contact name
          <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                 className={`${field} mt-1`} style={fs} />
        </label>
        <label className={lbl} style={lblS}>
          Contact email
          <input type="email" value={form.contact_email}
                 onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                 className={`${field} mt-1`} style={fs} />
        </label>
        <label className={lbl} style={lblS}>
          Payment terms (days)
          <input type="number" min={0} max={180} value={form.payment_terms_days}
                 onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
                 className={`${field} mt-1`} style={fs} />
        </label>
        <label className={lbl} style={lblS}>
          Credit limit
          <input type="number" min={0} step="1" value={form.credit_limit}
                 onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                 placeholder="no limit" className={`${field} mt-1`} style={fs} />
        </label>
        <label className="flex items-start gap-2 text-xs sm:col-span-2" style={lblS}>
          <input type="checkbox" checked={form.bill_to_account}
                 onChange={(e) => setForm({ ...form, bill_to_account: e.target.checked })}
                 className="mt-0.5 h-3.5 w-3.5 accent-indigo-500" />
          <span>
            <span style={{ color: 'var(--text-2)' }}>Bill rentals to this account</span>
            <span className="block text-[11px]">
              The counter can close a rental without taking a card. This is
              extending credit — off unless you mean it.
            </span>
          </span>
        </label>
        <label className={`${lbl} sm:col-span-2`} style={lblS}>
          Notes
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                 className={`${field} mt-1`} style={fs} />
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={busy}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}>{submitLabel}</button>
          <button type="button" onClick={() => { setAdding(false); setEditing(false) }}
                  className="rounded-lg px-4 py-2 text-sm"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Corporate accounts</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
            Companies you have negotiated rates with, and who may book on them.
          </p>
        </div>
        <button onClick={() => { setAdding((v) => !v); setEditing(false); setForm({ ...BLANK }) }}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
          {adding ? 'Cancel' : 'New account'}
        </button>
      </header>

      {notice && <p className="mt-4 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {adding && editor(create, 'Create account')}
      {editing && selected && editor(save, 'Save changes')}

      <div className="mt-5 space-y-2">
        {accounts.length === 0 && !adding && (
          <p className="rounded-xl p-6 text-sm" style={{ ...card, color: 'var(--text-3)' }}>
            No corporate accounts yet.
          </p>
        )}
        {accounts.map((a) => (
          <div key={a.corporate_account_id} className="rounded-xl p-4"
               style={{ ...card, opacity: a.status === 'CLOSED' ? 0.55 : 1 }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => void open(a)} className="text-sm font-semibold hover:underline"
                          style={{ color: 'var(--text-1)' }}>{a.name}</button>
                  {a.cdp_code && (
                    <span className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                          style={{ background: 'var(--accent-sub)', color: 'var(--accent)' }}>
                      {a.cdp_code}
                    </span>
                  )}
                  {a.status !== 'ACTIVE' && (
                    <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {a.status.toLowerCase()}
                    </span>
                  )}
                  {a.bill_to_account && (
                    <span className="text-[11px] text-emerald-400">bills to account</span>
                  )}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
                  {a.payment_terms_days} day terms · {money(a.credit_limit_cents, a.currency)} ·{' '}
                  {a.booker_count} booker{a.booker_count === 1 ? '' : 's'} ·{' '}
                  {a.reservation_count} booking{a.reservation_count === 1 ? '' : 's'}
                </div>
                {/* The failure that looks like a broken discount to the
                    customer and like nothing at all from in here. */}
                {a.cdp_code && !a.has_negotiated_rates && (
                  <p className="mt-2 rounded px-2 py-1 text-[11px]"
                     style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
                    No rate code carries {a.cdp_code}, so this account is being
                    quoted public prices. Set the CDP code on a rate code in Pricing.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => beginEdit(a)} disabled={busy}
                        className="rounded-lg px-2.5 py-1 text-xs disabled:opacity-40"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>Edit</button>
                {a.status !== 'CLOSED' && (
                  <button onClick={() => void close(a)} disabled={busy}
                          className="rounded-lg px-2.5 py-1 text-xs text-red-300 disabled:opacity-40"
                          style={{ border: '1px solid rgba(176,52,31,0.5)' }}>Close</button>
                )}
              </div>
            </div>

            {selected?.corporate_account_id === a.corporate_account_id && !editing && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  Who may book on this account
                </p>
                <div className="mt-2 space-y-1">
                  {bookers.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>Nobody yet.</p>
                  )}
                  {bookers.map((b) => (
                    <div key={b.booker_id} className="flex items-center justify-between gap-3 text-xs">
                      <span style={{ color: 'var(--text-2)' }}>
                        {b.email}{b.full_name ? ` · ${b.full_name}` : ''}
                        {b.may_bill_to_account && (
                          <span className="ml-2 text-emerald-400">may bill to account</span>
                        )}
                      </span>
                      <button onClick={() => void revokeBooker(b)} disabled={busy}
                              className="text-red-300 hover:underline disabled:opacity-40">Remove</button>
                    </div>
                  ))}
                </div>

                <form onSubmit={addBooker} className="mt-3 flex flex-wrap items-end gap-2">
                  <input required type="email" placeholder="booker@company.com" value={bookerEmail}
                         onChange={(e) => setBookerEmail(e.target.value)}
                         className={`${field} max-w-[220px]`} style={fs} />
                  <input placeholder="Name (optional)" value={bookerName}
                         onChange={(e) => setBookerName(e.target.value)}
                         className={`${field} max-w-[160px]`} style={fs} />
                  <label className="flex items-center gap-1.5 text-xs" style={lblS}>
                    <input type="checkbox" checked={bookerBills}
                           onChange={(e) => setBookerBills(e.target.checked)}
                           className="h-3.5 w-3.5 accent-indigo-500" />
                    may bill to account
                  </label>
                  <button type="submit" disabled={busy}
                          className="rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: 'var(--accent)' }}>Add booker</button>
                </form>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
                     style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider"
                     style={{ color: 'var(--text-3)' }}>Invoices</p>
                  <button onClick={() => { setBilling((v) => !v); setPeriod(lastMonth()) }}
                          disabled={busy || a.status === 'CLOSED'}
                          className="rounded-lg px-2.5 py-1 text-xs disabled:opacity-40"
                          style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                    {billing ? 'Cancel' : 'Bill a period'}
                  </button>
                </div>

                {billing && (
                  <form onSubmit={generate} className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-[11px]" style={lblS}>
                      From
                      <input required type="date" value={period.start}
                             onChange={(e) => setPeriod({ ...period, start: e.target.value })}
                             className={`${field} mt-0.5`} style={fs} />
                    </label>
                    <label className="text-[11px]" style={lblS}>
                      To
                      <input required type="date" value={period.end}
                             onChange={(e) => setPeriod({ ...period, end: e.target.value })}
                             className={`${field} mt-0.5`} style={fs} />
                    </label>
                    <input placeholder="Note on the invoice (optional)" value={invoiceNote}
                           onChange={(e) => setInvoiceNote(e.target.value)}
                           className={`${field} max-w-[240px]`} style={fs} />
                    <button type="submit" disabled={busy}
                            className="rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                            style={{ background: 'var(--accent)' }}>Create draft</button>
                  </form>
                )}

                <div className="mt-2 space-y-1.5">
                  {invoices.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      Nothing billed yet.
                    </p>
                  )}
                  {invoices.map((inv) => {
                    const open2 = expandedInvoice?.invoice_id === inv.invoice_id
                    const shown = open2 ? expandedInvoice! : inv
                    const st = STATUS_STYLE[shown.status]
                    return (
                      <div key={inv.invoice_id} className="rounded-lg p-2.5"
                           style={{ border: '1px solid var(--border)' }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button onClick={() => void openInvoice(inv)}
                                  className="flex flex-wrap items-center gap-2 text-left">
                            <span className="font-mono text-xs font-semibold"
                                  style={{ color: 'var(--text-1)' }}>{shown.invoice_number}</span>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                                  style={{ background: st.bg, color: st.fg }}>{shown.status}</span>
                            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                              {shown.period_start} → {shown.period_end} ·{' '}
                              {shown.line_count} line{shown.line_count === 1 ? '' : 's'}
                              {shown.status === 'ISSUED' && shown.due_at
                                ? ` · due ${day(shown.due_at)}` : ''}
                              {shown.status === 'PAID' ? ` · paid ${day(shown.paid_at)}` : ''}
                            </span>
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold tabular-nums"
                                  style={{ color: 'var(--text-1)',
                                           textDecoration: shown.status === 'VOID' ? 'line-through' : 'none' }}>
                              {exact(shown.total_cents, shown.currency)}
                            </span>
                            {shown.status === 'DRAFT' && shown.line_count > 0 && (
                              <button onClick={() => void issue(shown)} disabled={busy}
                                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                                      style={{ background: 'var(--accent)' }}>Issue</button>
                            )}
                            {shown.has_pdf && (
                              <button onClick={() => void downloadPdf(shown)} disabled={busy}
                                      className="rounded-lg px-2.5 py-1 text-xs disabled:opacity-40"
                                      style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                                PDF
                              </button>
                            )}
                            {shown.status === 'ISSUED' && (
                              <button onClick={() => void markPaid(shown)} disabled={busy}
                                      className="rounded-lg px-2.5 py-1 text-xs text-emerald-300 disabled:opacity-40"
                                      style={{ border: '1px solid rgba(16,185,129,0.4)' }}>Mark paid</button>
                            )}
                            {shown.status !== 'VOID' && shown.status !== 'PAID' && (
                              <button onClick={() => void voidInvoice(shown)} disabled={busy}
                                      className="rounded-lg px-2.5 py-1 text-xs text-red-300 disabled:opacity-40"
                                      style={{ border: '1px solid rgba(176,52,31,0.5)' }}>Void</button>
                            )}
                          </div>
                        </div>

                        {open2 && (
                          <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                            {(shown.lines ?? []).length === 0 ? (
                              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                                {shown.status === 'VOID'
                                  ? 'The charges were released when this was voided, so those ' +
                                    'rentals can be billed again. The issued PDF is kept.'
                                  : 'No charges on this invoice.'}
                              </p>
                            ) : (
                              <table className="w-full text-[11px]">
                                <tbody>
                                  {(shown.lines ?? []).map((l) => (
                                    <tr key={l.line_id}>
                                      <td className="py-0.5 pr-2" style={{ color: 'var(--text-2)' }}>
                                        {l.description}
                                        {l.reference && (
                                          <span className="ml-1.5 font-mono"
                                                style={{ color: 'var(--text-3)' }}>{l.reference}</span>
                                        )}
                                      </td>
                                      <td className="py-0.5 pr-2 whitespace-nowrap"
                                          style={{ color: 'var(--text-3)' }}>{l.line_date ?? ''}</td>
                                      <td className="py-0.5 text-right tabular-nums whitespace-nowrap"
                                          style={{ color: 'var(--text-2)' }}>
                                        {exact(l.amount_cents, shown.currency)}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr>
                                    <td colSpan={2} className="pt-1.5 text-right"
                                        style={{ color: 'var(--text-3)' }}>Tax</td>
                                    <td className="pt-1.5 text-right tabular-nums"
                                        style={{ color: 'var(--text-3)' }}>
                                      {exact(shown.tax_cents, shown.currency)}
                                    </td>
                                  </tr>
                                  <tr>
                                    <td colSpan={2} className="pt-1 text-right font-semibold"
                                        style={{ color: 'var(--text-2)' }}>Total</td>
                                    <td className="pt-1 text-right font-semibold tabular-nums"
                                        style={{ color: 'var(--text-1)' }}>
                                      {exact(shown.total_cents, shown.currency)}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            )}
                            {shown.notes && (
                              <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>
                                {shown.notes}
                              </p>
                            )}
                            {shown.void_reason && (
                              <p className="mt-2 text-[11px] text-red-300">
                                Voided {day(shown.voided_at)} — {shown.void_reason}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
