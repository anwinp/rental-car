'use client'

import { tenantId } from '../lib/tenant'

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'


async function apiPost(path: string, body: unknown) {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error((d as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

const schema = z
  .object({
    new_password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

type ResetPasswordForm = z.infer<typeof schema>

const inp: React.CSSProperties = {
  display: 'block', width: '100%',
  padding: '0 14px', height: 48, paddingRight: 48,
  background: '#181818',
  border: '1px solid #303030',
  borderRadius: 4,
  color: '#ffffff',
  fontSize: 14, fontWeight: 400,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
  fontFamily: 'inherit',
}

const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 600,
  color: '#666666',
  textTransform: 'uppercase',
  letterSpacing: '1.1px',
  marginBottom: 8,
  display: 'block',
}

const EyeOpen = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const EyeOff = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

function ResetForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<ResetPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: '', confirm_password: '' },
  })

  async function onSubmit(data: ResetPasswordForm) {
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await apiPost('/auth/reset-password', { token, new_password: data.new_password })
      router.push('/login?reset=true')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!token) {
    return (
      <div role="alert" style={{ textAlign: 'center', padding: '32px 0' }}>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.6, marginBottom: 20 }}>
          This reset link is invalid or has expired.
        </p>
        <a href="/forgot-password" style={{ fontSize: 13, fontWeight: 600, color: '#da291c', textDecoration: 'none' }}>
          Request a new reset link
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* New password */}
      <div>
        <label style={lbl}>New Password</label>
        <div style={{ position: 'relative' }}>
          <input type={showPw ? 'text' : 'password'} autoComplete="new-password"
            {...register('new_password')}
            style={inp}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#da291c'}
            onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#303030'}
          />
          <button type="button" onClick={() => setShowPw(v => !v)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#666666', padding: 4 }}>
            {showPw ? <EyeOff /> : <EyeOpen />}
          </button>
        </div>
        {errors.new_password && <p style={{ fontSize: 12, color: '#da291c', marginTop: 4 }}>{errors.new_password.message}</p>}
      </div>

      {/* Confirm password */}
      <div>
        <label style={lbl}>Confirm Password</label>
        <div style={{ position: 'relative' }}>
          <input type={showConfirm ? 'text' : 'password'} autoComplete="new-password"
            {...register('confirm_password')}
            style={inp}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#da291c'}
            onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#303030'}
          />
          <button type="button" onClick={() => setShowConfirm(v => !v)}
            aria-label={showConfirm ? 'Hide password' : 'Show password'}
            style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#666666', padding: 4 }}>
            {showConfirm ? <EyeOff /> : <EyeOpen />}
          </button>
        </div>
        {errors.confirm_password && <p style={{ fontSize: 12, color: '#da291c', marginTop: 4 }}>{errors.confirm_password.message}</p>}
      </div>

      {submitError && (
        <div role="alert" aria-live="polite" style={{ padding: '12px 16px', background: 'rgba(218,41,28,0.08)', border: '1px solid rgba(218,41,28,0.3)', borderRadius: 0, fontSize: 13, color: '#da291c', lineHeight: 1.5 }}>
          {submitError}{' '}
          <a href="/forgot-password" style={{ color: '#da291c', fontWeight: 600, textDecoration: 'underline', fontSize: 12 }}>
            Request a new link
          </a>
        </div>
      )}

      <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}
        style={{ width: '100%', height: 48, background: isSubmitting ? '#9d2211' : '#da291c', color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', border: 'none', borderRadius: 0, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1, fontFamily: 'inherit', marginTop: 8 }}>
        {isSubmitting ? 'Updating password…' : 'Set New Password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#181818', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Brand */}
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#da291c', textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            RCM Rentals
          </span>
          <div style={{ width: 32, height: 2, background: '#da291c', margin: '20px 0 24px' }} />
          <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', margin: '0 0 12px' }}>
            Account Recovery
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.36px', lineHeight: 1.2, margin: 0 }}>
            New Password
          </h1>
        </div>

        <Suspense fallback={
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px' }}>Loading…</span>
          </div>
        }>
          <ResetForm />
        </Suspense>

        {/* Footer */}
        <div style={{ marginTop: 40 }}>
          <div style={{ height: 1, background: '#303030', marginBottom: 16 }} />
          <a href="/login" style={{ fontSize: 13, fontWeight: 600, color: '#969696', textDecoration: 'none' }}>
            Back to Sign In
          </a>
        </div>

      </div>
    </div>
  )
}
