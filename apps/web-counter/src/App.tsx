import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { RouteGuard } from '@rcm/ui/auth'
import { QueryProvider } from '@rcm/ui/query'
import { AuthProvider } from '@rcm/ui/auth'
import { UserRole } from '@rcm/shared-types'
import { OfflineBanner } from './components/OfflineBanner'
import { CheckoutPage } from './pages/CheckoutPage'
import { CheckInPage } from './pages/CheckInPage'
import { ShiftPage } from './pages/ShiftPage'
import { OverduePage } from './pages/OverduePage'
import { useCounterStore, selectOfflineQueueCount } from './store/counterStore'

const COUNTER_ROLES = [
  UserRole.COUNTER_AGENT,
  UserRole.BRANCH_MANAGER,
  UserRole.REGIONAL_MANAGER,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
]

function LoginPage() {
  // No login here — authentication happens at the admin app.
  // Redirect there and it will send the user back after login.
  window.location.replace('http://localhost:3002/login')
  return null
}

function Dashboard() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Counter Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Select an action from the navigation menu.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Checkout', href: '/checkout', color: 'bg-blue-50 text-blue-700' },
          { label: 'Check-In', href: '/check-in', color: 'bg-green-50 text-green-700' },
          { label: 'Overdue', href: '/overdue', color: 'bg-amber-50 text-amber-700' },
          { label: 'Shift', href: '/shift', color: 'bg-purple-50 text-purple-700' },
        ].map(({ label, href, color }) => (
          <a
            key={label}
            href={href}
            className={`flex min-h-[80px] items-center justify-center rounded-xl border font-semibold text-lg ${color} hover:opacity-80 transition-opacity`}
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  )
}

function NavBar() {
  const offlineQueueCount = useCounterStore(selectOfflineQueueCount)

  const navItems = [
    { to: '/', label: 'Dashboard', exact: true },
    { to: '/checkout', label: 'Checkout' },
    { to: '/check-in', label: 'Check-In' },
    { to: '/overdue', label: 'Overdue' },
    { to: '/shift', label: 'Shift' },
  ]

  return (
    <nav
      aria-label="Counter navigation"
      className="flex items-center gap-1 border-b bg-card px-4 py-2 overflow-x-auto"
    >
      {navItems.map(({ to, label, exact }) => (
        <NavLink
          key={to}
          to={to}
          end={exact}
          className={({ isActive }) =>
            `inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`
          }
        >
          {label}
        </NavLink>
      ))}
      {offlineQueueCount > 0 && (
        <div
          className="ml-auto flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"
          role="status"
          aria-live="polite"
          aria-label={`${offlineQueueCount} actions pending sync`}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
          {offlineQueueCount} pending
        </div>
      )}
    </nav>
  )
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <OfflineBanner />
      <NavBar />
      <main id="main-content" className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <BrowserRouter>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:rounded focus:shadow"
          >
            Skip to content
          </a>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RouteGuard roles={COUNTER_ROLES} redirectTo="/login">
                  <AppLayout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/checkout" element={<CheckoutPage />} />
                      <Route path="/check-in" element={<CheckInPage />} />
                      <Route path="/shift" element={<ShiftPage />} />
                      <Route path="/overdue" element={<OverduePage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </AppLayout>
                </RouteGuard>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryProvider>
  )
}
