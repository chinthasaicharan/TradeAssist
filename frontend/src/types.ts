export interface SearchSuggestion {
  ticker: string
  name: string
  exchange: string
}

export interface QuoteResponse {
  ticker: string
  name: string
  exchange: string
  currency: string
  current_price: number
  change: number
  change_pct: number
  volume: number
  avg_volume: number
  market_status: string
}

export interface FundamentalsResponse {
  ticker: string
  pe_ratio: number | null
  eps: number | null
  market_cap: number | null
  dividend_yield: number | null
  price_to_book: number | null
  debt_to_equity: number | null
  roe: number | null
  beta: number | null
  week_52_high: number | null
  week_52_low: number | null
  sector: string | null
  industry: string | null
  description: string | null
}

export interface FinancialPeriod {
  period: string
  revenue: number
  net_income: number
  gross_profit: number
}

export interface FinancialsResponse {
  ticker: string
  annual: FinancialPeriod[]
  quarterly: FinancialPeriod[]
}

export interface PriceLevel {
  price: number
  strength: 'strong' | 'moderate' | 'weak'
  type: 'support' | 'resistance'
}

export interface TechnicalResponse {
  ticker: string
  current_price: number
  price_history: {
    date: string; open: number; high: number; low: number; close: number; volume: number
    ma20: number | null; ma50: number | null; ma200: number | null
    bb_upper: number | null; bb_lower: number | null; bb_mid: number | null
    supertrend: number | null; st_bull: boolean
    macd: number; macd_signal: number | null; macd_hist: number | null
    rsi: number | null; atr: number | null
  }[]
  support_levels: PriceLevel[]
  resistance_levels: PriceLevel[]
  ma20: number | null
  ma50: number | null
  ma200: number | null
  ma_trend: 'bullish' | 'bearish' | 'neutral'
  rsi: number
  rsi_signal: string
  macd: number | null
  macd_signal: number | null
  macd_hist: number | null
  bb_upper: number | null
  bb_middle: number | null
  bb_lower: number | null
  bb_width: number | null
  supertrend: number | null
  supertrend_signal: 'bullish' | 'bearish' | null
  atr: number | null
  fib_levels: Record<string, number>
  zscore: number | null
  confidence_score: number
  confidence_label: string
}

export interface TrendSignal {
  indicator: string
  value: number | string
  signal: 'bullish' | 'bearish' | 'neutral'
  timeframe: 'short' | 'long'
}

export interface TrendResponse {
  ticker: string
  short_term_bias: 'bullish' | 'bearish' | 'neutral'
  long_term_bias: 'bullish' | 'bearish' | 'neutral'
  signals: TrendSignal[]
  price_history: { date: string; close: number; sma_20: number | null; sma_50: number | null; sma_200: number | null }[]
}

export interface SimilarStock {
  ticker: string
  name: string
  sector: string
  market_cap: number
  pe_ratio: number | null
  price_change_1y: number | null
  similarity_score: number
}

export interface ScreenerResponse {
  ticker: string
  similar: SimilarStock[]
}

export interface SWOTInsights {
  strengths: string[]
  weaknesses: string[]
  opportunities: string[]
  threats: string[]
  summary: string
  generated_at: string
}

export interface InsightsResponse {
  ticker: string
  insights: SWOTInsights
}

export interface ValuationResponse {
  ticker: string
  sector: string | null
  pe_ratio: number | null
  pb_ratio: number | null
  eps: number | null
  forward_pe: number | null
  peg_ratio: number | null
  ev_to_ebitda: number | null
  sector_pe: number | null
  sector_pb: number | null
  dcf_fair_value: number | null
  margin_of_safety_pct: number | null
  verdict: 'Undervalued' | 'Fairly Valued' | 'Overvalued' | 'Insufficient Data'
  verdict_reason: string
  bid_ask_spread_pct: number | null
  volume_vs_avg: number | null
  day_range_position: number | null
  week52_range_position: number | null
  short_ratio: number | null
  shares_short_pct: number | null
}

export interface CashFlowPeriod {
  period: string
  operating_cash_flow: number
  free_cash_flow: number
  net_income: number
  capex: number
}

export interface CashFlowMetrics {
  roe: number | null
  roi: number | null
  net_profit_margin: number | null
  operating_margin: number | null
  gross_margin: number | null
  debt_to_equity: number | null
  current_ratio: number | null
  interest_coverage: number | null
}

export interface CashFlowResponse {
  ticker: string
  annual: CashFlowPeriod[]
  quarterly: CashFlowPeriod[]
  metrics: CashFlowMetrics
}

export interface MASignal {
  label: string
  value: string
  signal: 'bullish' | 'bearish' | 'neutral'
}

export interface ChartPattern {
  name: string
  detected: boolean
  description: string
  implication: 'bullish' | 'bearish' | 'neutral'
}

export interface RecommendationResponse {
  ticker: string
  recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  confidence_pct: number
  composite_score: number
  trend_score: number
  momentum_score: number
  volume_score: number
  pattern_score: number
  ma_signals: MASignal[]
  patterns: ChartPattern[]
  rsi: number
  rsi_signal: string
  macd_signal: string
  volume_vs_avg: number
  summary: string
  price_history: { date: string; close: number; volume: number; ma20: number | null; ma50: number | null; ma200: number | null }[]
}

export interface HolderEntry {
  name: string
  pct_held: number | null
  shares: number | null
  value: number | null
}

export interface HoldingsResponse {
  ticker: string
  pct_institutional: number | null
  pct_insider: number | null
  pct_retail: number | null
  top_institutions: HolderEntry[]
  top_mutual_funds: HolderEntry[]
  inst_trend: string
  holding_summary: string
}

export interface BTSTSignal {
  factor: string
  value: string
  score: number
  weight: number
  note: string
}

export interface BTSTResponse {
  ticker: string
  verdict: 'Strong BTST' | 'BTST Possible' | 'Avoid' | 'Strong Avoid'
  confidence_pct: number
  composite_score: number
  entry_price: number
  target_price: number
  stop_loss: number
  risk_reward: number
  expected_gap_pct: number | null
  signals: BTSTSignal[]
  summary: string
  price_history_5d: { date: string; open: number; high: number; low: number; close: number; volume: number }[]
  generated_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  question: string
  messages: ChatMessage[]
}

export interface ChatResponse {
  answer: string
  ticker: string
  generated_at: string
}
