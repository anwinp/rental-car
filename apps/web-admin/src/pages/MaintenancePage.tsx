import { tenantId } from '../tenant'
import { useState, useMemo, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ── Constants ─────────────────────────────────────────────────────────────────


// ── Types ─────────────────────────────────────────────────────────────────────

type MaintenanceType = 'PREVENTIVE' | 'CORRECTIVE' | 'RECALL' | 'INSPECTION'

type WorkOrderStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'

type WorkOrder = {
  id: string
  wo_number: string
  vehicle_id: string
  maintenance_type: MaintenanceType
  status: WorkOrderStatus
  description: string
  scheduled_date: string
  estimated_duration_hours: number
  estimated_cost: number
  actual_cost: number | null
  actual_start_date: string | null
  actual_end_date: string | null
  technician: string
  notes: string
  parts: string
  created_at: string
}

type Vehicle = {
  vehicle_id: string
  make: string
  model: string
  model_year: number
  plate_number: string | null
  status: string
}

// ── Status metadata ───────────────────────────────────────────────────────────

const STATUS_META: Record<WorkOrderStatus, { label: string; color: string; bg: string; border: string }> = {
  SCHEDULED:   { label: 'Scheduled',   color: '#6366f1', bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.3)'  },
  IN_PROGRESS: { label: 'In Progress', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)'  },
  COMPLETED:   { label: 'Completed',   color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)'  },
  CANCELLED:   { label: 'Cancelled',   color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.3)' },
}

const TYPE_META: Record<MaintenanceType, { label: string; color: string }> = {
  PREVENTIVE: { label: 'Preventive', color: '#3b82f6' },
  CORRECTIVE: { label: 'Corrective', color: '#ef4444' },
  RECALL:     { label: 'Recall',     color: '#f97316' },
  INSPECTION: { label: 'Inspection', color: '#8b5cf6' },
}

const WO_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  SCHEDULED:   ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED:   [],
  CANCELLED:   [],
}

const STATUS_FILTER_TABS: { label: string; value: string }[] = [
  { label: 'All',         value: '' },
  { label: 'Scheduled',   value: 'SCHEDULED' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Completed',   value: 'COMPLETED' },
  { label: 'Cancelled',   value: 'CANCELLED' },
]

const MAINTENANCE_TYPE_OPTIONS: { value: MaintenanceType; label: string }[] = [
  { value: 'PREVENTIVE', label: 'Preventive — Scheduled routine service' },
  { value: 'CORRECTIVE', label: 'Corrective — Repair of identified fault' },
  { value: 'RECALL',     label: 'Recall — Manufacturer safety recall' },
  { value: 'INSPECTION', label: 'Inspection — Safety or regulatory check' },
]

// ── Seeded demo work orders ───────────────────────────────────────────────────

const INITIAL_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-001',
    wo_number: 'WO-2026-001',
    vehicle_id: '',
    maintenance_type: 'PREVENTIVE',
    status: 'COMPLETED',
    description: 'Oil change and 10,000-mile service',
    scheduled_date: '2026-05-15',
    estimated_duration_hours: 2,
    estimated_cost: 120,
    actual_cost: 115,
    actual_start_date: '2026-05-15',
    actual_end_date: '2026-05-15',
    technician: 'Marcus Webb',
    notes: 'Replaced oil filter, topped off fluids. Tires in good shape.',
    parts: 'Oil filter, 5qt synthetic oil',
    created_at: '2026-05-10T10:00:00Z',
  },
  {
    id: 'wo-002',
    wo_number: 'WO-2026-002',
    vehicle_id: '',
    maintenance_type: 'CORRECTIVE',
    status: 'IN_PROGRESS',
    description: 'Brake pad replacement — front axle',
    scheduled_date: '2026-06-17',
    estimated_duration_hours: 3,
    estimated_cost: 380,
    actual_cost: null,
    actual_start_date: '2026-06-17',
    actual_end_date: null,
    technician: 'Dana Park',
    notes: 'Customer reported squealing. Front pads worn to 2mm.',
    parts: 'Front brake pad set, brake dust spray',
    created_at: '2026-06-14T09:00:00Z',
  },
  {
    id: 'wo-003',
    wo_number: 'WO-2026-003',
    vehicle_id: '',
    maintenance_type: 'INSPECTION',
    status: 'SCHEDULED',
    description: 'State safety inspection — annual',
    scheduled_date: '2026-06-25',
    estimated_duration_hours: 1,
    estimated_cost: 50,
    actual_cost: null,
    actual_start_date: null,
    actual_end_date: null,
    technician: 'Luis Ortega',
    notes: '',
    parts: '',
    created_at: '2026-06-15T08:00:00Z',
  },
  {
    id: 'wo-004',
    wo_number: 'WO-2026-004',
    vehicle_id: '',
    maintenance_type: 'RECALL',
    status: 'SCHEDULED',
    description: 'Airbag inflator recall — NHTSA ref 24V-123',
    scheduled_date: '2026-07-03',
    estimated_duration_hours: 4,
    estimated_cost: 0,
    actual_cost: null,
    actual_start_date: null,
    actual_end_date: null,
    technician: 'Marcus Webb',
    notes: 'Parts on order from manufacturer. Customer notified.',
    parts: 'Airbag inflator assembly (manufacturer supplied)',
    created_at: '2026-06-01T11:00:00Z',
  },
]

let WO_COUNTER = 5

function generateWONumber(): string {
  const n = String(WO_COUNTER++).padStart(3, '0')
  return `WO-2026-${n}`
}

function generateId(): string {
  return `wo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// ── fetchJSON ─────────────────────────────────────────────────────────────────

async function fetchJSON(path: string, opts?: RequestInit): Promise<unknown> {
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
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((body?.detail as string) ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  if (v == null) return '—'
  return `$${Number(v).toFixed(2)}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function vehicleLabel(v: Vehicle): string {
  const plate = v.plate_number ? ` · ${v.plate_number}` : ''
  return `${v.model_year} ${v.make} ${v.model}${plate}`
}

function thisMonthCompletedCount(orders: WorkOrder[]): number {
  const now = new Date()
  return orders.filter(w => {
    if (w.status !== 'COMPLETED' || !w.actual_end_date) return false
    const d = new Date(w.actual_end_date)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length
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

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const m = STATUS_META[status]
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
      {m.label}
    </span>
  )
}

function TypeBadge({ type }: { type: MaintenanceType }) {
  const m = TYPE_META[type]
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium"
          style={{ background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}40` }}>
      {m.label}
    </span>
  )
}

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
      background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      color: ok ? '#10b981' : 'var(--danger)',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }}>{msg}</div>
  )
}

// ── Work Order Drawer ─────────────────────────────────────────────────────────

function WorkOrderDrawer({
  wo,
  vehicles,
  onClose,
  onUpdate,
}: {
  wo: WorkOrder
  vehicles: Vehicle[]
  onClose: () => void
  onUpdate: (updated: WorkOrder) => void
}) {
  const [newStatus, setNewStatus] = useState<WorkOrderStatus | ''>('')
  const [completionDate, setCompletionDate] = useState(
    wo.actual_end_date ?? new Date().toISOString().slice(0, 10)
  )
  const [finalCost, setFinalCost] = useState(wo.actual_cost != null ? String(wo.actual_cost) : '')
  const [notes, setNotes] = useState(wo.notes)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const vehicle = vehicles.find(v => v.vehicle_id === wo.vehicle_id)
  const transitions = WO_TRANSITIONS[wo.status]

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  function handleAdvanceStatus(e: FormEvent) {
    e.preventDefault()
    if (!newStatus) return
    setSaving(true)
    try {
      const updated: WorkOrder = {
        ...wo,
        status: newStatus,
        notes,
        ...(newStatus === 'IN_PROGRESS' ? { actual_start_date: new Date().toISOString().slice(0, 10) } : {}),
        ...(newStatus === 'COMPLETED'
          ? {
              actual_end_date: completionDate || new Date().toISOString().slice(0, 10),
              actual_cost: finalCost ? Number(finalCost) : wo.estimated_cost,
            }
          : {}),
      }
      onUpdate(updated)
      showToast('Work order updated', true)
      setNewStatus('')
    } finally {
      setSaving(false)
    }
  }

  function handleSaveNotes() {
    onUpdate({ ...wo, notes })
    showToast('Notes saved', true)
  }

  const sm = STATUS_META[wo.status]

  return (
    <>
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 201,
          width: 'min(480px, 92vw)',
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
                {wo.wo_number}
              </span>
              <StatusBadge status={wo.status} />
              <TypeBadge type={wo.maintenance_type} />
            </div>
            <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
              Scheduled {fmtDate(wo.scheduled_date)}
              {wo.technician ? ` · ${wo.technician}` : ''}
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
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Vehicle info */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Vehicle</SectionLabel>
            <div className="flex items-center justify-between gap-3 py-0.5" style={{ borderBottom: '1px solid var(--border-sub, var(--border))' }}>
              <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Vehicle</span>
              <span className="text-[11.5px] font-medium text-right" style={{ color: 'var(--text-1)' }}>
                {vehicle ? vehicleLabel(vehicle) : wo.vehicle_id ? wo.vehicle_id.slice(0, 8).toUpperCase() : 'Not assigned'}
              </span>
            </div>
            {vehicle?.plate_number && (
              <div className="flex items-center justify-between gap-3 py-0.5" style={{ borderBottom: '1px solid var(--border-sub, var(--border))' }}>
                <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Plate</span>
                <span className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--text-1)' }}>{vehicle.plate_number}</span>
              </div>
            )}
            {vehicle && (
              <div className="flex items-center justify-between gap-3 py-0.5">
                <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Fleet Status</span>
                <span className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>{vehicle.status}</span>
              </div>
            )}
          </div>

          {/* Work detail */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Work Detail</SectionLabel>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-1)' }}>{wo.description}</p>
            {wo.parts && (
              <div className="pt-1">
                <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>Parts / Materials</p>
                <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>{wo.parts}</p>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Timeline</SectionLabel>
            {[
              { label: 'Scheduled Date',   value: fmtDate(wo.scheduled_date) },
              { label: 'Est. Duration',    value: `${wo.estimated_duration_hours}h` },
              { label: 'Actual Start',     value: fmtDate(wo.actual_start_date) },
              { label: 'Actual End',       value: fmtDate(wo.actual_end_date) },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between gap-3 py-0.5"
                   style={{ borderBottom: '1px solid var(--border-sub, var(--border))' }}>
                <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{row.label}</span>
                <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-1)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Financials */}
          <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Financials</SectionLabel>
            {[
              { label: 'Estimated Cost', value: fmt$(wo.estimated_cost) },
              { label: 'Actual Cost',    value: fmt$(wo.actual_cost) },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between gap-3 py-0.5"
                   style={{ borderBottom: '1px solid var(--border-sub, var(--border))' }}>
                <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{row.label}</span>
                <span className="text-[11.5px] font-semibold num" style={{ color: 'var(--text-1)' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
            <SectionLabel>Notes</SectionLabel>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Add notes about this work order…"
              className="field-input w-full px-3 py-2 text-[13px] resize-none"
            />
            <button
              type="button"
              onClick={handleSaveNotes}
              className="btn-ghost text-[12px] mt-2 px-3 py-1"
            >
              Save Notes
            </button>
          </div>

        </div>

        {/* Footer — status transitions */}
        <div className="shrink-0 px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
          {transitions.length > 0 ? (
            <form onSubmit={handleAdvanceStatus} className="flex flex-col gap-2">
              <SectionLabel>Advance Status</SectionLabel>
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value as WorkOrderStatus | '')}
                className="field-input h-9 px-3 text-[13px] w-full"
              >
                <option value="">Select next status…</option>
                {transitions.map(s => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>

              {newStatus === 'COMPLETED' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-3)' }}>
                      Completion Date
                    </label>
                    <input
                      type="date"
                      value={completionDate}
                      onChange={e => setCompletionDate(e.target.value)}
                      className="field-input h-9 px-3 text-[13px] w-full"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-3)' }}>
                      Final Cost ($)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={finalCost}
                      onChange={e => setFinalCost(e.target.value)}
                      placeholder={String(wo.estimated_cost)}
                      className="field-input h-9 px-3 text-[13px] w-full"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!newStatus || saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Updating…' : newStatus === 'COMPLETED' ? 'Mark Complete' : 'Update Status'}
              </button>
            </form>
          ) : (
            <p className="text-[12px] text-center" style={{ color: 'var(--text-3)' }}>
              This work order is in a terminal state ({sm.label}).
            </p>
          )}
        </div>
      </aside>
    </>
  )
}

// ── New Work Order Dialog ─────────────────────────────────────────────────────

function NewWorkOrderDialog({
  vehicles,
  onClose,
  onCreate,
}: {
  vehicles: Vehicle[]
  onClose: () => void
  onCreate: (wo: WorkOrder) => void
}) {
  const [vehicleId, setVehicleId] = useState('')
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>('PREVENTIVE')
  const [description, setDescription] = useState('')
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10))
  const [estimatedDuration, setEstimatedDuration] = useState('2')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [technician, setTechnician] = useState('')
  const [parts, setParts] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.toLowerCase()
    if (!q) return vehicles
    return vehicles.filter(v =>
      vehicleLabel(v).toLowerCase().includes(q) ||
      (v.plate_number ?? '').toLowerCase().includes(q)
    )
  }, [vehicles, vehicleSearch])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitError('')
    if (!description.trim()) {
      setSubmitError('Description is required.')
      return
    }
    if (!scheduledDate) {
      setSubmitError('Scheduled date is required.')
      return
    }
    setSubmitting(true)
    try {
      const wo: WorkOrder = {
        id: generateId(),
        wo_number: generateWONumber(),
        vehicle_id: vehicleId,
        maintenance_type: maintenanceType,
        status: 'SCHEDULED',
        description: description.trim(),
        scheduled_date: scheduledDate,
        estimated_duration_hours: Number(estimatedDuration) || 1,
        estimated_cost: estimatedCost ? Number(estimatedCost) : 0,
        actual_cost: null,
        actual_start_date: null,
        actual_end_date: null,
        technician: technician.trim(),
        notes: notes.trim(),
        parts: parts.trim(),
        created_at: new Date().toISOString(),
      }
      onCreate(wo)
      onClose()
    } catch {
      setSubmitError('Failed to create work order.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12,
        width: '100%', maxWidth: 540, maxHeight: '92vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Dialog header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0"
             style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>New Work Order</h2>
          <button type="button" onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-md"
                  style={{ color: 'var(--text-3)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Dialog body */}
        <form id="new-wo-form" onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Vehicle selector */}
          <div>
            <SectionLabel>Vehicle <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <input
              type="search"
              value={vehicleSearch}
              onChange={e => { setVehicleSearch(e.target.value); setVehicleId('') }}
              placeholder="Search by make, model, or plate…"
              className="field-input h-9 px-3 text-[13px] w-full mb-1.5"
            />
            <select
              value={vehicleId}
              onChange={e => setVehicleId(e.target.value)}
              className="field-input h-9 px-3 text-[13px] w-full"
            >
              <option value="">-- No vehicle assigned --</option>
              {filteredVehicles.map(v => (
                <option key={v.vehicle_id} value={v.vehicle_id}>
                  {vehicleLabel(v)} — {v.status}
                </option>
              ))}
            </select>
          </div>

          {/* Maintenance type */}
          <div>
            <SectionLabel>Maintenance Type</SectionLabel>
            <select
              value={maintenanceType}
              onChange={e => setMaintenanceType(e.target.value as MaintenanceType)}
              className="field-input h-9 px-3 text-[13px] w-full"
            >
              {MAINTENANCE_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <SectionLabel>Description</SectionLabel>
            <textarea
              required
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Describe the work to be performed…"
              className="field-input w-full px-3 py-2 text-[13px] resize-none"
            />
          </div>

          {/* Date + duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <SectionLabel>Scheduled Date</SectionLabel>
              <input
                required
                type="date"
                value={scheduledDate}
                onChange={e => setScheduledDate(e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
            <div>
              <SectionLabel>Est. Duration (hours)</SectionLabel>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={estimatedDuration}
                onChange={e => setEstimatedDuration(e.target.value)}
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
          </div>

          {/* Cost + Technician */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <SectionLabel>Estimated Cost ($)</SectionLabel>
              <input
                type="number"
                min="0"
                step="0.01"
                value={estimatedCost}
                onChange={e => setEstimatedCost(e.target.value)}
                placeholder="0.00"
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
            <div>
              <SectionLabel>Technician</SectionLabel>
              <input
                type="text"
                value={technician}
                onChange={e => setTechnician(e.target.value)}
                maxLength={100}
                placeholder="Technician name"
                className="field-input h-9 px-3 text-[13px] w-full"
              />
            </div>
          </div>

          {/* Parts */}
          <div>
            <SectionLabel>Parts / Materials <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <input
              type="text"
              value={parts}
              onChange={e => setParts(e.target.value)}
              maxLength={500}
              placeholder="e.g. Oil filter, 5qt synthetic oil"
              className="field-input h-9 px-3 text-[13px] w-full"
            />
          </div>

          {/* Notes */}
          <div>
            <SectionLabel>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionLabel>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Additional notes or instructions…"
              className="field-input w-full px-3 py-2 text-[13px] resize-none"
            />
          </div>

          {submitError && (
            <p className="text-[12px] rounded-lg px-3 py-2"
               style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {submitError}
            </p>
          )}
        </form>

        {/* Dialog footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 px-5 py-4"
             style={{ borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            type="submit"
            form="new-wo-form"
            disabled={submitting}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MaintenancePage() {
  const qc = useQueryClient()

  // Local work orders (in-memory — backend stub has no implementation)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(INITIAL_WORK_ORDERS)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null)
  const [showNewWO, setShowNewWO] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Vehicles from real fleet API
  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ['fleet-vehicles-maint'],
    queryFn: () => fetchJSON('/fleet/vehicles?limit=200') as Promise<Vehicle[]>,
    staleTime: 120_000,
  })

  // Invalidate (unused but keeps qc referenced)
  void qc

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  function handleUpdate(updated: WorkOrder) {
    setWorkOrders(prev => prev.map(w => w.id === updated.id ? updated : w))
    setSelectedWO(updated)
  }

  function handleCreate(wo: WorkOrder) {
    setWorkOrders(prev => [wo, ...prev])
    showToast(`Work order ${wo.wo_number} created`, true)
  }

  const filtered = useMemo(() => {
    let list = workOrders
    if (statusFilter) list = list.filter(w => w.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(w =>
        w.wo_number.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.technician.toLowerCase().includes(q) ||
        w.maintenance_type.toLowerCase().includes(q) ||
        (vehicles.find(v => v.vehicle_id === w.vehicle_id)?.plate_number ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [workOrders, statusFilter, search, vehicles])

  const openCount       = workOrders.filter(w => w.status === 'SCHEDULED').length
  const inProgressCount = workOrders.filter(w => w.status === 'IN_PROGRESS').length
  const completedMonth  = thisMonthCompletedCount(workOrders)

  return (
    <div className="space-y-5 max-w-full">
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
            Maintenance Scheduling
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            Create and track vehicle maintenance work orders
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewWO(true)}
          className="btn-primary shrink-0"
        >
          New Work Order
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Work Orders',     value: workOrders.length,  color: 'var(--text-1)' },
          { label: 'Scheduled',             value: openCount,          color: '#6366f1' },
          { label: 'In Progress',           value: inProgressCount,    color: '#f59e0b' },
          { label: 'Completed This Month',  value: completedMonth,     color: '#10b981' },
        ].map(stat => (
          <div key={stat.label} className="panel px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              {stat.label}
            </p>
            <p className="text-[22px] font-bold num mt-0.5" style={{ color: stat.color }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="panel px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
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
          <div className="relative ml-auto">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                 width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="search"
              placeholder="Search work orders…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field-input h-8 pl-8 pr-3 text-[12px] w-52"
            />
          </div>
        </div>
      </div>

      {/* Work orders table */}
      <div className="panel overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="mx-auto mb-3" width="32" height="32" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="1.5"
                 style={{ color: 'var(--text-3)' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
              {search || statusFilter ? 'No work orders match your filters' : 'No work orders yet'}
            </p>
            {!search && !statusFilter && (
              <button
                type="button"
                onClick={() => setShowNewWO(true)}
                className="btn-primary mt-4 text-[13px]"
              >
                Create First Work Order
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['WO #', 'Vehicle', 'Type', 'Scheduled', 'Est. Cost', 'Status', 'Technician'].map(h => (
                    <th key={h}
                        className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest"
                        style={{ color: 'var(--text-3)', background: 'var(--elevated)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((wo, i) => {
                  const vehicle = vehicles.find(v => v.vehicle_id === wo.vehicle_id)
                  return (
                    <tr
                      key={wo.id}
                      onClick={() => setSelectedWO(wo)}
                      style={{
                        borderBottom: '1px solid var(--border-sub, var(--border))',
                        cursor: 'pointer',
                        background: i % 2 === 0 ? 'transparent' : 'var(--elevated)',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'transparent' : 'var(--elevated)'
                      }}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                          {wo.wo_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {vehicle ? (
                          <>
                            <p className="text-[12px] font-medium" style={{ color: 'var(--text-1)' }}>
                              {vehicle.plate_number ?? `${vehicle.model_year} ${vehicle.make}`}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                              {vehicle.model_year} {vehicle.make} {vehicle.model}
                            </p>
                          </>
                        ) : (
                          <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <TypeBadge type={wo.maintenance_type} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                          {fmtDate(wo.scheduled_date)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-semibold num" style={{ color: 'var(--text-1)' }}>
                          {wo.estimated_cost > 0 ? fmt$(wo.estimated_cost) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={wo.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                          {wo.technician || '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Work order drawer */}
      {selectedWO && (
        <WorkOrderDrawer
          wo={selectedWO}
          vehicles={vehicles}
          onClose={() => setSelectedWO(null)}
          onUpdate={handleUpdate}
        />
      )}

      {/* New work order dialog */}
      {showNewWO && (
        <NewWorkOrderDialog
          vehicles={vehicles}
          onClose={() => setShowNewWO(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
