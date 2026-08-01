import { tenantId } from '../tenant'
import { useState, useMemo, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ── Types ─────────────────────────────────────────────────────────────────────


type ClaimStatus =
  | 'OPEN'
  | 'ESTIMATE_SENT'
  | 'CUSTOMER_ACKNOWLEDGED'
  | 'REPAIR_IN_PROGRESS'
  | 'REPAIR_COMPLETE'
  | 'INVOICED'
  | 'PAID'
  | 'DISPUTED'
  | 'IN_LITIGATION'
  | 'WRITTEN_OFF'

type Severity =
  | 'GRADE_1_COSMETIC'
  | 'GRADE_2_MINOR'
  | 'GRADE_3_MODERATE'
  | 'GRADE_4_SEVERE'
  | 'GRADE_5_TOTAL_LOSS'

type DamageClaim = {
  claim_id: string
  claim_reference: string
  rental_agreement_id: string
  vehicle_id: string
  customer_id: string
  status: ClaimStatus
  severity: Severity
  damage_zone: string
  damage_type: string
  zone_data: Array<{ zone_name: string; pre_condition: string; post_condition: string; is_new_damage: boolean }> | null
  cdw_covered: boolean
  cdw_void_reason: string | null
  repair_estimate: string | number | null
  repair_actual: string | number | null
  loss_of_use_days: number
  loss_of_use_total: string | number | null
  admin_fee: string | number
  total_claim_amount: string | number | null
  notes: string | null
  inspector_id: string | null
  adjuster_id: string | null
  created_at: string
  updated_at: string
}

type LOUResult = {
  claim_id: string
  lou_days: number
  daily_rate: string
  utilization_factor: string
  lou_amount: string
}

type RentalAgreement = {
  ra_id: string
  ra_number: string
  reservation_id: string | null
  customer_id: string | null
  vehicle_id: string | null
  status: string
}

type Customer = {
  customer_id: string
  first_name: string
  last_name: string
  email: string
}

type Vehicle = {
  vehicle_id: string
  make: string
  model: string
  model_year: number
  plate_number: string | null
}

// ── Status metadata ───────────────────────────────────────────────────────────

const STATUS_META: Record<ClaimStatus, { label: string; color: string; bg: string; border: string }> = {
  OPEN:                   { label: 'Open',                color: '#6366f1', bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.3)'  },
  ESTIMATE_SENT:          { label: 'Estimate Sent',       color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)'  },
  CUSTOMER_ACKNOWLEDGED:  { label: 'Cust. Acknowledged',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)'  },
  REPAIR_IN_PROGRESS:     { label: 'Repair In Progress',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)'  },
  REPAIR_COMPLETE:        { label: 'Repair Complete',     color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)'  },
  INVOICED:               { label: 'Invoiced',            color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)'  },
  PAID:                   { label: 'Paid',                color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)' },
  DISPUTED:               { label: 'Disputed',            color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)'   },
  IN_LITIGATION:          { label: 'In Litigation',       color: '#dc2626', bg: 'rgba(220,38,38,0.1)',  border: 'rgba(220,38,38,0.3)'   },
  WRITTEN_OFF:            { label: 'Written Off',         color: '#6b7280', bg: 'rgba(107,114,128,0.1)',border: 'rgba(107,114,128,0.3)' },
}

const SEVERITY_META: Record<Severity, { label: string; short: string; color: string; bg: string }> = {
  GRADE_1_COSMETIC:   { label: 'Cosmetic',   short: 'G1', color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  GRADE_2_MINOR:      { label: 'Minor',      short: 'G2', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  GRADE_3_MODERATE:   { label: 'Moderate',   short: 'G3', color: '#f97316', bg: 'rgba(249,115,22,0.1)'  },
  GRADE_4_SEVERE:     { label: 'Severe',     short: 'G4', color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
  GRADE_5_TOTAL_LOSS: { label: 'Total Loss', short: 'G5', color: '#dc2626', bg: 'rgba(220,38,38,0.12)'  },
}

const CLAIM_TRANSITIONS: Record<ClaimStatus, ClaimStatus[]> = {
  OPEN:                   ['ESTIMATE_SENT', 'WRITTEN_OFF'],
  ESTIMATE_SENT:          ['CUSTOMER_ACKNOWLEDGED', 'DISPUTED'],
  CUSTOMER_ACKNOWLEDGED:  ['REPAIR_IN_PROGRESS'],
  REPAIR_IN_PROGRESS:     ['REPAIR_COMPLETE'],
  REPAIR_COMPLETE:        ['INVOICED'],
  INVOICED:               ['PAID', 'DISPUTED'],
  DISPUTED:               ['IN_LITIGATION', 'REPAIR_IN_PROGRESS'],
  IN_LITIGATION:          ['PAID', 'WRITTEN_OFF'],
  PAID:                   [],
  WRITTEN_OFF:            [],
}

const STATUS_FILTER_TABS: { label: string; value: string }[] = [
  { label: 'All Claims', value: '' },
  { label: 'Open',       value: 'OPEN' },
  { label: 'Active',     value: 'ESTIMATE_SENT' },
  { label: 'Repair',     value: 'REPAIR_IN_PROGRESS' },
  { label: 'Invoiced',   value: 'INVOICED' },
  { label: 'Disputed',   value: 'DISPUTED' },
  { label: 'Closed',     value: 'PAID' },
]

const SEVERITY_OPTIONS: { value: number; grade: Severity; label: string }[] = [
  { value: 1, grade: 'GRADE_1_COSMETIC',   label: 'Grade 1 - Cosmetic (scratches, scuffs)' },
  { value: 2, grade: 'GRADE_2_MINOR',      label: 'Grade 2 - Minor (small dents)' },
  { value: 3, grade: 'GRADE_3_MODERATE',   label: 'Grade 3 - Moderate (panel damage)' },
  { value: 4, grade: 'GRADE_4_SEVERE',     label: 'Grade 4 - Severe (structural)' },
  { value: 5, grade: 'GRADE_5_TOTAL_LOSS', label: 'Grade 5 - Total Loss' },
]

const VEHICLE_ZONES = [
  'FRONT_LEFT', 'FRONT_CENTER', 'FRONT_RIGHT',
  'ROOF_FRONT', 'ROOF_CENTER', 'ROOF_REAR',
  'REAR_LEFT', 'REAR_CENTER', 'REAR_RIGHT',
  'DOOR_FRONT_LEFT', 'DOOR_FRONT_RIGHT',
  'DOOR_REAR_LEFT', 'DOOR_REAR_RIGHT',
  'MIRROR_LEFT', 'MIRROR_RIGHT',
  'WINDSHIELD_FRONT', 'WINDSHIELD_REAR',
  'UNDERBODY_FRONT', 'UNDERBODY_REAR',
  'INTERIOR_FRONT', 'INTERIOR_REAR',
  'TRUNK',
]

const ZONE_CONDITIONS = ['GOOD', 'SCRATCHED', 'DENTED', 'CRACKED', 'MISSING', 'BROKEN']

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string): Promise<unknown> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { 'X-Tenant-ID': tenantId() },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((body?.detail as string) ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((data?.detail as string) ?? `HTTP ${res.status}`)
  }
  return res.json()
}

function fetchClaims(status: string): Promise<DamageClaim[]> {
  const qs = status ? `?status=${status}&limit=100` : '?limit=100'
  return apiFetch(`/damage/claims${qs}`) as Promise<DamageClaim[]>
}

function fetchCustomer(customerId: string): Promise<Customer> {
  return apiFetch(`/customers/${customerId}`) as Promise<Customer>
}

function fetchVehicle(vehicleId: string): Promise<Vehicle> {
  return apiFetch(`/fleet/vehicles/${vehicleId}`) as Promise<Vehicle>
}

function fetchAgreements(): Promise<RentalAgreement[]> {
  return apiFetch('/checkout/agreements?limit=200') as Promise<RentalAgreement[]>
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt$(v: string | number | null | undefined): string {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtZoneName(zone: string): string {
  return zone.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1.5"
       style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function StatusBadge({ status }: { status: ClaimStatus }) {
  const m = STATUS_META[status]
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={{ background: m?.bg ?? 'var(--elevated)', color: m?.color ?? 'var(--text-2)', border: `1px solid ${m?.border ?? 'var(--border)'}` }}>
      {m?.label ?? status}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity]
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={{ background: m?.bg ?? 'var(--elevated)', color: m?.color ?? 'var(--text-2)' }}>
      {m?.label ?? severity}
    </span>
  )
}

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
      background: ok ? 'rgba(16,185,129,0.15)' : 'var(--danger-bg)',
      color: ok ? '#10b981' : 'var(--danger)',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }}>{msg}</div>
  )
}

// ── Claim Drawer ──────────────────────────────────────────────────────────────

function ClaimDrawer({
  claim,
  onClose,
  onUpdated,
}: {
  claim: DamageClaim
  onClose: () => void
  onUpdated: () => void
}) {
  const qc = useQueryClient()
  const [newStatus, setNewStatus] = useState<ClaimStatus | ''>('')
  const [statusReason, setStatusReason] = useState('')
  const [louResult, setLouResult] = useState<LOUResult | null>(null)
  const [louLoading, setLouLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const { data: customer } = useQuery<Customer>({
    queryKey: ['customer', claim.customer_id],
    queryFn: () => fetchCustomer(claim.customer_id),
    staleTime: 300_000,
    enabled: !!claim.customer_id,
  })

  const { data: vehicle } = useQuery<Vehicle>({
    queryKey: ['vehicle', claim.vehicle_id],
    queryFn: () => fetchVehicle(claim.vehicle_id),
    staleTime: 300_000,
    enabled: !!claim.vehicle_id,
  })

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const statusMutation = useMutation({
    mutationFn: () => apiPost(`/damage/claims/${claim.claim_id}/status`, {
      new_status: newStatus,
      reason: statusReason,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['damage-claims'] })
      onUpdated()
      setNewStatus('')
      setStatusReason('')
      showToast('Status updated successfully', true)
    },
    onError: (e: Error) => showToast(e.message, false),
  })

  async function handleLOU() {
    setLouLoading(true)
    try {
      const result = await apiFetch(`/damage/claims/${claim.claim_id}/lou`) as LOUResult
      setLouResult(result)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'LOU calculation failed', false)
    } finally {
      setLouLoading(false)
    }
  }

  const transitions = CLAIM_TRANSITIONS[claim.status as ClaimStatus] ?? []
  const sm = STATUS_META[claim.status as ClaimStatus]
  const sevm = SEVERITY_META[claim.severity as Severity]

  const notesLines = (claim.notes ?? '').split('\n').filter(Boolean)

  return (
    <>
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.4)',
        }}
        onClick={onClose}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 201,
          width: 'min(560px, 90vw)',
          background: 'var(--card-bg)',
          borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-4 flex items-start justify-between gap-3"
             style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
                {claim.claim_reference}
              </span>
              <StatusBadge status={claim.status as ClaimStatus} />
              <SeverityBadge severity={claim.severity as Severity} />
            </div>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Opened {fmtDate(claim.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--elevated)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Vehicle + rental info */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Vehicle & Rental</SectionLabel>
            {[
              { label: 'Vehicle', value: vehicle ? `${vehicle.model_year} ${vehicle.make} ${vehicle.model}${vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''}` : claim.vehicle_id.slice(0, 8) },
              { label: 'Customer', value: customer ? `${customer.first_name} ${customer.last_name}` : claim.customer_id.slice(0, 8) },
              { label: 'RA ID', value: claim.rental_agreement_id.slice(0, 8).toUpperCase() },
              { label: 'CDW', value: claim.cdw_covered ? 'Covered' : claim.cdw_void_reason ? `Voided — ${claim.cdw_void_reason}` : 'Not covered' },
            ].map(row => (
              <div key={row.label} className="flex items-start justify-between gap-3 py-0.5"
                   style={{ borderBottom: '1px solid var(--border-sub)' }}>
                <span className="text-[11.5px] shrink-0" style={{ color: 'var(--text-3)' }}>{row.label}</span>
                <span className="text-[11.5px] font-medium text-right" style={{ color: claim.cdw_covered && row.label === 'CDW' ? '#10b981' : 'var(--text-1)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Damage details */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Damage Details</SectionLabel>
            <div className="flex items-start justify-between gap-3 py-0.5" style={{ borderBottom: '1px solid var(--border-sub)' }}>
              <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Primary Zone</span>
              <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-1)' }}>{fmtZoneName(claim.damage_zone)}</span>
            </div>
            <div className="flex items-start justify-between gap-3 py-0.5" style={{ borderBottom: '1px solid var(--border-sub)' }}>
              <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Damage Type</span>
              <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-1)' }}>{claim.damage_type}</span>
            </div>
            <div className="flex items-start justify-between gap-3 py-0.5" style={{ borderBottom: '1px solid var(--border-sub)' }}>
              <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Severity</span>
              <span className="text-[11.5px] font-medium" style={{ color: sevm?.color ?? 'var(--text-1)' }}>{sevm?.label ?? claim.severity}</span>
            </div>
            {claim.zone_data && claim.zone_data.length > 0 && (
              <div className="pt-1">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>
                  Affected Zones
                </p>
                <div className="space-y-1">
                  {claim.zone_data.map((z, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="font-medium" style={{ color: 'var(--text-2)' }}>{fmtZoneName(z.zone_name)}</span>
                      <span style={{ color: 'var(--text-3)' }}>
                        {z.pre_condition} → {z.post_condition}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Financials */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Financials</SectionLabel>
            {[
              { label: 'Repair Estimate', value: fmt$(claim.repair_estimate) },
              { label: 'Repair Actual',   value: fmt$(claim.repair_actual) },
              { label: 'Admin Fee',       value: fmt$(claim.admin_fee) },
              { label: 'Total Claim',     value: fmt$(claim.total_claim_amount) },
              { label: 'LOU Days',        value: claim.loss_of_use_days > 0 ? `${claim.loss_of_use_days} days` : '—' },
              { label: 'LOU Total',       value: fmt$(claim.loss_of_use_total) },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between gap-3 py-0.5"
                   style={{ borderBottom: '1px solid var(--border-sub)' }}>
                <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{row.label}</span>
                <span className="text-[11.5px] font-semibold num" style={{ color: 'var(--text-1)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* LOU Calculator */}
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Loss of Use</SectionLabel>
            {louResult ? (
              <div className="space-y-1.5">
                {[
                  { label: 'LOU Days',            value: `${louResult.lou_days}` },
                  { label: 'Daily Rate',           value: `$${Number(louResult.daily_rate).toFixed(2)}` },
                  { label: 'Utilization Factor',   value: `${(Number(louResult.utilization_factor) * 100).toFixed(1)}%` },
                  { label: 'LOU Amount',           value: `$${Number(louResult.lou_amount).toFixed(2)}` },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between text-[11.5px] py-0.5"
                       style={{ borderBottom: '1px solid var(--border-sub)' }}>
                    <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
                    <span className="font-semibold num" style={{ color: 'var(--text-1)' }}>{row.value}</span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setLouResult(null)}
                  className="text-[11px] mt-1"
                  style={{ color: 'var(--text-3)' }}
                >
                  Recalculate
                </button>
              </div>
            ) : (
              <div>
                <p className="text-[12px] mb-2" style={{ color: 'var(--text-3)' }}>
                  Estimate revenue lost while vehicle is out of service for repairs.
                </p>
                <button
                  type="button"
                  onClick={handleLOU}
                  disabled={louLoading}
                  className="btn-secondary text-[12px] py-1.5 px-3"
                >
                  {louLoading ? 'Calculating...' : 'Calculate Loss of Use'}
                </button>
              </div>
            )}
          </div>

          {/* Notes / Timeline */}
          {notesLines.length > 0 && (
            <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
              <SectionLabel>Notes / Timeline</SectionLabel>
              <div className="space-y-1.5">
                {notesLines.map((line, i) => (
                  <p key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>{line}</p>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer — status update */}
        <div className="shrink-0 px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
          {transitions.length > 0 ? (
            <>
              <SectionLabel>Advance Status</SectionLabel>
              <div className="flex flex-col gap-2">
                <select
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value as ClaimStatus | '')}
                  className="field-input h-9 px-3 text-[13px] w-full"
                >
                  <option value="">Select next status…</option>
                  {transitions.map(s => (
                    <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
                  ))}
                </select>
                <textarea
                  value={statusReason}
                  onChange={e => setStatusReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Reason for status change (required)…"
                  className="field-input w-full px-3 py-2 text-[13px] resize-none"
                />
                <button
                  type="button"
                  onClick={() => statusMutation.mutate()}
                  disabled={!newStatus || !statusReason.trim() || statusMutation.isPending}
                  className="btn-primary disabled:opacity-50"
                >
                  {statusMutation.isPending ? 'Updating…' : 'Update Status'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12px] text-center" style={{ color: 'var(--text-3)' }}>
              This claim has reached a terminal state ({sm?.label ?? claim.status}) and cannot be advanced further.
            </p>
          )}
        </div>
      </aside>
    </>
  )
}

// ── New Claim Dialog ──────────────────────────────────────────────────────────

function NewClaimDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [raInput, setRaInput] = useState('')
  const [raLookupDone, setRaLookupDone] = useState(false)
  const [selectedRA, setSelectedRA] = useState<RentalAgreement | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [selectedZone, setSelectedZone] = useState(VEHICLE_ZONES[0])
  const [preCondition, setPreCondition] = useState('GOOD')
  const [postCondition, setPostCondition] = useState('DENTED')
  const [severity, setSeverity] = useState(2)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleRALookup() {
    if (!raInput.trim()) return
    setLookupLoading(true)
    setLookupError('')
    try {
      const agreements = await fetchAgreements()
      const upper = raInput.trim().toUpperCase()
      const found = agreements.find(a => a.ra_number.toUpperCase() === upper)
      if (!found) {
        setLookupError(`No rental agreement found for "${raInput.trim()}"`)
        return
      }
      setSelectedRA(found)
      setRaLookupDone(true)
      if (found.customer_id) {
        const cust = await fetchCustomer(found.customer_id)
        setCustomer(cust)
      }
      if (found.vehicle_id) {
        const veh = await fetchVehicle(found.vehicle_id)
        setVehicle(veh)
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLookupLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedRA) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await apiPost('/damage/claims', {
        rental_agreement_id: selectedRA.ra_id,
        zone_data_diff: [
          { zone_name: selectedZone, pre_condition: preCondition, post_condition: postCondition, is_new_damage: true },
        ],
        severity,
        photos: [],
        notes: notes || null,
      })
      showToast('Claim opened successfully', true)
      setTimeout(() => { onCreated(); onClose() }, 1200)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create claim')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
           onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* Dialog header */}
          <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>Open Damage Claim</h2>
            <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md"
                    style={{ color: 'var(--text-3)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Dialog body */}
          <form id="new-claim-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* RA Lookup */}
            <div>
              <SectionLabel>Rental Agreement</SectionLabel>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={raInput}
                  onChange={e => { setRaInput(e.target.value); setRaLookupDone(false); setSelectedRA(null); setCustomer(null); setVehicle(null); setLookupError('') }}
                  placeholder="RA-20260617-XXXXX"
                  className="field-input flex-1 h-9 px-3 text-[13px]"
                  disabled={raLookupDone}
                />
                {raLookupDone ? (
                  <button type="button" onClick={() => { setRaLookupDone(false); setSelectedRA(null); setCustomer(null); setVehicle(null) }}
                          className="btn-secondary text-[12px] px-3">
                    Change
                  </button>
                ) : (
                  <button type="button" onClick={handleRALookup} disabled={!raInput.trim() || lookupLoading}
                          className="btn-secondary text-[12px] px-3 disabled:opacity-50">
                    {lookupLoading ? 'Looking up…' : 'Look Up'}
                  </button>
                )}
              </div>
              {lookupError && <p className="text-[11.5px] mt-1" style={{ color: 'var(--danger)' }}>{lookupError}</p>}
            </div>

            {/* Auto-filled details */}
            {raLookupDone && selectedRA && (
              <div className="rounded-lg px-3.5 py-3 space-y-1.5" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                {customer && (
                  <div className="flex items-center justify-between text-[12px]">
                    <span style={{ color: 'var(--text-3)' }}>Customer</span>
                    <span className="font-medium" style={{ color: 'var(--text-1)' }}>{customer.first_name} {customer.last_name}</span>
                  </div>
                )}
                {vehicle && (
                  <div className="flex items-center justify-between text-[12px]">
                    <span style={{ color: 'var(--text-3)' }}>Vehicle</span>
                    <span className="font-medium" style={{ color: 'var(--text-1)' }}>{vehicle.model_year} {vehicle.make} {vehicle.model}{vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[12px]">
                  <span style={{ color: 'var(--text-3)' }}>RA Status</span>
                  <span className="font-medium" style={{ color: 'var(--text-1)' }}>{selectedRA.status}</span>
                </div>
              </div>
            )}

            {/* Damage zone */}
            <div>
              <SectionLabel>Primary Damage Zone</SectionLabel>
              <select value={selectedZone} onChange={e => setSelectedZone(e.target.value)}
                      className="field-input h-9 px-3 text-[13px] w-full">
                {VEHICLE_ZONES.map(z => <option key={z} value={z}>{fmtZoneName(z)}</option>)}
              </select>
            </div>

            {/* Conditions */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>Pre-Rental Condition</SectionLabel>
                <select value={preCondition} onChange={e => setPreCondition(e.target.value)}
                        className="field-input h-9 px-3 text-[13px] w-full">
                  {ZONE_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <SectionLabel>Post-Rental Condition</SectionLabel>
                <select value={postCondition} onChange={e => setPostCondition(e.target.value)}
                        className="field-input h-9 px-3 text-[13px] w-full">
                  {ZONE_CONDITIONS.filter(c => c !== 'GOOD').map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Severity */}
            <div>
              <SectionLabel>Severity</SectionLabel>
              <select value={severity} onChange={e => setSeverity(Number(e.target.value))}
                      className="field-input h-9 px-3 text-[13px] w-full">
                {SEVERITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <SectionLabel>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000}
                        placeholder="Describe the damage, circumstances, or any relevant details…"
                        className="field-input w-full px-3 py-2 text-[13px] resize-none" />
            </div>

            {submitError && (
              <p className="text-[12px] rounded-lg px-3 py-2" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {submitError}
              </p>
            )}

          </form>

          {/* Dialog footer */}
          <div className="shrink-0 flex items-center justify-end gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button
              type="submit"
              form="new-claim-form"
              disabled={!raLookupDone || submitting}
              className="btn-primary disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Open Claim'}
            </button>
          </div>

        </div>
      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function DamagePage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedClaim, setSelectedClaim] = useState<DamageClaim | null>(null)
  const [showNewClaim, setShowNewClaim] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const { data: claims = [], isLoading } = useQuery<DamageClaim[]>({
    queryKey: ['damage-claims', statusFilter],
    queryFn: () => fetchClaims(statusFilter),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return claims
    const q = search.toLowerCase()
    return claims.filter(c =>
      c.claim_reference.toLowerCase().includes(q) ||
      c.damage_zone.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q) ||
      c.rental_agreement_id.toLowerCase().includes(q)
    )
  }, [claims, search])

  function handleDrawerUpdate() {
    const curr = selectedClaim
    qc.invalidateQueries({ queryKey: ['damage-claims'] }).then(() => {
      if (curr) {
        setSelectedClaim(claims.find(c => c.claim_id === curr.claim_id) ?? null)
      }
    })
  }

  const openCount   = claims.filter(c => c.status === 'OPEN').length
  const activeCount = claims.filter(c => !['OPEN', 'PAID', 'WRITTEN_OFF'].includes(c.status)).length

  return (
    <div className="space-y-5 max-w-full">
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
            Damage Claims
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            Track vehicle damage from report through settlement
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewClaim(true)}
          className="btn-primary shrink-0"
        >
          Open Claim
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Claims',   value: claims.length,  color: 'var(--text-1)' },
          { label: 'Open',           value: openCount,      color: '#6366f1' },
          { label: 'In Progress',    value: activeCount,    color: '#3b82f6' },
          { label: 'Closed',         value: claims.filter(c => c.status === 'PAID' || c.status === 'WRITTEN_OFF').length, color: '#10b981' },
        ].map(stat => (
          <div key={stat.label} className="panel px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{stat.label}</p>
            <p className="text-[22px] font-bold num mt-0.5" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="panel px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_FILTER_TABS.map(tab => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusFilter(tab.value)}
                className="rounded-md px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  background: statusFilter === tab.value ? 'var(--accent)' : 'var(--elevated)',
                  color: statusFilter === tab.value ? 'white' : 'var(--text-2)',
                  border: `1px solid ${statusFilter === tab.value ? 'transparent' : 'var(--border)'}`,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative ml-auto">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="search"
              placeholder="Search claims…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field-input h-8 pl-8 pr-3 text-[12px] w-48"
            />
          </div>
        </div>
      </div>

      {/* Claims table */}
      <div className="panel overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>Loading claims…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-3)' }}>
              <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/>
              <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
              <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/>
              <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/>
              <path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/>
              <path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/>
              <path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"/>
              <path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z"/>
            </svg>
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              {search ? 'No claims match your search' : 'No damage claims found'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Claim #', 'Zone / Type', 'Status', 'Severity', 'Date Opened', 'Estimate', 'CDW'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest"
                        style={{ color: 'var(--text-3)', background: 'var(--elevated)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((claim, i) => (
                  <tr
                    key={claim.claim_id}
                    onClick={() => setSelectedClaim(claim)}
                    style={{
                      borderBottom: '1px solid var(--border-sub)',
                      cursor: 'pointer',
                      background: i % 2 === 0 ? 'transparent' : 'var(--elevated)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)10' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'transparent' : 'var(--elevated)' }}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                        {claim.claim_reference}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[12px] font-medium" style={{ color: 'var(--text-1)' }}>{fmtZoneName(claim.damage_zone)}</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{claim.damage_type}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={claim.status as ClaimStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={claim.severity as Severity} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{fmtDate(claim.created_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold num" style={{ color: 'var(--text-1)' }}>
                        {fmt$(claim.repair_estimate)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {claim.cdw_covered ? (
                        <span className="text-[11px] font-semibold" style={{ color: '#10b981' }}>Covered</span>
                      ) : (
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Claim drawer */}
      {selectedClaim && (
        <ClaimDrawer
          claim={selectedClaim}
          onClose={() => setSelectedClaim(null)}
          onUpdated={handleDrawerUpdate}
        />
      )}

      {/* New claim dialog */}
      {showNewClaim && (
        <NewClaimDialog
          onClose={() => setShowNewClaim(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['damage-claims'] })
            showToast('Damage claim opened', true)
          }}
        />
      )}
    </div>
  )
}
