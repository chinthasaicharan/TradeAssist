import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { getTrend } from '../api'
import { fmt, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { TrendSignal } from '../types'

interface Props { ticker: string }

function BiasCard({ label, bias }: { label: string; bias: 'bullish' | 'bearish' | 'neutral' }) {
  const cfg = {
    bullish: { bg: 'bg-emerald-900', text: 'text-emerald-300', icon: '▲', border: 'border-emerald-700' },
    bearish: { bg: 'bg-red-900', text: 'text-red-300', icon: '▼', border: 'border-red-700' },
    neutral: { bg: 'bg-gray-800', text: 'text-gray-300', icon: '→', border: 'border-gray-700' },
  }[bias]

  return (
    <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-4 text-center`}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-black ${cfg.text}`}>{cfg.icon}</p>
      <p className={`text-sm font-bold capitalize ${cfg.text}`}>{bias}</p>
    </div>
  )
}

function SignalRow({ signal }: { signal: TrendSignal }) {
  const badgeCls = signal.signal === 'bullish' ? 'badge-bullish'
    : signal.signal === 'bearish' ? 'badge-bearish' : 'badge-neutral'

  return (
    <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          signal.timeframe === 'short' ? 'bg-blue-900 text-blue-400' : 'bg-purple-900 text-purple-400'
        }`}>
          {signal.timeframe === 'short' ? 'ST' : 'LT'}
        </span>
        <span className="text-gray-300 font-medium">{signal.indicator}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-xs">{signal.value}</span>
        <span className={badgeCls}>{signal.signal}</span>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-3">
          <span>{p.name}:</span>
          <span className="font-bold">{SYM}{fmt(p.value, 2)}</span>
        </p>
      ))}
    </div>
  )
}

export function TrendPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['trend', ticker],
    queryFn: () => getTrend(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) {
    return (
      <div className="panel">
        <p className="panel-title">Trend Analysis</p>
        <p className="text-red-400 text-sm">Failed to load trend data.</p>
      </div>
    )
  }

  const chartData = data.price_history.filter((_, i) => i % 2 === 0)
  const shortSignals = data.signals.filter(s => s.timeframe === 'short')
  const longSignals = data.signals.filter(s => s.timeframe === 'long')

  return (
    <div className="panel space-y-4">
      <p className="panel-title">Long &amp; Short Term Trend</p>

      {/* Bias summary */}
      <div className="grid grid-cols-2 gap-3">
        <BiasCard label="Short-Term Bias" bias={data.short_term_bias} />
        <BiasCard label="Long-Term Bias" bias={data.long_term_bias} />
      </div>

      {/* Chart with SMAs */}
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            interval={Math.floor(chartData.length / 6)}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${SYM}${v.toFixed(0)}`}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '11px', color: '#9ca3af', paddingTop: '8px' }}
          />
          <Line type="monotone" dataKey="close"   name="Price"  stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="sma_20"  name="MA 20"  stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />
          <Line type="monotone" dataKey="sma_50"  name="MA 50"  stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" connectNulls />
          <Line type="monotone" dataKey="sma_200" name="MA 200" stroke="#a855f7" strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls />
        </LineChart>
      </ResponsiveContainer>

      {/* Signal rows */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-blue-400 uppercase mb-2">Short-Term Signals</p>
          <div className="space-y-1.5">
            {shortSignals.map((s, i) => <SignalRow key={i} signal={s} />)}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-purple-400 uppercase mb-2">Long-Term Signals</p>
          <div className="space-y-1.5">
            {longSignals.map((s, i) => <SignalRow key={i} signal={s} />)}
            {longSignals.length === 0 && (
              <p className="text-xs text-gray-600">Insufficient data for long-term signals</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
