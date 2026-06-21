import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getRecommendation } from '../api'
import { fmt, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { MASignal, ChartPattern } from '../types'

interface Props { ticker: string }

const REC_CFG = {
  'Strong Buy':  { bg: 'bg-emerald-950', border: 'border-emerald-500', text: 'text-emerald-300', bar: '#10b981', meter: '#10b981' },
  'Buy':         { bg: 'bg-emerald-900', border: 'border-emerald-600', text: 'text-emerald-400', bar: '#34d399', meter: '#34d399' },
  'Hold':        { bg: 'bg-gray-800',    border: 'border-gray-600',    text: 'text-gray-300',    bar: '#9ca3af', meter: '#9ca3af' },
  'Sell':        { bg: 'bg-red-900',     border: 'border-red-600',     text: 'text-red-400',     bar: '#f87171', meter: '#f87171' },
  'Strong Sell': { bg: 'bg-red-950',     border: 'border-red-500',     text: 'text-red-300',     bar: '#ef4444', meter: '#ef4444' },
}

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  const pct = Math.abs(score)
  const positive = score >= 0
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold" style={{ color }}>{score > 0 ? '+' : ''}{score.toFixed(0)}</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color, opacity: positive ? 1 : 0.7 }} />
      </div>
    </div>
  )
}

function MARow({ sig }: { sig: MASignal }) {
  const cls = sig.signal === 'bullish' ? 'badge-bullish' : sig.signal === 'bearish' ? 'badge-bearish' : 'badge-neutral'
  return (
    <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-xs">
      <span className="text-gray-300 font-medium">{sig.label}</span>
      <div className="flex items-center gap-2">
        <span className="text-gray-500 text-xs truncate max-w-[140px]">{sig.value}</span>
        <span className={cls}>{sig.signal}</span>
      </div>
    </div>
  )
}

function PatternRow({ p }: { p: ChartPattern }) {
  if (!p.detected) return null
  const color = p.implication === 'bullish' ? 'text-emerald-400 bg-emerald-900'
    : p.implication === 'bearish' ? 'text-red-400 bg-red-900'
    : 'text-gray-300 bg-gray-700'
  return (
    <div className="bg-gray-800 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${color}`}>{p.implication}</span>
        <span className="text-xs font-bold text-white">{p.name}</span>
      </div>
      <p className="text-xs text-gray-500">{p.description}</p>
    </div>
  )
}

function RSIGauge({ rsi }: { rsi: number }) {
  const pct = rsi
  const color = rsi < 30 ? '#10b981' : rsi > 70 ? '#ef4444' : '#f59e0b'
  const label = rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">RSI (14)</span>
        <span className="font-bold" style={{ color }}>{rsi.toFixed(1)} — {label}</span>
      </div>
      <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
        {/* zone backgrounds */}
        <div className="absolute left-0 top-0 h-full w-[30%] bg-emerald-900 opacity-40 rounded-l-full" />
        <div className="absolute right-0 top-0 h-full w-[30%] bg-red-900 opacity-40 rounded-r-full" />
        {/* needle */}
        <div className="absolute top-0 h-full w-1 rounded-full -translate-x-1/2 transition-all"
          style={{ left: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-xs text-gray-600 mt-0.5">
        <span>0</span><span>30</span><span>50</span><span>70</span><span>100</span>
      </div>
    </div>
  )
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-gray-400 mb-2">{label}</p>
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-3">
          <span>{p.name}:</span>
          <span className="font-bold">
            {p.dataKey === 'volume' ? (p.value / 1e6).toFixed(1) + 'M' : `${SYM}${fmt(p.value, 0)}`}
          </span>
        </p>
      ))}
    </div>
  )
}

export function RecommendationPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recommendation', ticker],
    queryFn: () => getRecommendation(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Probability & Recommendation</p>
      <p className="text-red-400 text-sm">Failed to load recommendation data.</p>
    </div>
  )

  const cfg = REC_CFG[data.recommendation]
  const chartData = data.price_history.filter((_, i) => i % 2 === 0)
  const detectedPatterns = data.patterns.filter(p => p.detected)

  return (
    <div className="panel space-y-5">
      <p className="panel-title">Probability & Recommendation</p>

      {/* Main verdict */}
      <div className={`${cfg.bg} border-2 ${cfg.border} rounded-2xl p-5`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Signal</p>
            <p className={`text-3xl font-black ${cfg.text}`}>{data.recommendation}</p>
            <p className="text-xs text-gray-400 mt-1">{data.summary}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-1">Confidence</p>
            <p className={`text-4xl font-black ${cfg.text}`}>{data.confidence_pct.toFixed(0)}%</p>
            {/* confidence arc */}
            <div className="mt-2 h-2 w-28 bg-gray-700 rounded-full overflow-hidden ml-auto">
              <div className="h-full rounded-full transition-all" style={{ width: `${data.confidence_pct}%`, backgroundColor: cfg.meter }} />
            </div>
          </div>
        </div>

        {/* Component scores */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
          <ScoreBar label="Trend"    score={data.trend_score}    color="#0ea5e9" />
          <ScoreBar label="Momentum" score={data.momentum_score} color="#a855f7" />
          <ScoreBar label="Volume"   score={data.volume_score}   color="#f59e0b" />
          <ScoreBar label="Patterns" score={data.pattern_score}  color="#10b981" />
        </div>

        {/* Composite meter */}
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Composite Score</span>
            <span className={`font-black text-sm ${cfg.text}`}>{data.composite_score > 0 ? '+' : ''}{data.composite_score}</span>
          </div>
          <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
            <div className="absolute left-1/2 top-0 h-full w-0.5 bg-gray-500" />
            <div className="absolute top-0 h-full rounded-full transition-all"
              style={{
                left:  data.composite_score >= 0 ? '50%' : `${50 + data.composite_score / 2}%`,
                width: `${Math.abs(data.composite_score) / 2}%`,
                backgroundColor: cfg.meter,
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>-100 Sell</span><span>0 Neutral</span><span>+100 Buy</span>
          </div>
        </div>
      </div>

      {/* Price + MA chart */}
      <div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">Price with MA20 / MA50 / MA200</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false}
              interval={Math.floor(chartData.length / 6)} />
            <YAxis yAxisId="price" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false}
              axisLine={false} tickFormatter={v => `${SYM}${v.toFixed(0)}`} width={60} />
            <YAxis yAxisId="vol" orientation="right" tick={{ fill: '#374151', fontSize: 9 }}
              tickLine={false} axisLine={false} tickFormatter={v => `${(v/1e6).toFixed(0)}M`} width={40} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: '11px', color: '#9ca3af', paddingTop: '6px' }} />
            <Bar yAxisId="vol" dataKey="volume" name="Volume" fill="#1f2937" opacity={0.6} maxBarSize={6} />
            <Line yAxisId="price" type="monotone" dataKey="close"  name="Price" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
            <Line yAxisId="price" type="monotone" dataKey="ma20"   name="MA20"  stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />
            <Line yAxisId="price" type="monotone" dataKey="ma50"   name="MA50"  stroke="#6366f1" strokeWidth={1.5} dot={false} strokeDasharray="4 4" connectNulls />
            <Line yAxisId="price" type="monotone" dataKey="ma200"  name="MA200" stroke="#a855f7" strokeWidth={1.5} dot={false} strokeDasharray="6 3" connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* RSI gauge */}
      <RSIGauge rsi={data.rsi} />

      {/* Two column: MA signals + MACD/Volume */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">MA Signals</p>
          <div className="space-y-1.5">
            {data.ma_signals.map((s, i) => <MARow key={i} sig={s} />)}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">Indicators</p>
            <div className="space-y-1.5">
              {[
                { label: 'MACD',          value: data.macd_signal,        positive: data.macd_signal.includes('Bull') },
                { label: 'RSI Signal',    value: data.rsi_signal,          positive: data.rsi.valueOf() < 50 },
                { label: 'Volume vs Avg', value: `${data.volume_vs_avg.toFixed(2)}x avg vol`, positive: data.volume_vs_avg > 1 },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center bg-gray-800 rounded-lg px-3 py-2 text-xs">
                  <span className="text-gray-400">{item.label}</span>
                  <span className={`font-semibold ${item.positive ? 'text-emerald-400' : 'text-red-400'}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Detected patterns */}
          {detectedPatterns.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">Active Patterns</p>
              <div className="space-y-1.5">
                {detectedPatterns.map((p, i) => <PatternRow key={i} p={p} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
