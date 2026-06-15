import { type ReactNode } from 'react'
import { useAdminStore } from '../store/adminStore'
import { Sidebar } from './Sidebar'
import { useAuth } from '@rcm/ui/auth'
import { cn } from '@rcm/ui'

interface AdminLayoutProps {
  children: ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { sidebarCollapsed } = useAdminStore()
  const { user } = useAuth()

  return (
    <div
      className={cn(
        'grid h-screen bg-background',
        sidebarCollapsed ? 'grid-cols-[64px_1fr]' : 'grid-cols-[240px_1fr]'
      )}
    >
      <Sidebar />
      <div className="flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-6">
          <div />
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {user?.tenant_id && (
                <span className="mr-2 rounded bg-muted px-2 py-1 text-xs font-medium">
                  {user.tenant_id}
                </span>
              )}
              {user?.first_name} {user?.last_name}
            </span>
          </div>
        </header>

        {/* Main content */}
        <main
          id="main-content"
          className="flex-1 overflow-auto p-6"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
