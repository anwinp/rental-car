'use client'

import type { ReactNode } from 'react'
import { QueryProvider } from '@rcm/ui/query'
import { AuthProvider } from '@rcm/ui/auth'
import { Toaster } from '@rcm/ui'
import { AgentProvider } from './components/agent/AgentProvider'

/**
 * Client-side providers wrapper for Next.js App Router.
 * AgentProvider wraps AuthProvider so the agent context is available to
 * unauthenticated guests browsing before they log in.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AgentProvider>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </AgentProvider>
    </QueryProvider>
  )
}
