/**
 * Trade Tracker — API-backed pinned trade management.
 * All persistence is in the backend SQLite DB via /api/trades.
 * Outcome evaluation still runs client-side from chart OHLC data.
 */

import { api } from './api'

export type TradeType    = 'BTST' | 'Recommendation'
export type TradeOutcome = 'Target Hit' | 'Stop Loss Hit' | 'Open' | 'Expired'

export interface PinnedTrade {
  id:          string
  ticker:      string
  companyName: string
  type:        TradeType
  verdict:     string
  entryPrice:  number
  targetPrice: number
  stopLoss:    number
  riskReward:  number
  confidence:  number
  pinnedAt:    string   // ISO string
  note:        string
  // Computed client-side — never sent to / stored in the DB
  outcome?:        TradeOutcome
  outcomePrice?:   number
  outcomeDate?:    string
  daysToOutcome?:  number
  currentPnlPct?:  number
  currentPrice?:   number
}

// ── API response shape (snake_case from Python) ──────────────────────────────
interface TradeAPI {
  id:           string
  ticker:       string
  company_name: string
  trade_type:   TradeType
  verdict:      string
  entry_price:  number
  target_price: number
  stop_loss:    number
  risk_reward:  number
  confidence:   number
  pinned_at:    string
  note:         string
}

function fromAPI(t: TradeAPI): PinnedTrade {
  return {
    id:          t.id,
    ticker:      t.ticker,
    companyName: t.company_name,
    type:        t.trade_type,
    verdict:     t.verdict,
    entryPrice:  t.entry_price,
    targetPrice: t.target_price,
    stopLoss:    t.stop_loss,
    riskReward:  t.risk_reward,
    confidence:  t.confidence,
    pinnedAt:    t.pinned_at,
    note:        t.note,
  }
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function fetchTrades(): Promise<PinnedTrade[]> {
  const res = await api.get<TradeAPI[]>('/trades')
  return res.data.map(fromAPI)
}

export async function pinTrade(
  trade: Omit<PinnedTrade, 'id' | 'pinnedAt' | 'note'>
): Promise<PinnedTrade> {
  const res = await api.post<TradeAPI>('/trades', {
    ticker:       trade.ticker,
    company_name: trade.companyName,
    trade_type:   trade.type,
    verdict:      trade.verdict,
    entry_price:  trade.entryPrice,
    target_price: trade.targetPrice,
    stop_loss:    trade.stopLoss,
    risk_reward:  trade.riskReward,
    confidence:   trade.confidence,
  })
  return fromAPI(res.data)
}

export async function unpinTrade(id: string): Promise<void> {
  await api.delete(`/trades/${id}`)
}

export async function updateTradeNote(id: string, note: string): Promise<PinnedTrade> {
  const res = await api.patch<TradeAPI>(`/trades/${id}/note`, { note })
  return fromAPI(res.data)
}

export async function isAlreadyPinned(
  ticker: string,
  type: TradeType
): Promise<{ pinned: boolean; id: string | null }> {
  const res = await api.get<{ pinned: boolean; id: string | null }>(
    `/trades/check/${ticker}/${type}`
  )
  return res.data
}

// ── Outcome evaluation (pure client-side, no DB) ─────────────────────────────

const EXPIRY_DAYS: Record<TradeType, number> = { BTST: 2, Recommendation: 90 }

export interface OHLCBar {
  date:  string
  high:  number
  low:   number
  close: number
}

export function evaluateOutcome(
  trade: PinnedTrade,
  history: OHLCBar[]
): Partial<PinnedTrade> {
  if (!history.length) return {}

  const pinnedDate = new Date(trade.pinnedAt)
  const barsAfterPin = history.filter(b => new Date(b.date) > pinnedDate)

  const latestClose = barsAfterPin.length > 0
    ? barsAfterPin[barsAfterPin.length - 1].close
    : history[history.length - 1].close

  const currentPnlPct = ((latestClose - trade.entryPrice) / trade.entryPrice) * 100

  for (const bar of barsAfterPin) {
    const barDate    = new Date(bar.date)
    const daysElapsed = Math.round(
      (barDate.getTime() - pinnedDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    // Stop loss check first (low touched SL)
    if (bar.low <= trade.stopLoss) {
      return {
        outcome:        'Stop Loss Hit',
        outcomePrice:   trade.stopLoss,
        outcomeDate:    bar.date,
        daysToOutcome:  daysElapsed,
        currentPnlPct:  ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100,
        currentPrice:   latestClose,
      }
    }

    // Target hit (high touched target)
    if (bar.high >= trade.targetPrice) {
      return {
        outcome:        'Target Hit',
        outcomePrice:   trade.targetPrice,
        outcomeDate:    bar.date,
        daysToOutcome:  daysElapsed,
        currentPnlPct:  ((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100,
        currentPrice:   latestClose,
      }
    }

    // BTST: expired after 2 trading days
    if (trade.type === 'BTST' && daysElapsed >= EXPIRY_DAYS.BTST) {
      return {
        outcome:        'Expired',
        outcomePrice:   bar.close,
        outcomeDate:    bar.date,
        daysToOutcome:  daysElapsed,
        currentPnlPct:  ((bar.close - trade.entryPrice) / trade.entryPrice) * 100,
        currentPrice:   latestClose,
      }
    }
  }

  // Still open — check if Recommendation expired by calendar days
  const daysSincePin = Math.round(
    (Date.now() - pinnedDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (daysSincePin >= EXPIRY_DAYS[trade.type]) {
    return {
      outcome:        'Expired',
      outcomePrice:   latestClose,
      outcomeDate:    new Date().toISOString().slice(0, 10),
      daysToOutcome:  daysSincePin,
      currentPnlPct,
      currentPrice:   latestClose,
    }
  }

  return {
    outcome:       'Open',
    currentPnlPct,
    currentPrice:  latestClose,
    daysToOutcome: daysSincePin,
  }
}
