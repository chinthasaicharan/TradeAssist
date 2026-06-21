import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchTickers } from '../api'
import type { SearchSuggestion } from '../types'

interface Props {
  onSelect: (ticker: string) => void
  currentTicker: string
}

export function StockSearch({ onSelect, currentTicker }: Props) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce — 250ms feels snappy for a local-first search
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

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (ticker: string) => {
    setInput('')
    setOpen(false)
    onSelect(ticker)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      // If there's an exact suggestion match, use it; otherwise auto-format
      if (suggestions.length > 0) {
        handleSelect(suggestions[0].ticker)
      } else {
        const raw = input.trim().toUpperCase()
        handleSelect(!raw.includes('.') ? `${raw}.NS` : raw)
      }
    }
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      // Simple: select first suggestion on ArrowDown from input
      handleSelect(suggestions[0].ticker)
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          {isFetching
            ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
          }
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search Nifty 500 — Reliance, TCS, HDFC, Zomato…"
          className="w-full pl-9 pr-28 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white
                     placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1
                     focus:ring-brand-500 transition text-sm"
          aria-label="Search for a stock"
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {currentTicker && (
            <span className="text-xs font-bold text-brand-400 bg-brand-900/60 px-2 py-0.5 rounded font-mono">
              {currentTicker.replace('.NS','').replace('.BO','')}
            </span>
          )}
          <span className="text-xs text-gray-600 hidden sm:block">N500</span>
        </div>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl
                     shadow-2xl overflow-hidden max-h-80 overflow-y-auto"
          role="listbox"
          aria-label="Stock suggestions"
        >
          {suggestions.map((s, idx) => (
            <li
              key={s.ticker}
              role="option"
              aria-selected={false}
              onClick={() => handleSelect(s.ticker)}
              className={`flex items-center justify-between px-4 py-3 cursor-pointer
                         hover:bg-gray-700 transition-colors
                         ${idx === 0 ? 'border-b border-gray-700/50' : ''}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-bold text-white text-sm font-mono w-24 shrink-0">
                  {s.ticker.replace('.NS','').replace('.BO','')}
                </span>
                <span className="text-gray-300 text-sm truncate">{s.name}</span>
              </div>
              <span className="text-xs text-gray-600 shrink-0 ml-2">{s.exchange}</span>
            </li>
          ))}
          <li className="px-4 py-2 text-center text-xs text-gray-600 border-t border-gray-700">
            Nifty 500 · Press Enter to load first result
          </li>
        </ul>
      )}

      {open && debounced.length >= 1 && suggestions.length === 0 && !isFetching && (
        <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-700 rounded-xl shadow-2xl px-4 py-3 text-sm text-gray-400">
          No results for "<span className="text-white">{debounced}</span>" — try the full company name or NSE symbol
        </div>
      )}
    </div>
  )
}
