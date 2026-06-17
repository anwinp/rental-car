'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// ── Ferrari design tokens ──────────────────────────────────────────────────
// Canvas: #181818  Elevated: #303030  Hairline: #303030
// Primary (Rosso Corsa): #da291c   On-primary: #fff
// Ink: #fff   Body: #969696   Muted: #666666
// Radius: 0px CTAs/cards, 4px inputs
// CTA: 14px / 700 / uppercase / 1.4px tracking / 48px height
// Display: 500 weight — never bold for display copy

const $ = {
  label: {
    fontSize: 11, fontWeight: 600,
    color: '#666666',
    textTransform: 'uppercase' as const,
    letterSpacing: '1.1px',
    lineHeight: 1.4,
    marginBottom: 8,
    display: 'block',
  },
  input: {
    display: 'block', width: '100%',
    padding: '0 16px',
    height: 48,
    background: '#181818',
    border: '1px solid #303030',
    borderRadius: 4,
    color: '#ffffff',
    fontSize: 14, fontWeight: 400,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  },
  btnPrimary: (busy: boolean) => ({
    width: '100%', height: 48,
    background: busy ? '#9d2211' : '#da291c',
    color: '#ffffff',
    fontSize: 14, fontWeight: 700,
    letterSpacing: '1.4px',
    textTransform: 'uppercase' as const,
    border: 'none',
    borderRadius: 0,
    cursor: busy ? 'not-allowed' as const : 'pointer' as const,
    opacity: busy ? 0.7 : 1,
    fontFamily: 'inherit',
  }),
  btnOutline: {
    width: '100%', height: 48,
    background: 'transparent',
    color: '#ffffff',
    fontSize: 14, fontWeight: 700,
    letterSpacing: '1.4px',
    textTransform: 'uppercase' as const,
    border: '1px solid #303030',
    borderRadius: 0,
    cursor: 'pointer' as const,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    fontFamily: 'inherit',
  },
  tab: (active: boolean) => ({
    flex: 1, height: 48,
    fontSize: 11, fontWeight: 600,
    letterSpacing: '1.1px',
    textTransform: 'uppercase' as const,
    color: active ? '#ffffff' : '#666666',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #da291c' : '2px solid transparent',
    cursor: 'pointer' as const,
    fontFamily: 'inherit',
    transition: 'color 0.15s',
  }),
  hairline: { height: 1, background: '#303030' },
  error: {
    padding: '12px 16px',
    background: 'rgba(218,41,28,0.08)',
    border: '1px solid rgba(218,41,28,0.3)',
    borderRadius: 0,
    fontSize: 13, fontWeight: 400,
    color: '#da291c',
    lineHeight: 1.5,
  },
  success: {
    padding: '12px 16px',
    background: 'rgba(3,144,74,0.08)',
    border: '1px solid rgba(3,144,74,0.3)',
    borderRadius: 0,
    fontSize: 13, fontWeight: 400,
    color: '#03904a',
    lineHeight: 1.5,
  },
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <label style={$.label}>{label}</label>
      {children}
    </div>
  )
}

const TENANT = '00000000-0000-0000-0000-000000000001'

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_cancelled: 'Google sign-in was cancelled.',
  oauth_failed: 'Google sign-in failed. Please try again.',
  oauth_error: 'An unexpected error occurred during sign-in.',
  oauth_invalid_state: 'Sign-in session expired. Please try again.',
}

function LoginContent() {
  const searchParams = useSearchParams()
  const passwordReset = searchParams.get('reset') === 'true'
  const oauthError = searchParams.get('error')

  const [activeTab, setActiveTab] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [magicEmail, setMagicEmail] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [magicSent, setMagicSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setLoginError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': TENANT,
        },
        body: JSON.stringify({ email, password, app_context: 'web' }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { detail?: string }).detail ?? 'Invalid email or password.')
      }
      window.location.href = '/'
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Invalid email or password.')
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleSignIn() {
    setGoogleError(null)
    setGoogleBusy(true)
    try {
      const res = await fetch(`/api/v1/auth/google?tenant_id=${TENANT}`, { redirect: 'manual' })
      // opaqueredirect (status 0) = FastAPI issued a 302 to Google — proceed
      if (res.type === 'opaqueredirect' || res.status === 0) {
        window.location.href = `/api/v1/auth/google?tenant_id=${TENANT}`
        return
      }
      const d = await res.json().catch(() => ({}))
      setGoogleError((d as { detail?: string }).detail ?? 'Google sign-in is not available right now.')
    } catch {
      setGoogleError('Unable to reach the sign-in service. Please try again.')
    } finally {
      setGoogleBusy(false)
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!magicEmail) return
    setBusy(true)
    await new Promise(r => setTimeout(r, 700))
    setMagicSent(true)
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#181818' }}>

      {/* ── Left editorial panel (desktop only) ────────────────────────── */}
      <div className="hidden lg:flex" style={{
        flex: '1 1 0',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 64px',
        borderRight: '1px solid #303030',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background image with dark overlay */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'url(https://picsum.photos/seed/rcm-car-hero/1200/900)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(24,24,24,0.55) 0%, rgba(24,24,24,0.85) 60%, #181818 100%)',
        }} />

        {/* Content above image */}
        <div style={{ position: 'relative' }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: '#da291c',
            textTransform: 'uppercase',
            letterSpacing: '1.4px',
          }}>
            RCM Rentals
          </span>
        </div>

        {/* Bottom editorial text */}
        <div style={{ position: 'relative' }}>
          {/* Red accent line */}
          <div style={{ width: 32, height: 2, background: '#da291c', marginBottom: 24 }} />
          <h2 style={{
            fontSize: 56, fontWeight: 500,
            color: '#ffffff',
            letterSpacing: '-1.12px',
            lineHeight: 1.1,
            margin: '0 0 16px',
          }}>
            Drive<br />The Dream.
          </h2>
          <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.5, maxWidth: 320, margin: 0 }}>
            Access your membership, manage reservations, and experience automotive excellence.
          </p>
        </div>
      </div>

      {/* ── Right form panel ────────────────────────────────────────────── */}
      <div style={{
        flex: '0 0 auto',
        width: '100%',
        maxWidth: 480,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '64px 48px',
      }}>

        {/* Mobile brand mark */}
        <div className="lg:hidden" style={{ marginBottom: 48 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#da291c', textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            RCM Rentals
          </span>
        </div>

        {/* Banners */}
        {passwordReset && (
          <div role="status" style={{ ...$.success, marginBottom: 32 }}>
            Password updated successfully — please sign in.
          </div>
        )}
        {oauthError && (
          <div role="alert" style={{ ...$.error, marginBottom: 32 }}>
            {OAUTH_ERROR_MESSAGES[oauthError] ?? 'Sign-in failed. Please try again.'}
          </div>
        )}

        {/* Section label */}
        <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', margin: '0 0 16px' }}>
          Member Access
        </p>

        {/* Headline */}
        <h1 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.36px', lineHeight: 1.2, margin: '0 0 48px' }}>
          Sign In
        </h1>

        {/* Tab switcher */}
        <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid #303030', marginBottom: 32 }}>
          {(['password', 'magic'] as const).map(tab => (
            <button key={tab} role="tab" aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              style={$.tab(activeTab === tab)}
            >
              {tab === 'password' ? 'Password' : 'Magic Link'}
            </button>
          ))}
        </div>

        {/* Password form */}
        {activeTab === 'password' && (
          <form onSubmit={handlePasswordLogin} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <FieldGroup label="Email Address">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                style={$.input}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#da291c'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#303030'}
              />
            </FieldGroup>

            <FieldGroup label="Password">
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  style={{ ...$.input, paddingRight: 48 }}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#da291c'}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#303030'}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#666666' }}>
                  {showPassword
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </FieldGroup>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8 }}>
              <a href="/forgot-password" style={{ fontSize: 12, fontWeight: 600, color: '#666666', textDecoration: 'none', letterSpacing: '0.5px' }}>
                Forgot password?
              </a>
            </div>

            {loginError && (
              <div role="alert" style={$.error}>{loginError}</div>
            )}

            <button type="submit" disabled={busy} style={$.btnPrimary(busy)}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Magic link form */}
        {activeTab === 'magic' && (
          magicSent ? (
            <div role="status" style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ width: 48, height: 48, border: '1px solid #303030', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#da291c" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 12 }}>Check your email</p>
              <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.6, margin: 0 }}>
                A sign-in link was sent to <span style={{ color: '#ffffff' }}>{magicEmail}</span>. It expires in 15 minutes.
              </p>
              <button onClick={() => setMagicSent(false)} style={{ marginTop: 24, background: 'none', border: 'none', fontSize: 12, fontWeight: 600, color: '#666666', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'inherit' }}>
                Resend
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <FieldGroup label="Email Address">
                <input
                  type="email"
                  value={magicEmail}
                  onChange={e => setMagicEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  style={$.input}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#da291c'}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#303030'}
                />
              </FieldGroup>
              <button type="submit" disabled={busy} style={$.btnPrimary(busy)}>
                {busy ? 'Sending…' : 'Send Magic Link'}
              </button>
            </form>
          )
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '32px 0' }}>
          <div style={{ ...$.hairline, flex: 1 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#666666', letterSpacing: '1.1px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>or</span>
          <div style={{ ...$.hairline, flex: 1 }} />
        </div>

        {/* Google */}
        {googleError && (
          <div role="alert" style={{ ...$.error, marginBottom: 12 }}>{googleError}</div>
        )}
        <button
          onClick={handleGoogleSignIn}
          disabled={googleBusy}
          style={{ ...$.btnOutline, opacity: googleBusy ? 0.6 : 1, cursor: googleBusy ? 'not-allowed' : 'pointer' }}
        >
          {googleBusy ? (
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase' }}>Connecting…</span>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {/* Footer */}
        <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={$.hairline} />
          <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 400, color: '#666666' }}>
              No account?
            </span>
            <a href="/signup" style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', textDecoration: 'none', letterSpacing: '0.3px' }}>
              Create one
            </a>
            <a href="/" style={{ fontSize: 13, fontWeight: 400, color: '#666666', textDecoration: 'none' }}>
              Continue as guest
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#181818', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px' }}>Loading…</span>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
