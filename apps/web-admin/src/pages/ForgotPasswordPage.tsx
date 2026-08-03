import { useState, type FormEvent } from 'react'
import { describeApiError } from '../apiError'

/**
 * Password recovery for staff.
 *
 * The back office had no route to this at all. The API's reset endpoints
 * existed, but the only pages that called them were in the customer booking
 * app — so an operator who forgot their password had no way back into the
 * product they actually work in. For a single-admin workspace that is not an
 * inconvenience, it is permanent loss of the business's operating system.
 *
 * No tenant is sent. The API derives it from the host: on a workspace address
 * this scopes to that workspace, and anywhere else it covers every workspace
 * the address can sign in to. That is deliberate — see the service docstring.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/v1/auth/request-password-reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      // Only a real success may claim the mail was sent. The booking app's
      // version set "check your email" in a finally block, so it said so even
      // when the request had 422'd — which is how a completely broken reset
      // flow went unnoticed.
      if (res.ok) {
        setSent(true)
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

  if (sent) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-white">Check your email</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          If <strong className="text-slate-200">{email.trim()}</strong> can sign in
          here, a reset link is on its way. It expires in one hour and can be used
          once.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          If this address works for more than one workspace, the email lists each
          one so you can pick.
        </p>
        <a
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-indigo-400 hover:text-indigo-300"
        >
          ← Back to sign in
        </a>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-white">Reset your password</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        Enter the address you sign in with and we&rsquo;ll send you a link to choose
        a new password.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-300">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="mt-1.5 w-full rounded-md border border-slate-700 bg-slate-900/60 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {error && (
          <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <a
        href="/login"
        className="mt-6 inline-block text-sm text-slate-400 hover:text-slate-200"
      >
        ← Back to sign in
      </a>
    </Shell>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
