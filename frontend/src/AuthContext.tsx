import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from 'react'
import { getMe, getToken, loginAuth, registerAuth, setToken } from './api'
import type { AuthUser } from './types'

interface AuthCtx {
  user: AuthUser | null
  /** True while the stored token is being hydrated via /auth/me */
  initialLoading: boolean
  login: (login: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [initialLoading, setInitialLoading] = useState<boolean>(() => !!getToken())

  // Hydrate the session from a stored token on first load
  useEffect(() => {
    if (!getToken()) { setInitialLoading(false); return }
    getMe()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setInitialLoading(false))
  }, [])

  // Any 401 on a protected endpoint → token rejected → drop the session
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('ta-unauthorized', onUnauthorized)
    return () => window.removeEventListener('ta-unauthorized', onUnauthorized)
  }, [])

  const login = useCallback(async (l: string, password: string) => {
    const res = await loginAuth(l, password)
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (email: string, username: string, password: string) => {
    const res = await registerAuth(email, username, password)
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  return (
    <Ctx.Provider value={{ user, initialLoading, login, register, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
