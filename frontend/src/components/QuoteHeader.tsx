import { useQuery } from '@tanstack/react-query'
import { getStockSummary } from '../api'
import { fmt, fmtCurrency, fmtLargeNum } from '../utils'

interface Props { ticker: string }

function currencySymbol(currency: string): string {
  const map: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  }
  return map[currency] ?? currency + ' '
}

/** Horizontal low→high bar with a marker at the current price's position */
function RangeBar({ low, high, current, sym }: { low: number; high: number; current: number; sym: string }) {
  if (!low || !high || high <= low) return null
  const pct = Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100))
  return (
    <div className="min-w-[220px] flex-1">
      <div className="flex justify-between text-[11px] text-gray-500 mb-1">
        <span>52w Low <span className="text-gray-300 font-semibold">{sym}{fmt(low)}</span></span>
        <span className="text-gray-300 font-semibold">{sym}{fmt(high)} <span className="text-gray-500">52w High</span></span>
      </div>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-red-900/60 via-gray-700 to-emerald-900/60">
        <div
          className="absolute -top-[3px] w-3 h-3 rounded-full bg-white border-2 border-brand-500 shadow"
          style={{ left: `calc(${pct}% - 6px)` }}
          title={`${pct.toFixed(0)}% of 52-week range`}
        />
      </div>
    </div>
  )
}

export function QuoteHeader({ ticker }: Props) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['stock-summary', ticker],
    queryFn: () => getStockSummary(ticker),
    enabled: !!ticker,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 2,
    retryDelay: 3000,
  })

  const quote = data?.quote
  const fund = data?.fundamentals

  if (isLoading) {
    return (
      <div className="panel animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-64 mb-2" />
        <div className="h-5 bg-gray-800 rounded w-40" />
      </div>
    )
  }

  if (isError || !quote) {
    const alreadyNSE = ticker.endsWith('.NS') || ticker.endsWith('.BO')
    return (
      <div className="panel border-red-800">
        <div className="flex items-center justify-between gap-4">
          <p className="text-red-400 text-sm">
            Failed to load quote for <strong>{ticker}</strong>.{' '}
            {alreadyNSE
              ? 'Yahoo Finance may be temporarily rate-limited. Try again in a few seconds.'
              : <>For Indian stocks use NSE format e.g. <strong>RELIANCE.NS</strong></>
            }
          </p>
          <button
            onClick={() => refetch()}
            className="shrink-0 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const positive = quote.change >= 0
  const sym = currencySymbol(quote.currency)
  const marketOpen = quote.market_status === 'regular' || quote.market_status === 'open'

  return (
    <div className="panel space-y-4">
      {/* Top row: identity + price */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-extrabold text-white">{quote.ticker}</h1>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1.5 ${
              marketOpen ? 'bg-emerald-900 text-emerald-400' : 'bg-gray-700 text-gray-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
              {quote.market_status?.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <p className="text-gray-400 text-sm">{quote.name}</p>
            {fund?.sector && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
                {fund.sector}
              </span>
            )}
            {fund?.industry && fund.industry !== fund.sector && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800/60 border border-gray-800 text-gray-500 truncate max-w-[220px]">
                {fund.industry}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-end gap-6 flex-wrap">
          <div className="text-right">
            <p className="text-4xl font-black text-white tabular-nums">{sym}{fmt(quote.current_price)}</p>
            <p className={`text-sm font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {positive ? '▲' : '▼'} {sym}{fmt(Math.abs(quote.change))} ({fmt(Math.abs(quote.change_pct), 2)}%)
            </p>
          </div>
          <div className="text-right text-sm text-gray-400">
            <p>Mkt Cap: <span className="text-white font-semibold">{fmtCurrency(fund?.market_cap ?? null, quote.currency)}</span></p>
            <p>Vol: <span className="text-white">{fmtLargeNum(quote.volume)}</span>
              {quote.avg_volume > 0 && (
                <span className={quote.volume > quote.avg_volume ? 'text-amber-400' : ''}>
                  {' '}· {fmtLargeNum(quote.avg_volume)} avg
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom row: 52-week range */}
      {fund?.week_52_low != null && fund?.week_52_high != null && (
        <div className="pt-1">
          <RangeBar low={fund.week_52_low} high={fund.week_52_high} current={quote.current_price} sym={sym} />
        </div>
      )}
    </div>
  )
}
