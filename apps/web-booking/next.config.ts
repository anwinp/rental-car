import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // App Router is the default in Next.js 14
  experimental: {
    typedRoutes: true,
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
  // Transpile local packages
  transpilePackages: ['@rcm/ui', '@rcm/api-client', '@rcm/shared-types'],
}

export default nextConfig
