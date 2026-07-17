import { useState, useEffect, useCallback, Component, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { StockSearch } from './components/StockSearch'
import { QuoteHeader } from './components/QuoteHeader'
import { FundamentalsPanel } from './components/FundamentalsPanel'
import { ProfitRevenuePanel } from './components/ProfitRevenuePanel'
import { ValuationPanel } from './components/ValuationPanel'
import { CashFlowPanel } from './components/CashFlowPanel'
import { AIInsightsPanel } from './components/AIInsightsPanel'
import { TechnicalPanel } from './components/TechnicalPanel'
import { TrendPanel } from './components/TrendPanel'
import { RecommendationPanel } from './components/RecommendationPanel'
import { ScreenerPanel } from './components/ScreenerPanel'
import { HoldingsPanel } from './components/HoldingsPanel'
import { BTSTPanel } from './components/BTSTPanel'
import { ChatWidget } from './components/ChatWidget'
import { ChartPanel } from './components/ChartPanel'
import { useAuth } from './AuthContext'
import { AuthPage } from './components/AuthPage'
import { PaperTradesPanel } from './components/PaperTradesPanel'
import { Logo } from './components/Logo'
import { ORBScannerPanel } from './components/ORBScannerPanel'
import { SmartMoneyPanel } from './components/SmartMoneyPanel'
import { PineScriptPanel } from './components/PineScriptPanel'
import { SwingPanel } from './components/SwingPanel'
import { SwingSearchWidget } from './components/SwingSearchWidget'
import { getRecommendation, getSwing } from './api'

// ── Buy/Sell badge shown inline on the section header ─────────────────────
const SIGNAL_STYLE: Record<string, string> = {
  'Strong Buy':  'bg-emerald-900 text-emerald-300 border-emerald-600',
  'Buy':         'bg-emerald-950 text-emerald-400 border-emerald-700',
  'Hold':        'bg-gray-800    text-gray-400    border-gray-600',
  'Sell':        'bg-red-950     text-red-400     border-red-700',
  'Strong Sell': 'bg-red-900     text-red-300     border-red-600',
}

function SignalBadge({ ticker }: { ticker: string }) {
  const { data } = useQuery({
    queryKey: ['recommendation', ticker],
    queryFn:  () => getRecommendation(ticker),
    enabled:  !!ticker,
    staleTime: 5 * 60_000,
  })
  if (!data) return null
  const style = SIGNAL_STYLE[data.recommendation] ?? SIGNAL_STYLE['Hold']
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${style}`}>
      {data.recommendation === 'Strong Buy' || data.recommendation === 'Buy' ? '▲' :
       data.recommendation === 'Strong Sell' || data.recommendation === 'Sell' ? '▼' : '—'}
      {data.recommendation}
      <span className="text-[10px] opacity-70 font-normal">{data.confidence_pct.toFixed(0)}%</span>
    </span>
  )
}

// ── Swing badge shown inline on the Swing Trade section header ────────────
const SWING_STYLE: Record<string, string> = {
  'Strong Swing Buy':  'bg-emerald-900 text-emerald-300 border-emerald-600',
  'Swing Buy':         'bg-emerald-950 text-emerald-400 border-emerald-700',
  'Neutral':           'bg-gray-800    text-gray-400    border-gray-600',
  'Swing Sell':        'bg-red-950     text-red-400     border-red-700',
  'Strong Swing Sell': 'bg-red-900     text-red-300     border-red-600',
}

function SwingBadge({ ticker }: { ticker: string }) {
  const { data } = useQuery({
    queryKey: ['swing', ticker],
    queryFn:  () => getSwing(ticker),
    enabled:  !!ticker,
    staleTime: 60 * 60_000,
  })
  if (!data) return null
  const style = SWING_STYLE[data.verdict] ?? SWING_STYLE['Neutral']
  const arrow = data.verdict.includes('Buy') ? '▲' : data.verdict.includes('Sell') ? '▼' : '—'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${style}`}>
      {arrow} {data.verdict}
      <span className="text-[10px] opacity-70 font-normal">{data.probability_pct.toFixed(0)}% prob</span>
    </span>
  )
}

// ── Per-panel error boundary ──────────────────────────────────────────────
class PanelBoundary extends Component<{ children: ReactNode; name: string }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  render() {
    if (this.state.err) return (
      <div className="panel">
        <p className="text-yellow-400 text-xs">⚠ {this.props.name} failed to render.</p>
      </div>
    )
    return this.props.children
  }
}

const LS_LAST     = 'ta_last_ticker'
const LS_FAVS     = 'ta_favourites'
const LS_SECTIONS = 'ta_sections_open'
const MAX_FAVS    = 12

// ── Section definitions (order = display order) ───────────────────────────
const SECTIONS = [
  { key: 'chart',          label: '📈 Chart',          defaultOpen: true  },
  { key: 'recommendation', label: '🎯 Signal',         defaultOpen: true  },
  { key: 'swing',          label: '🔄 Swing Trade',    defaultOpen: true  },
  { key: 'fundamentals',   label: '🏦 Fundamentals',   defaultOpen: true  },
  { key: 'valuation',      label: '⚖️ Valuation',      defaultOpen: false },
  { key: 'cashflow',       label: '💸 Cash Flow',      defaultOpen: false },
  { key: 'holdings',       label: '🏛️ Holdings',       defaultOpen: false },
  { key: 'btst',           label: '⚡ BTST',            defaultOpen: false },
  { key: 'technical',      label: '🔬 Technical',      defaultOpen: false },
  { key: 'insights',       label: '🤖 AI Insights',    defaultOpen: false },
  { key: 'screener',       label: '🔍 Screener',       defaultOpen: false },
  { key: 'strategies',     label: '📜 Strategies',     defaultOpen: false },
] as const

type SectionKey = typeof SECTIONS[number]['key']

function loadSections(): Record<SectionKey, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_SECTIONS) ?? '{}')
    const defaults = Object.fromEntries(SECTIONS.map(s => [s.key, s.defaultOpen])) as Record<SectionKey, boolean>
    return { ...defaults, ...saved }
  } catch {
    return Object.fromEntries(SECTIONS.map(s => [s.key, s.defaultOpen])) as Record<SectionKey, boolean>
  }
}
function saveSections(s: Record<SectionKey, boolean>) {
  try { localStorage.setItem(LS_SECTIONS, JSON.stringify(s)) } catch {}
}

// ── Collapsible section wrapper ───────────────────────────────────────────
function Section({ label, open, onToggle, badge, children }: {
  label: string; open: boolean; onToggle: () => void
  badge?: ReactNode; children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-900 hover:bg-gray-800/80 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-gray-200">{label}</span>
          {badge}
        </div>
        <span className={`text-gray-500 text-xs transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="bg-gray-950">{children}</div>}
    </div>
  )
}

// Known renamed tickers — auto-redirect localStorage to new symbol
const TICKER_ALIASES: Record<string, string> = {
  'ZOMATO.NS': 'ETERNAL.NS',
  'ZOMATO.BO': 'ETERNAL.BO',
}

function resolveAlias(t: string): { ticker: string; renamed: string | null } {
  const mapped = TICKER_ALIASES[t.toUpperCase()]
  return mapped ? { ticker: mapped, renamed: t } : { ticker: t, renamed: null }
}

function loadLast(): string {
  try { return localStorage.getItem(LS_LAST) ?? '' } catch { return '' }
}
function loadFavs(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_FAVS) ?? '[]') } catch { return [] }
}
function saveFavs(f: string[]) {
  try { localStorage.setItem(LS_FAVS, JSON.stringify(f)) } catch {}
}

export default function App() {
  const { user, loading, logout } = useAuth()
  const [ticker, setTicker] = useState<string>(() => {
    const raw = loadLast()
    return resolveAlias(raw).ticker   // resolve alias on initial load
  })
  const [favs, setFavs] = useState<string[]>(loadFavs)
  const [companyName, setCompanyName] = useState<string>('')
  const [renamedFrom, setRenamedFrom] = useState<string | null>(() => {
    const raw = loadLast()
    return resolveAlias(raw).renamed
  })
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(loadSections)

  useEffect(() => {
    if (ticker) {
      try { localStorage.setItem(LS_LAST, ticker) } catch {}
    }
  }, [ticker])

  const toggleSection = useCallback((key: SectionKey) => {
    setOpen(prev => {
      const next = { ...prev, [key]: !prev[key] }
      saveSections(next)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    const next = Object.fromEntries(SECTIONS.map(s => [s.key, true])) as Record<SectionKey, boolean>
    setOpen(next); saveSections(next)
  }, [])

  const collapseAll = useCallback(() => {
    const next = Object.fromEntries(SECTIONS.map(s => [s.key, false])) as Record<SectionKey, boolean>
    setOpen(next); saveSections(next)
  }, [])

  const handleSelect = useCallback((t: string, name?: string) => {
    setTicker(t)
    setRenamedFrom(null)
    if (name) setCompanyName(name)
    else setCompanyName(t)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const isFav = favs.includes(ticker)
  const toggleFav = () => {
    setFavs(prev => {
      const next = prev.includes(ticker)
        ? prev.filter(f => f !== ticker)
        : [ticker, ...prev].slice(0, MAX_FAVS)
      saveFavs(next)
      return next
    })
  }
  const removeFav = (t: string) => {
    setFavs(prev => { const next = prev.filter(f => f !== t); saveFavs(next); return next })
  }

  // Early returns AFTER all hooks
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }
  if (!user) return <AuthPage />

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header bar */}
      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800 px-4 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3">
          {/* Logo — click to go home */}
          <div
            className="flex items-center gap-2 shrink-0 cursor-pointer"
            onClick={() => setTicker('')}
            title="Home"
          >
            <Logo size={32} className="hover:opacity-80 transition-opacity" />
            <span className="font-bold text-white hidden sm:block hover:text-brand-400 transition-colors">TradeAssist</span>
          </div>
          {/* Search */}
          <StockSearch onSelect={handleSelect} currentTicker={ticker} />
          {/* Favourite star — only when a stock is loaded */}
          {ticker && (
            <button
              onClick={toggleFav}
              title={isFav ? 'Remove from favourites' : 'Add to favourites'}
              className={`shrink-0 text-xl transition-transform hover:scale-110 ${
                isFav ? 'text-amber-400' : 'text-gray-600 hover:text-amber-300'
              }`}
            >
              {isFav ? '★' : '☆'}
            </button>
          )}
          {/* User + logout */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <span className="text-xs text-gray-500 hidden sm:block">
              {user.username}
            </span>
            <button
              onClick={logout}
              title="Sign out"
              className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Favourites bar */}
        {favs.length > 0 && (
          <div className="max-w-screen-2xl mx-auto mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="text-xs text-gray-600 shrink-0">★</span>
            {favs.map(f => (
              <div key={f} className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => handleSelect(f)}
                  className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold transition-colors ${
                    f === ticker
                      ? 'bg-brand-700 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {f.replace('.NS', '').replace('.BO', '')}
                </button>
                <button
                  onClick={() => removeFav(f)}
                  className="text-gray-700 hover:text-gray-400 text-xs px-0.5"
                  title="Remove"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
        {!ticker ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center mb-6">
              <Logo size={64} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Indian Stock Analysis Dashboard</h2>
            <p className="text-gray-400 text-sm max-w-md">
              Search any NSE/BSE stock to get fundamentals, financials, AI-powered SWOT analysis,
              technical support/resistance, trend signals, and similar stocks screener.
            </p>
            <p className="text-xs text-gray-600 mt-1">Use NSE format: <span className="text-brand-500 font-mono">RELIANCE.NS</span> · <span className="text-brand-500 font-mono">TCS.NS</span></p>

            {/* ── Swing Trade Analyser ─────────────────────────────── */}
            <div className="mt-10 w-full max-w-2xl">
              <SwingSearchWidget onSelectTicker={handleSelect} />
            </div>

            {/* Favourites section */}
            {favs.length > 0 && (
              <div className="mt-10 w-full max-w-lg">
                <p className="text-xs text-amber-400 font-semibold uppercase tracking-widest mb-3">★ Your Favourites</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {favs.map(f => (
                    <button
                      key={f}
                      onClick={() => handleSelect(f)}
                      className="group relative bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-brand-600 rounded-xl px-3 py-3 text-center transition-all"
                    >
                      <p className="text-sm font-bold text-white font-mono">
                        {f.replace('.NS','').replace('.BO','')}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">NSE</p>
                      <button
                        onClick={e => { e.stopPropagation(); removeFav(f) }}
                        className="absolute top-1 right-1.5 text-gray-700 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove"
                      >×</button>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Paper trades — always visible on homepage */}
            <div className="mt-8 w-full max-w-3xl">
              <PanelBoundary name="PaperTrades">
                <PaperTradesPanel onSelectTicker={handleSelect} compact />
              </PanelBoundary>
            </div>

            {/* ORB Scanner */}
            <div className="mt-6 w-full max-w-3xl">
              <PanelBoundary name="ORBScanner">
                <ORBScannerPanel onSelectTicker={handleSelect} />
              </PanelBoundary>
            </div>

            {/* Smart Money Scanner */}
            <div className="mt-6 w-full max-w-3xl">
              <PanelBoundary name="SmartMoney">
                <SmartMoneyPanel onSelectTicker={handleSelect} />
              </PanelBoundary>
            </div>

            {/* Quick picks */}
            <div className="mt-8 w-full max-w-lg">
              <p className="text-xs text-gray-600 font-semibold uppercase tracking-widest mb-3">Quick picks</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','BAJFINANCE.NS','ETERNAL.NS'].map(t => (
                  <button
                    key={t}
                    onClick={() => handleSelect(t)}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 font-mono transition text-xs"
                  >
                    {t.replace('.NS', '')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <PanelBoundary name="Quote"><QuoteHeader ticker={ticker} /></PanelBoundary>
            {renamedFrom && (
              <div className="flex items-center justify-between gap-3 bg-amber-950 border border-amber-700 rounded-xl px-4 py-3 text-sm">
                <p className="text-amber-300">
                  <span className="font-bold">{renamedFrom.replace('.NS','').replace('.BO','')}</span> has been renamed to{' '}
                  <span className="font-bold">{ticker.replace('.NS','').replace('.BO','')}</span>. Showing data for the new ticker.
                </p>
                <button onClick={() => setRenamedFrom(null)} className="text-amber-500 hover:text-amber-300 text-lg leading-none shrink-0">×</button>
              </div>
            )}

            {/* ── Section toggle bar ───────────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-600 font-semibold uppercase tracking-wide shrink-0 mr-1">Sections</span>
                {SECTIONS.map(s => (
                  <button
                    key={s.key}
                    onClick={() => toggleSection(s.key)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap ${
                      open[s.key]
                        ? 'bg-brand-700/30 text-brand-300 border-brand-700'
                        : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                <div className="ml-auto flex gap-1.5 shrink-0">
                  <button onClick={expandAll}    className="text-xs text-gray-600 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors">All ▼</button>
                  <button onClick={collapseAll}  className="text-xs text-gray-600 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors">All ▲</button>
                </div>
              </div>
            </div>

            {/* ── Collapsible sections ─────────────────────────────────── */}
            <div className="space-y-2">

              <Section label="📈 Chart" open={open.chart} onToggle={() => toggleSection('chart')}>
                <PanelBoundary name="Chart"><ChartPanel ticker={ticker} /></PanelBoundary>
              </Section>

              <Section label="🎯 Signal" open={open.recommendation} onToggle={() => toggleSection('recommendation')}
                badge={<SignalBadge ticker={ticker} />}>
                <PanelBoundary name="Recommendation"><RecommendationPanel ticker={ticker} companyName={companyName} /></PanelBoundary>
              </Section>

              <Section label="🔄 Swing Trade" open={open.swing} onToggle={() => toggleSection('swing')}
                badge={<SwingBadge ticker={ticker} />}>
                <PanelBoundary name="Swing"><SwingPanel ticker={ticker} companyName={companyName} /></PanelBoundary>
              </Section>

              <Section label="🏦 Fundamentals" open={open.fundamentals} onToggle={() => toggleSection('fundamentals')}>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 p-3">
                  <div className="xl:col-span-2"><PanelBoundary name="Fundamentals"><FundamentalsPanel ticker={ticker} /></PanelBoundary></div>
                  <div className="xl:col-span-1"><PanelBoundary name="ProfitRevenue"><ProfitRevenuePanel ticker={ticker} /></PanelBoundary></div>
                </div>
              </Section>

              <Section label="⚖️ Valuation" open={open.valuation} onToggle={() => toggleSection('valuation')}>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-3">
                  <PanelBoundary name="Valuation"><ValuationPanel ticker={ticker} /></PanelBoundary>
                  <PanelBoundary name="CashFlow"><CashFlowPanel ticker={ticker} /></PanelBoundary>
                </div>
              </Section>

              <Section label="💸 Cash Flow" open={open.cashflow} onToggle={() => toggleSection('cashflow')}>
                <PanelBoundary name="CashFlow-s"><CashFlowPanel ticker={ticker} /></PanelBoundary>
              </Section>

              <Section label="🏛️ Holdings" open={open.holdings} onToggle={() => toggleSection('holdings')}>
                <PanelBoundary name="Holdings"><HoldingsPanel ticker={ticker} /></PanelBoundary>
              </Section>

              <Section label="⚡ BTST" open={open.btst} onToggle={() => toggleSection('btst')}>
                <PanelBoundary name="BTST"><BTSTPanel ticker={ticker} companyName={companyName} /></PanelBoundary>
              </Section>

              <Section label="🔬 Technical" open={open.technical} onToggle={() => toggleSection('technical')}>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-3">
                  <PanelBoundary name="Technical"><TechnicalPanel ticker={ticker} /></PanelBoundary>
                  <PanelBoundary name="Trend"><TrendPanel ticker={ticker} /></PanelBoundary>
                </div>
              </Section>

              <Section label="🤖 AI Insights" open={open.insights} onToggle={() => toggleSection('insights')}>
                <PanelBoundary name="AI Insights"><AIInsightsPanel ticker={ticker} /></PanelBoundary>
              </Section>

              <Section label="🔍 Screener" open={open.screener} onToggle={() => toggleSection('screener')}>
                <PanelBoundary name="Screener"><ScreenerPanel ticker={ticker} onSelect={handleSelect} /></PanelBoundary>
              </Section>

              <Section label="📜 Pine Script Strategies" open={open.strategies} onToggle={() => toggleSection('strategies')}>
                <PanelBoundary name="Strategies">
                  <PineScriptPanel ticker={ticker} onClose={() => toggleSection('strategies')} />
                </PanelBoundary>
              </Section>

            </div>
          </>
        )}
      </main>

      <footer className="border-t border-gray-800 mt-8 px-4 py-4 text-center text-xs text-gray-600">
        TradeAssist · NSE/BSE Indian Stocks · Data from yfinance · For informational purposes only. Not financial advice.
      </footer>

      <ChatWidget ticker={ticker} />
    </div>
  )
}
