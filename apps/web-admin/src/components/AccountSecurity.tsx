import { useEffect, useState } from 'react'

/**
 * Change password, and end sessions on other devices.
 *
 * Settings previously rendered three password inputs above an "Update Profile"
 * button with no click handler, and a "Sign Out All Other Devices" button with
 * no click handler. The endpoints they imply — /auth/change-password and
 * /auth/sessions — existed the whole time and had zero call sites anywhere in
 * the admin app. The controls were decoration.
 *
 * Changing a password ends every other session, because the API raises the
 * credential epoch. That is stated up front rather than discovered, since it
 * is the main reason someone changes a password in a hurry.
 */

const RULES: Array<{ label: string; ok: (v: string) => boolean }> = [
  { label: 'At least 12 characters', ok: (v) => v.length >= 12 },
  { label: 'An uppercase letter', ok: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', ok: (v) => /[a-z]/.test(v) },
  { label: 'A number', ok: (v) => /\d/.test(v) },
  { label: 'A symbol', ok: (v) => /[^A-Za-z0-9]/.test(v) },
]

type Note = { kind: 'ok' | 'err'; text: string } | null

/** Prefer the API's own wording — it is written for the operator. */
async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const b = await res.json()
    if (typeof b?.detail === 'string') return b.detail
    if (Array.isArray(b?.detail) && b.detail[0]?.msg) return String(b.detail[0].msg)
  } catch {
    /* fall through */
  }
  return fallback
}

export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)

  const unmet = RULES.filter((r) => !r.ok(next))
  const mismatch = confirm.length > 0 && confirm !== next
  const ready = current && next && confirm && unmet.length === 0 && !mismatch

  async function submit() {
    setNote(null)
    setBusy(true)
    try {
      const res = await fetch('/api/v1/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      if (res.ok) {
        setCurrent(''); setNext(''); setConfirm('')
        setNote({
          kind: 'ok',
          text: 'Password changed. Every other signed-in device has been signed out.',
        })
        return
      }
      setNote({ kind: 'err', text: await messageOf(res, 'Could not change the password.') })
    } catch {
      setNote({ kind: 'err', text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full rounded-md px-3 py-2 text-[13px] bg-[var(--elevated)] border border-[var(--border)] text-[var(--text-1)] focus:outline-none'

  return (
    <div className="space-y-3">
      <input type="password" autoComplete="current-password" placeholder="Current password"
             value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
      <input type="password" autoComplete="new-password" placeholder="New password"
             value={next} onChange={(e) => setNext(e.target.value)} className={input} />
      <input type="password" autoComplete="new-password" placeholder="Confirm new password"
             value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />

      {next.length > 0 && (
        <ul className="space-y-1 pt-1">
          {RULES.map((r) => {
            const ok = r.ok(next)
            return (
              <li key={r.label} className="text-[11.5px]"
                  style={{ color: ok ? 'var(--success, #03904a)' : 'var(--text-3)' }}>
                {ok ? '✓' : '•'} {r.label}
              </li>
            )
          })}
        </ul>
      )}
      {mismatch && (
        <p className="text-[11.5px]" style={{ color: 'var(--warn)' }}>These do not match.</p>
      )}
      {note && (
        <p className="text-[12px]"
           style={{ color: note.kind === 'ok' ? 'var(--success, #03904a)' : 'var(--danger)' }}>
          {note.text}
        </p>
      )}

      <button className="btn-primary text-[13px]" disabled={!ready || busy}
              onClick={() => void submit()}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
      <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
        Changing your password signs you out everywhere else. Use it if you think
        someone else has access.
      </p>
    </div>
  )
}

export function ActiveSessions() {
  const [count, setCount] = useState<number | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/v1/auth/sessions', { credentials: 'include' })
      if (!res.ok) return
      const rows = await res.json()
      setCount(Array.isArray(rows) ? rows.length : null)
    } catch {
      /* leave unknown rather than claiming a count */
    }
  }
  useEffect(() => { void load() }, [])

  async function signOutOthers() {
    setNote(null)
    setBusy(true)
    try {
      const res = await fetch('/api/v1/auth/sessions', { credentials: 'include' })
      const rows: Array<{ jti: string }> = res.ok ? await res.json() : []
      let revoked = 0
      for (const r of rows) {
        const d = await fetch(`/api/v1/auth/sessions/${r.jti}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (d.ok) revoked += 1
      }
      // Revoking the current session too would sign the operator out of the
      // page they are standing on, so this reports rather than redirects; the
      // API rejects a session that is no longer valid on the next call anyway.
      setNote({
        kind: 'ok',
        text: revoked
          ? `Signed out ${revoked} session${revoked === 1 ? '' : 's'}. You may need to sign in again.`
          : 'No other sessions to sign out.',
      })
      await load()
    } catch {
      setNote({ kind: 'err', text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
        {count === null ? 'Checking…' : `${count} active session${count === 1 ? '' : 's'}`}
      </p>
      {note && (
        <p className="text-[12px]"
           style={{ color: note.kind === 'ok' ? 'var(--success, #03904a)' : 'var(--danger)' }}>
          {note.text}
        </p>
      )}
      <button className="btn-secondary text-[13px]" disabled={busy}
              onClick={() => void signOutOthers()}
              style={{ borderColor: 'rgba(244,114,114,0.3)', color: 'var(--danger)' }}>
        {busy ? 'Signing out…' : 'Sign out all sessions'}
      </button>
    </div>
  )
}
