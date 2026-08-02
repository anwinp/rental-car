import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, FormEvent } from 'react'
import { RouteGuard, useAuth } from '@rcm/ui/auth'
import { QueryProvider } from '@rcm/ui/query'
import { AuthProvider } from '@rcm/ui/auth'
import { UserRole } from '@rcm/shared-types'
import { apiClient } from '@rcm/api-client'
import { resolveTenant } from './tenant'
import { OfflineBanner } from './components/OfflineBanner'
import { CheckoutPage } from './pages/CheckoutPage'
import { CheckInPage } from './pages/CheckInPage'
import { ShiftPage } from './pages/ShiftPage'
import { OverduePage } from './pages/OverduePage'
import { useCounterStore, selectOfflineQueueCount } from './store/counterStore'
import { Unbuilt, SHOW_UNBUILT } from './unbuilt'


const COUNTER_ROLES = [
  UserRole.COUNTER_AGENT,
  UserRole.BRANCH_MANAGER,
  UserRole.REGIONAL_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
]

function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Held when the password was accepted but the account has a second factor.
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: apiError } = await (apiClient as any).POST('/auth/login', {
        body: { email, password, app_context: 'web-counter' },
      })
      if (apiError || !data) {
        // Password accepted, second factor still owed: no session is issued
        // until the code is verified.
        const challenge = (apiError as any)?.challenge_id
        if (challenge) {
          setMfaChallenge(challenge)
          setMfaCode('')
          return
        }
        setError(typeof apiError === 'string' ? apiError : 'Invalid email or password')
        return
      }
      setUser(data)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: apiError } = await (apiClient as any).POST('/auth/mfa/challenge', {
        body: { challenge_id: mfaChallenge, code: mfaCode.trim() },
      })
      if (apiError || !data) {
        setError('That code was not accepted. Try again.')
        setMfaCode('')
        return
      }
      setMfaChallenge(null)
      setUser(data)
      navigate('/', { replace: true })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  // ── Design tokens (Ferrari spec) ──────────────────────────────────
  const C = {
    canvas:         '#181818',
    canvasElevated: '#303030',
    primary:        '#da291c',
    ink:            '#ffffff',
    body:           '#969696',
    muted:          '#666666',
    hairline:       '#303030',
    warning:        '#f13a2c',
  }

  // text-input-on-dark — h48, pad 14×16, canvas bg, 1px hairline, radius 4px
  const input: React.CSSProperties = {
    display: 'block', width: '100%', height: 48,
    padding: '0 16px', boxSizing: 'border-box',
    fontSize: 14, fontWeight: 400, lineHeight: '48px',
    color: C.ink, background: C.canvas,
    border: `1px solid ${C.hairline}`, borderRadius: 4,
    outline: 'none', letterSpacing: 0,
  }

  // caption-uppercase — 11px / 600 / 1.1px / uppercase
  const capUp: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, lineHeight: 1.4,
    letterSpacing: '1.1px', textTransform: 'uppercase',
    color: C.muted, margin: 0,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.canvas }}>

      {/* ── LEFT — Cinematic panel ──────────────────────────────────── */}
      <div style={{
        flex: '0 0 58%',
        position: 'relative',
        // "dark grey gradient" from spec: atmospheric depth, no photo needed
        background: 'linear-gradient(160deg, #3c3c3c 0%, #1e1e1e 50%, #030303 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 64px',
        overflow: 'hidden',
      }}>

        {/* Rosso Corsa top stripe — scarcest possible brand voltage */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: C.primary }} />

        {/* Logo mark — top left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, background: C.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
              <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
            </svg>
          </div>
          <span style={{
            fontSize: 13, fontWeight: 600,
            letterSpacing: '1.4px', textTransform: 'uppercase',
            color: C.ink,
          }}>RCM</span>
        </div>

        {/* Editorial copy — floats at bottom like headline over a cinema hero */}
        <div>
          {/* Hairline above copy — editorial separator */}
          <div style={{ height: 1, background: C.hairline, marginBottom: 32 }} />

          <p style={{ ...capUp, marginBottom: 24, color: C.muted }}>Counter Operations</p>

          {/* display-xl — 56px / 500 / -1.12px — the editorial headline */}
          <h1 style={{
            margin: '0 0 24px',
            fontSize: 56, fontWeight: 500, lineHeight: 1.1,
            letterSpacing: '-1.12px', color: C.ink,
          }}>
            Counter<br />Station
          </h1>

          {/* body-md descriptor */}
          <p style={{
            margin: 0,
            fontSize: 14, fontWeight: 400, lineHeight: 1.5,
            color: C.body, maxWidth: 340,
          }}>
            Fleet management built for rental car counter operations — checkout, check-in,
            and shift management in one unified surface.
          </p>
        </div>
      </div>

      {/* ── RIGHT — Login form panel ────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '64px 56px',
        borderLeft: `1px solid ${C.hairline}`,
      }}>
        <div style={{ maxWidth: 360, width: '100%' }}>

          {/* Section label */}
          <p style={{ ...capUp, marginBottom: 16 }}>Staff Access</p>
          <div style={{ height: 1, background: C.hairline, marginBottom: 32 }} />

          {/* display-md headline — 26px / 500 / 0.195px */}
          <h2 style={{
            margin: '0 0 8px',
            fontSize: 26, fontWeight: 500, lineHeight: 1.5,
            letterSpacing: '0.195px', color: C.ink,
          }}>
            Welcome back
          </h2>

          {/* body-md subtitle */}
          <p style={{
            margin: '0 0 48px',
            fontSize: 14, fontWeight: 400, lineHeight: 1.5,
            color: C.body,
          }}>
            Enter your credentials to access counter operations.
          </p>

          {/* Second factor. Shown instead of the credential form once the
              password is accepted; there is no session yet, so the only way
              back is to start over. */}
          {mfaChallenge && (
            <form onSubmit={handleMfaSubmit}>
              <div style={{ marginBottom: 24 }}>
                <label style={{ ...capUp, display: 'block', marginBottom: 8 }}>
                  Verification code
                </label>
                <input
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  style={{
                    width: '100%', padding: '14px 16px', fontSize: 15,
                    fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2em',
                    background: C.canvasElevated, color: C.ink,
                    border: `1px solid ${C.hairline}`, borderRadius: 4,
                  }}
                />
                <p style={{ marginTop: 8, fontSize: 13, color: C.body }}>
                  From your authenticator app, or one of your backup codes.
                </p>
              </div>

              {error && (
                <p style={{ marginBottom: 16, fontSize: 14, color: C.warning }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || mfaCode.trim().length < 6}
                style={{
                  width: '100%', padding: '14px 16px', fontSize: 15, fontWeight: 600,
                  background: C.primary, color: C.ink, border: 'none', borderRadius: 4,
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? 'Verifying…' : 'Verify and sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setMfaChallenge(null); setMfaCode(''); setError('') }}
                style={{
                  width: '100%', marginTop: 12, padding: 8, fontSize: 14,
                  background: 'none', color: C.body, border: 'none', cursor: 'pointer',
                }}
              >
                Start over
              </button>
            </form>
          )}

          <form onSubmit={handleSubmit} style={{ display: mfaChallenge ? 'none' : undefined }}>

            {/* Email */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ ...capUp, display: 'block', marginBottom: 8 }}>Email</label>
              <input
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={input}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 32 }}>
              <label style={{ ...capUp, display: 'block', marginBottom: 8 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ ...input, paddingRight: 60 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontSize: 11, fontWeight: 600, letterSpacing: '1.1px',
                    textTransform: 'uppercase', color: C.muted, lineHeight: 1,
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Validation error */}
            {error && (
              <p style={{
                margin: '0 0 24px',
                fontSize: 13, fontWeight: 400, lineHeight: 1.5,
                color: C.warning,
              }}>
                {error}
              </p>
            )}

            {/* button-primary — Rosso Corsa / 0px radius / uppercase / 1.4px tracking */}
            <button
              type="submit"
              disabled={loading}
              style={{
                display: 'block', width: '100%', height: 48,
                padding: '0 32px', borderRadius: 0, border: 'none',
                fontSize: 14, fontWeight: 700, lineHeight: 1,
                letterSpacing: '1.4px', textTransform: 'uppercase',
                background: loading ? C.canvasElevated : C.primary,
                color: C.ink,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Signing In…' : 'Sign In'}
            </button>

          </form>

          {/* Footer caption */}
          <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${C.hairline}` }}>
            <p style={{
              margin: 0, textAlign: 'center',
              fontSize: 12, fontWeight: 400, lineHeight: 1.4,
              color: C.muted,
            }}>
              Rental Car Manager · Counter Operations
            </p>
          </div>

        </div>
      </div>

    </div>
  )
}

// ── Shared Ferrari tokens for inner pages ──────────────────────────
const T = {
  canvas:         '#181818',
  canvasElevated: '#303030',
  primary:        '#da291c',
  ink:            '#ffffff',
  body:           '#969696',
  muted:          '#666666',
  hairline:       '#303030',
}

function Dashboard() {
  const tiles = [
    { label: 'Checkout',  href: '/checkout', icon: '→' },
    { label: 'Check-In',  href: '/check-in',  icon: '←' },
    { label: 'Overdue',   href: '/overdue',   icon: '!' },
    { label: 'Shift',     href: '/shift',     icon: '≡' },
  ]
  return (
    <div style={{ maxWidth: 1280 }}>
      {/* Section label */}
      <p style={{
        margin: '0 0 16px', fontSize: 11, fontWeight: 600,
        letterSpacing: '1.1px', textTransform: 'uppercase', color: T.muted,
      }}>
        Counter Operations
      </p>
      <div style={{ height: 1, background: T.hairline, marginBottom: 32 }} />

      {/* display-md headline */}
      <h1 style={{
        margin: '0 0 8px', fontSize: 26, fontWeight: 500,
        lineHeight: 1.5, letterSpacing: '0.195px', color: T.ink,
      }}>
        Counter Dashboard
      </h1>
      <p style={{ margin: '0 0 48px', fontSize: 14, fontWeight: 400, lineHeight: 1.5, color: T.body }}>
        Select an action to begin.
      </p>

      {/* 4-up action grid — feature-card style, sharp 0px corners */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: T.hairline }}>
        {tiles.map(({ label, href, icon }) => (
          <a
            key={label}
            href={href}
            style={{
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              padding: '32px 24px', minHeight: 160,
              background: T.canvasElevated, textDecoration: 'none',
              borderRadius: 0,
            }}
          >
            <span style={{ fontSize: 24, color: T.muted, lineHeight: 1 }}>{icon}</span>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: T.ink, lineHeight: 1.2 }}>
              {label}
            </p>
          </a>
        ))}
      </div>
    </div>
  )
}

function NavBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const offlineQueueCount = useCounterStore(selectOfflineQueueCount)

  // Overdue and Shift render placeholder data rather than the tenant's own —
  // Overdue resolves a MOCK_OVERDUE constant and Shift is a setTimeout with no
  // network call at all. They stay out of the nav unless the demo flag is set.
  // See src/unbuilt.tsx.
  const navItems = [
    { to: '/', label: 'Dashboard', exact: true },
    { to: '/checkout', label: 'Checkout' },
    { to: '/check-in', label: 'Check-In' },
    ...(SHOW_UNBUILT
      ? [
          { to: '/overdue', label: 'Overdue' },
          { to: '/shift', label: 'Shift' },
        ]
      : []),
  ]

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const initials = user
    ? `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : '?'

  return (
    <nav
      aria-label="Counter navigation"
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        height: 64, padding: '0 32px',
        background: T.canvas, borderBottom: `1px solid ${T.hairline}`,
        overflowX: 'auto', flexShrink: 0,
      }}
    >
      {/* Logo mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 40, flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, background: T.primary, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
            <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
          </svg>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '1.4px', textTransform: 'uppercase', color: T.ink }}>
          RCM
        </span>
      </div>

      {/* Hairline divider */}
      <div style={{ width: 1, height: 24, background: T.hairline, marginRight: 32, flexShrink: 0 }} />

      {/* Nav links — nav-link spec: 13px / 600 / 0.65px / uppercase */}
      {navItems.map(({ to, label, exact }) => (
        <NavLink
          key={to}
          to={to}
          end={exact}
          style={({ isActive }: { isActive: boolean }) => ({
            display: 'inline-flex', alignItems: 'center', height: 64,
            padding: '0 16px', textDecoration: 'none', whiteSpace: 'nowrap',
            fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase',
            color: isActive ? T.ink : T.body,
            borderBottom: isActive ? `2px solid ${T.primary}` : '2px solid transparent',
            boxSizing: 'border-box',
          })}
        >
          {label}
        </NavLink>
      ))}

      {/* Right side — pushed to end */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>

        {/* Offline queue badge */}
        {offlineQueueCount > 0 && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', background: T.canvasElevated,
              fontSize: 11, fontWeight: 600, letterSpacing: '1.1px',
              textTransform: 'uppercase', color: '#f59e0b',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
            {offlineQueueCount} pending
          </div>
        )}

        {/* Hairline divider */}
        <div style={{ width: 1, height: 24, background: T.hairline }} />

        {/* User initials + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: T.canvasElevated, border: `1px solid ${T.hairline}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', color: T.ink,
            flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: T.ink, whiteSpace: 'nowrap' }}>
              {user?.first_name} {user?.last_name}
            </p>
            <p style={{
              margin: 0, fontSize: 11, fontWeight: 400,
              color: T.muted, textTransform: 'capitalize', whiteSpace: 'nowrap',
            }}>
              {user?.role?.replace(/_/g, ' ').toLowerCase() ?? 'counter agent'}
            </p>
          </div>
        </div>

        {/* Hairline divider */}
        <div style={{ width: 1, height: 24, background: T.hairline }} />

        {/* Logout — button-tertiary-text spec: uppercase, tracked, no fill */}
        <button
          onClick={handleLogout}
          style={{
            background: 'none', border: 'none', padding: '0 4px',
            fontSize: 11, fontWeight: 600, letterSpacing: '1.1px',
            textTransform: 'uppercase', color: T.muted,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Sign Out
        </button>
      </div>
    </nav>
  )
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: T.canvas }}>
      <OfflineBanner />
      <NavBar />
      <main id="main-content" style={{ flex: 1, overflowY: 'auto', padding: '48px 64px' }}>
        {children}
      </main>
    </div>
  )
}

/**
 * Re-establishes the workspace before anything that needs it renders.
 *
 * The resolved tenant lives in memory, so a hard load starts with none —
 * without this the session check goes out untenanted, 401s, and bounces a
 * signed-in agent back to the login screen on every refresh.
 */
function TenantBoot({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    resolveTenant().finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [])
  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>
        Loading your workspace…
      </div>
    )
  }
  return <>{children}</>
}


export default function App() {
  return (
    <TenantBoot>
    <QueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RouteGuard roles={COUNTER_ROLES} redirectTo="/login">
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/checkout" element={<CheckoutPage />} />
                      <Route path="/check-in" element={<CheckInPage />} />
                      <Route path="/shift" element={<Unbuilt><ShiftPage /></Unbuilt>} />
                      <Route path="/overdue" element={<Unbuilt><OverduePage /></Unbuilt>} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </AppLayout>
                </RouteGuard>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryProvider>
    </TenantBoot>
  )
}
