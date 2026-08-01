'use client'

/**
 * Runtime tenant resolution for the customer booking site.
 *
 * The tenant used to be a build-time constant (NEXT_PUBLIC_TENANT_ID), which
 * meant one deployment per organisation. It is now read from the hostname the
 * visitor is already on, so a single build serves every workspace:
 *
 *   acme.rcm.app        -> "acme"
 *   acme.localtest.me   -> "acme"   (local dev; *.localtest.me -> 127.0.0.1)
 *
 * Unlike the admin app there is no sign-in here, so the hostname is the only
 * signal — which is precisely why the server treats it as authoritative for
 * anonymous requests and refuses to fall back to some default tenant.
 */

export interface TenantConfig {
  tenant_id: string
  slug: string
  display_name: string
  status: string
  currency: string
  timezone: string
  logo_url: string | null
  booking_url?: string | null
  admin_url?: string | null
}

const NON_TENANT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ''])

export function slugFromHostname(host?: string): string | null {
  const hostname = host ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  if (NON_TENANT_HOSTS.has(hostname)) return null
  const parts = hostname.split('.')
  if (parts.length < 2) return null
  // acme.localtest.me and acme.rcm.app both put the slug first.
  if (parts.length === 2 && (parts[1] === 'localtest' || parts[1] === 'local')) {
    return parts[0] || null
  }
  if (parts.length < 3) return null
  return parts[0] || null
}

export function currentSlug(): string | null {
  if (typeof window === 'undefined') return null
  const fromQuery = new URLSearchParams(window.location.search).get('workspace')
  return slugFromHostname() ?? fromQuery
}

let cached: TenantConfig | null = null
let inflight: Promise<TenantConfig | null> | null = null

export function cachedTenant(): TenantConfig | null {
  return cached
}

/**
 * Resolve the workspace this page is serving.
 *
 * De-duplicated: several components mount at once on the landing page and would
 * otherwise each fire the same lookup.
 */
export async function resolveTenant(): Promise<TenantConfig | null> {
  if (cached) return cached
  if (inflight) return inflight

  const slug = currentSlug()
  if (!slug) return null

  inflight = (async () => {
    try {
      const res = await fetch(`/api/v1/public/tenant-config?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) return null
      cached = (await res.json()) as TenantConfig
      return cached
    } catch {
      return null
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Tenant header for anonymous API calls. Empty until resolution completes. */
export function tenantHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  if (cached?.tenant_id) headers['X-Tenant-ID'] = cached.tenant_id
  return headers
}

/**
 * The resolved tenant id, or '' before resolution completes.
 *
 * Call sites use this in place of the build-time constant they used to hold.
 * TenantBoot (app/components/TenantBoot.tsx) resolves before the tree renders,
 * so by the time a component fetches, this is populated.
 */
export function tenantId(): string {
  return cached?.tenant_id ?? ''
}
