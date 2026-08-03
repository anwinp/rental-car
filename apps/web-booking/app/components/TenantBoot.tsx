'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { resolveTenant, type TenantConfig } from '../lib/tenant'
import PlatformLanding from './PlatformLanding'

const THEME_STYLE_ID = 'tenant-theme-css'
const FAVICON_LINK_ID = 'tenant-favicon'

/**
 * Puts the tenant's published theme on the page before it renders.
 *
 * Runs inside the same effect that resolves the tenant, before `state` flips
 * to 'ready' — the loading screen is already covering the page at this point,
 * which is what keeps this from being a flash of the wrong theme rather than
 * no theme at all.
 *
 * DOM injection rather than a React-rendered <style> tag: it does not depend
 * on App Router's element-hoisting behaviour for a plain <style>, which is
 * documented for <title>/<meta>/<link> but not asserted here for <style> —
 * writing to document.head directly is the version that is certain to work.
 */
function applyTheme(config: TenantConfig): void {
  if (typeof document === 'undefined') return

  let styleTag = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null
  if (config.theme_css) {
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = THEME_STYLE_ID
      document.head.appendChild(styleTag)
    }
    // theme_css is server-generated from typed, validated settings — see
    // app/domains/theme/presets.py::render_css. Nothing tenant-supplied
    // reaches it as raw text, which is what makes writing it here safe.
    styleTag.textContent = config.theme_css
  } else {
    styleTag?.remove()
  }

  if (config.favicon_url) {
    let link = document.getElementById(FAVICON_LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = FAVICON_LINK_ID
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = config.favicon_url
  }
}

/**
 * Resolves the workspace from the hostname before the app renders.
 *
 * Every data fetch below this point stamps the resolved tenant, and the API
 * refuses anonymous requests that carry none — so resolving first is what makes
 * a single build able to serve every workspace without leaking one tenant's
 * catalogue onto another's site.
 *
 * Three outcomes, and they are genuinely different pages:
 *
 *   tenant   — a real workspace: render its storefront
 *   platform — rcm.ceez.ai itself: render the product's front door, where a new
 *              operator signs up. This host previously fell into the "unknown"
 *              branch and told every prospective customer to check their link.
 *   unknown  — a tenant-shaped hostname with nothing behind it
 */
export default function TenantBoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'resolving' | 'ready' | 'platform' | 'unknown'>(
    'resolving',
  )

  useEffect(() => {
    let cancelled = false
    resolveTenant().then((result) => {
      if (cancelled) return
      if (result.kind === 'tenant') applyTheme(result.config)
      setState(
        result.kind === 'tenant'
          ? 'ready'
          : result.kind === 'platform'
            ? 'platform'
            : 'unknown',
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'resolving') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>
        Loading…
      </div>
    )
  }

  if (state === 'platform') {
    // The front door is the front door, not every door. This branch replaced
    // children for EVERY path on the platform host, so /start — the workspace
    // signup form — rendered the marketing page instead, and choosing a plan
    // looked like it did nothing.
    //
    // Only the root is the landing page. Any other route on this host is a
    // page in its own right and renders itself; there is no tenant to resolve
    // for it, which is exactly why it lives on this host.
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      return <>{children}</>
    }
    return <PlatformLanding />
  }

  if (state === 'unknown') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
            No such workspace
          </h1>
          <p style={{ color: '#888', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            There is no rental company at this address. Check the link you were given.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
