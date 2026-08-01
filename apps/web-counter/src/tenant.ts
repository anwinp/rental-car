/**
 * Runtime tenant resolution.
 *
 * The tenant used to be a constant compiled into this bundle, which meant one
 * build per organisation — not a SaaS. It is now resolved at runtime, so a
 * single build serves every workspace.
 *
 * Resolution order:
 *   1. Hostname label   acme.rcm.app -> "acme"        (production shape)
 *   2. ?workspace=acme  query string                   (shareable links)
 *   3. localStorage     whatever was last signed into  (local dev on
 *                       localhost:3002, which has no tenant label to read)
 *
 * The slug is only ever a hint for *which* workspace to ask about. The server
 * resolves it to a tenant id and, once signed in, the tenant in the session
 * cookie is authoritative — a tampered slug cannot widen access.
 */

import { setActiveTenant } from '@rcm/api-client'

export interface TenantConfig {
  tenant_id: string
  slug: string
  display_name: string
  status: string
  currency: string
  timezone: string
  logo_url: string | null
}

const STORAGE_KEY = 'rcm.counter.workspace'

/** Hosts that never carry a tenant label. */
const NON_TENANT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ''])

export function slugFromHostname(host = window.location.hostname): string | null {
  if (NON_TENANT_HOSTS.has(host)) return null
  const parts = host.split('.')
  // Needs at least label.domain — a bare apex has no tenant.
  if (parts.length < 2) return null
  if (parts.length === 2 && (parts[1] === 'localtest' || parts[1] === 'local')) {
    return parts[0] || null
  }
  if (parts.length < 3) return null
  return parts[0] || null
}

export function storedSlug(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function rememberSlug(slug: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, slug)
  } catch {
    /* private browsing — resolution falls back to the hostname */
  }
}

export function forgetSlug(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function currentSlug(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('workspace')
  return slugFromHostname() ?? fromQuery ?? storedSlug()
}

/** Ask the server which workspace this is. Null when there is no such slug. */
export async function fetchTenantConfig(slug: string): Promise<TenantConfig | null> {
  try {
    const res = await fetch(
      `/api/v1/public/tenant-config?slug=${encodeURIComponent(slug)}`,
    )
    if (!res.ok) return null
    return (await res.json()) as TenantConfig
  } catch {
    return null
  }
}

let cached: TenantConfig | null = null

export function cachedTenant(): TenantConfig | null {
  return cached
}

export function setCachedTenant(config: TenantConfig | null): void {
  cached = config
  if (config) rememberSlug(config.slug)
  // Synchronous on purpose: the very next call is usually the sign-in request,
  // and a deferred update would let it go out stamped with the previous tenant.
  setActiveTenant(config?.tenant_id ?? null)
}

/** Resolve the active workspace, using the cache when already known. */
export async function resolveTenant(): Promise<TenantConfig | null> {
  if (cached) return cached
  const slug = currentSlug()
  if (!slug) return null
  const config = await fetchTenantConfig(slug)
  if (config) setCachedTenant(config)
  return config
}

/**
 * Headers for API calls.
 *
 * Once a session exists the server takes the tenant from the signed cookie and
 * rejects a header that disagrees, so this matters mainly for sign-in and for
 * anonymous reads.
 */
export function tenantHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (cached?.tenant_id) headers['X-Tenant-ID'] = cached.tenant_id
  return headers
}

/**
 * The resolved tenant id, or '' before resolution completes.
 *
 * Call sites use this where a build-time constant used to sit. TenantBoot
 * resolves before the tree renders, so by the time a page fetches, this is
 * populated.
 */
export function tenantId(): string {
  return cached?.tenant_id ?? ''
}
