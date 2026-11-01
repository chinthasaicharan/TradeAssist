import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchTickers, getSwing } from '../api'
import { fmt, SYM } from '../utils'
import type { SearchSuggestion } from '../types'

interface Props {
  onSelectTicker: (ticker: string, name?: string) => void
}

const VERDICT_CFG = {
  'Strong Swing Buy':  { bg: 'bg-emerald-950', border: 'border-emerald-500', text: 'text-emerald-300', meter: '#10b981', dot: 'bg-emerald-400', arrow: '▲' },
  'Swing Buy':         { bg: 'bg-emerald-900', border: 'border-emerald-600', text: 'text-emerald-400', meter: '#34d399', dot: 'bg-emerald-500', arrow: '▲' },
  'Neutral':           { bg: 'bg-zinc-800',    border: 'border-zinc-600',    text: 'text-zinc-300',    meter: '#9ca3af', dot: 'bg-zinc-500',   arrow: '—' },
  'Swing Sell':        { bg: 'bg-red-900',     border: 'border-red-600',     text: 'text-red-400',     meter: '#f87171', dot: 'bg-red-500',    arrow: '▼' },
  'Strong Swing Sell': { bg: 'bg-red-950',     border: 'border-red-500',     text: 'text-red-300',     meter: '#ef4444', dot: 'bg-red-400',    arrow: '▼' },
}

// Mini sparkline using SVG
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 120, h = 36
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// Result card shown after fetch
function SwingResultCard({ ticker, onViewFull }: { ticker: string; onViewFull: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['swing', ticker],
    queryFn:  () => getSwing(ticker),
    enabled:  !!ticker,
    staleTime: 60 * 60_000,
    retry: 1,
  })

  if (isLoading) return (
    <div className="mt-3 rounded-2xl border border-zinc-700 bg-zinc-800 p-4 animate-pulse space-y-3">
      <div className="h-4 bg-zinc-700 rounded w-1/2" />
      <div className="h-8 bg-zinc-700 rounded w-1/3" />
      <div className="grid grid-cols-3 gap-2">
        {[1,2,3].map(i => <div key={i} className="h-10 bg-zinc-700 rounded-xl" />)}
      </div>
    </div>
  )

  if (isError || !data) return (
    <div className="mt-3 rounded-2xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-400">
      Could not load swing data for {ticker}. Try again in a moment.
    </div>
  )

  const cfg      = VERDICT_CFG[data.verdict]
  const riskPct  = ((data.entry_price - data.stop_loss)   / data.entry_price * 100).toFixed(1)
  const rewPct   = ((data.target_price - data.entry_price) / data.entry_price * 100).toFixed(1)
  const closes   = data.price_history.map(d => d.close)

  // Top 2 supporting reasons (why_buy for buys, else why_risk)
  const reasons  = data.verdict.includes('Buy')
    ? data.why_buy.slice(0, 2)
    : data.why_risk.slice(0, 2)

  return (
    <div className={`mt-3 rounded-2xl border-2 ${cfg.border} ${cfg.bg} overflow-hidden`}>

      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
          <span className={`text-lg font-black ${cfg.text}`}>{cfg.arrow} {data.verdict}</span>
          <span className="text-xs text-zinc-500 font-mono">{data.ticker}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Sparkline data={closes.slice(-30)} color={cfg.meter} />
          <button
            onClick={onViewFull}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white font-semibold transition-colors"
          >
            Full Analysis →
          </button>
        </div>
      </div>

      {/* Probability + composite */}
      <div className="px-4 pb-3 flex items-center gap-6">
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Win Probability</p>
          <p className={`text-2xl font-black ${cfg.text}`}>{data.probability_pct.toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Confidence</p>
          <p className={`text-2xl font-black ${cfg.text}`}>{data.confidence_pct.toFixed(0)}%</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Score</p>
          <div className="relative h-2.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-600" />
            <div className="absolute top-0 h-full rounded-full"
              style={{
                left:  data.composite_score >= 0 ? '50%' : `${50 + data.composite_score / 2}%`,
                width: `${Math.abs(data.composite_score) / 2}%`,
                backgroundColor: cfg.meter,
              }} />
          </div>
          <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
            <span>Sell</span><span className={`font-bold ${cfg.text}`}>{data.composite_score > 0 ? '+' : ''}{data.composite_score}</span><span>Buy</span>
          </div>
        </div>
      </div>

      {/* Trade levels */}
      <div className="grid grid-cols-4 gap-px bg-zinc-700 border-t border-zinc-700">
        {[
          { label: 'Entry',   val: data.entry_price,  color: 'text-white',        sub: 'Current' },
          { label: 'Target',  val: data.target_price, color: 'text-emerald-400',  sub: `+${rewPct}%` },
          { label: 'Stop',    val: data.stop_loss,    color: 'text-red-400',      sub: `-${riskPct}%` },
          { label: 'R : R',   val: null,              color: data.risk_reward >= 2 ? 'text-emerald-400' : 'text-yellow-400',
            display: `1 : ${data.risk_reward.toFixed(1)}`, sub: data.hold_days },
        ].map(item => (
          <div key={item.label} className="bg-zinc-900 px-3 py-2.5 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{item.label}</p>
            <p className={`text-sm font-bold mt-0.5 ${item.color}`}>
              {item.val != null ? `${SYM}${fmt(item.val, 0)}` : (item as any).display}
            </p>
            <p className={`text-[10px] mt-0.5 ${item.color} opacity-70`}>{item.sub}</p>
          </div>
        ))}
      </div>

      {/* Fib levels */}
      {(data.fib_382 || data.fib_618) && (
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-zinc-700/50 flex-wrap">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wide shrink-0">Fib</span>
          {data.fib_382 && (
            <span className="text-xs text-yellow-400 font-mono">38.2% <strong>{SYM}{fmt(data.fib_382, 0)}</strong></span>
          )}
          {data.fib_618 && (
            <span className="text-xs text-lime-400 font-mono">61.8% <strong>{SYM}{fmt(data.fib_618, 0)}</strong></span>
          )}
          {data.week52_low && data.week52_high && (
            <span className="text-xs text-zinc-500 ml-auto font-mono">
              52W {SYM}{fmt(data.week52_low, 0)} – {SYM}{fmt(data.week52_high, 0)}
            </span>
          )}
        </div>
      )}

      {/* Supporting reasons */}
      {reasons.length > 0 && (
        <div className="px-4 pb-4 pt-1 border-t border-zinc-700/50 space-y-1.5">
          {reasons.map((r, i) => (
            <div key={i} className="flex gap-2 text-xs text-zinc-400">
              <span className={`shrink-0 font-bold ${cfg.text}`}>{cfg.arrow}</span>
              <span className="leading-relaxed">{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────
export function SwingSearchWidget({ onSelectTicker }: Props) {
  const [input, setInput]         = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected]   = useState('')
  const [open, setOpen]           = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  // Debounce input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 280)
    return () => clearTimeout(t)
  }, [input])

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: suggestions = [], isFetching } = useQuery<SearchSuggestion[]>({
    queryKey: ['search', debounced],
    queryFn:  () => import('../api').then(m => m.searchTickers(debounced)),
    enabled:  debounced.length >= 1,
    staleTime: 60_000,
  })

  const pick = (s: SearchSuggestion) => {
    setSelected(s.ticker)
    setInput(`${s.ticker.replace('.NS','').replace('.BO','')} — ${s.name}`)
    setOpen(false)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && suggestions.length > 0) pick(suggestions[0])
    if (e.key === 'Escape') setOpen(false)
  }

  const clear = () => {
    setInput(''); setSelected(''); setDebounced('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Title */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔄</span>
        <p className="text-sm font-bold text-white">Swing Trade Analyser</p>
        <span className="text-xs text-zinc-500">— search any stock for instant swing score</span>
      </div>

      {/* Search box */}
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-600 rounded-xl px-3 py-2.5 focus-within:border-brand-500 transition-colors">
          <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); setOpen(true); if (!e.target.value) setSelected('') }}
            onFocus={() => { if (input) setOpen(true) }}
            onKeyDown={handleKey}
            placeholder="Search stock for swing analysis… e.g. RELIANCE, TCS, INFY"
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
          />
          {isFetching && (
            <svg className="w-3.5 h-3.5 text-zinc-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          {(input || selected) && (
            <button onClick={clear} className="text-zinc-500 hover:text-white text-lg leading-none shrink-0 transition-colors">×</button>
          )}
        </div>

        {/* Dropdown suggestions */}
        {open && suggestions.length > 0 && (
          <ul className="absolute z-50 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
            {suggestions.map((s, i) => (
              <li
                key={s.ticker}
                onClick={() => pick(s)}
                className={`flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-zinc-700 transition-colors text-sm
                  ${i < suggestions.length - 1 ? 'border-b border-zinc-700/50' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-white font-mono w-20 shrink-0 text-xs">
                    {s.ticker.replace('.NS','').replace('.BO','')}
                  </span>
                  <span className="text-zinc-400 text-xs truncate">{s.name}</span>
                </div>
                <span className="text-xs text-zinc-600 shrink-0 ml-2">{s.exchange}</span>
              </li>
            ))}
          </ul>
        )}
        {open && debounced.length >= 1 && suggestions.length === 0 && !isFetching && (
          <div className="absolute z-50 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-zinc-400">
            No results for "<span className="text-white">{debounced}</span>"
          </div>
        )}
      </div>

      {/* Result */}
      {selected && (
        <SwingResultCard
          ticker={selected}
          onViewFull={() => onSelectTicker(selected)}
        />
      )}

      {/* Quick scan buttons */}
      {!selected && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wide self-center mr-1">Quick scan</span>
          {['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','BAJFINANCE.NS','SBIN.NS','ICICIBANK.NS','WIPRO.NS'].map(t => (
            <button
              key={t}
              onClick={() => { setSelected(t); setInput(`${t.replace('.NS','').replace('.BO','')} — Quick scan`) }}
              className="px-2.5 py-1 rounded-lg text-xs font-mono bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-brand-600 text-zinc-400 hover:text-white transition-all"
            >
              {t.replace('.NS','')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
