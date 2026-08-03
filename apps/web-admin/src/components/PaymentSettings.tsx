import { useEffect, useState } from 'react'
import { describeApiError } from '../apiError'

/**
 * How this workspace takes money from renters.
 *
 * The form is rendered from the provider registry the API serves, not written
 * per provider — a new gateway is a registry entry and an adapter on the
 * server, and this page picks it up without changing. That is the whole reason
 * the registry describes its fields rather than the fields being hardcoded here.
 *
 * Capabilities are used, not just displayed. A provider that cannot raise an
 * existing hold does not get offered "increase the hold when a rental is
 * extended", because the alternative is finding out at the counter with a
 * customer waiting.
 *
 * Secrets are write-only in both directions: a stored key comes back as its
 * last four characters, and leaving a secret field blank keeps what is already
 * saved rather than clearing it.
 */

const API = '/api/v1/payments/config'

interface ProviderField {
  key: string
  label: string
  secret: boolean
  required: boolean
  help: string | null
  placeholder: string | null
}

interface Capabilities {
  incremental_auth: boolean
  max_increments: number | null
  max_auth_days: number
  partial_capture: boolean
  separate_deposit_auth: boolean
  card_present: string | null
  countries: string[]
  currencies: string[]
}

interface Provider {
  key: string
  label: string
  blurb: string
  kind: 'server_rest' | 'terminal_local' | 'terminal_cloud'
  onboarding: 'managed' | 'credentials'
  available: boolean
  unavailable_reason: string | null
  fields: ProviderField[]
  capabilities: Capabilities
}

interface DepositPolicy {
  enabled?: boolean
  basis?: 'FLAT' | 'MULTIPLIER'
  amount_cents?: number
  multiplier?: number
  collect_at?: 'BOOKING' | 'PICKUP'
  separate_authorisation?: boolean
  release_at?: 'RETURN' | 'INSPECTION'
}

interface Config {
  configured: boolean
  provider: string | null
  provider_label: string | null
  onboarding: string | null
  kind: string | null
  mode: 'TEST' | 'LIVE'
  is_live: boolean
  connected_account_id: string | null
  verified_at: string | null
  verify_error: string | null
  secret_hints: Record<string, string>
  settings: Record<string, unknown>
  deposit_policy: DepositPolicy
  capabilities: Partial<Capabilities>
}

export function PaymentSettings() {
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [secretsAvailable, setSecretsAvailable] = useState(true)
  const [config, setConfig] = useState<Config | null>(null)
  const [chosen, setChosen] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [deposit, setDeposit] = useState<DepositPolicy>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try {
      const [p, c] = await Promise.all([
        fetch(`${API}/providers`, { credentials: 'include' }).then((r) => r.json()),
        fetch(API, { credentials: 'include' }).then((r) => r.json()),
      ])
      setProviders(p.providers ?? [])
      setSecretsAvailable(p.secrets_available !== false)
      setConfig(c)
      if (c?.provider) setChosen(c.provider)
      setDeposit(c?.deposit_policy ?? {})
    } catch {
      setProviders([])
      setError('Could not load payment settings.')
    }
  }
  useEffect(() => { void load() }, [])

  async function call(path: string, init: RequestInit, ok: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`${API}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(describeApiError(body, res.status)); return null }
      setNotice(ok)
      await load()
      return body
    } catch {
      setError('Could not reach the server.'); return null
    } finally { setBusy(false) }
  }

  const selected = providers?.find((p) => p.key === chosen) ?? null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    await call('', {
      method: 'PUT',
      body: JSON.stringify({
        provider: selected.key, values, deposit_policy: normalise(deposit),
      }),
    }, 'Saved. Check the connection before switching payments on.')
    setValues({})   // never keep a typed secret in component state
  }

  async function verify() {
    await call('/verify', { method: 'POST' }, 'Connection checked.')
  }

  async function setLive(live: boolean) {
    await call('/live', { method: 'POST', body: JSON.stringify({ live }) },
      live ? 'Payments are on.' : 'Payments are off.')
  }

  async function disconnect() {
    if (!window.confirm(
      'Remove these payment settings?\n\nThis workspace will stop being able ' +
      'to take payments until something else is configured.'
    )) return
    await call('', { method: 'DELETE' }, 'Payment settings removed.')
    setChosen(''); setValues({})
  }

  if (!providers || !config) {
    return <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading…</p>
  }

  const caps = selected?.capabilities
  const verified = Boolean(config.verified_at)

  return (
    <div className="space-y-5">
      {/* Status line — the first thing an operator needs to know is whether
          this workspace can currently take money, and on whose account. */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded px-2 py-0.5 font-semibold"
              style={config.is_live
                ? { background: 'rgba(16,185,129,0.16)', color: '#34d399' }
                : { background: 'rgba(148,163,184,0.16)', color: '#94a3b8' }}>
          {config.is_live ? 'Taking payments' : 'Not taking payments'}
        </span>
        {config.configured && (
          <span className="rounded px-2 py-0.5 font-semibold"
                style={config.mode === 'LIVE'
                  ? { background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                  : { background: 'rgba(59,130,246,0.16)', color: '#60a5fa' }}>
            {config.mode === 'LIVE' ? 'Live mode' : 'Test mode'}
          </span>
        )}
        {config.configured && (
          <span style={{ color: 'var(--text-3)' }}>
            {config.provider_label}
            {verified
              ? ` · checked ${new Date(config.verified_at!).toLocaleString()}`
              : ' · not checked yet'}
          </span>
        )}
      </div>

      {!config.configured && !secretsAvailable && (
        <p className="rounded-lg px-3 py-2 text-[12px]"
           style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
          This server has no encryption key configured, so payment credentials
          cannot be stored. Ask your administrator to set PLATFORM_SECRETS_KEY.
        </p>
      )}

      {notice && <p className="text-[12px] text-emerald-400">{notice}</p>}
      {error && <p className="text-[12px] text-red-400">{error}</p>}
      {config.verify_error && (
        <p className="rounded-lg px-3 py-2 text-[12px]"
           style={{ background: 'rgba(176,52,31,0.12)', color: '#f87171' }}>
          {config.verify_error}
        </p>
      )}

      {/* Provider choice */}
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map((p) => {
          const active = p.key === chosen
          return (
            <button
              key={p.key}
              type="button"
              disabled={!p.available}
              onClick={() => { setChosen(p.key); setValues({}); setError('') }}
              className="rounded-xl p-3 text-left disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: active ? 'var(--accent-sub)' : 'transparent',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
                  {p.label}
                </span>
                {p.onboarding === 'managed' && p.available && (
                  <span className="text-[10px] uppercase tracking-wider"
                        style={{ color: 'var(--accent)' }}>one click</span>
                )}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {p.available ? p.blurb : p.unavailable_reason}
              </p>
              {p.available && (
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                  Holds last up to {p.capabilities.max_auth_days} days
                  {p.capabilities.incremental_auth ? ' · can extend a hold' : ''}
                  {p.capabilities.card_present ? ' · counter terminals' : ''}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* Managed onboarding has nothing to fill in. Saying so is better than an
          empty form that looks broken. */}
      {selected?.onboarding === 'managed' && (
        <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)' }}>
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
            {selected.label} sets your account up for you — there is nothing to
            type here. You will be taken to {selected.label} to confirm your
            business details, and payouts go straight to your own bank account.
          </p>
          <p className="mt-2 text-[11.5px]" style={{ color: 'var(--text-3)' }}>
            Connecting is not available yet in this build. Choose
            “{providers.find((p) => p.key === 'stripe_keys')?.label}” if you
            already have an account and can paste its keys.
          </p>
        </div>
      )}

      {/* Credential form, rendered entirely from the registry */}
      {selected?.onboarding === 'credentials' && selected.available && (
        <form onSubmit={save} className="rounded-xl p-4 space-y-3"
              style={{ border: '1px solid var(--border)' }}>
          {selected.fields.map((f) => {
            const stored = config.secret_hints?.[f.key]
            const existing = config.settings?.[f.key]
            return (
              <label key={f.key} className="block">
                <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
                  {f.label}{!f.required && (
                    <span style={{ color: 'var(--text-3)' }}> (optional)</span>
                  )}
                </span>
                <input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[f.key] ?? (f.secret ? '' : String(existing ?? ''))}
                  placeholder={f.secret && stored ? `Stored — ends ${stored}` : (f.placeholder ?? '')}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  className="mt-1 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                  style={{ background: 'var(--page-bg)', color: 'var(--text-1)',
                           border: '1px solid var(--border)' }}
                />
                {f.help && (
                  <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-3)' }}>
                    {f.help}
                  </span>
                )}
                {f.secret && stored && (
                  <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-3)' }}>
                    Leave blank to keep the key already saved.
                  </span>
                )}
              </label>
            )
          })}

          {/* Deposit policy — the tenant's commercial choice, gated by what
              their processor can actually do. */}
          <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <label className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
                     checked={deposit.enabled ?? false}
                     onChange={(e) => setDeposit({ ...deposit, enabled: e.target.checked })} />
              <span>
                <span style={{ color: 'var(--text-2)' }}>Hold a security deposit</span>
                <span className="block text-[11px]">
                  An extra hold on the customer's card alongside the rental,
                  released after the car comes back.
                </span>
              </span>
            </label>

            {deposit.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  Amount
                  <div className="mt-1 flex gap-2">
                    <select value={deposit.basis ?? 'FLAT'}
                            onChange={(e) => setDeposit({ ...deposit, basis: e.target.value as 'FLAT' | 'MULTIPLIER' })}
                            className="rounded-lg px-2 py-2 text-[13px]"
                            style={{ background: 'var(--page-bg)', color: 'var(--text-1)',
                                     border: '1px solid var(--border)' }}>
                      <option value="FLAT">Fixed</option>
                      <option value="MULTIPLIER">× rental total</option>
                    </select>
                    <input type="number" min={0} step="1"
                           value={deposit.basis === 'MULTIPLIER'
                             ? String(deposit.multiplier ?? '')
                             : String((deposit.amount_cents ?? 0) / 100 || '')}
                           onChange={(e) => setDeposit(deposit.basis === 'MULTIPLIER'
                             ? { ...deposit, multiplier: Number(e.target.value) }
                             : { ...deposit, amount_cents: Math.round(Number(e.target.value) * 100) })}
                           className="w-full rounded-lg px-3 py-2 text-[13px]"
                           style={{ background: 'var(--page-bg)', color: 'var(--text-1)',
                                    border: '1px solid var(--border)' }} />
                  </div>
                </label>

                <label className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  Taken at
                  <select value={deposit.collect_at ?? 'PICKUP'}
                          onChange={(e) => setDeposit({ ...deposit, collect_at: e.target.value as 'BOOKING' | 'PICKUP' })}
                          className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]"
                          style={{ background: 'var(--page-bg)', color: 'var(--text-1)',
                                   border: '1px solid var(--border)' }}>
                    <option value="PICKUP">Pickup</option>
                    <option value="BOOKING">Booking</option>
                  </select>
                </label>

                <label className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                  Released
                  <select value={deposit.release_at ?? 'RETURN'}
                          onChange={(e) => setDeposit({ ...deposit, release_at: e.target.value as 'RETURN' | 'INSPECTION' })}
                          className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]"
                          style={{ background: 'var(--page-bg)', color: 'var(--text-1)',
                                   border: '1px solid var(--border)' }}>
                    <option value="RETURN">When the car is returned</option>
                    <option value="INSPECTION">After inspection</option>
                  </select>
                </label>

                {/* Only offered where the processor supports a second hold. */}
                {caps?.separate_deposit_auth && (
                  <label className="flex items-start gap-2 text-[12px] sm:col-span-2"
                         style={{ color: 'var(--text-3)' }}>
                    <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-indigo-500"
                           checked={deposit.separate_authorisation ?? false}
                           onChange={(e) => setDeposit({ ...deposit, separate_authorisation: e.target.checked })} />
                    <span>
                      <span style={{ color: 'var(--text-2)' }}>Hold the deposit separately</span>
                      <span className="block text-[11px]">
                        Two holds instead of one. Easier to release the deposit
                        on its own, but a second hold is more likely to be
                        declined on a card near its limit.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={busy || !secretsAvailable}
                    className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}>Save</button>
            {config.configured && (
              <>
                <button type="button" onClick={() => void verify()} disabled={busy}
                        className="rounded-lg px-4 py-2 text-[13px] disabled:opacity-50"
                        style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                  Check the connection
                </button>
                <button type="button" onClick={() => void setLive(!config.is_live)}
                        disabled={busy || (!verified && !config.is_live)}
                        title={!verified && !config.is_live
                          ? 'Check the connection first' : undefined}
                        className="rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
                        style={config.is_live
                          ? { border: '1px solid rgba(176,52,31,0.5)', color: '#fca5a5' }
                          : { background: '#059669', color: '#fff' }}>
                  {config.is_live ? 'Stop taking payments' : 'Start taking payments'}
                </button>
                <button type="button" onClick={() => void disconnect()} disabled={busy}
                        className="ml-auto rounded-lg px-3 py-2 text-[12px] text-red-300 disabled:opacity-40"
                        style={{ border: '1px solid rgba(176,52,31,0.4)' }}>Remove</button>
              </>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

/** Drop the half of the policy that does not apply, so the stored shape matches
 *  what was actually chosen rather than carrying a stale multiplier around. */
function normalise(d: DepositPolicy): DepositPolicy {
  if (!d.enabled) return { enabled: false }
  const base = {
    enabled: true,
    basis: d.basis ?? 'FLAT',
    collect_at: d.collect_at ?? 'PICKUP',
    release_at: d.release_at ?? 'RETURN',
    separate_authorisation: d.separate_authorisation ?? false,
  }
  return d.basis === 'MULTIPLIER'
    ? { ...base, multiplier: d.multiplier ?? 0, amount_cents: 0 }
    : { ...base, amount_cents: d.amount_cents ?? 0, multiplier: 0 }
}
