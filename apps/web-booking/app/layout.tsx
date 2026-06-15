import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'RCM — Rental Car Booking',
    template: '%s | RCM',
  },
  description: 'Search, compare, and book rental cars online. Fast and easy.',
  openGraph: {
    type: 'website',
    siteName: 'RCM Rentals',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:rounded focus:shadow-md"
        >
          Skip to content
        </a>
        <main id="main-content">
          {children}
        </main>
      </body>
    </html>
  )
}
