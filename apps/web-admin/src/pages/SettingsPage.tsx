import { useState } from 'react'
import { useAuth } from '@rcm/ui/auth'
import type { ReactNode } from 'react'

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
