import { useState, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_PX   = 60   // width per day column
const ROW_H    = 48   // height per vehicle row
const LEFT_W   = 220  // width of vehicle label column
const HEADER_H = 56   // height of date header row
const DAYS     = 14   // number of days in window

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

// ── Event bar ─────────────────────────────────────────────────────────────────

interface EventBarProps {
  event:      CalendarEvent
  vehicle:    CalendarVehicle
  fromDate:   Date
  onHover:    (tip: TooltipState | null) => void
}

function EventBar({ event, vehicle, fromDate, onHover }: EventBarProps) {
  const color  = BLOCK_COLORS[event.block_type] ?? DEFAULT_COLOR
  const startD = parseUTC(event.start_dt)
  const endD   = parseUTC(event.end_dt)

  // Offset from window start in fractional days
  const offsetDays = daysBetween(fromDate, startD)
  const durationMs = endD.getTime() - startD.getTime()
  const durationDays = durationMs / 86_400_000

  const left   = Math.max(0, offsetDays * DAY_PX)
  const width  = Math.max(durationDays * DAY_PX - 2, 6)  // at least 6px

  return (
    <div
      className="absolute top-1.5 flex cursor-default items-center overflow-hidden rounded"
      style={{
        left,
        width,
        height: ROW_H - 12,
        background: color.bg,
        border: `1px solid ${color.border}`,
        color: color.text,
      }}
      onMouseMove={(e) =>
        onHover({ event, vehicle, x: e.clientX, y: e.clientY })
      }
      onMouseLeave={() => onHover(null)}
    >
      <span className="truncate px-2 text-[11px] font-medium leading-none select-none">
        {event.label}
      </span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FleetCalendarPage() {
  // Window: today to today + DAYS
  const todayStr = toYMD(new Date())
  const [windowStart, setWindowStart] = useState<Date>(() => new Date(todayStr))
  const [locationId, setLocationId]   = useState<string>('')
  const [tooltip, setTooltip]         = useState<TooltipState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fromDate = windowStart
  const toDate   = addDays(windowStart, DAYS - 1)
  const fromStr  = toYMD(fromDate)
  const toStr    = toYMD(toDate)

  // Day labels
  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(fromDate, i)),
    [fromDate],
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

  // Group vehicles by location
  const groups = useMemo(() => {
    if (!calendar?.vehicles) return []
    const map = new Map<string, { name: string; vehicles: CalendarVehicle[] }>()
    for (const v of calendar.vehicles) {
      if (!map.has(v.home_location_id)) {
        map.set(v.home_location_id, { name: `${v.location_name} (${v.location_short_code})`, vehicles: [] })
      }
      map.get(v.home_location_id)!.vehicles.push(v)
    }
    return [...map.values()]
  }, [calendar])

  const today = new Date(todayStr)
  const todayOffset = daysBetween(fromDate, today)

  function nav(delta: number) {
    setWindowStart(prev => addDays(prev, delta * DAYS))
  }

  function goToday() {
    setWindowStart(new Date(todayStr))
  }

  const totalVehicles   = calendar?.vehicles.length ?? 0
  const vehiclesWithEvents = calendar?.vehicles.filter(v => v.events.length > 0).length ?? 0

  return (
    <div className="flex flex-col" style={{ color: 'var(--text-1)' }}>
      {/* ── Page header ── */}
      <div
        className="flex shrink-0 items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <h1 className="text-lg font-semibold">Fleet Calendar</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            {isLoading ? 'Loading…' : `${totalVehicles} vehicle${totalVehicles !== 1 ? 's' : ''} · ${vehiclesWithEvents} with bookings`}
            {' '}&middot;{' '}{fromStr} to {toStr}
          </p>
        </div>

        <div className="flex items-center gap-3">
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
                  const isToday = toYMD(day) === todayStr
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
                    <div
                      key={v.vehicle_id}
                      className="relative flex"
                      style={{
                        height: ROW_H,
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {/* Day grid lines */}
                      {days.map((_, i) => (
                        <div
                          key={i}
                          className="shrink-0"
                          style={{
                            width: DAY_PX,
                            borderRight: '1px solid var(--border)',
                            background:
                              i === todayOffset
                                ? 'rgba(79,70,229,0.04)'
                                : undefined,
                          }}
                        />
                      ))}

                      {/* Events */}
                      {v.events.map(ev => (
                        <EventBar
                          key={ev.event_id}
                          event={ev}
                          vehicle={v}
                          fromDate={fromDate}
                          onHover={setTooltip}
                        />
                      ))}
                    </div>
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
    </div>
  )
}
