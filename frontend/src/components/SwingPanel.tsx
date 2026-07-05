import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { getSwing } from '../api'
import { fmt, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'
import type { SwingFactor, SwingResponse } from '../types'

interface Props { ticker: string; companyName?: string }

// ── Verdict config ────────────────────────────────────────────────────────
const VCFG: Record<SwingResponse['verdict'], {
  bg: string; border: string; text: string; meter: string; icon: string
}> = {
  'Strong Swing Buy':  { bg:'bg-emerald-950', border:'border-emerald-500', text:'text-emerald-300', meter:'#10b981', icon:'🚀' },
  'Swing Buy':         { bg:'bg-emerald-900', border:'border-emerald-600', text:'text-emerald-400', meter:'#34d399', icon:'📈' },
  'Neutral':           { bg:'bg-gray-800',    border:'border-gray-600',    text:'text-gray-300',    meter:'#9ca3af', icon:'⚖️' },
  'Swing Sell':        { bg:'bg-red-900',     border:'border-red-600',     text:'text-red-400',     meter:'#f87171', icon:'📉' },
  'Strong Swing Sell': { bg:'bg-red-950',     border:'border-red-500',     text:'text-red-300',     meter:'#ef4444', icon:'🚫' },
}

// ── Factor row ────────────────────────────────────────────────────────────
function FactorRow({ f }: { f: SwingFactor }) {
  const pct   = Math.round(Math.abs(f.score) * 100)
  const color = f.score >= 0.5 ? '#10b981'
    : f.score >= 0.1 ? '#3b82f6'
    : f.score <= -0.5 ? '#ef4444'
    : f.score <= -0.1 ? '#f59e0b'
    : '#6b7280'
  const badge = f.signal === 'bullish' ? 'bg-emerald-900 text-emerald-400'
    : f.signal === 'bearish' ? 'bg-red-900 text-red-400'
    : 'bg-gray-700 text-gray-400'

  return (
    <div className="bg-gray-800 rounded-xl px-3 py-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-white">{f.factor}</span>
          <span className="text-xs text-gray-500 ml-1.5">{f.value}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${badge}`}>{f.signal}</span>
          <span className={`text-xs font-bold ${f.score >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {f.score >= 0 ? '+' : ''}{(f.score * 100).toFixed(0)}
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{f.note}</p>
    </div>
  )
}

// ── Chart tooltip ─────────────────────────────────────────────────────────
const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs shadow-xl space-y-0.5">
      <p className="text-gray-400 mb-1">{label}</p>
      {[['O', d?.open], ['H', d?.high], ['L', d?.low], ['C', d?.close]].map(([k, v]) => (
        <p key={String(k)} className="flex justify-between gap-3">
          <span className="text-gray-500">{k}</span>
          <span className="font-bold text-white">{SYM}{fmt(Number(v), 0)}</span>
        </p>
      ))}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────
export function SwingPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['swing', ticker],
    queryFn:  () => getSwing(ticker),
    enabled:  !!ticker,
    staleTime: 60 * 60_000,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Swing Trade Analyser</p>
      <p className="text-red-400 text-sm">Failed to load swing analysis.</p>
    </div>
  )

  const cfg        = VCFG[data.verdict]
  const riskPct    = ((data.entry_price - data.stop_loss) / data.entry_price * 100)
  const rewardPct  = ((data.target_price - data.entry_price) / data.entry_price * 100)
  const isBullish  = data.verdict.includes('Buy')
  const isBearish  = data.verdict.includes('Sell')

  const bullFactors = data.factors.filter(f => f.score >= 0.5)
  const bearFactors = data.factors.filter(f => f.score <= -0.4)

  const priceMin = Math.min(...data.price_history.map(d => d.low)) * 0.995
  const priceMax = Math.max(...data.price_history.map(d => d.high)) * 1.005
  const chartData = data.price_history.slice(-40)

  return (
    <div className="panel space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="panel-title mb-0">Swing Trade Analyser</p>
          <p className="text-xs text-gray-500 mt-0.5">Multi-factor score · 5–20 day hold · ATR-based levels</p>
        </div>
        <span className="text-xs text-gray-600">
          Updated {new Date(data.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* ── Verdict card ───────────────────────────────────────────────── */}
      <div className={`${cfg.bg} border-2 ${cfg.border} rounded-2xl p-5`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-3xl">{cfg.icon}</span>
              <span className={`text-2xl font-black ${cfg.text}`}>{data.verdict}</span>
            </div>
            <p className="text-xs text-gray-400 max-w-xl leading-relaxed">{data.summary}</p>
          </div>
          {/* Probability + confidence */}
          <div className="flex gap-5 shrink-0">
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-0.5">Win Probability</p>
              <p className={`text-3xl font-black ${cfg.text}`}>{data.probability_pct.toFixed(0)}%</p>
              <div className="mt-1 h-1.5 w-20 bg-gray-700 rounded-full overflow-hidden ml-auto">
                <div className="h-full rounded-full" style={{ width: `${data.probability_pct}%`, backgroundColor: cfg.meter }} />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-0.5">Confidence</p>
              <p className={`text-3xl font-black ${cfg.text}`}>{data.confidence_pct.toFixed(0)}%</p>
              <div className="mt-1 h-1.5 w-20 bg-gray-700 rounded-full overflow-hidden ml-auto">
                <div className="h-full rounded-full" style={{ width: `${data.confidence_pct}%`, backgroundColor: cfg.meter }} />
              </div>
            </div>
          </div>
        </div>

        {/* Composite score meter */}
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Composite Score</span>
            <span className={`font-black ${cfg.text}`}>
              {data.composite_score > 0 ? '+' : ''}{data.composite_score} / 100
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
          <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
            <span>-100 Strong Sell</span><span>0 Neutral</span><span>+100 Strong Buy</span>
          </div>
        </div>
      </div>

      {/* ── Trade levels ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Entry',       val: data.entry_price,  sub: 'Current close',               color: 'text-white' },
          { label: 'Target',      val: data.target_price, sub: `+${rewardPct.toFixed(2)}%`,   color: 'text-emerald-400' },
          { label: 'Stop Loss',   val: data.stop_loss,    sub: `-${riskPct.toFixed(2)}%`,     color: 'text-red-400' },
          { label: 'Risk : Reward', val: null,
            display: `1 : ${data.risk_reward.toFixed(2)}`,
            sub: data.hold_days,
            color: data.risk_reward >= 2 ? 'text-emerald-400' : data.risk_reward >= 1.5 ? 'text-yellow-400' : 'text-red-400' },
        ].map(item => (
          <div key={item.label} className="bg-gray-800 rounded-xl px-3 py-2.5">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{item.label}</p>
            <p className={`text-lg font-bold ${item.color}`}>
              {item.val != null ? `${SYM}${fmt(item.val, 0)}` : (item as any).display}
            </p>
            <p className={`text-xs mt-0.5 ${item.val != null ? item.color + ' opacity-75' : 'text-gray-500'}`}>
              {item.sub}
            </p>
          </div>
        ))}
      </div>

      {/* ── Fib levels ────────────────────────────────────────────────── */}
      {(data.fib_382 || data.fib_618) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {data.week52_low  && <span className="bg-gray-800 rounded-lg px-3 py-1.5">52W Low  <strong className="text-white ml-1">{SYM}{fmt(data.week52_low, 0)}</strong></span>}
          {data.fib_382     && <span className="bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-1.5 text-yellow-400">Fib 38.2% <strong className="ml-1">{SYM}{fmt(data.fib_382, 0)}</strong></span>}
          {data.fib_618     && <span className="bg-lime-950 border border-lime-800 rounded-lg px-3 py-1.5 text-lime-400">Fib 61.8% <strong className="ml-1">{SYM}{fmt(data.fib_618, 0)}</strong></span>}
          {data.week52_high && <span className="bg-gray-800 rounded-lg px-3 py-1.5">52W High <strong className="text-white ml-1">{SYM}{fmt(data.week52_high, 0)}</strong></span>}
        </div>
      )}

      {/* ── Price chart ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">Price Action (Last 40 Sessions)</p>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 9 }} tickLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
              tickFormatter={v => String(v).slice(5)} />
            <YAxis yAxisId="price" domain={[priceMin, priceMax]}
              tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
              tickFormatter={v => `${SYM}${Number(v).toFixed(0)}`} width={58} />
            <YAxis yAxisId="vol" orientation="right"
              tick={{ fill: '#374151', fontSize: 9 }} tickLine={false} axisLine={false}
              tickFormatter={v => `${(Number(v)/1e6).toFixed(1)}M`} width={36} />
            <Tooltip content={<ChartTip />} />
            <Bar yAxisId="vol" dataKey="volume" fill="#1f2937" opacity={0.5} maxBarSize={4} />
            <Line yAxisId="price" type="monotone" dataKey="close" stroke="#0ea5e9" strokeWidth={1.5} dot={false} />
            <Line yAxisId="price" type="monotone" dataKey="high"  stroke="#10b981" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            <Line yAxisId="price" type="monotone" dataKey="low"   stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            <ReferenceLine yAxisId="price" y={data.entry_price}
              stroke="#f59e0b" strokeDasharray="5 3" strokeWidth={1.5}
              label={{ value: `Entry ${SYM}${data.entry_price}`, fill: '#f59e0b', fontSize: 9, position: 'insideTopLeft' }} />
            <ReferenceLine yAxisId="price" y={data.target_price}
              stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: `T ${SYM}${data.target_price}`, fill: '#10b981', fontSize: 9, position: 'insideTopLeft' }} />
            <ReferenceLine yAxisId="price" y={data.stop_loss}
              stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: `SL ${SYM}${data.stop_loss}`, fill: '#ef4444', fontSize: 9, position: 'insideBottomLeft' }} />
            {data.fib_618 && (
              <ReferenceLine yAxisId="price" y={data.fib_618}
                stroke="#a3e635" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `61.8%`, fill: '#a3e635', fontSize: 8, position: 'right' }} />
            )}
            {data.fib_382 && (
              <ReferenceLine yAxisId="price" y={data.fib_382}
                stroke="#facc15" strokeDasharray="3 3" strokeWidth={1}
                label={{ value: `38.2%`, fill: '#facc15', fontSize: 8, position: 'right' }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Why buy / Why risk ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isBullish && data.why_buy.length > 0 && (
          <div>
            <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wide mb-2">✅ Why Enter</p>
            <div className="space-y-1.5">
              {data.why_buy.slice(0, 4).map((r, i) => (
                <div key={i} className="flex gap-2 bg-emerald-950/40 border border-emerald-900 rounded-lg px-3 py-2 text-xs text-emerald-300">
                  <span className="shrink-0 mt-0.5">▲</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {data.why_risk.length > 0 && (
          <div>
            <p className="text-xs text-red-400 font-semibold uppercase tracking-wide mb-2">⚠️ Key Risks</p>
            <div className="space-y-1.5">
              {data.why_risk.slice(0, 4).map((r, i) => (
                <div key={i} className="flex gap-2 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2 text-xs text-red-300">
                  <span className="shrink-0 mt-0.5">▼</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Factor breakdown ──────────────────────────────────────────── */}
      <div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-2">
          Factor Breakdown <span className="text-gray-700 normal-case font-normal">— {bullFactors.length} bullish · {bearFactors.length} bearish</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {data.factors.map((f, i) => <FactorRow key={i} f={f} />)}
        </div>
      </div>

      {/* ── Disclaimer ────────────────────────────────────────────────── */}
      <div className="bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-2.5">
        <p className="text-xs text-yellow-500 font-semibold">⚠️ Risk Disclaimer</p>
        <p className="text-xs text-yellow-600 mt-0.5">
          Swing trading involves significant risk. Scores are algorithmic estimates based on technical
          indicators and do not account for news, earnings, or macro events. Always size positions
          appropriately and use stop losses. This is not financial advice.
        </p>
      </div>

    </div>
  )
}
