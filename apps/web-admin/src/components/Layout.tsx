import { tenantId } from '../tenant'
import { type ReactNode, useState, useRef, useEffect } from 'react'
import { useAdminStore } from '../store/adminStore'
import { Sidebar } from './Sidebar'
import { AdminIntelligencePanel } from './AdminIntelligencePanel'
import { useAuth } from '@rcm/ui/auth'
import { useQuery } from '@tanstack/react-query'

interface AdminLayoutProps { children: ReactNode }

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', SYSTEM_ADMIN: 'System Admin',
  REGIONAL_MANAGER: 'Regional Mgr', BRANCH_MANAGER: 'Branch Mgr',
  FLEET_MANAGER: 'Fleet Mgr', COUNTER_AGENT: 'Counter Agent',
  MAINTENANCE_TECH: 'Maintenance', CLAIMS_COORDINATOR: 'Claims',
  FINANCE_ANALYST: 'Finance', READONLY_AUDITOR: 'Auditor',
  EXECUTIVE:          'Executive',
  SENIOR_AGENT:       'Senior Agent',
}

const NOTIFS = [
  { id: '1', color: '#f47272', title: 'Damage report filed',       body: 'Ford Explorer JKL-7890 — front bumper damage', time: '5m ago',  unread: true  },
  { id: '2', color: '#8b5cf6', title: 'Reservation confirmed',     body: 'CNF-20260616-8821 via Direct Web channel',      time: '18m ago', unread: true  },
  { id: '3', color: '#fbbf24', title: 'Fleet utilization alert',   body: 'Airport location crossed 85% utilization',       time: '1h ago',  unread: false },
]

const ALERT_HEADERS = { 'X-Tenant-ID': tenantId() }

function RoleAlertStrip() {
  const { user } = useAuth()
  const role = user?.role ?? ''

  const { data: overdueData } = useQuery<unknown[]>({
    queryKey: ['alert-overdue'],
    queryFn: async () => {
      const res = await fetch('/api/v1/reservations?status=OVERDUE', { credentials: 'include', headers: ALERT_HEADERS })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      return Array.isArray(d) ? d : (d.reservations ?? d.items ?? [])
    },
    enabled: role !== 'EXECUTIVE',
    staleTime: 60_000,
  })

  const { data: vehicleData } = useQuery<{ status?: string }[]>({
    queryKey: ['alert-vehicles'],
    queryFn: async () => {
      const res = await fetch('/api/v1/fleet/vehicles', { credentials: 'include', headers: ALERT_HEADERS })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      return Array.isArray(d) ? d : (d.vehicles ?? d.items ?? [])
    },
    enabled: role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN' || role === 'BRANCH_MANAGER' || role === 'REGIONAL_MANAGER' || role === 'FLEET_MANAGER',
    staleTime: 60_000,
  })

  if (role === 'EXECUTIVE') return null

  const overdueCount = overdueData?.length ?? 0
  const totalVehicles = vehicleData?.length ?? 0
  const maintenanceCount = vehicleData?.filter(v => v.status === 'MAINTENANCE').length ?? 0
  const maintenanceAlert = totalVehicles > 0 && maintenanceCount / totalVehicles > 0.15

  const isManager = role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN' || role === 'BRANCH_MANAGER' || role === 'REGIONAL_MANAGER'
  const isAgent = role === 'COUNTER_AGENT' || role === 'SENIOR_AGENT'
  const isFleetManager = role === 'FLEET_MANAGER'

  const items: ReactNode[] = []

  if (isManager) {
    if (overdueCount > 0) {
      items.push(
        <span key="overdue" style={{ fontSize: 12, fontWeight: 600, color: '#da291c' }}>
          {overdueCount} overdue rental{overdueCount !== 1 ? 's' : ''}
        </span>
      )
    }
    if (maintenanceAlert) {
      if (items.length > 0) {
        items.push(
          <span key="sep-m" style={{ width: 1, height: 14, background: 'rgba(218,41,28,0.3)', display: 'inline-block' }} />
        )
      }
      items.push(
        <span key="maint" style={{ fontSize: 12, fontWeight: 600, color: '#da291c' }}>
          Fleet: {maintenanceCount} in maintenance
        </span>
      )
    }
  } else if (isAgent) {
    if (overdueCount > 0) {
      items.push(
        <span key="overdue" style={{ fontSize: 12, fontWeight: 600, color: '#da291c' }}>
          {overdueCount} overdue
        </span>
      )
    }
  } else if (isFleetManager) {
    if (maintenanceCount > 0) {
      items.push(
        <span key="maint" style={{ fontSize: 12, fontWeight: 600, color: '#da291c' }}>
          {maintenanceCount} vehicles in maintenance
        </span>
      )
    }
  }

  if (items.length === 0) return null

  return (
    <div style={{
      background: 'rgba(218,41,28,0.07)',
      borderBottom: '1px solid rgba(218,41,28,0.18)',
      height: 36,
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexShrink: 0,
    }}>
      {items}
    </div>
  )
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { intelligencePanelOpen, toggleIntelligencePanel, toggleCommandPalette } = useAdminStore()
  const { user, logout } = useAuth()
  const [notifOpen, setNotifOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleCommandPalette()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggleCommandPalette])

  const initials = user ? `${user.first_name[0]}${user.last_name[0]}`.toUpperCase() : '?'
  const unread = NOTIFS.filter(n => n.unread).length

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--page-bg)' }}>
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden" style={{ minWidth: 0 }}>
        {/* Header */}
        <header
          className="flex h-[54px] shrink-0 items-center gap-3 px-5"
          style={{
            background: 'rgba(13,18,32,0.8)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Search */}
          <div className="relative hidden sm:flex items-center flex-1 max-w-xs">
            <svg className="absolute left-3 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="search"
              placeholder="Search…"
              aria-label="Global search"
              className="h-8 w-full pl-8 pr-10 text-[13px] focus:outline-none transition-all"
              style={{
                background: 'var(--elevated)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-1)',
              }}
            />
            <kbd className="absolute right-2.5 pointer-events-none rounded px-1.5 py-px text-[10px] font-medium hidden sm:inline-flex items-center"
                 style={{ border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-3)' }}>⌘K</kbd>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Intelligence panel toggle */}
            <button
              onClick={toggleIntelligencePanel}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{
                color: intelligencePanelOpen ? 'var(--sb-accent)' : 'var(--text-3)',
                background: intelligencePanelOpen ? 'var(--agent-chip-bg)' : 'transparent',
              }}
              aria-label="Toggle intelligence panel"
              title="Intelligence panel"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.912a2 2 0 00-1.272 1.272L12 21l-1.912-5.816a2 2 0 00-1.272-1.272L3 12l5.816-1.912a2 2 0 001.272-1.272z"/>
              </svg>
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(v => !v); setUserOpen(false) }}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
                style={{ color: 'var(--text-3)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-1)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-3)' }}
                aria-label="Notifications"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unread > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full" style={{ background: 'var(--danger)' }} />
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-10 z-50 w-80 rounded-lg overflow-hidden"
                     style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Notifications</p>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--accent-sub)', color: 'var(--sb-accent)' }}>{unread} new</span>
                  </div>
                  <ul className="py-1">
                    {NOTIFS.map(n => (
                      <li key={n.id} className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors ${!n.unread ? 'opacity-50' : ''}`}
                          style={{ borderBottom: '1px solid var(--border-sub)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        <div className="mt-1.5 shrink-0 h-2 w-2 rounded-full" style={{ background: n.color }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>{n.title}</p>
                          <p className="text-[11.5px] mt-0.5 leading-snug truncate" style={{ color: 'var(--text-2)' }}>{n.body}</p>
                          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{n.time}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="px-4 py-2" style={{ borderTop: '1px solid var(--border)' }}>
                    <button className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>View all</button>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-5 w-px mx-1" style={{ background: 'var(--border)' }} />

            {/* User menu */}
            <div className="relative" ref={userRef}>
              <button
                onClick={() => { setUserOpen(v => !v); setNotifOpen(false) }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
                style={{ color: 'var(--text-1)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                aria-label="User menu"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                     style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                  {initials}
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-[12.5px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>{user?.first_name} {user?.last_name}</p>
                  <p className="text-[11px] leading-tight" style={{ color: 'var(--text-3)' }}>{user?.role ? (ROLE_LABELS[user.role] ?? user.role) : ''}</p>
                </div>
                <svg className="hidden md:block" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-3)' }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {userOpen && (
                <div className="absolute right-0 top-10 z-50 w-52 rounded-lg py-1 overflow-hidden"
                     style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{user?.first_name} {user?.last_name}</p>
                    <p className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { setUserOpen(false); void logout() }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] transition-colors"
                    style={{ color: 'var(--text-2)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--danger-bg)'; (e.currentTarget as HTMLElement).style.color = 'var(--danger)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-2)' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <RoleAlertStrip />

        {/* Page content */}
        <main
          id="main-content"
          className="flex-1 overflow-auto p-6 lg:p-7"
          data-compact={intelligencePanelOpen ? 'true' : undefined}
        >
          {children}
        </main>
      </div>

      <AdminIntelligencePanel />
    </div>
  )
}
