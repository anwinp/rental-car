import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@rcm/ui/auth'

const TENANT = '00000000-0000-0000-0000-000000000001'
const HEADERS = { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT }

type Task = {
  task_id: string; task_type: string; title: string; notes: string | null
  status: string; priority: string; due_datetime: string | null
  assignee_id: string | null; reservation_id: string | null; vehicle_id: string | null
  blocked_reason: string | null
}

type Section = { label: string; tasks: Task[] }
type DailyData = { date: string; sections: Section[]; total_count: number; done_count: number }

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: '#da291c', MEDIUM: '#d97706', LOW: '#10b981',
}
const TYPE_LABELS: Record<string, string> = {
  PICKUP_PREP: 'Pickup Prep', RETURN_INSPECTION: 'Return Inspect',
  CUSTOMER_DROPOFF: 'Drop-off', DOC_COLLECTION: 'Documents',
  HANDOVER: 'Handover', MAINTENANCE: 'Maintenance',
  TURNAROUND: 'Turnaround', GENERAL: 'General',
}
const STATUS_CYCLE: Record<string, string> = { TODO: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: 'TODO' }

function fmtTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isOverdue(due: string | null) {
  return due ? new Date(due) < new Date() : false
}

function TaskRow({ task, onStatusToggle }: { task: Task; onStatusToggle: (id: string, newStatus: string) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
      borderBottom: '1px solid var(--border)', minHeight: 44,
    }}>
      <button
        onClick={() => onStatusToggle(task.task_id, STATUS_CYCLE[task.status] ?? 'TODO')}
        style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${task.status === 'DONE' ? '#10b981' : task.status === 'IN_PROGRESS' ? '#d97706' : 'var(--border)'}`,
          background: task.status === 'DONE' ? '#10b981' : 'transparent',
          cursor: 'pointer',
        }}
      />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[task.priority] ?? 'var(--border)', flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-3)', flexShrink: 0 }}>
        {TYPE_LABELS[task.task_type] ?? task.task_type}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: task.status === 'DONE' ? 'var(--text-3)' : 'var(--text-1)', textDecoration: task.status === 'DONE' ? 'line-through' : 'none' }}>
        {task.title}
      </span>
      {task.status === 'BLOCKED' && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', background: 'rgba(220,38,38,0.15)', color: '#da291c', borderRadius: 9999 }}>BLOCKED</span>
      )}
      <span style={{ fontSize: 11, color: isOverdue(task.due_datetime) ? '#da291c' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {fmtTime(task.due_datetime)}
      </span>
    </div>
  )
}

function Section({ section, onStatusToggle }: { section: Section; onStatusToggle: (id: string, s: string) => void }) {
  const [collapsed, setCollapsed] = useState(section.label === 'Later')
  return (
    <div>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{ width: '100%', textAlign: 'left', padding: '8px 16px', background: 'var(--card-bg)', border: 'none', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: section.label === 'Overdue' ? '#da291c' : 'var(--text-2)' }}>
          {section.label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{section.tasks.length} task{section.tasks.length !== 1 ? 's' : ''} {collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && section.tasks.map(t => (
        <TaskRow key={t.task_id} task={t} onStatusToggle={onStatusToggle} />
      ))}
    </div>
  )
}

export default function StaffDailyTaskListPage() {
  useAuth()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data, isLoading } = useQuery<DailyData>({
    queryKey: ['staff-daily-tasks', today],
    queryFn: () => fetch(`/api/v1/tasks/staff-daily?date=${today}`, { credentials: 'include', headers: HEADERS }).then(r => r.json()),
    staleTime: 30_000, refetchInterval: 60_000,
  })

  const updateMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      fetch(`/api/v1/tasks/${taskId}`, {
        method: 'PATCH', credentials: 'include', headers: HEADERS,
        body: JSON.stringify({ status }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-daily-tasks'] }),
  })

  const handleStatusToggle = (taskId: string, newStatus: string) => {
    updateMutation.mutate({ taskId, status: newStatus })
  }

  const total = data?.total_count ?? 0
  const done = data?.done_count ?? 0
  const pct = total + done > 0 ? Math.round((done / (total + done)) * 100) : 0

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>My Tasks</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '4px 0 0' }}>
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{done} of {total + done} done</span>
        </div>
      </div>
      {total + done > 0 && (
        <div style={{ height: 4, background: 'var(--border)', marginBottom: 24 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', transition: 'width 0.3s' }} />
        </div>
      )}
      {isLoading ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading tasks...</p>
      ) : !data?.sections?.length ? (
        <div style={{ padding: '48px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>No tasks for today</p>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Check back later or ask your manager to assign tasks.</p>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)' }}>
          {data.sections.map(s => (
            <Section key={s.label} section={s} onStatusToggle={handleStatusToggle} />
          ))}
        </div>
      )}
    </div>
  )
}
