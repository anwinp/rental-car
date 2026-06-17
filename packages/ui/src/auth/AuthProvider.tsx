import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { apiClient } from '@rcm/api-client'
import { UserRole } from '@rcm/shared-types'
import { FullPageSpinner } from '../components/spinner'

// Minimal user profile type — will be replaced with generated schema type
export interface UserProfile {
  user_id: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  roles: UserRole[]
  tenant_id: string
}

interface AuthContextValue {
  user: UserProfile | null
  isLoading: boolean
  setUser: (u: UserProfile | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // httpOnly cookie is sent automatically — never reads localStorage
    apiClient
      .GET('/auth/me' as never)
      .then((res: { data?: unknown }) => setUser((res.data as UserProfile) ?? null))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false))
  }, [])

  async function logout() {
    await apiClient.POST('/auth/logout' as never)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/**
 * RouteGuard — wrap any protected subtree.
 * Shows FullPageSpinner while auth state is loading.
 * Redirects to redirectTo if user is not authenticated.
 * Redirects to /unauthorized if user lacks required roles.
 */
export function RouteGuard({
  roles = [],
  children,
  redirectTo = '/login',
}: {
  roles?: UserRole[]
  children: ReactNode
  redirectTo?: string
}) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <FullPageSpinner />
  if (!user) return <Navigate to={redirectTo} replace />
  if (roles.length > 0 && !roles.some((r) => user.roles.includes(r))) {
    return <Navigate to="/unauthorized" replace />
  }
  return <>{children}</>
}
