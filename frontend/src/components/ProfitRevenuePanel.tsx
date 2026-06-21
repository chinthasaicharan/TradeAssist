import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { getFinancials } from '../api'
import { SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'

interface Props { ticker: string }

function formatYAxis(val: number): string {
  if (Math.abs(val) >= 1e12) return `${SYM}${(val / 1e12).toFixed(1)}T`
  if (Math.abs(val) >= 1e9)  return `${SYM}${(val / 1e9).toFixed(1)}B`
  if (Math.abs(val) >= 1e7)  return `${SYM}${(val / 1e7).toFixed(1)}Cr`
  if (Math.abs(val) >= 1e5)  return `${SYM}${(val / 1e5).toFixed(1)}L`
  return `${SYM}${val}`
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="font-semibold text-white mb-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-4">
          <span>{p.name}:</span>
          <span className="font-bold">{formatYAxis(p.value)}</span>
        </p>
      ))}
    </div>
  )
}

export function ProfitRevenuePanel({ ticker }: Props) {
  const [view, setView] = useState<'annual' | 'quarterly'>('annual')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['financials', ticker],
    queryFn: () => getFinancials(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) {
    return (
      <div className="panel">
        <p className="panel-title">Revenue & Profit</p>
        <p className="text-red-400 text-sm">Failed to load financial data.</p>
      </div>
    )
  }

  const series = view === 'annual' ? data.annual : data.quarterly

  if (!series || series.length === 0) {
    return (
      <div className="panel">
        <p className="panel-title">Revenue & Profit</p>
        <p className="text-gray-500 text-sm">No financial data available for this ticker.</p>
      </div>
    )
  }

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-title">Revenue & Profit</p>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          {(['annual', 'quarterly'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs font-medium transition ${
                view === v
                  ? 'bg-brand-600 text-white'
                  : 'bg-transparent text-gray-400 hover:text-white'
              }`}
            >
              {v === 'annual' ? 'Annual' : 'Quarterly'}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={series} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="period" tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} />
          <YAxis tickFormatter={formatYAxis} tick={{ fill: '#9ca3af', fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '12px', color: '#9ca3af', paddingTop: '8px' }}
          />
          <Bar dataKey="revenue" name="Revenue" fill="#0ea5e9" radius={[3, 3, 0, 0]} maxBarSize={40} />
          <Bar dataKey="gross_profit" name="Gross Profit" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={40} />
          <Line
            type="monotone"
            dataKey="net_income"
            name="Net Income"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3, fill: '#10b981' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
