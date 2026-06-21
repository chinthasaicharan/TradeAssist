import { useState } from 'react'
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

export default function App() {
  const [ticker, setTicker] = useState('')

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header bar */}
      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800 px-4 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-xs">TA</span>
            </div>
            <span className="font-bold text-white hidden sm:block">TradeAssist</span>
          </div>
          {/* Search */}
          <StockSearch onSelect={setTicker} currentTicker={ticker} />
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
        {!ticker ? (
          /* Landing state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-brand-900 rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">📈</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Indian Stock Analysis Dashboard</h2>
            <p className="text-gray-400 text-sm max-w-md">
              Search any NSE/BSE stock to get fundamentals, financials, AI-powered SWOT analysis,
              technical support/resistance, trend signals, and similar stocks screener.
            </p>
            <p className="text-xs text-gray-600 mt-1">Use NSE format: <span className="text-brand-500 font-mono">RELIANCE.NS</span> · <span className="text-brand-500 font-mono">TCS.NS</span></p>
            <div className="mt-8 grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
              {[
                'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS',
                'INFY.NS', 'BAJFINANCE.NS', 'ZOMATO.NS',
              ].map(t => (
                <button
                  key={t}
                  onClick={() => setTicker(t)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 font-mono transition text-xs"
                >
                  {t.replace('.NS', '')}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Quote header — full width */}
            <QuoteHeader ticker={ticker} />

            {/* Two-column layout for fundamentals + financials */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2">
                <FundamentalsPanel ticker={ticker} />
              </div>
              <div className="xl:col-span-1">
                <ProfitRevenuePanel ticker={ticker} />
              </div>
            </div>

            {/* Valuation + Cash Flow */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ValuationPanel ticker={ticker} />
              <CashFlowPanel ticker={ticker} />
            </div>

            {/* Holdings — full width */}
            <HoldingsPanel ticker={ticker} />

            {/* AI Insights — full width */}
            <AIInsightsPanel ticker={ticker} />

            {/* Recommendation — full width */}
            <RecommendationPanel ticker={ticker} />

            {/* BTST — full width */}
            <BTSTPanel ticker={ticker} />

            {/* Technical + Trend — side by side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <TechnicalPanel ticker={ticker} />
              <TrendPanel ticker={ticker} />
            </div>

            {/* Screener — full width */}
            <ScreenerPanel ticker={ticker} onSelect={setTicker} />
          </>
        )}
      </main>

      <footer className="border-t border-gray-800 mt-8 px-4 py-4 text-center text-xs text-gray-600">
        TradeAssist · NSE/BSE Indian Stocks · Data from yfinance · For informational purposes only. Not financial advice.
      </footer>

      {/* Floating chat widget — only visible when a ticker is loaded */}
      <ChatWidget ticker={ticker} />
    </div>
  )
}
