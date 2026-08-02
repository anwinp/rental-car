import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'

import PlatformTenantsPage from '../pages/PlatformTenantsPage'
import { PlatformTenantDetailPage } from '../pages/PlatformTenantDetailPage'
import PlatformPlansPage from '../pages/PlatformPlansPage'
import { CeezLogo } from './CeezLogo'

/**
 * The console at rcm-admin.ceez.ai.
 *
 * A separate application from the tenant back office, deliberately, because it
 * has a separate identity behind it. The operator of this platform is not an
 * employee of any workspace: no tenant is resolved here, no X-Tenant-ID is
 * sent, and none of the tenant providers (AuthProvider, AdminLayout,
 * RouteGuard) are mounted — every one of them assumes a workspace exists.
 *
 * That assumption is why this host previously served a sign-in form nobody
 * could use. The form posted to /auth/login, which resolves a tenant before it
 * looks at a password and refuses when there is none. A platform hostname
 * carries no workspace slug, so the answer was always the same 401.
 */

interface Profile {
  admin_id: string
  email: string
  full_name: string
  is_mfa_enabled: boolean
  last_login_at: string | null
}

const API = '/api/v1/platform/auth'

async function problem(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return String(body.detail ?? body.title ?? fallback)
  } catch {
    return fallback
  }
}

// ── Sign in ──────────────────────────────────────────────────────────────────

function PlatformLogin({ onSignedIn }: { onSignedIn: (p: Profile) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) onSignedIn((await res.json()) as Profile)
      else setError(await problem(res, 'Incorrect email or password.'))
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6"
         style={{ background: 'var(--page-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <CeezLogo size={30} />
          <h1 className="mt-5 text-2xl font-semibold" style={{ color: 'var(--text-1)' }}>
            Platform console
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-3)' }}>
            Operator access. This is not a workspace sign-in — staff should use
            their own workspace address.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="pf-email" className="block text-xs font-medium"
                   style={{ color: 'var(--text-2)' }}>Email</label>
            <input
              id="pf-email" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--card-bg)', color: 'var(--text-1)',
                       border: '1px solid var(--border)' }}
            />
          </div>
          <div>
            <label htmlFor="pf-password" className="block text-xs font-medium"
                   style={{ color: 'var(--text-2)' }}>Password</label>
            <input
              id="pf-password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--card-bg)', color: 'var(--text-1)',
                       border: '1px solid var(--border)' }}
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--accent, #da291c)', color: '#fff' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Shell ────────────────────────────────────────────────────────────────────

function PlatformChrome({ me, onSignedOut, children }: {
  me: Profile
  onSignedOut: () => void
  children: React.ReactNode
}) {
  const { pathname } = useLocation()

  async function signOut() {
    await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' })
    onSignedOut()
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--page-bg)' }}>
      <header className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-8 py-4">
          <Link to="/" aria-label="CEEZ AI platform console">
            <CeezLogo size={24} />
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/platform" style={{ color: 'var(--text-2)' }} className="hover:underline">
              Workspaces
            </Link>
            <Link to="/platform/plans" style={{ color: 'var(--text-2)' }} className="hover:underline">
              Plans
            </Link>
            {/* Named plainly: an operator should be able to tell at a glance
                which identity is acting, because everything done here is done
                to somebody else's data. */}
            <span style={{ color: 'var(--text-3)' }}>{me.email}</span>
            {!me.is_mfa_enabled && (
              <span className="text-amber-400" title="This account can suspend or delete any workspace.">
                MFA off
              </span>
            )}
            <button onClick={() => void signOut()} style={{ color: 'var(--text-2)' }}
                    className="hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main key={pathname}>{children}</main>
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function PlatformApp() {
  const [me, setMe] = useState<Profile | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/me`, { credentials: 'include' })
      .then(async (res) => (res.ok ? ((await res.json()) as Profile) : null))
      .catch(() => null)
      .then((p) => { if (!cancelled) { setMe(p); setReady(true) } })
    return () => { cancelled = true }
  }, [])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center"
           style={{ background: 'var(--page-bg)' }}>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading…</p>
      </div>
    )
  }

  if (!me) return <PlatformLogin onSignedIn={setMe} />

  return (
    <BrowserRouter>
      <PlatformChrome me={me} onSignedOut={() => setMe(null)}>
        <Routes>
          <Route path="/" element={<Navigate to="/platform" replace />} />
          <Route path="/login" element={<Navigate to="/platform" replace />} />
          <Route path="/platform" element={<PlatformTenantsPage />} />
          <Route path="/platform/plans" element={<PlatformPlansPage />} />
          {/* After /platform/plans: ":tenantId" would swallow it. */}
          <Route path="/platform/:tenantId" element={<PlatformTenantDetailPage />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Routes>
      </PlatformChrome>
    </BrowserRouter>
  )
}
