import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * Resolves the tenant slug from the current hostname.
 * e.g. acme.rcm.app → "acme", localhost → "dev"
 */
function resolveTenantFromHostname(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length >= 3 ? parts[0] : 'dev'
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
    const tenant = resolveTenantFromHostname(window.location.hostname)
    request.headers.set('X-Tenant-ID', tenant)
    return request
  },
  onResponse({ response }) {
    // Bubble RFC 7807 problem details as thrown Error objects for TanStack Query to catch
    if (!response.ok) {
      return response.json().then((body: Record<string, unknown>) => {
        const err = new Error(
          typeof body?.detail === 'string' ? body.detail : response.statusText
        )
        Object.assign(err, { status: response.status, body })
        throw err
      })
    }
    return response
  },
})

export type { paths }
