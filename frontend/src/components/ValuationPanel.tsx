import { useQuery } from '@tanstack/react-query'
import { getValuation } from '../api'
import { fmt, fmtPct, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'

interface Props { ticker: string }

const VERDICT_CFG = {
  'Undervalued':        { bg: 'bg-emerald-950', border: 'border-emerald-700', text: 'text-emerald-300', icon: '🟢' },
  'Fairly Valued':      { bg: 'bg-blue-950',    border: 'border-blue-700',    text: 'text-blue-300',    icon: '🔵' },
  'Overvalued':         { bg: 'bg-red-950',      border: 'border-red-700',     text: 'text-red-300',     icon: '🔴' },
  'Insufficient Data':  { bg: 'bg-gray-800',     border: 'border-gray-700',    text: 'text-gray-400',    icon: '⚪' },
}

function Gauge({ value, max, label, color }: { value: number | null; max: number; label: string; color: string }) {
  if (value == null) return (
    <div className="text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm text-gray-600">N/A</p>
    </div>
  )
  const pct = Math.min(Math.abs(value) / max * 100, 100)
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold text-white">{value.toFixed(1)}x</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export function ValuationPanel({ ticker }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['valuation', ticker],
    queryFn: () => getValuation(ticker),
    enabled: !!ticker,
  })

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Valuation</p>
      <p className="text-red-400 text-sm">Failed to load valuation data.</p>
    </div>
  )

  const cfg = VERDICT_CFG[data.verdict]
  const mosPct = data.margin_of_safety_pct

  return (
    <div className="panel space-y-4">
      <p className="panel-title">Valuation · Sector Comparison</p>

      {/* Verdict banner */}
      <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-4 flex items-start justify-between gap-4`}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{cfg.icon}</span>
            <span className={`text-lg font-black ${cfg.text}`}>{data.verdict}</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">{data.verdict_reason}</p>
        </div>
        {data.dcf_fair_value && (
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-500">Graham Value</p>
            <p className="text-xl font-bold text-white">{SYM}{fmt(data.dcf_fair_value, 0)}</p>
            {mosPct != null && (
              <p className={`text-xs font-semibold ${mosPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {mosPct >= 0 ? '▲' : '▼'} {Math.abs(mosPct).toFixed(1)}% {mosPct >= 0 ? 'upside' : 'downside'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'P/E (TTM)',     val: data.pe_ratio,      sector: data.sector_pe,  suffix: 'x' },
          { label: 'Forward P/E',   val: data.forward_pe,    sector: null,            suffix: 'x' },
          { label: 'P/B',           val: data.pb_ratio,      sector: data.sector_pb,  suffix: 'x' },
          { label: 'EPS (TTM)',     val: data.eps,            sector: null,            suffix: '', prefix: SYM },
          { label: 'PEG Ratio',     val: data.peg_ratio,     sector: null,            suffix: 'x' },
          { label: 'EV/EBITDA',     val: data.ev_to_ebitda,  sector: null,            suffix: 'x' },
        ].map(m => (
          <div key={m.label} className="metric-card">
            <span className="metric-label">{m.label}</span>
            <span className="metric-value">
              {m.val != null ? `${m.prefix || ''}${fmt(m.val, 1)}${m.suffix}` : 'N/A'}
            </span>
            {m.sector != null && (
              <span className="text-xs text-gray-500">Sector: {m.sector.toFixed(1)}x</span>
            )}
          </div>
        ))}
      </div>

      {/* PE vs Sector gauge */}
      {data.pe_ratio && data.sector_pe && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">P/E vs Sector Benchmark</p>
          <div className="bg-gray-800 rounded-lg p-3 space-y-3">
            <Gauge value={data.pe_ratio}  max={data.sector_pe * 2} label={`${data.ticker} P/E`} color="#0ea5e9" />
            <Gauge value={data.sector_pe} max={data.sector_pe * 2} label={`${data.sector} Sector P/E`} color="#6b7280" />
          </div>
        </div>
      )}

      {data.pb_ratio && data.sector_pb && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">P/B vs Sector Benchmark</p>
          <div className="bg-gray-800 rounded-lg p-3 space-y-3">
            <Gauge value={data.pb_ratio}  max={data.sector_pb * 2} label={`${data.ticker} P/B`} color="#0ea5e9" />
            <Gauge value={data.sector_pb} max={data.sector_pb * 2} label={`${data.sector} Sector P/B`} color="#6b7280" />
          </div>
        </div>
      )}

      {/* ── Order Book Proxy ── */}
      {(data.volume_vs_avg != null || data.day_range_position != null || data.short_ratio != null || data.bid_ask_spread_pct != null) && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">Order Book Signals</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.volume_vs_avg != null && (
              <div className="metric-card">
                <span className="metric-label">Vol vs Avg</span>
                <span className={`metric-value ${data.volume_vs_avg > 1.5 ? 'text-emerald-400' : data.volume_vs_avg < 0.5 ? 'text-red-400' : 'text-white'}`}>{data.volume_vs_avg.toFixed(2)}x</span>
                <span className="text-xs text-gray-500">{data.volume_vs_avg > 1.5 ? 'High conviction' : data.volume_vs_avg < 0.7 ? 'Low interest' : 'Normal'}</span>
              </div>
            )}
            {data.day_range_position != null && (
              <div className="metric-card">
                <span className="metric-label">Day Range Pos.</span>
                <span className="metric-value">{(data.day_range_position * 100).toFixed(0)}%</span>
                <div className="h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${data.day_range_position * 100}%` }} />
                </div>
              </div>
            )}
            {data.week52_range_position != null && (
              <div className="metric-card">
                <span className="metric-label">52W Range Pos.</span>
                <span className="metric-value">{(data.week52_range_position * 100).toFixed(0)}%</span>
                <div className="h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
                  <div className={`h-full rounded-full ${data.week52_range_position > 0.8 ? 'bg-red-500' : data.week52_range_position < 0.2 ? 'bg-emerald-500' : 'bg-brand-500'}`}
                    style={{ width: `${data.week52_range_position * 100}%` }} />
                </div>
              </div>
            )}
            {data.short_ratio != null && (
              <div className="metric-card">
                <span className="metric-label">Short Ratio</span>
                <span className={`metric-value ${data.short_ratio > 5 ? 'text-red-400' : 'text-white'}`}>{data.short_ratio.toFixed(1)}d</span>
                <span className="text-xs text-gray-500">{data.short_ratio > 5 ? 'Heavy short' : 'Normal'}</span>
              </div>
            )}
            {data.shares_short_pct != null && (
              <div className="metric-card">
                <span className="metric-label">Float Shorted</span>
                <span className={`metric-value ${data.shares_short_pct > 0.1 ? 'text-red-400' : 'text-white'}`}>{(data.shares_short_pct * 100).toFixed(1)}%</span>
              </div>
            )}
            {data.bid_ask_spread_pct != null && (
              <div className="metric-card">
                <span className="metric-label">Bid-Ask Spread</span>
                <span className="metric-value">{data.bid_ask_spread_pct.toFixed(3)}%</span>
                <span className="text-xs text-gray-500">{data.bid_ask_spread_pct < 0.05 ? 'Tight' : 'Wide'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
