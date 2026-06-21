import { useQuery } from '@tanstack/react-query'
import { getFundamentals } from '../api'
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
    queryKey: ['fundamentals', ticker],
    queryFn: () => getFundamentals(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) {
    return (
      <div className="panel">
        <p className="panel-title">Fundamentals</p>
        <p className="text-red-400 text-sm">Failed to load fundamentals.</p>
      </div>
    )
  }

  const metrics: MetricItem[] = [
    { label: 'P/E Ratio', value: fmt(data.pe_ratio, 1) },
    { label: 'EPS (TTM)', value: data.eps != null ? `${SYM}${fmt(data.eps)}` : 'N/A' },
    { label: 'Market Cap', value: fmtCurrency(data.market_cap) },
    { label: 'Beta', value: fmt(data.beta, 2) },
    { label: 'Dividend Yield', value: data.dividend_yield != null ? fmtPct(data.dividend_yield) : 'N/A' },
    { label: 'Price / Book', value: fmt(data.price_to_book, 2) },
    { label: 'Debt / Equity', value: fmt(data.debt_to_equity, 2) },
    { label: 'ROE', value: data.roe != null ? fmtPct(data.roe) : 'N/A' },
    { label: '52W High', value: data.week_52_high != null ? `${SYM}${fmt(data.week_52_high)}` : 'N/A' },
    { label: '52W Low',  value: data.week_52_low  != null ? `${SYM}${fmt(data.week_52_low)}`  : 'N/A' },
  ]

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-title">Fundamentals</p>
        {(data.sector || data.industry) && (
          <div className="text-right text-xs text-gray-500">
            {data.sector && <span className="text-brand-500 font-medium">{data.sector}</span>}
            {data.industry && <span className="text-gray-500"> · {data.industry}</span>}
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

      {data.description && (
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition">
            Company description
          </summary>
          <p className="mt-2 text-xs text-gray-400 leading-relaxed line-clamp-4">{data.description}</p>
        </details>
      )}
    </div>
  )
}
