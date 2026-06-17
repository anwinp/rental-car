import { NavLink } from 'react-router-dom'
import { useAdminStore } from '../store/adminStore'
import { useAuth } from '@rcm/ui/auth'
import { UserRole } from '@rcm/shared-types'

/* ── Icons ── */
const Ic = {
  Grid: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  Car: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
      <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
      <line x1="10" y1="17" x2="14" y2="17"/>
    </svg>
  ),
  Calendar: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  Users: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Tag: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  Chart: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  ),
  MapPin: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  Gantt: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
      <rect x="3" y="4" width="8" height="4" rx="1" fill="currentColor" stroke="none" opacity=".4"/>
      <rect x="8" y="10" width="10" height="4" rx="1" fill="currentColor" stroke="none" opacity=".4"/>
      <rect x="5" y="16" width="6" height="4" rx="1" fill="currentColor" stroke="none" opacity=".4"/>
    </svg>
  ),
  CheckList: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <polyline points="9 11 12 14 22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  ),
  Wrench: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  ),
  Clipboard: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>
    </svg>
  ),
  Gear: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  ChevronLeft: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  ReturnKey: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 10l-5 5 5 5"/><path d="M4 15h11a4 4 0 0 0 0-8h-1"/>
    </svg>
  ),
  Counter: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
    </svg>
  ),
  SignOut: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
}

const ADMIN  =[UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]
const MANAGE = [UserRole.BRANCH_MANAGER, UserRole.REGIONAL_MANAGER, UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN, UserRole.CLAIMS_COORDINATOR, UserRole.READONLY_AUDITOR]
const FLEET  = [...MANAGE, UserRole.FLEET_MANAGER, UserRole.MAINTENANCE_TECH]
const REPORT = [...MANAGE, UserRole.FINANCE_ANALYST]
const STAFF  = [...FLEET, UserRole.COUNTER_AGENT]

const GROUPS = [
  { label: 'Dashboards', items: [
    { label: 'Overview',      href: '/dashboard',    roles: MANAGE, icon: <Ic.Grid /> },
    { label: 'Operations',    href: '/staff',        roles: STAFF,  icon: <Ic.Clipboard /> },
    { label: 'Back Office',   href: '/back-office',  roles: FLEET,  icon: <Ic.Wrench /> },
    { label: 'Task Board',    href: '/tasks',        roles: STAFF,  icon: <Ic.CheckList /> },
  ]},
  { label: 'Fleet', items: [
    { label: 'Vehicles',       href: '/fleet',          roles: FLEET,  icon: <Ic.Car /> },
    { label: 'Fleet Calendar', href: '/fleet-calendar', roles: FLEET,  icon: <Ic.Gantt /> },
    { label: 'Locations',      href: '/locations',      roles: FLEET,  icon: <Ic.MapPin /> },
  ]},
  { label: 'Bookings', items: [
    { label: 'Reservations',   href: '/reservations', roles: MANAGE, icon: <Ic.Calendar /> },
    { label: 'Customers',      href: '/customers',    roles: MANAGE, icon: <Ic.Users /> },
    { label: 'Counter Checkout', href: '/checkout',   roles: STAFF,  icon: <Ic.Counter /> },
    { label: 'Process Return', href: '/returns',      roles: STAFF,  icon: <Ic.ReturnKey /> },
  ]},
  { label: 'Analytics', items: [
    { label: 'Pricing',      href: '/pricing',      roles: ADMIN,  icon: <Ic.Tag /> },
    { label: 'Reports',      href: '/reports',      roles: REPORT, icon: <Ic.Chart /> },
  ]},
  { label: 'System', items: [
    { label: 'Settings',     href: '/settings',     roles: ADMIN,  icon: <Ic.Gear /> },
  ]},
]

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', SYSTEM_ADMIN: 'System Admin',
  REGIONAL_MANAGER: 'Regional Manager', BRANCH_MANAGER: 'Branch Manager',
  FLEET_MANAGER: 'Fleet Manager', COUNTER_AGENT: 'Counter Agent',
  MAINTENANCE_TECH: 'Maintenance', CLAIMS_COORDINATOR: 'Claims Coord.',
  FINANCE_ANALYST: 'Finance Analyst', READONLY_AUDITOR: 'Auditor',
}

export function Sidebar() {
  const { sidebarCollapsed: col, toggleSidebar } = useAdminStore()
  const { user, logout } = useAuth()
  const roles = user?.roles ?? []
  const initials = user ? `${user.first_name[0]}${user.last_name[0]}` : '?'

  const W = col ? 60 : 220

  return (
    <aside
      className="flex h-screen flex-col shrink-0"
      style={{
        width: W, minWidth: W,
        background: 'var(--sb-bg)',
        borderRight: '1px solid var(--sb-border)',
        transition: 'width 200ms cubic-bezier(.4,0,.2,1), min-width 200ms cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
      }}
    >
      {/* Brand */}
      <div className="flex h-14 items-center shrink-0 px-3" style={{ borderBottom: '1px solid var(--sb-border)' }}>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded" style={{ background: '#4f46e5' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
            <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
          </svg>
        </div>
        {!col && (
          <span className="ml-2.5 text-[14px] font-semibold tracking-tight text-white truncate">RCM</span>
        )}
        <button
          onClick={toggleSidebar}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors"
          style={{ color: 'var(--sb-fg)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--sb-hover)'; (e.currentTarget as HTMLElement).style.color = 'white' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--sb-fg)' }}
          aria-label={col ? 'Expand' : 'Collapse'}
        >
          {col ? <Ic.ChevronRight /> : <Ic.ChevronLeft />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">
        {GROUPS.map((group, gi) => {
          const visible = group.items.filter(i => i.roles.some(r => roles.includes(r)))
          if (!visible.length) return null
          return (
            <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
              {group.label && !col && (
                <p className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-widest"
                   style={{ color: 'var(--sb-sect)' }}>
                  {group.label}
                </p>
              )}
              {group.label && col && (
                <div className="my-1.5 mx-2 h-px" style={{ background: 'var(--sb-border)' }} />
              )}
              <ul className="space-y-0.5">
                {visible.map(item => (
                  <li key={item.href}>
                    <NavLink
                      to={item.href}
                      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                      title={col ? item.label : undefined}
                      style={{ justifyContent: col ? 'center' : undefined }}
                    >
                      {item.icon}
                      {!col && item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* User */}
      <div className="shrink-0 p-2" style={{ borderTop: '1px solid var(--sb-border)' }}>
        {!col && user && (
          <div className="mb-1 flex items-center gap-2.5 rounded-md px-2 py-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                 style={{ background: '#4f46e5' }}>
              {initials.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium leading-tight text-white">{user.first_name} {user.last_name}</p>
              <p className="truncate text-[11px] leading-tight" style={{ color: 'var(--sb-fg)' }}>
                {user.role ? (ROLE_LABEL[user.role] ?? user.role) : ''}
              </p>
            </div>
          </div>
        )}
        {col && user && (
          <div className="mb-1 flex justify-center py-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                 style={{ background: '#4f46e5' }}
                 title={`${user.first_name} ${user.last_name}`}>
              {initials.toUpperCase()}
            </div>
          </div>
        )}
        <button
          onClick={() => void logout()}
          className="nav-item w-full"
          style={{ justifyContent: col ? 'center' : undefined }}
          title={col ? 'Sign out' : undefined}
        >
          <Ic.SignOut />
          {!col && 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
