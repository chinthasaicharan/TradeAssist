import { useQuery } from '@tanstack/react-query'
import { getHoldings } from '../api'
import { fmt, fmtLargeNum, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { HolderEntry } from '../types'

interface Props { ticker: string }

function PieSlice({ label, pct, color }: { label: string; pct: number | null; color: string }) {
  if (pct == null) return null
  return (
    <div className="flex items-center gap-3">
      <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-0.5">
          <span className="text-gray-400">{label}</span>
          <span className="font-bold text-white">{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
        </div>
      </div>
    </div>
  )
}

function HolderRow({ h, rank }: { h: HolderEntry; rank: number }) {
  return (
    <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2.5">
      <span className="text-xs font-bold text-gray-600 w-4 shrink-0">#{rank}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white truncate">{h.name}</p>
        {h.value != null && (
          <p className="text-xs text-gray-500">{SYM}{fmtLargeNum(h.value)}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        {h.pct_held != null && (
          <p className="text-sm font-bold text-brand-400">{h.pct_held.toFixed(2)}%</p>
        )}
        {h.shares != null && (
          <p className="text-xs text-gray-500">{fmtLargeNum(h.shares)} shares</p>
        )}
      </div>
    </div>
  )
}

export function HoldingsPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['holdings', ticker],
    queryFn: () => getHoldings(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Institutional & MF Holdings</p>
      <p className="text-yellow-500 text-sm">Holdings data not available for this ticker.</p>
    </div>
  )

  const hasData = data.pct_institutional != null || data.top_institutions.length > 0 || data.top_mutual_funds.length > 0

  return (
    <div className="panel space-y-5">
      <div className="flex items-center justify-between">
        <p className="panel-title">Institutional · DII · MF Holdings</p>
        <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
          data.inst_trend.includes('high') ? 'bg-emerald-900 text-emerald-400' :
          data.inst_trend.includes('low')  ? 'bg-red-900 text-red-400' :
          'bg-gray-700 text-gray-400'
        }`}>
          {data.inst_trend}
        </span>
      </div>

      {!hasData ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <p className="text-3xl mb-2">📊</p>
          <p>Detailed holding data not available via yfinance for this ticker.</p>
          <p className="text-xs mt-1 text-gray-600">Indian listed stocks may have limited coverage.</p>
        </div>
      ) : (
        <>
          {/* Ownership breakdown */}
          {(data.pct_institutional != null || data.pct_insider != null) && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">Ownership Breakdown</p>
              <div className="bg-gray-800 rounded-xl p-4 space-y-3">
                <PieSlice label="Institutional / FII / DII" pct={data.pct_institutional} color="#0ea5e9" />
                <PieSlice label="Promoter / Insider"        pct={data.pct_insider}      color="#6366f1" />
                <PieSlice label="Retail / Public Float"     pct={data.pct_retail}       color="#9ca3af" />
              </div>
              {data.holding_summary && (
                <p className="text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-2">
                  {data.holding_summary}
                </p>
              )}
            </div>
          )}

          {/* Two-column: institutions + mutual funds */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.top_institutions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide">
                  🏦 Top Institutional Holders
                </p>
                <div className="space-y-1.5">
                  {data.top_institutions.map((h, i) => (
                    <HolderRow key={i} h={h} rank={i + 1} />
                  ))}
                </div>
              </div>
            )}

            {data.top_mutual_funds.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-purple-400 font-semibold uppercase tracking-wide">
                  📦 Top Mutual Fund Holders
                </p>
                <div className="space-y-1.5">
                  {data.top_mutual_funds.map((h, i) => (
                    <HolderRow key={i} h={h} rank={i + 1} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-600 text-right">
            Source: yfinance · Data may be quarterly-lagged
          </p>
        </>
      )}
    </div>
  )
}
