import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * The tenant this client speaks for.
 *
 * Set at runtime once the app has resolved its workspace, so one build serves
 * every organisation. VITE_TENANT_ID remains only as a local-dev fallback for
 * scripts and tests that never call setActiveTenant.
 */
let activeTenantId: string | null = null

/** Called by the app after resolving its workspace. */
export function setActiveTenant(tenantId: string | null): void {
  activeTenantId = tenantId
}

export function getActiveTenant(): string | null {
  return activeTenantId
}

const NON_TENANT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ''])

/** True when the hostname carries a workspace label the server can resolve. */
function hostHasTenantLabel(hostname: string): boolean {
  if (NON_TENANT_HOSTS.has(hostname)) return false
  const parts = hostname.split('.')
  // acme.localtest.me / acme.rcm.ceez.ai — a label in front of the base domain.
  return parts.length >= 3
}

/**
 * The tenant id to send, or null to send no header at all.
 *
 * Order matters, and it used to be wrong. VITE_TENANT_ID was consulted BEFORE
 * the hostname, and both dev env files pin it to the seed tenant — so every
 * request made before the app finished resolving its workspace was stamped
 * with test-rental-co's id no matter which subdomain you were on. On
 * acme-iso.localtest.me the boot requests spoke for the wrong tenant entirely.
 *
 * The old fallbacks were also unusable values: it returned the SLUG, or the
 * literal string 'dev', into a header the API parses as a UUID.
 *
 * Now: a resolved workspace wins; otherwise a tenant hostname means send
 * nothing and let the server derive the tenant from Host, which is the one
 * signal a caller cannot forge and the order app/core/tenancy.py already
 * enforces. The env var survives only for plain localhost, where there is no
 * label to read.
 */
function resolveTenant(hostname: string): string | null {
  if (activeTenantId) return activeTenantId
  if (hostHasTenantLabel(hostname)) return null
  const envTenant = (import.meta as Record<string, any>).env?.VITE_TENANT_ID as string | undefined
  return envTenant ?? null
}

/**
 * Typed OpenAPI fetch client — generated types from FastAPI /openapi.json.
 * Uses httpOnly cookies for authentication (credentials: 'include').
 * Injects X-Tenant-ID header on every outbound request.
 */
export const apiClient = createClient<paths>({
  baseUrl: '/api/v1',
  credentials: 'include',  // sends httpOnly session cookie on every request
})

// Middleware: inject X-Tenant-ID on every outbound request
apiClient.use({
  onRequest({ request }) {
    const tenant = resolveTenant(window.location.hostname)
    // No header when the hostname already names the workspace. Sending one
    // anyway risks a 403: the API rejects a header that disagrees with the
    // host rather than silently preferring either.
    if (tenant) {
      request.headers.set('X-Tenant-ID', tenant)
    }
    return request
  },
  onResponse({ response }) {
    if (!response.ok) {
      const ct = response.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        return response.json().then((body: Record<string, unknown>) => {
          const err = new Error(
            typeof body?.detail === 'string' ? body.detail : response.statusText
          )
          Object.assign(err, { status: response.status, body })
          throw err
        })
      }
      // Non-JSON response (HTML error page, proxy 404, etc.)
      const err = new Error(
        response.status === 404
          ? 'API endpoint not found. Check that the backend is running.'
          : `Server error: ${response.status} ${response.statusText}`
      )
      Object.assign(err, { status: response.status })
      throw err
    }
    return response
  },
})

export type { paths }
