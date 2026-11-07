import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getFnoStatus, connectFno, disconnectFno, getFnoExpiries, getFnoAnalysis, suggestFno,
} from '../api'
import type {
  FnoAnalysisResponse, FnoSuggestion, FnoStrikeRow,
} from '../types'

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtPrice = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

const fmtOI = (v: number | null | undefined) => {
  if (v == null) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
  return `${sign}${a}`
}

const SENTIMENT_STYLE: Record<string, string> = {
  'Strong Bullish': 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  'Bullish':        'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25',
  'Neutral':        'bg-white/[0.06] text-zinc-400 ring-white/[0.08]',
  'Bearish':        'bg-red-500/10 text-red-400 ring-red-500/25',
  'Strong Bearish': 'bg-red-500/15 text-red-300 ring-red-500/40',
}

const sentimentCls = (s: string | undefined) =>
  SENTIMENT_STYLE[s ?? ''] ?? SENTIMENT_STYLE['Neutral']

function apiError(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === 'string') return d
  return 'Something went wrong'
}

const OI_BAR_MAX = 24 // px bar length cap

function OiBar({ oi, change, maxOi }: { oi: number; change: number; maxOi: number }) {
  const w = Math.max(2, Math.min(OI_BAR_MAX, (oi / Math.max(1, maxOi)) * OI_BAR_MAX))
  const cw = Math.max(2, Math.min(OI_BAR_MAX, (Math.abs(change) / Math.max(1, maxOi)) * OI_BAR_MAX))
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[11px] tabular-nums text-zinc-300">{fmtOI(oi)}</span>
      <div className="flex items-center gap-1">
        <span className={`text-[10px] tabular-nums ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-zinc-600'}`}>
          {change > 0 ? '+' : ''}{fmtOI(change)}
        </span>
        <div className={`h-1 rounded-full ${change > 0 ? 'bg-emerald-500/70' : change < 0 ? 'bg-red-500/70' : 'bg-zinc-600'}`}
             style={{ width: `${cw}px` }} />
      </div>
      <div className="h-0.5 w-full flex justify-end">
        <div className="h-0.5 rounded-full bg-zinc-600/60" style={{ width: `${w}px` }} />
      </div>
    </div>
  )
}

// ── chain table ──────────────────────────────────────────────────────────────
function ChainTable({ data }: { data: FnoAnalysisResponse }) {
  const rows: FnoStrikeRow[] = data.strikes
  const atmIdx = useMemo(() => {
    const ref = data.spot_est ?? data.max_pain
    if (ref == null) return Math.floor(rows.length / 2)
    let best = 0, bestD = Infinity
    rows.forEach((r, i) => {
      const d = Math.abs(r.strike - ref)
      if (d < bestD) { bestD = d; best = i }
    })
    return best
  }, [rows, data.spot_est, data.max_pain])

  const view = rows.slice(Math.max(0, atmIdx - 10), atmIdx + 11)
  const maxOi = Math.max(1, ...rows.map(r => Math.max(r.ce?.oi ?? 0, r.pe?.oi ?? 0)))

  if (!view.length) return <p className="text-xs text-zinc-600 py-6 text-center">No strikes in chain.</p>

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[1fr_5rem_6rem_5rem_1fr] gap-2 px-3 pb-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
          <span className="text-right">Call OI (Δ OI)</span>
          <span className="text-right">CE LTP</span>
          <span className="text-center">Strike</span>
          <span className="text-left">PE LTP</span>
          <span>Put OI (Δ OI)</span>
        </div>
        <div className="space-y-0.5">
          {view.map(r => {
            const isAtm = r.strike === (data.spot_est ?? -1)
            return (
              <div key={r.strike}
                   className={`grid grid-cols-[1fr_5rem_6rem_5rem_1fr] gap-2 items-center px-3 py-1.5 rounded-lg text-xs ${
                     isAtm ? 'bg-brand-500/[0.08] ring-1 ring-inset ring-brand-500/25' : 'bg-white/[0.02]'
                   }`}>
                {/* calls — right aligned */}
                <div className="flex justify-end">
                  {r.ce ? <OiBar oi={r.ce.oi} change={r.ce.oi_change} maxOi={maxOi} /> : <span className="text-zinc-700">—</span>}
                </div>
                <span className="text-right tabular-nums text-zinc-200">{r.ce?.ltp != null ? fmtPrice(r.ce.ltp) : '—'}</span>
                <span className={`text-center font-mono font-semibold ${isAtm ? 'text-brand-300' : 'text-zinc-400'}`}>
                  {fmtPrice(r.strike)}
                </span>
                <span className="text-left tabular-nums text-zinc-200">{r.pe?.ltp != null ? fmtPrice(r.pe.ltp) : '—'}</span>
                {/* puts — left aligned */}
                {r.pe ? (
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="text-[11px] tabular-nums text-zinc-300">{fmtOI(r.pe.oi)}</span>
                    <div className="flex items-center gap-1">
                      <div className={`h-1 rounded-full ${r.pe.oi_change > 0 ? 'bg-emerald-500/70' : r.pe.oi_change < 0 ? 'bg-red-500/70' : 'bg-zinc-600'}`}
                           style={{ width: `${Math.max(2, Math.min(OI_BAR_MAX, (Math.abs(r.pe.oi_change) / maxOi) * OI_BAR_MAX))}px` }} />
                      <span className={`text-[10px] tabular-nums ${r.pe.oi_change > 0 ? 'text-emerald-400' : r.pe.oi_change < 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                        {r.pe.oi_change > 0 ? '+' : ''}{fmtOI(r.pe.oi_change)}
                      </span>
                    </div>
                    <div className="h-0.5">
                      <div className="h-0.5 rounded-full bg-zinc-600/60"
                           style={{ width: `${Math.max(2, Math.min(OI_BAR_MAX, (r.pe.oi / maxOi) * OI_BAR_MAX))}px` }} />
                    </div>
                  </div>
                ) : <span className="text-zinc-700">—</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── connect / setup ──────────────────────────────────────────────────────────
function SetupCard() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [mobile, setMobile] = useState('')
  const [ucc, setUcc] = useState('')
  const [totp, setTotp] = useState('')
  const [mpin, setMpin] = useState('')
  const [error, setError] = useState('')

  const mut = useMutation({
    mutationFn: () => connectFno(mobile, ucc, totp, mpin),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['fno-status'] }); setOpen(false) },
    onError: (e) => setError(apiError(e)),
  })

  const inputCls = 'w-full bg-zinc-950 border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500/60'

  return (
    <div className="panel p-5 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold text-white">Connect Kotak Neo</h2>
        <p className="text-xs text-zinc-500 mt-1">
          The FnO desk reads option chains straight from Kotak Neo's Trade API. One-time setup:
        </p>
      </div>
      <ol className="text-xs text-zinc-400 space-y-1.5 list-decimal list-inside leading-relaxed">
        <li>Open the <span className="text-zinc-200 font-semibold">NEO app → More → Trade API → Generate application</span> and copy the token.</li>
        <li>Add it to <span className="font-mono text-brand-400">backend/.env</span> as <span className="font-mono text-brand-400">KOTAK_CONSUMER_KEY=…</span> and restart the backend.</li>
        <li>(Optional) connect a full session below for quotes-backed features — needs mobile no., UCC, a live TOTP and your MPIN.</li>
      </ol>
      <div className="bg-zinc-950/60 border border-white/[0.06] rounded-lg px-3 py-2.5 font-mono text-[11px] text-zinc-400">
        KOTAK_CONSUMER_KEY=your-token-from-neo-app
      </div>

      <button
        className="text-xs font-semibold text-brand-400 hover:text-brand-300"
        onClick={() => setOpen(v => !v)}
      >
        {open ? 'Hide session login ▲' : 'Have a consumer key? Login with TOTP + MPIN ▼'}
      </button>

      {open && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <input className={inputCls} placeholder="Mobile (+91…)" value={mobile} onChange={e => setMobile(e.target.value)} />
            <input className={inputCls} placeholder="UCC (client code)" value={ucc} onChange={e => setUcc(e.target.value)} />
            <input className={inputCls} placeholder="TOTP (live 6-digit)" value={totp} onChange={e => setTotp(e.target.value)} />
            <input className={inputCls} placeholder="MPIN" type="password" value={mpin} onChange={e => setMpin(e.target.value)} />
          </div>
          {error && <p className="text-xs text-red-400 bg-red-950/60 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>}
          <button
            className="px-4 py-2 text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors disabled:opacity-50"
            disabled={!mobile || !ucc || !totp || !mpin || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? 'Connecting…' : 'Connect session'}
          </button>
          <p className="text-[10px] text-zinc-600">Credentials are used once for login and never stored.</p>
        </div>
      )}
    </div>
  )
}

// ── AI suggestion cards ──────────────────────────────────────────────────────
function SuggestionCards({ s }: { s: FnoSuggestion }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${sentimentCls(s.bias)}`}>
          {s.bias === 'Bullish' || s.bias === 'Strong Bullish' ? '▲' : s.bias === 'Bearish' || s.bias === 'Strong Bearish' ? '▼' : '—'} {s.bias}
        </span>
        <span className="text-[11px] text-zinc-500">{s.confidence_pct}% confidence · via {s.provider}</span>
      </div>
      {s.summary && <p className="text-xs text-zinc-400 leading-relaxed">{s.summary}</p>}
      {s.trades.map((t, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3.5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ring-1 ring-inset ${
              (t.action === 'BUY') === (t.option === 'CE')
                ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25'
                : 'bg-amber-500/10 text-amber-400 ring-amber-500/25'
            }`}>
              {t.action} {t.option}
            </span>
            <span className="text-sm font-semibold text-white tabular-nums">{typeof t.strike === 'number' ? fmtPrice(t.strike) : t.strike}</span>
            {t.horizon && <span className="text-[10px] text-zinc-600">{t.horizon}</span>}
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">{t.rationale}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-[11px]">
            {t.target && <p className="text-emerald-400/90"><span className="text-zinc-600">Target:</span> {t.target}</p>}
            {t.invalidation && <p className="text-red-400/90"><span className="text-zinc-600">Invalidation:</span> {t.invalidation}</p>}
            {t.risk && <p className="text-amber-400/90"><span className="text-zinc-600">Risk:</span> {t.risk}</p>}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-zinc-600">
        Educational analysis of option-chain positioning — not investment advice. Options carry unlimited risk; verify before trading.
      </p>
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────
export function FnOPage() {
  const qc = useQueryClient()
  const [underlying, setUnderlying] = useState('NIFTY')
  const [expiry, setExpiry] = useState<string>('')
  const [risk, setRisk] = useState('balanced')

  const { data: status } = useQuery({
    queryKey: ['fno-status'],
    queryFn: getFnoStatus,
    staleTime: 30_000,
  })

  const { data: expiries } = useQuery({
    queryKey: ['fno-expiries', underlying],
    queryFn: () => getFnoExpiries(underlying),
    enabled: !!status?.configured,
    staleTime: 30 * 60_000,
    retry: 1,
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['fno-analysis', underlying, expiry],
    queryFn: () => getFnoAnalysis(underlying, expiry || undefined),
    enabled: !!status?.configured,
    staleTime: 60_000,
    retry: 0,
  })

  const sugMut = useMutation({
    mutationFn: () => suggestFno(underlying, expiry || data?.expiry || null, risk),
  })

  const discMut = useMutation({
    mutationFn: disconnectFno,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fno-status'] }),
  })

  const ready = !!status?.configured

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">FnO Desk</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Option-chain positioning, analytics and AI trade suggestions — powered by Kotak Neo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-[11px] px-2 py-1 rounded-full ring-1 ring-inset font-semibold ${
              status.connected
                ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25'
                : status.configured
                  ? 'bg-amber-500/10 text-amber-400 ring-amber-500/25'
                  : 'bg-white/[0.06] text-zinc-400 ring-white/[0.08]'
            }`}>
              {status.connected ? '● Kotak session connected' : status.configured ? '● Consumer key set' : '● Not configured'}
            </span>
          )}
          {status?.connected && (
            <button onClick={() => discMut.mutate()}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded-lg hover:bg-white/[0.06] transition-colors">
              Disconnect
            </button>
          )}
        </div>
      </div>

      {!ready ? (
        <SetupCard />
      ) : (
        <>
          {/* controls */}
          <div className="panel p-3.5 space-y-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {status?.index_underlyings.map(u => (
                <button key={u} onClick={() => { setUnderlying(u); setExpiry(''); sugMut.reset() }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                          underlying === u
                            ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                            : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300'
                        }`}>{u}</button>
              ))}
              <span className="text-zinc-700 px-1">|</span>
              {status?.stock_underlyings.slice(0, 6).map(u => (
                <button key={u} onClick={() => { setUnderlying(u); setExpiry(''); sugMut.reset() }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                          underlying === u
                            ? 'bg-brand-500/10 text-brand-400 border-brand-500/30'
                            : 'bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300'
                        }`}>{u}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-zinc-600 font-semibold uppercase tracking-wider">Expiry</label>
              <select
                className="bg-zinc-950 border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500/60"
                value={expiry}
                onChange={e => { setExpiry(e.target.value); sugMut.reset() }}
              >
                <option value="">Nearest</option>
                {expiries?.expiries.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
              {isLoading && <span className="text-[11px] text-zinc-500">loading chain…</span>}
            </div>
          </div>

          {isError && (
            <div className="panel p-5">
              <p className="text-xs text-red-400">{apiError(error)}</p>
              <p className="text-[11px] text-zinc-600 mt-1.5">
                If this says the key is missing, set <span className="font-mono">KOTAK_CONSUMER_KEY</span> in backend/.env and restart.
              </p>
            </div>
          )}

          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-20 bg-white/[0.04] rounded-xl animate-pulse" />)}
            </div>
          )}

          {data && (
            <>
              {/* metrics */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
                <div className="metric-card rounded-xl p-3.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">PCR (OI)</p>
                  <p className={`text-lg font-semibold tabular-nums mt-1 ${(data.pcr_oi ?? 1) > 1.1 ? 'text-emerald-400' : (data.pcr_oi ?? 1) < 0.9 ? 'text-red-400' : 'text-zinc-200'}`}>
                    {data.pcr_oi?.toFixed(2) ?? '—'}
                  </p>
                </div>
                <div className="metric-card rounded-xl p-3.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Max pain</p>
                  <p className="text-lg font-semibold text-white tabular-nums mt-1">{fmtPrice(data.max_pain)}</p>
                </div>
                <div className="metric-card rounded-xl p-3.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Reference spot</p>
                  <p className="text-lg font-semibold text-white tabular-nums mt-1">{fmtPrice(data.spot_est)}</p>
                  <p className="text-[10px] text-zinc-600">ATM strike</p>
                </div>
                <div className="metric-card rounded-xl p-3.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Sentiment</p>
                  <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${sentimentCls(data.sentiment)}`}>
                    {data.sentiment}
                  </span>
                  <p className="text-[10px] text-zinc-600 mt-1 tabular-nums">score {data.sentiment_score > 0 ? '+' : ''}{data.sentiment_score}</p>
                </div>
                <div className="metric-card rounded-xl p-3.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Lot size</p>
                  <p className="text-lg font-semibold text-white tabular-nums mt-1">{data.lot_size ?? '—'}</p>
                </div>
                <div className="metric-card rounded-xl p-3.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">OI change</p>
                  <p className="text-lg font-semibold tabular-nums mt-1">
                    <span className="text-emerald-400">{fmtOI(data.total_pe_oi_change)}</span>
                    <span className="text-zinc-600 text-xs"> PE · </span>
                    <span className="text-red-400">{fmtOI(data.total_ce_oi_change)}</span>
                    <span className="text-zinc-600 text-xs"> CE</span>
                  </p>
                </div>
              </div>

              {/* buildup + S/R */}
              <div className="panel p-3.5 flex items-center gap-2 flex-wrap text-xs">
                <span className="text-zinc-600 font-semibold uppercase tracking-wider text-[10px]">Buildup</span>
                <span className="text-zinc-300">Calls: <span className="font-semibold">{data.call_buildup ?? '—'}</span></span>
                <span className="text-zinc-700">·</span>
                <span className="text-zinc-300">Puts: <span className="font-semibold">{data.put_buildup ?? '—'}</span></span>
                <span className="text-zinc-700 px-1">|</span>
                <span className="text-red-400/90">R: {data.resistances.map(r => fmtPrice(r.strike)).join(' / ') || '—'}</span>
                <span className="text-emerald-400/90">S: {data.supports.map(r => fmtPrice(r.strike)).join(' / ') || '—'}</span>
              </div>

              {/* chain */}
              <div className="panel p-4">
                <h3 className="panel-title !mb-3">Option chain — {data.underlying} {data.expiry ?? ''}</h3>
                <ChainTable data={data} />
              </div>

              {/* AI suggestions */}
              <div className="panel p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="panel-title !mb-0">AI trade suggestions</h3>
                  <div className="ml-auto flex items-center gap-2">
                    <select
                      className="bg-zinc-950 border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500/60"
                      value={risk}
                      onChange={e => { setRisk(e.target.value); sugMut.reset() }}
                    >
                      <option value="conservative">Conservative</option>
                      <option value="balanced">Balanced</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                    <button
                      className="px-4 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                      disabled={sugMut.isPending}
                      onClick={() => sugMut.mutate()}
                    >
                      {sugMut.isPending ? 'Analysing…' : '✨ Suggest trades'}
                    </button>
                  </div>
                </div>

                {sugMut.isPending && (
                  <div className="space-y-2">
                    {[0, 1].map(i => <div key={i} className="h-16 bg-white/[0.04] rounded-xl animate-pulse" />)}
                  </div>
                )}
                {sugMut.isError && (
                  <p className="text-xs text-red-400 bg-red-950/60 border border-red-900/50 rounded-lg px-3 py-2">{apiError(sugMut.error)}</p>
                )}
                {sugMut.data && <SuggestionCards s={sugMut.data} />}
                {!sugMut.data && !sugMut.isPending && !sugMut.isError && (
                  <p className="text-xs text-zinc-600">
                    Reads the live positioning snapshot (PCR, max pain, OI buildup, S/R) and proposes 1–3 trades with rationale and risk.
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
