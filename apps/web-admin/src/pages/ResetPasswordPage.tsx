import { useEffect, useState, type FormEvent } from 'react'
import { Shell } from './ForgotPasswordPage'
import { describeApiError } from '../apiError'

/**
 * Redeem a reset link and choose a new password.
 *
 * The token carries its own workspace, so this page works wherever the person
 * opens their mail — including a different device from the one that asked.
 *
 * Completing a reset revokes every existing session for that account (the API
 * raises the credential epoch), which is what makes reset a usable response to
 * "someone else may be in my account".
 */

/** Mirrors the server rule so the requirement is visible before submitting. */
const RULES: Array<{ label: string; ok: (v: string) => boolean }> = [
  { label: 'At least 12 characters', ok: (v) => v.length >= 12 },
  { label: 'An uppercase letter', ok: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', ok: (v) => /[a-z]/.test(v) },
  { label: 'A number', ok: (v) => /\d/.test(v) },
  { label: 'A symbol', ok: (v) => /[^A-Za-z0-9]/.test(v) },
]

export function ResetPasswordPage() {
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '')
  }, [])

  const unmet = RULES.filter((r) => !r.ok(password))
  const mismatch = confirm.length > 0 && confirm !== password
  const canSubmit = token && unmet.length === 0 && !mismatch && confirm.length > 0

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      })
      if (res.ok) {
        setDone(true)
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(
        describeApiError(body, res.status),
      )
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-white">Link incomplete</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          This address is missing its reset token. Open the link from your email
          directly, or request a new one.
        </p>
        <a
          href="/forgot-password"
          className="mt-6 inline-block text-sm font-medium text-indigo-400 hover:text-indigo-300"
        >
          Request a new link →
        </a>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-white">Password changed</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          You can sign in with your new password. Anyone who was signed in to this
          account elsewhere has been signed out.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Sign in
        </a>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-white">Choose a new password</h1>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="pw" className="block text-sm font-medium text-slate-300">
            New password
          </label>
          <input
            id="pw"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <ul className="space-y-1">
          {RULES.map((r) => {
            const ok = r.ok(password)
            return (
              <li
                key={r.label}
                className={`flex items-center gap-2 text-xs ${ok ? 'text-emerald-400' : 'text-slate-500'}`}
              >
                <span aria-hidden>{ok ? '✓' : '•'}</span>
                {r.label}
              </li>
            )
          })}
        </ul>

        <div>
          <label htmlFor="pw2" className="block text-sm font-medium text-slate-300">
            Confirm password
          </label>
          <input
            id="pw2"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
          {mismatch && (
            <p className="mt-1.5 text-xs text-amber-400">
              These do not match.
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </Shell>
  )
}
