'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { resolveTenant } from '../lib/tenant'
import PlatformLanding from './PlatformLanding'

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
