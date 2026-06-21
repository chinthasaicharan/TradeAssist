import re
import asyncio
from datetime import datetime, timezone as _tz
from typing import Any
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from models import (
    QuoteResponse, FundamentalsResponse, FinancialsResponse, FinancialPeriod,
    TechnicalResponse, PriceLevel, TrendResponse, TrendSignal,
    ScreenerResponse, SimilarStock,
    ValuationResponse, CashFlowResponse, CashFlowPeriod, CashFlowMetrics,
    RecommendationResponse, MASignal, ChartPattern,
    HoldingsResponse, HolderEntry,
    BTSTResponse, BTSTSignal,
)
import cache
import yf_client as yfc

router = APIRouter()

TICKER_RE = re.compile(r"^[A-Z0-9&.\-]{1,20}$")

# Indian sector peer map — NSE tickers (kept to 8 peers max to stay within rate limits)
SECTOR_PEERS: dict[str, list[str]] = {
    "Technology": [
        "TCS", "INFY.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS",
        "LTIM.NS", "MPHASIS.NS", "PERSISTENT.NS",
    ],
    "Financial Services": [
        "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS",
        "AXISBANK.NS", "INDUSINDBK.NS", "FEDERALBNK.NS", "BANDHANBNK.NS",
    ],
    "Consumer Cyclical": [
        "MARUTI.NS", "TATAMOTORS.NS", "M&M.NS", "BAJAJ-AUTO.NS",
        "HEROMOTOCO.NS", "EICHERMOT.NS", "TITAN.NS", "TRENT.NS",
    ],
    "Consumer Defensive": [
        "HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "DABUR.NS",
        "MARICO.NS", "GODREJCP.NS", "COLPAL.NS", "TATACONSUM.NS",
    ],
    "Energy": [
        "RELIANCE.NS", "ONGC.NS", "BPCL.NS", "IOC.NS",
        "COALINDIA.NS", "TATAPOWER.NS", "NTPC.NS", "POWERGRID.NS",
    ],
    "Healthcare": [
        "SUNPHARMA.NS", "DRREDDY.NS", "CIPLA.NS", "DIVISLAB.NS",
        "LUPIN.NS", "AUROPHARMA.NS", "TORNTPHARM.NS", "ALKEM.NS",
    ],
    "Industrials": [
        "LT.NS", "ABB.NS", "SIEMENS.NS", "HAL.NS",
        "BEL.NS", "HAVELLS.NS", "POLYCAB.NS", "BHARATFORG.NS",
    ],
    "Basic Materials": [
        "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS",
        "ULTRACEMCO.NS", "ACC.NS", "AMBUJACEM.NS", "PIDILITIND.NS", "SRF.NS",
    ],
    "Real Estate": [
        "DLF.NS", "GODREJPROP.NS", "PRESTIGE.NS", "OBEROIRLTY.NS", "LODHA.NS",
    ],
    "Communication Services": [
        "BHARTIARTL.NS", "ZOMATO.NS", "NYKAA.NS", "ZEEL.NS", "POLICYBZR.NS",
    ],
    "Utilities": [
        "NTPC.NS", "POWERGRID.NS", "TATAPOWER.NS", "NHPC.NS", "TORNTPOWER.NS",
    ],
}


def validate_ticker(ticker: str) -> str:
    t = ticker.upper().strip()
    if not TICKER_RE.match(t):
        raise HTTPException(status_code=422, detail="Invalid ticker format")
    return t


def safe_float(val: Any) -> float | None:
    try:
        v = float(val)
        return v if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def safe_int(val: Any) -> int | None:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


# ── QUOTE ──────────────────────────────────────────────────────────────────

@router.get("/api/quote/{ticker}", response_model=QuoteResponse)
async def get_quote(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"quote:{ticker}")
    if cached:
        return cached

    info = await yfc.fetch_info(ticker)
    if not info or (not info.get("regularMarketPrice") and not info.get("currentPrice")):
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found. Make sure to use NSE format e.g. RELIANCE.NS")

    price = info.get("currentPrice") or info.get("regularMarketPrice") or 0.0
    result = QuoteResponse(
        ticker=ticker,
        name=info.get("longName") or info.get("shortName") or ticker,
        exchange=info.get("exchange") or info.get("fullExchangeName") or "NSE",
        currency=info.get("currency", "INR"),
        current_price=safe_float(price) or 0.0,
        change=safe_float(info.get("regularMarketChange")) or 0.0,
        change_pct=safe_float(info.get("regularMarketChangePercent")) or 0.0,
        volume=safe_int(info.get("regularMarketVolume") or info.get("volume")) or 0,
        avg_volume=safe_int(info.get("averageVolume")) or 0,
        market_status=(
            "open" if info.get("marketState") == "REGULAR"
            else (info.get("marketState") or "closed").lower()
        ),
    )
    cache.set(f"quote:{ticker}", result, ttl=60)
    return result


# ── FUNDAMENTALS ───────────────────────────────────────────────────────────

@router.get("/api/fundamentals/{ticker}", response_model=FundamentalsResponse)
async def get_fundamentals(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"fundamentals:{ticker}")
    if cached:
        return cached

    info = await yfc.fetch_info(ticker)
    if not info:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")

    result = FundamentalsResponse(
        ticker=ticker,
        pe_ratio=safe_float(info.get("trailingPE") or info.get("forwardPE")),
        eps=safe_float(info.get("trailingEps")),
        market_cap=safe_int(info.get("marketCap")),
        dividend_yield=safe_float(info.get("dividendYield")),
        price_to_book=safe_float(info.get("priceToBook")),
        debt_to_equity=safe_float(info.get("debtToEquity")),
        roe=safe_float(info.get("returnOnEquity")),
        beta=safe_float(info.get("beta")),
        week_52_high=safe_float(info.get("fiftyTwoWeekHigh")),
        week_52_low=safe_float(info.get("fiftyTwoWeekLow")),
        sector=info.get("sector"),
        industry=info.get("industry"),
        description=info.get("longBusinessSummary"),
    )
    cache.set(f"fundamentals:{ticker}", result, ttl=86400)
    return result


# ── FINANCIALS ─────────────────────────────────────────────────────────────

@router.get("/api/financials/{ticker}", response_model=FinancialsResponse)
async def get_financials(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"financials:{ticker}")
    if cached:
        return cached

    annual_is, quarterly_is = await yfc.fetch_financials(ticker)

    def parse_is(df: pd.DataFrame, quarterly: bool) -> list[FinancialPeriod]:
        if df is None or df.empty:
            return []
        periods = []
        for col in df.columns[:8]:
            try:
                dt = pd.Timestamp(col)
                label = (
                    f"Q{((dt.month - 1) // 3) + 1} {dt.year}"
                    if quarterly else f"FY {dt.year}"
                )
                revenue     = safe_float(df.loc["Total Revenue", col])  if "Total Revenue"  in df.index else None
                net_income  = safe_float(df.loc["Net Income", col])      if "Net Income"      in df.index else None
                gross_profit= safe_float(df.loc["Gross Profit", col])    if "Gross Profit"    in df.index else None
                periods.append(FinancialPeriod(
                    period=label,
                    revenue=revenue or 0.0,
                    net_income=net_income or 0.0,
                    gross_profit=gross_profit or 0.0,
                ))
            except Exception:
                continue
        return list(reversed(periods))

    result = FinancialsResponse(
        ticker=ticker,
        annual=parse_is(annual_is, quarterly=False),
        quarterly=parse_is(quarterly_is, quarterly=True),
    )
    cache.set(f"financials:{ticker}", result, ttl=86400)
    return result


# ── TECHNICAL (Support & Resistance) ──────────────────────────────────────

def compute_support_resistance(
    closes: list[float], window: int = 10
) -> tuple[list[PriceLevel], list[PriceLevel]]:
    if len(closes) < window * 2 + 1:
        return [], []

    support_prices: list[float] = []
    resistance_prices: list[float] = []

    for i in range(window, len(closes) - window):
        segment = closes[i - window: i + window + 1]
        lo, hi = min(segment), max(segment)
        if closes[i] == lo:
            support_prices.append(closes[i])
        if closes[i] == hi:
            resistance_prices.append(closes[i])

    def cluster(prices: list[float], lvl_type: str) -> list[PriceLevel]:
        if not prices:
            return []
        ps = sorted(prices)
        clusters: list[list[float]] = []
        cur = [ps[0]]
        for p in ps[1:]:
            if abs(p - cur[-1]) / max(cur[-1], 1e-9) < 0.015:
                cur.append(p)
            else:
                clusters.append(cur); cur = [p]
        clusters.append(cur)
        levels = []
        for c in clusters:
            avg = sum(c) / len(c)
            t = len(c)
            strength = "strong" if t >= 4 else "moderate" if t >= 2 else "weak"
            levels.append(PriceLevel(price=round(avg, 2), strength=strength, type=lvl_type))
        return sorted(levels, key=lambda l: l.price)

    return cluster(support_prices, "support")[-5:], cluster(resistance_prices, "resistance")[-5:]


@router.get("/api/technical/{ticker}", response_model=TechnicalResponse)
async def get_technical(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"technical:{ticker}")
    if cached:
        return cached

    hist = await yfc.fetch_history(ticker, period="1y", interval="1d")
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No price data for {ticker}")

    info = await yfc.fetch_info(ticker)

    closes  = hist["Close"].tolist()
    volumes = hist["Volume"].tolist()

    # Compute MAs
    ma20_l  = compute_sma(closes, 20)
    ma50_l  = compute_sma(closes, 50)
    ma200_l = compute_sma(closes, 200)
    rsi_val = compute_rsi(closes)

    price_history = [
        {
            "date":   str(idx.date()),
            "close":  round(float(row["Close"]), 2),
            "volume": int(row["Volume"]),
            "ma20":   ma20_l[i],
            "ma50":   ma50_l[i],
            "ma200":  ma200_l[i],
        }
        for i, (idx, row) in enumerate(hist.iterrows())
    ]

    supports, resistances = compute_support_resistance(closes)
    current_price = safe_float(info.get("currentPrice") or info.get("regularMarketPrice")) or closes[-1]

    ma20  = next((v for v in reversed(ma20_l)  if v is not None), None)
    ma50  = next((v for v in reversed(ma50_l)  if v is not None), None)
    ma200 = next((v for v in reversed(ma200_l) if v is not None), None)

    # MA trend: bullish if price > ma20 > ma50, or price > ma200 at minimum
    above_count = sum(1 for ma in [ma20, ma50, ma200] if ma and current_price > ma)
    ma_trend = "bullish" if above_count >= 2 else "bearish" if above_count == 0 else "neutral"

    rsi_signal = (
        "Oversold"       if rsi_val < 30 else
        "Near Oversold"  if rsi_val < 40 else
        "Neutral"        if rsi_val < 60 else
        "Near Overbought" if rsi_val < 70 else
        "Overbought"
    )

    result = TechnicalResponse(
        ticker=ticker,
        current_price=current_price,
        price_history=price_history,
        support_levels=supports,
        resistance_levels=resistances,
        ma20=ma20,
        ma50=ma50,
        ma200=ma200,
        ma_trend=ma_trend,
        rsi=rsi_val,
        rsi_signal=rsi_signal,
    )
    cache.set(f"technical:{ticker}", result, ttl=3600)
    return result


# ── TREND ──────────────────────────────────────────────────────────────────

def compute_sma(series: list[float], window: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(series)):
        if i < window - 1:
            out.append(None)
        else:
            out.append(round(sum(series[i - window + 1: i + 1]) / window, 2))
    return out


def compute_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains  = [d if d > 0 else 0.0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0.0 for d in deltas[-period:]]
    ag, al = sum(gains) / period, sum(losses) / period
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 2)


def compute_macd(closes: list[float]) -> tuple[float, float]:
    def ema(data: list[float], span: int) -> list[float]:
        k = 2 / (span + 1)
        v = [data[0]]
        for x in data[1:]:
            v.append(x * k + v[-1] * (1 - k))
        return v

    if len(closes) < 26:
        return 0.0, 0.0
    e12 = ema(closes, 12)
    e26 = ema(closes, 26)
    macd_line = [a - b for a, b in zip(e12, e26)]
    signal    = ema(macd_line[25:], 9)
    return round(macd_line[-1], 4), round(signal[-1], 4)


@router.get("/api/trend/{ticker}", response_model=TrendResponse)
async def get_trend(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"trend:{ticker}")
    if cached:
        return cached

    hist = await yfc.fetch_history(ticker, period="2y", interval="1d")
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No price data for {ticker}")

    closes = hist["Close"].tolist()
    sma20  = compute_sma(closes, 20)
    sma50  = compute_sma(closes, 50)
    sma200 = compute_sma(closes, 200)
    rsi    = compute_rsi(closes)
    macd_val, macd_sig = compute_macd(closes)

    price_history = [
        {
            "date": str(idx.date()),
            "close": round(float(row["Close"]), 2),
            "sma_20": sma20[i],
            "sma_50": sma50[i],
            "sma_200": sma200[i],
        }
        for i, (idx, row) in enumerate(hist.iterrows())
    ]

    signals: list[TrendSignal] = []

    rsi_sig = "bullish" if rsi < 40 else "bearish" if rsi > 70 else "neutral"
    signals.append(TrendSignal(indicator="RSI (14)", value=rsi, signal=rsi_sig, timeframe="short"))

    macd_cross = "bullish" if macd_val > macd_sig else "bearish" if macd_val < macd_sig else "neutral"
    signals.append(TrendSignal(indicator="MACD", value=round(macd_val, 2), signal=macd_cross, timeframe="short"))

    cur_sma50  = next((v for v in reversed(sma50)  if v is not None), None)
    cur_sma200 = next((v for v in reversed(sma200) if v is not None), None)
    cur_sma20  = next((v for v in reversed(sma20)  if v is not None), None)
    if cur_sma50 and cur_sma200:
        sma_sig = "bullish" if cur_sma50 > cur_sma200 else "bearish"
        signals.append(TrendSignal(
            indicator="SMA 50/200 Cross",
            value=f"SMA50={cur_sma50:.2f} SMA200={cur_sma200:.2f}",
            signal=sma_sig, timeframe="long",
        ))

    cp = closes[-1]
    if cur_sma50:
        signals.append(TrendSignal(
            indicator="Price vs SMA50", value=round(cp, 2),
            signal="bullish" if cp > cur_sma50 else "bearish", timeframe="short",
        ))
    if cur_sma20:
        signals.append(TrendSignal(
            indicator="Price vs SMA20", value=round(cp, 2),
            signal="bullish" if cp > cur_sma20 else "bearish", timeframe="short",
        ))

    if len(closes) >= 252:
        mom = (closes[-1] - closes[-252]) / closes[-252] * 100
        signals.append(TrendSignal(
            indicator="52W Momentum", value=f"{mom:.1f}%",
            signal="bullish" if mom > 10 else "bearish" if mom < -10 else "neutral",
            timeframe="long",
        ))

    def bias(sigs: list[str]) -> str:
        b, br = sigs.count("bullish"), sigs.count("bearish")
        return "bullish" if b > br else "bearish" if br > b else "neutral"

    result = TrendResponse(
        ticker=ticker,
        short_term_bias=bias([s.signal for s in signals if s.timeframe == "short"]),
        long_term_bias=bias([s.signal for s in signals if s.timeframe == "long"]),
        signals=signals,
        price_history=price_history[-365:],
    )
    cache.set(f"trend:{ticker}", result, ttl=3600)
    return result


# ── SCREENER ───────────────────────────────────────────────────────────────

def normalize_features(vals: list[float | None]) -> list[float]:
    return [v if v is not None else 0.0 for v in vals]


def euclidean_distance(a: list[float], b: list[float]) -> float:
    return float(np.sqrt(sum((x - y) ** 2 for x, y in zip(a, b))))


async def _fetch_peer(peer: str) -> dict | None:
    """Fetch one peer — bounded by yf_client semaphore."""
    try:
        info = await yfc.fetch_info(peer)
        if not info or not info.get("marketCap"):
            return None
        # Get 1y price change from fast history fetch
        hist = await yfc.fetch_history(peer, period="1y", interval="1mo")
        price_change_1y = None
        if not hist.empty and len(hist) > 1:
            price_change_1y = round(
                (hist["Close"].iloc[-1] - hist["Close"].iloc[0]) / hist["Close"].iloc[0] * 100, 2
            )
        return {
            "ticker": peer,
            "name":   info.get("longName") or info.get("shortName") or peer,
            "sector": info.get("sector") or "Unknown",
            "market_cap":    safe_int(info.get("marketCap")) or 0,
            "pe_ratio":      safe_float(info.get("trailingPE") or info.get("forwardPE")),
            "beta":          safe_float(info.get("beta")),
            "roe":           safe_float(info.get("returnOnEquity")),
            "price_change_1y": price_change_1y,
        }
    except Exception:
        return None


@router.get("/api/screener/{ticker}", response_model=ScreenerResponse)
async def get_screener(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"screener:{ticker}")
    if cached:
        return cached

    info = await yfc.fetch_info(ticker)
    if not info:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")

    sector = info.get("sector") or "Technology"
    all_peers = [p for p in SECTOR_PEERS.get(sector, SECTOR_PEERS["Technology"]) if p != ticker]
    # Limit to 5 peers to keep requests manageable
    peers = all_peers[:5]

    # Stagger peer fetches — 0.5s between each to avoid burst
    peer_data: list[dict] = []
    for peer in peers:
        result = await _fetch_peer(peer)
        if result:
            peer_data.append(result)
        await asyncio.sleep(0.5)

    if not peer_data:
        result = ScreenerResponse(ticker=ticker, similar=[])
        cache.set(f"screener:{ticker}", result, ttl=86400)
        return result

    target_feat = normalize_features([
        safe_float(info.get("trailingPE") or info.get("forwardPE")),
        float(info.get("marketCap") or 0),
        safe_float(info.get("beta")),
        safe_float(info.get("returnOnEquity")),
    ])

    all_feats = [target_feat] + [
        normalize_features([p["pe_ratio"], float(p["market_cap"]), p["beta"], p["roe"]])
        for p in peer_data
    ]
    arr = np.array(all_feats, dtype=float)
    rng = arr.max(axis=0) - arr.min(axis=0)
    rng[rng == 0] = 1
    normed = (arr - arr.min(axis=0)) / rng

    similar: list[SimilarStock] = []
    for i, peer in enumerate(peer_data):
        dist  = euclidean_distance(normed[0].tolist(), normed[i + 1].tolist())
        score = round(1 / (1 + dist), 4)
        similar.append(SimilarStock(
            ticker=peer["ticker"],
            name=peer["name"],
            sector=peer["sector"],
            market_cap=peer["market_cap"],
            pe_ratio=peer["pe_ratio"],
            price_change_1y=peer["price_change_1y"],
            similarity_score=score,
        ))

    similar.sort(key=lambda s: s.similarity_score, reverse=True)
    result = ScreenerResponse(ticker=ticker, similar=similar[:10])
    cache.set(f"screener:{ticker}", result, ttl=86400)
    return result


# ── SECTOR PE / PB BENCHMARKS ─────────────────────────────────────────────
# Approximate Nifty sector median P/E and P/B (updated periodically)
SECTOR_VALUATION_BENCHMARKS: dict[str, dict] = {
    "Technology":             {"pe": 28.0, "pb": 7.0},
    "Financial Services":     {"pe": 18.0, "pb": 2.8},
    "Consumer Cyclical":      {"pe": 32.0, "pb": 6.5},
    "Consumer Defensive":     {"pe": 45.0, "pb": 9.0},
    "Energy":                 {"pe": 12.0, "pb": 1.8},
    "Healthcare":             {"pe": 30.0, "pb": 4.5},
    "Industrials":            {"pe": 35.0, "pb": 6.0},
    "Basic Materials":        {"pe": 14.0, "pb": 2.0},
    "Real Estate":            {"pe": 40.0, "pb": 3.5},
    "Communication Services": {"pe": 55.0, "pb": 5.0},
    "Utilities":              {"pe": 20.0, "pb": 2.5},
}


# ── VALUATION ─────────────────────────────────────────────────────────────

@router.get("/api/valuation/{ticker}", response_model=ValuationResponse)
async def get_valuation(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"valuation:{ticker}")
    if cached:
        return cached

    info = await yfc.fetch_info(ticker)
    if not info:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")

    sector      = info.get("sector") or "Technology"
    pe          = safe_float(info.get("trailingPE"))
    forward_pe  = safe_float(info.get("forwardPE"))
    pb          = safe_float(info.get("priceToBook"))
    eps         = safe_float(info.get("trailingEps"))
    peg         = safe_float(info.get("pegRatio"))
    ev_ebitda   = safe_float(info.get("enterpriseToEbitda"))
    price       = safe_float(info.get("currentPrice") or info.get("regularMarketPrice")) or 0.0
    growth      = safe_float(info.get("earningsGrowth") or info.get("revenueGrowth")) or 0.0

    bench       = SECTOR_VALUATION_BENCHMARKS.get(sector, {"pe": 25.0, "pb": 4.0})
    sector_pe   = bench["pe"]
    sector_pb   = bench["pb"]

    # Graham Number approximation: sqrt(22.5 * EPS * BVPS)
    bvps = safe_float(info.get("bookValue"))
    dcf_fair_value: float | None = None
    if eps and bvps and eps > 0 and bvps > 0:
        dcf_fair_value = round((22.5 * eps * bvps) ** 0.5, 2)

    # Margin of safety
    mos: float | None = None
    if dcf_fair_value and price > 0:
        mos = round((dcf_fair_value - price) / dcf_fair_value * 100, 1)

    # Verdict logic
    verdict = "Insufficient Data"
    reason  = "Not enough valuation data available."

    score = 0
    reasons: list[str] = []

    if pe and sector_pe:
        ratio = pe / sector_pe
        if ratio < 0.8:
            score += 2; reasons.append(f"P/E {pe:.1f}x is {((1-ratio)*100):.0f}% below sector avg {sector_pe:.1f}x")
        elif ratio > 1.3:
            score -= 2; reasons.append(f"P/E {pe:.1f}x is {((ratio-1)*100):.0f}% above sector avg {sector_pe:.1f}x")
        else:
            reasons.append(f"P/E {pe:.1f}x is in line with sector avg {sector_pe:.1f}x")

    if pb and sector_pb:
        ratio = pb / sector_pb
        if ratio < 0.75:
            score += 1; reasons.append(f"P/B {pb:.1f}x trades below sector avg {sector_pb:.1f}x")
        elif ratio > 1.5:
            score -= 1; reasons.append(f"P/B {pb:.1f}x is elevated vs sector avg {sector_pb:.1f}x")

    if mos is not None:
        if mos > 20:
            score += 2; reasons.append(f"Graham fair value ₹{dcf_fair_value:.0f} implies {mos:.0f}% upside")
        elif mos < -20:
            score -= 2; reasons.append(f"Price exceeds Graham fair value ₹{dcf_fair_value:.0f} by {abs(mos):.0f}%")

    if peg and peg > 0:
        if peg < 1.0:
            score += 1; reasons.append(f"PEG {peg:.2f} < 1 suggests growth is attractively priced")
        elif peg > 2.5:
            score -= 1; reasons.append(f"PEG {peg:.2f} > 2.5 signals stretched growth valuation")

    if score >= 3:
        verdict = "Undervalued"
    elif score <= -3:
        verdict = "Overvalued"
    elif score == 0 and not reasons:
        verdict = "Insufficient Data"
    else:
        verdict = "Fairly Valued"

    reason = " | ".join(reasons) if reasons else reason

    result = ValuationResponse(
        ticker=ticker,
        sector=sector,
        pe_ratio=pe,
        pb_ratio=pb,
        eps=eps,
        forward_pe=forward_pe,
        peg_ratio=peg,
        ev_to_ebitda=ev_ebitda,
        sector_pe=sector_pe,
        sector_pb=sector_pb,
        dcf_fair_value=dcf_fair_value,
        margin_of_safety_pct=mos,
        verdict=verdict,
        verdict_reason=reason,
    )
    cache.set(f"valuation:{ticker}", result, ttl=86400)
    return result


# ── CASH FLOW ─────────────────────────────────────────────────────────────

@router.get("/api/cashflow/{ticker}", response_model=CashFlowResponse)
async def get_cashflow(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"cashflow:{ticker}")
    if cached:
        return cached

    info = await yfc.fetch_info(ticker)
    if not info:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")

    # Fetch cash flow statements
    loop = asyncio.get_event_loop()

    def _fetch_cf():
        import yfinance as yf
        import yf_client as _yfc
        t = yf.Ticker(ticker, session=_yfc._YF_SESSION)
        return t.cashflow, t.quarterly_cashflow, t.income_stmt, t.quarterly_income_stmt

    try:
        cf_ann, cf_qtr, is_ann, is_qtr = await loop.run_in_executor(None, _fetch_cf)
    except Exception:
        cf_ann = cf_qtr = is_ann = is_qtr = None

    def parse_cf(cf_df: pd.DataFrame | None, is_df: pd.DataFrame | None,
                 quarterly: bool) -> list[CashFlowPeriod]:
        if cf_df is None or cf_df.empty:
            return []
        periods = []
        for col in cf_df.columns[:6]:
            try:
                dt = pd.Timestamp(col)
                label = f"Q{((dt.month-1)//3)+1} {dt.year}" if quarterly else f"FY {dt.year}"

                def get(df, *keys):
                    if df is None or df.empty:
                        return None
                    for k in keys:
                        if k in df.index:
                            v = safe_float(df.loc[k, col])
                            if v is not None:
                                return v
                    return None

                ocf   = get(cf_df, "Operating Cash Flow", "Cash From Operations", "Total Cash From Operating Activities")
                capex = get(cf_df, "Capital Expenditure", "Purchase Of PPE", "Capital Expenditures")
                ni    = get(is_df, "Net Income", "Net Income Common Stockholders")
                fcf   = (ocf or 0) + (capex or 0)   # capex is negative in yfinance

                periods.append(CashFlowPeriod(
                    period=label,
                    operating_cash_flow=ocf or 0.0,
                    free_cash_flow=round(fcf, 2),
                    net_income=ni or 0.0,
                    capex=capex or 0.0,
                ))
            except Exception:
                continue
        return list(reversed(periods))

    annual    = parse_cf(cf_ann, is_ann, quarterly=False)
    quarterly = parse_cf(cf_qtr, is_qtr, quarterly=True)

    metrics = CashFlowMetrics(
        roe=safe_float(info.get("returnOnEquity")),
        roi=safe_float(info.get("returnOnAssets")),   # closest proxy in yfinance
        net_profit_margin=safe_float(info.get("profitMargins")),
        operating_margin=safe_float(info.get("operatingMargins")),
        gross_margin=safe_float(info.get("grossMargins")),
        debt_to_equity=safe_float(info.get("debtToEquity")),
        current_ratio=safe_float(info.get("currentRatio")),
        interest_coverage=None,   # not directly available; skip
    )

    result = CashFlowResponse(ticker=ticker, annual=annual, quarterly=quarterly, metrics=metrics)
    cache.set(f"cashflow:{ticker}", result, ttl=86400)
    return result


# ── CHART PATTERN DETECTION ────────────────────────────────────────────────

def _detect_patterns(closes: list[float], volumes: list[float]) -> list[ChartPattern]:
    patterns: list[ChartPattern] = []
    n = len(closes)
    if n < 50:
        return patterns

    # ── Golden Cross (SMA50 > SMA200) ──
    sma50_vals  = compute_sma(closes, 50)
    sma200_vals = compute_sma(closes, 200)
    recent50  = [v for v in sma50_vals[-5:]  if v is not None]
    recent200 = [v for v in sma200_vals[-5:] if v is not None]
    if recent50 and recent200:
        golden = recent50[-1] > recent200[-1] and recent50[0] <= recent200[0]
        death  = recent50[-1] < recent200[-1] and recent50[0] >= recent200[0]
        patterns.append(ChartPattern(
            name="Golden Cross",
            detected=golden,
            description="SMA50 crossed above SMA200 recently — strong long-term bullish signal.",
            implication="bullish",
        ))
        patterns.append(ChartPattern(
            name="Death Cross",
            detected=death,
            description="SMA50 crossed below SMA200 recently — strong long-term bearish signal.",
            implication="bearish",
        ))

    # ── Price above all MAs (Bullish alignment) ──
    sma20_vals = compute_sma(closes, 20)
    cur = closes[-1]
    s20 = next((v for v in reversed(sma20_vals)  if v is not None), None)
    s50 = next((v for v in reversed(sma50_vals)  if v is not None), None)
    s200= next((v for v in reversed(sma200_vals) if v is not None), None)
    if s20 and s50 and s200:
        bull_align = cur > s20 > s50 > s200
        bear_align = cur < s20 < s50 < s200
        patterns.append(ChartPattern(
            name="Bullish MA Alignment",
            detected=bull_align,
            description="Price > MA20 > MA50 > MA200: textbook uptrend alignment.",
            implication="bullish",
        ))
        patterns.append(ChartPattern(
            name="Bearish MA Alignment",
            detected=bear_align,
            description="Price < MA20 < MA50 < MA200: textbook downtrend alignment.",
            implication="bearish",
        ))

    # ── Double Bottom (simplified) ──
    window = 20
    if n >= window * 3:
        segment = closes[-window * 3:]
        mid     = len(segment) // 2
        low1    = min(segment[:mid])
        low2    = min(segment[mid:])
        peak    = max(segment[mid//2: mid + mid//2])
        tol     = 0.03 * (low1 + low2) / 2
        dbl_bot = abs(low1 - low2) < tol and peak > max(low1, low2) * 1.05
        patterns.append(ChartPattern(
            name="Double Bottom",
            detected=dbl_bot,
            description="Two similar lows with a peak between them — potential reversal pattern.",
            implication="bullish",
        ))

    # ── Double Top ──
    if n >= window * 3:
        segment = closes[-window * 3:]
        mid     = len(segment) // 2
        hi1     = max(segment[:mid])
        hi2     = max(segment[mid:])
        trough  = min(segment[mid//2: mid + mid//2])
        tol     = 0.03 * (hi1 + hi2) / 2
        dbl_top = abs(hi1 - hi2) < tol and trough < min(hi1, hi2) * 0.95
        patterns.append(ChartPattern(
            name="Double Top",
            detected=dbl_top,
            description="Two similar highs with a trough between them — potential reversal pattern.",
            implication="bearish",
        ))

    # ── Volume Climax (volume spike > 2x avg) ──
    if len(volumes) >= 20:
        avg_vol  = sum(volumes[-20:]) / 20
        last_vol = volumes[-1]
        vol_spike = last_vol > avg_vol * 2.0
        patterns.append(ChartPattern(
            name="Volume Climax",
            detected=vol_spike,
            description=f"Today's volume is {last_vol/avg_vol:.1f}x the 20-day average — high conviction move.",
            implication="neutral",
        ))

    # ── Oversold Bounce (RSI < 35 + price > MA20) ──
    rsi_val = compute_rsi(closes)
    os_bounce = rsi_val < 35 and s20 is not None and cur > s20
    patterns.append(ChartPattern(
        name="Oversold Bounce",
        detected=os_bounce,
        description=f"RSI {rsi_val:.0f} in oversold zone but price held above MA20 — potential reversal.",
        implication="bullish",
    ))

    # ── Overbought Pullback ──
    ob_pull = rsi_val > 70 and s20 is not None and cur < s20
    patterns.append(ChartPattern(
        name="Overbought Pullback",
        detected=ob_pull,
        description=f"RSI {rsi_val:.0f} overbought and price broke below MA20 — caution.",
        implication="bearish",
    ))

    return patterns


# ── RECOMMENDATION ─────────────────────────────────────────────────────────

@router.get("/api/recommendation/{ticker}", response_model=RecommendationResponse)
async def get_recommendation(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"recommendation:{ticker}")
    if cached:
        return cached

    hist = await yfc.fetch_history(ticker, period="2y", interval="1d")
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No price data for {ticker}")

    closes  = hist["Close"].tolist()
    volumes = hist["Volume"].tolist()
    n = len(closes)

    # ── MAs ────────────────────────────────────────────────────────────────
    sma20_l  = compute_sma(closes, 20)
    sma50_l  = compute_sma(closes, 50)
    sma200_l = compute_sma(closes, 200)

    cur = closes[-1]
    s20  = next((v for v in reversed(sma20_l)  if v is not None), None)
    s50  = next((v for v in reversed(sma50_l)  if v is not None), None)
    s200 = next((v for v in reversed(sma200_l) if v is not None), None)

    # ── RSI & MACD ─────────────────────────────────────────────────────────
    rsi_val = compute_rsi(closes)
    macd_val, macd_sig_val = compute_macd(closes)

    # ── Volume ─────────────────────────────────────────────────────────────
    avg_vol = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
    cur_vol = volumes[-1] if volumes else 0
    vol_ratio = round(cur_vol / avg_vol, 2) if avg_vol > 0 else 1.0

    # ── MA Signals ─────────────────────────────────────────────────────────
    ma_signals: list[MASignal] = []

    def ma_sig(label: str, price: float, ma: float | None) -> MASignal:
        if ma is None:
            return MASignal(label=label, value="N/A", signal="neutral")
        pct = (price - ma) / ma * 100
        sig = "bullish" if price > ma else "bearish"
        return MASignal(label=label, value=f"₹{price:.0f} vs ₹{ma:.0f} ({pct:+.1f}%)", signal=sig)

    ma_signals.append(ma_sig("Price vs MA20",  cur, s20))
    ma_signals.append(ma_sig("Price vs MA50",  cur, s50))
    ma_signals.append(ma_sig("Price vs MA200", cur, s200))

    if s20 and s50:
        sig = "bullish" if s20 > s50 else "bearish"
        pct = (s20 - s50) / s50 * 100 if s50 else 0
        ma_signals.append(MASignal(label="MA20 vs MA50",  value=f"MA20={s20:.0f}, MA50={s50:.0f} ({pct:+.1f}%)",  signal=sig))
    if s50 and s200:
        sig = "bullish" if s50 > s200 else "bearish"
        pct = (s50 - s200) / s200 * 100 if s200 else 0
        ma_signals.append(MASignal(label="MA50 vs MA200", value=f"MA50={s50:.0f}, MA200={s200:.0f} ({pct:+.1f}%)", signal=sig))

    # ── Pattern detection ──────────────────────────────────────────────────
    patterns = _detect_patterns(closes, volumes)

    # ── Composite scoring ─────────────────────────────────────────────────
    # Each component: -100 to +100, weighted average

    # 1. Trend score: based on MA alignment
    trend_pts = 0
    if s20  and cur > s20:  trend_pts += 25
    elif s20:               trend_pts -= 25
    if s50  and cur > s50:  trend_pts += 25
    elif s50:               trend_pts -= 25
    if s200 and cur > s200: trend_pts += 25
    elif s200:              trend_pts -= 25
    if s20 and s50 and s200 and s20 > s50 > s200: trend_pts += 25
    elif s20 and s50 and s200 and s20 < s50 < s200: trend_pts -= 25
    trend_score = float(np.clip(trend_pts, -100, 100))

    # 2. Momentum score: RSI + MACD
    rsi_pts = 0
    if rsi_val < 30:   rsi_pts = 60
    elif rsi_val < 45: rsi_pts = 30
    elif rsi_val < 55: rsi_pts = 0
    elif rsi_val < 70: rsi_pts = -20
    else:              rsi_pts = -50
    macd_pts = 40 if macd_val > macd_sig_val else -40
    momentum_score = float(np.clip((rsi_pts + macd_pts) / 2, -100, 100))

    # 3. Volume score
    if vol_ratio > 2.0:
        # High volume — direction of move determines sign
        day_chg = (closes[-1] - closes[-2]) / closes[-2] if n > 1 else 0
        volume_score = float(np.clip(day_chg * 1000, -100, 100))
    elif vol_ratio > 1.3:
        volume_score = 20.0
    elif vol_ratio < 0.5:
        volume_score = -10.0
    else:
        volume_score = 0.0

    # 4. Pattern score
    bull_pats = sum(1 for p in patterns if p.detected and p.implication == "bullish")
    bear_pats = sum(1 for p in patterns if p.detected and p.implication == "bearish")
    pattern_score = float(np.clip((bull_pats - bear_pats) * 25, -100, 100))

    # Weighted composite: trend 40%, momentum 35%, volume 10%, patterns 15%
    composite = round(
        trend_score    * 0.40 +
        momentum_score * 0.35 +
        volume_score   * 0.10 +
        pattern_score  * 0.15,
        1
    )

    # ── Recommendation ────────────────────────────────────────────────────
    if composite >= 55:
        rec = "Strong Buy"
    elif composite >= 20:
        rec = "Buy"
    elif composite >= -20:
        rec = "Hold"
    elif composite >= -55:
        rec = "Sell"
    else:
        rec = "Strong Sell"

    # Confidence: how decisive the score is (distance from 0, scaled to 50-95%)
    confidence = round(50 + abs(composite) * 0.45, 1)
    confidence = min(confidence, 95.0)

    # ── RSI/MACD text labels ───────────────────────────────────────────────
    rsi_label = (
        "Oversold" if rsi_val < 30 else
        "Near Oversold" if rsi_val < 40 else
        "Neutral" if rsi_val < 60 else
        "Near Overbought" if rsi_val < 70 else
        "Overbought"
    )
    macd_label = "Bullish crossover" if macd_val > macd_sig_val else "Bearish crossover"

    # ── Summary ───────────────────────────────────────────────────────────
    det_patterns = [p.name for p in patterns if p.detected]
    summary_parts = [f"Composite score: {composite:+.0f}/100 → {rec}."]
    if det_patterns:
        summary_parts.append(f"Active patterns: {', '.join(det_patterns[:3])}.")
    summary_parts.append(
        f"RSI {rsi_val:.0f} ({rsi_label}). "
        f"Volume is {vol_ratio:.1f}x avg. "
        f"MACD: {macd_label}."
    )

    # ── Build price history with all MAs + volume ──────────────────────────
    price_history = []
    for i, (idx, row) in enumerate(hist.iterrows()):
        price_history.append({
            "date":    str(idx.date()),
            "close":   round(float(row["Close"]), 2),
            "volume":  int(row["Volume"]),
            "ma20":    sma20_l[i],
            "ma50":    sma50_l[i],
            "ma200":   sma200_l[i],
        })

    result = RecommendationResponse(
        ticker=ticker,
        recommendation=rec,
        confidence_pct=confidence,
        composite_score=composite,
        trend_score=trend_score,
        momentum_score=momentum_score,
        volume_score=volume_score,
        pattern_score=pattern_score,
        ma_signals=ma_signals,
        patterns=patterns,
        rsi=rsi_val,
        rsi_signal=rsi_label,
        macd_signal=macd_label,
        volume_vs_avg=vol_ratio,
        summary=" ".join(summary_parts),
        price_history=price_history[-365:],
    )
    cache.set(f"recommendation:{ticker}", result, ttl=3600)
    return result


# ── HOLDINGS (FII / DII / Institutional / Mutual Fund) ────────────────────

# ── HOLDINGS (Institutional / Promoter / Mutual Fund) ─────────────────────
#
# yfinance 1.4.x major_holders structure (TCS.NS example):
#   DataFrame with index = Breakdown key, column = Value
#   Keys: insidersPercentHeld, institutionsPercentHeld,
#         institutionsFloatPercentHeld, institutionsCount
#
# institutional_holders / mutualfund_holders are EMPTY for NSE stocks via Yahoo.
# Fallback: pull heldPercentInsiders / heldPercentInstitutions from info dict.

def _safe_pct(val) -> float | None:
    """Convert 0.1234 → 12.34 or '12.34%' → 12.34, clamp 0-100."""
    try:
        v = float(str(val).replace("%", "").strip())
        v = v * 100 if v <= 1.0 else v
        return round(max(0.0, min(100.0, v)), 2)
    except Exception:
        return None


def _parse_major_holders(df) -> dict:
    """Parse major_holders DataFrame into a clean dict of known keys."""
    result: dict[str, float | None] = {}
    if df is None or df.empty:
        return result
    try:
        # yfinance 1.4.x: index is the key name, single 'Value' column
        if "Value" in df.columns:
            for key, row in df.iterrows():
                result[str(key)] = _safe_pct(row["Value"])
        else:
            # Older format: two columns [value, label]
            for _, row in df.iterrows():
                if len(row) >= 2:
                    result[str(row.iloc[1]).lower()] = _safe_pct(row.iloc[0])
    except Exception:
        pass
    return result


def _build_inst_trend(pct_inst: float | None, inst_count: int | None) -> str:
    if pct_inst is None:
        return "Data unavailable"
    if pct_inst > 55:
        return "High — strong institutional conviction"
    if pct_inst > 35:
        return "Moderate — healthy institutional interest"
    if pct_inst > 15:
        return "Low-moderate — limited institutional coverage"
    return "Low — minimal institutional presence"


@router.get("/api/holdings/{ticker}", response_model=HoldingsResponse)
async def get_holdings(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"holdings:{ticker}")
    if cached:
        return cached

    # Fetch holdings data AND info (fallback for percentages)
    raw  = await yfc.fetch_holdings(ticker)
    info = await yfc.fetch_info(ticker)

    major_df = raw.get("major")
    inst_df  = raw.get("inst")
    mf_df    = raw.get("mf")

    # ── Parse major_holders ────────────────────────────────────────────────
    mh = _parse_major_holders(major_df)

    # Primary: from major_holders DataFrame
    pct_insider = (
        mh.get("insidersPercentHeld") or
        mh.get("% held by insiders") or
        mh.get("insiderspercenheld")
    )
    pct_inst = (
        mh.get("institutionsPercentHeld") or
        mh.get("% held by institutions") or
        mh.get("institutionspercenheld")
    )
    pct_inst_float = mh.get("institutionsFloatPercentHeld")
    inst_count_raw = mh.get("institutionsCount")
    inst_count = int(inst_count_raw) if inst_count_raw is not None else None

    # Fallback: pull directly from info dict (always available)
    if pct_insider is None:
        pct_insider = _safe_pct(info.get("heldPercentInsiders"))
    if pct_inst is None:
        pct_inst = _safe_pct(info.get("heldPercentInstitutions"))

    # Promoter % for Indian stocks = 100 - institutions - retail float
    # We model: retail = 100 - insider(promoter) - institutions
    pct_retail = None
    if pct_inst is not None and pct_insider is not None:
        pct_retail = round(max(0.0, 100.0 - pct_inst - pct_insider), 2)

    # ── Parse holder lists (best-effort; often empty for NSE) ─────────────
    def _parse_df(df, n: int = 8) -> list[HolderEntry]:
        if df is None or df.empty:
            return []
        entries = []
        for _, row in df.head(n).iterrows():
            name = str(row.get("Holder") or row.get("Name") or "Unknown")
            if name in ("Unknown", "nan", ""):
                continue
            pct_raw = (row.get("% Out") or row.get("pctHeld") or
                       row.get("percentHeld") or row.get("Pct Held"))
            pct     = _safe_pct(pct_raw)
            entries.append(HolderEntry(
                name=name,
                pct_held=pct,
                shares=safe_int(row.get("Shares") or row.get("shares")),
                value=safe_float(row.get("Value") or row.get("value")),
            ))
        return entries

    top_institutions = _parse_df(inst_df)
    top_mutual_funds = _parse_df(mf_df)

    # ── For NSE stocks: build synthetic holder entries from info ──────────
    # Yahoo doesn't provide named holders for NSE; show what we have
    if not top_institutions and pct_inst is not None:
        top_institutions = [HolderEntry(
            name="FII / DII / Institutional (aggregate)",
            pct_held=pct_inst,
            shares=None,
            value=None,
        )]
    if not top_mutual_funds and info.get("longName"):
        # Placeholder — actual MF data not available via Yahoo for NSE
        top_mutual_funds = []

    # ── Trend signal ──────────────────────────────────────────────────────
    inst_trend = _build_inst_trend(pct_inst, inst_count)

    # ── Summary ───────────────────────────────────────────────────────────
    parts = []
    if pct_insider is not None:
        parts.append(f"Promoter/Insider stake: {pct_insider:.1f}%")
    if pct_inst is not None:
        parts.append(f"Institutional (FII+DII): {pct_inst:.1f}%")
    if pct_retail is not None:
        parts.append(f"Public/Retail float: ~{pct_retail:.1f}%")
    if inst_count:
        parts.append(f"{inst_count} institutions tracked")

    holding_summary = ". ".join(parts) + "." if parts else "Holdings data not available for this ticker."

    result = HoldingsResponse(
        ticker=ticker,
        pct_institutional=pct_inst,
        pct_insider=pct_insider,
        pct_retail=pct_retail,
        top_institutions=top_institutions,
        top_mutual_funds=top_mutual_funds,
        inst_trend=inst_trend,
        holding_summary=holding_summary,
    )
    cache.set(f"holdings:{ticker}", result, ttl=86400)
    return result


# ── BTST (Buy Today Sell Tomorrow) ────────────────────────────────────────

def _compute_atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    """Average True Range — measure of daily volatility."""
    if len(closes) < period + 1:
        return (max(highs) - min(lows)) / max(min(lows), 1) * closes[-1] if highs else 0.0
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    return round(sum(trs[-period:]) / period, 2)


def _overnight_gap_stats(opens: list[float], closes: list[float]) -> tuple[float, float]:
    """Returns (avg_gap_pct, pct_positive_gaps) over last 20 sessions."""
    if len(opens) < 3 or len(closes) < 3:
        return 0.0, 50.0
    gaps = []
    for i in range(1, min(len(opens), len(closes), 21)):
        gap_pct = (opens[i] - closes[i - 1]) / closes[i - 1] * 100
        gaps.append(gap_pct)
    if not gaps:
        return 0.0, 50.0
    avg_gap = round(sum(gaps) / len(gaps), 3)
    pct_pos = round(sum(1 for g in gaps if g > 0) / len(gaps) * 100, 1)
    return avg_gap, pct_pos


def _price_position_in_range(price: float, low_20: float, high_20: float) -> float:
    """0 = at 20d low, 1 = at 20d high."""
    rng = high_20 - low_20
    if rng == 0:
        return 0.5
    return round((price - low_20) / rng, 3)


def _candle_strength(open_: float, high: float, low: float, close: float) -> float:
    """
    Candle body score: +1 = strong bullish marubozu, -1 = strong bearish.
    Based on: body size relative to range, close position in range.
    """
    rng = high - low
    if rng == 0:
        return 0.0
    body = close - open_
    close_pos = (close - low) / rng          # 0 = closed at low, 1 = closed at high
    body_ratio = abs(body) / rng             # 0 = doji, 1 = marubozu
    direction = 1.0 if body >= 0 else -1.0
    return round(direction * body_ratio * close_pos if direction > 0
                 else direction * body_ratio * (1 - close_pos), 3)


@router.get("/api/btst/{ticker}", response_model=BTSTResponse)
async def get_btst(ticker: str):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"btst:{ticker}")
    if cached:
        return cached

    # Fetch 60-day daily + 5-day 15-min for intraday picture
    hist_60  = await yfc.fetch_history(ticker, period="60d",  interval="1d")
    hist_5d  = await yfc.fetch_history(ticker, period="5d",   interval="15m")
    info     = await yfc.fetch_info(ticker)

    if hist_60.empty:
        raise HTTPException(status_code=404, detail=f"No price data for {ticker}")

    # ── Daily series ───────────────────────────────────────────────────────
    closes  = hist_60["Close"].tolist()
    opens   = hist_60["Open"].tolist()
    highs   = hist_60["High"].tolist()
    lows    = hist_60["Low"].tolist()
    volumes = hist_60["Volume"].tolist()

    price    = closes[-1]
    open_    = opens[-1]
    high_    = highs[-1]
    low_     = lows[-1]
    vol_     = volumes[-1]

    avg_vol_20 = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
    vol_ratio  = round(vol_ / avg_vol_20, 2) if avg_vol_20 > 0 else 1.0

    high_20 = max(highs[-20:])
    low_20  = min(lows[-20:])

    # ── Indicators ────────────────────────────────────────────────────────
    ma5  = _sma_btst(closes, 5)
    ma10 = _sma_btst(closes, 10)
    ma20 = _sma_btst(closes, 20)
    rsi  = compute_rsi(closes, 14)
    atr  = _compute_atr(highs, lows, closes, 14)
    macd_val, macd_sig = compute_macd(closes)
    avg_gap_pct, pct_pos_gaps = _overnight_gap_stats(opens, closes)
    pos_in_range = _price_position_in_range(price, low_20, high_20)
    candle_score = _candle_strength(open_, high_, low_, price)

    # ── 5-day history for chart ────────────────────────────────────────────
    price_history_5d = []
    if not hist_5d.empty:
        for idx, row in hist_5d.iterrows():
            price_history_5d.append({
                "date":   str(idx),
                "open":   round(float(row["Open"]),  2),
                "high":   round(float(row["High"]),  2),
                "low":    round(float(row["Low"]),   2),
                "close":  round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            })
    else:
        # fallback: last 5 daily candles
        for idx, row in hist_60.tail(5).iterrows():
            price_history_5d.append({
                "date":   str(idx.date()),
                "open":   round(float(row["Open"]),  2),
                "high":   round(float(row["High"]),  2),
                "low":    round(float(row["Low"]),   2),
                "close":  round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            })

    # ── Proximity to key levels ────────────────────────────────────────────
    # How close is price to 20d high (resistance) and 20d low (support)?
    pct_from_20d_high = (high_20 - price) / high_20 * 100
    pct_from_20d_low  = (price - low_20)  / low_20  * 100

    # ── Score each BTST factor ─────────────────────────────────────────────
    signals: list[BTSTSignal] = []

    # 1. Momentum: RSI 45-65 = ideal entry zone for BTST (not overbought, trending)
    if 40 <= rsi <= 60:
        rsi_sc = 0.8
        rsi_note = f"RSI {rsi:.0f} in ideal BTST momentum zone (40-60)"
    elif 30 <= rsi < 40:
        rsi_sc = 0.5
        rsi_note = f"RSI {rsi:.0f} near oversold — potential bounce candidate"
    elif 60 < rsi <= 70:
        rsi_sc = 0.3
        rsi_note = f"RSI {rsi:.0f} slightly elevated but not overbought"
    elif rsi > 70:
        rsi_sc = -0.6
        rsi_note = f"RSI {rsi:.0f} overbought — overnight long risky, likely to mean-revert"
    else:
        rsi_sc = -0.3
        rsi_note = f"RSI {rsi:.0f} oversold — downtrend intact, avoid BTST"
    signals.append(BTSTSignal(factor="RSI Momentum", value=f"{rsi:.1f}",
                              score=rsi_sc, weight=0.20, note=rsi_note))

    # 2. MACD crossover
    if macd_val > macd_sig and macd_val > 0:
        m_sc = 0.9; m_note = "MACD bullish crossover above zero — strong upward momentum"
    elif macd_val > macd_sig and macd_val <= 0:
        m_sc = 0.6; m_note = "MACD bullish crossover below zero — early momentum shift"
    elif macd_val < macd_sig and macd_val < 0:
        m_sc = -0.8; m_note = "MACD bearish below zero — avoid overnight long"
    else:
        m_sc = -0.3; m_note = "MACD bearish above zero — weakening momentum"
    signals.append(BTSTSignal(factor="MACD", value=f"{macd_val:.3f} vs {macd_sig:.3f}",
                              score=m_sc, weight=0.18, note=m_note))

    # 3. Volume surge — BTST needs conviction
    if vol_ratio >= 2.0:
        v_sc = 1.0; v_note = f"Volume {vol_ratio:.1f}x avg — strong institutional conviction, ideal BTST setup"
    elif vol_ratio >= 1.3:
        v_sc = 0.6; v_note = f"Volume {vol_ratio:.1f}x avg — above average, supports the move"
    elif vol_ratio >= 0.8:
        v_sc = 0.0; v_note = f"Volume {vol_ratio:.1f}x avg — average participation, neutral"
    else:
        v_sc = -0.5; v_note = f"Volume {vol_ratio:.1f}x avg — weak volume, move lacks conviction"
    signals.append(BTSTSignal(factor="Volume Surge", value=f"{vol_ratio:.2f}x avg",
                              score=v_sc, weight=0.20, note=v_note))

    # 4. Today's candle strength
    if candle_score >= 0.5:
        c_sc = 0.9; c_note = f"Strong bullish candle (score {candle_score:.2f}) — price closed near day's high"
    elif candle_score >= 0.2:
        c_sc = 0.5; c_note = f"Moderately bullish candle (score {candle_score:.2f})"
    elif -0.2 < candle_score < 0.2:
        c_sc = 0.0; c_note = f"Indecisive doji/spinning top — unclear directional bias"
    elif candle_score <= -0.5:
        c_sc = -0.9; c_note = f"Strong bearish candle (score {candle_score:.2f}) — avoid BTST"
    else:
        c_sc = -0.4; c_note = f"Bearish close — cautious"
    signals.append(BTSTSignal(factor="Candle Pattern", value=f"Score {candle_score:.2f}",
                              score=c_sc, weight=0.20, note=c_note))

    # 5. MA alignment for short-term trend
    if ma5 and ma10 and price > ma5 > ma10:
        ma_sc = 0.8; ma_note = f"Price ₹{price:.0f} > MA5 ₹{ma5:.0f} > MA10 ₹{ma10:.0f} — short-term uptrend"
    elif ma5 and price > ma5:
        ma_sc = 0.4; ma_note = f"Price above MA5 — momentum positive but MA10 not confirmed"
    elif ma5 and ma10 and price < ma5 < ma10:
        ma_sc = -0.8; ma_note = f"Price below MA5 and MA10 — short-term downtrend, avoid BTST"
    else:
        ma_sc = -0.2; ma_note = "Mixed MA signals — no clear short-term trend"
    signals.append(BTSTSignal(factor="Short-term MAs (5/10)", value=f"MA5={ma5 or 'N/A'}, MA10={ma10 or 'N/A'}",
                              score=ma_sc, weight=0.12, note=ma_note))

    # 6. Overnight gap tendency
    if pct_pos_gaps >= 60 and avg_gap_pct > 0.1:
        g_sc = 0.7; g_note = f"{pct_pos_gaps:.0f}% positive gaps, avg {avg_gap_pct:+.2f}% — stock tends to gap up"
    elif pct_pos_gaps >= 50:
        g_sc = 0.3; g_note = f"{pct_pos_gaps:.0f}% positive gaps — slight edge for overnight longs"
    elif pct_pos_gaps < 40:
        g_sc = -0.6; g_note = f"Only {pct_pos_gaps:.0f}% positive gaps, avg {avg_gap_pct:+.2f}% — historically gaps down"
    else:
        g_sc = 0.0; g_note = f"{pct_pos_gaps:.0f}% positive gaps — no clear edge"
    signals.append(BTSTSignal(factor="Overnight Gap History", value=f"Avg {avg_gap_pct:+.2f}%",
                              score=g_sc, weight=0.10, note=g_note))

    # ── Composite score ────────────────────────────────────────────────────
    composite = round(sum(s.score * s.weight * 100 for s in signals) / sum(s.weight for s in signals), 1)

    # ── Entry / Target / Stop ─────────────────────────────────────────────
    # Entry: current close (or slightly above for confirmation)
    entry_price = round(price, 2)

    # Target: 1 × ATR above entry (typical overnight target)
    target_price = round(entry_price + max(atr * 1.0, entry_price * 0.005), 2)

    # Stop loss: 0.75 × ATR below entry (tight stop for BTST)
    stop_loss = round(entry_price - max(atr * 0.75, entry_price * 0.004), 2)

    risk   = entry_price - stop_loss
    reward = target_price - entry_price
    rr     = round(reward / risk, 2) if risk > 0 else 0.0

    # ── Verdict ───────────────────────────────────────────────────────────
    if composite >= 55:
        verdict = "Strong BTST"
    elif composite >= 20:
        verdict = "BTST Possible"
    elif composite >= -20:
        verdict = "Avoid"
    else:
        verdict = "Strong Avoid"

    # Confidence
    confidence = round(min(50 + abs(composite) * 0.45, 95), 1)

    # ── Summary ───────────────────────────────────────────────────────────
    bull_factors = [s.factor for s in signals if s.score > 0.4]
    bear_factors = [s.factor for s in signals if s.score < -0.4]

    summary = (
        f"{verdict} for {ticker}. "
        f"Composite score {composite:+.0f}/100, confidence {confidence:.0f}%. "
        f"Entry ₹{entry_price}, target ₹{target_price} (+{reward/entry_price*100:.1f}%), "
        f"stop ₹{stop_loss} (-{risk/entry_price*100:.1f}%), R:R = 1:{rr:.1f}. "
    )
    if bull_factors:
        summary += f"Bullish factors: {', '.join(bull_factors[:3])}. "
    if bear_factors:
        summary += f"Bearish risks: {', '.join(bear_factors[:2])}. "
    summary += "BTST is a high-risk intraday strategy. Always use a strict stop loss."

    result = BTSTResponse(
        ticker=ticker,
        verdict=verdict,
        confidence_pct=confidence,
        composite_score=composite,
        entry_price=entry_price,
        target_price=target_price,
        stop_loss=stop_loss,
        risk_reward=rr,
        expected_gap_pct=round(avg_gap_pct, 2),
        signals=signals,
        summary=summary,
        price_history_5d=price_history_5d,
        generated_at=datetime.now(_tz.utc).isoformat(),
    )
    cache.set(f"btst:{ticker}", result, ttl=1800)   # 30-min cache (intraday data)
    return result


def _sma_btst(closes: list[float], window: int) -> float | None:
    if len(closes) < window:
        return None
    return round(sum(closes[-window:]) / window, 2)
