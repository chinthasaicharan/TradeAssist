import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSectorsOverview } from '../api'
import type { SectorRow, DailyChange } from '../types'

// ── formatting helpers ───────────────────────────────────────────────────────
const pctCls = (v: number | null | undefined) =>
  v == null ? 'text-zinc-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-zinc-500'

const fmtPct = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`

const fmtFlow = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`

const fmtPrice = (v: number) =>
  v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

const shortTicker = (t: string) => t.replace('.NS', '').replace('.BO', '')

// ── mini spark bars: last-10-session daily % changes ─────────────────────────
function DailyBars({ changes }: { changes: DailyChange[] }) {
  const vals = changes.map(c => c.pct ?? 0)
  const max = Math.max(1, ...vals.map(Math.abs))
  if (!changes.length) return <span className="text-[10px] text-zinc-700">no index history</span>
  return (
    <div className="flex items-end gap-[3px] h-8" title="Daily % change, last 10 sessions">
      {changes.map((c, i) => {
        const p = c.pct ?? 0
        const h = Math.max(2, (Math.abs(p) / max) * 100)
        return (
          <div key={i} className="flex-1 min-w-[6px] max-w-[14px] h-full flex flex-col justify-end items-center gap-px group relative">
            <div
              className={`w-full rounded-sm ${p >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
              style={{ height: `${h}%` }}
            />
            <span className="pointer-events-none absolute -top-5 z-10 hidden group-hover:block whitespace-nowrap rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-200 border border-white/[0.1]">
              {c.date ?? ''} {fmtPct(c.pct)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── sector card ──────────────────────────────────────────────────────────────
function SectorCard({ s, onSelect }: { s: SectorRow; onSelect: (t: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] transition-colors overflow-hidden">
      <button className="w-full text-left p-4" onClick={() => setOpen(v => !v)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-white">{s.name}</h3>
              {s.index && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-zinc-500 font-mono">{s.index}</span>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              {s.constituents} stocks · {s.advancers}↑ {s.decliners}↓
              {s.index_value != null && <> · {fmtPrice(s.index_value)}</>}
            </p>
          </div>
          <span className={`text-lg font-bold tabular-nums shrink-0 ${pctCls(s.change_1d)}`}>
            {fmtPct(s.change_1d)}
          </span>
        </div>

        <div className="flex items-end justify-between gap-3 mt-3 flex-wrap">
          <DailyBars changes={s.daily_changes} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] tabular-nums ${pctCls(s.change_5d)}`}>5D {fmtPct(s.change_5d)}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-md bg-white/[0.04] tabular-nums ${pctCls(s.change_1m)}`}>1M {fmtPct(s.change_1m)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-3 text-[11px] flex-wrap">
          <span className="text-zinc-500">
            Flow 1D <span className={`font-semibold tabular-nums ${pctCls(s.flow_1d_cr)}`}>₹{fmtFlow(s.flow_1d_cr)} Cr</span>
            {'  '}· 5D <span className={`font-semibold tabular-nums ${pctCls(s.flow_5d_cr)}`}>₹{fmtFlow(s.flow_5d_cr)} Cr</span>
          </span>
          <span className="text-zinc-600">
            {s.top_gainer && <>▲ <span className="text-emerald-400/90 font-mono">{shortTicker(s.top_gainer.ticker)}</span> {fmtPct(s.top_gainer.pct_1d)}{'  '}</>}
            {s.top_loser && <>▼ <span className="text-red-400/90 font-mono">{shortTicker(s.top_loser.ticker)}</span> {fmtPct(s.top_loser.pct_1d)}</>}
          </span>
        </div>
      </button>

      {/* expandable constituents */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-white/[0.06] px-2 py-2 space-y-0.5">
            {s.stocks.map(m => (
              <button
                key={m.ticker}
                onClick={() => onSelect(m.ticker)}
                className="w-full grid grid-cols-[6rem_1fr_4.5rem_4.5rem_6rem] items-center gap-2 px-2 py-1.5 text-xs text-left rounded-lg hover:bg-white/[0.05] transition-colors"
              >
                <span className="font-mono font-semibold text-zinc-200">{shortTicker(m.ticker)}</span>
                <span className="tabular-nums text-zinc-400 text-right sm:text-left">₹{fmtPrice(m.price)}</span>
                <span className={`tabular-nums text-right ${pctCls(m.pct_1d)}`}>{fmtPct(m.pct_1d)}</span>
                <span className={`tabular-nums text-right hidden sm:block ${pctCls(m.pct_5d)}`}>{fmtPct(m.pct_5d)}</span>
                <span className={`tabular-nums text-right ${pctCls(m.flow_1d_cr)}`}>
                  {m.flow_1d_cr != null ? `₹${fmtFlow(m.flow_1d_cr)} Cr` : '—'}
                </span>
              </button>
            ))}
            <p className="px-2 pt-1 text-[10px] text-zinc-700">
              columns: price · 1D % · 5D % · net flow 1D (Δ price × volume proxy)
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────
export function SectorsPage({ onSelect }: { onSelect: (t: string) => void }) {
  const [sortBy, setSortBy] = useState<'1d' | '5d' | '1m' | 'flow'>('1d')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sectors-overview'],
    queryFn: getSectorsOverview,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })

  const sectors = useMemo(() => {
    if (!data) return []
    const rows = [...data.sectors]
    rows.sort((a, b) => {
      if (sortBy === 'flow') return b.flow_1d_cr - a.flow_1d_cr
      const key = sortBy === '1d' ? 'change_1d' : sortBy === '5d' ? 'change_5d' : 'change_1m'
      return ((b[key] ?? -999) as number) - ((a[key] ?? -999) as number)
    })
    return rows
  }, [data, sortBy])

  const bench = data?.benchmark
  const selCls = 'bg-zinc-950 border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500/60'

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Sectors</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {data?.as_of
              ? <>Sector performance and net money flows — as of <span className="text-zinc-300">{data.as_of}</span> · {data.scanned} Nifty 50 stocks</>
              : 'Sector performance and net money flows'}
          </p>
        </div>
        <select className={selCls} value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
          <option value="1d">Sort: 1D %</option>
          <option value="5d">Sort: 5D %</option>
          <option value="1m">Sort: 1M %</option>
          <option value="flow">Sort: Net flow</option>
        </select>
      </div>

      {/* market summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="metric-card rounded-xl p-3.5">
          <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">{bench?.name ?? 'Nifty 50'}</p>
          <p className="metric-value text-lg font-semibold text-white tabular-nums mt-1">
            {bench?.value != null ? fmtPrice(bench.value) : '—'}
          </p>
          <p className={`text-xs tabular-nums ${pctCls(bench?.change_1d)}`}>
            {fmtPct(bench?.change_1d)} 1D
            <span className="text-zinc-600"> · 5D {fmtPct(bench?.change_5d)}</span>
          </p>
        </div>
        <div className="metric-card rounded-xl p-3.5">
          <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Advancers / Decliners</p>
          <p className="text-lg font-semibold mt-1 tabular-nums">
            <span className="text-emerald-400">{data?.advancers ?? '—'}</span>
            <span className="text-zinc-600 text-sm"> / </span>
            <span className="text-red-400">{data?.decliners ?? '—'}</span>
          </p>
          <p className="text-xs text-zinc-600">of {data?.scanned ?? '—'} stocks scanned</p>
        </div>
        <div className="metric-card rounded-xl p-3.5">
          <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Net flow — today</p>
          <p className={`text-lg font-semibold mt-1 tabular-nums ${pctCls(data?.total_flow_1d_cr)}`}>
            ₹{data ? fmtFlow(data.total_flow_1d_cr) : '—'} Cr
          </p>
          <p className="text-xs text-zinc-600">Σ (Δ price × volume)</p>
        </div>
        <div className="metric-card rounded-xl p-3.5">
          <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Net flow — 5 days</p>
          <p className={`text-lg font-semibold mt-1 tabular-nums ${pctCls(data?.total_flow_5d_cr)}`}>
            ₹{data ? fmtFlow(data.total_flow_5d_cr) : '—'} Cr
          </p>
          <p className="text-xs text-zinc-600">cumulative, last 5 sessions</p>
        </div>
      </div>

      {/* body */}
      {isLoading && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">Building sector snapshot — first load takes ~30s…</p>
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 bg-white/[0.04] rounded-xl animate-pulse" />)}
        </div>
      )}

      {isError && (
        <div className="panel p-6 text-center">
          <p className="text-xs text-red-400">Couldn't load sector data. The backend may be waking up — retry in a moment.</p>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
          {sectors.map(s => <SectorCard key={s.name} s={s} onSelect={onSelect} />)}
        </div>
      )}

      {data && (
        <p className="text-[11px] text-zinc-600 leading-relaxed max-w-3xl">
          Performance uses NIFTY sector indices where available (Bank, IT, Energy, FMCG, Auto, Pharma, Metal, Infra);
          other sectors show an equal-weight mean of their Nifty 50 constituents. Net flow is an estimated money-flow
          proxy — (close − previous close) × volume summed per sector, in ₹ crore — not actual FII/DII fund flows.
          Click any sector to expand its stocks, click a stock to open its analysis.
        </p>
      )}
    </div>
  )
}
