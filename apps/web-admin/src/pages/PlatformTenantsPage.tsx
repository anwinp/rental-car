import { useEffect, useState, type FormEvent } from 'react'

/**
 * Platform console — manage every workspace on the installation.
 *
 * Only reachable by holders of the platform-admin flag; the API answers 404 to
 * everyone else, so this page simply renders "not found" for them rather than
 * advertising that a console exists.
 *
 * Destructive actions are deliberately unequal in weight: suspend is one click
 * because it is reversible, delete demands the workspace address typed back
 * because it is not.
 */

interface Tenant {
  tenant_id: string
  slug: string
  name: string
  status: string
  primary_email: string
  created_at: string
  staff: number
  locations: number
  vehicles: number
  reservations: number
  is_self: boolean
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400',
  SUSPENDED: 'bg-amber-500/15 text-amber-400',
  PENDING_VERIFICATION: 'bg-slate-500/15 text-slate-400',
  CANCELLED: 'bg-red-500/15 text-red-400',
}

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<Tenant | null>(null)
  const [confirmText, setConfirmText] = useState('')

  async function load() {
    setError('')
    try {
      const res = await fetch('/api/v1/platform/tenants', { credentials: 'include' })
      if (res.status === 404 || res.status === 401) {
        setDenied(true)
        return
      }
      if (!res.ok) {
        setError('Could not load workspaces.')
        return
      }
      setTenants(await res.json())
    } catch {
      setError('Could not reach the server.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function act(t: Tenant, path: string, method = 'POST', body?: unknown) {
    setBusy(t.tenant_id)
    setError('')
    try {
      const res = await fetch(`/api/v1/platform/tenants/${t.tenant_id}${path}`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'That did not work.')
        return false
      }
      await load()
      return true
    } catch {
      setError('Could not reach the server.')
      return false
    } finally {
      setBusy(null)
    }
  }

  if (denied) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold text-white">Not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          This page is not available for your account.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
            Platform
          </p>
          <h1 className="mt-2 text-2xl font-bold text-white">Workspaces</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">
            Every organisation on this installation. Suspending blocks sign-in but keeps
            all data; deleting cannot be undone.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
        >
          {showCreate ? 'Cancel' : 'New workspace'}
        </button>
      </header>

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {showCreate && (
        <CreateForm
          onDone={async () => {
            setShowCreate(false)
            await load()
          }}
          onError={setError}
        />
      )}

      <div className="mt-8 overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="bg-slate-900/60 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Staff</th>
              <th className="px-4 py-3 text-right font-semibold">Branches</th>
              <th className="px-4 py-3 text-right font-semibold">Vehicles</th>
              <th className="px-4 py-3 text-right font-semibold">Bookings</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants === null && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {tenants?.map((t) => (
              <tr key={t.tenant_id} className="border-t border-slate-800">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{t.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    {t.slug}
                    {t.is_self && (
                      <span className="ml-2 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                        you
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                      STATUS_STYLE[t.status] ?? 'bg-slate-500/15 text-slate-400'
                    }`}
                  >
                    {t.status.replace('_', ' ').toLowerCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{t.staff}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{t.locations}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{t.vehicles}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{t.reservations}</td>
                <td className="px-4 py-3">
                  {t.is_self ? (
                    <span className="text-xs text-slate-600">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {t.status === 'SUSPENDED' ? (
                        <button
                          disabled={busy === t.tenant_id}
                          onClick={() => act(t, '/reactivate')}
                          className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:text-slate-500"
                        >
                          Reactivate
                        </button>
                      ) : (
                        <button
                          disabled={busy === t.tenant_id}
                          onClick={() => act(t, '/suspend')}
                          className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:text-slate-500"
                        >
                          Suspend
                        </button>
                      )}
                      <button
                        disabled={busy === t.tenant_id}
                        onClick={() => {
                          setDeleting(t)
                          setConfirmText('')
                        }}
                        className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:text-slate-500"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6">
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-900 p-6">
            <h2 className="text-lg font-bold text-white">
              Delete {deleting.name}?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              This permanently removes the workspace and everything in it —{' '}
              <strong className="text-slate-200">
                {deleting.staff} staff, {deleting.locations} branches,{' '}
                {deleting.vehicles} vehicles, {deleting.reservations} bookings
              </strong>
              . It cannot be undone. Suspend instead if you may need the data later.
            </p>
            <label htmlFor="confirm" className="mt-5 block text-sm font-medium text-slate-300">
              Type <span className="font-mono text-red-300">{deleting.slug}</span> to confirm
            </label>
            <input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-red-500 focus:outline-none"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                disabled={confirmText !== deleting.slug || busy === deleting.tenant_id}
                onClick={async () => {
                  const ok = await act(deleting, '', 'DELETE', { confirm_slug: confirmText })
                  if (ok) setDeleting(null)
                }}
                className="rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateForm({
  onDone,
  onError,
}: {
  onDone: () => void
  onError: (m: string) => void
}) {
  const [form, setForm] = useState({
    company_name: '',
    slug: '',
    admin_first_name: '',
    admin_last_name: '',
    admin_email: '',
    admin_password: '',
  })
  const [saving, setSaving] = useState(false)

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    onError('')
    try {
      const res = await fetch('/api/v1/platform/tenants', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail
        onError(String(d ?? 'Could not create the workspace.'))
        return
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const fields: [keyof typeof form, string, string][] = [
    ['company_name', 'Company name', 'text'],
    ['slug', 'Workspace address', 'text'],
    ['admin_first_name', 'Admin first name', 'text'],
    ['admin_last_name', 'Admin last name', 'text'],
    ['admin_email', 'Admin email', 'email'],
    ['admin_password', 'Admin password', 'password'],
  ]

  return (
    <form
      onSubmit={submit}
      className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
    >
      <p className="text-sm text-slate-400">
        Created active immediately — no email confirmation, because you are vouching
        for the address.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {fields.map(([key, label, type]) => (
          <div key={key}>
            <label htmlFor={key} className="block text-sm font-medium text-slate-300">
              {label}
            </label>
            <input
              id={key}
              type={type}
              required
              value={form[key]}
              onChange={(e) =>
                set(key, key === 'slug' ? e.target.value.toLowerCase().trim() : e.target.value)
              }
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              style={key === 'slug' ? { fontFamily: 'ui-monospace, monospace' } : undefined}
            />
          </div>
        ))}
      </div>
      <button
        type="submit"
        disabled={saving}
        className="mt-5 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:bg-slate-700"
      >
        {saving ? 'Creating…' : 'Create workspace'}
      </button>
    </form>
  )
}
