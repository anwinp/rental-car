import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useState, type FormEvent } from 'react'
import { QueryProvider } from '@rcm/ui/query'
import { AuthProvider, RouteGuard, useAuth } from '@rcm/ui/auth'
import { Toaster } from '@rcm/ui'
import { UserRole } from '@rcm/shared-types'
import { apiClient } from '@rcm/api-client'
import { AdminLayout } from './components/Layout'
import { FleetPage } from './pages/FleetPage'
import { ReservationsPage } from './pages/ReservationsPage'
import { CustomersPage } from './pages/CustomersPage'
import { PricingPage } from './pages/PricingPage'
import { ReportsPage } from './pages/ReportsPage'
import { LocationsPage } from './pages/LocationsPage'
import { FleetCalendarPage } from './pages/FleetCalendarPage'
import { ManagerDashboardPage } from './pages/ManagerDashboardPage'
import { StaffDashboardPage } from './pages/StaffDashboardPage'
import { BackOfficeDashboardPage } from './pages/BackOfficeDashboardPage'
import { TaskBoardPage } from './pages/TaskBoardPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReturnProcessingPage } from './pages/ReturnProcessingPage'
import { CounterCheckoutPage } from './pages/CounterCheckoutPage'
import { InspectionsPage } from './pages/InspectionsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { DamagePage } from './pages/DamagePage'
import { ShiftPage } from './pages/ShiftPage'
import { OverduePage } from './pages/OverduePage'
import { MaintenancePage } from './pages/MaintenancePage'
import { CorporatePage } from './pages/CorporatePage'

const ADMIN_ROLES = [
  UserRole.COUNTER_AGENT,
  UserRole.BRANCH_MANAGER,
  UserRole.REGIONAL_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.CLAIMS_COORDINATOR,
  UserRole.FINANCE_ANALYST,
  UserRole.READONLY_AUDITOR,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.MAINTENANCE_TECH,
]


function EyeIcon({ off }: { off?: boolean }) {
  return off ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: apiError } = await (apiClient as any).POST('/auth/login', {
        body: { email, password, app_context: 'web-admin' },
      })
      if (apiError || !data) {
        setError(typeof apiError === 'string' ? apiError : 'Invalid email or password')
        return
      }
      setUser(data)
      if (data.role === 'COUNTER_AGENT') {
        navigate('/checkout', { replace: true })
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div
        className="hidden lg:flex w-5/12 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(160deg, #1e1b4b 0%, #312e81 40%, #0f172a 100%)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
              <circle cx="7" cy="17" r="2"/>
              <circle cx="17" cy="17" r="2"/>
            </svg>
          </div>
          <span className="text-lg font-bold text-white tracking-tight">RCM</span>
        </div>

        {/* Main copy */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-white leading-tight">
              Fleet management built for modern operations
            </h1>
            <p className="mt-4 text-base text-indigo-200 leading-relaxed">
              Manage your entire rental fleet from a single command center — real-time visibility, automated billing, and multi-location operations.
            </p>
          </div>

          <ul className="space-y-3">
            {[
              'Real-time fleet visibility across all locations',
              'Automated billing, payments & invoicing',
              'Multi-location operations & reporting',
            ].map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-indigo-100">
                <svg className="mt-0.5 shrink-0 text-indigo-400" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p className="text-xs text-indigo-400">
          © {new Date().getFullYear()} RCM · Enterprise Fleet Management
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12" style={{ background: 'var(--page-bg)' }}>
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--accent)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h10l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
                <circle cx="7" cy="17" r="2"/>
                <circle cx="17" cy="17" r="2"/>
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>RCM Admin</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Welcome back</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-3)' }}>Sign in to your administrator account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field-input w-full px-3.5 py-2.5 text-sm"
                placeholder="admin@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input w-full px-3.5 py-2.5 pr-10 text-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--text-3)' }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg px-3.5 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                <svg className="mt-0.5 shrink-0" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--danger)' }}>
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && (
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>
            Need access? Contact your system administrator.
          </p>
        </div>
      </div>
    </div>
  )
}


function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center" style={{ background: 'var(--page-bg)' }}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full mb-4" style={{ background: 'var(--danger-bg)' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--danger)' }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </div>
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>Access Denied</h1>
      <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--text-3)' }}>
        Your account doesn't have permission to view this page. Contact your administrator if this is incorrect.
      </p>
      <a href="/login" className="mt-6 text-sm font-medium underline underline-offset-4" style={{ color: 'var(--accent)' }}>
        Sign in with a different account
      </a>
    </div>
  )
}

export default function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:rounded-lg" style={{ background: 'var(--card-bg)', color: 'var(--text-1)', border: '1px solid var(--border)' }}>
            Skip to content
          </a>

          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

            <Route
              path="/*"
              element={
                <RouteGuard roles={ADMIN_ROLES} redirectTo="/login">
                  <AdminLayout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<ManagerDashboardPage />} />
                      <Route path="/staff" element={<StaffDashboardPage />} />
                      <Route path="/back-office" element={<BackOfficeDashboardPage />} />
                      <Route path="/tasks" element={<TaskBoardPage />} />
                      <Route path="/fleet" element={<FleetPage />} />
                      <Route path="/fleet-calendar" element={<FleetCalendarPage />} />
                      <Route path="/locations" element={<LocationsPage />} />
                      <Route path="/reservations" element={<ReservationsPage />} />
                      <Route path="/customers" element={<CustomersPage />} />
                      <Route path="/checkout" element={<CounterCheckoutPage />} />
                      <Route path="/returns" element={<ReturnProcessingPage />} />
                      <Route path="/inspections" element={<InspectionsPage />} />
                      <Route path="/payments" element={<PaymentsPage />} />
                      <Route path="/damage" element={<DamagePage />} />
                      <Route path="/shift" element={<ShiftPage />} />
                      <Route path="/overdue" element={<OverduePage />} />
                      <Route path="/maintenance" element={<MaintenancePage />} />
                      <Route path="/corporate" element={<CorporatePage />} />
                      <Route
                        path="/pricing"
                        element={
                          <RouteGuard roles={[UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]} redirectTo="/unauthorized">
                            <PricingPage />
                          </RouteGuard>
                        }
                      />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route
                        path="/settings"
                        element={
                          <RouteGuard roles={[UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]} redirectTo="/unauthorized">
                            <SettingsPage />
                          </RouteGuard>
                        }
                      />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </AdminLayout>
                </RouteGuard>
              }
            />
          </Routes>

          <Toaster />
        </BrowserRouter>
      </AuthProvider>
    </QueryProvider>
  )
}
