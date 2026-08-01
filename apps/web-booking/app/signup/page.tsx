'use client'

import { tenantId } from '../lib/tenant'

import { useState } from 'react'
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

const signupSchema = z
  .object({
    first_name: z.string().min(1, 'First name is required'),
    last_name: z.string().min(1, 'Last name is required'),
    email: z.string().email('Please enter a valid email address'),
    phone: z.string().optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirm_password: z.string(),
    date_of_birth: z.string().optional(),
    terms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Terms of Use and Privacy Policy' }),
    }),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

type SignupForm = z.infer<typeof signupSchema>

// ── Ferrari design tokens ──────────────────────────────────────────────────
const s = {
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
    padding: '0 14px',
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
    colorScheme: 'dark' as const,
  },
  inputFocus(el: HTMLInputElement | HTMLSelectElement) {
    el.style.borderColor = '#da291c'
  },
  inputBlur(el: HTMLInputElement | HTMLSelectElement) {
    el.style.borderColor = '#303030'
  },
  error: {
    fontSize: 12, fontWeight: 400,
    color: '#da291c',
    marginTop: 4,
    lineHeight: 1.4,
  },
  errBox: {
    padding: '12px 16px',
    background: 'rgba(218,41,28,0.08)',
    border: '1px solid rgba(218,41,28,0.3)',
    borderRadius: 0,
    fontSize: 13, fontWeight: 400,
    color: '#da291c',
    lineHeight: 1.5,
  },
}

function Field({ label, error, children }: { label: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      {children}
      {error && <p style={s.error}>{error}</p>}
    </div>
  )
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

export default function SignupPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      first_name: '', last_name: '', email: '', phone: '',
      password: '', confirm_password: '', date_of_birth: '',
      terms: undefined,
    },
  })

  async function onSubmit(data: SignupForm) {
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await apiPost('/customers', {
        tenant_id: tenantId(),
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        phone: data.phone || undefined,
        date_of_birth: data.date_of_birth || undefined,
        password: data.password,
      })
      setSuccess(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#181818', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '80px 24px 48px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Brand */}
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#da291c', textTransform: 'uppercase', letterSpacing: '1.4px' }}>
            RCM Rentals
          </span>
          <div style={{ width: 32, height: 2, background: '#da291c', margin: '20px 0 24px' }} />
          <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', margin: '0 0 12px' }}>
            New Member
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.36px', lineHeight: 1.2, margin: 0 }}>
            Create Account
          </h1>
        </div>

        {success ? (
          <div role="status" aria-live="polite" style={{ padding: '48px 0', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, border: '1px solid #303030', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#03904a" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '1.1px', marginBottom: 12 }}>Account Created</p>
            <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.6, marginBottom: 32 }}>
              Check your email to verify your address, then sign in to start reserving.
            </p>
            <a href="/login" style={{ display: 'inline-flex', alignItems: 'center', height: 48, padding: '0 32px', background: '#da291c', color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', borderRadius: 0 }}>
              Go to Sign In
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Name row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="First Name" error={errors.first_name?.message}>
                <input type="text" autoComplete="given-name" placeholder="Jane"
                  {...register('first_name')}
                  style={s.input}
                  onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                  onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
                />
              </Field>
              <Field label="Last Name" error={errors.last_name?.message}>
                <input type="text" autoComplete="family-name" placeholder="Smith"
                  {...register('last_name')}
                  style={s.input}
                  onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                  onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
                />
              </Field>
            </div>

            <Field label="Email Address" error={errors.email?.message}>
              <input type="email" autoComplete="email" placeholder="you@example.com"
                {...register('email')}
                style={s.input}
                onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
              />
            </Field>

            <Field label={<>Phone <span style={{ color: '#666666', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></>} error={errors.phone?.message}>
              <input type="tel" autoComplete="tel" placeholder="+1 555 000 0000"
                {...register('phone')}
                style={s.input}
                onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
              />
            </Field>

            <Field label="Password" error={errors.password?.message}>
              <div style={{ position: 'relative' }}>
                <input type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                  {...register('password')}
                  style={{ ...s.input, paddingRight: 48 }}
                  onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                  onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#666666', padding: 4 }}>
                  {showPassword ? <EyeOff /> : <EyeOpen />}
                </button>
              </div>
            </Field>

            <Field label="Confirm Password" error={errors.confirm_password?.message}>
              <div style={{ position: 'relative' }}>
                <input type={showConfirm ? 'text' : 'password'} autoComplete="new-password"
                  {...register('confirm_password')}
                  style={{ ...s.input, paddingRight: 48 }}
                  onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                  onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
                />
                <button type="button" onClick={() => setShowConfirm(v => !v)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#666666', padding: 4 }}>
                  {showConfirm ? <EyeOff /> : <EyeOpen />}
                </button>
              </div>
            </Field>

            <Field label={<>Date of Birth <span style={{ color: '#666666', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></>} error={errors.date_of_birth?.message}>
              <input type="date" autoComplete="bday"
                {...register('date_of_birth')}
                style={s.input}
                onFocus={e => s.inputFocus(e.target as HTMLInputElement)}
                onBlur={e => s.inputBlur(e.target as HTMLInputElement)}
              />
            </Field>

            {/* Terms */}
            <div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                <input type="checkbox" {...register('terms')}
                  style={{ marginTop: 3, width: 16, height: 16, accentColor: '#da291c', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, fontWeight: 400, color: '#969696', lineHeight: 1.5 }}>
                  I agree to the{' '}
                  <a href="/terms" style={{ color: '#da291c', fontWeight: 500 }} target="_blank" rel="noreferrer">Terms of Use</a>
                  {' '}and{' '}
                  <a href="/policies/privacy" style={{ color: '#da291c', fontWeight: 500 }} target="_blank" rel="noreferrer">Privacy Policy</a>
                </span>
              </label>
              {errors.terms && <p style={s.error}>{errors.terms.message}</p>}
            </div>

            {submitError && (
              <div role="alert" aria-live="polite" style={s.errBox}>{submitError}</div>
            )}

            <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}
              style={{ width: '100%', height: 48, background: isSubmitting ? '#9d2211' : '#da291c', color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', border: 'none', borderRadius: 0, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1, fontFamily: 'inherit', marginTop: 8 }}>
              {isSubmitting ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        {/* Footer */}
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 1, background: '#303030' }} />
          <div style={{ display: 'flex', gap: 24, paddingTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 400, color: '#666666' }}>Already a member?</span>
            <a href="/login" style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', textDecoration: 'none' }}>Sign in</a>
          </div>
        </div>

      </div>
    </div>
  )
}
