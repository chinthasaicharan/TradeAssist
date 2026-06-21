import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend, ResponsiveContainer,
} from 'recharts'
import { getTechnical } from '../api'
import { fmt, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { PriceLevel } from '../types'

interface Props { ticker: string }

const STRENGTH_COLOR: Record<string, string> = {
  strong: '#10b981', moderate: '#f59e0b', weak: '#6b7280',
}
const S_COLOR = '#10b981'
const R_COLOR = '#ef4444'

function LevelBadge({ level }: { level: PriceLevel }) {
  const color = level.type === 'support' ? S_COLOR : R_COLOR
  return (
    <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-xs">
      <span style={{ color }} className="font-bold">{SYM}{fmt(level.price)}</span>
      <span className="text-gray-400 capitalize">{level.type}</span>
      <span className="px-1.5 py-0.5 rounded text-xs font-semibold"
        style={{ background: STRENGTH_COLOR[level.strength] + '22', color: STRENGTH_COLOR[level.strength] }}>
        {level.strength}
      </span>
    </div>
  )
}

function MARow({ label, ma, price, color }: { label: string; ma: number | null; price: number; color: string }) {
  if (!ma) return null
  const pct   = ((price - ma) / ma * 100)
  const above = price >= ma
  return (
    <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <div className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
        <span className="text-gray-300 font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400">{SYM}{fmt(ma, 0)}</span>
        <span className={`font-semibold ${above ? 'text-emerald-400' : 'text-red-400'}`}>
          {above ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl space-y-1">
      <p className="text-gray-400 font-medium mb-1">{label}</p>
      {payload.filter((p: any) => p.value != null && p.dataKey !== 'volume').map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-3">
          <span>{p.name}:</span>
          <span className="font-bold">{SYM}{fmt(p.value, 0)}</span>
        </p>
      ))}
    </div>
  )
}

export function TechnicalPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['technical', ticker],
    queryFn: () => getTechnical(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Technical Analysis · Support & Resistance</p>
      <p className="text-red-400 text-sm">Failed to load technical data.</p>
    </div>
  )

  const chartData = data.price_history.filter((_, i) => i % 2 === 0)
  const allLevels = [...data.support_levels, ...data.resistance_levels]
  const prices    = data.price_history.map(d => d.close)
  const minPrice  = Math.min(...prices, ...allLevels.map(l => l.price)) * 0.97
  const maxPrice  = Math.max(...prices, ...allLevels.map(l => l.price)) * 1.03

  const trendCfg = {
    bullish: { bg: 'bg-emerald-900', border: 'border-emerald-700', text: 'text-emerald-300', icon: '▲' },
    bearish: { bg: 'bg-red-900',     border: 'border-red-700',     text: 'text-red-300',     icon: '▼' },
    neutral: { bg: 'bg-gray-800',    border: 'border-gray-700',    text: 'text-gray-300',    icon: '→' },
  }[data.ma_trend]

  const rsiColor = data.rsi < 30 ? '#10b981' : data.rsi > 70 ? '#ef4444' : '#f59e0b'

  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="panel-title">Technical Analysis · Support & Resistance</p>
        <span className="text-xs text-gray-500">
          Price: <span className="text-white font-bold">{SYM}{fmt(data.current_price)}</span>
        </span>
      </div>

      {/* MA Trend badge + RSI pill */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`${trendCfg.bg} border ${trendCfg.border} rounded-lg px-3 py-1.5 flex items-center gap-2`}>
          <span className={`text-sm font-black ${trendCfg.text}`}>{trendCfg.icon}</span>
          <span className={`text-xs font-bold capitalize ${trendCfg.text}`}>MA Trend: {data.ma_trend}</span>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 flex items-center gap-2">
          <span className="text-xs text-gray-400">RSI (14)</span>
          <span className="text-xs font-bold" style={{ color: rsiColor }}>{data.rsi.toFixed(1)}</span>
          <span className="text-xs" style={{ color: rsiColor }}>{data.rsi_signal}</span>
        </div>
      </div>

      {/* MA rows */}
      <div className="space-y-1.5">
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">Moving Averages vs Price</p>
        <MARow label="MA 20"  ma={data.ma20}  price={data.current_price} color="#f59e0b" />
        <MARow label="MA 50"  ma={data.ma50}  price={data.current_price} color="#6366f1" />
        <MARow label="MA 200" ma={data.ma200} price={data.current_price} color="#a855f7" />
      </div>

      {/* Price + MA + Volume chart */}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false}
            interval={Math.floor(chartData.length / 6)} />
          <YAxis yAxisId="price" domain={[minPrice, maxPrice]}
            tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
            tickFormatter={v => `${SYM}${v.toFixed(0)}`} width={62} />
          <YAxis yAxisId="vol" orientation="right"
            tick={{ fill: '#374151', fontSize: 9 }} tickLine={false} axisLine={false}
            tickFormatter={v => `${(v/1e6).toFixed(0)}M`} width={36} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: '10px', color: '#9ca3af', paddingTop: '6px' }} />

          {/* Volume bars */}
          <Bar yAxisId="vol" dataKey="volume" name="Vol" fill="#1f2937" opacity={0.5} maxBarSize={4} />

          {/* Price line */}
          <Line yAxisId="price" type="monotone" dataKey="close" name="Price"
            stroke="#0ea5e9" strokeWidth={1.5} dot={false} />

          {/* MA lines */}
          <Line yAxisId="price" type="monotone" dataKey="ma20"  name="MA20"
            stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />
          <Line yAxisId="price" type="monotone" dataKey="ma50"  name="MA50"
            stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" connectNulls />
          <Line yAxisId="price" type="monotone" dataKey="ma200" name="MA200"
            stroke="#a855f7" strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls />

          {/* Support levels */}
          {data.support_levels.map((lvl, i) => (
            <ReferenceLine key={`s-${i}`} yAxisId="price" y={lvl.price}
              stroke={S_COLOR}
              strokeDasharray={lvl.strength === 'strong' ? '0' : '4 4'}
              strokeWidth={lvl.strength === 'strong' ? 2 : 1}
              label={{ value: `S ${SYM}${lvl.price}`, fill: S_COLOR, fontSize: 9, position: 'right' }} />
          ))}

          {/* Resistance levels */}
          {data.resistance_levels.map((lvl, i) => (
            <ReferenceLine key={`r-${i}`} yAxisId="price" y={lvl.price}
              stroke={R_COLOR}
              strokeDasharray={lvl.strength === 'strong' ? '0' : '4 4'}
              strokeWidth={lvl.strength === 'strong' ? 2 : 1}
              label={{ value: `R ${SYM}${lvl.price}`, fill: R_COLOR, fontSize: 9, position: 'right' }} />
          ))}

          {/* Current price */}
          <ReferenceLine yAxisId="price" y={data.current_price}
            stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* RSI mini-gauge */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-400">RSI (14)</span>
          <span className="font-bold" style={{ color: rsiColor }}>
            {data.rsi.toFixed(1)} — {data.rsi_signal}
          </span>
        </div>
        <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
          <div className="absolute left-0 top-0 h-full w-[30%] bg-emerald-900 opacity-40 rounded-l-full" />
          <div className="absolute right-0 top-0 h-full w-[30%] bg-red-900 opacity-40 rounded-r-full" />
          <div className="absolute top-0 h-full w-1 rounded-full -translate-x-1/2 transition-all"
            style={{ left: `${data.rsi}%`, backgroundColor: rsiColor }} />
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-0.5">
          <span>0</span><span>30</span><span>50</span><span>70</span><span>100</span>
        </div>
      </div>

      {/* Support / Resistance level list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <p className="text-xs text-emerald-500 font-semibold mb-2 uppercase">Support Zones</p>
          {data.support_levels.length > 0
            ? data.support_levels.map((lvl, i) => <LevelBadge key={i} level={lvl} />)
            : <p className="text-xs text-gray-600">None detected</p>}
        </div>
        <div>
          <p className="text-xs text-red-400 font-semibold mb-2 uppercase">Resistance Zones</p>
          {data.resistance_levels.length > 0
            ? data.resistance_levels.map((lvl, i) => <LevelBadge key={i} level={lvl} />)
            : <p className="text-xs text-gray-600">None detected</p>}
        </div>
      </div>
    </div>
  )
}
