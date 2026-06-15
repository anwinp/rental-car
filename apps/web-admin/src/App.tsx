import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryProvider } from '@rcm/ui/query'
import { AuthProvider, RouteGuard } from '@rcm/ui/auth'
import { Toaster } from '@rcm/ui'
import { UserRole } from '@rcm/shared-types'
import { AdminLayout } from './components/Layout'
import { FleetPage } from './pages/FleetPage'
import { ReservationsPage } from './pages/ReservationsPage'
import { CustomersPage } from './pages/CustomersPage'
import { PricingPage } from './pages/PricingPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'

const ADMIN_ROLES = [
  UserRole.BRANCH_MANAGER,
  UserRole.REGIONAL_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.CLAIMS_COORDINATOR,
  UserRole.FINANCE_ANALYST,
  UserRole.READONLY_AUDITOR,
  UserRole.SYSTEM_ADMIN,
  UserRole.SUPER_ADMIN,
]

function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold">Admin Login</h1>
      <p className="mt-2 text-muted-foreground">Sign in with your administrator account.</p>
      <a
        href="/api/v1/auth/login"
        className="mt-6 inline-flex min-h-[44px] items-center rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Sign In
      </a>
    </div>
  )
}

function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <h1 className="text-3xl font-bold">Access Denied</h1>
      <p className="mt-2 text-muted-foreground">
        Your account does not have permission to access the admin panel.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Contact your administrator if you believe this is an error.
      </p>
      <a
        href="/login"
        className="mt-6 text-sm text-primary underline underline-offset-4"
      >
        Sign in with a different account
      </a>
    </div>
  )
}

function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Welcome to the RCM Admin Panel. Select a section from the sidebar to get started.
      </p>
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
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

            {/* All admin routes require BRANCH_MANAGER+ */}
            <Route
              path="/*"
              element={
                <RouteGuard roles={ADMIN_ROLES} redirectTo="/login">
                  <AdminLayout>
                    <Routes>
                      <Route path="/" element={<Navigate to="/fleet" replace />} />
                      <Route path="/fleet" element={<FleetPage />} />
                      <Route path="/reservations" element={<ReservationsPage />} />
                      <Route path="/customers" element={<CustomersPage />} />
                      <Route
                        path="/pricing"
                        element={
                          <RouteGuard
                            roles={[UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]}
                            redirectTo="/unauthorized"
                          >
                            <PricingPage />
                          </RouteGuard>
                        }
                      />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route
                        path="/settings"
                        element={
                          <RouteGuard
                            roles={[UserRole.SYSTEM_ADMIN, UserRole.SUPER_ADMIN]}
                            redirectTo="/unauthorized"
                          >
                            <SettingsPage />
                          </RouteGuard>
                        }
                      />
                      <Route path="*" element={<Navigate to="/fleet" replace />} />
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
