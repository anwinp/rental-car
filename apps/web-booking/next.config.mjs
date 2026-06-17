/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  async rewrites() {
    // Proxy /api/* to the FastAPI backend.
    // Use 127.0.0.1 explicitly to avoid IPv6 port collisions in local dev.
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000').replace('localhost', '127.0.0.1')
    return [{ source: '/api/:path*', destination: `${apiBase}/api/:path*` }]
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
  },
  transpilePackages: ['@rcm/ui', '@rcm/api-client', '@rcm/shared-types'],
}

export default nextConfig
