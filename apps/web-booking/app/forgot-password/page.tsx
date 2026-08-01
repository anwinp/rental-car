'use client'

import { tenantId } from '../lib/tenant'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'


const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
})
type ForgotPasswordForm = z.infer<typeof schema>

const inp: React.CSSProperties = {
  display: 'block', width: '100%',
  padding: '0 14px', height: 48,
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

export default function ForgotPasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: ForgotPasswordForm) {
    setIsSubmitting(true)
    try {
      await fetch(`/api/v1/auth/request-password-reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId() },
        body: JSON.stringify({ email: data.email }),
      })
    } finally {
      setIsSubmitting(false)
      setSent(true)
    }
  }

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
            Reset Password
          </h1>
        </div>

        {sent ? (
          <div role="status" aria-live="polite" style={{ padding: '32px 0', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, border: '1px solid #303030', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#da291c" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 12 }}>Check Your Email</p>
            <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.6, margin: 0 }}>
              If an account exists for that address, we sent a reset link. Check your inbox — it may take a few minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 8, display: 'block' }}>
                Email Address
              </label>
              <input type="email" autoComplete="email" placeholder="you@example.com"
                {...register('email')}
                style={inp}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#da291c'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = '#303030'}
              />
              {errors.email && <p style={{ fontSize: 12, color: '#da291c', marginTop: 4 }}>{errors.email.message}</p>}
            </div>

            <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}
              style={{ width: '100%', height: 48, background: isSubmitting ? '#9d2211' : '#da291c', color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', border: 'none', borderRadius: 0, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1, fontFamily: 'inherit' }}>
              {isSubmitting ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        )}

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
