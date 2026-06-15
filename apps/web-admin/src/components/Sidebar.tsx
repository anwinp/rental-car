import { NavLink } from 'react-router-dom'
import { useAdminStore } from '../store/adminStore'
import { useAuth } from '@rcm/ui/auth'
import { UserRole } from '@rcm/shared-types'
import { Button } from '@rcm/ui'
import { cn } from '@rcm/ui'

interface NavItem {
  label: string
  href: string
  roles: UserRole[]
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Fleet',
    href: '/fleet',
    roles: [UserRole.FLEET_MANAGER, UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="1" y="3" width="15" height="13" rx="2"/>
        <path d="M16 8h4l3 3v4h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
  },
  {
    label: 'Reservations',
    href: '/reservations',
    roles: [UserRole.COUNTER_AGENT, UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    label: 'Customers',
    href: '/customers',
    roles: [UserRole.COUNTER_AGENT, UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    label: 'Pricing',
    href: '/pricing',
    roles: [UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
  },
  {
    label: 'Reports',
    href: '/reports',
    roles: [UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.FINANCE_ANALYST, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
  },
  {
    label: 'Settings',
    href: '/settings',
    roles: [UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M20.49 12H22M2 12H.49M19.07 19.07l-1.41-1.41M5.34 5.34L3.93 3.93M12 22v-1.51M12 3.51V2"/>
      </svg>
    ),
  },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAdminStore()
  const { user, logout } = useAuth()

  const userRoles = user?.roles ?? []

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.roles.some((role) => userRoles.includes(role))
  )

  return (
    <aside
      aria-label="Admin navigation"
      className={cn(
        'flex h-screen flex-col border-r bg-card transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo / Brand */}
      <div className="flex h-16 items-center border-b px-4">
        {!sidebarCollapsed && (
          <span className="text-lg font-bold tracking-tight">RCM Admin</span>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted',
            sidebarCollapsed ? 'mx-auto' : 'ml-auto'
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {sidebarCollapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-2">
          {visibleItems.map((item) => (
            <li key={item.href}>
              <NavLink
                to={item.href}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[44px]',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )
                }
                title={sidebarCollapsed ? item.label : undefined}
              >
                {item.icon}
                {!sidebarCollapsed && item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* User section */}
      <div className="border-t p-2">
        {!sidebarCollapsed && user && (
          <div className="mb-2 px-3 py-2">
            <p className="text-sm font-medium truncate">
              {user.first_name} {user.last_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => logout()}
          className={cn(
            'w-full text-muted-foreground hover:text-foreground',
            sidebarCollapsed ? 'justify-center px-0' : 'justify-start'
          )}
          title={sidebarCollapsed ? 'Sign out' : undefined}
          aria-label="Sign out"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {!sidebarCollapsed && <span className="ml-2">Sign Out</span>}
        </Button>
      </div>
    </aside>
  )
}
