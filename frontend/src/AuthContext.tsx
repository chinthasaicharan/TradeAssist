import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { TOKEN_KEY, getMe, type AuthUser } from './api'

interface AuthCtx {
  user:    AuthUser | null
  token:   string | null
  loading: boolean
  setAuth: (token: string, user: AuthUser) => void
  logout:  () => void
}

const Ctx = createContext<AuthCtx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken]   = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser]     = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, validate stored token
  useEffect(() => {
    if (!token) { setLoading(false); return }
    getMe()
      .then(u => setUser(u))
      .catch(() => {
        // Token expired or invalid — clear it
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setAuth = (t: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, t)
    setToken(t)
    setUser(u)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }

  return (
    <Ctx.Provider value={{ user, token, loading, setAuth, logout }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
