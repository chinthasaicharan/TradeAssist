import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSmartMoneyScanner, searchTickers } from '../api'
import { fmt, SYM } from '../utils'
import type { SmartMoneySignal, SearchSuggestion } from '../types'

interface Props { onSelectTicker: (ticker: string) => void }

// ── Verdict config ────────────────────────────────────────────────────────
const VERDICT_CFG = {
  'Strong Buy Signal': { bg: 'bg-emerald-950', border: 'border-emerald-500', text: 'text-emerald-300', dot: '#10b981', icon: '🟢' },
  'Buy Signal':        { bg: 'bg-emerald-950', border: 'border-emerald-700', text: 'text-emerald-400', dot: '#34d399', icon: '🟢' },
  'Watch':             { bg: 'bg-amber-950',   border: 'border-amber-700',   text: 'text-amber-300',   dot: '#fbbf24', icon: '🟡' },
  'Neutral':           { bg: 'bg-zinc-800',    border: 'border-zinc-700',    text: 'text-zinc-400',    dot: '#6b7280', icon: '⚪' },
  'Sell Signal':       { bg: 'bg-red-950',     border: 'border-red-700',     text: 'text-red-400',     dot: '#ef4444', icon: '🔴' },
} as const

// ── Score bar ─────────────────────────────────────────────────────────────
function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#10b981' : score >= 60 ? '#34d399' : score >= 50 ? '#fbbf24' : score >= 35 ? '#f97316' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color }}>{score}</span>
    </div>
  )
}

// ── Pill badge ────────────────────────────────────────────────────────────
function Pill({ label, color }: { label: string; color: string }) {
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${color}`}>{label}</span>
}

// ── Watchlist builder (same pattern as ORBScannerPanel) ───────────────────
function WatchlistBuilder({ tickers, onChange }: { tickers: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput]       = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen]         = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])

  const { data: suggestions = [], isFetching } = useQuery<SearchSuggestion[]>({
    queryKey: ['search', debounced],
    queryFn: () => searchTickers(debounced),
    enabled: debounced.length >= 1,
    staleTime: 60_000,
  })

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const add = (ticker: string) => {
    if (!tickers.includes(ticker)) onChange([...tickers, ticker])
    setInput(''); setDebounced(''); setOpen(false)
    inputRef.current?.focus()
  }
  const remove = (ticker: string) => onChange(tickers.filter(t => t !== ticker))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0) { add(suggestions[0].ticker); return }
      if (input.trim()) {
        const raw = input.trim().toUpperCase()
        add(!raw.includes('.') ? `${raw}.NS` : raw)
      }
    }
    if (e.key === 'Escape') setOpen(false)
    if (e.key === 'Backspace' && !input && tickers.length > 0) remove(tickers[tickers.length - 1])
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap gap-1.5 items-center bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 min-h-[42px] cursor-text focus-within:border-brand-500 transition-colors"
        onClick={() => inputRef.current?.focus()}
      >
        {tickers.map(t => (
          <span key={t} className="flex items-center gap-1 bg-zinc-700 text-zinc-200 text-xs font-mono px-2 py-1 rounded-full">
            {t.replace('.NS','').replace('.BO','')}
            <button onClick={e => { e.stopPropagation(); remove(t) }} className="text-zinc-500 hover:text-red-400">×</button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[140px] flex items-center gap-1.5">
          {isFetching && <svg className="w-3 h-3 text-zinc-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
          <input ref={inputRef} value={input} onChange={e => { setInput(e.target.value); setOpen(true) }}
            onFocus={() => { if (input) setOpen(true) }} onKeyDown={handleKeyDown}
            placeholder={tickers.length === 0 ? 'Search stocks to add…' : 'Add more…'}
            className="bg-transparent text-sm text-white placeholder-zinc-600 outline-none w-full" />
        </div>
        {tickers.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-zinc-600 hover:text-zinc-400 px-1 shrink-0">Clear</button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.map((s, idx) => {
            const already = tickers.includes(s.ticker)
            return (
              <li key={s.ticker} onClick={() => !already && add(s.ticker)}
                className={`flex items-center justify-between px-3 py-2.5 text-sm transition-colors ${already ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-zinc-700'} ${idx !== suggestions.length - 1 ? 'border-b border-zinc-700/50' : ''}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-white font-mono w-20 shrink-0 text-xs">{s.ticker.replace('.NS','').replace('.BO','')}</span>
                  <span className="text-zinc-400 text-xs truncate">{s.name}</span>
                </div>
                {already && <span className="text-xs text-brand-500 shrink-0">✓</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Result row ────────────────────────────────────────────────────────────
function SMCRow({ sig, onSelect }: { sig: SmartMoneySignal; onSelect: (t: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = VERDICT_CFG[sig.verdict] ?? VERDICT_CFG['Neutral']
  const isAlert = sig.ob_alert || sig.sweep_reversal

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${cfg.border} ${isAlert ? 'ring-1 ring-emerald-500/30' : ''}`}>
      {/* Main row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={`w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-zinc-800/60 transition-colors ${cfg.bg}`}
      >
        {/* Alert glow dot */}
        {isAlert && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" title="BUY Alert" />}
        {/* Ticker */}
        <div className="w-24 shrink-0">
          <p className="text-sm font-bold text-white font-mono">{sig.ticker.replace('.NS','').replace('.BO','')}</p>
          <p className="text-[10px] text-zinc-500 truncate max-w-[90px]">{sig.name.split(' ').slice(0,2).join(' ')}</p>
        </div>
        {/* Price */}
        <div className="w-20 shrink-0">
          <p className="text-sm font-bold text-white">{SYM}{fmt(sig.current_price)}</p>
          <p className={`text-xs font-semibold ${sig.change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {sig.change_pct >= 0 ? '+' : ''}{sig.change_pct.toFixed(2)}%
          </p>
        </div>
        {/* Score */}
        <div className="w-28 shrink-0 hidden sm:block">
          <ScoreBar score={sig.smart_money_score} />
          <p className="text-[10px] text-zinc-500 mt-0.5">SMC Score</p>
        </div>
        {/* Verdict */}
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-bold ${cfg.text}`}>{cfg.icon} {sig.verdict}</p>
          <p className="text-[10px] text-zinc-500 truncate">{sig.summary}</p>
        </div>
        {/* Badges */}
        <div className="flex flex-wrap gap-1 shrink-0 hidden md:flex">
          {sig.ob_alert     && <Pill label="OB ✓"     color="bg-emerald-900 text-emerald-300" />}
          {sig.fvg_support  && <Pill label="FVG ✓"    color="bg-blue-900 text-blue-300" />}
          {sig.sweep_reversal && <Pill label="Sweep ✓" color="bg-purple-900 text-purple-300" />}
          {sig.high_volume_alert && <Pill label={`Vol ${sig.volume_vs_avg_1m}×`} color="bg-amber-900 text-amber-300" />}
        </div>
        <span className={`text-zinc-600 text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="bg-zinc-900/80 border-t border-zinc-800 px-4 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* Order Blocks */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">Order Blocks</p>
              {sig.order_blocks.length === 0
                ? <p className="text-xs text-zinc-600">None detected</p>
                : sig.order_blocks.slice(0, 3).map((ob, i) => (
                  <div key={i} className={`text-xs rounded px-2 py-1.5 ${ob.type === 'bullish' ? 'bg-emerald-950 border border-emerald-800' : 'bg-red-950 border border-red-900'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${ob.type === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {ob.type === 'bullish' ? '▲' : '▼'} {ob.type.toUpperCase()} OB
                      </span>
                      <div className="flex gap-1">
                        {ob.fresh    && <Pill label="Fresh"    color="bg-emerald-900 text-emerald-400" />}
                        {ob.tested   && <Pill label="Tested"   color="bg-zinc-700 text-zinc-400" />}
                        <Pill label={ob.strength} color="bg-zinc-800 text-zinc-300" />
                      </div>
                    </div>
                    <p className="text-zinc-300 mt-0.5">{SYM}{fmt(ob.low)} – {SYM}{fmt(ob.high)}</p>
                    <p className="text-zinc-600 text-[10px]">{ob.date}</p>
                  </div>
                ))
              }
            </div>

            {/* Fair Value Gaps */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">Fair Value Gaps</p>
              {sig.fvg_zones.length === 0
                ? <p className="text-xs text-zinc-600">None detected</p>
                : sig.fvg_zones.slice(0, 3).map((fvg, i) => (
                  <div key={i} className={`text-xs rounded px-2 py-1.5 ${fvg.type === 'bullish' ? 'bg-blue-950 border border-blue-900' : 'bg-orange-950 border border-orange-900'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${fvg.type === 'bullish' ? 'text-blue-400' : 'text-orange-400'}`}>
                        {fvg.type === 'bullish' ? '▲' : '▼'} {fvg.type.toUpperCase()} FVG
                      </span>
                      {fvg.filled && <Pill label="Filled" color="bg-zinc-700 text-zinc-500" />}
                    </div>
                    <p className="text-zinc-300 mt-0.5">{SYM}{fmt(fvg.bottom)} – {SYM}{fmt(fvg.top)}</p>
                    <p className="text-zinc-600 text-[10px]">{fvg.date}</p>
                  </div>
                ))
              }
            </div>

            {/* Liquidity Sweeps */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">Liquidity Sweeps</p>
              {sig.liquidity_sweeps.length === 0
                ? <p className="text-xs text-zinc-600">None detected</p>
                : sig.liquidity_sweeps.slice(0, 3).map((sw, i) => (
                  <div key={i} className={`text-xs rounded px-2 py-1.5 ${sw.type === 'sell_side' ? 'bg-purple-950 border border-purple-900' : 'bg-rose-950 border border-rose-900'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`font-bold ${sw.type === 'sell_side' ? 'text-purple-400' : 'text-rose-400'}`}>
                        {sw.type === 'sell_side' ? '↓ Sell-side' : '↑ Buy-side'} Sweep
                      </span>
                      {sw.reversed && <Pill label="Reversed ✓" color="bg-emerald-900 text-emerald-400" />}
                    </div>
                    <p className="text-zinc-300 mt-0.5">Level: {SYM}{fmt(sw.level)}</p>
                    <p className="text-zinc-600 text-[10px]">{sw.date}</p>
                  </div>
                ))
              }
            </div>
          </div>
          {/* Open chart button */}
          <button
            onClick={() => onSelect(sig.ticker)}
            className="text-xs text-brand-400 hover:text-brand-300 underline-offset-2 hover:underline"
          >
            Open {sig.ticker.replace('.NS','').replace('.BO','')} chart →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────
export function SmartMoneyPanel({ onSelectTicker }: Props) {
  const [customTickers, setCustomTickers] = useState<string[]>([])
  const [useCustom, setUseCustom]         = useState(false)
  const [hasScanned, setHasScanned]       = useState(false)
  const [minScore, setMinScore]           = useState(0)
  const [filter, setFilter]               = useState<'all' | 'buy' | 'watch'>('all')

  const tickersParam = useCustom && customTickers.length > 0 ? customTickers.join(',') : ''
  const canFetch     = hasScanned && (!useCustom || customTickers.length > 0)

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['smart-money-scanner', tickersParam, minScore],
    queryFn:  () => getSmartMoneyScanner(tickersParam || undefined, minScore),
    enabled:  canFetch,
    staleTime: 10 * 60_000,
    refetchInterval: false,
  })

  const handleScan = () => {
    if (!hasScanned) { setHasScanned(true) } else { refetch() }
  }

  const allResults = data?.results ?? []
  const filtered = allResults.filter(r => {
    if (filter === 'buy')   return r.verdict === 'Strong Buy Signal' || r.verdict === 'Buy Signal'
    if (filter === 'watch') return r.verdict === 'Watch'
    return true
  })

  const alertCount = allResults.filter(r => r.ob_alert || r.sweep_reversal).length
  const updatedAt  = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="panel space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="panel-title mb-0">
            Smart Money Scanner
            {alertCount > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-emerald-900 text-emerald-300 font-semibold animate-pulse">
                {alertCount} BUY Alert{alertCount > 1 ? 's' : ''}
              </span>
            )}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Order Blocks · Fair Value Gaps · Liquidity Sweeps · 1-Month High Volume
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={isFetching || (useCustom && customTickers.length === 0)}
          className="px-3 py-1.5 rounded text-xs bg-brand-700 hover:bg-brand-600 text-white border border-brand-600 transition-colors disabled:opacity-50 font-semibold shrink-0"
        >
          {isFetching ? '⟳ Scanning…' : hasScanned ? '⟳ Refresh' : '▶ Scan'}
        </button>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Custom watchlist toggle */}
        <label className="flex items-center gap-2 cursor-pointer" onClick={() => setUseCustom(v => !v)}>
          <div className={`w-8 h-4 rounded-full relative transition-colors ${useCustom ? 'bg-brand-600' : 'bg-zinc-700'}`}>
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${useCustom ? 'left-4' : 'left-0.5'}`} />
          </div>
          <span className="text-xs text-zinc-400">Custom watchlist</span>
        </label>
        {!useCustom && <span className="text-xs text-zinc-600">Default: Nifty 50</span>}

        {/* Min score filter */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-zinc-500">Min score</span>
          {[0, 40, 60].map(s => (
            <button key={s} onClick={() => setMinScore(s)}
              className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${minScore === s ? 'bg-brand-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
              {s === 0 ? 'All' : `${s}+`}
            </button>
          ))}
        </div>
      </div>

      {/* Watchlist input */}
      {useCustom && (
        <div className="space-y-1">
          <WatchlistBuilder tickers={customTickers} onChange={setCustomTickers} />
          {customTickers.length === 0 && <p className="text-xs text-zinc-600">Add stocks above to scan them</p>}
        </div>
      )}

      {/* Stats bar */}
      {data && !isLoading && (
        <div className="flex items-center gap-4 text-xs flex-wrap bg-zinc-800/50 rounded-lg px-3 py-2">
          <span className="text-zinc-500">Scanned <span className="text-white font-bold">{data.scanned}</span></span>
          <span className="text-emerald-400 font-semibold">🟢 {data.buy_count} buy signals</span>
          {alertCount > 0 && <span className="text-emerald-300 font-bold animate-pulse">⚡ {alertCount} OB alerts</span>}
          {updatedAt && <span className="text-zinc-600 ml-auto">Updated {updatedAt}</span>}
        </div>
      )}

      {/* Filter tabs */}
      {allResults.length > 0 && (
        <div className="flex gap-1.5">
          {(['all', 'buy', 'watch'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${filter === f ? 'bg-brand-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>
              {f === 'all' ? `All (${allResults.length})` : f === 'buy' ? `Buy (${allResults.filter(r => r.verdict.includes('Buy')).length})` : `Watch (${allResults.filter(r => r.verdict === 'Watch').length})`}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {(isLoading || isFetching) && allResults.length === 0 && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-zinc-800 rounded-xl animate-pulse" />)}
          <p className="text-xs text-zinc-600 text-center">Analysing Smart Money indicators…</p>
        </div>
      )}

      {/* Pre-scan */}
      {!hasScanned && (
        <div className="text-center py-10 space-y-2">
          <p className="text-4xl">🧠</p>
          <p className="text-zinc-400 text-sm font-semibold">Smart Money Concept Scanner</p>
          <p className="text-zinc-600 text-xs max-w-sm mx-auto">
            Detects Order Blocks, Fair Value Gaps, and Liquidity Sweeps across Nifty 50.<br />
            Alerts fire when price is retesting a bullish Order Block.
          </p>
          <button onClick={handleScan}
            className="mt-2 px-5 py-2 rounded-lg bg-brand-700 hover:bg-brand-600 text-white text-sm font-semibold transition-colors">
            ▶ Scan Now
          </button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isFetching && filtered.length === 0 && data && (
        <div className="text-center py-8">
          <p className="text-zinc-500 text-sm">No results for this filter</p>
        </div>
      )}

      {/* Results */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(sig => <SMCRow key={sig.ticker} sig={sig} onSelect={onSelectTicker} />)}
        </div>
      )}
    </div>
  )
}
