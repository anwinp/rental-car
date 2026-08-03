import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Skeleton } from '@rcm/ui'

interface AvailabilityClass {
  classId: string
  classCode: string
  className: string
  availableCount: number
}

interface AvailabilityData {
  locationId: string
  classes: AvailabilityClass[]
  updatedAt: string
}

interface AvailabilityEvent {
  classId: string
  availableCount: number
}

function applyAvailabilityPatch(
  current: AvailabilityData | undefined,
  event: AvailabilityEvent
): AvailabilityData | undefined {
  if (!current) return current
  return {
    ...current,
    classes: current.classes.map((cls) =>
      cls.classId === event.classId
        ? { ...cls, availableCount: event.availableCount }
        : cls
    ),
    updatedAt: new Date().toISOString(),
  }
}

function getAvailabilityColor(count: number): {
  bg: string
  text: string
  label: string
} {
  if (count === 0) return { bg: 'bg-red-100', text: 'text-red-700', label: 'Sold out' }
  if (count <= 2) return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Low availability' }
  return { bg: 'bg-green-100', text: 'text-green-700', label: 'Available' }
}

interface AvailabilityGridProps {
  locationId: string
  /** Optional: filter to a specific class */
  filterClassId?: string
  /** Optional: called when a vehicle class cell is clicked */
  onClassSelect?: (classId: string) => void
}

export function AvailabilityGrid({
  locationId,
  filterClassId,
  onClassSelect,
}: AvailabilityGridProps) {
  const queryClient = useQueryClient()
  const queryKey = ['availability', locationId]

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      // Was GET /fleet/availability/{locationId}, which is not a route — this
      // 404'd on every render, so the grid only ever showed its error state.
      // It typechecked because the call was made through `apiClient as never`,
      // which is exactly what stops a wrong path from being caught.
      const res = await fetch(
        `/api/v1/fleet/availability/grid?location_id=${encodeURIComponent(locationId)}`,
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`Availability unavailable (${res.status})`)
      return await res.json() as AvailabilityData
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  // WebSocket subscription for real-time updates
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${protocol}://${location.host}/api/v1/ws/fleet/${locationId}`

    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      ws = new WebSocket(wsUrl)

      ws.onmessage = (event) => {
        try {
          const patch: AvailabilityEvent = JSON.parse(event.data as string)
          queryClient.setQueryData(
            queryKey,
            (old: AvailabilityData | undefined) => applyAvailabilityPatch(old, patch)
          )
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onerror = () => {
        ws.close()
      }

      ws.onclose = () => {
        // Reconnect after 5s — TanStack Query poll is the fallback
        reconnectTimer = setTimeout(connect, 5_000)
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading availability grid">
        <Skeleton variant="table" rows={8} className="h-64" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load availability data. Retrying automatically.
      </div>
    )
  }

  const classes = filterClassId
    ? data.classes.filter((c) => c.classId === filterClassId)
    : data.classes

  return (
    <div
      role="grid"
      aria-label={`Vehicle availability for location ${locationId}`}
      className="overflow-x-auto rounded-lg border"
    >
      {/* Header */}
      <div
        role="row"
        className="grid border-b bg-muted/50 font-medium text-sm"
        style={{ gridTemplateColumns: 'minmax(160px, 1fr) repeat(4, minmax(80px, 1fr))' }}
      >
        <div role="columnheader" className="p-3 text-muted-foreground">
          Vehicle Class
        </div>
        {['Now', '+6h', '+12h', '+18h'].map((slot) => (
          <div key={slot} role="columnheader" className="p-3 text-center text-muted-foreground">
            {slot}
          </div>
        ))}
      </div>

      {/* Rows */}
      {classes.map((cls) => {
        const { bg, text, label } = getAvailabilityColor(cls.availableCount)
        const isClickable = !!onClassSelect && cls.availableCount > 0

        return (
          <div
            key={cls.classId}
            role="row"
            className="grid border-b last:border-0"
            style={{ gridTemplateColumns: 'minmax(160px, 1fr) repeat(4, minmax(80px, 1fr))' }}
          >
            <div role="rowheader" className="flex items-center p-3 text-sm font-medium">
              {cls.className}
              <span className="ml-1 text-xs text-muted-foreground">({cls.classCode})</span>
            </div>
            {/* Show the same count in all time slots (live update applies to current availability) */}
            {[0, 1, 2, 3].map((slotIdx) => (
              <div
                key={slotIdx}
                role="gridcell"
                className="flex items-center justify-center p-2"
              >
                <button
                  onClick={() => isClickable && onClassSelect(cls.classId)}
                  disabled={!isClickable || slotIdx !== 0}
                  aria-label={
                    slotIdx === 0
                      ? `${cls.className}: ${cls.availableCount} available — ${label}`
                      : undefined
                  }
                  className={`
                    flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold transition-colors
                    ${bg} ${text}
                    ${isClickable && slotIdx === 0 ? 'cursor-pointer hover:opacity-80 min-h-[44px] min-w-[44px]' : 'cursor-default'}
                    disabled:cursor-default disabled:opacity-40
                  `}
                >
                  {cls.availableCount}
                </button>
              </div>
            ))}
          </div>
        )
      })}

      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        Last updated: {new Date(data.updatedAt).toLocaleTimeString()}
        {' · '}
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-400 inline-block" aria-hidden="true" />
          ≥3 available
        </span>
        {' · '}
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" aria-hidden="true" />
          1–2 left
        </span>
        {' · '}
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-400 inline-block" aria-hidden="true" />
          Sold out
        </span>
      </div>
    </div>
  )
}
