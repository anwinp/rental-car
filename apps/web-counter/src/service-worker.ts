/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { BackgroundSyncPlugin } from 'workbox-background-sync'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

// Precache all static assets (manifest injected by vite-plugin-pwa)
precacheAndRoute(self.__WB_MANIFEST)

// Background sync plugin — retries for up to 24 hours
const bgSyncPlugin = new BackgroundSyncPlugin('offline-write-queue', {
  maxRetentionTime: 24 * 60, // 24 hours in minutes
})

// POST /checkout — queue when offline, sync when reconnected
registerRoute(
  ({ request, url }: { request: Request; url: URL }) =>
    request.method === 'POST' && url.pathname.includes('/checkout'),
  new NetworkFirst({
    networkTimeoutSeconds: 3,
    plugins: [bgSyncPlugin],
    cacheName: 'checkout-cache',
  })
)

// POST /check-in — same offline background sync queue
registerRoute(
  ({ request, url }: { request: Request; url: URL }) =>
    request.method === 'POST' && url.pathname.includes('/check-in'),
  new NetworkFirst({
    networkTimeoutSeconds: 3,
    plugins: [bgSyncPlugin],
    cacheName: 'checkin-cache',
  })
)

// GET /api/* — NetworkFirst with 3s timeout, falls back to cache
registerRoute(
  ({ url }: { url: URL }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 3,
    plugins: [],
  })
)

// Static assets (JS, CSS, fonts, images) — CacheFirst
registerRoute(
  ({ request }: { request: Request }) =>
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image',
  new CacheFirst({
    cacheName: 'static-assets',
    plugins: [],
  })
)

// Notify clients of connectivity status changes
self.addEventListener('online' as 'message', () => {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'NETWORK_STATUS', online: true })
    })
  })
})

self.addEventListener('offline' as 'message', () => {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'NETWORK_STATUS', online: false })
    })
  })
})
