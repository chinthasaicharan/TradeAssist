import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getChartData } from '../api'
import { fmt, SYM } from '../utils'
import {
  fetchTrades, unpinTrade, updateTradeNote, evaluateOutcome,
  type PinnedTrade, type TradeOutcome,
} from '../tradeTracker'

interface Props {
  onSelectTicker: (ticker: string) => void
  compact?: boolean   // compact=true on homepage, compact=false for full view
}

const OUTCOME_CFG: Record<TradeOutcome, { bg: string; border: string; text: string; badge: string; icon: string }> = {
  'Target Hit':    { bg: 'bg-emerald-950', border: 'border-emerald-700', text: 'text-emerald-300', badge: 'bg-emerald-900 text-emerald-300', icon: '🎯' },
  'Stop Loss Hit': { bg: 'bg-red-950',     border: 'border-red-800',     text: 'text-red-300',     badge: 'bg-red-900 text-red-300',         icon: '🛑' },
  'Open':          { bg: 'bg-zinc-900',    border: 'border-zinc-700',    text: 'text-blue-300',    badge: 'bg-blue-900 text-blue-300',        icon: '📊' },
  'Expired':       { bg: 'bg-zinc-800',    border: 'border-zinc-700',    text: 'text-zinc-400',    badge: 'bg-zinc-700 text-zinc-400',        icon: '⌛' },
}

// ── Row used in compact homepage view ────────────────────────────────────────
function CompactRow({
  trade,
  onUnpin,
  onSelect,
}: {
  trade: PinnedTrade
  onUnpin: (id: string) => void
  onSelect: (t: string) => void
}) {
  const { data: chartData } = useQuery({
    queryKey: ['chart-outcome', trade.ticker],
    queryFn:  () => getChartData(trade.ticker, '1d'),
    staleTime: 15 * 60 * 1000,
  })

  const evaluated = { ...trade }
  if (chartData?.candles) {
    const bars = chartData.candles.map((c: any) => ({
      date: c.time ?? c.date, high: c.high, low: c.low, close: c.close,
    }))
    Object.assign(evaluated, evaluateOutcome(trade, bars))
  }

  const outcome  = evaluated.outcome ?? 'Open'
  const cfg      = OUTCOME_CFG[outcome]
  const pnl      = evaluated.currentPnlPct ?? 0
  const pnlColor = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-zinc-400'
  const sym      = trade.ticker.replace('.NS', '').replace('.BO', '')

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${cfg.bg} ${cfg.border}`}>
      {/* Outcome icon */}
      <span className="text-xl shrink-0">{cfg.icon}</span>

      {/* Stock + type */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onSelect(trade.ticker)}
            className="font-bold text-white font-mono text-sm hover:text-brand-400 transition-colors"
          >
            {sym}
          </button>
          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${cfg.badge}`}>
            {outcome}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
            trade.type === 'BTST' ? 'bg-purple-900 text-purple-300' : 'bg-indigo-900 text-indigo-300'
          }`}>{trade.type}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-xs text-zinc-500">
            Entry {SYM}{fmt(trade.entryPrice, 0)}
          </span>
          <span className="text-xs text-emerald-600">
            Target {SYM}{fmt(trade.targetPrice, 0)}
          </span>
          <span className="text-xs text-red-600">
            SL {SYM}{fmt(trade.stopLoss, 0)}
          </span>
          {evaluated.currentPrice != null && (
            <span className="text-xs text-zinc-400">
              Now {SYM}{fmt(evaluated.currentPrice, 0)}
            </span>
          )}
        </div>
        {/* Outcome detail */}
        {outcome !== 'Open' && evaluated.outcomeDate && (
          <p className="text-xs text-zinc-600 mt-0.5">
            {outcome} on {new Date(evaluated.outcomeDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            {evaluated.daysToOutcome != null && ` · took ${evaluated.daysToOutcome} day${evaluated.daysToOutcome !== 1 ? 's' : ''}`}
          </p>
        )}
        {outcome === 'Open' && evaluated.daysToOutcome != null && (
          <p className="text-xs text-zinc-600 mt-0.5">Active {evaluated.daysToOutcome}d · {trade.verdict}</p>
        )}
      </div>

      {/* P&L */}
      <div className="text-right shrink-0">
        <p className={`text-sm font-black ${pnlColor}`}>
          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
        </p>
        {outcome !== 'Open' && evaluated.daysToOutcome != null && (
          <p className="text-xs text-zinc-600">{evaluated.daysToOutcome}d to {outcome === 'Target Hit' ? 'target' : outcome === 'Stop Loss Hit' ? 'SL' : 'close'}</p>
        )}
        {outcome === 'Open' && evaluated.daysToOutcome != null && (
          <p className="text-xs text-zinc-600">{evaluated.daysToOutcome}d open</p>
        )}
        <button
          onClick={() => onUnpin(trade.id)}
          className="text-xs text-zinc-700 hover:text-red-400 transition-colors mt-1 block"
          title="Remove"
        >Remove</button>
      </div>
    </div>
  )
}

// ── Full expanded card used in stock view ─────────────────────────────────────
function FullCard({
  trade,
  onUnpin,
  onNoteChange,
  onSelect,
}: {
  trade: PinnedTrade
  onUnpin: (id: string) => void
  onNoteChange: (id: string, note: string) => void
  onSelect: (t: string) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal]         = useState(trade.note)
  const [expanded, setExpanded]       = useState(false)

  const { data: chartData } = useQuery({
    queryKey: ['chart-outcome', trade.ticker],
    queryFn:  () => getChartData(trade.ticker, '1d'),
    staleTime: 15 * 60 * 1000,
  })

  const evaluated = { ...trade }
  if (chartData?.candles) {
    const bars = chartData.candles.map((c: any) => ({
      date: c.time ?? c.date, high: c.high, low: c.low, close: c.close,
    }))
    Object.assign(evaluated, evaluateOutcome(trade, bars))
  }

  const outcome  = evaluated.outcome ?? 'Open'
  const cfg      = OUTCOME_CFG[outcome]
  const pnl      = evaluated.currentPnlPct ?? 0
  const pnlColor = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-zinc-400'
  const riskPct   = ((trade.entryPrice - trade.stopLoss)   / trade.entryPrice * 100).toFixed(2)
  const rewardPct = ((trade.targetPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2)

  return (
    <div className={`border rounded-xl overflow-hidden ${cfg.bg} ${cfg.border}`}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{cfg.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="font-bold text-white font-mono text-sm hover:text-brand-400"
                onClick={e => { e.stopPropagation(); onSelect(trade.ticker) }}
              >
                {trade.ticker.replace('.NS','').replace('.BO','')}
              </button>
              <span className="text-xs text-zinc-400 truncate hidden sm:block">{trade.companyName}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                trade.type === 'BTST' ? 'bg-purple-900 text-purple-300' : 'bg-indigo-900 text-indigo-300'
              }`}>{trade.type}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${cfg.badge}`}>{outcome}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {new Date(trade.pinnedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' })}
              {' · '}Entry {SYM}{fmt(trade.entryPrice, 0)}
              {' · '}T {SYM}{fmt(trade.targetPrice, 0)}
              {' · '}SL {SYM}{fmt(trade.stopLoss, 0)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className={`text-sm font-black ${pnlColor}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</p>
            {evaluated.currentPrice && (
              <p className="text-xs text-zinc-500">{SYM}{fmt(evaluated.currentPrice, 0)}</p>
            )}
          </div>
          <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
          {/* Price grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Entry',       val: trade.entryPrice,  color: 'text-white',       sub: null },
              { label: 'Target',      val: trade.targetPrice, color: 'text-emerald-400', sub: `+${rewardPct}%` },
              { label: 'Stop Loss',   val: trade.stopLoss,    color: 'text-red-400',     sub: `-${riskPct}%` },
              { label: 'R:R',         val: null,              color: trade.riskReward >= 2 ? 'text-emerald-400' : 'text-yellow-400',
                display: `1 : ${trade.riskReward.toFixed(2)}` },
            ].map(item => (
              <div key={item.label} className="bg-zinc-900 rounded-lg px-3 py-2">
                <p className="text-xs text-zinc-500 mb-0.5">{item.label}</p>
                <p className={`text-sm font-bold ${item.color}`}>
                  {item.val != null ? `${SYM}${fmt(item.val, 0)}` : (item as any).display}
                </p>
                {item.sub && <p className={`text-xs ${item.color} opacity-70`}>{item.sub}</p>}
              </div>
            ))}
          </div>

          {/* Outcome detail */}
          {outcome !== 'Open' && (
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${cfg.bg} ${cfg.border}`}>
              <span className="text-2xl">{cfg.icon}</span>
              <div>
                <p className={`font-bold ${cfg.text}`}>{outcome}</p>
                <p className="text-xs text-zinc-400">
                  {evaluated.outcomeDate && `on ${new Date(evaluated.outcomeDate).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' })}`}
                  {evaluated.daysToOutcome != null && ` · took ${evaluated.daysToOutcome} day${evaluated.daysToOutcome !== 1 ? 's' : ''} from entry`}
                  {evaluated.outcomePrice != null && ` · at ${SYM}${fmt(evaluated.outcomePrice, 0)}`}
                </p>
              </div>
              <p className={`ml-auto text-xl font-black ${pnlColor}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</p>
            </div>
          )}

          {/* Live status */}
          {outcome === 'Open' && evaluated.currentPrice != null && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-zinc-900 rounded-lg px-4 py-3">
              {[
                { label: 'Current Price', val: `${SYM}${fmt(evaluated.currentPrice, 0)}`, color: 'text-white' },
                { label: 'P&L',           val: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`, color: pnlColor },
                { label: 'Days Active',   val: `${evaluated.daysToOutcome ?? 0}d`, color: 'text-white' },
                { label: 'Confidence',    val: `${trade.confidence.toFixed(0)}%`, color: 'text-white' },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-zinc-500 mb-0.5">{item.label}</p>
                  <p className={`text-sm font-bold ${item.color}`}>{item.val}</p>
                </div>
              ))}
            </div>
          )}

          {/* Note */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-zinc-500 uppercase font-semibold tracking-wide">📝 Note</p>
              {!editingNote && (
                <button onClick={() => setEditingNote(true)} className="text-xs text-brand-400 hover:text-brand-300">
                  {noteVal ? 'Edit' : '+ Add note'}
                </button>
              )}
            </div>
            {editingNote ? (
              <div className="space-y-2">
                <textarea
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-brand-500"
                  rows={2} value={noteVal} autoFocus
                  onChange={e => setNoteVal(e.target.value)}
                  placeholder="Your thesis, reason for this trade..."
                />
                <div className="flex gap-2">
                  <button onClick={() => { onNoteChange(trade.id, noteVal); setEditingNote(false) }}
                    className="text-xs bg-brand-700 hover:bg-brand-600 text-white px-3 py-1.5 rounded-lg">Save</button>
                  <button onClick={() => { setNoteVal(trade.note); setEditingNote(false) }}
                    className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg">Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic">
                {noteVal || <span className="text-zinc-700">No note. Click "+ Add note".</span>}
              </p>
            )}
          </div>

          <div className="flex justify-between pt-1">
            <button onClick={() => onSelect(trade.ticker)}
              className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg">
              📊 Open Stock
            </button>
            <button onClick={() => onUnpin(trade.id)}
              className="text-xs text-red-600 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-950">
              🗑 Remove Trade
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PaperTradesPanel({ onSelectTicker, compact = false }: Props) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'All' | 'Open' | 'Closed'>('All')

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['pinned-trades'],
    queryFn:  fetchTrades,
    staleTime: 60 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: unpinTrade,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['pinned-trades'] }),
  })

  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => updateTradeNote(id, note),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['pinned-trades'] }),
  })

  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['pinned-trades'] })
    window.addEventListener('ta_trades_updated', handler)
    return () => window.removeEventListener('ta_trades_updated', handler)
  }, [queryClient])

  if (isLoading) return null

  const filtered = trades.filter(trade => {
    if (filter === 'All') return true
    const ageMs    = Date.now() - new Date(trade.pinnedAt).getTime()
    const expiryMs = (trade.type === 'BTST' ? 2 : 90) * 24 * 60 * 60 * 1000
    return filter === 'Open' ? ageMs <= expiryMs : ageMs > expiryMs
  })

  const openCount   = trades.filter(t => {
    const ageMs = Date.now() - new Date(t.pinnedAt).getTime()
    return ageMs <= (t.type === 'BTST' ? 2 : 90) * 86400000
  }).length
  const closedCount = trades.length - openCount

  // Homepage: show a clear, always-visible section even when empty
  if (compact) {
    return (
      <div className="w-full max-w-3xl space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-white">📊 Paper Trades / Monitoring</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {trades.length === 0
                ? 'No trades monitored yet — click "Monitor Trade" on any BTST or Recommendation signal'
                : `${trades.length} trade${trades.length !== 1 ? 's' : ''} · ${openCount} open · ${closedCount} closed`}
            </p>
          </div>
          {trades.length > 0 && (
            <div className="flex gap-1">
              {(['All', 'Open', 'Closed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    filter === f ? 'bg-brand-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {trades.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl px-4 py-6 text-center">
            <p className="text-2xl mb-2">📈</p>
            <p className="text-xs text-zinc-500">Load any stock → scroll to BTST or Recommendation → click <span className="text-brand-400 font-semibold">Monitor Trade</span></p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(trade => (
              <CompactRow
                key={trade.id}
                trade={trade}
                onUnpin={id => deleteMutation.mutate(id)}
                onSelect={onSelectTicker}
              />
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-3">No {filter.toLowerCase()} trades.</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Full panel (on stock page — not currently used but available)
  if (trades.length === 0) return null
  return (
    <div className="panel space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="panel-title">📊 Paper Trades / Monitoring</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {trades.length} trade{trades.length !== 1 ? 's' : ''} · {openCount} open · {closedCount} closed
          </p>
        </div>
        <div className="flex gap-1.5">
          {(['All', 'Open', 'Closed'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filter === f ? 'bg-brand-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {filtered.length === 0
          ? <p className="text-xs text-zinc-500 text-center py-4">No {filter.toLowerCase()} trades.</p>
          : filtered.map(trade => (
            <FullCard
              key={trade.id}
              trade={trade}
              onUnpin={id => deleteMutation.mutate(id)}
              onNoteChange={(id, note) => noteMutation.mutate({ id, note })}
              onSelect={onSelectTicker}
            />
          ))
        }
      </div>
    </div>
  )
}
