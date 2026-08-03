import { useEffect, useRef, useState } from 'react'
import { describeApiError } from '../apiError'

/**
 * How this workspace's booking site looks.
 *
 * Preset-first, per the decision behind this feature: a tenant picks a
 * complete, designed template from the gallery rather than assembling a look
 * from forty controls — the floor is "good", not "default". Brand colour,
 * logo, favicon and copy are the few things shown immediately; fonts, corner
 * radius and button shape sit behind "More options" so the common path stays
 * a handful of decisions.
 *
 * Nothing here is live until Publish. Every edit saves to a draft — the same
 * draft/publish split as payments' verify-before-live gate — and the API
 * revalidates every value at publish time regardless of what this form sent,
 * so there is no path from a value typed here to unescaped CSS.
 */

const API = '/api/v1/theme'

interface FontFace {
  key: string
  label: string
  character: string
  role: 'heading' | 'body' | 'either'
}

interface TemplatePreview {
  key: string
  label: string
  blurb: string
  for: string
  preview: { bg: string; surface: string; text: string; brand: string; radius_px: number }
  heading_font: string
  body_font: string
}

interface ThemeSettingsValues {
  brand_hex?: string
  background_hex?: string
  surface_hex?: string
  navbar_hex?: string
  footer_hex?: string
  heading_font?: string
  body_font?: string
  radius_px?: number
  button_style?: 'solid' | 'pill' | 'square'
  hero_heading?: string
  hero_subheading?: string
  terms_url?: string
  privacy_url?: string
  support_phone?: string
  support_email?: string
}

interface ThemeOut {
  preset: string
  settings: ThemeSettingsValues
  published_preset: string | null
  published_at: string | null
  is_published: boolean
  logo_url: string | null
  logo_dark_url: string | null
  favicon_url: string | null
  preview_css: string
  // Which colour(s) the server darkened to keep text legible on it — see
  // presets.clamp_to_dark. Surfaced so a tenant who picks something too light
  // sees why the preview doesn't quite match what they typed, rather than
  // wondering if the form is broken.
  adjusted: string[]
}

export function ThemeSettings() {
  const [templates, setTemplates] = useState<TemplatePreview[] | null>(null)
  const [fonts, setFonts] = useState<FontFace[]>([])
  const [theme, setTheme] = useState<ThemeOut | null>(null)
  const [preset, setPreset] = useState('meridian')
  const [values, setValues] = useState<ThemeSettingsValues>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstLoad = useRef(true)

  async function load() {
    try {
      const [reg, cfg] = await Promise.all([
        fetch(`${API}/templates`, { credentials: 'include' }).then((r) => r.json()),
        fetch(API, { credentials: 'include' }).then((r) => r.json()),
      ])
      setTemplates(reg.templates ?? [])
      setFonts(reg.fonts ?? [])
      setTheme(cfg)
      setPreset(cfg.preset)
      setValues(cfg.settings ?? {})
    } catch {
      setTemplates([])
      setError('Could not load theme settings.')
    }
  }
  useEffect(() => { void load() }, [])

  // Autosaves the draft a moment after an edit settles, and refreshes
  // preview_css from the server response — the same render_css the storefront
  // will use at publish time, not a client-side approximation of it that could
  // drift from what actually ships.
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveDraft() }, 600)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, values])

  async function saveDraft() {
    setSaving(true); setError('')
    try {
      const res = await fetch(API, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset, settings: values }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(describeApiError(body, res.status)); return }
      setTheme(body)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`${API}/publish`, { method: 'POST', credentials: 'include' })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(describeApiError(body, res.status)); return }
      setTheme(body)
      setNotice('Published — the booking site is showing this now.')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function uploadAsset(file: File, kind: 'logo' | 'logo-dark' | 'favicon') {
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/${kind}`, { method: 'POST', credentials: 'include', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(describeApiError(body, res.status)); return }
      await load()
      setNotice(`${kind === 'favicon' ? 'Favicon' : 'Logo'} updated. Publish to make it live.`)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!templates || !theme) {
    return <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Loading…</p>
  }

  const selected = templates.find((t) => t.key === preset) ?? templates[0]
  const headingFonts = fonts.filter((f) => f.role === 'heading' || f.role === 'either')
  const bodyFonts = fonts.filter((f) => f.role === 'body' || f.role === 'either')
  const previewCss = (theme.preview_css || '').replace(':root {', '.theme-preview-scope {')

  const field = 'w-full rounded-lg px-3 py-2 text-[13px] outline-none'
  const fieldStyle = { background: 'var(--page-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }

  return (
    <div className="space-y-5">
      <style>{previewCss}</style>

      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded px-2 py-0.5 font-semibold"
              style={theme.is_published
                ? { background: 'rgba(16,185,129,0.16)', color: '#34d399' }
                : { background: 'rgba(148,163,184,0.16)', color: '#94a3b8' }}>
          {theme.is_published ? 'Published' : 'Not published yet'}
        </span>
        {theme.is_published && theme.published_at && (
          <span style={{ color: 'var(--text-3)' }}>
            since {new Date(theme.published_at).toLocaleString()}
          </span>
        )}
        {saving && <span style={{ color: 'var(--text-3)' }}>saving draft…</span>}
      </div>

      {notice && <p className="text-[12px] text-emerald-400">{notice}</p>}
      {error && <p className="text-[12px] text-red-400">{error}</p>}

      {/* ── Template gallery ─────────────────────────────────────────────── */}
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-wider mb-2"
           style={{ color: 'var(--text-3)' }}>Template</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {templates.map((t) => {
            const active = t.key === preset
            return (
              <button key={t.key} type="button"
                      onClick={() => { setPreset(t.key); setValues({ ...values, brand_hex: undefined }) }}
                      className="rounded-xl p-3 text-left"
                      style={{ border: active ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
                <div className="flex gap-1.5 mb-2">
                  <span className="h-5 w-5 rounded-full" style={{ background: t.preview.bg, border: '1px solid var(--border)' }} />
                  <span className="h-5 w-5 rounded-full" style={{ background: t.preview.surface, border: '1px solid var(--border)' }} />
                  <span className="h-5 w-5 rounded-full" style={{ background: t.preview.brand }} />
                </div>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{t.label}</p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>{t.blurb}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{t.for}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Live mini-preview — the exact CSS the storefront will render,
          including the navbar and footer strips so all five palette colours
          are visible together rather than only the hero card. ──────────── */}
      <div className="theme-preview-scope rounded-xl overflow-hidden"
           style={{ border: '1px solid var(--border)' }}>
        <p className="px-4 pt-3 text-[10px] uppercase tracking-wider" style={{ color: 'var(--p-text-3, #888)' }}>
          Preview — reflects the draft, updates as you edit
        </p>
        <div className="flex items-center justify-between px-4 py-2.5 mt-2"
             style={{ background: 'var(--p-navbar-bg, #141414)' }}>
          <span style={{
            color: 'var(--p-navbar-fg, #fff)', fontFamily: 'var(--tenant-font-heading)',
            fontSize: 13, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
          }}>Your Company</span>
          <span style={{ color: 'var(--p-navbar-fg-dim, #999)', fontFamily: 'var(--tenant-font-body)', fontSize: 11 }}>
            Reserve · Locations · Sign in
          </span>
        </div>
        <div className="p-5" style={{ background: 'var(--p-bg, #141414)' }}>
          <div className="rounded-xl p-4" style={{ background: 'var(--p-surface, #1c1c1c)' }}>
            <h3 style={{
              color: 'var(--p-text-1, #fff)', fontFamily: 'var(--tenant-font-heading)',
              fontSize: 22, fontWeight: 600, margin: '0 0 6px',
            }}>
              {values.hero_heading || 'Your headline goes here.'}
            </h3>
            <p style={{ color: 'var(--p-text-2, #aaa)', fontFamily: 'var(--tenant-font-body)', fontSize: 13, margin: '0 0 14px' }}>
              {values.hero_subheading || 'A short line about what makes this fleet worth booking.'}
            </p>
            <span style={{
              display: 'inline-block', background: 'var(--p-cta, #3b82f6)', color: 'var(--p-cta-fg, #fff)',
              fontFamily: 'var(--tenant-font-body)', fontSize: 12, fontWeight: 700,
              padding: '9px 18px', borderRadius: 'var(--tenant-radius)',
            }}>
              Check availability
            </span>
          </div>
        </div>
        <div className="px-4 py-3 text-[11px]" style={{ background: 'var(--p-footer-bg, #141414)', color: 'var(--p-footer-fg-dim, #999)' }}>
          © Your Company — footer
        </div>
      </div>

      {theme.adjusted.length > 0 && (
        <p className="text-[12px]" style={{ color: '#fbbf24' }}>
          Darkened {theme.adjusted.join(', ')} a touch to keep text readable on it.
        </p>
      )}

      {/* ── Palette ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4 space-y-4" style={{ border: '1px solid var(--border)' }}>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            Palette
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
            Each colour below is independent — give the header its own colour
            without changing the page behind it, or leave any of them to the
            template's own default. Pick something too light and it gets
            darkened a touch automatically, so the text sitting on it never
            goes unreadable.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField label="Background" hint="The page canvas."
                      value={values.background_hex} defaultHex={selected.preview.bg}
                      onChange={(v) => setValues({ ...values, background_hex: v })} />
          <ColorField label="Surface" hint="Cards and panels sitting on the background."
                      value={values.surface_hex} defaultHex={selected.preview.surface}
                      onChange={(v) => setValues({ ...values, surface_hex: v })} />
          <ColorField label="Navbar" hint="The header bar — independent of the page background."
                      value={values.navbar_hex} defaultHex={values.background_hex || selected.preview.bg}
                      onChange={(v) => setValues({ ...values, navbar_hex: v })} />
          <ColorField label="Footer" hint="The footer band at the bottom of every page."
                      value={values.footer_hex} defaultHex={values.background_hex || selected.preview.bg}
                      onChange={(v) => setValues({ ...values, footer_hex: v })} />
        </div>

        <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <ColorField label="Accent" hint="Buttons, links, highlights."
                      value={values.brand_hex} defaultHex={selected.preview.brand}
                      onChange={(v) => setValues({ ...values, brand_hex: v })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <AssetUploader label="Logo" hint="Shown on the booking site header." current={theme.logo_url}
                         busy={busy} onFile={(f) => void uploadAsset(f, 'logo')} />
          <AssetUploader label="Favicon" hint="The browser-tab icon." current={theme.favicon_url}
                         busy={busy} onFile={(f) => void uploadAsset(f, 'favicon')} />
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--border)' }}>
        <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          Hero content
        </p>
        <label className="block">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Headline</span>
          <input value={values.hero_heading ?? ''} maxLength={200}
                 onChange={(e) => setValues({ ...values, hero_heading: e.target.value || undefined })}
                 placeholder="Drive The Dream."
                 className={`${field} mt-1`} style={fieldStyle} />
        </label>
        <label className="block">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Subheading</span>
          <input value={values.hero_subheading ?? ''} maxLength={400}
                 onChange={(e) => setValues({ ...values, hero_subheading: e.target.value || undefined })}
                 placeholder="Reserve an exclusive vehicle from our elite fleet."
                 className={`${field} mt-1`} style={fieldStyle} />
        </label>
      </div>

      {/* ── Legal ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4 grid gap-3 sm:grid-cols-2" style={{ border: '1px solid var(--border)' }}>
        <label className="block">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Terms URL</span>
          <input value={values.terms_url ?? ''} placeholder="https://…"
                 onChange={(e) => setValues({ ...values, terms_url: e.target.value || undefined })}
                 className={`${field} mt-1`} style={fieldStyle} />
        </label>
        <label className="block">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Privacy URL</span>
          <input value={values.privacy_url ?? ''} placeholder="https://…"
                 onChange={(e) => setValues({ ...values, privacy_url: e.target.value || undefined })}
                 className={`${field} mt-1`} style={fieldStyle} />
        </label>
        <label className="block">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Support phone</span>
          <input value={values.support_phone ?? ''} placeholder="+1 (800) 555-0100"
                 onChange={(e) => setValues({ ...values, support_phone: e.target.value || undefined })}
                 className={`${field} mt-1`} style={fieldStyle} />
        </label>
        <label className="block">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Support email</span>
          <input value={values.support_email ?? ''} placeholder="help@yourcompany.com"
                 onChange={(e) => setValues({ ...values, support_email: e.target.value || undefined })}
                 className={`${field} mt-1`} style={fieldStyle} />
        </label>
      </div>

      {/* ── Advanced ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4" style={{ border: '1px solid var(--border)' }}>
        <button type="button" onClick={() => setAdvancedOpen((v) => !v)}
                className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
          {advancedOpen ? '▾' : '▸'} More options — fonts, corners, button shape
        </button>
        {advancedOpen && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Heading font</span>
              <select value={values.heading_font ?? ''}
                      onChange={(e) => setValues({ ...values, heading_font: e.target.value || undefined })}
                      className={`${field} mt-1`} style={fieldStyle}>
                <option value="">Template default ({selected.heading_font})</option>
                {headingFonts.map((f) => <option key={f.key} value={f.key}>{f.label} — {f.character}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Body font</span>
              <select value={values.body_font ?? ''}
                      onChange={(e) => setValues({ ...values, body_font: e.target.value || undefined })}
                      className={`${field} mt-1`} style={fieldStyle}>
                <option value="">Template default ({selected.body_font})</option>
                {bodyFonts.map((f) => <option key={f.key} value={f.key}>{f.label} — {f.character}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                Corner radius {values.radius_px ?? selected.preview.radius_px}px
              </span>
              <input type="range" min={0} max={24}
                     value={values.radius_px ?? selected.preview.radius_px}
                     onChange={(e) => setValues({ ...values, radius_px: Number(e.target.value) })}
                     className="mt-2 w-full" />
            </label>
            <label className="block">
              <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>Button shape</span>
              <select value={values.button_style ?? ''}
                      onChange={(e) => setValues({
                        ...values,
                        button_style: (e.target.value || undefined) as ThemeSettingsValues['button_style'],
                      })}
                      className={`${field} mt-1`} style={fieldStyle}>
                <option value="">Template default</option>
                <option value="solid">Solid, rounded corners</option>
                <option value="pill">Pill — fully rounded</option>
                <option value="square">Square corners</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {/* The status line at the top of this section is easy to miss after
          scrolling through the gallery and every field to reach this button —
          confirmed by hand while testing: publishing produced no visible
          change in the viewport at all. This repeats notice/error right next
          to the action that caused them. */}
      <div className="flex items-center justify-end gap-3">
        {notice && <p className="text-[12px] text-emerald-400">{notice}</p>}
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        <button type="button" onClick={() => void publish()} disabled={busy}
                className="rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: '#059669' }}>
          Publish
        </button>
      </div>
    </div>
  )
}

/** One colour lever: a picker, a hex field, and a reset to the template's own
 *  value. `value` undefined means "not overridden" — the swatch then shows
 *  `defaultHex` so the field never looks blank, but typing/reset are the only
 *  ways an override actually gets set. */
function ColorField({
  label, hint, value, defaultHex, onChange,
}: {
  label: string
  hint: string
  value: string | undefined
  defaultHex: string
  onChange: (v: string | undefined) => void
}) {
  const shown = value ?? defaultHex
  return (
    <div>
      <label className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={shown}
               onChange={(e) => onChange(e.target.value)}
               className="h-9 w-12 rounded border-0 bg-transparent shrink-0" />
        <input type="text" value={value ?? ''} placeholder={defaultHex}
               onChange={(e) => onChange(e.target.value || undefined)}
               className="w-full rounded-lg px-3 py-2 text-[13px] font-mono outline-none"
               style={{ background: 'var(--page-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }} />
        {value && (
          <button type="button" onClick={() => onChange(undefined)}
                  className="shrink-0 text-[11px] underline" style={{ color: 'var(--text-3)' }}>
            reset
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</p>
    </div>
  )
}

function AssetUploader({
  label, hint, current, busy, onFile,
}: {
  label: string
  hint: string
  current: string | null
  busy: boolean
  onFile: (f: File) => void
}) {
  return (
    <div>
      <span className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>{label}</span>
      <div className="mt-1 flex items-center gap-3">
        {current && (
          <img src={current} alt={`Current ${label.toLowerCase()}`}
               className="h-10 max-w-[120px] rounded object-contain"
               style={{ background: 'var(--page-bg)', border: '1px solid var(--border)' }} />
        )}
        <label className="rounded-lg px-3 py-1.5 text-[12px] cursor-pointer"
               style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}>
          {current ? 'Replace' : 'Upload'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={busy}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
        </label>
      </div>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{hint}</p>
    </div>
  )
}
