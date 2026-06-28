import { useEffect, useRef, useState, Component, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries,
  ColorType, CrosshairMode, type IChartApi, type Time,
} from 'lightweight-charts'
import { getChartData } from '../api'
import { fmt, SYM } from '../utils'
import { PanelSkeleton } from './Skeleton'

interface Props { ticker: string }
type Interval = '1d' | '1wk' | '1mo'

const COLORS = {
  bg: '#111827', grid: '#1f2937', text: '#6b7280',
  bull: '#10b981', bear: '#ef4444',
}

const INTERVAL_LABELS: Record<Interval, string> = {
  '1d': 'Daily', '1wk': 'Weekly', '1mo': 'Monthly',
}

// ── All indicators config ─────────────────────────────────────────────────
const OVERLAYS = [
  { key:'ema9',       label:'EMA 9',   color:'#fb923c', field:'ema9' },
  { key:'ema20',      label:'EMA 20',  color:'#fbbf24', field:'ema20' },
  { key:'sma20',      label:'SMA 20',  color:'#f59e0b', field:'sma20',  dash:true },
  { key:'sma50',      label:'SMA 50',  color:'#6366f1', field:'sma50' },
  { key:'sma200',     label:'SMA 200', color:'#a855f7', field:'sma200' },
  { key:'vwap',       label:'VWAP',    color:'#22d3ee', field:'vwap',   width:2 },
  { key:'bb',         label:'BB',      color:'#0ea5e9', field:'bb_upper' },
  { key:'supertrend', label:'ST',      color:'#f97316', field:'supertrend' },
  { key:'volume',     label:'Volume',  color:'#374151', field:'volume' },
]

// ── Error boundary ────────────────────────────────────────────────────────
class ChartErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: boolean }
> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    if (this.state.error) return this.props.fallback ?? (
      <div className="panel">
        <p className="panel-title">Advanced Chart</p>
        <p className="text-yellow-400 text-sm">Chart failed to render. Try refreshing.</p>
      </div>
    )
    return this.props.children
  }
}

// ── Chip ──────────────────────────────────────────────────────────────────
function Chip({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className="px-2 py-1 rounded text-xs font-semibold border transition-all whitespace-nowrap"
      style={active
        ? { background: color + '22', color, borderColor: color }
        : { borderColor: '#374151', color: '#6b7280' }}>
      {label}
    </button>
  )
}

// ── Inner chart (no error boundary here) ─────────────────────────────────
function ChartInner({ ticker }: Props) {
  const [interval, setIntervalVal] = useState<Interval>('1d')
  const [active, setActive] = useState<Set<string>>(
    new Set(['ema9', 'sma50', 'bb', 'supertrend', 'volume'])
  )
  const [subPanel, setSubPanel] = useState<'rsi'|'macd'|'volume'|null>('rsi')
  const [showSR, setShowSR] = useState(false)

  const priceRef = useRef<HTMLDivElement>(null)
  const subRef   = useRef<HTMLDivElement>(null)
  const priceChart = useRef<IChartApi | null>(null)
  const subChart   = useRef<IChartApi | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['chart', ticker, interval],
    queryFn:  () => getChartData(ticker, interval),
    enabled:  !!ticker,
    staleTime: 300_000,
    retry: 1,
  })

  const toggle = (key: string) => setActive(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  // Destroy charts safely
  const destroyCharts = () => {
    try { priceChart.current?.remove() } catch {}
    try { subChart.current?.remove()   } catch {}
    priceChart.current = null
    subChart.current   = null
  }

  useEffect(() => {
    if (!priceRef.current || !data?.bars?.length) return

    destroyCharts()

    const bars: any[] = data.bars
    const w = priceRef.current.clientWidth || 800

    const baseOpts = (h: number) => ({
      layout: { background: { type: ColorType.Solid, color: COLORS.bg }, textColor: COLORS.text },
      grid:   { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: true, secondsVisible: false },
      width: w, height: h,
    })

    // ── Price chart ───────────────────────────────────────────────────
    priceChart.current = createChart(priceRef.current, baseOpts(380))
    const pc = priceChart.current

    const candles = pc.addSeries(CandlestickSeries, {
      upColor: COLORS.bull, downColor: COLORS.bear,
      borderUpColor: COLORS.bull, borderDownColor: COLORS.bear,
      wickUpColor: COLORS.bull, wickDownColor: COLORS.bear,
    })
    candles.setData(bars.map((d: any) => ({
      time: d.date as Time, open: d.open, high: d.high, low: d.low, close: d.close,
    })))

    // Support / resistance price lines
    if (showSR) {
      ;[...(data.supports ?? []), ...(data.resistances ?? [])].forEach((l: any) => {
        try {
          candles.createPriceLine({
            price: l.price,
            color: l.strength === 'strong' ? '#10b981' : '#f59e0b',
            lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.strength,
          })
        } catch {}
      })
    }

    // Volume histogram (scoped scale)
    if (active.has('volume')) {
      try {
        const vol = pc.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' }, priceScaleId: 'vol',
        } as any)
        pc.priceScale('vol').applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } })
        vol.setData(bars.map((d: any) => ({
          time: d.date as Time, value: d.volume,
          color: d.close >= d.open ? COLORS.bull + '55' : COLORS.bear + '55',
        })))
      } catch {}
    }

    // Line helper
    const addLine = (field: string, color: string, dash = false, lw: 1|2|3|4 = 1) => {
      try {
        const s = pc.addSeries(LineSeries, {
          color, lineWidth: lw, lineStyle: dash ? 2 : 0,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        const pts = bars.filter((d: any) => d[field] != null)
          .map((d: any) => ({ time: d.date as Time, value: d[field] as number }))
        if (pts.length) s.setData(pts)
      } catch {}
    }

    if (active.has('ema9'))   addLine('ema9',  '#fb923c')
    if (active.has('ema20'))  addLine('ema20', '#fbbf24')
    if (active.has('sma20'))  addLine('sma20', '#f59e0b', true)
    if (active.has('sma50'))  addLine('sma50', '#6366f1')
    if (active.has('sma200')) addLine('sma200','#a855f7')
    if (active.has('vwap'))   addLine('vwap',  '#22d3ee', false, 2)
    if (active.has('bb')) {
      addLine('bb_upper','#0ea5e9', true)
      addLine('bb_mid',  '#0ea5e9', true)
      addLine('bb_lower','#0ea5e9', true)
    }
    if (active.has('supertrend')) {
      try {
        const bull = pc.addSeries(LineSeries, { color: COLORS.bull, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        const bear = pc.addSeries(LineSeries, { color: COLORS.bear, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        const bPts = bars.filter((d: any) => d.st_bull  && d.supertrend != null).map((d: any) => ({ time: d.date as Time, value: d.supertrend as number }))
        const rPts = bars.filter((d: any) => !d.st_bull && d.supertrend != null).map((d: any) => ({ time: d.date as Time, value: d.supertrend as number }))
        if (bPts.length) bull.setData(bPts)
        if (rPts.length) bear.setData(rPts)
      } catch {}
    }

    pc.timeScale().fitContent()

    // ── Sub-panel chart ───────────────────────────────────────────────
    if (subRef.current && subPanel) {
      try {
        subChart.current = createChart(subRef.current, baseOpts(110))
        const sc = subChart.current

        if (subPanel === 'rsi') {
          const rsiS = sc.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 2, priceLineVisible: false, lastValueVisible: true })
          const pts = bars.filter((d: any) => d.rsi != null).map((d: any) => ({ time: d.date as Time, value: d.rsi as number }))
          if (pts.length) rsiS.setData(pts)
          rsiS.createPriceLine({ price: 70, color: COLORS.bear, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' })
          rsiS.createPriceLine({ price: 30, color: COLORS.bull, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' })
        }
        if (subPanel === 'macd') {
          const histS = sc.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false } as any)
          const hPts = bars.filter((d: any) => d.macd_hist != null).map((d: any) => ({
            time: d.date as Time, value: d.macd_hist as number,
            color: (d.macd_hist as number) >= 0 ? COLORS.bull + 'aa' : COLORS.bear + 'aa',
          }))
          if (hPts.length) histS.setData(hPts)
          const macdL = sc.addSeries(LineSeries, { color: '#0ea5e9', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
          macdL.setData(bars.map((d: any) => ({ time: d.date as Time, value: (d.macd ?? 0) as number })))
          const sigL = sc.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
          const sPts = bars.filter((d: any) => d.macd_signal != null).map((d: any) => ({ time: d.date as Time, value: d.macd_signal as number }))
          if (sPts.length) sigL.setData(sPts)
        }
        if (subPanel === 'volume') {
          const vs = sc.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false } as any)
          vs.setData(bars.map((d: any) => ({
            time: d.date as Time, value: d.volume as number,
            color: d.close >= d.open ? COLORS.bull + '99' : COLORS.bear + '99',
          })))
        }

        sc.timeScale().fitContent()
      } catch {}
    }

    // Resize observer
    const ro = new ResizeObserver(() => {
      try {
        if (priceRef.current) priceChart.current?.applyOptions({ width: priceRef.current.clientWidth })
        if (subRef.current)   subChart.current?.applyOptions({ width: subRef.current.clientWidth })
      } catch {}
    })
    if (priceRef.current) ro.observe(priceRef.current)

    return () => {
      ro.disconnect()
    }
  }, [data, active, subPanel, showSR])

  // Cleanup on unmount or ticker change
  useEffect(() => () => destroyCharts(), [ticker])

  if (isLoading) return <PanelSkeleton />
  if (isError || !data) return (
    <div className="panel">
      <p className="panel-title">Advanced Chart</p>
      <p className="text-yellow-400 text-sm">Chart data unavailable — backend may be waking up, try again in a moment.</p>
    </div>
  )

  const lastBar  = data.bars?.[data.bars.length - 1]
  const rsiNow   = data.rsi
  const stSig    = data.supertrend_signal

  return (
    <div className="panel space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="panel-title mb-0">Advanced Chart</p>
          <span className="text-xs font-mono font-bold text-brand-400">{ticker}</span>
          {lastBar && <span className="text-base font-bold text-white">{SYM}{fmt(lastBar.close)}</span>}
        </div>
        <div className="flex gap-1">
          {(['1d','1wk','1mo'] as Interval[]).map(i => (
            <button key={i} onClick={() => setIntervalVal(i)}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                interval === i ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}>{INTERVAL_LABELS[i]}</button>
          ))}
        </div>
      </div>

      {/* Indicator toggles */}
      <div className="flex flex-wrap gap-1.5">
        {OVERLAYS.map(o => (
          <Chip key={o.key} label={o.label} active={active.has(o.key)} color={o.color} onClick={() => toggle(o.key)} />
        ))}
        <Chip label="S/R Lines" active={showSR} color="#10b981" onClick={() => setShowSR(v => !v)} />
      </div>

      {/* Sub-panel selector */}
      <div className="flex gap-1">
        {(['rsi','macd','volume'] as const).map(sp => (
          <button key={sp} onClick={() => setSubPanel(subPanel === sp ? null : sp)}
            className={`px-3 py-1 rounded text-xs font-semibold uppercase transition-colors ${
              subPanel === sp ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}>{sp}</button>
        ))}
      </div>

      {/* Charts */}
      <div ref={priceRef} className="w-full rounded-lg overflow-hidden" />
      {subPanel && <div ref={subRef} className="w-full rounded-lg overflow-hidden" />}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label:'RSI',     val: rsiNow != null ? rsiNow.toFixed(1) : 'N/A',
            color: rsiNow == null ? '#9ca3af' : rsiNow < 30 ? '#10b981' : rsiNow > 70 ? '#ef4444' : '#9ca3af',
            sub: rsiNow == null ? '' : rsiNow < 30 ? 'Oversold' : rsiNow > 70 ? 'Overbought' : 'Neutral' },
          { label:'Supertrend', val: stSig?.toUpperCase() ?? 'N/A',
            color: stSig === 'bullish' ? '#10b981' : '#ef4444', sub: INTERVAL_LABELS[interval] },
          { label:'Interval',   val: INTERVAL_LABELS[interval], color:'#6366f1', sub:`${data.bars?.length ?? 0} bars` },
          { label:'Period High',val: lastBar ? `${SYM}${fmt(lastBar.high)}` : 'N/A', color:'#10b981', sub:'' },
          { label:'Period Low', val: lastBar ? `${SYM}${fmt(lastBar.low)}`  : 'N/A', color:'#ef4444', sub:'' },
        ].map(({ label, val, color, sub }) => (
          <div key={label} className="bg-gray-800 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-sm font-bold" style={{ color }}>{val}</p>
            {sub && <p className="text-xs text-gray-600">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Support / Resistance table */}
      {showSR && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-emerald-500 font-semibold uppercase mb-1.5">Support</p>
            <div className="space-y-1">
              {(data.supports ?? []).map((l: any, i: number) => (
                <div key={i} className="flex justify-between bg-gray-800 rounded px-2.5 py-1.5 text-xs">
                  <span className="text-emerald-400 font-bold">{SYM}{fmt(l.price)}</span>
                  <span className="text-gray-500 capitalize">{l.strength}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-red-400 font-semibold uppercase mb-1.5">Resistance</p>
            <div className="space-y-1">
              {(data.resistances ?? []).map((l: any, i: number) => (
                <div key={i} className="flex justify-between bg-gray-800 rounded px-2.5 py-1.5 text-xs">
                  <span className="text-red-400 font-bold">{SYM}{fmt(l.price)}</span>
                  <span className="text-gray-500 capitalize">{l.strength}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Public export wrapped in error boundary ───────────────────────────────
export function ChartPanel(props: Props) {
  return (
    <ChartErrorBoundary>
      <ChartInner {...props} />
    </ChartErrorBoundary>
  )
}
