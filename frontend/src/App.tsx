import { useState, useEffect, useCallback, Component, type ReactNode } from 'react'
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

const LS_LAST    = 'ta_last_ticker'
const LS_FAVS    = 'ta_favourites'
const MAX_FAVS   = 12

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

  // All hooks must run unconditionally before any early return
  useEffect(() => {
    if (ticker) {
      try { localStorage.setItem(LS_LAST, ticker) } catch {}
    }
  }, [ticker])

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
            <PanelBoundary name="Chart"><ChartPanel ticker={ticker} /></PanelBoundary>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2"><PanelBoundary name="Fundamentals"><FundamentalsPanel ticker={ticker} /></PanelBoundary></div>
              <div className="xl:col-span-1"><PanelBoundary name="Financials"><ProfitRevenuePanel ticker={ticker} /></PanelBoundary></div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PanelBoundary name="Valuation"><ValuationPanel ticker={ticker} /></PanelBoundary>
              <PanelBoundary name="CashFlow"><CashFlowPanel ticker={ticker} /></PanelBoundary>
            </div>
            <PanelBoundary name="Holdings"><HoldingsPanel ticker={ticker} /></PanelBoundary>
            <PanelBoundary name="AI Insights"><AIInsightsPanel ticker={ticker} /></PanelBoundary>
            <PanelBoundary name="Recommendation"><RecommendationPanel ticker={ticker} companyName={companyName} /></PanelBoundary>
            <PanelBoundary name="BTST"><BTSTPanel ticker={ticker} companyName={companyName} /></PanelBoundary>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PanelBoundary name="Technical"><TechnicalPanel ticker={ticker} /></PanelBoundary>
              <PanelBoundary name="Trend"><TrendPanel ticker={ticker} /></PanelBoundary>
            </div>
            <PanelBoundary name="Screener"><ScreenerPanel ticker={ticker} onSelect={handleSelect} /></PanelBoundary>
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
