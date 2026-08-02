import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { Providers } from './providers'
import { AgentChatPanel } from './components/agent/AgentChatPanel'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'RCM — Rental Cars', template: '%s | RCM Rentals' },
  description: 'Search, compare, and book rental cars online. Fast, transparent pricing.',
  openGraph: { type: 'website', siteName: 'RCM Rentals' },
}

import TenantBoot from './components/TenantBoot'
import { StorefrontOnly } from './components/StorefrontOnly'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <TenantBoot><Providers>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          >
            Skip to main content
          </a>
          <div style={{ display: 'flex', minHeight: '100vh' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <StorefrontOnly><Navbar /></StorefrontOnly>
              <main id="main-content" style={{ flex: 1 }}>
                {children}
              </main>
              <StorefrontOnly><Footer /></StorefrontOnly>
            </div>
          </div>
          {/* Chat panel renders as fixed overlay — does not affect flex layout */}
          <StorefrontOnly><AgentChatPanel /></StorefrontOnly>
        </Providers>
      </TenantBoot>
      </body>
    </html>
  )
}
