import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '@rcm/ui/auth'
import imageCompression from 'browser-image-compression'

// ── Types ─────────────────────────────────────────────────────────────────────

const TENANT = import.meta.env.VITE_TENANT_ID ?? 'dev'

type InspectionType = 'PRE' | 'POST'

type ZoneCondition = 'GOOD' | 'SCRATCHED' | 'DENTED' | 'CRACKED' | 'MISSING' | 'BROKEN'

type ZoneDetail = {
  condition: ZoneCondition
  severity: number
  description: string
  preExisting: boolean
}

type RentalAgreement = {
  ra_id: string
  ra_number: string
  customer_id: string
  vehicle_id: string
  status: string
  odometer_out: number
  fuel_level_out_pct: number | null
  odometer_in: number | null
  fuel_level_in_pct: number | null
  created_at: string | null
}

type ApiVehicle = {
  vehicle_id: string
  make: string
  model: string
  model_year: number
  plate_number: string | null
  odometer_current: number
}

type InspectionResponse = {
  inspection_id: string
  rental_agreement_id: string
  inspection_type: string
  new_damages_found: number
  claims_created: string[]
}

type ZoneDiff = {
  zone_name: string
  pre_condition: ZoneCondition
  post_condition: ZoneCondition
  is_new_damage: boolean
}

type PrePostComparison = {
  rental_agreement_id: string
  pre_zones: Record<string, string>
  post_zones: Record<string, string>
  new_damages: ZoneDiff[]
  total_new_damage_zones: number
}

type Step = 'search' | 'inspect' | 'confirm'

// ── SVG zone layout ───────────────────────────────────────────────────────────

type SvgZone = {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

const SVG_ZONES: SvgZone[] = [
  { id: 'FRONT_LEFT',     label: 'Front L',     x: 20,  y: 10,  w: 58, h: 40 },
  { id: 'FRONT_CENTER',   label: 'Front',        x: 86,  y: 10,  w: 68, h: 40 },
  { id: 'FRONT_RIGHT',    label: 'Front R',     x: 162, y: 10,  w: 58, h: 40 },
  { id: 'MIRROR_LEFT',    label: 'Mirror L',    x: 4,   y: 80,  w: 26, h: 20 },
  { id: 'DOOR_FRONT_LEFT', label: 'Door FL',    x: 20,  y: 58,  w: 58, h: 52 },
  { id: 'WINDSHIELD_FRONT', label: 'Windshield', x: 86, y: 58,  w: 68, h: 30 },
  { id: 'ROOF_FRONT',     label: 'Roof F',      x: 86,  y: 96,  w: 68, h: 30 },
  { id: 'DOOR_FRONT_RIGHT', label: 'Door FR',   x: 162, y: 58,  w: 58, h: 52 },
  { id: 'MIRROR_RIGHT',   label: 'Mirror R',    x: 210, y: 80,  w: 26, h: 20 },
  { id: 'INTERIOR_FRONT', label: 'Interior F',  x: 86,  y: 134, w: 68, h: 24 },
  { id: 'DOOR_REAR_LEFT', label: 'Door RL',     x: 20,  y: 118, w: 58, h: 52 },
  { id: 'ROOF_CENTER',    label: 'Roof C',      x: 86,  y: 165, w: 68, h: 24 },
  { id: 'DOOR_REAR_RIGHT', label: 'Door RR',    x: 162, y: 118, w: 58, h: 52 },
  { id: 'INTERIOR_REAR',  label: 'Interior R',  x: 86,  y: 196, w: 68, h: 24 },
  { id: 'TRUNK',          label: 'Trunk',       x: 86,  y: 226, w: 68, h: 30 },
  { id: 'WINDSHIELD_REAR', label: 'Rear Glass', x: 20,  y: 178, w: 58, h: 36 },
  { id: 'ROOF_REAR',      label: 'Roof R',      x: 162, y: 165, w: 58, h: 28 },
  { id: 'REAR_LEFT',      label: 'Rear L',      x: 20,  y: 222, w: 58, h: 40 },
  { id: 'REAR_CENTER',    label: 'Rear',        x: 86,  y: 264, w: 68, h: 40 },
  { id: 'REAR_RIGHT',     label: 'Rear R',      x: 162, y: 222, w: 58, h: 40 },
  { id: 'UNDERBODY_FRONT', label: 'Under F',    x: 20,  y: 270, w: 58, h: 26 },
  { id: 'UNDERBODY_REAR', label: 'Under R',     x: 162, y: 270, w: 58, h: 26 },
]

const ZONE_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  ['FRONT_LEFT','FRONT_CENTER','FRONT_RIGHT','ROOF_FRONT','ROOF_CENTER','ROOF_REAR',
   'REAR_LEFT','REAR_CENTER','REAR_RIGHT','DOOR_FRONT_LEFT','DOOR_FRONT_RIGHT',
   'DOOR_REAR_LEFT','DOOR_REAR_RIGHT','MIRROR_LEFT','MIRROR_RIGHT',
   'WINDSHIELD_FRONT','WINDSHIELD_REAR','UNDERBODY_FRONT','UNDERBODY_REAR',
   'INTERIOR_FRONT','INTERIOR_REAR','TRUNK'].map((name, i) => [name, i + 1])
)

const CONDITIONS: ZoneCondition[] = ['GOOD', 'SCRATCHED', 'DENTED', 'CRACKED', 'MISSING', 'BROKEN']

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchJSON(path: string) {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    headers: { 'X-Tenant-ID': TENANT },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any)?.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function postJSON(path: string, body: unknown) {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as any)?.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function FuelGauge({ value, onChange, readonly }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  const pct = Math.round((value / 8) * 100)
  const color = value <= 1 ? '#ef4444' : value <= 3 ? '#f59e0b' : '#10b981'
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-0.5">
          {Array.from({ length: 8 }, (_, i) => (
            <button key={i} type="button" disabled={readonly}
              onClick={() => onChange?.(i + 1)}
              className="flex-1 h-6 rounded-sm transition-all"
              style={{
                background: i < value ? color : 'var(--border)',
                cursor: readonly ? 'default' : 'pointer',
              }} />
          ))}
        </div>
        <span className="text-[12px] font-bold num w-10 text-right" style={{ color }}>{pct}%</span>
      </div>
      <div className="flex justify-between text-[9.5px]" style={{ color: 'var(--text-3)' }}>
        <span>E</span><span>1/4</span><span>1/2</span><span>3/4</span><span>F</span>
      </div>
      {!readonly && (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Click a segment to set fuel level</p>
      )}
    </div>
  )
}

function ZoneFillColor(condition: ZoneCondition, isNewDamage?: boolean): string {
  if (condition === 'GOOD') return 'rgba(16,185,129,0.08)'
  if (isNewDamage) return 'rgba(239,68,68,0.35)'
  return 'rgba(245,158,11,0.35)'
}

function ZoneStrokeColor(condition: ZoneCondition, isSelected: boolean, isNewDamage?: boolean): string {
  if (isSelected) return '#6366f1'
  if (condition === 'GOOD') return 'rgba(16,185,129,0.3)'
  if (isNewDamage) return '#ef4444'
  return '#f59e0b'
}

function CarDiagram({
  zoneDetails,
  selectedZone,
  onZoneClick,
  newDamageZones,
}: {
  zoneDetails: Map<string, ZoneDetail>
  selectedZone: string | null
  onZoneClick: (zoneId: string) => void
  newDamageZones?: Set<string>
}) {
  return (
    <svg viewBox="0 0 240 310" className="w-full max-w-xs mx-auto block" style={{ fontFamily: 'inherit' }}>
      {/* Car body outline */}
      <rect x="14" y="54" width="212" height="202" rx="8" fill="var(--elevated)" stroke="var(--border)" strokeWidth="1.5" />

      {SVG_ZONES.map(zone => {
        const detail = zoneDetails.get(zone.id)
        const condition: ZoneCondition = detail?.condition ?? 'GOOD'
        const isSelected = selectedZone === zone.id
        const isDamaged = condition !== 'GOOD'
        const isNew = newDamageZones?.has(zone.id) ?? false

        return (
          <g key={zone.id} onClick={() => onZoneClick(zone.id)} style={{ cursor: 'pointer' }}>
            <rect
              x={zone.x} y={zone.y} width={zone.w} height={zone.h}
              rx="3"
              fill={ZoneFillColor(condition, isNew)}
              stroke={ZoneStrokeColor(condition, isSelected, isNew)}
              strokeWidth={isSelected ? 2 : isDamaged ? 1.5 : 1}
              opacity={0.95}
            />
            <text
              x={zone.x + zone.w / 2}
              y={zone.y + zone.h / 2 + 3}
              textAnchor="middle"
              fontSize={zone.w < 40 ? 5 : 6}
              fill={isDamaged ? (isNew ? '#ef4444' : '#d97706') : 'var(--text-3)'}
              fontWeight={isDamaged ? 600 : 400}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {zone.label}
            </text>
          </g>
        )
      })}

      {/* Direction labels */}
      <text x="120" y="7" textAnchor="middle" fontSize="7" fill="var(--text-3)" fontWeight={600}>FRONT</text>
      <text x="120" y="308" textAnchor="middle" fontSize="7" fill="var(--text-3)" fontWeight={600}>REAR</text>
    </svg>
  )
}

function ZoneDetailPanel({
  zoneId,
  detail,
  onChange,
  onClose,
}: {
  zoneId: string
  detail: ZoneDetail
  onChange: (d: ZoneDetail) => void
  onClose: () => void
}) {
  const zone = SVG_ZONES.find(z => z.id === zoneId)

  return (
    <div className="rounded-lg p-4 space-y-3" style={{ border: '1.5px solid var(--accent)', background: 'var(--elevated)' }}>
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{zone?.label ?? zoneId}</p>
        <button type="button" onClick={onClose}
          className="text-[11px] px-2 py-0.5 rounded"
          style={{ background: 'var(--border)', color: 'var(--text-3)' }}>
          Close
        </button>
      </div>

      <div>
        <SectionLabel>Condition</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {CONDITIONS.map(c => (
            <button key={c} type="button"
              onClick={() => onChange({ ...detail, condition: c })}
              className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
              style={{
                background: detail.condition === c
                  ? (c === 'GOOD' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)')
                  : 'var(--border)',
                border: `1.5px solid ${detail.condition === c ? (c === 'GOOD' ? '#10b981' : '#f59e0b') : 'transparent'}`,
                color: detail.condition === c ? (c === 'GOOD' ? '#10b981' : '#d97706') : 'var(--text-2)',
              }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {detail.condition !== 'GOOD' && (
        <>
          <div>
            <SectionLabel>Severity (1=Minor, 5=Severe)</SectionLabel>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button"
                  onClick={() => onChange({ ...detail, severity: n })}
                  className="h-8 w-8 rounded text-[12px] font-bold transition-colors"
                  style={{
                    background: detail.severity === n ? 'var(--accent)' : 'var(--border)',
                    color: detail.severity === n ? 'white' : 'var(--text-2)',
                  }}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Description</SectionLabel>
            <input type="text" maxLength={200}
              value={detail.description}
              onChange={e => onChange({ ...detail, description: e.target.value })}
              placeholder="Brief description of damage..."
              className="field-input w-full h-9 px-3 text-[13px]" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={detail.preExisting}
              onChange={e => onChange({ ...detail, preExisting: e.target.checked })}
              className="rounded" />
            <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              Pre-existing damage (will not generate a claim)
            </span>
          </label>
        </>
      )}
    </div>
  )
}

// ── Step bar ──────────────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'search', label: 'Find Agreement' },
    { id: 'inspect', label: 'Inspection' },
    { id: 'confirm', label: 'Complete' },
  ]
  const idx = steps.findIndex(s => s.id === step)

  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((s, i) => {
        const done = i < idx
        const active = i === idx
        return (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold shrink-0"
                style={{
                  background: done ? '#10b981' : active ? 'var(--accent)' : 'var(--border)',
                  color: done || active ? '#fff' : 'var(--text-3)',
                }}>
                {done
                  ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : i + 1}
              </div>
              <span className="text-[11.5px] font-medium hidden sm:block"
                style={{ color: active ? 'var(--text-1)' : done ? '#10b981' : 'var(--text-3)' }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 mx-3 h-px" style={{ background: done ? '#10b981' : 'var(--border)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function InspectionsPage() {
  const { user } = useAuth()

  const [step, setStep] = useState<Step>('search')
  const [raSearch, setRaSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')

  const [ra, setRa] = useState<RentalAgreement | null>(null)
  const [vehicle, setVehicle] = useState<ApiVehicle | null>(null)
  const [inspectionType, setInspectionType] = useState<InspectionType>('PRE')

  const [zoneDetails, setZoneDetails] = useState<Map<string, ZoneDetail>>(new Map())
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [odometer, setOdometer] = useState('')
  const [fuelLevel, setFuelLevel] = useState(8)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState<InspectionResponse | null>(null)
  const [zonePhotoKeys, setZonePhotoKeys] = useState<Record<string, string[]>>({})

  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>, zoneId: string) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.5, maxWidthOrHeight: 800, useWebWorker: true,
        fileType: 'image/jpeg', initialQuality: 0.8,
      })
      const currentRaId = ra?.ra_id ?? ''
      const uploadRes = await fetch('/api/v1/damage/photo-upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
        body: JSON.stringify({ zone_id: zoneId, ra_id: currentRaId || undefined }),
      })
      const { upload_url, s3_key } = await uploadRes.json()
      await fetch(upload_url, { method: 'PUT', body: compressed, headers: { 'Content-Type': 'image/jpeg' } })
      setZonePhotoKeys(prev => ({ ...prev, [zoneId]: [...(prev[zoneId] ?? []), s3_key] }))
    } catch (err) {
      console.error('Photo capture failed:', err)
    }
    e.target.value = ''
  }

  const { data: raResults, isLoading: raLoading, error: raError } = useQuery<RentalAgreement[]>({
    queryKey: ['ra-search', submittedSearch],
    queryFn: async () => {
      const all: RentalAgreement[] = await fetchJSON('/checkout/agreements')
      if (!submittedSearch) return []
      const q = submittedSearch.trim().toUpperCase()
      return all.filter(r => r.ra_number.toUpperCase().includes(q))
    },
    enabled: submittedSearch.length > 0,
  })

  const { data: comparison } = useQuery<PrePostComparison>({
    queryKey: ['inspection-comparison', ra?.ra_id],
    queryFn: () => fetchJSON(`/damage/inspections/${ra!.ra_id}/comparison`),
    enabled: !!ra && inspectionType === 'POST' && step === 'confirm',
    retry: false,
  })

  const newDamageZones = useMemo<Set<string>>(() => {
    if (!comparison) return new Set()
    return new Set(comparison.new_damages.filter(d => d.is_new_damage).map(d => d.zone_name))
  }, [comparison])

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!ra || !user) throw new Error('Missing rental agreement or user session')
      const zoneDataArr = Array.from(zoneDetails.entries())
        .filter(([, d]) => d.condition !== 'GOOD')
        .map(([zoneName, d]) => ({
          zone_id: ZONE_NAME_TO_ID[zoneName],
          zone_name: zoneName,
          condition: d.condition,
          damage_type: d.description || null,
          severity: d.severity,
          photo_keys: [],
        }))

      const body = {
        rental_agreement_id: ra.ra_id,
        inspection_type: inspectionType,
        zone_data: zoneDataArr,
        odometer: Number(odometer),
        fuel_level: fuelLevel,
        agent_id: user.user_id,
        customer_signature: null,
        photos: [],
      }

      return postJSON('/damage/inspections', body) as Promise<InspectionResponse>
    },
    onSuccess: (data) => {
      setResult(data)
      setStep('confirm')
      setSubmitError('')
    },
    onError: (e: Error) => {
      setSubmitError(e.message)
    },
  })

  function handleSelectRA(selected: RentalAgreement) {
    setRa(selected)
    const autoType: InspectionType = selected.status === 'RETURNED' || selected.status === 'CLOSED' ? 'POST' : 'PRE'
    setInspectionType(autoType)
    setOdometer(String(selected.odometer_out ?? ''))
    setFuelLevel(selected.fuel_level_out_pct != null ? Math.round(selected.fuel_level_out_pct / 12.5) : 8)
    setZoneDetails(new Map())
    setSelectedZone(null)
    setStep('inspect')
  }

  function handleZoneClick(zoneId: string) {
    setSelectedZone(prev => prev === zoneId ? null : zoneId)
    if (!zoneDetails.has(zoneId)) {
      setZoneDetails(prev => {
        const next = new Map(prev)
        next.set(zoneId, { condition: 'GOOD', severity: 1, description: '', preExisting: false })
        return next
      })
    }
  }

  function handleZoneDetailChange(zoneId: string, detail: ZoneDetail) {
    setZoneDetails(prev => {
      const next = new Map(prev)
      next.set(zoneId, detail)
      return next
    })
  }

  function handleVehicleLoad(vehicleId: string) {
    fetchJSON(`/fleet/vehicles/${vehicleId}`)
      .then((v: ApiVehicle) => setVehicle(v))
      .catch(() => setVehicle(null))
  }

  const damagedZones = useMemo(
    () => Array.from(zoneDetails.entries()).filter(([, d]) => d.condition !== 'GOOD'),
    [zoneDetails]
  )

  function reset() {
    setStep('search')
    setRaSearch('')
    setSubmittedSearch('')
    setRa(null)
    setVehicle(null)
    setZoneDetails(new Map())
    setSelectedZone(null)
    setOdometer('')
    setFuelLevel(8)
    setSubmitError('')
    setResult(null)
    setZonePhotoKeys({})
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
          Vehicle Inspections
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>
          Record pre-rental and post-return vehicle condition inspections
        </p>
      </div>

      <StepBar step={step} />

      {/* ── Step: Search ── */}
      {step === 'search' && (
        <div className="panel p-5 space-y-4">
          <SectionLabel>Find Rental Agreement</SectionLabel>

          <form onSubmit={e => { e.preventDefault(); setSubmittedSearch(raSearch) }}
            className="flex gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                value={raSearch}
                onChange={e => setRaSearch(e.target.value)}
                placeholder="Enter RA number (e.g. RA-20260001)…"
                className="field-input h-9 pl-8 text-[13px] w-full"
              />
            </div>
            <button type="submit" className="btn-primary px-4 text-[13px]">Search</button>
          </form>

          {raLoading && (
            <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Searching…</p>
          )}

          {raError && (
            <p className="text-[12px]" style={{ color: 'var(--danger)' }}>
              {raError instanceof Error ? raError.message : 'Search failed'}
            </p>
          )}

          {raResults && raResults.length === 0 && submittedSearch && !raLoading && (
            <div className="py-8 text-center" style={{ color: 'var(--text-3)' }}>
              <p className="text-[13px]">No rental agreements found for "{submittedSearch}"</p>
            </div>
          )}

          {raResults && raResults.length > 0 && (
            <div className="space-y-2">
              {raResults.map(r => (
                <button key={r.ra_id} type="button"
                  onClick={() => { handleVehicleLoad(r.vehicle_id); handleSelectRA(r) }}
                  className="w-full text-left rounded-lg px-4 py-3.5 transition-colors"
                  style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold font-mono" style={{ color: 'var(--accent)' }}>
                        {r.ra_number}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        Odometer out: {r.odometer_out?.toLocaleString() ?? '—'} mi
                        {r.fuel_level_out_pct != null ? ` · Fuel out: ${r.fuel_level_out_pct}%` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                      style={{
                        background: r.status === 'ACTIVE' ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)',
                        color: r.status === 'ACTIVE' ? '#10b981' : 'var(--accent)',
                      }}>
                      {r.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step: Inspect ── */}
      {step === 'inspect' && ra && (
        <div className="space-y-4">
          {/* RA summary */}
          <div className="panel px-5 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
                  Rental Agreement
                </p>
                <p className="text-[16px] font-bold font-mono" style={{ color: 'var(--accent)' }}>{ra.ra_number}</p>
                {vehicle && (
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {vehicle.model_year} {vehicle.make} {vehicle.model}
                    {vehicle.plate_number ? ` · ${vehicle.plate_number}` : ''}
                  </p>
                )}
              </div>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded self-start"
                style={{
                  background: ra.status === 'ACTIVE' ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)',
                  color: ra.status === 'ACTIVE' ? '#10b981' : 'var(--accent)',
                }}>
                {ra.status}
              </span>
            </div>
          </div>

          {/* Inspection type selector */}
          <div className="panel px-5 py-4">
            <SectionLabel>Inspection Type</SectionLabel>
            <div className="flex gap-2 mt-1">
              {(['PRE', 'POST'] as InspectionType[]).map(t => (
                <button key={t} type="button"
                  onClick={() => setInspectionType(t)}
                  className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                  style={{
                    border: `1.5px solid ${inspectionType === t ? 'var(--accent)' : 'var(--border)'}`,
                    background: inspectionType === t ? 'rgba(99,102,241,0.1)' : 'var(--elevated)',
                    color: inspectionType === t ? 'var(--accent)' : 'var(--text-2)',
                  }}>
                  {t === 'PRE' ? 'PRE-RENTAL' : 'POST-RETURN'}
                </button>
              ))}
            </div>
            {ra.status === 'ACTIVE' && inspectionType === 'PRE' && (
              <p className="text-[11px] mt-1.5" style={{ color: '#10b981' }}>
                Auto-selected: RA is ACTIVE — recording pre-rental inspection
              </p>
            )}
            {(ra.status === 'RETURNED' || ra.status === 'CLOSED') && inspectionType === 'POST' && (
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--accent)' }}>
                Auto-selected: RA is {ra.status} — recording post-return inspection
              </p>
            )}
          </div>

          {/* Vehicle diagram + zone details */}
          <div className="panel px-5 py-4">
            <SectionLabel>Damage Map</SectionLabel>
            <p className="text-[12px] mb-4" style={{ color: 'var(--text-3)' }}>
              Click a zone to mark damage. Selected zone opens a detail panel below.
            </p>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CarDiagram
                zoneDetails={zoneDetails}
                selectedZone={selectedZone}
                onZoneClick={handleZoneClick}
              />

              <div className="space-y-3">
                {selectedZone ? (
                  <>
                    <ZoneDetailPanel
                      zoneId={selectedZone}
                      detail={zoneDetails.get(selectedZone) ?? { condition: 'GOOD', severity: 1, description: '', preExisting: false }}
                      onChange={d => handleZoneDetailChange(selectedZone, d)}
                      onClose={() => setSelectedZone(null)}
                    />
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', height: 36, padding: '0 12px', fontSize: 12, background: 'var(--card-bg)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 0 }}>
                        <input type="file" accept="image/*" capture="environment"
                          style={{ display: 'none' }} onChange={e => handlePhotoCapture(e, selectedZone)} />
                        Take Photo
                      </label>
                      {(zonePhotoKeys[selectedZone] ?? []).map((key, i) => (
                        <span key={key} style={{ fontSize: 11, color: 'var(--text-3)' }}>Photo {i + 1} saved</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg p-4 text-center" style={{ border: '1px dashed var(--border)' }}>
                    <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      Select a zone on the diagram to record damage details
                    </p>
                  </div>
                )}

                {damagedZones.length > 0 && (
                  <div className="rounded-lg px-3 py-3 space-y-1.5"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#d97706' }}>
                      Damage noted — {damagedZones.length} zone{damagedZones.length !== 1 ? 's' : ''}
                    </p>
                    {damagedZones.map(([zoneId, d]) => (
                      <div key={zoneId} className="flex items-center justify-between text-[11px]">
                        <span style={{ color: 'var(--text-2)' }}>
                          {SVG_ZONES.find(z => z.id === zoneId)?.label ?? zoneId}
                        </span>
                        <span style={{ color: '#d97706' }}>
                          {d.condition} · Sev {d.severity}
                          {d.preExisting ? ' · Pre-existing' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Fuel and odometer */}
          <div className="panel px-5 py-4 space-y-5">
            <div>
              <SectionLabel>Odometer Reading (mi)</SectionLabel>
              {ra.odometer_out != null && (
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                  Odometer at checkout: {ra.odometer_out.toLocaleString()} mi
                </p>
              )}
              <input
                type="number"
                min={0}
                value={odometer}
                onChange={e => setOdometer(e.target.value)}
                placeholder="Current odometer reading…"
                className="field-input h-9 px-3 text-[13px] w-full num"
              />
            </div>

            <div>
              <SectionLabel>Fuel Level</SectionLabel>
              {ra.fuel_level_out_pct != null && (
                <p className="text-[11px] mb-2" style={{ color: 'var(--text-3)' }}>
                  Fuel at checkout: {ra.fuel_level_out_pct}%
                </p>
              )}
              <FuelGauge value={fuelLevel} onChange={setFuelLevel} />
            </div>
          </div>

          {submitError && (
            <div className="rounded-lg px-3.5 py-3 text-[12px]"
              style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setStep('search')} className="btn-secondary">
              Back
            </button>
            <button
              type="button"
              disabled={!odometer || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
              className="btn-primary">
              {submitMutation.isPending ? 'Submitting…' : 'Submit Inspection'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Confirm ── */}
      {step === 'confirm' && result && (
        <div className="space-y-4">
          {/* Success header */}
          <div className="panel px-6 py-8 text-center space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full mx-auto"
              style={{ background: 'rgba(16,185,129,0.15)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>Inspection Recorded</h2>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
                {result.inspection_type === 'PRE' ? 'Pre-rental' : 'Post-return'} inspection saved successfully.
              </p>
            </div>

            <div className="rounded-lg px-5 py-4 mx-auto max-w-sm text-left space-y-2"
              style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
              {[
                { label: 'Inspection ID', value: result.inspection_id.slice(0, 8).toUpperCase() },
                { label: 'RA Number', value: ra?.ra_number ?? '—' },
                { label: 'Type', value: result.inspection_type === 'PRE' ? 'PRE-RENTAL' : 'POST-RETURN' },
                { label: 'Damage Zones', value: String(damagedZones.length) },
                ...(result.new_damages_found > 0
                  ? [{ label: 'New Damage Zones', value: String(result.new_damages_found) }]
                  : []),
                ...(result.claims_created.length > 0
                  ? [{ label: 'Claims Created', value: String(result.claims_created.length) }]
                  : []),
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-4 text-[12px]">
                  <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
                  <span className="font-medium num" style={{ color: 'var(--text-1)' }}>{row.value}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button type="button" onClick={reset} className="btn-primary">
                Start Another Inspection
              </button>
            </div>
          </div>

          {/* Pre/Post comparison */}
          {comparison && comparison.new_damages.length > 0 && (
            <div className="panel px-5 py-4 space-y-3">
              <SectionLabel>Pre vs Post Damage Comparison</SectionLabel>
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                {comparison.total_new_damage_zones} new damage zone{comparison.total_new_damage_zones !== 1 ? 's' : ''} detected compared to pre-rental inspection.
              </p>

              <div className="space-y-2">
                {comparison.new_damages.map(diff => (
                  <div key={diff.zone_name}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                    style={{
                      background: diff.is_new_damage ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                      border: `1px solid ${diff.is_new_damage ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                    }}>
                    <div>
                      <p className="text-[12px] font-semibold" style={{ color: 'var(--text-1)' }}>
                        {SVG_ZONES.find(z => z.id === diff.zone_name)?.label ?? diff.zone_name}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        Pre: {diff.pre_condition} → Post: {diff.post_condition}
                      </p>
                    </div>
                    {diff.is_new_damage && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded"
                        style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                        NEW DAMAGE
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-2">
                <CarDiagram
                  zoneDetails={zoneDetails}
                  selectedZone={null}
                  onZoneClick={() => {}}
                  newDamageZones={newDamageZones}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
