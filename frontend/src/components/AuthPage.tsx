import { useState } from 'react'
import { useAuth } from '../AuthContext'

interface Props { onClose: () => void }

type Mode = 'login' | 'register'

/** Pull a readable message out of a FastAPI error (detail: string | 422 list) */
function extractError(err: unknown): string {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map(e => (typeof e === 'object' && e !== null && 'msg' in e ? String((e as { msg: unknown }).msg) : String(e))).join(' · ')
  }
  return 'Something went wrong. Please try again.'
}

const inputCls =
  'w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white ' +
  'placeholder-zinc-600 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors'

export function AuthPage({ onClose }: Props) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [form, setForm] = useState({ login: '', email: '', username: '', password: '' })
  const [err, setErr]   = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const switchMode = (m: Mode) => { setMode(m); setErr('') }

  const validateRegister = (): string => {
    if (!/^[A-Za-z0-9_-]{3,}$/.test(form.username.trim()))
      return 'Username: 3+ characters, letters/numbers/hyphens/underscores only.'
    if (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/\d/.test(form.password))
      return 'Password: 8+ characters with at least one uppercase letter and one digit.'
    return ''
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (mode === 'register') {
      const v = validateRegister()
      if (v) { setErr(v); return }
    }
    setBusy(true); setErr('')
    try {
      if (mode === 'login') await login(form.login.trim(), form.password)
      else await register(form.email.trim(), form.username.trim(), form.password)
      onClose()
    } catch (e2) {
      setErr(extractError(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                mode === m
                  ? 'text-white border-b-2 border-brand-500 bg-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {m === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {mode === 'login' ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Email or username</label>
                <input className={inputCls} value={form.login} onChange={set('login')}
                       placeholder="you@example.com" autoFocus autoComplete="username" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Password</label>
                <input className={inputCls} type="password" value={form.password} onChange={set('password')}
                       placeholder="••••••••" autoComplete="current-password" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Email</label>
                <input className={inputCls} type="email" value={form.email} onChange={set('email')}
                       placeholder="you@example.com" autoFocus autoComplete="email" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Username</label>
                <input className={inputCls} value={form.username} onChange={set('username')}
                       placeholder="trader_sai" autoComplete="username" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Password</label>
                <input className={inputCls} type="password" value={form.password} onChange={set('password')}
                       placeholder="8+ chars, 1 uppercase, 1 digit" autoComplete="new-password" />
              </div>
            </>
          )}

          {err && (
            <p className="text-xs text-red-400 bg-red-950/60 border border-red-900 rounded-lg px-3 py-2">
              {err}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50
                       disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>

          <p className="text-center text-[11px] text-zinc-600">
            {mode === 'login' ? (
              <>New here?{' '}
                <button type="button" onClick={() => switchMode('register')} className="text-brand-400 hover:text-brand-300">
                  Create an account
                </button>
              </>
            ) : (
              <>Already registered?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-brand-400 hover:text-brand-300">
                  Log in
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  )
}
