import { useEffect, useState, type FormEvent } from 'react'

/**
 * Team management: who is in this workspace, and who has been invited.
 *
 * Until this existed a self-registered workspace was permanently single-user —
 * the onboarding checklist asked people to "invite your team" with nothing
 * behind it.
 */

interface Member {
  user_id: string
  email: string
  first_name: string
  last_name: string
  role: string
  is_active: boolean
  email_verified: boolean
}

interface Invitation {
  invitation_id: string
  email: string
  role: string
  expires_at: string
  created_at: string
}

interface Team {
  members: Member[]
  pending: Invitation[]
  seats_used: number
  seats_limit: number | null
}

const ROLES = [
  ['COUNTER_AGENT', 'Counter agent'],
  ['SENIOR_AGENT', 'Senior agent'],
  ['BRANCH_MANAGER', 'Branch manager'],
  ['REGIONAL_MANAGER', 'Regional manager'],
  ['FLEET_MANAGER', 'Fleet manager'],
  ['MAINTENANCE_TECH', 'Maintenance technician'],
  ['CLAIMS_COORDINATOR', 'Claims coordinator'],
  ['FINANCE_ANALYST', 'Finance analyst'],
  ['READONLY_AUDITOR', 'Auditor (read only)'],
  ['SYSTEM_ADMIN', 'Administrator'],
]

function pretty(role: string) {
  return ROLES.find(([k]) => k === role)?.[1] ?? role.replace(/_/g, ' ').toLowerCase()
}

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('COUNTER_AGENT')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/v1/team', { credentials: 'include' })
      if (!res.ok) {
        setError('Could not load your team.')
        return
      }
      setTeam(await res.json())
    } catch {
      setError('Could not reach the server.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const atCapacity =
    team?.seats_limit != null && team.seats_used >= team.seats_limit

  async function invite(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const res = await fetch('/api/v1/team/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          role,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail
        setError(String(d ?? 'Could not send the invitation.'))
        return
      }
      setNotice(data.message ?? 'Invitation sent.')
      setEmail('')
      setFirstName('')
      setLastName('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setError('')
    const res = await fetch(`/api/v1/team/invitations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setNotice('Invitation revoked.')
      await load()
    } else {
      setError('Could not revoke that invitation.')
    }
  }

  async function deactivate(m: Member) {
    setError('')
    const res = await fetch(`/api/v1/team/members/${m.user_id}/deactivate`, {
      method: 'POST',
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setNotice(`${m.email} deactivated.`)
      await load()
    } else {
      setError(String(data.detail ?? 'Could not deactivate that person.'))
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
          Workspace
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Your team</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">
          Invite the people who will run your branches. They choose their own
          password when they accept — you never handle it.
        </p>
      </header>

      {team && (
        <p className="mt-4 text-sm text-slate-400">
          <span className="font-mono tabular-nums text-slate-200">
            {team.seats_used}
          </span>
          {team.seats_limit != null ? (
            <>
              {' '}of{' '}
              <span className="font-mono tabular-nums text-slate-200">
                {team.seats_limit}
              </span>{' '}
              seats used
            </>
          ) : (
            ' seats used (unlimited)'
          )}
        </p>
      )}

      {error && (
        <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <form
        onSubmit={invite}
        className="mt-7 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <h2 className="text-sm font-semibold text-white">Invite someone</h2>
        {atCapacity && (
          <p className="mt-2 text-sm text-amber-400">
            You have used every seat on your plan. Revoke a pending invitation or
            upgrade to invite more.
          </p>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="inv-email" className="block text-sm font-medium text-slate-300">
              Work email
            </label>
            <input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="inv-first" className="block text-sm font-medium text-slate-300">
              First name <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="inv-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="inv-last" className="block text-sm font-medium text-slate-300">
              Last name <span className="text-slate-500">(optional)</span>
            </label>
            <input
              id="inv-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="inv-role" className="block text-sm font-medium text-slate-300">
              Role
            </label>
            <select
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {ROLES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={busy || !email || atCapacity}
          className="mt-5 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-slate-500">
        Members
      </h2>
      <ul className="mt-3 space-y-2">
        {team?.members.map((m) => (
          <li
            key={m.user_id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">
                {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}
              </p>
              <p className="text-xs text-slate-500">{m.email}</p>
            </div>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              {pretty(m.role)}
            </span>
            {!m.is_active && (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                inactive
              </span>
            )}
            {m.is_active && (
              <button
                onClick={() => deactivate(m)}
                className="text-xs font-medium text-slate-500 transition hover:text-red-300"
              >
                Deactivate
              </button>
            )}
          </li>
        ))}
      </ul>

      {team && team.pending.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Pending invitations
          </h2>
          <ul className="mt-3 space-y-2">
            {team.pending.map((p) => (
              <li
                key={p.invitation_id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-700 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-300">{p.email}</p>
                  <p className="text-xs text-slate-500">
                    Expires {new Date(p.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {pretty(p.role)}
                </span>
                <button
                  onClick={() => revoke(p.invitation_id)}
                  className="text-xs font-medium text-slate-500 transition hover:text-red-300"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
