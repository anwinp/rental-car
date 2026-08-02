'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Hides the renter-facing chrome on pages that are not the storefront.
 *
 * The root layout wraps every route in the booking site's navigation, footer
 * and concierge chat. That is right for somebody browsing cars and wrong for
 * somebody creating a company workspace: /start rendered under a "Reserve /
 * Experience / Locations" bar with a "Create account" button that means a
 * renter account, not theirs.
 *
 * Keyed on the path rather than the resolved host, so the chrome is correct on
 * first paint instead of appearing and then disappearing once resolution
 * finishes.
 */
const BARE_PREFIXES = ['/start']

export function StorefrontOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/'
  if (BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null
  }
  return <>{children}</>
}
