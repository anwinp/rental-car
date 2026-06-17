import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface TaskCard {
  task_id:    string
  category:   string
  title:      string
  subtitle:   string | null
  location:   string
  vehicle_id: string
  status:     'todo' | 'in_progress' | 'done'
  priority:   'high' | 'medium' | 'low'
  start_time: string
  end_time:   string
  plate:      string | null
}

interface TaskBoard {
  todo:        TaskCard[]
  in_progress: TaskCard[]
  done:        TaskCard[]
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  MAINTENANCE: { bg: '#fffbeb', text: '#92400e', border: '#fcd34d' },
  INSPECTION:  { bg: '#faf5ff', text: '#6b21a8', border: '#d8b4fe' },
  RECALL_HOLD: { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' },
  IN_TRANSIT:  { bg: '#f0f9ff', text: '#075985', border: '#7dd3fc' },
  HOLD:        { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
  STAGING:     { bg: '#fdf4ff', text: '#701a75', border: '#e879f9' },
  CHARGING:    { bg: '#ecfdf5', text: '#065f46', border: '#6ee7b7' },
  TURNAROUND:  { bg: '#f0fdf4', text: '#14532d', border: '#86efac' },
}

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  high:   { bg: 'var(--danger-bg)',       text: 'var(--danger)' },
  medium: { bg: 'rgba(245,158,11,0.12)',  text: '#d97706' },
  low:    { bg: 'rgba(16,185,129,0.1)',   text: '#10b981' },
}

function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function fetchTasks(): Promise<TaskBoard> {
  const res = await fetch('/api/v1/dashboard/tasks', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load task board')
  return res.json()
}

async function patchBlock(blockId: string, payload: { start_time?: string; end_time?: string; notes?: string }) {
  const res = await fetch(`/api/v1/fleet/blocks/${blockId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).detail ?? 'Update failed')
  }
  return res.json()
}

function ActionButton({
  label, onClick, danger, loading,
}: { label: string; onClick: () => void; danger?: boolean; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={loading}
      style={{
        fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
        border: `1px solid ${danger ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
        background: danger ? 'var(--danger-bg)' : 'var(--card-bg)',
        color: danger ? 'var(--danger)' : 'var(--text-2)',
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {loading ? '...' : label}
    </button>
  )
}

function Card({ card, onMutate, mutating }: { card: TaskCard; onMutate: (blockId: string, payload: object) => void; mutating: boolean }) {
  const cat = CATEGORY_COLORS[card.category] ?? { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' }
  const pri = PRIORITY_STYLE[card.priority]

  function startTask() {
    const now = new Date()
    // start now, keep end time so it becomes in_progress
    onMutate(card.task_id, { start_time: now.toISOString() })
  }

  function completeTask() {
    // set end_time to 1 minute ago so it's firmly in "done"
    const past = new Date(Date.now() - 60_000)
    onMutate(card.task_id, { end_time: past.toISOString() })
  }

  function reopenTask() {
    // extend end_time 7 days from now → moves back to in_progress
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    onMutate(card.task_id, { end_time: future.toISOString() })
  }

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      {/* Category + priority */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: cat.bg, color: cat.text, border: `1px solid ${cat.border}` }}
        >
          {card.category.replace(/_/g, ' ')}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: pri.bg, color: pri.text }}
        >
          {card.priority}
        </span>
      </div>

      {/* Vehicle */}
      <p className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>
        {card.title}
      </p>

      {/* Subtitle / notes */}
      {card.subtitle && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-2)' }}>
          {card.subtitle}
        </p>
      )}

      {/* Meta */}
      <div className="flex items-center justify-between pt-0.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ background: 'var(--border)', color: 'var(--text-2)' }}
        >
          {card.location}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
          {fmtDate(card.start_time)} → {fmtDate(card.end_time)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
        {card.status === 'todo' && (
          <ActionButton label="Start" onClick={startTask} loading={mutating} />
        )}
        {card.status === 'in_progress' && (
          <ActionButton label="Mark Complete" onClick={completeTask} loading={mutating} />
        )}
        {card.status === 'done' && (
          <ActionButton label="Reopen" onClick={reopenTask} loading={mutating} />
        )}
      </div>
    </div>
  )
}

function Column({
  title, cards, count, accentColor, onMutate, mutatingId,
}: {
  title: string; cards: TaskCard[]; count: number; accentColor: string
  onMutate: (blockId: string, payload: object) => void
  mutatingId: string | null
}) {
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2 px-0.5">
        <span className="h-2 w-2 rounded-full" style={{ background: accentColor }} />
        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
          {title}
        </p>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: 'var(--border)', color: 'var(--text-2)' }}
        >
          {count}
        </span>
      </div>

      <div
        className="rounded-xl p-2 space-y-2 overflow-y-auto"
        style={{
          background: 'var(--page-bg)',
          border: '1px solid var(--border)',
          minHeight: 120,
          maxHeight: 'calc(100vh - 260px)',
        }}
      >
        {cards.length === 0 && (
          <p className="py-6 text-center text-[11px]" style={{ color: 'var(--text-3)' }}>
            No tasks in this column
          </p>
        )}
        {cards.map(card => (
          <Card
            key={card.task_id}
            card={card}
            onMutate={onMutate}
            mutating={mutatingId === card.task_id}
          />
        ))}
      </div>
    </div>
  )
}

const ALL_LOCATIONS  = 'all'
const ALL_CATEGORIES = 'all'

export function TaskBoardPage() {
  const [locFilter, setLocFilter] = useState(ALL_LOCATIONS)
  const [catFilter, setCatFilter] = useState(ALL_CATEGORIES)
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery<TaskBoard>({
    queryKey: ['task-board'],
    queryFn:  fetchTasks,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const mutation = useMutation({
    mutationFn: ({ blockId, payload }: { blockId: string; payload: object }) =>
      patchBlock(blockId, payload as any),
    onMutate: ({ blockId }) => setMutatingId(blockId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-board'] })
      showToast('Task updated', true)
    },
    onError: (err: Error) => showToast(err.message, false),
    onSettled: () => setMutatingId(null),
  })

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function handleMutate(blockId: string, payload: object) {
    mutation.mutate({ blockId, payload })
  }

  const allCards = useMemo(() => [
    ...(data?.todo ?? []),
    ...(data?.in_progress ?? []),
    ...(data?.done ?? []),
  ], [data])

  const locations  = useMemo(() => [...new Set(allCards.map(c => c.location))].sort(), [allCards])
  const categories = useMemo(() => [...new Set(allCards.map(c => c.category))].sort(), [allCards])

  function filterCards(cards: TaskCard[]) {
    return cards.filter(c =>
      (locFilter === ALL_LOCATIONS  || c.location === locFilter) &&
      (catFilter === ALL_CATEGORIES || c.category === catFilter)
    )
  }

  const filtered = {
    todo:        filterCards(data?.todo ?? []),
    in_progress: filterCards(data?.in_progress ?? []),
    done:        filterCards(data?.done ?? []),
  }

  const totalShown = filtered.todo.length + filtered.in_progress.length + filtered.done.length

  return (
    <div className="flex flex-col gap-4" style={{ color: 'var(--text-1)' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            background: toast.ok ? 'rgba(16,185,129,0.15)' : 'var(--danger-bg)',
            color: toast.ok ? '#10b981' : 'var(--danger)',
            border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between gap-4 flex-wrap"
        style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}
      >
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Task Board</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            {isLoading ? 'Loading...' : `${totalShown} task${totalShown !== 1 ? 's' : ''} shown`}
            {data && ` · ${data.in_progress.length} in progress`}
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={locFilter}
            onChange={e => setLocFilter(e.target.value)}
            className="field-input h-8 px-2.5 text-sm"
            style={{ minWidth: 130 }}
          >
            <option value={ALL_LOCATIONS}>All locations</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>

          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="field-input h-8 px-2.5 text-sm"
            style={{ minWidth: 150 }}
          >
            <option value={ALL_CATEGORIES}>All categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>

          {(locFilter !== ALL_LOCATIONS || catFilter !== ALL_CATEGORIES) && (
            <button
              onClick={() => { setLocFilter(ALL_LOCATIONS); setCatFilter(ALL_CATEGORIES) }}
              className="btn-secondary h-8 rounded-md px-3 text-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          Failed to load task board.
        </div>
      )}

      {/* Kanban columns */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <Column
          title="To Do"
          cards={filtered.todo}
          count={filtered.todo.length}
          accentColor="#94a3b8"
          onMutate={handleMutate}
          mutatingId={mutatingId}
        />
        <Column
          title="In Progress"
          cards={filtered.in_progress}
          count={filtered.in_progress.length}
          accentColor="var(--accent)"
          onMutate={handleMutate}
          mutatingId={mutatingId}
        />
        <Column
          title="Done"
          cards={filtered.done}
          count={filtered.done.length}
          accentColor="#10b981"
          onMutate={handleMutate}
          mutatingId={mutatingId}
        />
      </div>
    </div>
  )
}
