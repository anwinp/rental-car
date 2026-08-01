'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { resolveTenant, currentSlug } from '../lib/tenant'

/**
 * Resolves the workspace from the hostname before the app renders.
 *
 * Every data fetch below this point stamps the resolved tenant, and the API
 * refuses anonymous requests that carry none — so resolving first is what makes
 * a single build able to serve every workspace without leaking one tenant's
 * catalogue onto another's site.
 */
export default function TenantBoot({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'resolving' | 'ready' | 'unknown'>('resolving')

  useEffect(() => {
    if (!currentSlug()) {
      // No tenant label in the hostname (plain localhost). Render anyway: the
      // API will refuse tenant-scoped reads, which surfaces as empty results
      // rather than another tenant's data.
      setState('ready')
      return
    }
    let cancelled = false
    resolveTenant().then((tenant) => {
      if (!cancelled) setState(tenant ? 'ready' : 'unknown')
    })
    return () => { cancelled = true }
  }, [])

  if (state === 'resolving') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>
        Loading…
      </div>
    )
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
