/**
 * Turn any error response from the API into something worth showing a person.
 *
 * Pages were written expecting `{ detail: string }`, which is what the API
 * returns for a deliberate rejection — "Short code 'JFK01' is already in use".
 * FastAPI's validation errors are not that shape: `detail` is an array of
 * objects, one per field. Passing it to `new Error(...)` produced the message
 * "[object Object]", so the most common failure — a field the form let through
 * that the API rejects — was the least legible one on screen.
 *
 * Reads the array back as "field: message", which is what the person filling
 * in the form actually needs to know.
 */
interface ValidationItem {
  loc?: (string | number)[]
  msg?: string
}

export function describeApiError(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail

  if (typeof detail === 'string' && detail.trim()) return detail

  if (Array.isArray(detail)) {
    const parts = (detail as ValidationItem[])
      .map((item) => {
        const msg = item?.msg
        if (!msg) return null
        // loc is ["body", "short_code"] — the field is the last element, and
        // the "body"/"query" prefix is noise to whoever is filling the form.
        const field = Array.isArray(item.loc)
          ? item.loc.filter((p) => p !== 'body' && p !== 'query').join('.')
          : ''
        return field ? `${field}: ${msg}` : msg
      })
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }

  if (status === 401) return 'Your session has expired. Sign in again.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 402) return 'That is not included in your plan.'
  if (status >= 500) return 'The server could not complete that. Please try again.'
  return `That did not work (error ${status}).`
}

/** Read a failed Response and throw an Error carrying a readable message. */
export async function throwApiError(res: Response): Promise<never> {
  const body = await res.json().catch(() => null)
  throw new Error(describeApiError(body, res.status))
}
