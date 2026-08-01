import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Post-signup onboarding checklist.
 *
 * Reads the readiness gate for the signed-in workspace. There is no tenant id
 * in the URL by design — the API scopes this to the caller's own tenant from
 * their session, so one workspace cannot inspect another's setup progress.
 */

interface ChecklistItem {
  key: string
  label: string
  detail: string
  done: boolean
  count: number
  self_serve: boolean
}

interface Checklist {
  items: ChecklistItem[]
  completed: number
  total: number
  ready: boolean
}

const DESTINATION: Record<string, string> = {
  location: '/locations',
  rate: '/pricing',
  vehicles: '/fleet',
  staff: '/team',
  classes: '/fleet',
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<Checklist | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const res = await fetch('/api/v1/tenants/onboarding/checklist', {
        credentials: 'include',
      })
      if (!res.ok) {
        setError('Could not load your setup progress.')
        return
      }
      setData(await res.json())
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return (
      <div className="p-8 text-sm text-slate-400">Loading your setup progress…</div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error || 'No data.'}
          <button onClick={load} className="ml-3 font-medium underline">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const pct = Math.round((data.completed / data.total) * 100)

  return (
    <div className="mx-auto max-w-3xl p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Getting started
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {data.ready ? 'Your workspace is ready' : 'Finish setting up your workspace'}
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">
          {data.ready
            ? 'Everything needed to take a booking is in place. You can keep adding fleet and staff at any time.'
            : 'We created a starter branch and standard pricing for you. A couple of things still need your input before you can take a booking.'}
        </p>
      </header>

      <div className="mt-7">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-slate-300">
            {data.completed} of {data.total} complete
          </span>
          <span className="font-mono text-sm tabular-nums text-slate-400">{pct}%</span>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="mt-8 space-y-3">
        {data.items.map((item) => (
          <li
            key={item.key}
            className={`flex items-start gap-4 rounded-xl border p-5 transition ${
              item.done
                ? 'border-slate-800 bg-slate-900/40'
                : 'border-slate-700 bg-slate-900'
            }`}
          >
            <span
              className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${
                item.done ? 'bg-emerald-500/15' : 'bg-slate-800'
              }`}
              aria-hidden="true"
            >
              {item.done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399"
                     strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  className={`text-sm font-semibold ${
                    item.done ? 'text-slate-400' : 'text-white'
                  }`}
                >
                  {item.label}
                </h2>
                {item.count > 0 && (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                    {item.count}
                  </span>
                )}
                {item.done && (
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                    Done
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{item.detail}</p>
            </div>

            {!item.done && (
              <button
                onClick={() => navigate(DESTINATION[item.key] ?? '/dashboard')}
                className="flex-none self-center rounded-lg bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-400"
              >
                Set up
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
        >
          Go to dashboard
        </button>
        <button
          onClick={load}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition hover:text-slate-200"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
