'use client'

import type { ReactNode } from 'react'
import { QueryProvider } from '@rcm/ui/query'
import { AuthProvider } from '@rcm/ui/auth'
import { Toaster } from '@rcm/ui'

/**
 * Client-side providers wrapper for Next.js App Router.
 * Wraps the server layout's children in client-required context providers.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </QueryProvider>
  )
}
