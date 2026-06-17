/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    // Proxy /api/v1/* to the FastAPI backend.
    // /api/auth/* (Next.js route handlers) are intentionally excluded.
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace('localhost', '127.0.0.1')
    return [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.rcm.app',
      },
      {
        protocol: 'https',
        hostname: 'rcm-*.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'rcm-*.s3.us-east-1.amazonaws.com',
      },
    ],
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000',
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3400',
  },
  transpilePackages: ['@rcm/ui', '@rcm/api-client', '@rcm/shared-types'],
}

export default nextConfig
