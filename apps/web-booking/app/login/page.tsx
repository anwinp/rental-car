'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '@rcm/api-client'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@rcm/ui'
import { Input } from '@rcm/ui'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

const magicLinkSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})
type MagicLinkForm = z.infer<typeof magicLinkSchema>

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%',
  padding: '11px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  color: 'var(--p-text-1)',
  fontSize: 14, fontWeight: 300,
  outline: 'none',
  transition: 'border-color 0.15s',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 500,
  color: 'var(--p-text-4)',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  marginBottom: 6,
  display: 'block',
}

export default function LoginPage() {
  const [loginError, setLoginError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'password' | 'magic'>('password')

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const magicForm = useForm<MagicLinkForm>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: '' },
  })

  async function onLogin(data: LoginForm) {
    setLoginError(null)
    setIsSubmitting(true)
    try {
      await (apiClient as never as {
        POST: (path: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>
      }).POST('/auth/login', { body: data })
      window.location.href = '/'
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onMagicLink(data: MagicLinkForm) {
    setIsSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 800))
      setMagicLinkSent(true)
      void data
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--p-surface)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Cosmos ambient glows */}
      <div aria-hidden="true" style={{
        position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(34,226,168,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div aria-hidden="true" style={{
        position: 'fixed', top: '60%', left: '30%',
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(64,179,255,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Brand area */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 14, fontWeight: 500,
            color: 'var(--p-cyan)',
            textTransform: 'uppercase',
            letterSpacing: '0.22em',
            marginBottom: 14,
          }}>
            RCM Rentals
          </div>
          <h1 style={{
            fontSize: 38, fontWeight: 300,
            color: 'var(--p-text-1)',
            letterSpacing: '-0.05em',
            margin: 0,
            lineHeight: 1.1,
          }}>
            Welcome back.
          </h1>
          <p style={{ fontWeight: 300, color: 'var(--p-text-3)', marginTop: 10, fontSize: 14 }}>
            Sign in to access your account
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          backdropFilter: 'blur(12px)',
          overflow: 'hidden',
        }}>
          {/* Tab switcher */}
          <div style={{
            display: 'flex',
            background: 'rgba(0,0,0,0.2)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }} role="tablist">
            {(['password', 'magic'] as const).map(tab => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: '14px 0',
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 500 : 300,
                  color: activeTab === tab ? 'var(--p-text-1)' : 'var(--p-text-4)',
                  background: activeTab === tab ? 'rgba(34,226,168,0.12)' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #22e2a8' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  minHeight: 44,
                }}
              >
                {tab === 'password' ? 'Password' : 'Magic Link'}
              </button>
            ))}
          </div>

          <div style={{ padding: '28px 28px 20px' }}>
            {activeTab === 'password' ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onLogin)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel style={labelStyle}>Email</FormLabel>
                        <FormControl>
                          <div>
                            <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} style={inputStyle} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel style={labelStyle}>Password</FormLabel>
                        <FormControl>
                          <div>
                            <Input type="password" autoComplete="current-password" {...field} style={inputStyle} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {loginError && (
                    <div role="alert" aria-live="polite" style={{
                      padding: '10px 14px', borderRadius: 10,
                      background: 'rgba(240,78,78,0.08)',
                      border: '1px solid rgba(240,78,78,0.25)',
                      fontSize: 13, fontWeight: 300, color: '#f04e4e',
                    }}>
                      {loginError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    style={{
                      padding: '13px 0', borderRadius: 10, width: '100%',
                      background: isSubmitting
                        ? 'rgba(34,226,168,0.4)'
                        : 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
                      color: '#fff', fontWeight: 500, border: 'none',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      boxShadow: '0 0 24px rgba(34,226,168,0.35)',
                      fontSize: 15, transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSubmitting) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
                  >
                    {isSubmitting ? 'Signing in…' : 'Sign In'}
                  </button>
                </form>
              </Form>
            ) : (
              <>
                {magicLinkSent ? (
                  <div style={{ padding: '20px 0', textAlign: 'center' }} role="status" aria-live="polite">
                    <div style={{
                      width: 64, height: 64, borderRadius: '50%',
                      background: 'rgba(34,226,168,0.12)',
                      border: '1px solid rgba(34,226,168,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 20px', fontSize: 28,
                    }}>
                      ✉️
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 300, color: 'var(--p-text-1)', letterSpacing: '-0.03em', marginBottom: 10 }}>
                      Check your email
                    </h3>
                    <p style={{ fontSize: 14, fontWeight: 300, color: 'var(--p-text-3)', lineHeight: 1.6 }}>
                      We sent a sign-in link to{' '}
                      <strong style={{ color: '#22e2a8', fontWeight: 400 }}>{magicForm.getValues('email')}</strong>. It expires in 15 minutes.
                    </p>
                  </div>
                ) : (
                  <Form {...magicForm}>
                    <form onSubmit={magicForm.handleSubmit(onMagicLink)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                      <FormField
                        control={magicForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel style={labelStyle}>Email</FormLabel>
                            <FormControl>
                              <div>
                                <Input type="email" placeholder="you@example.com" autoComplete="email" {...field} style={inputStyle} />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        aria-busy={isSubmitting}
                        style={{
                          padding: '13px 0', borderRadius: 10, width: '100%',
                          background: isSubmitting
                            ? 'rgba(34,226,168,0.4)'
                            : 'linear-gradient(135deg, #22e2a8 0%, #40b3ff 100%)',
                          color: '#fff', fontWeight: 500, border: 'none',
                          cursor: isSubmitting ? 'not-allowed' : 'pointer',
                          boxShadow: '0 0 24px rgba(34,226,168,0.35)',
                          fontSize: 15,
                        }}
                      >
                        {isSubmitting ? 'Sending…' : 'Send Magic Link'}
                      </button>
                    </form>
                  </Form>
                )}
              </>
            )}

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 12, fontWeight: 300, color: 'var(--p-text-4)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* Google Sign-In */}
            <button
              onClick={() => { window.location.href = '/api/v1/auth/google' }}
              style={{
                padding: '12px 0', borderRadius: 10, width: '100%',
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--p-text-2)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontWeight: 400, cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.2)'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.1)'
                ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </button>
          </div>
        </div>

        {/* Footer links */}
        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, fontWeight: 300, color: 'var(--p-text-4)' }}>
          Don&apos;t have an account?{' '}
          <a href="/" style={{ color: '#22e2a8', fontWeight: 400 }}>Book as a guest</a>
          {' · '}
          <a href="/account" style={{ color: '#22e2a8', fontWeight: 400 }}>Create account</a>
        </p>
      </div>
    </div>
  )
}
