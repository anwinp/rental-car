import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core'

// ── Constants ────────────────────────────────────────────────────────────────

const ROW_H    = 48   // height per vehicle row
const LEFT_W   = 220  // width of vehicle label column
const HEADER_H = 56   // height of date header row

// Event bar colours by block_type
const BLOCK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  RESERVATION:   { bg: '#eef2ff', text: '#3730a3', border: '#a5b4fc' },
  MAINTENANCE:   { bg: '#fffbeb', text: '#92400e', border: '#fcd34d' },
  RECALL_HOLD:   { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' },
  IN_TRANSIT:    { bg: '#f0f9ff', text: '#075985', border: '#7dd3fc' },
  INSPECTION:    { bg: '#faf5ff', text: '#6b21a8', border: '#d8b4fe' },
  TURNAROUND:    { bg: '#f0fdf4', text: '#14532d', border: '#86efac' },
  CHARGING:      { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7' },
  HOLD:          { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
  STAGING:       { bg: '#fdf4ff', text: '#701a75', border: '#e879f9' },
}
const DEFAULT_COLOR = { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' }

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  event_id:   string
  event_type: string
  block_type: string
  start_dt:   string
  end_dt:     string
  label:      string
  sub_label:  string | null
}

interface CalendarVehicle {
  vehicle_id:           string
  make:                 string
  model:                string
  model_year:           number
  plate_number:         string | null
  vin:                  string | null
  status:               string
  class_name:           string
  vehicle_class_id?:    string
  home_location_id:     string
  location_name:        string
  location_short_code:  string
  events:               CalendarEvent[]
}

// Returns the best available secondary identifier for a vehicle row.
// Priority: plate → last 6 of VIN → class name.
function vehicleTag(v: CalendarVehicle): string {
  if (v.plate_number) return v.plate_number
  if (v.vin)         return v.vin.slice(-6).toUpperCase()
  return v.class_name
}

interface CalendarResponse {
  from_date: string
  to_date:   string
  vehicles:  CalendarVehicle[]
}

interface Location {
  location_id: string
  name:        string
  short_code:  string
  is_active:   boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function parseUTC(iso: string): Date {
  return new Date(iso)
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchLocations(): Promise<Location[]> {
  const res = await fetch('/api/v1/locations?limit=200', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load locations: ${res.status}`)
  return res.json()
}

async function fetchCalendar(
  fromDate: string,
  toDate: string,
  locationId: string | null,
): Promise<CalendarResponse> {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate })
  if (locationId) params.set('location_id', locationId)
  const res = await fetch(`/api/v1/fleet/calendar?${params}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load calendar: ${res.status}`)
  return res.json()
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipState {
  event:   CalendarEvent
  vehicle: CalendarVehicle
  x:       number
  y:       number
}

function Tooltip({ tip }: { tip: TooltipState }) {
  const color = BLOCK_COLORS[tip.event.block_type] ?? DEFAULT_COLOR
  const start = new Date(tip.event.start_dt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const end   = new Date(tip.event.end_dt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg shadow-xl text-xs"
      style={{
        left: tip.x + 12,
        top:  tip.y - 8,
        minWidth: 200,
        maxWidth: 280,
        background: 'var(--card-bg)',
        border: `1px solid ${color.border}`,
        color: 'var(--text-1)',
      }}
    >
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <span
          className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: color.bg, color: color.text, border: `1px solid ${color.border}` }}
        >
          {tip.event.block_type.replace(/_/g, ' ')}
        </span>
        <p className="mt-1 font-semibold" style={{ color: 'var(--text-1)' }}>{tip.event.label}</p>
        {tip.event.sub_label && (
          <p style={{ color: 'var(--text-3)' }}>{tip.event.sub_label}</p>
        )}
      </div>
      <div className="px-3 py-2 space-y-0.5" style={{ color: 'var(--text-2)' }}>
        <p>{tip.vehicle.make} {tip.vehicle.model} {tip.vehicle.model_year}</p>
        {tip.vehicle.plate_number
          ? <p>Plate: {tip.vehicle.plate_number}</p>
          : tip.vehicle.vin
            ? <p style={{ fontFamily: 'monospace', fontSize: 10 }}>VIN: {tip.vehicle.vin}</p>
            : null
        }
        <p>{start}</p>
        <p>to {end}</p>
      </div>
    </div>
  )
}

// ── Draggable Event Bar ───────────────────────────────────────────────────────

interface DraggableEventBarProps {
  event:      CalendarEvent
  vehicle:    CalendarVehicle
  fromDate:   Date
  dayPx:      number
  onHover:    (tip: TooltipState | null) => void
  onClick:    () => void
}

function DraggableEventBar({ event, vehicle, fromDate, dayPx, onHover, onClick }: DraggableEventBarProps) {
  const color    = BLOCK_COLORS[event.block_type] ?? DEFAULT_COLOR
  const startD   = parseUTC(event.start_dt)
  const endD     = parseUTC(event.end_dt)

  const offsetDays  = daysBetween(fromDate, startD)
  const durationMs  = endD.getTime() - startD.getTime()
  const durationDays = durationMs / 86_400_000

  const left  = Math.max(0, offsetDays * dayPx)
  const width = Math.max(durationDays * dayPx - 2, 6)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: event.event_id,
    data: { event, vehicle },
    disabled: event.block_type !== 'RESERVATION',
  })

  return (
    <div
      ref={setNodeRef}
      {...(event.block_type === 'RESERVATION' ? { ...listeners, ...attributes } : {})}
      onClick={onClick}
      style={{
        position: 'absolute',
        top: 6,
        left,
        width,
        height: ROW_H - 12,
        background: color.bg,
        border: `1px solid ${color.border}`,
        color: color.text,
        borderRadius: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        opacity: isDragging ? 0.4 : 1,
        cursor: event.block_type === 'RESERVATION' ? 'grab' : 'pointer',
        userSelect: 'none',
      }}
      onMouseMove={(e) => onHover({ event, vehicle, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null)}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 8px', fontSize: 11, fontWeight: 500, lineHeight: 1 }}>
        {event.label}
      </span>
    </div>
  )
}

// ── Droppable Vehicle Row ────────────────────────────────────────────────────

interface DropRowProps {
  vehicle:    CalendarVehicle
  days:       Date[]
  dayPx:      number
  todayOffset: number
  fromDate:   Date
  onHover:    (tip: TooltipState | null) => void
  onEventClick: (event: CalendarEvent, vehicle: CalendarVehicle) => void
}

function DropRow({ vehicle, days, dayPx, todayOffset, fromDate, onHover, onEventClick }: DropRowProps) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: vehicle.vehicle_id,
    data: { vehicle },
  })

  return (
    <div
      ref={setDropRef}
      key={vehicle.vehicle_id}
      className="relative flex"
      style={{
        height: ROW_H,
        borderBottom: '1px solid var(--border)',
        outline: isOver ? '2px solid rgba(218,41,28,0.4)' : undefined,
      }}
    >
      {days.map((_, i) => (
        <div
          key={i}
          className="shrink-0"
          style={{
            width: dayPx,
            borderRight: '1px solid var(--border)',
            background: i === todayOffset ? 'rgba(79,70,229,0.04)' : undefined,
          }}
        />
      ))}
      {vehicle.events.map(ev => (
        <DraggableEventBar
          key={ev.event_id}
          event={ev}
          vehicle={vehicle}
          fromDate={fromDate}
          dayPx={dayPx}
          onHover={onHover}
          onClick={() => onEventClick(ev, vehicle)}
        />
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FleetCalendarPage() {
  const todayStr = toYMD(new Date())
  const [windowStart, setWindowStart] = useState<Date>(() => new Date(todayStr))
  const [locationId, setLocationId]   = useState<string>('')
  const [tooltip, setTooltip]         = useState<TooltipState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const queryClient = useQueryClient()
  const [viewMode, setViewMode]       = useState<'twoweek' | 'month'>('twoweek')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<{ event: CalendarEvent; vehicle: CalendarVehicle } | null>(null)
  const [pendingRealloc, setPendingRealloc] = useState<{
    blockId: string; fromVehicle: CalendarVehicle; toVehicle: CalendarVehicle
  } | null>(null)
  const [notifyCustomer, setNotifyCustomer] = useState(true)

  const DAYS  = viewMode === 'month' ? 30 : 14
  const DAY_PX = viewMode === 'month' ? 38 : 60

  const fromDate = windowStart
  const toDate   = addDays(windowStart, DAYS - 1)
  const fromStr  = toYMD(fromDate)
  const toStr    = toYMD(toDate)

  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(fromDate, i)),
    [fromDate, DAYS],
  )

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations-list'],
    queryFn:  fetchLocations,
    staleTime: 60_000,
  })

  const { data: calendar, isLoading, error } = useQuery<CalendarResponse>({
    queryKey: ['fleet-calendar', fromStr, toStr, locationId],
    queryFn:  () => fetchCalendar(fromStr, toStr, locationId || null),
    staleTime: 30_000,
  })

  const availableClasses = useMemo(() => {
    const classNames = (calendar?.vehicles ?? []).map((v: CalendarVehicle) => v.class_name).filter(Boolean)
    return [...new Set(classNames)] as string[]
  }, [calendar])

  const filteredVehicles = useMemo(() => {
    const vehicles = calendar?.vehicles ?? []
    return selectedClass ? vehicles.filter((v: CalendarVehicle) => v.class_name === selectedClass) : vehicles
  }, [calendar, selectedClass])

  // Group filtered vehicles by location
  const groups = useMemo(() => {
    if (!filteredVehicles.length) return []
    const map = new Map<string, { name: string; vehicles: CalendarVehicle[] }>()
    for (const v of filteredVehicles) {
      if (!map.has(v.home_location_id)) {
        map.set(v.home_location_id, { name: `${v.location_name} (${v.location_short_code})`, vehicles: [] })
      }
      map.get(v.home_location_id)!.vehicles.push(v)
    }
    return [...map.values()]
  }, [filteredVehicles])

  const reallocateMutation = useMutation({
    mutationFn: async ({ blockId, targetVehicleId }: { blockId: string; targetVehicleId: string }) => {
      const res = await fetch(`/api/v1/fleet/blocks/${blockId}/reallocate`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': '00000000-0000-0000-0000-000000000001' },
        body: JSON.stringify({ target_vehicle_id: targetVehicleId, notify_customer: notifyCustomer }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ?? 'Failed') }
      return res.json()
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fleet-calendar'] }); setPendingRealloc(null) },
  })

  function handleDragEnd({ active, over }: { active: any; over: any }) {
    if (!over || !active) return
    const draggedEvent: CalendarEvent    = active.data.current?.event
    const draggedVehicle: CalendarVehicle = active.data.current?.vehicle
    const targetVehicle: CalendarVehicle  = over.data.current?.vehicle
    if (!draggedEvent || !targetVehicle) return
    if (draggedVehicle.vehicle_id === targetVehicle.vehicle_id) return
    if (draggedVehicle.vehicle_class_id !== targetVehicle.vehicle_class_id) {
      return
    }
    setPendingRealloc({ blockId: draggedEvent.event_id, fromVehicle: draggedVehicle, toVehicle: targetVehicle })
  }

  const today = new Date(todayStr)
  const todayOffset = daysBetween(fromDate, today)

  function nav(delta: number) {
    setWindowStart(prev => addDays(prev, delta * DAYS))
  }

  function goToday() {
    setWindowStart(new Date(todayStr))
  }

  const totalVehicles      = filteredVehicles.length
  const vehiclesWithEvents = filteredVehicles.filter(v => v.events.length > 0).length

  return (
    <DndContext onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
      <div className="flex flex-col" style={{ color: 'var(--text-1)' }}>
        {/* ── Page header ── */}
        <div
          className="flex shrink-0 items-center justify-between gap-4 px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h1 className="text-lg font-semibold">Fleet Calendar</h1>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>
              {isLoading ? 'Loading...' : `${totalVehicles} vehicle${totalVehicles !== 1 ? 's' : ''} · ${vehiclesWithEvents} with bookings`}
              {' '}&middot;{' '}{fromStr} to {toStr}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* View toggle */}
            {(['twoweek', 'month'] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                height: 32, padding: '0 12px', fontSize: 12, fontWeight: 600, borderRadius: 0,
                background: viewMode === mode ? 'var(--text-1)' : 'var(--card-bg)',
                color: viewMode === mode ? 'var(--canvas)' : 'var(--text-2)',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>{mode === 'twoweek' ? '2 Weeks' : 'Month'}</button>
            ))}

            {/* Category filter */}
            <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)} style={{
              height: 32, fontSize: 12, background: 'var(--card-bg)', color: 'var(--text-1)',
              border: '1px solid var(--border)', borderRadius: 4, padding: '0 8px',
            }}>
              <option value="">All Categories</option>
              {availableClasses.map(cls => <option key={cls} value={cls}>{cls}</option>)}
            </select>

            {/* Location filter */}
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              className="field-input h-8 px-2.5 text-sm"
              style={{ minWidth: 170 }}
            >
              <option value="">All locations</option>
              {locations?.filter(l => l.is_active).map(l => (
                <option key={l.location_id} value={l.location_id}>{l.name}</option>
              ))}
            </select>

            {/* Navigation */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => nav(-1)}
                className="btn-secondary flex h-8 w-8 items-center justify-center rounded-md text-sm"
                title="Previous period"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>

              <button
                onClick={goToday}
                className="btn-secondary h-8 rounded-md px-3 text-sm font-medium"
              >
                Today
              </button>

              <button
                onClick={() => nav(1)}
                className="btn-secondary flex h-8 w-8 items-center justify-center rounded-md text-sm"
                title="Next period"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="flex shrink-0 items-center gap-4 overflow-x-auto px-6 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          {Object.entries(BLOCK_COLORS).map(([type, c]) => (
            <div key={type} className="flex shrink-0 items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ background: c.bg, border: `1px solid ${c.border}` }}
              />
              <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                {type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, s => s.toUpperCase())}
              </span>
            </div>
          ))}
        </div>

        {/* ── Fleet utilization bar ── */}
        {(() => {
          const vehicles = filteredVehicles
          const totalSlots = vehicles.length * DAYS
          const bookedSlots = vehicles.reduce((acc: number, v: CalendarVehicle) => {
            return acc + v.events
              .filter((e: CalendarEvent) => e.block_type === 'RESERVATION')
              .reduce((s: number, e: CalendarEvent) => {
                const dur = (new Date(e.end_dt).getTime() - new Date(e.start_dt).getTime()) / 86_400_000
                return s + Math.min(dur, DAYS)
              }, 0)
          }, 0)
          const pct = totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0
          return (
            <div style={{ padding: '6px 12px', background: 'var(--card-bg)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 110 }}>Fleet utilization</span>
              <div style={{ flex: 1, height: 6, background: 'var(--border)' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#da291c', transition: 'width 0.3s' }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-2)', minWidth: 32, textAlign: 'right' }}>{pct}%</span>
            </div>
          )
        })()}

        {/* ── Calendar grid ── */}
        <div className="overflow-auto" style={{ minHeight: '60vh' }} ref={scrollRef}>
          {isLoading && (
            <div className="flex h-32 items-center justify-center text-sm" style={{ color: 'var(--text-3)' }}>
              Loading calendar...
            </div>
          )}

          {error && (
            <div className="flex h-32 items-center justify-center text-sm" style={{ color: 'var(--danger)' }}>
              Failed to load calendar data
            </div>
          )}

          {!isLoading && !error && (
            <div className="flex" style={{ minWidth: LEFT_W + DAY_PX * DAYS }}>
              {/* Fixed left column */}
              <div
                className="sticky left-0 z-20 shrink-0 flex flex-col"
                style={{ width: LEFT_W, background: 'var(--page-bg)' }}
              >
                {/* Corner cell */}
                <div
                  className="shrink-0"
                  style={{
                    height: HEADER_H,
                    borderBottom: '1px solid var(--border)',
                    borderRight: '1px solid var(--border)',
                  }}
                />
                {/* Vehicle labels */}
                {groups.map(group => (
                  <div key={group.name}>
                    {/* Location group header */}
                    <div
                      className="flex items-center px-3"
                      style={{
                        height: 32,
                        background: 'var(--card-bg)',
                        borderBottom: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      <span className="truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                        {group.name}
                      </span>
                    </div>
                    {/* Vehicle rows */}
                    {group.vehicles.map(v => (
                      <div
                        key={v.vehicle_id}
                        className="flex flex-col justify-center px-3"
                        style={{
                          height: ROW_H,
                          borderBottom: '1px solid var(--border)',
                          borderRight: '1px solid var(--border)',
                        }}
                      >
                        <p className="truncate text-[12px] font-medium leading-tight">
                          {v.make} {v.model}
                        </p>
                        <p className="truncate text-[11px] leading-tight" style={{ color: 'var(--text-3)' }}>
                          {v.model_year} · {vehicleTag(v)}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Scrollable grid */}
              <div className="relative flex-1">
                {/* Date header */}
                <div
                  className="sticky top-0 z-10 flex"
                  style={{
                    height: HEADER_H,
                    background: 'var(--card-bg)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {days.map((day, i) => {
                    const isToday   = toYMD(day) === todayStr
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6
                    return (
                      <div
                        key={i}
                        className="flex flex-col items-center justify-center shrink-0"
                        style={{
                          width: DAY_PX,
                          borderRight: '1px solid var(--border)',
                          background: isToday ? 'rgba(79,70,229,0.06)' : undefined,
                        }}
                      >
                        <span
                          className="text-[10px] font-medium uppercase tracking-wide"
                          style={{ color: isWeekend ? 'var(--text-3)' : 'var(--text-2)' }}
                        >
                          {day.toLocaleDateString(undefined, { weekday: 'short' })}
                        </span>
                        <span
                          className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold"
                          style={
                            isToday
                              ? { background: '#4f46e5', color: 'white' }
                              : { color: isWeekend ? 'var(--text-3)' : 'var(--text-1)' }
                          }
                        >
                          {day.getDate()}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* Today highlight column (behind rows) */}
                {todayOffset >= 0 && todayOffset < DAYS && (
                  <div
                    className="absolute top-0 bottom-0 z-0 pointer-events-none"
                    style={{
                      left: todayOffset * DAY_PX,
                      width: DAY_PX,
                      background: 'rgba(79,70,229,0.04)',
                    }}
                  />
                )}

                {/* Rows */}
                {groups.map(group => (
                  <div key={group.name}>
                    {/* Location group header row */}
                    <div
                      className="flex"
                      style={{
                        height: 32,
                        background: 'var(--card-bg)',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {days.map((_, i) => (
                        <div
                          key={i}
                          className="shrink-0"
                          style={{ width: DAY_PX, borderRight: '1px solid var(--border)' }}
                        />
                      ))}
                    </div>

                    {/* Vehicle event rows */}
                    {group.vehicles.map(v => (
                      <DropRow
                        key={v.vehicle_id}
                        vehicle={v}
                        days={days}
                        dayPx={DAY_PX}
                        todayOffset={todayOffset}
                        fromDate={fromDate}
                        onHover={setTooltip}
                        onEventClick={(ev, veh) => setSelectedEvent({ event: ev, vehicle: veh })}
                      />
                    ))}
                  </div>
                ))}

                {/* Empty state */}
                {groups.length === 0 && !isLoading && (
                  <div
                    className="flex h-32 items-center justify-center text-sm"
                    style={{ color: 'var(--text-3)' }}
                  >
                    No vehicles found for the selected filter.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tooltip (portal-like, fixed) */}
        {tooltip && <Tooltip tip={tooltip} />}

        {/* ── Inline event detail panel ── */}
        {selectedEvent && (
          <div style={{
            position: 'fixed', right: 0, top: 0, bottom: 0, width: 340,
            background: 'var(--card-bg)', borderLeft: '1px solid var(--border)',
            zIndex: 40, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{selectedEvent.event.label}</span>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>x</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><span style={{ color: 'var(--text-3)' }}>Vehicle: </span>{selectedEvent.vehicle.make} {selectedEvent.vehicle.model} · {selectedEvent.vehicle.plate_number}</div>
              <div><span style={{ color: 'var(--text-3)' }}>Type: </span>{selectedEvent.event.block_type}</div>
              <div><span style={{ color: 'var(--text-3)' }}>Start: </span>{new Date(selectedEvent.event.start_dt).toLocaleString()}</div>
              <div><span style={{ color: 'var(--text-3)' }}>End: </span>{new Date(selectedEvent.event.end_dt).toLocaleString()}</div>
              {selectedEvent.event.sub_label && <div><span style={{ color: 'var(--text-3)' }}>Ref: </span>{selectedEvent.event.sub_label}</div>}
            </div>
            {selectedEvent.event.block_type === 'RESERVATION' && (
              <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>Drag to another vehicle row to reallocate.</p>
            )}
          </div>
        )}

        {/* ── Reallocation confirmation modal ── */}
        {pendingRealloc && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: 24, width: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Reallocate Booking</h3>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0 }}>
                Move from <strong>{pendingRealloc.fromVehicle.make} {pendingRealloc.fromVehicle.model}</strong> to <strong>{pendingRealloc.toVehicle.make} {pendingRealloc.toVehicle.model}</strong>?
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={notifyCustomer} onChange={e => setNotifyCustomer(e.target.checked)} />
                Notify customer of vehicle change
              </label>
              {reallocateMutation.isError && (
                <p style={{ fontSize: 12, color: '#da291c', margin: 0 }}>{(reallocateMutation.error as Error).message}</p>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setPendingRealloc(null)} style={{ height: 36, padding: '0 16px', fontSize: 12, background: 'var(--card-bg)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 0, cursor: 'pointer' }}>Cancel</button>
                <button
                  onClick={() => reallocateMutation.mutate({ blockId: pendingRealloc.blockId, targetVehicleId: pendingRealloc.toVehicle.vehicle_id })}
                  disabled={reallocateMutation.isPending}
                  style={{ height: 36, padding: '0 16px', fontSize: 12, fontWeight: 700, background: '#da291c', color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer', letterSpacing: '1.4px', textTransform: 'uppercase' }}
                >
                  {reallocateMutation.isPending ? 'Moving...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DndContext>
  )
}
