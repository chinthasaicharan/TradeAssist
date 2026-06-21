import { useQuery } from '@tanstack/react-query'
import { getQuote } from '../api'
import { fmt, fmtLargeNum } from '../utils'

interface Props { ticker: string }

function currencySymbol(currency: string): string {
  const map: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  }
  return map[currency] ?? currency + ' '
}

export function QuoteHeader({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['quote', ticker],
    queryFn: () => getQuote(ticker),
    enabled: !!ticker,
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="panel animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-64 mb-2" />
        <div className="h-5 bg-gray-800 rounded w-40" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="panel border-red-800">
        <p className="text-red-400 text-sm">
          Failed to load quote for <strong>{ticker}</strong>.
          {' '}For Indian stocks use NSE format e.g. <strong>RELIANCE.NS</strong>
        </p>
      </div>
    )
  }

  const positive = data.change >= 0
  const sym = currencySymbol(data.currency)

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold text-white">{data.ticker}</h1>
          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
            data.market_status === 'regular' || data.market_status === 'open'
              ? 'bg-emerald-900 text-emerald-400'
              : 'bg-gray-700 text-gray-400'
          }`}>
            {data.market_status?.toUpperCase()}
          </span>
        </div>
        <p className="text-gray-400 text-sm mt-1">{data.name} · {data.exchange} · {data.currency}</p>
      </div>

      <div className="flex items-end gap-6 flex-wrap">
        <div className="text-right">
          <p className="text-4xl font-black text-white">{sym}{fmt(data.current_price)}</p>
          <p className={`text-sm font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {positive ? '▲' : '▼'} {sym}{fmt(Math.abs(data.change))} ({fmt(Math.abs(data.change_pct), 2)}%)
          </p>
        </div>
        <div className="text-right text-sm text-gray-400">
          <p>Vol: <span className="text-white">{fmtLargeNum(data.volume)}</span></p>
          <p>Avg Vol: <span className="text-white">{fmtLargeNum(data.avg_volume)}</span></p>
        </div>
      </div>
    </div>
  )
}
