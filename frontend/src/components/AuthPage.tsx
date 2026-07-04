import { useState, type FormEvent } from 'react'
import { register, login } from '../api'
import { useAuth } from '../AuthContext'
import { Logo } from './Logo'

export function AuthPage() {
  const { setAuth } = useAuth()
  const [mode, setMode]     = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  // Form fields
  const [email, setEmail]       = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginId, setLoginId]   = useState('')   // email or username

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let res
      if (mode === 'login') {
        res = await login(loginId, password)
      } else {
        res = await register(email, username, password)
      }
      setAuth(res.access_token, res.user)
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      if (Array.isArray(detail)) {
        // Pydantic validation errors
        setError(detail.map((d: any) => d.msg).join(', '))
      } else {
        setError(detail ?? 'Something went wrong')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Logo size={56} className="mb-3" />
          <h1 className="text-xl font-bold text-white">TradeAssist</h1>
          <p className="text-xs text-gray-500 mt-1">Indian Stock Analysis Dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          {/* Tab switcher */}
          <div className="flex bg-gray-800 rounded-lg p-1">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError('') }}
                className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition-colors capitalize ${
                  mode === m ? 'bg-brand-700 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {m === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <Field label="Email" type="email" value={email}
                onChange={setEmail} placeholder="you@example.com" required />
            )}

            {mode === 'login' ? (
              <Field label="Email or Username" type="text" value={loginId}
                onChange={setLoginId} placeholder="email or username" required />
            ) : (
              <Field label="Username" type="text" value={username}
                onChange={setUsername} placeholder="min 3 chars, letters/numbers" required />
            )}

            <Field label="Password" type="password" value={password}
              onChange={setPassword}
              placeholder={mode === 'register' ? 'Min 8 chars, 1 uppercase, 1 digit' : 'Your password'}
              required />

            {error && (
              <p className="text-red-400 text-xs bg-red-950 border border-red-800 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-brand-700 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-wait text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-xs text-gray-600 text-center">
            Session lasts 3 days. Logout anytime from the header.
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, type, value, onChange, placeholder, required,
}: {
  label: string; type: string; value: string
  onChange: (v: string) => void; placeholder: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 font-medium mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 transition-colors"
      />
    </div>
  )
}
