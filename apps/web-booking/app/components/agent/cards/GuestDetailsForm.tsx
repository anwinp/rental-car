'use client'

import { useState } from 'react'

interface Props {
  data: Record<string, unknown>
  onAction?: (action: string) => void
}

const inputStyle = {
  width: '100%',
  background: 'var(--agent-input-bg)',
  border: '1px solid var(--agent-input-border)',
  borderRadius: 6,
  padding: '9px 11px',
  color: 'var(--p-text-1)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box' as const,
}

const labelStyle = {
  fontSize: 11,
  color: 'var(--p-text-3)',
  marginBottom: 4,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  display: 'block',
}

export function GuestDetailsForm({ data, onAction }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const errorMsg = String(data.error || '')
  const className = String(data.vehicle_class_name || '')
  const total = Number(data.total || 0)

  const validate = () => {
    const e: Record<string, string> = {}
    if (!firstName.trim()) e.firstName = 'Required'
    if (!lastName.trim()) e.lastName = 'Required'
    if (!email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) e.email = 'Valid email required'
    return e
  }

  const handleSubmit = () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    const parts = [
      `first_name=${firstName.trim()}`,
      `last_name=${lastName.trim()}`,
      `email=${email.trim()}`,
      ...(phone.trim() ? [`phone=${phone.trim()}`] : []),
    ]
    onAction?.(`Book: ${parts.join(' || ')}`)
  }

  const field = (
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    required = true,
    type = 'text',
  ) => (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}{required ? ' *' : ''}</label>
      <input
        type={type}
        style={{
          ...inputStyle,
          borderColor: errors[id] ? 'rgba(240,78,78,0.50)' : 'var(--agent-input-border)',
        }}
        value={value}
        onChange={e => { setter(e.target.value); setErrors(prev => { const n = { ...prev }; delete n[id]; return n }) }}
        placeholder={label}
      />
      {errors[id] && <div style={{ fontSize: 11, color: 'var(--p-danger)', marginTop: 3 }}>{errors[id]}</div>}
    </div>
  )

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--agent-chip-border)',
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--p-text-1)', marginBottom: 4 }}>
        Your Details
      </div>
      {className && (
        <div style={{ fontSize: 11, color: 'var(--p-text-3)', marginBottom: 12 }}>
          {className} · {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} total
        </div>
      )}

      {errorMsg && (
        <div style={{
          padding: '7px 10px', borderRadius: 6, marginBottom: 12,
          background: 'rgba(240,78,78,0.08)', border: '1px solid rgba(240,78,78,0.20)',
          fontSize: 12, color: 'var(--p-danger)',
        }}>
          {errorMsg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
        <div>{field('firstName', 'First Name', firstName, setFirstName)}</div>
        <div>{field('lastName', 'Last Name', lastName, setLastName)}</div>
      </div>
      {field('email', 'Email Address', email, setEmail, true, 'email')}
      {field('phone', 'Phone (optional)', phone, setPhone, false, 'tel')}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={handleSubmit}
          style={{
            flex: 2, padding: '10px 0', borderRadius: 6,
            border: 'none', background: 'var(--p-brand)',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Complete Booking
        </button>
        <button
          onClick={() => onAction?.('Choose a different car')}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 6,
            border: '1px solid var(--agent-chip-border)',
            background: 'var(--agent-chip-bg)',
            color: 'var(--p-text-2)', fontSize: 13, cursor: 'pointer',
          }}
        >
          Back
        </button>
      </div>
    </div>
  )
}
