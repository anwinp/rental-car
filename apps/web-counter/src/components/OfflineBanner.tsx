import { useEffect, useState } from 'react'

/**
 * OFFLINE banner — non-dismissible, appears at top of viewport.
 * Listens to navigator.onLine events AND service worker messages.
 * Automatically disappears when connectivity is restored.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setOffline(false)
    const handleOffline = () => setOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Also listen for service worker NETWORK_STATUS messages (more reliable in some browsers)
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NETWORK_STATUS') {
        setOffline(!event.data.online)
      }
    }

    navigator.serviceWorker?.addEventListener('message', handleSWMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-red-600 px-4 py-2.5 text-sm font-bold text-white"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M1 1l22 22" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      OFFLINE — Actions will sync when connection restores
    </div>
  )
}
