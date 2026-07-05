import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOrbScanner, searchTickers } from '../api'
import { fmt, SYM } from '../utils'
import type { SearchSuggestion } from '../types'

type Interval = '5m' | '15m' | '30m'

interface ORBResult {
  ticker: string
  breakout: 'bullish' | 'bearish'
  orb_high: number
  orb_low: number
  last_close: number
  last_high: number
  last_low: number
  move_pct: number
  volume: number
  volume_vs_avg: number | null
  rsi: number | null
  bars_today: number
  session_date?: string
}

interface Props { onSelectTicker: (ticker: string) => void }

const INTERVAL_LABELS: Record<Interval, string> = {
  '5m': '5 Min', '15m': '15 Min', '30m': '30 Min',
}

// ── Watchlist builder with search autocomplete ────────────────────────────
function WatchlistBuilder({ tickers, onChange }: {
  tickers: string[]
  onChange: (tickers: string[]) => void
}) {
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
    if (e.key === 'Backspace' && !input && tickers.length > 0)
      remove(tickers[tickers.length - 1])
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap gap-1.5 items-center bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 min-h-[42px] cursor-text focus-within:border-brand-500 transition-colors"
        onClick={() => inputRef.current?.focus()}
      >
        {tickers.map(t => (
          <span key={t} className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-mono px-2 py-1 rounded-full transition-colors">
            {t.replace('.NS','').replace('.BO','')}
            <button onClick={e => { e.stopPropagation(); remove(t) }} className="text-gray-500 hover:text-red-400 leading-none ml-0.5">×</button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[140px] flex items-center gap-1.5">
          {isFetching && (
            <svg className="w-3 h-3 text-gray-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); setOpen(true) }}
            onFocus={() => { if (input) setOpen(true) }}
            onKeyDown={handleKeyDown}
            placeholder={tickers.length === 0 ? 'Search stocks to add…' : 'Add more…'}
            className="bg-transparent text-sm text-white placeholder-gray-600 outline-none w-full"
          />
        </div>
        {tickers.length > 0 && (
          <button onClick={() => onChange([])} className="text-xs text-gray-600 hover:text-gray-400 px-1 shrink-0" title="Clear all">Clear</button>
        )}
      </div>

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.map((s, idx) => {
            const already = tickers.includes(s.ticker)
            return (
              <li
                key={s.ticker}
                onClick={() => !already && add(s.ticker)}
                className={`flex items-center justify-between px-3 py-2.5 text-sm transition-colors
                  ${already ? 'opacity-40 cursor-default' : 'cursor-pointer hover:bg-gray-700'}
                  ${idx !== suggestions.length - 1 ? 'border-b border-gray-700/50' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-white font-mono w-20 shrink-0 text-xs">
                    {s.ticker.replace('.NS','').replace('.BO','')}
                  </span>
                  <span className="text-gray-400 text-xs truncate">{s.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-xs text-gray-600">{s.exchange}</span>
                  {already && <span className="text-xs text-brand-500">✓</span>}
                </div>
              </li>
            )
          })}
          <li className="px-3 py-1.5 text-center text-xs text-gray-600 border-t border-gray-700">
            Press Enter to add first result · Backspace to remove last
          </li>
        </ul>
      )}
      {open && debounced.length >= 1 && suggestions.length === 0 && !isFetching && (
        <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-2xl px-3 py-2.5 text-xs text-gray-400">
          No results for "<span className="text-white">{debounced}</span>"
        </div>
      )}
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────
export function ORBScannerPanel({ onSelectTicker }: Props) {
  const [interval, setInterval] = useState<Interval>('15m')
  const [customTickers, setCustomTickers] = useState<string[]>([])
  const [useCustom, setUseCustom] = useState(false)

  const tickersParam = useCustom && customTickers.length > 0 ? customTickers.join(',') : ''

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['orb-scanner', interval, tickersParam],
    queryFn: () => getOrbScanner(interval, tickersParam || undefined),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    enabled: !useCustom || customTickers.length > 0,
  })

  const breakouts: ORBResult[] = data?.breakouts ?? []
  const bullish = breakouts.filter(b => b.breakout === 'bullish')
  const bearish = breakouts.filter(b => b.breakout === 'bearish')
  const updatedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="panel space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="panel-title mb-0">ORB Scanner</p>
          <p className="text-xs text-gray-500 mt-0.5">Opening Range Breakout — stocks crossing today's opening range</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['5m','15m','30m'] as Interval[]).map(i => (
            <button key={i} onClick={() => setInterval(i)}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                interval === i ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}>{INTERVAL_LABELS[i]}</button>
          ))}
          <button
            onClick={() => refetch()} disabled={isFetching}
            className="px-3 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors disabled:opacity-50"
          >{isFetching ? '⟳ Scanning…' : '⟳ Refresh'}</button>
        </div>
      </div>

      {/* Watchlist mode toggle */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer w-fit" onClick={() => setUseCustom(v => !v)}>
            <div className={`w-8 h-4 rounded-full transition-colors relative ${useCustom ? 'bg-brand-600' : 'bg-gray-700'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${useCustom ? 'left-4' : 'left-0.5'}`} />
            </div>
            <span className="text-xs text-gray-400">Custom watchlist</span>
          </label>
          {!useCustom && (
            <span className="text-xs text-gray-600">Default: Nifty 50 ({data?.scanned ?? '…'} stocks)</span>
          )}
        </div>
        {useCustom && <WatchlistBuilder tickers={customTickers} onChange={setCustomTickers} />}
        {useCustom && customTickers.length === 0 && (
          <p className="text-xs text-gray-600">Search and add stocks above to scan them</p>
        )}
      </div>

      {/* Stats */}
      {data && !isLoading && (
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <span className="text-gray-500">Scanned <span className="text-white font-bold">{data.scanned}</span></span>
          <span className="text-emerald-400 font-semibold">▲ {data.bullish_count} bullish</span>
          <span className="text-red-400 font-semibold">▼ {data.bearish_count} bearish</span>
          {data.session_date && <span className="text-gray-600">Session: <span className="text-gray-400">{data.session_date}</span></span>}
          {updatedAt && <span className="text-gray-600 ml-auto">Updated {updatedAt}</span>}
        </div>
      )}

      {/* Loading skeleton */}
      {(isLoading || isFetching) && breakouts.length === 0 && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-800 rounded-lg animate-pulse" />)}
          <p className="text-xs text-gray-600 text-center">Scanning for ORB breakouts…</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isFetching && breakouts.length === 0 && data && (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">No ORB breakouts found</p>
          <p className="text-gray-600 text-xs mt-1">Market may be closed or no stocks have crossed their opening range</p>
        </div>
      )}

      {/* Results */}
      {breakouts.length > 0 && (
        <div className="space-y-3">
          {bullish.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">▲ Bullish Breakouts ({bullish.length})</p>
              <div className="space-y-1.5">
                {bullish.map(b => <ORBRow key={b.ticker} result={b} onSelect={onSelectTicker} />)}
              </div>
            </div>
          )}
          {bearish.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">▼ Bearish Breakdowns ({bearish.length})</p>
              <div className="space-y-1.5">
                {bearish.map(b => <ORBRow key={b.ticker} result={b} onSelect={onSelectTicker} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Result row ─────────────────────────────────────────────────────────────
function ORBRow({ result: b, onSelect }: { result: ORBResult; onSelect: (t: string) => void }) {
  const isBull = b.breakout === 'bullish'
  const color  = isBull ? 'text-emerald-400' : 'text-red-400'
  const bg     = isBull ? 'border-emerald-900/50 hover:border-emerald-700' : 'border-red-900/50 hover:border-red-700'
  const orbRef = isBull ? b.orb_high : b.orb_low

  return (
    <button
      onClick={() => onSelect(b.ticker)}
      className={`w-full flex items-center gap-3 bg-gray-800/60 border ${bg} rounded-lg px-3 py-2.5 transition-all text-left hover:bg-gray-800`}
    >
      <div className="w-24 shrink-0">
        <p className="text-sm font-bold text-white font-mono">{b.ticker.replace('.NS','').replace('.BO','')}</p>
        <p className="text-xs text-gray-500">{b.ticker.endsWith('.NS') ? 'NSE' : 'BSE'}</p>
      </div>
      <div className="w-20 shrink-0">
        <p className={`text-sm font-bold ${color}`}>{SYM}{fmt(b.last_close)}</p>
        <p className="text-xs text-gray-500">{isBull ? '↑' : '↓'} ORB {isBull ? 'H' : 'L'}: {SYM}{fmt(orbRef)}</p>
      </div>
      <div className="w-16 shrink-0 text-center">
        <p className={`text-sm font-bold ${color}`}>{isBull ? '+' : ''}{b.move_pct}%</p>
        <p className="text-xs text-gray-500">from ORB</p>
      </div>
      <div className="w-16 shrink-0 text-center hidden sm:block">
        {b.rsi != null ? (
          <>
            <p className={`text-sm font-bold ${b.rsi < 30 ? 'text-emerald-400' : b.rsi > 70 ? 'text-red-400' : 'text-gray-300'}`}>{b.rsi}</p>
            <p className="text-xs text-gray-500">RSI</p>
          </>
        ) : <p className="text-xs text-gray-600">—</p>}
      </div>
      <div className="w-16 shrink-0 text-center hidden md:block">
        {b.volume_vs_avg != null ? (
          <>
            <p className={`text-sm font-bold ${b.volume_vs_avg > 1.5 ? 'text-amber-400' : 'text-gray-300'}`}>{b.volume_vs_avg}x</p>
            <p className="text-xs text-gray-500">Vol/Avg</p>
          </>
        ) : <p className="text-xs text-gray-600">—</p>}
      </div>
      <div className="ml-auto text-right hidden lg:block shrink-0">
        <p className="text-xs text-gray-400">
          H: <span className="text-emerald-400">{SYM}{fmt(b.orb_high)}</span>
          {' · '}
          L: <span className="text-red-400">{SYM}{fmt(b.orb_low)}</span>
        </p>
        <p className="text-xs text-gray-600">{b.bars_today} bars today</p>
      </div>
      <span className="text-gray-600 shrink-0">›</span>
    </button>
  )
}
