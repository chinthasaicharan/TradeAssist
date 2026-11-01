import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStrategies, createStrategy, updateStrategy, deleteStrategy, forkStrategy,
  evaluateStrategy, scanStrategy,
} from '../api'
import type {
  ConditionRule, PineStrategy, StrategyEvalResult, StrategyScanRow,
} from '../types'

// ── Rule catalog (mirrors backend/strategy_engine.py) ────────────────────────
const INDICATORS: Record<string, { label: string; kind: 'numeric' | 'string'; options?: string[] }> = {
  price:          { label: 'Price',                    kind: 'numeric' },
  rsi:            { label: 'RSI (14)',                 kind: 'numeric' },
  price_vs_ma20:  { label: 'Price vs MA 20 (%)',       kind: 'numeric' },
  price_vs_ma50:  { label: 'Price vs MA 50 (%)',       kind: 'numeric' },
  price_vs_ma200: { label: 'Price vs MA 200 (%)',      kind: 'numeric' },
  golden_cross:   { label: 'MA 50/200 cross',          kind: 'string', options: ['golden', 'death'] },
  macd_state:     { label: 'MACD vs signal',           kind: 'string', options: ['bullish', 'bearish'] },
  macd_cross:     { label: 'MACD crossover (5d)',      kind: 'string', options: ['bullish', 'bearish'] },
  supertrend:     { label: 'Supertrend (10, 3)',       kind: 'string', options: ['bullish', 'bearish'] },
  volume_ratio:   { label: 'Volume vs 20d avg (x)',    kind: 'numeric' },
  momentum_52w:   { label: '52-week momentum (%)',     kind: 'numeric' },
  range_position: { label: '52-week range pos. (%)',   kind: 'numeric' },
  atr_pct:        { label: 'ATR as % of price',        kind: 'numeric' },
}
const NUMERIC_OPS = ['gt', 'lt', 'gte', 'lte', 'eq', 'cross_above', 'cross_below']
const OP_LABEL: Record<string, string> = {
  gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=',
  cross_above: 'crosses above', cross_below: 'crosses below',
}

function ruleText(r: ConditionRule): string {
  const meta = INDICATORS[r.indicator]
  if (!meta) return 'unknown rule'
  if (meta.kind === 'string') return `${meta.label} is ${r.value}`
  return `${meta.label} ${OP_LABEL[r.operator] ?? r.operator} ${r.value}`
}

const PINE_TEMPLATE = '//@version=6\nstrategy("My Strategy", overlay=true)\n\n// Write your Pine Script here\n'

// ── Inline icons ─────────────────────────────────────────────────────────────
const IconBtn = 'p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors disabled:opacity-40'
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
)
const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
)
const EditIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
)
const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
)
const TVIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2 6h8.5v2.5H7.7V17H5.1V8.5H2V6zm10.4 0h2.6l2.2 6.6L19.4 6H22l-3.8 11h-2.6l-1.6-4.8L12.4 17H9.8L12.4 6z" /></svg>
)
const ForkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="9" r="2.5" /><path d="M6 8.5v7M6 12c0-3 4-3 9.5-3" /></svg>
)
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12" /></svg>
)

function openInTradingView(script: string, ticker: string) {
  navigator.clipboard.writeText(script).catch(() => {})
  const sym = ticker.replace('.NS', '').replace('.BO', '')
  window.open('https://www.tradingview.com/pine-editor/?symbol=NSE%3A' + sym, '_blank', 'noopener,noreferrer')
}

function apiError(e: unknown): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(x => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x))).join(' · ')
  return 'Something went wrong'
}

// ── Condition row (builder) ──────────────────────────────────────────────────
function ConditionRow({ rule, onChange, onRemove }: {
  rule: ConditionRule
  onChange: (r: ConditionRule) => void
  onRemove: () => void
}) {
  const meta = INDICATORS[rule.indicator]
  const selCls = 'bg-zinc-950 border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500/60'
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <select
        className={selCls + ' flex-1 min-w-[150px]'}
        value={rule.indicator}
        onChange={e => {
          const m = INDICATORS[e.target.value]
          if (m.kind === 'string') onChange({ indicator: e.target.value, operator: 'eq', value: m.options![0] })
          else onChange({ indicator: e.target.value, operator: 'gt', value: 0 })
        }}
      >
        {Object.entries(INDICATORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <select
        className={selCls + ' w-28'}
        value={rule.operator}
        disabled={meta.kind === 'string'}
        onChange={e => onChange({ ...rule, operator: e.target.value })}
      >
        {(meta.kind === 'string' ? ['eq'] : NUMERIC_OPS).map(op => (
          <option key={op} value={op}>{OP_LABEL[op]}</option>
        ))}
      </select>
      {meta.kind === 'string' ? (
        <select className={selCls + ' w-24'} value={String(rule.value)}
                onChange={e => onChange({ ...rule, value: e.target.value })}>
          {meta.options!.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type="number" step="any"
          className={selCls + ' w-24 tabular-nums'}
          value={String(rule.value)}
          onChange={e => onChange({ ...rule, value: e.target.value === '' ? 0 : Number(e.target.value) })}
        />
      )}
      <button onClick={onRemove} className={IconBtn} title="Remove condition"><TrashIcon /></button>
    </div>
  )
}

// ── Editor modal (rule builder | pine script) ────────────────────────────────
function EditorModal({ initial, onClose }: { initial: PineStrategy | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(initial?.name ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [tab, setTab] = useState<'rules' | 'pine'>(
    initial ? (initial.conditions?.length ? 'rules' : 'pine') : 'rules'
  )
  const [conds, setConds] = useState<ConditionRule[]>(initial?.conditions ?? [])
  const [script, setScript] = useState(initial && !initial.conditions?.length ? initial.script : PINE_TEMPLATE)
  const [error, setError] = useState('')

  const mut = useMutation({
    mutationFn: () => {
      const useRules = tab === 'rules' && conds.length > 0
      const body = useRules
        ? { name, description: desc, script: '', conditions: conds }
        : { name, description: desc, script, conditions: [] }
      return initial && !initial.is_builtin
        ? updateStrategy(initial.id, body)
        : createStrategy(body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); onClose() },
    onError: (e) => setError(apiError(e)),
  })

  const save = () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (tab === 'rules') {
      if (conds.length === 0) { setError('Add at least one condition, or switch to the Pine Script tab'); return }
    } else if (!script.trim()) { setError('Script cannot be empty'); return }
    setError('')
    mut.mutate()
  }

  const inputCls = 'w-full bg-zinc-950 border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500/60'
  const tabCls = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${active ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-300'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl bg-zinc-900 border border-white/[0.08] rounded-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white">{initial && !initial.is_builtin ? 'Edit strategy' : 'New strategy'}</h3>
          <div className="flex gap-1">
            <button className={tabCls(tab === 'rules')} onClick={() => setTab('rules')}>Rule builder</button>
            <button className={tabCls(tab === 'pine')} onClick={() => setTab('pine')}>Pine Script</button>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Name</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Trend Rider" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Description</label>
              <input className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} placeholder="What does it look for?" />
            </div>
          </div>

          {tab === 'rules' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Conditions — all must be true (AND)</label>
                <button
                  className="text-xs text-brand-400 hover:text-brand-300 font-semibold disabled:opacity-40"
                  disabled={conds.length >= 12}
                  onClick={() => setConds(c => [...c, { indicator: 'rsi', operator: 'lt', value: 30 }])}
                >+ Add condition</button>
              </div>
              {conds.length === 0 && (
                <p className="text-xs text-zinc-600 border border-dashed border-white/[0.08] rounded-lg px-3 py-4 text-center">
                  No conditions yet — e.g. <span className="text-zinc-400">RSI &lt; 30</span>, <span className="text-zinc-400">Supertrend is bullish</span>, <span className="text-zinc-400">Price crosses above MA 50</span>
                </p>
              )}
              {conds.map((c, i) => (
                <ConditionRow
                  key={i}
                  rule={c}
                  onChange={r => setConds(arr => arr.map((x, j) => j === i ? r : x))}
                  onRemove={() => setConds(arr => arr.filter((_, j) => j !== i))}
                />
              ))}
              {conds.length > 0 && (
                <div className="bg-zinc-950/60 border border-white/[0.06] rounded-lg px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Match rule</p>
                  <p className="text-xs text-zinc-300 font-medium">{conds.map(ruleText).join('  AND  ')}</p>
                </div>
              )}
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                A matching Pine v6 script is generated automatically — use the TV button to run it on TradingView charts.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Pine Script v6</label>
              <textarea
                className="w-full h-80 bg-zinc-950 border border-white/[0.1] rounded-lg p-3 font-mono text-xs text-emerald-300/90 leading-relaxed focus:outline-none focus:border-brand-500/60 resize-y"
                value={script}
                onChange={e => setScript(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const ta = e.currentTarget
                    const s = ta.selectionStart
                    setScript(script.slice(0, s) + '    ' + script.slice(ta.selectionEnd))
                    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 4 })
                  }
                }}
                spellCheck={false}
              />
              <p className="text-[10px] text-zinc-600 mt-1">{script.split('\n').length} lines · saving clears any rule-builder conditions</p>
            </div>
          )}

          {error && <p className="text-xs text-red-400 bg-red-950/60 border border-red-900/50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-white/[0.06]">
          <button onClick={onClose} className="px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/[0.06] transition-colors">Cancel</button>
          <button onClick={save} disabled={mut.isPending}
                  className="px-4 py-2 text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors disabled:opacity-50">
            {mut.isPending ? 'Saving…' : 'Save strategy'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Analyse result ───────────────────────────────────────────────────────────
function AnalyseResult({ result }: { result: StrategyEvalResult }) {
  return (
    <div className="mt-3 rounded-xl border border-white/[0.06] bg-zinc-950/60 overflow-hidden">
      <div className={`px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 ${
        result.passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.03] text-zinc-400'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${result.passed ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
        {result.passed ? 'MATCH — all conditions true for ' : 'No match for '}{result.ticker}
      </div>
      <div className="divide-y divide-white/[0.04]">
        {result.results.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-3.5 py-2 text-xs">
            <span className="text-zinc-400">{r.label}</span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="text-zinc-200 font-medium">{r.actual ?? '—'}</span>
              <span className="text-zinc-600">{OP_LABEL[r.operator] ?? r.operator} {r.threshold}</span>
              <span className={`font-bold ${r.passed ? 'text-emerald-400' : 'text-red-400'}`}>{r.passed ? '✓' : '✗'}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Market scan ──────────────────────────────────────────────────────────────
function ScanSection({ strategyId, onSelectTicker }: { strategyId: string; onSelectTicker?: (t: string) => void }) {
  const [mode, setMode] = useState<'n50' | 'custom'>('n50')
  const [custom, setCustom] = useState('')
  const scanMut = useMutation({
    mutationFn: () => {
      const tickers = mode === 'custom'
        ? custom.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
        : []
      return scanStrategy(strategyId, tickers)
    },
  })

  return (
    <div className="mt-3 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-3.5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-white/[0.04] rounded-lg p-0.5 gap-0.5">
          <button className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${mode === 'n50' ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                  onClick={() => setMode('n50')}>Nifty 50</button>
          <button className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${mode === 'custom' ? 'bg-white/[0.1] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                  onClick={() => setMode('custom')}>Custom</button>
        </div>
        {mode === 'custom' && (
          <input
            className="flex-1 min-w-[180px] bg-zinc-950 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500/60 font-mono"
            placeholder="TCS.NS, INFY.NS, RELIANCE.NS (max 50)"
            value={custom}
            onChange={e => setCustom(e.target.value)}
          />
        )}
        <button
          className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50"
          disabled={scanMut.isPending || (mode === 'custom' && !custom.trim())}
          onClick={() => scanMut.mutate()}
        >
          {scanMut.isPending ? 'Scanning…' : 'Scan market'}
        </button>
      </div>

      {scanMut.isPending && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">Fetching 2 years of daily data per ticker in batches — this takes a minute or two…</p>
          {[0, 1, 2].map(i => <div key={i} className="h-9 bg-white/[0.04] rounded-lg animate-pulse" />)}
        </div>
      )}

      {scanMut.isError && (
        <p className="text-xs text-red-400 bg-red-950/60 border border-red-900/50 rounded-lg px-3 py-2">{apiError(scanMut.error)}</p>
      )}

      {scanMut.data && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-200 font-semibold">{scanMut.data.matched}</span> of {scanMut.data.scanned} tickers match ·
            sorted by best fit · click a row to load its chart
          </p>
          <div className="hidden sm:grid grid-cols-[6rem_5rem_1fr_1fr_1fr] gap-2 px-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
            <span>Ticker</span><span>Rules</span><span>RSI</span><span>vs MA50</span><span>52W mom</span>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5">
            {scanMut.data.results.map(row => <ScanRow key={row.ticker} row={row} onSelect={onSelectTicker} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function ScanRow({ row, onSelect }: { row: StrategyScanRow; onSelect?: (t: string) => void }) {
  return (
    <button onClick={() => onSelect?.(row.ticker)}
            className={`w-full grid grid-cols-[5.5rem_4.5rem_1fr] sm:grid-cols-[6rem_5rem_1fr_1fr_1fr] items-center gap-2 px-3 py-2 text-xs text-left rounded-lg border transition-colors ${
              row.passed
                ? 'bg-emerald-500/[0.07] border-emerald-500/20 hover:border-emerald-500/40'
                : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.1]'
            }`}>
      <span className="font-mono font-semibold text-zinc-200">{row.ticker.replace('.NS', '')}</span>
      <span className={`font-bold ${row.passed ? 'text-emerald-400' : 'text-zinc-500'}`}>
        {row.passed ? 'MATCH' : `${row.passed_count}/${row.total}`}
      </span>
      <span className="tabular-nums text-zinc-400">{row.summary.rsi ?? '—'}</span>
      <span className="tabular-nums text-zinc-400 hidden sm:block">
        {row.summary.price_vs_ma50 != null ? `${row.summary.price_vs_ma50 > 0 ? '+' : ''}${row.summary.price_vs_ma50}%` : '—'}
      </span>
      <span className={`tabular-nums hidden sm:block ${(row.summary.momentum_52w ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {row.summary.momentum_52w != null ? `${row.summary.momentum_52w > 0 ? '+' : ''}${row.summary.momentum_52w}%` : '—'}
      </span>
    </button>
  )
}

// ── Strategy card ────────────────────────────────────────────────────────────
function StrategyCard({ s, ticker, onEdit, onFork, onDelete, onSelectTicker }: {
  s: PineStrategy
  ticker: string
  onEdit: (s: PineStrategy) => void
  onFork: (id: string) => void
  onDelete: (s: PineStrategy) => void
  onSelectTicker?: (t: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showAnalyse, setShowAnalyse] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [evalResult, setEvalResult] = useState<StrategyEvalResult | null>(null)

  const evalMut = useMutation({
    mutationFn: () => evaluateStrategy(s.id, ticker),
    onSuccess: setEvalResult,
  })

  const copy = () => {
    navigator.clipboard.writeText(s.script).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.1] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-white">{s.name}</h4>
            {s.is_builtin && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 ring-1 ring-inset ring-purple-500/30 font-semibold">Built-in</span>
            )}
            {s.conditions.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 ring-1 ring-inset ring-brand-500/25 font-semibold">Rules</span>
            )}
          </div>
          {s.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{s.description}</p>}
          {s.conditions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {s.conditions.map((c, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.05] text-zinc-400 font-medium">{ruleText(c)}</span>
              ))}
            </div>
          )}
          {!s.conditions.length && (
            <p className="text-[10px] text-zinc-600 font-mono mt-1.5">{s.script.split('\n').length} lines · Pine Script v6</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button className={IconBtn} title="Open in TradingView (script copied)" onClick={() => openInTradingView(s.script, ticker)}><TVIcon /></button>
          <button className={IconBtn} title={copied ? 'Copied!' : 'Copy script'} onClick={copy}>
            {copied ? <span className="text-[10px] font-bold text-emerald-400 px-0.5">✓</span> : <CopyIcon />}
          </button>
          <button className={IconBtn + ' hover:text-amber-400'} title="Fork (editable copy)" onClick={() => onFork(s.id)}><ForkIcon /></button>
          {!s.is_builtin && (
            <>
              <button className={IconBtn} title="Edit" onClick={() => onEdit(s)}><EditIcon /></button>
              <button className={IconBtn + ' hover:text-red-400'} title="Delete" onClick={() => onDelete(s)}><TrashIcon /></button>
            </>
          )}
        </div>
      </div>

      {s.conditions.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <button
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50"
            disabled={evalMut.isPending}
            onClick={() => {
              if (showAnalyse) { setShowAnalyse(false); return }
              setShowAnalyse(true); setEvalResult(null); evalMut.mutate()
            }}
          >
            {evalMut.isPending ? 'Analysing…' : showAnalyse ? 'Hide analysis' : `Analyse ${ticker.replace('.NS', '')}`}
          </button>
          <button
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              showScan ? 'bg-white/[0.08] text-zinc-200' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]'
            }`}
            onClick={() => setShowScan(v => !v)}
          >
            Scan market
          </button>
        </div>
      )}

      {showAnalyse && (
        evalMut.isPending ? (
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map(i => <div key={i} className="h-8 bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        ) : evalMut.isError ? (
          <p className="mt-3 text-xs text-red-400 bg-red-950/60 border border-red-900/50 rounded-lg px-3 py-2">{apiError(evalMut.error)}</p>
        ) : evalResult ? (
          <AnalyseResult result={evalResult} />
        ) : null
      )}

      {showScan && <ScanSection strategyId={s.id} onSelectTicker={onSelectTicker} />}

      {!s.conditions.length && (
        <>
          <button className="mt-3 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Hide script ▲' : 'Show script ▼'}
          </button>
          {expanded && (
            <div className="relative mt-2">
              <pre className="text-[11px] font-mono text-zinc-400 bg-zinc-950/80 rounded-lg p-3 max-h-64 overflow-y-auto whitespace-pre">{s.script}</pre>
              <button className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-md bg-white/[0.06] text-zinc-400 hover:text-white transition-colors" onClick={copy}>Copy</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export function PineScriptPanel({ ticker, onClose, onSelectTicker }: {
  ticker: string
  onClose?: () => void
  onSelectTicker?: (t: string) => void
}) {
  const qc = useQueryClient()
  const [showEditor, setShowEditor] = useState(false)
  const [editTarget, setEditTarget] = useState<PineStrategy | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PineStrategy | null>(null)
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const { data: strategies, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: getStrategies,
    staleTime: 30_000,
  })

  const forkMut = useMutation({
    mutationFn: forkStrategy,
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['strategies'] }); showToast(`Forked as "${s.name}"`) },
    onError: (e) => showToast(apiError(e)),
  })
  const deleteMut = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); showToast('Strategy deleted') },
    onError: (e) => showToast(apiError(e)),
  })

  return (
    <>
      <div className="panel space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="panel-title !mb-0">Strategies</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.05] text-zinc-400 font-mono">{ticker}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white transition-colors inline-flex items-center gap-1"
              onClick={() => { setEditTarget(null); setShowEditor(true) }}
            >
              <PlusIcon /> New Strategy
            </button>
            {onClose && <button className={IconBtn} onClick={onClose} title="Close"><CloseIcon /></button>}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-zinc-950/50 px-3.5 py-2.5">
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            <span className="text-zinc-300 font-semibold">Rule builder:</span> define conditions (RSI, MA crossovers, Supertrend…), then{' '}
            <span className="text-brand-400 font-semibold">Analyse</span> the current stock or{' '}
            <span className="text-brand-400 font-semibold">Scan</span> the market for matches. A Pine v6 script is generated for TradingView.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1].map(i => <div key={i} className="h-20 bg-white/[0.04] rounded-xl animate-pulse" />)}
          </div>
        ) : !strategies?.length ? (
          <p className="text-center text-xs text-zinc-600 py-8">No strategies yet — create one to start analysing.</p>
        ) : (
          <div className="space-y-3">
            {strategies.map(s => (
              <StrategyCard
                key={s.id} s={s} ticker={ticker}
                onEdit={st => { setEditTarget(st); setShowEditor(true) }}
                onFork={id => forkMut.mutate(id)}
                onDelete={setDeleteTarget}
                onSelectTicker={onSelectTicker}
              />
            ))}
          </div>
        )}
      </div>

      {showEditor && <EditorModal initial={editTarget} onClose={() => setShowEditor(false)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-white/[0.08] rounded-2xl p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-1">Delete strategy?</h3>
            <p className="text-xs text-zinc-500 mb-4">"{deleteTarget.name}" will be removed permanently.</p>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-white/[0.06] transition-colors" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="px-3 py-2 text-xs font-bold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                      onClick={() => { deleteMut.mutate(deleteTarget.id); setDeleteTarget(null) }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-zinc-800 border border-white/[0.1] text-zinc-200 text-xs px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </>
  )
}
