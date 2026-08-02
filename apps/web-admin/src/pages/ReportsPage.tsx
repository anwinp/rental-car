import { useEffect, useState } from 'react'

/**
 * Reports: ask for one, watch it run, download it.
 *
 * What was here before was a chart of hardcoded constants — six months of
 * invented revenue and a location breakdown for branches that did not exist —
 * which is why the page was hidden behind VITE_SHOW_UNBUILT. Showing a customer
 * fabricated figures for their own business is worse than showing them nothing,
 * and the flag was the right call at the time.
 *
 * This is driven entirely by the reporting API. The list of kinds comes from the
 * server so the page cannot offer a report the worker does not implement, and
 * every number shown belongs to the workspace looking at it.
 */

interface ReportKind {
  kind: string
  label: string
  requires: string[]
}

interface Report {
  report_id: string
  kind: string
  label: string
  params: Record<string, string>
  status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED'
  row_count: number | null
  byte_size: number | null
  summary: Record<string, unknown> | null
  error: string | null
  created_at: string
  completed_at: string | null
}

const API = '/api/v1/reporting'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

const STATUS_COLOUR: Record<Report['status'], string> = {
  PENDING: 'var(--text-3)',
  RUNNING: '#f59e0b',
  READY: '#10b981',
  FAILED: '#ef4444',
}

export function ReportsPage() {
  const [kinds, setKinds] = useState<ReportKind[]>([])
  const [reports, setReports] = useState<Report[] | null>(null)
  const [kind, setKind] = useState('')
  const [date, setDate] = useState(today())
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const r = await fetch(`${API}/reports`, { credentials: 'include' })
      if (r.ok) setReports(await r.json())
      else if (r.status === 402) {
        setError('Reporting is not included in your plan.')
        setReports([])
      } else setReports([])
    } catch { setReports([]) }
  }

  useEffect(() => {
    fetch(`${API}/kinds`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((k: ReportKind[]) => { setKinds(k); if (k.length) setKind(k[0].kind) })
      .catch(() => setKinds([]))
    void load()
  }, [])

  // Poll only while something is actually running. A fixed interval would keep
  // a tab hitting the API all afternoon for a list that never changes.
  const pending = (reports ?? []).some((r) => r.status === 'PENDING' || r.status === 'RUNNING')
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [pending])

  const chosen = kinds.find((k) => k.kind === kind)
  const needsRange = Boolean(chosen?.requires.includes('period_start'))

  async function request(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const body: Record<string, string> = { kind }
      if (chosen?.requires.includes('date')) body.date = date
      if (needsRange) { body.period_start = from; body.period_end = to }
      const res = await fetch(`${API}/reports`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setNotice('Running — it will appear below when ready.'); await load() }
      else {
        const detail = Array.isArray(data.detail)
          ? data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
          : data.detail
        setError(String(detail ?? 'Could not start the report.'))
      }
    } catch {
      setError('Could not reach the server.')
    } finally { setBusy(false) }
  }

  async function download(r: Report) {
    setError('')
    try {
      const res = await fetch(`${API}/reports/${r.report_id}/download`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      // The signed URL is fetched at the moment of the click and used
      // immediately — it is deliberately short-lived and never stored.
      if (res.ok && data.url) window.location.href = data.url
      else setError(String(data.detail ?? 'Could not fetch that report.'))
    } catch { setError('Could not reach the server.') }
  }

  const field = 'rounded-lg px-3 py-2 text-sm outline-none'
  const fs = { background: 'var(--page-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }
  const card = { background: 'var(--card-bg)', border: '1px solid var(--border)' }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Reports</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>
          Generated from your own data and kept here once they are ready.
        </p>
      </header>

      {kinds.length > 0 && (
        <form onSubmit={request} className="mt-6 flex flex-wrap items-end gap-3 rounded-xl p-4" style={card}>
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>
            Report
            <select value={kind} onChange={(e) => setKind(e.target.value)}
                    className={`${field} mt-1 block`} style={fs}>
              {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>

          {chosen?.requires.includes('date') && (
            <label className="text-xs" style={{ color: 'var(--text-3)' }}>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                     className={`${field} mt-1 block`} style={fs} />
            </label>
          )}
          {needsRange && (
            <>
              <label className="text-xs" style={{ color: 'var(--text-3)' }}>
                From
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                       className={`${field} mt-1 block`} style={fs} />
              </label>
              <label className="text-xs" style={{ color: 'var(--text-3)' }}>
                To
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                       className={`${field} mt-1 block`} style={fs} />
              </label>
            </>
          )}

          <button type="submit" disabled={busy || !kind}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}>
            {busy ? 'Starting…' : 'Generate'}
          </button>
        </form>
      )}

      {notice && <p className="mt-4 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-6 space-y-2">
        {reports === null ? (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading…</p>
        ) : reports.length === 0 ? (
          <p className="rounded-xl p-6 text-sm" style={{ ...card, color: 'var(--text-3)' }}>
            No reports yet. Generate one above — it runs in the background and
            appears here.
          </p>
        ) : (
          reports.map((r) => (
            <div key={r.report_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" style={card}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                    {r.label}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: STATUS_COLOUR[r.status] }}>
                    {r.status.toLowerCase()}
                  </span>
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {Object.values(r.params).join(' → ') || '—'} · {when(r.created_at)}
                  {r.row_count !== null && ` · ${r.row_count} rows`}
                </div>
                {r.error && <p className="mt-1 text-xs text-red-400">{r.error}</p>}
                {r.summary && r.status === 'READY' && (
                  <div className="mt-1 flex flex-wrap gap-x-4 text-xs" style={{ color: 'var(--text-2)' }}>
                    {Object.entries(r.summary).map(([k, v]) => (
                      <span key={k}>
                        {k.replace(/_/g, ' ')}: <span className="font-mono tabular-nums">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => void download(r)} disabled={r.status !== 'READY'}
                title={r.status === 'READY' ? 'Download the CSV' : `This report is ${r.status.toLowerCase()}`}
                className="rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
              >
                Download CSV
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
