import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberSlug } from '../tenant'

/**
 * Accepting an invitation to join a workspace.
 *
 * Public route — the invitee has no account yet. The token identifies both the
 * workspace and the role, so nothing here is chosen by the person accepting:
 * they only set a password.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; workspace: string; role: string; email: string; slug: string }
  | { kind: 'done'; workspace: string }
  | { kind: 'invalid'; message: string }

export default function AcceptInvitePage() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loaded = useRef(false)

  const token = new URLSearchParams(window.location.search).get('token') ?? ''

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    if (!token) {
      setState({ kind: 'invalid', message: 'This invitation link is incomplete.' })
      return
    }
    ;(async () => {
      try {
        const res = await fetch(
          `/api/v1/public/invite-details?token=${encodeURIComponent(token)}`,
        )
        const data = await res.json()
        if (!res.ok) {
          setState({
            kind: 'invalid',
            message: String(data.detail ?? 'This invitation is no longer valid.'),
          })
          return
        }
        setFirstName(data.first_name ?? '')
        setLastName(data.last_name ?? '')
        setState({
          kind: 'ready',
          workspace: data.workspace,
          role: data.role,
          email: data.email,
          slug: data.slug,
        })
      } catch {
        setState({ kind: 'invalid', message: 'Could not reach the server.' })
      }
    })()
  }, [token])

  const passwordOk =
    password.length >= 10 && /[A-Z]/.test(password) && /\d/.test(password)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/v1/public/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail
        setError(String(d ?? 'Could not create your account.'))
        return
      }
      if (state.kind === 'ready') {
        rememberSlug(state.slug)
        setState({ kind: 'done', workspace: state.workspace })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8">
        {state.kind === 'loading' && (
          <p className="text-sm text-slate-400">Checking your invitation…</p>
        )}

        {state.kind === 'invalid' && (
          <>
            <h1 className="text-xl font-bold text-white">
              This invitation can&apos;t be used
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {state.message} Ask whoever invited you to send a new one.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="mt-7 w-full rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              Go to sign in
            </button>
          </>
        )}

        {state.kind === 'done' && (
          <>
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399"
                   strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">
              Welcome to {state.workspace}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Your account is ready. Sign in with the email you were invited on.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="mt-7 w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              Sign in
            </button>
          </>
        )}

        {state.kind === 'ready' && (
          <form onSubmit={submit}>
            <h1 className="text-2xl font-bold text-white">
              Join {state.workspace}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              You have been invited as{' '}
              <strong className="text-slate-200">
                {state.role.replace(/_/g, ' ').toLowerCase()}
              </strong>
              . Choose a password to finish setting up{' '}
              <span className="font-medium text-slate-200">{state.email}</span>.
            </p>

            {error && (
              <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="first" className="block text-sm font-medium text-slate-300">
                  First name
                </label>
                <input
                  id="first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="last" className="block text-sm font-medium text-slate-300">
                  Last name
                </label>
                <input
                  id="last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                At least 10 characters, with a capital letter and a number.
              </p>
            </div>

            <button
              type="submit"
              disabled={!passwordOk || busy}
              className="mt-7 w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
            >
              {busy ? 'Creating your account…' : 'Join workspace'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
