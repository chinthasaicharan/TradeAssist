import { useQuery } from '@tanstack/react-query'
import { getStockSummary } from '../api'
import { fmt, fmtCurrency, fmtPct, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'

interface Props { ticker: string }

interface MetricItem {
  label: string
  value: string
  highlight?: boolean
}

export function FundamentalsPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stock-summary', ticker],
    queryFn: () => getStockSummary(ticker),
    enabled: !!ticker,
    staleTime: 300_000,
  })

  const fundamentals = data?.fundamentals

  if (isLoading) return <PanelSkeleton />
  if (isError || !fundamentals) {
    return (
      <div className="panel">
        <p className="panel-title">Fundamentals</p>
        <p className="text-red-400 text-sm">Failed to load fundamentals.</p>
      </div>
    )
  }

  const metrics: MetricItem[] = [
    { label: 'P/E Ratio', value: fmt(fundamentals.pe_ratio, 1) },
    { label: 'EPS (TTM)', value: fundamentals.eps != null ? `${SYM}${fmt(fundamentals.eps)}` : 'N/A' },
    { label: 'Market Cap', value: fmtCurrency(fundamentals.market_cap) },
    { label: 'Beta', value: fmt(fundamentals.beta, 2) },
    { label: 'Dividend Yield', value: fundamentals.dividend_yield != null ? `${fmt(fundamentals.dividend_yield)}%` : 'N/A' },
    { label: 'Price / Book', value: fmt(fundamentals.price_to_book, 2) },
    { label: 'Debt / Equity', value: fmt(fundamentals.debt_to_equity, 2) },
    { label: 'ROE', value: fundamentals.roe != null ? fmtPct(fundamentals.roe) : 'N/A' },
    { label: '52W High', value: fundamentals.week_52_high != null ? `${SYM}${fmt(fundamentals.week_52_high)}` : 'N/A' },
    { label: '52W Low',  value: fundamentals.week_52_low  != null ? `${SYM}${fmt(fundamentals.week_52_low)}`  : 'N/A' },
  ]

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-title">Fundamentals</p>
        {(fundamentals.sector || fundamentals.industry) && (
          <div className="text-right text-xs text-zinc-500">
            {fundamentals.sector && <span className="text-brand-500 font-medium">{fundamentals.sector}</span>}
            {fundamentals.industry && <span className="text-zinc-500"> · {fundamentals.industry}</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="metric-card">
            <span className="metric-label">{m.label}</span>
            <span className="metric-value">{m.value}</span>
          </div>
        ))}
      </div>

      {fundamentals.description && (
        <details className="mt-2">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition">
            Company description
          </summary>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed line-clamp-4">{fundamentals.description}</p>
        </details>
      )}
    </div>
  )
}
