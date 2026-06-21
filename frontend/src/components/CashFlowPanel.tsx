import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { getCashFlow } from '../api'
import { fmt, fmtPct, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'

interface Props { ticker: string }

function formatY(val: number): string {
  const abs = Math.abs(val)
  if (abs >= 1e12) return `${SYM}${(val / 1e12).toFixed(1)}T`
  if (abs >= 1e9)  return `${SYM}${(val / 1e9).toFixed(1)}B`
  if (abs >= 1e7)  return `${SYM}${(val / 1e7).toFixed(1)}Cr`
  if (abs >= 1e5)  return `${SYM}${(val / 1e5).toFixed(1)}L`
  return `${SYM}${val.toLocaleString('en-IN')}`
}

const Tooltip_ = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="font-semibold text-white mb-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-4">
          <span>{p.name}:</span>
          <span className="font-bold">{formatY(p.value)}</span>
        </p>
      ))}
    </div>
  )
}

function MetricRow({ label, value, isPercent = false, highlight = false }:
  { label: string; value: number | null; isPercent?: boolean; highlight?: boolean }) {
  const display = value == null ? 'N/A'
    : isPercent ? fmtPct(value)
    : fmt(value, 2)
  const color = value == null ? 'text-gray-500'
    : value >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg ${highlight ? 'bg-gray-700' : 'bg-gray-800'}`}>
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{display}</span>
    </div>
  )
}

export function CashFlowPanel({ ticker }: Props) {
  const [view, setView] = useState<'annual' | 'quarterly'>('annual')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cashflow', ticker],
    queryFn: () => getCashFlow(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Cash Flow & Returns</p>
      <p className="text-red-400 text-sm">Failed to load cash flow data.</p>
    </div>
  )

  const series = view === 'annual' ? data.annual : data.quarterly
  const m = data.metrics

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-title">Cash Flow · Profitability</p>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          {(['annual', 'quarterly'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 text-xs font-medium transition ${view === v ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {v === 'annual' ? 'Annual' : 'Quarterly'}
            </button>
          ))}
        </div>
      </div>

      {/* Cash flow chart */}
      {series.length > 0 ? (
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={series} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="period" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} />
            <YAxis tickFormatter={formatY} tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<Tooltip_ />} />
            <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af', paddingTop: '8px' }} />
            <Bar dataKey="operating_cash_flow" name="Op. Cash Flow" fill="#0ea5e9" radius={[3,3,0,0]} maxBarSize={36} />
            <Bar dataKey="free_cash_flow"       name="Free Cash Flow" fill="#6366f1" radius={[3,3,0,0]} maxBarSize={36} />
            <Line type="monotone" dataKey="net_income" name="Net Income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-gray-500 text-sm text-center py-6">No cash flow data available</p>
      )}

      {/* Returns & margins grid */}
      <div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">Returns & Margins</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <MetricRow label="Return on Equity (ROE)"      value={m.roe}               isPercent highlight />
          <MetricRow label="Return on Assets (ROA/ROI)"  value={m.roi}               isPercent highlight />
          <MetricRow label="Net Profit Margin"           value={m.net_profit_margin} isPercent />
          <MetricRow label="Operating Margin"            value={m.operating_margin}  isPercent />
          <MetricRow label="Gross Margin"                value={m.gross_margin}      isPercent />
          <MetricRow label="Debt / Equity"               value={m.debt_to_equity}    />
          <MetricRow label="Current Ratio"               value={m.current_ratio}     />
        </div>
      </div>
    </div>
  )
}
