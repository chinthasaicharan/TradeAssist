import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getBTST } from '../api'
import { fmt, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { BTSTSignal } from '../types'

interface Props { ticker: string }

const VERDICT_CFG = {
  'Strong BTST': {
    bg: 'bg-emerald-950', border: 'border-emerald-500',
    text: 'text-emerald-300', badge: 'bg-emerald-900 text-emerald-300',
    icon: '🚀', meter: '#10b981',
  },
  'BTST Possible': {
    bg: 'bg-blue-950', border: 'border-blue-600',
    text: 'text-blue-300', badge: 'bg-blue-900 text-blue-300',
    icon: '📈', meter: '#3b82f6',
  },
  'Avoid': {
    bg: 'bg-gray-800', border: 'border-gray-600',
    text: 'text-gray-300', badge: 'bg-gray-700 text-gray-300',
    icon: '⏸️', meter: '#6b7280',
  },
  'Strong Avoid': {
    bg: 'bg-red-950', border: 'border-red-600',
    text: 'text-red-300', badge: 'bg-red-900 text-red-300',
    icon: '🚫', meter: '#ef4444',
  },
}

function ScoreBar({ signal }: { signal: BTSTSignal }) {
  const pct   = Math.abs(signal.score) * 100
  const pos   = signal.score >= 0
  const color = signal.score >= 0.5 ? '#10b981'
    : signal.score >= 0.1 ? '#3b82f6'
    : signal.score <= -0.5 ? '#ef4444'
    : signal.score <= -0.1 ? '#f59e0b'
    : '#6b7280'

  return (
    <div className="bg-gray-800 rounded-lg px-3 py-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-xs font-semibold text-white">{signal.factor}</span>
          <span className="text-xs text-gray-400 ml-2">({signal.value})</span>
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded font-bold shrink-0 ${
          pos ? 'bg-emerald-900 text-emerald-400' : 'bg-red-900 text-red-400'
        }`}>
          {pos ? '+' : ''}{(signal.score * 100).toFixed(0)}
        </span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{signal.note}</p>
    </div>
  )
}

const CandleTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs shadow-xl space-y-1">
      <p className="text-gray-400 font-medium truncate max-w-[160px]">{label}</p>
      {[['O', d.open], ['H', d.high], ['L', d.low], ['C', d.close]].map(([k, v]) => (
        <p key={k as string} className="flex justify-between gap-3">
          <span className="text-gray-500">{k}:</span>
          <span className="font-bold text-white">{SYM}{fmt(v as number, 0)}</span>
        </p>
      ))}
      <p className="flex justify-between gap-3 border-t border-gray-700 pt-1 mt-1">
        <span className="text-gray-500">Vol:</span>
        <span className="font-bold text-white">{((d.volume as number) / 1e6).toFixed(2)}M</span>
      </p>
    </div>
  )
}

export function BTSTPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['btst', ticker],
    queryFn: () => getBTST(ticker),
    enabled: !!ticker,
    staleTime: 30 * 60 * 1000, // 30-min — intraday relevance
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">BTST Analysis</p>
      <p className="text-red-400 text-sm">Failed to load BTST data.</p>
    </div>
  )

  const cfg = VERDICT_CFG[data.verdict]
  const riskPct   = ((data.entry_price - data.stop_loss)  / data.entry_price * 100)
  const rewardPct = ((data.target_price - data.entry_price) / data.entry_price * 100)

  // Build simple OHLC bar chart data (use high-low as bar range, open/close as markers)
  const chartData = data.price_history_5d.map(d => ({
    ...d,
    range: d.high - d.low,
    base:  d.low,
    bullish: d.close >= d.open,
    body:  Math.abs(d.close - d.open),
    bodyBase: Math.min(d.open, d.close),
  }))

  // For chart we use a simplified version: volume bars + close line
  const priceMin = Math.min(...data.price_history_5d.map(d => d.low)) * 0.995
  const priceMax = Math.max(...data.price_history_5d.map(d => d.high)) * 1.005

  return (
    <div className="panel space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="panel-title">BTST · Buy Today Sell Tomorrow</p>
        <span className={`text-xs px-2 py-1 rounded-full font-semibold ${cfg.badge}`}>
          Updated {new Date(data.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Main verdict card */}
      <div className={`${cfg.bg} border-2 ${cfg.border} rounded-2xl p-5`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">{cfg.icon}</span>
              <span className={`text-2xl font-black ${cfg.text}`}>{data.verdict}</span>
            </div>
            <p className="text-xs text-gray-400 max-w-lg leading-relaxed">{data.summary}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400 mb-0.5">Confidence</p>
            <p className={`text-4xl font-black ${cfg.text}`}>{data.confidence_pct.toFixed(0)}%</p>
            <div className="mt-1.5 h-2 w-24 bg-gray-700 rounded-full overflow-hidden ml-auto">
              <div className="h-full rounded-full" style={{ width: `${data.confidence_pct}%`, backgroundColor: cfg.meter }} />
            </div>
          </div>
        </div>

        {/* Composite meter */}
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Composite Score</span>
            <span className={`font-black ${cfg.text}`}>
              {data.composite_score > 0 ? '+' : ''}{data.composite_score}
            </span>
          </div>
          <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
            <div className="absolute left-1/2 top-0 h-full w-px bg-gray-500" />
            <div className="absolute top-0 h-full rounded-full transition-all"
              style={{
                left:  data.composite_score >= 0 ? '50%' : `${50 + data.composite_score / 2}%`,
                width: `${Math.abs(data.composite_score) / 2}%`,
                backgroundColor: cfg.meter,
              }} />
          </div>
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>-100 Avoid</span><span>0</span><span>+100 Strong BTST</span>
          </div>
        </div>
      </div>

      {/* Entry / Target / Stop grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Entry',       val: data.entry_price,  sub: 'Current close',     color: 'text-white' },
          { label: 'Target',      val: data.target_price, sub: `+${rewardPct.toFixed(2)}% upside`, color: 'text-emerald-400' },
          { label: 'Stop Loss',   val: data.stop_loss,    sub: `-${riskPct.toFixed(2)}% risk`,      color: 'text-red-400' },
          { label: 'Risk:Reward', val: null, rr: data.risk_reward, sub: `1 : ${data.risk_reward.toFixed(2)}`, color: data.risk_reward >= 2 ? 'text-emerald-400' : 'text-yellow-400' },
        ].map(item => (
          <div key={item.label} className="metric-card">
            <span className="metric-label">{item.label}</span>
            {item.val != null
              ? <span className={`text-lg font-bold ${item.color}`}>{SYM}{fmt(item.val, 0)}</span>
              : <span className={`text-lg font-bold ${item.color}`}>{item.sub}</span>
            }
            {item.val != null && (
              <span className={`text-xs ${item.color} opacity-80`}>{item.sub}</span>
            )}
          </div>
        ))}
      </div>

      {/* Overnight gap expectation */}
      {data.expected_gap_pct != null && (
        <div className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm ${
          data.expected_gap_pct >= 0 ? 'bg-emerald-950 border border-emerald-800' : 'bg-red-950 border border-red-800'
        }`}>
          <span className="text-xl">{data.expected_gap_pct >= 0 ? '📭' : '📉'}</span>
          <div>
            <p className="font-semibold text-white text-xs">Historical Overnight Gap</p>
            <p className={`text-xs ${data.expected_gap_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Avg {data.expected_gap_pct >= 0 ? '+' : ''}{data.expected_gap_pct.toFixed(2)}% gap based on last 20 sessions
            </p>
          </div>
        </div>
      )}

      {/* 5-day price chart */}
      <div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">5-Day Price Action (15-min / Daily)</p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 9 }} tickLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
              tickFormatter={v => typeof v === 'string' ? v.slice(5, 16) : v} />
            <YAxis yAxisId="price" domain={[priceMin, priceMax]}
              tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
              tickFormatter={v => `${SYM}${v.toFixed(0)}`} width={58} />
            <YAxis yAxisId="vol" orientation="right"
              tick={{ fill: '#374151', fontSize: 9 }} tickLine={false} axisLine={false}
              tickFormatter={v => `${(v / 1e6).toFixed(1)}M`} width={36} />
            <Tooltip content={<CandleTooltip />} />
            <Bar yAxisId="vol" dataKey="volume" fill="#1f2937" opacity={0.6} maxBarSize={5} />
            <Line yAxisId="price" type="monotone" dataKey="close" name="Close"
              stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
            <Line yAxisId="price" type="monotone" dataKey="high" name="High"
              stroke="#10b981" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            <Line yAxisId="price" type="monotone" dataKey="low" name="Low"
              stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            {/* Entry / Target / Stop reference lines */}
            <ReferenceLine yAxisId="price" y={data.entry_price}
              stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5}
              label={{ value: `Entry ${SYM}${data.entry_price}`, fill: '#f59e0b', fontSize: 9, position: 'left' }} />
            <ReferenceLine yAxisId="price" y={data.target_price}
              stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: `T ${SYM}${data.target_price}`, fill: '#10b981', fontSize: 9, position: 'left' }} />
            <ReferenceLine yAxisId="price" y={data.stop_loss}
              stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: `SL ${SYM}${data.stop_loss}`, fill: '#ef4444', fontSize: 9, position: 'left' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Factor signals */}
      <div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">Signal Breakdown</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {data.signals.map((s, i) => <ScoreBar key={i} signal={s} />)}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-2.5">
        <p className="text-xs text-yellow-500 font-semibold">⚠️ Risk Disclaimer</p>
        <p className="text-xs text-yellow-600 mt-0.5">
          BTST is a high-risk intraday strategy. Overnight positions are subject to gap risk, news events,
          and market volatility. Always use a strict stop loss. This is not financial advice.
        </p>
      </div>
    </div>
  )
}
