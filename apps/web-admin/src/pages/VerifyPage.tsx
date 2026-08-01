import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberSlug } from '../tenant'

/**
 * Consumes the confirmation link from the sign-up email.
 *
 * Public route — the workspace is not yet active, so nobody can be signed in
 * when they arrive here. On success the workspace slug is remembered so the
 * login form is already filled in.
 */

type State =
  | { kind: 'working' }
  | { kind: 'ok'; message: string; slug: string | null }
  | { kind: 'failed'; message: string }

export default function VerifyPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'working' })
  const [resendEmail, setResendEmail] = useState('')
  const [resendNote, setResendNote] = useState('')
  const [resending, setResending] = useState(false)

  // Tokens are single-use, so this must fire exactly once per mount. React's
  // StrictMode double-invokes effects in development, which consumed the token
  // twice and made a first-time visitor see the "already confirmed" wording.
  // (The server is idempotent regardless — which matters in production too,
  // where email security scanners routinely prefetch links before the
  // recipient clicks them.)
  const consumed = useRef(false)

  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setState({ kind: 'failed', message: 'This confirmation link is incomplete.' })
      return
    }
    ;(async () => {
      try {
        const res = await fetch('/api/v1/public/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json()
        if (res.ok && data.ok) {
          if (data.slug) rememberSlug(data.slug)
          setState({ kind: 'ok', message: data.message, slug: data.slug ?? null })
        } else {
          const detail = Array.isArray(data?.detail)
            ? data.detail[0]?.msg
            : data?.detail ?? data?.message
          setState({ kind: 'failed', message: String(detail ?? 'This link is not valid.') })
        }
      } catch {
        setState({ kind: 'failed', message: 'Could not reach the server. Try again.' })
      }
    })()
  }, [])

  async function handleResend() {
    setResending(true)
    setResendNote('')
    try {
      const res = await fetch('/api/v1/public/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail.trim() }),
      })
      const data = await res.json()
      setResendNote(data.message ?? 'If that address has a workspace awaiting confirmation, a new link is on its way.')
    } catch {
      setResendNote('Could not reach the server.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8">
        {state.kind === 'working' && (
          <>
            <h1 className="text-xl font-semibold text-white">Confirming your workspace…</h1>
            <p className="mt-2 text-sm text-slate-400">This only takes a moment.</p>
          </>
        )}

        {state.kind === 'ok' && (
          <>
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399"
                   strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">{state.message}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {state.slug ? (
                <>
                  Your workspace{' '}
                  <span className="font-mono text-indigo-300">{state.slug}</span> is active.
                  Sign in to finish setting it up.
                </>
              ) : (
                'Your workspace is active. Sign in to finish setting it up.'
              )}
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="mt-8 w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              Sign in
            </button>
          </>
        )}

        {state.kind === 'failed' && (
          <>
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fbbf24"
                   strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">We couldn&apos;t confirm that link</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{state.message}</p>

            <div className="mt-7 border-t border-slate-800 pt-6">
              <label htmlFor="resend" className="block text-sm font-medium text-slate-300">
                Send a new link
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="resend"
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={handleResend}
                  disabled={!resendEmail.includes('@') || resending}
                  className="flex-none rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:bg-slate-700 disabled:text-slate-500"
                >
                  {resending ? 'Sending…' : 'Resend'}
                </button>
              </div>
              {resendNote && <p className="mt-2 text-xs text-slate-400">{resendNote}</p>}
            </div>

            <button
              onClick={() => navigate('/signup')}
              className="mt-6 text-sm font-medium text-indigo-400 hover:text-indigo-300"
            >
              Or create a new workspace
            </button>
          </>
        )}
      </div>
    </div>
  )
}
