import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = {
  location_id: string
  short_code: string
  name: string
  city: string
  state_province: string
}

// GET /checkout/shift/current — flat object when OPEN, status-only when closed
type ShiftCurrentResponse =
  | { status: 'OPEN'; shift_id: string; opened_at: string; opening_cash: number }
  | { status: 'NO_OPEN_SHIFT'; shift_id?: undefined; opened_at?: undefined; opening_cash?: undefined }

type ShiftReport = {
  shift_id: string
  location_id: string
  agent_id: string
  shift_opened_at: string
  shift_closed_at: string
  opening_cash: string | number
  closing_cash: string | number
  expected_cash: string | number
  cash_variance: string | number
  rentals_out: number
  rentals_in: number
  variance_note_required: boolean
}

// ── fetchJSON helper ──────────────────────────────────────────────────────────

const TENANT = '00000000-0000-0000-0000-000000000001'

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
    throw new Error(body?.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtCurrency(v: string | number): string {
  return `$${Number(v).toFixed(2)}`
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Sub-component: Shift Report Card ─────────────────────────────────────────

function ShiftReportCard({ report, onDismiss }: { report: ShiftReport; onDismiss: () => void }) {
  const variance = Number(report.cash_variance)
  const varPositive = variance >= 0
  const variantColor = varPositive ? 'var(--success)' : 'var(--danger)'

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1.5rem',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
            Shift Closed — Summary Report
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {fmtDateTime(report.shift_opened_at)} &mdash; {fmtDateTime(report.shift_closed_at)}
          </p>
        </div>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: 'rgba(34,197,94,.12)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>

      <div
        className="rounded-lg divide-y mb-4"
        style={{ border: '1px solid var(--border)' }}
      >
        <ReportRow label="Opening Cash" value={fmtCurrency(report.opening_cash)} />
        <ReportRow label="Closing Cash" value={fmtCurrency(report.closing_cash)} />
        <ReportRow label="Expected Cash" value={fmtCurrency(report.expected_cash)} />
        <ReportRow
          label="Cash Variance"
          value={`${varPositive ? '+' : ''}${fmtCurrency(variance)}`}
          valueColor={variantColor}
          bold
        />
        <ReportRow label="Rentals Out" value={String(report.rentals_out)} />
        <ReportRow label="Rentals In (Returns)" value={String(report.rentals_in)} />
      </div>

      {report.variance_note_required && (
        <div
          className="rounded-lg px-3.5 py-3 mb-4 text-sm"
          style={{
            background: 'rgba(244,114,114,.08)',
            border: '1px solid rgba(244,114,114,.25)',
            color: 'var(--danger)',
          }}
        >
          Variance exceeds threshold. A manager review note may be required.
        </div>
      )}

      <button className="btn-primary w-full py-2.5 text-sm" onClick={onDismiss}>
        Start New Shift
      </button>
    </div>
  )
}

function ReportRow({
  label,
  value,
  valueColor,
  bold,
}: {
  label: string
  value: string
  valueColor?: string
  bold?: boolean
}) {
  return (
    <div className="flex justify-between items-center px-4 py-3 gap-4">
      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
        {label}
      </span>
      <span
        className={`text-xs ${bold ? 'font-bold' : 'font-medium'}`}
        style={{ color: valueColor ?? 'var(--text-1)' }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Sub-component: Open Shift Form ────────────────────────────────────────────

function OpenShiftForm({
  locationId,
  onSuccess,
}: {
  locationId: string
  onSuccess: () => void
}) {
  const [openingCash, setOpeningCash] = useState('')
  const [fleetCount, setFleetCount] = useState('')
  const [notes, setNotes] = useState('')

  const openMutation = useMutation({
    mutationFn: () =>
      fetchJSON(`/checkout/shift/open?location_id=${locationId}`, {
        method: 'POST',
        body: JSON.stringify({
          opening_cash: Number(openingCash),
          fleet_count_actual: Number(fleetCount),
          notes: notes.trim() || null,
        }),
      }),
    onSuccess,
  })

  const canSubmit = openingCash !== '' && fleetCount !== '' && !openMutation.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    openMutation.mutate()
  }

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1.5rem',
      }}
    >
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-1)' }}>
        Open Shift
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Opening Cash ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="field-input w-full text-sm"
            placeholder="0.00"
            value={openingCash}
            onChange={e => setOpeningCash(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Fleet Count (vehicles on lot)
          </label>
          <input
            type="number"
            min="0"
            step="1"
            className="field-input w-full text-sm"
            placeholder="e.g. 24"
            value={fleetCount}
            onChange={e => setFleetCount(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Notes{' '}
            <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            className="field-input w-full text-sm"
            rows={3}
            placeholder="Any handoff notes from previous shift..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={1000}
          />
        </div>

        {openMutation.isError && (
          <div
            className="rounded-lg px-3.5 py-3 text-sm"
            style={{
              background: 'rgba(244,114,114,.08)',
              border: '1px solid rgba(244,114,114,.25)',
              color: 'var(--danger)',
            }}
          >
            {openMutation.error instanceof Error
              ? openMutation.error.message
              : 'Failed to open shift. Please try again.'}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
          disabled={!canSubmit}
        >
          {openMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Opening Shift...
            </span>
          ) : (
            'Open Shift'
          )}
        </button>
      </form>
    </div>
  )
}

// ── Sub-component: Close Shift Form ───────────────────────────────────────────

function CloseShiftForm({
  locationId,
  openingCash,
  onSuccess,
}: {
  locationId: string
  openingCash: number
  onSuccess: (report: ShiftReport) => void
}) {
  const [closingCash, setClosingCash] = useState('')
  const [cardTotal, setCardTotal] = useState('')
  const [notes, setNotes] = useState('')

  const closeMutation = useMutation({
    mutationFn: () =>
      fetchJSON(`/checkout/shift/close?location_id=${locationId}`, {
        method: 'POST',
        body: JSON.stringify({
          closing_cash: Number(closingCash),
          credit_card_total: Number(cardTotal),
          notes: notes.trim() || null,
        }),
      }),
    onSuccess,
  })

  const canSubmit = closingCash !== '' && cardTotal !== '' && !closeMutation.isPending

  // Live variance preview
  const cashVariance =
    closingCash !== '' ? Number(closingCash) - openingCash : null
  const totalCollected =
    closingCash !== '' && cardTotal !== ''
      ? Number(closingCash) + Number(cardTotal)
      : null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    closeMutation.mutate()
  }

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1.5rem',
      }}
    >
      <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-1)' }}>
        Close Shift
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Closing Cash ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="field-input w-full text-sm"
            placeholder="0.00"
            value={closingCash}
            onChange={e => setClosingCash(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Card Total ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="field-input w-full text-sm"
            placeholder="0.00"
            value={cardTotal}
            onChange={e => setCardTotal(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Notes{' '}
            <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            className="field-input w-full text-sm"
            rows={3}
            placeholder="Any end-of-shift notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={1000}
          />
        </div>

        {/* Live summary preview */}
        {(cashVariance !== null || totalCollected !== null) && (
          <div
            className="rounded-lg divide-y"
            style={{ border: '1px solid var(--border)' }}
          >
            <div className="flex justify-between items-center px-4 py-2.5 gap-4">
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                Opening Cash
              </span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                {fmtCurrency(openingCash)}
              </span>
            </div>
            {closingCash !== '' && (
              <div className="flex justify-between items-center px-4 py-2.5 gap-4">
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Cash Variance
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color: cashVariance! >= 0 ? 'var(--success)' : 'var(--danger)',
                  }}
                >
                  {cashVariance! >= 0 ? '+' : ''}
                  {fmtCurrency(cashVariance!)}
                </span>
              </div>
            )}
            {cardTotal !== '' && (
              <div className="flex justify-between items-center px-4 py-2.5 gap-4">
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Card Total
                </span>
                <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                  {fmtCurrency(Number(cardTotal))}
                </span>
              </div>
            )}
            {totalCollected !== null && (
              <div className="flex justify-between items-center px-4 py-2.5 gap-4">
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Total Collected
                </span>
                <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>
                  {fmtCurrency(totalCollected)}
                </span>
              </div>
            )}
          </div>
        )}

        {closeMutation.isError && (
          <div
            className="rounded-lg px-3.5 py-3 text-sm"
            style={{
              background: 'rgba(244,114,114,.08)',
              border: '1px solid rgba(244,114,114,.25)',
              color: 'var(--danger)',
            }}
          >
            {closeMutation.error instanceof Error
              ? closeMutation.error.message
              : 'Failed to close shift. Please try again.'}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
          disabled={!canSubmit}
        >
          {closeMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Closing Shift...
            </span>
          ) : (
            'Close Shift'
          )}
        </button>
      </form>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ShiftPage() {
  const qc = useQueryClient()
  const [locationId, setLocationId] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [shiftReport, setShiftReport] = useState<ShiftReport | null>(null)

  // Fetch locations for dropdown
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: () => fetchJSON('/locations'),
  })

  // Auto-select first location once loaded
  const resolvedLocationId =
    locationId || (locations.length > 0 ? locations[0].location_id : '')

  // Fetch current shift status
  const {
    data: shiftStatus,
    isLoading: shiftLoading,
    refetch: refetchShift,
  } = useQuery<ShiftCurrentResponse>({
    queryKey: ['shift-current', resolvedLocationId],
    queryFn: () => fetchJSON(`/checkout/shift/current?location_id=${resolvedLocationId}`),
    enabled: !!resolvedLocationId,
    refetchInterval: 30000,
  })

  function handleLocationChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setLocationId(e.target.value)
    setSuccessMsg('')
    setShiftReport(null)
    qc.invalidateQueries({ queryKey: ['shift-current'] })
  }

  function handleOpenSuccess() {
    setSuccessMsg('Shift opened successfully.')
    setShiftReport(null)
    qc.invalidateQueries({ queryKey: ['shift-current', resolvedLocationId] })
  }

  function handleCloseSuccess(report: ShiftReport) {
    setShiftReport(report)
    setSuccessMsg('')
    qc.invalidateQueries({ queryKey: ['shift-current', resolvedLocationId] })
  }

  function handleDismissReport() {
    setShiftReport(null)
    refetchShift()
  }

  const isOpen = shiftStatus?.status === 'OPEN'

  return (
    <div className="page-root">
      <div style={{ padding: '0 2rem', maxWidth: 640 }}>
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>
            Shift Management
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
            Open or close your cash shift for a location.
          </p>
        </div>

        {/* Location selector */}
        <div
          className="mb-4"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            padding: '1rem 1.5rem',
          }}
        >
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-2)' }}>
            Location
          </label>
          <select
            className="field-input w-full text-sm"
            value={resolvedLocationId}
            onChange={handleLocationChange}
          >
            {locations.length === 0 && (
              <option value="">Loading locations...</option>
            )}
            {locations.map(loc => (
              <option key={loc.location_id} value={loc.location_id}>
                {loc.short_code} — {loc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Current shift status card */}
        {resolvedLocationId && (
          <div
            className="mb-4"
            style={{
              background: 'var(--card-bg)',
              border: `1px solid ${isOpen ? 'rgba(34,197,94,.35)' : 'var(--border)'}`,
              borderRadius: '0.5rem',
              padding: '1rem 1.5rem',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-3)' }}>
                  Current Shift Status
                </p>
                {shiftLoading ? (
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                    Checking shift...
                  </p>
                ) : isOpen && shiftStatus ? (
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
                      Shift Open
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                      Opened: {fmtDateTime(shiftStatus.opened_at!)}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      Opening cash: {fmtCurrency(shiftStatus.opening_cash!)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-3)' }}>
                    No Open Shift
                  </p>
                )}
              </div>
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full shrink-0"
                style={{
                  background: isOpen
                    ? 'rgba(34,197,94,.12)'
                    : 'rgba(148,163,184,.1)',
                }}
              >
                {isOpen ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Success message */}
        {successMsg && (
          <div
            className="rounded-lg px-3.5 py-3 mb-4 text-sm"
            style={{
              background: 'rgba(34,197,94,.08)',
              border: '1px solid rgba(34,197,94,.25)',
              color: 'var(--success)',
            }}
          >
            {successMsg}
          </div>
        )}

        {/* Shift report after close */}
        {shiftReport && (
          <ShiftReportCard report={shiftReport} onDismiss={handleDismissReport} />
        )}

        {/* Open / Close forms — shown when no report is displayed */}
        {!shiftReport && resolvedLocationId && !shiftLoading && (
          <>
            {!isOpen && (
              <OpenShiftForm
                locationId={resolvedLocationId}
                onSuccess={handleOpenSuccess}
              />
            )}
            {isOpen && (
              <CloseShiftForm
                locationId={resolvedLocationId}
                openingCash={Number(shiftStatus?.opening_cash ?? 0)}
                onSuccess={handleCloseSuccess}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
