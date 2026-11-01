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
      <div className="flex justify-between text-[11px] text-zinc-600 mb-1">
        <span>52w Low <span className="text-zinc-400 font-medium">{sym}{fmt(low)}</span></span>
        <span className="text-zinc-400 font-medium">{sym}{fmt(high)} <span className="text-zinc-600">52w High</span></span>
      </div>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-red-500/20 via-zinc-600/40 to-emerald-500/20">
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
        <div className="h-9 bg-white/[0.06] rounded-lg w-64 mb-2.5" />
        <div className="h-3.5 bg-white/[0.06] rounded w-40" />
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
            className="shrink-0 text-xs px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-lg transition-colors"
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
            <h1 className="text-3xl font-semibold tracking-tight text-white">{quote.ticker}</h1>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1.5 ${
              marketOpen ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/25' : 'bg-white/[0.06] text-zinc-400 ring-1 ring-inset ring-white/[0.08]'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
              {quote.market_status?.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <p className="text-zinc-500 text-sm">{quote.name}</p>
            {fund?.sector && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-zinc-400">
                {fund.sector}
              </span>
            )}
            {fund?.industry && fund.industry !== fund.sector && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.05] text-zinc-600 truncate max-w-[220px]">
                {fund.industry}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-end gap-6 flex-wrap">
          <div className="text-right">
            <p className="text-4xl font-semibold tracking-tight text-white tabular-nums">{sym}{fmt(quote.current_price)}</p>
            <p className={`text-sm font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {positive ? '▲' : '▼'} {sym}{fmt(Math.abs(quote.change))} ({fmt(Math.abs(quote.change_pct), 2)}%)
            </p>
          </div>
          <div className="text-right text-sm text-zinc-500">
            <p>Mkt Cap: <span className="text-zinc-200 font-medium">{fmtCurrency(fund?.market_cap ?? null, quote.currency)}</span></p>
            <p>Vol: <span className="text-zinc-200">{fmtLargeNum(quote.volume)}</span>
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
