from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, field_validator


class SearchSuggestion(BaseModel):
    ticker: str
    name: str
    exchange: str


class QuoteResponse(BaseModel):
    ticker: str
    name: str
    exchange: str
    currency: str
    current_price: float
    change: float
    change_pct: float
    volume: int
    avg_volume: int
    market_status: str


class FundamentalsResponse(BaseModel):
    ticker: str
    pe_ratio: float | None
    eps: float | None
    market_cap: int | None
    dividend_yield: float | None
    price_to_book: float | None
    debt_to_equity: float | None
    roe: float | None
    beta: float | None
    week_52_high: float | None
    week_52_low: float | None
    sector: str | None
    industry: str | None
    description: str | None


class FinancialPeriod(BaseModel):
    period: str
    revenue: float
    net_income: float
    gross_profit: float


class FinancialsResponse(BaseModel):
    ticker: str
    annual: list[FinancialPeriod]
    quarterly: list[FinancialPeriod]


class PriceLevel(BaseModel):
    price: float
    strength: Literal["strong", "moderate", "weak"]
    type: Literal["support", "resistance"]


class TechnicalResponse(BaseModel):
    ticker: str
    current_price: float
    price_history: list[dict]   # includes ma20, ma50, ma200 + bb_upper/lower + supertrend
    support_levels: list[PriceLevel]
    resistance_levels: list[PriceLevel]
    ma20: float | None
    ma50: float | None
    ma200: float | None
    ma_trend: Literal["bullish", "bearish", "neutral"]
    rsi: float
    rsi_signal: str
    # ── New indicators ──
    macd: float | None
    macd_signal: float | None
    macd_hist: float | None
    bb_upper: float | None
    bb_middle: float | None
    bb_lower: float | None
    bb_width: float | None          # (upper-lower)/middle * 100
    supertrend: float | None
    supertrend_signal: Literal["bullish", "bearish"] | None
    atr: float | None
    # Fibonacci levels (from 52W high/low swing)
    fib_levels: dict               # {"0": price, "0.236": price, ...}
    # Z-score of price vs 20d mean
    zscore: float | None
    # Composite confidence score 0-100
    confidence_score: float
    confidence_label: str


class TrendSignal(BaseModel):
    indicator: str
    value: float | str
    signal: Literal["bullish", "bearish", "neutral"]
    timeframe: Literal["short", "long"]


class TrendResponse(BaseModel):
    ticker: str
    short_term_bias: Literal["bullish", "bearish", "neutral"]
    long_term_bias: Literal["bullish", "bearish", "neutral"]
    signals: list[TrendSignal]
    price_history: list[dict]


class SimilarStock(BaseModel):
    ticker: str
    name: str
    sector: str
    market_cap: int
    pe_ratio: float | None
    price_change_1y: float | None
    similarity_score: float

    @field_validator("similarity_score")
    @classmethod
    def clamp_score(cls, v: float) -> float:
        return max(0.0, min(1.0, v))


class ScreenerResponse(BaseModel):
    ticker: str
    similar: list[SimilarStock]


class SWOTInsights(BaseModel):
    strengths: list[str]
    weaknesses: list[str]
    opportunities: list[str]
    threats: list[str]
    summary: str
    generated_at: str


class InsightsResponse(BaseModel):
    ticker: str
    insights: SWOTInsights


# ── NEW MODELS ─────────────────────────────────────────────────────────────

class ValuationResponse(BaseModel):
    ticker: str
    sector: str | None
    pe_ratio: float | None
    pb_ratio: float | None
    eps: float | None
    forward_pe: float | None
    peg_ratio: float | None
    ev_to_ebitda: float | None
    sector_pe: float | None
    sector_pb: float | None
    dcf_fair_value: float | None
    margin_of_safety_pct: float | None
    verdict: Literal["Undervalued", "Fairly Valued", "Overvalued", "Insufficient Data"]
    verdict_reason: str
    # ── Order-book proxy ──
    bid_ask_spread_pct: float | None   # (ask-bid)/mid * 100 — proxy liquidity
    volume_vs_avg: float | None        # current vol / 3m avg vol
    day_range_position: float | None   # 0=at low, 1=at high (order pressure proxy)
    week52_range_position: float | None
    short_ratio: float | None          # days-to-cover (short interest)
    shares_short_pct: float | None     # % of float shorted


class CashFlowPeriod(BaseModel):
    period: str
    operating_cash_flow: float
    free_cash_flow: float
    net_income: float
    capex: float


class CashFlowMetrics(BaseModel):
    roe: float | None           # Return on Equity
    roi: float | None           # Return on Investment (ROIC)
    net_profit_margin: float | None
    operating_margin: float | None
    gross_margin: float | None
    debt_to_equity: float | None
    current_ratio: float | None
    interest_coverage: float | None


class CashFlowResponse(BaseModel):
    ticker: str
    annual: list[CashFlowPeriod]
    quarterly: list[CashFlowPeriod]
    metrics: CashFlowMetrics


class ChartPattern(BaseModel):
    name: str
    detected: bool
    description: str
    implication: Literal["bullish", "bearish", "neutral"]


class MASignal(BaseModel):
    label: str           # e.g. "Price vs MA20", "MA20 x MA50"
    value: str
    signal: Literal["bullish", "bearish", "neutral"]


class RecommendationResponse(BaseModel):
    ticker: str
    recommendation: Literal["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]
    confidence_pct: float          # 0-100
    composite_score: float         # -100 (very bearish) to +100 (very bullish)
    # Individual component scores
    trend_score: float
    momentum_score: float
    volume_score: float
    pattern_score: float
    # Details
    ma_signals: list[MASignal]
    patterns: list[ChartPattern]
    rsi: float
    rsi_signal: str
    macd_signal: str
    volume_vs_avg: float           # current vol / avg vol ratio
    summary: str
    price_history: list[dict]      # {date, close, ma20, ma50, ma200, volume}


# ── HOLDINGS ───────────────────────────────────────────────────────────────

class HolderEntry(BaseModel):
    name: str
    pct_held: float | None       # percentage of shares held
    shares: int | None
    value: float | None          # market value in INR

class HoldingsResponse(BaseModel):
    ticker: str
    # Major holders breakdown
    pct_institutional: float | None   # % held by institutions
    pct_insider: float | None         # % held by insiders
    pct_retail: float | None          # derived: 100 - inst - insider
    # Top institutional holders
    top_institutions: list[HolderEntry]
    # Top mutual fund holders
    top_mutual_funds: list[HolderEntry]
    # Change signals derived from holder data
    inst_trend: str    # "increasing" | "decreasing" | "stable" | "unknown"
    holding_summary: str


# ── BTST ───────────────────────────────────────────────────────────────────

class BTSTSignal(BaseModel):
    factor: str
    value: str
    score: float          # -1 (bearish) to +1 (bullish)
    weight: float         # contribution weight
    note: str

class BTSTResponse(BaseModel):
    ticker: str
    verdict: Literal["Strong BTST", "BTST Possible", "Avoid", "Strong Avoid"]
    confidence_pct: float             # 0-100
    composite_score: float            # -100 to +100
    entry_price: float                # current / suggested entry
    target_price: float               # next-day target
    stop_loss: float                  # hard stop
    risk_reward: float                # reward / risk ratio
    expected_gap_pct: float | None    # historical overnight gap tendency
    signals: list[BTSTSignal]
    summary: str
    price_history_5d: list[dict]      # {date, open, high, low, close, volume}
    generated_at: str
