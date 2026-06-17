import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * Resolves the tenant identifier from env var (dev) or hostname (production).
 * e.g. acme.rcm.app → "acme"; localhost with VITE_TENANT_ID → that UUID
 */
function resolveTenant(hostname: string): string {
  // Allow override via env var — used in local dev where there's no subdomain
  const envTenant = (import.meta as Record<string, any>).env?.VITE_TENANT_ID as string | undefined
  if (envTenant) return envTenant
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
    const tenant = resolveTenant(window.location.hostname)
    request.headers.set('X-Tenant-ID', tenant)
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
