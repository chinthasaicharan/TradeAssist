import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getScreener } from '../api'
import { fmtCurrency, fmt } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { SimilarStock } from '../types'

interface Props {
  ticker: string
  onSelect: (ticker: string) => void
}

type SortKey = keyof Pick<SimilarStock, 'similarity_score' | 'market_cap' | 'pe_ratio' | 'price_change_1y'>

export function ScreenerPanel({ ticker, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('similarity_score')
  const [sortAsc, setSortAsc] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['screener', ticker],
    queryFn: () => getScreener(ticker),
    enabled: !!ticker,
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) {
    return (
      <div className="panel">
        <p className="panel-title">Similar Stocks Screener</p>
        <p className="text-red-400 text-sm">Failed to load screener data.</p>
      </div>
    )
  }

  const sorted = [...data.similar].sort((a, b) => {
    const av = a[sortKey] ?? -Infinity
    const bv = b[sortKey] ?? -Infinity
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      className="px-3 py-2 text-left cursor-pointer select-none hover:text-white transition"
      onClick={() => handleSort(k)}
      aria-sort={sortKey === k ? (sortAsc ? 'ascending' : 'descending') : 'none'}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === k && <span className="text-brand-400">{sortAsc ? '↑' : '↓'}</span>}
      </span>
    </th>
  )

  return (
    <div className="panel space-y-4">
      <p className="panel-title">Similar Stocks Screener</p>

      {sorted.length === 0 ? (
        <p className="text-gray-500 text-sm">No similar stocks found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" role="grid">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800">
                <th className="px-3 py-2 text-left">Ticker</th>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">Sector</th>
                <SortHeader label="Market Cap" k="market_cap" />
                <SortHeader label="P/E" k="pe_ratio" />
                <SortHeader label="1Y Return" k="price_change_1y" />
                <SortHeader label="Similarity" k="similarity_score" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(stock => (
                <tr
                  key={stock.ticker}
                  onClick={() => onSelect(stock.ticker)}
                  className="border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition"
                  role="row"
                  aria-label={`Load ${stock.ticker}`}
                >
                  <td className="px-3 py-3 font-bold text-brand-400">{stock.ticker}</td>
                  <td className="px-3 py-3 text-gray-300 max-w-[160px] truncate">{stock.name}</td>
                  <td className="px-3 py-3 text-gray-500">{stock.sector}</td>
                  <td className="px-3 py-3 text-white">{fmtCurrency(stock.market_cap)}</td>
                  <td className="px-3 py-3 text-white">{fmt(stock.pe_ratio, 1)}</td>
                  <td className={`px-3 py-3 font-semibold ${
                    stock.price_change_1y == null ? 'text-gray-500'
                      : stock.price_change_1y >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {stock.price_change_1y != null ? `${stock.price_change_1y >= 0 ? '+' : ''}${fmt(stock.price_change_1y, 1)}%` : 'N/A'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-700 rounded-full h-1.5 w-16">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full"
                          style={{ width: `${(stock.similarity_score * 100).toFixed(0)}%` }}
                        />
                      </div>
                      <span className="text-gray-300 w-8 text-right">
                        {(stock.similarity_score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
