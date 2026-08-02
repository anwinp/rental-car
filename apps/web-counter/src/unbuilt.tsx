import type { ReactNode } from 'react'

/**
 * Gate for screens that render invented data.
 *
 * Four pages display hardcoded arrays as if they were the tenant's records:
 * Reports (revenue and utilisation), Corporate (accounts and invoices), and the
 * counter app's Overdue and Shift. They are not partly built — they never call
 * the API at all, and every tenant sees the identical fabricated numbers.
 *
 * That is worse than a missing feature. An operator deciding whether to buy
 * another car, based on revenue figures this product invented, has been misled
 * by us. So they are hidden by default and only reachable when someone
 * deliberately sets the flag.
 *
 * The stated risk of a flag is that it gets forgotten and someone eventually
 * turns it on. Two things guard against that: the flag is off unless explicitly
 * set, and when it is on, every gated screen carries a banner saying the data is
 * not real. A demo can proceed; a customer cannot be quietly deceived.
 */
export const SHOW_UNBUILT: boolean =
  String((import.meta as Record<string, any>).env?.VITE_SHOW_UNBUILT ?? '')
    .toLowerCase() === 'true'

/**
 * Wraps a fabricated page. Renders nothing when the flag is off, so the route
 * falls through to the catch-all redirect rather than showing a broken shell.
 */
export function Unbuilt({ children }: { children: ReactNode }) {
  if (!SHOW_UNBUILT) return null
  return (
    <>
      <div
        role="alert"
        style={{
          margin: '16px 16px 0',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid rgba(245,158,11,0.35)',
          background: 'rgba(245,158,11,0.12)',
          color: '#fbbf24',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Demo screen — the figures below are placeholders, not your data. This
        page is not connected to the API.
      </div>
      {children}
    </>
  )
}
