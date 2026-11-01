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
}

// ── Outcome badge config ─────────────────────────────────────────────────────
const OUTCOME_CFG: Record<TradeOutcome, { bg: string; text: string; icon: string }> = {
  'Target Hit':    { bg: 'bg-emerald-900 border-emerald-600', text: 'text-emerald-300', icon: '🎯' },
  'Stop Loss Hit': { bg: 'bg-red-900 border-red-600',         text: 'text-red-300',     icon: '🛑' },
  'Open':          { bg: 'bg-blue-900 border-blue-600',       text: 'text-blue-300',    icon: '⏳' },
  'Expired':       { bg: 'bg-zinc-700 border-zinc-600',       text: 'text-zinc-300',    icon: '⌛' },
}

// ── Single trade card ────────────────────────────────────────────────────────
function TradeCard({
  trade,
  onUnpin,
  onNoteChange,
  onSelectTicker,
}: {
  trade: PinnedTrade
  onUnpin:       (id: string) => void
  onNoteChange:  (id: string, note: string) => void
  onSelectTicker:(ticker: string) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal]         = useState(trade.note)
  const [expanded, setExpanded]       = useState(false)

  // Fetch daily OHLC for outcome evaluation
  const { data: chartData } = useQuery({
    queryKey: ['chart-outcome', trade.ticker],
    queryFn:  () => getChartData(trade.ticker, '1d'),
    staleTime: 15 * 60 * 1000,
  })

  // Evaluate outcome from OHLC history
  const evaluated: PinnedTrade = { ...trade }
  if (chartData?.candles) {
    const bars = chartData.candles.map((c: any) => ({
      date:  c.time ?? c.date,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }))
    Object.assign(evaluated, evaluateOutcome(trade, bars))
  }

  const outcome  = evaluated.outcome ?? 'Open'
  const cfg      = OUTCOME_CFG[outcome]
  const pnl      = evaluated.currentPnlPct ?? 0
  const pnlColor = pnl >= 0 ? 'text-emerald-400' : 'text-red-400'

  const riskPct   = ((trade.entryPrice - trade.stopLoss)   / trade.entryPrice * 100).toFixed(2)
  const rewardPct = ((trade.targetPrice - trade.entryPrice) / trade.entryPrice * 100).toFixed(2)

  const pinnedDateStr = new Date(trade.pinnedAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
  })

  const saveNote = () => {
    onNoteChange(trade.id, noteVal)
    setEditingNote(false)
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${cfg.bg}`}>
      {/* Collapsed header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{cfg.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="font-bold text-white font-mono text-sm hover:text-brand-400 transition-colors"
                onClick={e => { e.stopPropagation(); onSelectTicker(trade.ticker) }}
                title="Load stock"
              >
                {trade.ticker.replace('.NS', '').replace('.BO', '')}
              </button>
              <span className="text-xs text-zinc-400 truncate hidden sm:block">{trade.companyName}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                trade.type === 'BTST'
                  ? 'bg-purple-900 text-purple-300'
                  : 'bg-indigo-900 text-indigo-300'
              }`}>{trade.type}</span>
              <span className="text-xs text-zinc-500">{trade.verdict}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Pinned {pinnedDateStr} · Entry {SYM}{fmt(trade.entryPrice, 0)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className={`text-sm font-black ${pnlColor}`}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
            </p>
            {evaluated.currentPrice && (
              <p className="text-xs text-zinc-500">{SYM}{fmt(evaluated.currentPrice, 0)}</p>
            )}
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${cfg.text} ${cfg.bg}`}>
            {outcome}
          </span>
          <span className="text-zinc-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-700 px-4 py-4 space-y-4">
          {/* Price grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Entry',       val: trade.entryPrice,  color: 'text-white',         sub: null },
              { label: 'Target',      val: trade.targetPrice, color: 'text-emerald-400',   sub: `+${rewardPct}%` },
              { label: 'Stop Loss',   val: trade.stopLoss,    color: 'text-red-400',       sub: `-${riskPct}%` },
              { label: 'Risk:Reward', val: null,              color: trade.riskReward >= 2 ? 'text-emerald-400' : 'text-yellow-400',
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

          {/* Outcome row — closed trades */}
          {evaluated.outcome && evaluated.outcome !== 'Open' && (
            <div className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border ${cfg.bg}`}>
              <span className="text-xl">{cfg.icon}</span>
              <div>
                <p className={`font-bold text-sm ${cfg.text}`}>{evaluated.outcome}</p>
                <p className="text-xs text-zinc-400">
                  {evaluated.outcomeDate &&
                    `on ${new Date(evaluated.outcomeDate).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: '2-digit',
                    })}`}
                  {evaluated.daysToOutcome != null &&
                    ` · ${evaluated.daysToOutcome} day${evaluated.daysToOutcome !== 1 ? 's' : ''} to resolve`}
                  {evaluated.outcomePrice != null &&
                    ` · at ${SYM}${fmt(evaluated.outcomePrice, 0)}`}
                </p>
              </div>
              <p className={`ml-auto text-lg font-black ${pnlColor}`}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
              </p>
            </div>
          )}

          {/* Live status — open trades */}
          {evaluated.outcome === 'Open' && evaluated.currentPrice != null && (
            <div className="grid grid-cols-4 gap-3 bg-zinc-900 rounded-lg px-4 py-3">
              {[
                { label: 'Current Price', val: `${SYM}${fmt(evaluated.currentPrice, 0)}` },
                { label: 'P&L',           val: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`, color: pnlColor },
                { label: 'Days Active',   val: `${evaluated.daysToOutcome ?? 0}d` },
                { label: 'Confidence',    val: `${trade.confidence.toFixed(0)}%` },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-zinc-500 mb-0.5">{item.label}</p>
                  <p className={`text-sm font-bold ${(item as any).color ?? 'text-white'}`}>{item.val}</p>
                </div>
              ))}
            </div>
          )}

          {/* Note */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-zinc-500 uppercase font-semibold tracking-wide">📝 Note</p>
              {!editingNote && (
                <button
                  onClick={() => setEditingNote(true)}
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {noteVal ? 'Edit' : '+ Add note'}
                </button>
              )}
            </div>
            {editingNote ? (
              <div className="space-y-2">
                <textarea
                  className="w-full bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-brand-500"
                  rows={3}
                  value={noteVal}
                  onChange={e => setNoteVal(e.target.value)}
                  placeholder="Why did you pin this trade? Any thesis or context..."
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveNote}
                    className="text-xs bg-brand-700 hover:bg-brand-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >Save</button>
                  <button
                    onClick={() => { setNoteVal(trade.note); setEditingNote(false) }}
                    className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-400 italic">
                {noteVal || (
                  <span className="text-zinc-600">
                    No note yet. Click "Add note" to record your thesis.
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => onSelectTicker(trade.ticker)}
              className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              📊 Load Stock
            </button>
            <button
              onClick={() => onUnpin(trade.id)}
              className="text-xs text-red-500 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-950"
            >
              🗑 Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function PinnedTradesPanel({ onSelectTicker }: Props) {
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
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      updateTradeNote(id, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pinned-trades'] }),
  })

  // Re-fetch when a pin/unpin fires from another panel
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey: ['pinned-trades'] })
    window.addEventListener('ta_trades_updated', handler)
    return () => window.removeEventListener('ta_trades_updated', handler)
  }, [queryClient])

  if (isLoading) return null
  if (trades.length === 0) return null

  const filteredTrades = trades.filter(trade => {
    if (filter === 'All') return true
    const ageMs    = Date.now() - new Date(trade.pinnedAt).getTime()
    const expiryMs = (trade.type === 'BTST' ? 2 : 90) * 24 * 60 * 60 * 1000
    return filter === 'Open' ? ageMs <= expiryMs : ageMs > expiryMs
  })

  const btst = trades.filter(t => t.type === 'BTST').length
  const rec  = trades.filter(t => t.type === 'Recommendation').length

  return (
    <div className="panel space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="panel-title">📌 Pinned Trades</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {trades.length} trade{trades.length !== 1 ? 's' : ''} tracked
            {btst > 0 && ` · ${btst} BTST`}
            {rec  > 0 && ` · ${rec} Recommendation`}
          </p>
        </div>
        <div className="flex gap-1.5">
          {(['All', 'Open', 'Closed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors font-medium ${
                filter === f
                  ? 'bg-brand-700 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Trade list */}
      <div className="space-y-2">
        {filteredTrades.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-4">
            No {filter.toLowerCase()} trades.
          </p>
        ) : (
          filteredTrades.map(trade => (
            <TradeCard
              key={trade.id}
              trade={trade}
              onUnpin={id => deleteMutation.mutate(id)}
              onNoteChange={(id, note) => noteMutation.mutate({ id, note })}
              onSelectTicker={onSelectTicker}
            />
          ))
        )}
      </div>

      <p className="text-xs text-zinc-700 text-center">
        Trades stored in backend SQLite DB · outcome evaluated from daily OHLC
      </p>
    </div>
  )
}
