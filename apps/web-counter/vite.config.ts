import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      manifest: {
        name: 'RCM Counter',
        short_name: 'Counter',
        description: 'Rental Car Manager Counter Agent App',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    port: 3001,
    // Bind every interface, not just loopback. Without this Vite listened on
    // [::1] alone, so http://acme.localtest.me:3001 refused the connection —
    // and the counter app was the only one of the three that could not be
    // reached on a workspace hostname, which is how tenants are told apart.
    host: true,
    // Vite blocks unknown Host headers by default; the workspace label varies
    // per tenant, so the whole suffix has to be allowed.
    allowedHosts: ['.localtest.me', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        // 127.0.0.1 (not localhost) so it never resolves to an IPv6 listener
        // ahead of the local Uvicorn — e.g. a Docker-forwarded :8000 port.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
      exclude: ['src/schema.d.ts', '**/*.stories.tsx', 'src/test-setup.ts', 'src/service-worker.ts'],
    },
  },
})
