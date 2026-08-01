import { tenantId } from '../tenant'
import { useState, useEffect } from 'react'
import { useAuth } from '@rcm/ui/auth'
import type { ReactNode } from 'react'


function LLMSettingsSection() {
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [keyPreview, setKeyPreview] = useState<string | null>(null)
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch(`/api/v1/tenants/${tenantId()}/llm-settings`, {
      credentials: 'include',
      headers: { 'X-Tenant-ID': tenantId() },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setProvider(d.provider || 'anthropic')
          setKeyConfigured(d.key_configured)
          setKeyPreview(d.key_preview)
        }
      })
      .catch(() => {})
  }, [])

  async function handleSave() {
    if (!apiKey.trim()) { setStatus({ type: 'error', msg: 'Enter an API key before saving.' }); return }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId()}/llm-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenantId() },
        body: JSON.stringify({ provider, api_key: apiKey }),
      })
      if (res.ok) {
        const d = await res.json()
        setKeyConfigured(d.key_configured)
        setKeyPreview(d.key_preview)
        setApiKey('')
        setStatus({ type: 'success', msg: 'API key saved successfully.' })
      } else {
        const err = await res.json().catch(() => ({}))
        setStatus({ type: 'error', msg: (err as { detail?: string }).detail || 'Failed to save key.' })
      }
    } catch {
      setStatus({ type: 'error', msg: 'Network error — please try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/v1/agents/health', {
        credentials: 'include',
        headers: { 'X-Tenant-ID': tenantId() },
      })
      if (res.ok) {
        const d = await res.json()
        const claude = d.claude_api === 'configured'
          ? 'Claude API: configured ✓'
          : 'Claude API: not configured (system key missing)'
        setTestResult({ type: d.status === 'ok' ? 'success' : 'error', msg: `${d.status === 'ok' ? 'Connected' : 'Degraded'} — Redis: ${d.redis}, ${claude}` })
      } else {
        setTestResult({ type: 'error', msg: 'Agent service unreachable.' })
      }
    } catch {
      setTestResult({ type: 'error', msg: 'Connection failed.' })
    } finally {
      setTesting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    display: 'block', width: '100%', height: 36,
    padding: '0 12px', fontSize: 13,
    background: 'var(--elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-1)',
    outline: 'none',
  }

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Provider */}
      <div className="grid grid-cols-3 gap-6 items-start py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
        <div>
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>LLM Provider</p>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>Which AI provider powers the agent chat</p>
        </div>
        <div className="col-span-2">
          <select
            value={provider}
            onChange={e => setProvider(e.target.value)}
            style={{ ...inputStyle, height: 36 }}
          >
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </div>
      </div>

      {/* Current key status */}
      <div className="grid grid-cols-3 gap-6 items-start py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
        <div>
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>Current Key</p>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>Your saved Anthropic API key</p>
        </div>
        <div className="col-span-2">
          {keyConfigured ? (
            <div className="flex items-center gap-3">
              <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                    style={{ background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid rgba(52,211,153,0.25)' }}>
                Configured
              </span>
              <span className="text-[13px] font-mono" style={{ color: 'var(--text-3)' }}>{keyPreview ?? '—'}</span>
            </div>
          ) : (
            <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                  style={{ background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid rgba(251,191,36,0.25)' }}>
              Not configured
            </span>
          )}
        </div>
      </div>

      {/* Key input */}
      <div className="grid grid-cols-3 gap-6 items-start py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
        <div>
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>API Key</p>
          <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Starts with <code className="rounded px-1" style={{ background: 'var(--card-bg)', fontSize: 11 }}>sk-ant-</code>.
            Stored per-tenant, never logged.
          </p>
        </div>
        <div className="col-span-2 space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            style={inputStyle}
            autoComplete="off"
          />
          {status && (
            <p className="text-[12px]" style={{ color: status.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
              {status.msg}
            </p>
          )}
        </div>
      </div>

      {/* Test + Save */}
      <div className="pt-2 flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleTest()}
            disabled={testing}
            className="btn-secondary text-[13px]"
            style={{ opacity: testing ? 0.6 : 1 }}
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          {testResult && (
            <span className="text-[12px]" style={{ color: testResult.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
              {testResult.msg}
            </span>
          )}
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !apiKey.trim()}
          className="btn-primary"
          style={{ opacity: saving || !apiKey.trim() ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : 'Save Key'}
        </button>
      </div>
    </div>
  )
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="panel overflow-hidden">
      <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>{title}</h2>
        {description && <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-6 items-start py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
      <div>
        <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>{label}</p>
        {hint && <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>{hint}</p>}
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  )
}

function SettingsInput({ defaultValue, type = 'text', placeholder }: { defaultValue?: string; type?: string; placeholder?: string }) {
  return <input type={type} defaultValue={defaultValue} placeholder={placeholder} className="input text-[13px]" />
}

function SettingsSelect({ children }: { children: ReactNode }) {
  return (
    <select className="field-input text-[13px] h-9 w-auto px-3" style={{ background: 'var(--elevated)' }}>
      {children}
    </select>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{label}</p>
      <button onClick={onChange}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
        style={{ background: checked ? 'var(--accent)' : 'rgba(100,116,139,0.3)' }}
        role="switch" aria-checked={checked} aria-label={label}>
        <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
              style={{ transform: `translateX(${checked ? '16px' : '2px'})` }} />
      </button>
    </div>
  )
}

export function SettingsPage() {
  const { user } = useAuth()
  const [notifs, setNotifs] = useState({
    email_daily_summary:    true,
    email_damage_alerts:    true,
    email_overdue_returns:  true,
    email_new_reservations: false,
    system_low_fleet:       true,
  })

  function toggleNotif(key: keyof typeof notifs) { setNotifs(prev => ({ ...prev, [key]: !prev[key] })) }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Settings</h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>Manage your organization and account preferences</p>
      </div>

      {/* Organization */}
      <SectionCard title="Organization" description="Your company profile and branding">
        <Field label="Company Name" hint="Displayed in emails and receipts"><SettingsInput defaultValue="Test Rental Co" /></Field>
        <Field label="Primary Email" hint="Used for billing and notifications"><SettingsInput defaultValue="admin@testrentalco.com" type="email" /></Field>
        <Field label="Support Phone" hint="Shown to customers on rental agreements"><SettingsInput defaultValue="+1 (800) 555-0100" type="tel" /></Field>
        <Field label="Default Currency">
          <SettingsSelect>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="CAD">CAD — Canadian Dollar</option>
          </SettingsSelect>
        </Field>
        <Field label="Default Timezone">
          <SettingsSelect>
            <option>America/Chicago</option>
            <option>America/New_York</option>
            <option>America/Los_Angeles</option>
            <option>America/Denver</option>
          </SettingsSelect>
        </Field>
        <div className="pt-4 flex justify-end" style={{ borderTop: '1px solid var(--border-sub)' }}>
          <button className="btn-primary">Save Changes</button>
        </div>
      </SectionCard>

      {/* My Account */}
      <SectionCard title="My Account" description="Your personal profile and credentials">
        <Field label="Full Name">
          <div className="grid grid-cols-2 gap-3">
            <SettingsInput defaultValue={user?.first_name ?? ''} placeholder="First name" />
            <SettingsInput defaultValue={user?.last_name ?? ''} placeholder="Last name" />
          </div>
        </Field>
        <Field label="Email Address"><SettingsInput defaultValue={user?.email ?? ''} type="email" /></Field>
        <Field label="Role" hint="Contact a Super Admin to change your role">
          <div className="flex items-center gap-2">
            <span className="rounded-md px-3 py-1.5 text-[13px]" style={{ background: 'var(--elevated)', border: '1px solid var(--border)', color: 'var(--text-3)' }}>{user?.role ?? '—'}</span>
            <span className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>Read-only</span>
          </div>
        </Field>
        <Field label="Password" hint="Must be at least 12 characters">
          <div className="space-y-2">
            <SettingsInput type="password" placeholder="Current password" />
            <SettingsInput type="password" placeholder="New password" />
            <SettingsInput type="password" placeholder="Confirm new password" />
          </div>
        </Field>
        <div className="pt-4 flex justify-end" style={{ borderTop: '1px solid var(--border-sub)' }}>
          <button className="btn-primary">Update Profile</button>
        </div>
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="Notifications" description="Choose which events trigger email and system alerts">
        <div className="space-y-4">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Email Alerts</p>
          <div className="space-y-3">
            <Toggle checked={notifs.email_daily_summary}    onChange={() => toggleNotif('email_daily_summary')}    label="Daily fleet summary digest" />
            <Toggle checked={notifs.email_damage_alerts}    onChange={() => toggleNotif('email_damage_alerts')}    label="Damage reports filed" />
            <Toggle checked={notifs.email_overdue_returns}  onChange={() => toggleNotif('email_overdue_returns')}  label="Overdue vehicle returns" />
            <Toggle checked={notifs.email_new_reservations} onChange={() => toggleNotif('email_new_reservations')} label="New reservation confirmations" />
          </div>
          <div className="pt-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>System Alerts</p>
            <Toggle checked={notifs.system_low_fleet} onChange={() => toggleNotif('system_low_fleet')} label="Alert when available fleet drops below 10%" />
          </div>
        </div>
      </SectionCard>

      {/* AI / LLM */}
      <div className="panel overflow-hidden">
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sb-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z"/><path d="M12 8v4l3 3"/>
            </svg>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>AI / LLM Configuration</h2>
          </div>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            Bring your own API key (BYOK) — your key is used for agent chat, intent classification, and damage analysis. Falls back to the system key if not set.
          </p>
        </div>
        <LLMSettingsSection />
      </div>

      {/* Security */}
      <SectionCard title="Security" description="Authentication and session settings">
        <Field label="Two-Factor Authentication" hint="Add an extra layer of security to your account">
          <div className="flex items-center gap-3">
            <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid rgba(251,191,36,0.25)' }}>Not Enabled</span>
            <button className="text-[13px] font-medium" style={{ color: 'var(--accent)' }}>Enable MFA</button>
          </div>
        </Field>
        <Field label="Session Timeout" hint="Automatically sign out after inactivity">
          <SettingsSelect>
            <option>30 minutes</option>
            <option>1 hour</option>
            <option>4 hours</option>
            <option>8 hours</option>
          </SettingsSelect>
        </Field>
        <Field label="Active Sessions" hint="Sign out all other devices">
          <button className="btn-secondary text-[13px]" style={{ borderColor: 'rgba(244,114,114,0.3)', color: 'var(--danger)' }}>
            Sign Out All Other Devices
          </button>
        </Field>
      </SectionCard>
    </div>
  )
}
