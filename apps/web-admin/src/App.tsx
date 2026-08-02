import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useState, useEffect, type FormEvent } from 'react'
import { QueryProvider } from '@rcm/ui/query'

import {
  cachedTenant, currentSlug, fetchTenantConfig, rememberSlug, setCachedTenant,
  slugFromHostname, tenantHeaders, resolveTenant,
} from './tenant'

// The tenant is resolved at runtime (hostname, ?workspace=, or the last one
// signed into) rather than compiled in, so one build serves every workspace.
const _TENANT = () => cachedTenant()?.tenant_id ?? ''
const _TENANT_HEADERS = () => tenantHeaders()
import { AuthProvider, RouteGuard, useAuth } from '@rcm/ui/auth'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { PlatformTenantDetailPage } from './pages/PlatformTenantDetailPage'
import SignupPage from './pages/SignupPage'
import OnboardingPage from './pages/OnboardingPage'
import VerifyPage from './pages/VerifyPage'
import PlatformTenantsPage from './pages/PlatformTenantsPage'
import TeamPage from './pages/TeamPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import { Toaster } from '@rcm/ui'
import { UserRole } from '@rcm/shared-types'
import { apiClient } from '@rcm/api-client'
import { AdminLayout } from './components/Layout'
import { FleetPage } from './pages/FleetPage'
import { ReservationsPage } from './pages/ReservationsPage'
import { CustomersPage } from './pages/CustomersPage'
import { PricingPage } from './pages/PricingPage'
import { ReportsPage } from './pages/ReportsPage'
import { LocationsPage } from './pages/LocationsPage'
import { FleetCalendarPage } from './pages/FleetCalendarPage'
import { ManagerDashboardPage } from './pages/ManagerDashboardPage'
import { StaffDashboardPage } from './pages/StaffDashboardPage'
import { BackOfficeDashboardPage } from './pages/BackOfficeDashboardPage'
import { TaskBoardPage } from './pages/TaskBoardPage'
import StaffDailyTaskListPage from './pages/StaffDailyTaskListPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReturnProcessingPage } from './pages/ReturnProcessingPage'
import { CounterCheckoutPage } from './pages/CounterCheckoutPage'
import { InspectionsPage } from './pages/InspectionsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { DamagePage } from './pages/DamagePage'
import { ShiftPage } from './pages/ShiftPage'
import { OverduePage } from './pages/OverduePage'
import { MaintenancePage } from './pages/MaintenancePage'
import { CorporatePage } from './pages/CorporatePage'
import { ExecutiveDashboardPage } from './pages/ExecutiveDashboardPage'
import { RegionalDashboardPage } from './pages/RegionalDashboardPage'
import OTALeadsPage from './pages/OTALeadsPage'
import { Unbuilt } from './unbuilt'

const ADMIN_ROLES = [
  UserRole.COUNTER_AGENT,
  UserRole.BRANCH_MANAGER,
  UserRole.REGIONAL_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.CLAIMS_COORDINATOR,
  UserRole.FINANCE_ANALYST,
  UserRole.READONLY_AUDITOR,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.MAINTENANCE_TECH,
  UserRole.EXECUTIVE,
  UserRole.SENIOR_AGENT,
]


function EyeIcon({ off }: { off?: boolean }) {
  return off ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const slugFromHost = slugFromHostname()
  const [workspace, setWorkspace] = useState(currentSlug() ?? '')
  const [workspaceError, setWorkspaceError] = useState('')

  // Set when the password was accepted but the account has a second factor.
  // Holds no authority on its own — it is exchanged for a session at
  // /auth/mfa/challenge along with a code.
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email')
  const [phone, setPhone] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpError, setOtpError] = useState('')

  async function handleSendOTP() {
    setOtpError('')
    const res = await fetch('/api/v1/auth/otp/send', {
      method: 'POST', credentials: 'include', headers: _TENANT_HEADERS(),
      body: JSON.stringify({ phone_number: phone, tenant_id: _TENANT() }),
    })
    if (res.ok) {
      setOtpSent(true)
    } else {
      const d = await res.json().catch(() => ({}))
      setOtpError((d as any).detail || 'Failed to send code')
    }
  }

  async function handleVerifyOTP() {
    setOtpError('')
    const res = await fetch('/api/v1/auth/otp/verify', {
      method: 'POST', credentials: 'include', headers: _TENANT_HEADERS(),
      body: JSON.stringify({ phone_number: phone, code: otpCode, tenant_id: _TENANT() }),
    })
    if (res.ok) {
      const data = await res.json()
      setUser(data)
      switch (data.role) {
        case 'EXECUTIVE':          navigate('/executive', { replace: true }); break
        case 'REGIONAL_MANAGER':   navigate('/regional', { replace: true }); break
        case 'COUNTER_AGENT':      navigate('/checkout', { replace: true }); break
        case 'SENIOR_AGENT':       navigate('/staff', { replace: true }); break
        case 'FLEET_MANAGER':      navigate('/back-office', { replace: true }); break
        case 'MAINTENANCE_TECH':   navigate('/maintenance', { replace: true }); break
        case 'FINANCE_ANALYST':    navigate('/reports', { replace: true }); break
        case 'CLAIMS_COORDINATOR': navigate('/damage', { replace: true }); break
        default:                   navigate('/dashboard', { replace: true }); break
      }
    } else {
      const d = await res.json().catch(() => ({}))
      setOtpError((d as any).detail || 'Invalid code')
    }
  }

  /**
   * On a generic host we do not authenticate at all — we send the browser to
   * the workspace's own address first.
   *
   * The session cookie is host-only (no Domain attribute), so a cookie set on
   * localhost is never sent to acme.localtest.me. Signing in here and then
   * redirecting would land the user on their workspace URL with no session,
   * i.e. instantly logged out. Moving first means the cookie is set on the
   * host that will use it, and the address bar shows the workspace from then on.
   */
  async function handleWorkspaceContinue(e: FormEvent) {
    e.preventDefault()
    setWorkspaceError('')
    setLoading(true)
    try {
      const slug = workspace.trim().toLowerCase()
      if (!slug) {
        setWorkspaceError('Enter your workspace address.')
        return
      }
      const config = await fetchTenantConfig(slug)
      if (!config) {
        setWorkspaceError(`No workspace found at "${slug}".`)
        return
      }
      rememberSlug(config.slug)
      // admin_url is built server-side from the configured public host, so it
      // is correct in both local development and production.
      const target = config.admin_url ?? `${window.location.protocol}//${slug}.${window.location.host}`
      window.location.href = `${target.replace(/\/$/, '')}/login`
    } catch {
      setWorkspaceError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setWorkspaceError('')
    setLoading(true)
    try {
      // Resolve the workspace first: without a tenant the API cannot tell which
      // organisation this email belongs to, and the same address may exist in
      // several of them.
      //
      // This compared the resolved tenant's slug against the raw hostname
      // LABEL, which are not the same string on a deployed host: the label
      // carries the platform suffix ("acme-rcm-admin") and the slug does not
      // ("acme"). They therefore never matched, so every sign-in refetched with
      // the full label, took a 404, and returned with "No workspace found"
      // before the login request was ever sent.
      //
      // The server already resolves the tenant from the Host header at boot, so
      // an existing resolution is authoritative. Only ask again when there is
      // none — which is the local-development case, where the host carries no
      // tenant label and the operator types the workspace in.
      let tenant = cachedTenant() ?? (await resolveTenant())
      if (!tenant) {
        const typed = workspace.trim().toLowerCase()
        if (!typed) {
          setWorkspaceError('Enter your workspace address.')
          return
        }
        tenant = await fetchTenantConfig(typed)
        if (!tenant) {
          setWorkspaceError(`No workspace found at "${typed}".`)
          return
        }
      }
      setCachedTenant(tenant)
      rememberSlug(tenant.slug)
      const { data, error: apiError } = await (apiClient as any).POST('/auth/login', {
        body: { email, password, app_context: 'web-admin' },
      })
      if (apiError || !data) {
        // The password was right but the account needs a second factor. The
        // API withholds the session and returns a challenge id instead.
        const challenge = (apiError as any)?.challenge_id
        if (challenge) {
          setMfaChallenge(challenge)
          setMfaCode('')
          return
        }
        setError(messageFrom(apiError, 'Invalid email or password'))
        return
      }
      goToLanding(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  /** Exchange the challenge plus a code for a real session. */
  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: apiError } = await (apiClient as any).POST('/auth/mfa/challenge', {
        body: { challenge_id: mfaChallenge, code: mfaCode.trim() },
      })
      if (apiError || !data) {
        setError(
          messageFrom(apiError, 'That code was not accepted. Check your authenticator and try again.'),
        )
        setMfaCode('')
        return
      }
      setMfaChallenge(null)
      goToLanding(data)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  /** Where a signed-in user lands, by role. Shared by both sign-in paths. */
  function goToLanding(data: any) {
    setUser(data)
    switch (data.role) {
      case 'EXECUTIVE':          navigate('/executive', { replace: true }); break
      case 'REGIONAL_MANAGER':   navigate('/regional', { replace: true }); break
      case 'COUNTER_AGENT':      navigate('/checkout', { replace: true }); break
      case 'SENIOR_AGENT':       navigate('/staff', { replace: true }); break
      case 'FLEET_MANAGER':      navigate('/back-office', { replace: true }); break
      case 'MAINTENANCE_TECH':   navigate('/maintenance', { replace: true }); break
      case 'FINANCE_ANALYST':    navigate('/reports', { replace: true }); break
      case 'CLAIMS_COORDINATOR': navigate('/damage', { replace: true }); break
      default:                   navigate('/dashboard', { replace: true }); break
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div
        className="hidden lg:flex w-5/12 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(160deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
              <circle cx="7" cy="17" r="2"/>
              <circle cx="17" cy="17" r="2"/>
            </svg>
          </div>
          <span className="text-lg font-bold text-white tracking-tight">RCM</span>
        </div>

        {/* Main copy */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-white leading-tight">
              Fleet management built for modern operations
            </h1>
            <p className="mt-4 text-base text-indigo-200 leading-relaxed">
              Manage your entire rental fleet from a single command center — real-time visibility, automated billing, and multi-location operations.
            </p>
          </div>

          <ul className="space-y-3">
            {[
              'Real-time fleet visibility across all locations',
              'Automated billing, payments & invoicing',
              'Multi-location operations & reporting',
            ].map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-indigo-100">
                <svg className="mt-0.5 shrink-0 text-indigo-400" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p className="text-xs text-indigo-400">
          © {new Date().getFullYear()} RCM · Enterprise Fleet Management
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12" style={{ background: 'var(--page-bg)' }}>
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--accent)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
                <circle cx="7" cy="17" r="2"/>
                <circle cx="17" cy="17" r="2"/>
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>RCM Admin</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Welcome back</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>Sign in to your administrator account</p>
          </div>

          {/* Login method toggle */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
            {(['email', 'phone'] as const).map(m => (
              <button key={m} type="button" onClick={() => { setLoginMethod(m); setOtpSent(false); setOtpError('') }}
                style={{ flex: 1, height: 36, fontSize: 12, fontWeight: 600, borderRadius: 0,
                  background: loginMethod === m ? 'var(--text-1)' : 'var(--card-bg)',
                  color: loginMethod === m ? 'var(--canvas)' : 'var(--text-2)',
                  border: '1px solid var(--border)', cursor: 'pointer' }}>
                {m === 'email' ? 'Email & Password' : 'Phone (OTP)'}
              </button>
            ))}
          </div>

          {loginMethod === 'phone' && (
            <div className="space-y-3">
              {!otpSent ? (
                <>
                  <input type="tel" placeholder="+1 XXX XXX XXXX" value={phone} onChange={e => setPhone(e.target.value)}
                    style={{ width: '100%', height: 44, padding: '0 12px', fontSize: 14, background: 'var(--card-bg)',
                      color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 4, boxSizing: 'border-box' }} />
                  <button type="button" onClick={handleSendOTP} style={{ width: '100%', height: 48, fontWeight: 700, fontSize: 14,
                    background: '#da291c', color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer',
                    textTransform: 'uppercase', letterSpacing: '1.4px' }}>
                    Send Code
                  </button>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>Code sent to {phone}</p>
                  <input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={otpCode} onChange={e => setOtpCode(e.target.value)}
                    style={{ width: '100%', height: 44, padding: '0 12px', fontSize: 24, textAlign: 'center', letterSpacing: '8px',
                      background: 'var(--card-bg)', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 4, boxSizing: 'border-box' }} />
                  <button type="button" onClick={handleVerifyOTP} style={{ width: '100%', height: 48, fontWeight: 700, fontSize: 14,
                    background: '#da291c', color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer',
                    textTransform: 'uppercase', letterSpacing: '1.4px', marginTop: 12 }}>
                    Verify Code
                  </button>
                  <button type="button" onClick={() => setOtpSent(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', marginTop: 8, display: 'block' }}>
                    Use different number
                  </button>
                </>
              )}
              {otpError && <p style={{ color: '#da291c', fontSize: 12, marginTop: 8 }}>{otpError}</p>}
            </div>
          )}

          {/* Generic host: choose the workspace, then continue on its own
              address. Credentials are only ever entered on the workspace host,
              where the session cookie belongs. */}
          {!slugFromHost && (
            <form onSubmit={handleWorkspaceContinue} className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="workspace" className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                  Workspace
                </label>
                <div className="flex items-stretch overflow-hidden rounded-lg" style={{ border: '1px solid var(--border)' }}>
                  <input
                    id="workspace"
                    autoFocus
                    required
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value.trim().toLowerCase())}
                    className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none"
                    placeholder="your-company"
                    style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-1)' }}
                  />
                </div>
                {workspaceError && (
                  <p style={{ color: '#da291c', fontSize: 12 }}>{workspaceError}</p>
                )}
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  You&apos;ll sign in at your workspace&apos;s own address.
                </p>
              </div>
              <button
                type="submit"
                disabled={loading || !workspace}
                className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {loading ? 'Finding your workspace…' : 'Continue'}
              </button>
            </form>
          )}

          {/* Second factor. Replaces the credential form once the password has
              been accepted — the session does not exist until a code is
              verified, so there is nothing to go back to except starting over. */}
          {mfaChallenge && (
            <form onSubmit={handleMfaSubmit} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
                  Two-step verification
                </h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
                  Enter the 6-digit code from your authenticator app. You can also
                  use one of your backup codes.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="mfa-code" className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                  Verification code
                </label>
                <input
                  id="mfa-code"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="123456"
                  className="w-full rounded-lg border px-3.5 py-2.5 font-mono tracking-widest"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
                />
              </div>

              <button
                type="submit"
                disabled={loading || mfaCode.trim().length < 6}
                className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {loading ? 'Verifying…' : 'Verify and sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setMfaChallenge(null); setMfaCode(''); setError('') }}
                className="w-full text-sm"
                style={{ color: 'var(--text-2)' }}
              >
                Start over
              </button>
            </form>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
            style={{ display: (mfaChallenge || loginMethod === 'phone' || !slugFromHost) ? 'none' : undefined }}
          >
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field-input w-full px-3.5 py-2.5 text-sm"
                placeholder="admin@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input w-full px-3.5 py-2.5 pr-10 text-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg px-3.5 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                <svg className="mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div>
                  <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
                  {/* A locked-out or wrong-password user's instinct is to keep
                      retrying, which burns the remaining attempts and then
                      waits out a 15-minute lock. Offer the way out at the
                      moment it becomes relevant, not buried below the form. */}
                  {/(password|locked|credential)/i.test(error) && (
                    <a
                      href="/forgot-password"
                      className="mt-1.5 inline-block text-sm font-medium underline underline-offset-2"
                      style={{ color: 'var(--danger)' }}
                    >
                      Reset your password
                    </a>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="text-center">
              <a
                href="/forgot-password"
                className="text-[13px]"
                style={{ color: 'var(--text-3)' }}
              >
                Forgot your password?
              </a>
            </div>
          </form>

          {/* Two different audiences end up on this screen: staff of an
              existing workspace, and someone starting a new company. The
              second had no route forward from here at all. */}
          <div className="mt-8 border-t pt-6 text-center" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              Don&apos;t have a workspace?{' '}
              <button
                type="button"
                onClick={() => navigate('/signup')}
                className="font-semibold underline underline-offset-4"
                style={{ color: 'var(--accent)' }}
              >
                Create one
              </button>
            </p>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-3)' }}>
              Staff of an existing workspace: contact your system administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}


function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center" style={{ background: 'var(--page-bg)' }}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full mb-4" style={{ background: 'var(--danger-bg)' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--danger)' }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </div>
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Access Denied</h1>
      <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
        Your account doesn't have permission to view this page. Contact your administrator if this is incorrect.
      </p>
      <a href="/login" className="mt-6 text-sm font-medium underline underline-offset-4" style={{ color: 'var(--accent)' }}>
        Sign in with a different account
      </a>
    </div>
  )
}

/**
 * Re-establishes the workspace before anything that needs it renders.
 *
 * The resolved tenant lives in memory, so a hard page load (or refresh) starts
 * with none. Without this gate the session check goes out with no tenant,
 * gets a 401, and bounces a signed-in user to the login screen on every
 * refresh. Blocking for one lookup is the difference between a working app and
 * one that appears to log you out at random.
 */
function TenantBoot({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    resolveTenant().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'var(--page-bg)' }}>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading your workspace…</p>
      </div>
    )
  }
  return <>{children}</>
}


/**
 * The message the API actually sent, in preference to a guess.
 *
 * Sign-in previously reported every failure as "Invalid email or password", or
 * fell through to a raw "error: 401". Both are wrong when the real cause is
 * something the operator can act on — an unactivated workspace returns
 * "Confirm your email address to activate this workspace.", and showing a
 * status code instead left people retrying a password that was never wrong.
 *
 * Responses are RFC 7807 problem+json, so `detail` is the human-facing field.
 */
function messageFrom(apiError: unknown, fallback: string): string {
  if (typeof apiError === 'string' && apiError.trim()) return apiError
  const e = apiError as { detail?: unknown; title?: unknown; message?: unknown } | null
  if (e && typeof e.detail === 'string' && e.detail.trim()) return e.detail
  if (Array.isArray(e?.detail)) {
    const first = (e!.detail as Array<{ msg?: unknown }>)[0]
    if (first?.msg) return String(first.msg)
  }
  if (e && typeof e.title === 'string' && e.title.trim()) return e.title
  if (e && typeof e.message === 'string' && e.message.trim()) return e.message
  return fallback
}

export default function App() {
  const EXEC_ROLES   = [UserRole.EXECUTIVE, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]
  const MANAGE_ROLES = [UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.CLAIMS_COORDINATOR, UserRole.READONLY_AUDITOR]
  const FLEET_ROLES  = [...MANAGE_ROLES, UserRole.FLEET_MANAGER, UserRole.MAINTENANCE_TECH]
  const STAFF_ROLES  = [...FLEET_ROLES, UserRole.COUNTER_AGENT, UserRole.SENIOR_AGENT]
  const RETURN_ROLES = [UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.SENIOR_AGENT]
  const REPORT_ROLES = [...MANAGE_ROLES, UserRole.EXECUTIVE, UserRole.FINANCE_ANALYST]
  const REGIONAL_ROLES = [UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]

  return (
    <TenantBoot>
    <QueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:rounded-lg" style={{ background: 'var(--card-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }}>
            Skip to content
          </a>

          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Public: no workspace exists yet, so this sits outside the guard */}
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Public: the invitee has no account until they accept. */}
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

            <Route
              path="/*"
              element={
                <RouteGuard roles={ADMIN_ROLES} redirectTo="/login">
                  <AdminLayout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/onboarding" element={<OnboardingPage />} />
                      {/* Access is enforced server-side by the platform-admin
                          flag; the page renders "not found" for everyone else. */}
                      <Route path="/platform" element={<PlatformTenantsPage />} />
                      <Route path="/platform/:tenantId" element={<PlatformTenantDetailPage />} />
                      <Route path="/team" element={<TeamPage />} />
                      <Route path="/dashboard" element={
                        <RouteGuard roles={MANAGE_ROLES} redirectTo="/unauthorized">
                          <ManagerDashboardPage />
                        </RouteGuard>
                      } />
                      <Route path="/staff" element={
                        <RouteGuard roles={STAFF_ROLES} redirectTo="/unauthorized">
                          <StaffDashboardPage />
                        </RouteGuard>
                      } />
                      <Route path="/back-office" element={
                        <RouteGuard roles={FLEET_ROLES} redirectTo="/unauthorized">
                          <BackOfficeDashboardPage />
                        </RouteGuard>
                      } />
                      <Route path="/tasks" element={
                        <RouteGuard roles={STAFF_ROLES} redirectTo="/unauthorized">
                          <StaffDailyTaskListPage />
                        </RouteGuard>
                      } />
                      <Route path="/task-board" element={
                        <RouteGuard roles={MANAGE_ROLES} redirectTo="/unauthorized">
                          <TaskBoardPage />
                        </RouteGuard>
                      } />
                      <Route path="/fleet" element={
                        <RouteGuard roles={FLEET_ROLES} redirectTo="/unauthorized">
                          <FleetPage />
                        </RouteGuard>
                      } />
                      <Route path="/fleet-calendar" element={
                        <RouteGuard roles={FLEET_ROLES} redirectTo="/unauthorized">
                          <FleetCalendarPage />
                        </RouteGuard>
                      } />
                      <Route path="/locations" element={
                        <RouteGuard roles={[...FLEET_ROLES, UserRole.EXECUTIVE]} redirectTo="/unauthorized">
                          <LocationsPage />
                        </RouteGuard>
                      } />
                      <Route path="/reservations" element={
                        <RouteGuard roles={MANAGE_ROLES} redirectTo="/unauthorized">
                          <ReservationsPage />
                        </RouteGuard>
                      } />
                      <Route path="/customers" element={
                        <RouteGuard roles={MANAGE_ROLES} redirectTo="/unauthorized">
                          <CustomersPage />
                        </RouteGuard>
                      } />
                      <Route path="/checkout" element={
                        <RouteGuard roles={STAFF_ROLES} redirectTo="/unauthorized">
                          <CounterCheckoutPage />
                        </RouteGuard>
                      } />
                      <Route path="/returns" element={
                        <RouteGuard roles={RETURN_ROLES} redirectTo="/unauthorized">
                          <ReturnProcessingPage />
                        </RouteGuard>
                      } />
                      <Route path="/inspections" element={
                        <RouteGuard roles={RETURN_ROLES} redirectTo="/unauthorized">
                          <InspectionsPage />
                        </RouteGuard>
                      } />
                      <Route path="/payments" element={
                        <RouteGuard roles={MANAGE_ROLES} redirectTo="/unauthorized">
                          <PaymentsPage />
                        </RouteGuard>
                      } />
                      <Route path="/damage" element={
                        <RouteGuard roles={RETURN_ROLES} redirectTo="/unauthorized">
                          <DamagePage />
                        </RouteGuard>
                      } />
                      <Route path="/shift" element={
                        <RouteGuard roles={STAFF_ROLES} redirectTo="/unauthorized">
                          <ShiftPage />
                        </RouteGuard>
                      } />
                      <Route path="/overdue" element={
                        <RouteGuard roles={STAFF_ROLES} redirectTo="/unauthorized">
                          <OverduePage />
                        </RouteGuard>
                      } />
                      <Route path="/maintenance" element={
                        <RouteGuard roles={FLEET_ROLES} redirectTo="/unauthorized">
                          <MaintenancePage />
                        </RouteGuard>
                      } />
                      <Route path="/corporate" element={
                        <RouteGuard roles={[...MANAGE_ROLES, UserRole.EXECUTIVE]} redirectTo="/unauthorized">
                          <Unbuilt><CorporatePage /></Unbuilt>
                        </RouteGuard>
                      } />
                      <Route path="/executive" element={
                        <RouteGuard roles={EXEC_ROLES} redirectTo="/unauthorized">
                          <ExecutiveDashboardPage />
                        </RouteGuard>
                      } />
                      <Route path="/regional" element={
                        <RouteGuard roles={REGIONAL_ROLES} redirectTo="/unauthorized">
                          <RegionalDashboardPage />
                        </RouteGuard>
                      } />
                      <Route path="/ota-leads" element={
                        <RouteGuard roles={REGIONAL_ROLES} redirectTo="/unauthorized">
                          <OTALeadsPage />
                        </RouteGuard>
                      } />
                      <Route
                        path="/pricing"
                        element={
                          /* Setting prices is a manager's job, not only an
                             administrator's — in a small business the branch
                             manager IS the person who decides the day rate. */
                          <RouteGuard
                            roles={[
                              UserRole.BRANCH_MANAGER,
                              UserRole.REGIONAL_MANAGER,
                              /* NB: the DB user_role enum also has FINANCE,
                                 which this TS enum does not declare — a drift
                                 worth reconciling, but not silently here. */
                              UserRole.FINANCE_ANALYST,
                              UserRole.SYSTEM_ADMIN,
                              UserRole.SUPER_ADMIN,
                            ]}
                            redirectTo="/unauthorized"
                          >
                            <PricingPage />
                          </RouteGuard>
                        }
                      />
                      <Route path="/reports" element={
                        <RouteGuard roles={REPORT_ROLES} redirectTo="/unauthorized">
                          <Unbuilt><ReportsPage /></Unbuilt>
                        </RouteGuard>
                      } />
                      <Route
                        path="/settings"
                        element={
                          <RouteGuard roles={[UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]} redirectTo="/unauthorized">
                            <SettingsPage />
                          </RouteGuard>
                        }
                      />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </AdminLayout>
                </RouteGuard>
              }
            />
          </Routes>

          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </QueryProvider>
    </TenantBoot>
  )
}
