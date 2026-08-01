import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5173,
    // Bind all interfaces and accept tenant subdomains. Each workspace is
    // reached at {slug}.localtest.me:3002 locally, which Vite would otherwise
    // reject as an unrecognised Host.
    host: true,
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
      exclude: ['src/schema.d.ts', '**/*.stories.tsx', 'src/test-setup.ts'],
    },
  },
})
