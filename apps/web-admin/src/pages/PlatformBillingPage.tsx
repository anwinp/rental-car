import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * The platform's own Stripe credentials.
 *
 * Two things this page deliberately does not do.
 *
 * It never displays a stored key. Not behind a reveal toggle, not on a copy
 * button, not once after saving. The server does not return them and this file
 * has no field capable of holding one — an operator who needs the key has it in
 * Stripe's dashboard, and a "show" control here would exist only to be
 * shoulder-surfed.
 *
 * It never puts a key in a URL, a query string, or component state that
 * survives the submit. The inputs are cleared the moment a save succeeds, so a
 * key does not sit in memory behind an idle tab.
 *
 * Saving keys and switching billing on are separate acts, and switching on is
 * refused until the credentials have actually been checked against Stripe.
 * "Saved" is not "working" — a key can be revoked, from the wrong account, or
 * scoped too narrowly, and the alternative to checking is finding out from a
 * customer's failed payment.
 */

const API = '/api/v1/platform/billing'

interface Config {
  publishable_key: string | null
  secret_key_hint: string | null
  webhook_secret_hint: string | null
  mode: string
  is_enabled: boolean
  secret_key_set: boolean
  webhook_secret_set: boolean
  last_verified_at: string | null
  last_verify_error: string | null
  updated_at: string | null
  encryption_ready: boolean
}

export default function PlatformBillingPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [publishable, setPublishable] = useState('')
  const [secret, setSecret] = useState('')
  const [webhook, setWebhook] = useState('')
  const [ackLive, setAckLive] = useState(false)
  const [password, setPassword] = useState('')

  async function load() {
    try {
      const res = await fetch(`${API}/config`, { credentials: 'include' })
      if (!res.ok) { setError('Could not load the billing configuration.'); return }
      setCfg(await res.json())
    } catch { setError('Could not reach the server.') }
  }
  useEffect(() => { void load() }, [])

  function wipe() {
    // Cleared on every outcome, not only success. A password left in state
    // after a failed attempt is a password sitting in a tab somebody walks
    // away from.
    setPassword(''); setSecret(''); setWebhook(''); setAckLive(false)
  }

  async function call(path: string, body: unknown, method: string, ok: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`${API}${path}`, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setCfg(data as Config); setNotice(ok); wipe(); return true }
      const detail = Array.isArray(data.detail)
        ? data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ')
        : data.detail
      setError(String(detail ?? 'That did not work.'))
      return false
    } catch {
      setError('Could not reach the server.'); return false
    } finally { setBusy(false); setPassword('') }
  }

  if (!cfg) {
    return <div className="mx-auto max-w-3xl p-8 text-sm text-slate-500">{error || 'Loading…'}</div>
  }

  const live = cfg.mode === 'LIVE'
  const typingLive = secret.startsWith('sk_live_') || secret.startsWith('rk_live_')
  const verified = Boolean(cfg.last_verified_at)

  const field = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none'
  const label = 'block text-xs font-medium text-slate-400'

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link to="/platform" className="text-xs text-slate-500 hover:text-slate-300">
        ← All workspaces
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="mt-1 text-sm text-slate-400">
          The Stripe account that charges your customers for their
          subscription. Not the same as the gateway each workspace uses to
          charge its own renters.
        </p>
      </header>

      {notice && <p className="mt-4 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      {!cfg.encryption_ready && (
        <p className="mt-4 rounded-lg border border-red-900/60 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          PLATFORM_SECRETS_KEY is not set on the server. Secrets are encrypted
          before they are stored, so saving a key is refused until it is
          configured — storing one in the clear would be worse than not storing
          it at all.
        </p>
      )}

      {/* State first: what is configured, what mode, whether it works. */}
      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                live ? 'bg-red-500/15 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
                {live ? 'live mode' : 'test mode'}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                cfg.is_enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {cfg.is_enabled ? 'billing on' : 'billing off'}
              </span>
            </div>
            <dl className="mt-4 space-y-1.5 text-xs">
              <div className="flex gap-3">
                <dt className="w-36 text-slate-500">Secret key</dt>
                <dd className="font-mono text-slate-300">
                  {cfg.secret_key_set ? cfg.secret_key_hint : 'not set'}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-36 text-slate-500">Webhook secret</dt>
                <dd className="font-mono text-slate-300">
                  {cfg.webhook_secret_set ? cfg.webhook_secret_hint : 'not set'}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-36 text-slate-500">Publishable key</dt>
                <dd className="break-all font-mono text-slate-300">
                  {cfg.publishable_key ?? 'not set'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="text-right text-xs">
            {cfg.last_verify_error ? (
              <span className="text-red-300">{cfg.last_verify_error}</span>
            ) : verified ? (
              <span className="text-emerald-400">
                Checked against Stripe<br />
                {new Date(cfg.last_verified_at!).toISOString().slice(0, 16).replace('T', ' ')}
              </span>
            ) : (
              <span className="text-amber-400">Not checked yet</span>
            )}
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-600">
          Only the last four characters of a secret are ever shown, here or
          anywhere else. The stored values are encrypted and are never returned
          by the server — if you need a key, take it from Stripe.
        </p>
      </section>

      {/* Entry. Secrets are write-only: a blank field leaves the stored value alone. */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Enter credentials
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          Leave a field blank to keep what is already stored. From Stripe →
          Developers → API keys, and Developers → Webhooks for the signing
          secret.
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void call('/config', {
              current_password: password,
              publishable_key: publishable || null,
              secret_key: secret || null,
              webhook_secret: webhook || null,
              acknowledge_live: ackLive,
            }, 'PUT', 'Saved.')
          }}
        >
          <div>
            <label className={label} htmlFor="sk">Secret key</label>
            <input id="sk" type="password" autoComplete="off" spellCheck={false}
                   value={secret} onChange={(e) => setSecret(e.target.value)}
                   placeholder="sk_test_… or sk_live_…" className={`${field} mt-1 font-mono`} />
          </div>
          <div>
            <label className={label} htmlFor="wh">Webhook signing secret</label>
            <input id="wh" type="password" autoComplete="off" spellCheck={false}
                   value={webhook} onChange={(e) => setWebhook(e.target.value)}
                   placeholder="whsec_…" className={`${field} mt-1 font-mono`} />
          </div>
          <div>
            <label className={label} htmlFor="pk">
              Publishable key <span className="text-slate-600">— not secret</span>
            </label>
            <input id="pk" autoComplete="off" spellCheck={false}
                   value={publishable} onChange={(e) => setPublishable(e.target.value)}
                   placeholder="pk_test_… or pk_live_…" className={`${field} mt-1 font-mono`} />
          </div>

          {typingLive && (
            <label className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-500/10 p-3 text-xs text-red-200">
              <input type="checkbox" checked={ackLive}
                     onChange={(e) => setAckLive(e.target.checked)}
                     className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-red-500" />
              <span>
                This is a <strong>live</strong> key. Saving it makes real charges
                possible against real cards. I mean to use live mode.
              </span>
            </label>
          )}

          <div className="border-t border-slate-800 pt-3">
            <label className={label} htmlFor="pw">
              Your password — required to change a payment credential
            </label>
            <input id="pw" type="password" required autoComplete="current-password"
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   className={`${field} mt-1`} />
            <p className="mt-1.5 text-[11px] text-slate-600">
              Asked again because a signed-in session is not proof that you are
              the one at the keyboard right now.
            </p>
          </div>

          <button type="submit" disabled={busy || !password}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save credentials'}
          </button>
        </form>
      </section>

      {/* Check, then switch on. Two acts, in that order. */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Check and switch on
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          Checking asks Stripe whether the stored key works — a read-only call,
          so it cannot move money. Billing cannot be switched on until it has
          passed.
        </p>

        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void call('/config/verify', { current_password: password }, 'POST',
              'Checked.')
          }}
        >
          <div className="min-w-[200px] flex-1">
            <label className={label} htmlFor="pw2">Your password</label>
            <input id="pw2" type="password" required autoComplete="current-password"
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   className={`${field} mt-1`} />
          </div>
          <button type="submit" disabled={busy || !password || !cfg.secret_key_set}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-40">
            Check against Stripe
          </button>
          <button type="button"
                  disabled={busy || !password || (!cfg.is_enabled && !verified)}
                  onClick={() => {
                    if (!cfg.is_enabled && live && !window.confirm(
                      'Switch billing on in LIVE mode?\n\n' +
                      'Real cards will be charged from this point.'
                    )) return
                    void call('/config/enable',
                      { current_password: password, is_enabled: !cfg.is_enabled },
                      'POST', cfg.is_enabled ? 'Billing is off.' : 'Billing is on.')
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${
                    cfg.is_enabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-emerald-700 hover:bg-emerald-600'}`}>
            {cfg.is_enabled ? 'Switch billing off' : 'Switch billing on'}
          </button>
          <button type="button" disabled={busy || !password}
                  onClick={() => {
                    if (!window.confirm(
                      'Remove the stored Stripe credentials?\n\n' +
                      'Billing switches off. Nothing already charged is affected.'
                    )) return
                    void call('/config', { current_password: password }, 'DELETE',
                      'Credentials removed.')
                  }}
                  className="rounded-lg border border-red-900/60 px-4 py-2 text-sm text-red-300 hover:border-red-700 disabled:opacity-40">
            Remove
          </button>
        </form>
      </section>

      <p className="mt-5 text-xs text-slate-600">
        Every change here is recorded with who made it. Keys are stored
        encrypted and no endpoint returns them.
      </p>
    </div>
  )
}
