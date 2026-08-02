import { useState } from 'react'

/**
 * Turning the second factor on for a platform operator.
 *
 * The console shipped with is_mfa_enabled in the database, an "MFA off" badge
 * in the header, and no way to change it — a control that named a real risk and
 * could not be operated. This is that missing half.
 *
 * Enrolling and arming are separate steps on purpose. Doing both at once is how
 * somebody ends up locked out of the account that administers every customer,
 * having pointed their authenticator at a secret they never successfully used.
 */

const API = '/api/v1/platform/auth'

async function problem(res: Response, fallback: string): Promise<string> {
  try {
    const b = await res.json()
    return String(b.detail ?? fallback)
  } catch {
    return fallback
  }
}

interface Enrolment {
  secret: string
  provisioning_uri: string
  backup_codes: string[]
}

export function PlatformSecurity({ armed, onChanged }: {
  armed: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setOpen(false); setPassword(''); setCode('')
    setEnrolment(null); setError(''); setNotice('')
  }

  async function begin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/mfa/enroll`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: password }),
      })
      if (res.ok) { setEnrolment(await res.json()); setPassword('') }
      else setError(await problem(res, 'Could not start enrolment.'))
    } catch { setError('Could not reach the server.') } finally { setBusy(false) }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/mfa/confirm`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (res.ok) { setNotice('Two-factor is on.'); setEnrolment(null); setCode(''); onChanged() }
      else setError(await problem(res, 'That code is not right.'))
    } catch { setError('Could not reach the server.') } finally { setBusy(false) }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch(`${API}/mfa/disable`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: password, code }),
      })
      if (res.ok) { setNotice('Two-factor is off.'); reset(); onChanged() }
      else setError(await problem(res, 'Could not switch it off.'))
    } catch { setError('Could not reach the server.') } finally { setBusy(false) }
  }

  const field = 'mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none'
  const fieldStyle = {
    background: 'var(--page-bg)', color: 'var(--text-1)',
    border: '1px solid var(--border)',
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="text-xs hover:underline"
              style={{ color: armed ? 'var(--text-2)' : '#fbbf24' }}
              title={armed
                ? 'Two-factor is on for this account'
                : 'This account can suspend or delete any workspace'}>
        {armed ? 'Two-factor on' : 'Turn on two-factor'}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
         style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="mt-16 w-full max-w-md rounded-xl p-6"
           style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
            Two-factor authentication
          </h2>
          <button onClick={reset} className="text-sm" style={{ color: 'var(--text-3)' }}>
            Close
          </button>
        </div>

        {notice && <p className="mt-3 text-sm text-emerald-400">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        {armed ? (
          <form onSubmit={disable} className="mt-4 space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              It is on. Switching it off needs your password and a current code —
              a session cookie alone must not be enough to remove the thing that
              makes a stolen session insufficient.
            </p>
            <input type="password" required placeholder="Your password" autoComplete="current-password"
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   className={field} style={fieldStyle} />
            <input required placeholder="Code from your app" inputMode="numeric"
                   value={code} onChange={(e) => setCode(e.target.value)}
                   className={`${field} font-mono tracking-widest`} style={fieldStyle} />
            <button type="submit" disabled={busy}
                    className="w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
                    style={{ background: '#b0341f', color: '#fff' }}>
              Switch two-factor off
            </button>
          </form>
        ) : enrolment ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                Add this to your authenticator app, then enter a code to switch
                it on. Nothing changes until that code works.
              </p>
              <code className="mt-2 block break-all rounded-lg p-3 font-mono text-xs"
                    style={{ background: 'var(--page-bg)', color: 'var(--text-1)' }}>
                {enrolment.secret}
              </code>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider"
                 style={{ color: 'var(--text-3)' }}>
                Backup codes
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
                Save these somewhere other than the device with the app on it.
                Each works once, and they are the only way in if you lose the
                phone.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg p-3 font-mono text-xs"
                   style={{ background: 'var(--page-bg)', color: 'var(--text-1)' }}>
                {enrolment.backup_codes.map((c) => <span key={c}>{c}</span>)}
              </div>
            </div>

            <form onSubmit={confirm} className="space-y-3">
              <input required autoFocus placeholder="Code from your app" inputMode="numeric"
                     value={code} onChange={(e) => setCode(e.target.value)}
                     className={`${field} font-mono tracking-widest`} style={fieldStyle} />
              <button type="submit" disabled={busy}
                      className="w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
                      style={{ background: 'var(--accent)', color: '#fff' }}>
                Switch it on
              </button>
            </form>
          </div>
        ) : (
          <form onSubmit={begin} className="mt-4 space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              This account can suspend or delete any workspace on the platform.
              Right now a password is the only thing in the way.
            </p>
            <input type="password" required autoFocus placeholder="Your password"
                   autoComplete="current-password" value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   className={field} style={fieldStyle} />
            <button type="submit" disabled={busy}
                    className="w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
                    style={{ background: 'var(--accent)', color: '#fff' }}>
              {busy ? 'Starting…' : 'Begin'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
