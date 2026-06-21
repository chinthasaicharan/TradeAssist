import os
import re
import json
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models import InsightsResponse, SWOTInsights
import cache
import yf_client as yfc

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

TICKER_RE = re.compile(r"^[A-Z0-9&.\-]{1,20}$")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def validate_ticker(ticker: str) -> str:
    t = ticker.upper().strip()
    if not TICKER_RE.match(t):
        raise HTTPException(status_code=422, detail="Invalid ticker format")
    return t


def safe_float(val) -> float | None:
    try:
        import numpy as np
        v = float(val)
        return v if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None


# ── Inline technical helpers ───────────────────────────────────────────────

def _sma(closes: list[float], window: int) -> float | None:
    if len(closes) < window:
        return None
    return round(sum(closes[-window:]) / window, 2)


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains  = [d if d > 0 else 0.0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0.0 for d in deltas[-period:]]
    ag, al = sum(gains) / period, sum(losses) / period
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 2)


def _macd(closes: list[float]) -> tuple[float, float]:
    def ema(data: list[float], span: int) -> list[float]:
        k = 2 / (span + 1)
        v = [data[0]]
        for x in data[1:]:
            v.append(x * k + v[-1] * (1 - k))
        return v
    if len(closes) < 26:
        return 0.0, 0.0
    macd_line = [a - b for a, b in zip(ema(closes, 12), ema(closes, 26))]
    signal = ema(macd_line[25:], 9)
    return round(macd_line[-1], 4), round(signal[-1], 4)


# ── Data fetchers ──────────────────────────────────────────────────────────

async def _get_technicals(ticker: str) -> dict:
    """Compute MA20/50/200, RSI, MACD, volume ratio, 52W change."""
    try:
        hist = await yfc.fetch_history(ticker, period="1y", interval="1d")
        if hist is None or hist.empty:
            return {}
        closes  = hist["Close"].tolist()
        volumes = hist["Volume"].tolist()
        price   = closes[-1]
        ma20, ma50, ma200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
        rsi = _rsi(closes)
        macd_v, macd_s = _macd(closes)
        avg_vol   = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
        vol_ratio = round(volumes[-1] / avg_vol, 2) if avg_vol > 0 else 1.0
        w52_chg   = round((closes[-1] - closes[-252]) / closes[-252] * 100, 1) if len(closes) >= 252 else None
        above     = sum(1 for ma in [ma20, ma50, ma200] if ma and price > ma)
        ma_bias = (
            "strongly bullish (price above all 3 MAs)"   if above == 3 else
            "moderately bullish (price above 2 of 3 MAs)" if above == 2 else
            "mildly bearish (price above 1 of 3 MAs)"    if above == 1 else
            "strongly bearish (price below all 3 MAs)"
        )
        return {
            "price": round(price, 2), "ma20": ma20, "ma50": ma50, "ma200": ma200,
            "rsi": rsi, "macd": macd_v, "macd_signal": macd_s,
            "vol_ratio": vol_ratio, "w52_chg_pct": w52_chg,
            "ma_bias": ma_bias,
            "golden_cross": bool(ma50 and ma200 and ma50 > ma200),
            "death_cross":  bool(ma50 and ma200 and ma50 < ma200),
            "macd_bullish": macd_v > macd_s,
        }
    except Exception:
        return {}


def _safe_pct_ctx(val) -> float | None:
    """Convert 0.1234 -> 12.34 or '12.34%' -> 12.34, clamp 0-100."""
    try:
        v = float(str(val).replace("%", "").strip())
        v = v * 100 if v <= 1.0 else v
        return round(max(0.0, min(100.0, v)), 2)
    except Exception:
        return None


def _parse_major_holders_ctx(df) -> dict:
    """Parse major_holders DataFrame — handles yfinance 1.4.x (index-keyed)
    and the older two-column format."""
    result: dict[str, float | None] = {}
    if df is None or df.empty:
        return result
    try:
        if "Value" in df.columns:
            # yfinance 1.4.x: index = key name, single 'Value' column
            for key, row in df.iterrows():
                result[str(key)] = _safe_pct_ctx(row["Value"])
        else:
            # Older format: two columns [value, label]
            for _, row in df.iterrows():
                if len(row) >= 2:
                    result[str(row.iloc[1]).lower()] = _safe_pct_ctx(row.iloc[0])
    except Exception:
        pass
    return result


async def _get_holdings_context(ticker: str) -> dict:
    """Parse institutional/MF holdings into a simple dict for the AI prompt."""
    try:
        raw, info = await asyncio.gather(
            yfc.fetch_holdings(ticker),
            yfc.fetch_info(ticker),
        )
        major_df = raw.get("major")
        inst_df  = raw.get("inst")
        mf_df    = raw.get("mf")

        # ── major_holders: yfinance 1.4.x index-based parser ──────────────
        mh = _parse_major_holders_ctx(major_df)

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

        # Fallback: info dict (always available for Yahoo-covered tickers)
        if pct_insider is None:
            pct_insider = _safe_pct_ctx(info.get("heldPercentInsiders"))
        if pct_inst is None:
            pct_inst = _safe_pct_ctx(info.get("heldPercentInstitutions"))

        # ── Named holder lists (best-effort; often empty for NSE) ──────────
        def _parse_df(df, n=5) -> list[str]:
            if df is None or df.empty:
                return []
            out = []
            for _, row in df.head(n).iterrows():
                name = str(row.get("Holder") or row.get("Name") or "")
                pct_raw = (row.get("% Out") or row.get("pctHeld") or
                           row.get("percentHeld") or row.get("Pct Held"))
                try:
                    pv = _safe_pct_ctx(pct_raw)
                    out.append(f"{name} ({pv:.1f}%)" if (name and pv is not None) else name)
                except Exception:
                    if name:
                        out.append(name)
            return [x for x in out if x]

        return {
            "pct_inst":         pct_inst,
            "pct_insider":      pct_insider,
            "top_institutions": _parse_df(inst_df),
            "top_mutual_funds": _parse_df(mf_df),
        }
    except Exception:
        return {}


# ── Context builder (fundamentals + technical + holdings + news) ───────────

def format_prompt_context(
    ticker: str, info: dict, headlines: list[str], tech: dict, holdings: dict
) -> str:
    parts = [
        f"Stock: {ticker}",
        f"Company: {info.get('longName', ticker)}",
        f"Sector: {info.get('sector', 'N/A')}",
        f"Industry: {info.get('industry', 'N/A')}",
    ]
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    if price:
        parts.append(f"Current Price: ₹{price}")

    parts.append("\n── FUNDAMENTALS ──")
    for label, key in [
        ("P/E Ratio", "trailingPE"), ("Forward P/E", "forwardPE"),
        ("EPS (TTM)", "trailingEps"), ("Market Cap", "marketCap"),
        ("Beta", "beta"), ("52W High", "fiftyTwoWeekHigh"), ("52W Low", "fiftyTwoWeekLow"),
        ("Revenue Growth YoY", "revenueGrowth"), ("Earnings Growth YoY", "earningsGrowth"),
        ("Profit Margin", "profitMargins"), ("Gross Margin", "grossMargins"),
        ("Operating Margin", "operatingMargins"), ("Debt/Equity", "debtToEquity"),
        ("ROE", "returnOnEquity"), ("ROA", "returnOnAssets"),
        ("Free Cash Flow", "freeCashflow"),
        ("Analyst Target", "targetMeanPrice"), ("Analyst Rec", "recommendationKey"),
    ]:
        val = info.get(key)
        if val is not None:
            fv = safe_float(val)
            parts.append(f"  {label}: {fv if fv is not None else val}")

    if tech:
        parts.append("\n── TECHNICAL ANALYSIS ──")
        p = tech.get("price", 0)
        for label, ma_key in [("MA20", "ma20"), ("MA50", "ma50"), ("MA200", "ma200")]:
            mv = tech.get(ma_key)
            if mv:
                arrow = "▲" if p > mv else "▼"
                parts.append(f"  {label}: ₹{mv:.0f}  {arrow} Price {'above' if p > mv else 'below'}")
        parts.append(f"  MA Bias: {tech.get('ma_bias', 'N/A')}")
        if tech.get("golden_cross"):
            ma50, ma200 = tech.get("ma50", 0), tech.get("ma200", 0)
            parts.append(f"  ✅ GOLDEN CROSS: MA50 (₹{ma50:.0f}) > MA200 (₹{ma200:.0f}) — bullish long-term signal")
        if tech.get("death_cross"):
            ma50, ma200 = tech.get("ma50", 0), tech.get("ma200", 0)
            parts.append(f"  ⚠️ DEATH CROSS: MA50 (₹{ma50:.0f}) < MA200 (₹{ma200:.0f}) — bearish long-term signal")
        rsi = tech.get("rsi", 50)
        rsi_lbl = "oversold" if rsi < 30 else "near oversold" if rsi < 40 else "overbought" if rsi > 70 else "near overbought" if rsi > 60 else "neutral"
        parts.append(f"  RSI (14): {rsi:.1f} — {rsi_lbl}")
        parts.append(f"  MACD: {'bullish crossover' if tech.get('macd_bullish') else 'bearish crossover'}")
        parts.append(f"  Volume vs 20d avg: {tech.get('vol_ratio', 1):.2f}x")
        if tech.get("w52_chg_pct") is not None:
            parts.append(f"  52-Week Return: {tech['w52_chg_pct']:+.1f}%")

    if holdings:
        parts.append("\n── INSTITUTIONAL & MUTUAL FUND HOLDINGS ──")
        if holdings.get("pct_inst") is not None:
            parts.append(f"  Institutional ownership: {holdings['pct_inst']:.1f}%")
        if holdings.get("pct_insider") is not None:
            parts.append(f"  Insider ownership: {holdings['pct_insider']:.1f}%")
        if holdings.get("pct_inst") and holdings.get("pct_insider"):
            retail = max(0, 100 - holdings["pct_inst"] - holdings["pct_insider"])
            parts.append(f"  Retail/public float: ~{retail:.1f}%")
        if holdings.get("top_institutions"):
            parts.append(f"  Top institutional holders: {', '.join(holdings['top_institutions'][:3])}")
        if holdings.get("top_mutual_funds"):
            parts.append(f"  Top mutual fund holders: {', '.join(holdings['top_mutual_funds'][:3])}")

    if headlines:
        parts.append("\n── RECENT NEWS ──")
        for h in headlines[:8]:
            parts.append(f"  - {h}")

    return "\n".join(parts)


# ── SWOT prompt ────────────────────────────────────────────────────────────

def build_swot_prompt(ticker: str, context: str) -> str:
    return f"""You are a senior equity research analyst at a top Indian brokerage.
Analyze {ticker} using the fundamental, technical, holdings, and news data below.

{context}

Write a SWOT that EXPLICITLY integrates:
- Strengths: strong financials + bullish MA signals (e.g. golden cross, price above MA200) + high institutional ownership as vote of confidence
- Weaknesses: poor margins/leverage + bearish technicals (below key MAs, death cross) + low or declining institutional interest
- Opportunities: growth catalysts + favorable chart setups + increasing FII/DII buying
- Threats: fundamental risks + overbought RSI / bearish patterns + insider selling or low institutional coverage

Return ONLY valid JSON:
{{
  "strengths":     ["cite specific numbers: PE, MA values, % institutional", ...],
  "weaknesses":    ["cite specific numbers", ...],
  "opportunities": ["cite specific numbers", ...],
  "threats":       ["cite specific numbers", ...],
  "summary": "3 sentences: (1) fundamental thesis, (2) technical stance with MA/RSI levels, (3) holdings signal & overall recommendation"
}}
Rules: 3-5 items per quadrant. Max 2 sentences each. Reference actual ₹ prices and % values."""


# ── Rule-based fallback ────────────────────────────────────────────────────

def generate_fallback_swot(ticker: str, info: dict, tech: dict, holdings: dict) -> SWOTInsights:
    name          = info.get("longName", ticker)
    sector        = info.get("sector", "N/A")
    market_cap    = info.get("marketCap", 0) or 0
    pe            = safe_float(info.get("trailingPE"))
    roe           = safe_float(info.get("returnOnEquity"))
    debt_eq       = safe_float(info.get("debtToEquity"))
    rev_growth    = safe_float(info.get("revenueGrowth"))
    profit_margin = safe_float(info.get("profitMargins"))
    rec           = info.get("recommendationKey", "")

    price     = tech.get("price", 0)
    ma20      = tech.get("ma20")
    ma50      = tech.get("ma50")
    ma200     = tech.get("ma200")
    rsi       = tech.get("rsi", 50)
    ma_bias   = tech.get("ma_bias", "")
    golden    = tech.get("golden_cross", False)
    death     = tech.get("death_cross", False)
    macd_bull = tech.get("macd_bullish", False)
    w52_chg   = tech.get("w52_chg_pct")
    vol_ratio = tech.get("vol_ratio", 1.0)

    pct_inst  = holdings.get("pct_inst")
    pct_ins   = holdings.get("pct_insider")
    top_inst  = holdings.get("top_institutions", [])
    top_mf    = holdings.get("top_mutual_funds", [])

    S, W, O, T = [], [], [], []

    # ── Fundamentals ──────────────────────────────────────────────────────
    if market_cap > 100_000_000_000:
        S.append(f"Large-cap (₹{market_cap/1e9:.0f}B market cap) with strong institutional backing and liquidity")
    if profit_margin and profit_margin > 0.2:
        S.append(f"Exceptional net margin of {profit_margin*100:.1f}% reflects pricing power and cost discipline")
    elif profit_margin and profit_margin < 0.05:
        W.append(f"Thin net margin of {profit_margin*100:.1f}% leaves little buffer against any revenue headwind")
    if roe and roe > 0.15:
        S.append(f"ROE of {roe*100:.1f}% is well above the 15% quality benchmark — capital is being deployed efficiently")
    elif roe and roe < 0:
        W.append("Negative ROE indicates operating losses or an over-leveraged balance sheet")
    if rev_growth and rev_growth > 0.15:
        O.append(f"Strong revenue growth of {rev_growth*100:.1f}% YoY points to robust demand and market share expansion")
    elif rev_growth and rev_growth < 0:
        W.append(f"Revenue declined {abs(rev_growth)*100:.1f}% YoY — demand softness or competitive pressure is biting")
    if debt_eq and debt_eq > 100:
        T.append(f"Elevated D/E of {debt_eq:.0f}x raises refinancing risk in a high-rate environment")
    elif debt_eq is not None and debt_eq < 30:
        S.append(f"Lean balance sheet (D/E {debt_eq:.0f}) provides capacity for buybacks, dividends or acquisitions")
    if pe and pe > 40:
        T.append(f"Premium P/E of {pe:.1f}x leaves little room for earnings disappointment")
    elif pe and 0 < pe < 12:
        O.append(f"Attractive P/E of {pe:.1f}x offers a margin of safety relative to sector peers")

    # ── Technical ─────────────────────────────────────────────────────────
    if ma20 and ma50 and ma200 and price:
        if price > ma20 > ma50 > ma200:
            S.append(f"Textbook bullish MA alignment: ₹{price:.0f} > MA20 ₹{ma20:.0f} > MA50 ₹{ma50:.0f} > MA200 ₹{ma200:.0f}")
        elif price < ma20 < ma50 < ma200:
            W.append(f"Bearish MA cascade: ₹{price:.0f} < MA20 ₹{ma20:.0f} < MA50 ₹{ma50:.0f} < MA200 ₹{ma200:.0f}")
        elif price > ma200:
            S.append(f"Price ₹{price:.0f} remains above long-term MA200 ₹{ma200:.0f} — secular uptrend intact")
    if golden:
        O.append(f"Golden Cross (MA50 ₹{ma50:.0f} > MA200 ₹{ma200:.0f}) — historically the strongest long-term buy signal")
    if death:
        T.append(f"Death Cross (MA50 ₹{ma50:.0f} < MA200 ₹{ma200:.0f}) — sustained institutional selling likely")
    if rsi < 30:
        O.append(f"RSI {rsi:.0f} in oversold zone — potential mean-reversion bounce for patient buyers")
    elif rsi > 70:
        T.append(f"RSI {rsi:.0f} is overbought — short-term correction or consolidation is probable")
    if macd_bull:
        S.append("MACD bullish crossover confirms short-term upward momentum")
    else:
        W.append("MACD bearish — selling pressure has near-term momentum")
    if w52_chg and w52_chg > 25:
        S.append(f"52-week gain of {w52_chg:+.1f}% demonstrates sustained investor confidence")
    elif w52_chg and w52_chg < -25:
        T.append(f"52-week loss of {w52_chg:.1f}% signals prolonged underperformance and weak sentiment")
    if vol_ratio > 1.5:
        O.append(f"Volume {vol_ratio:.1f}x 20d average — high conviction participation in the recent move")

    # ── Holdings ──────────────────────────────────────────────────────────
    if pct_inst is not None:
        if pct_inst > 50:
            S.append(f"Strong institutional ownership of {pct_inst:.1f}% reflects high-conviction smart money interest")
        elif pct_inst > 30:
            S.append(f"Healthy {pct_inst:.1f}% institutional holding provides price support and research coverage")
        elif pct_inst < 10:
            W.append(f"Low institutional ownership ({pct_inst:.1f}%) limits research coverage and price discovery quality")
    if top_inst:
        O.append(f"Backed by marquee institutions including {', '.join(top_inst[:2])} — validates long-term thesis")
    if top_mf:
        S.append(f"Held by leading mutual funds ({top_mf[0]}) — SIP-driven steady buying provides downside support")
    if pct_ins and pct_ins > 30:
        S.append(f"Promoter/insider stake of {pct_ins:.1f}% signals strong management conviction in the business")
    elif pct_ins and pct_ins < 5:
        W.append(f"Low insider ownership ({pct_ins:.1f}%) may indicate limited management skin in the game")

    # ── Sector ────────────────────────────────────────────────────────────
    SOPP = {
        "Technology": "India's IT export tailwinds and AI adoption create a multi-year growth runway",
        "Healthcare": "Rising pharma exports and domestic healthcare spending underpin durable long-term demand",
        "Financial Services": "India's low credit penetration offers a structural multi-decade growth opportunity",
        "Energy": "India's energy transition fuels capex in renewables alongside traditional energy security needs",
        "Consumer Cyclical": "India's aspirational middle class and urbanisation drive a durable consumption upgrade cycle",
        "Consumer Defensive": "Recession-resistant FMCG business model provides stable cash flows through economic cycles",
        "Industrials": "India's record infrastructure capex supercycle supports multi-year order book growth",
        "Basic Materials": "Domestic construction boom and import substitution support metals and cement volumes",
    }
    STHR = {
        "Technology": "AI-driven commoditisation of IT services and visa headwinds threaten margin sustainability",
        "Healthcare": "USFDA import alerts and domestic price controls remain recurring earnings risks",
        "Financial Services": "Credit quality deterioration in a slowdown can rapidly compress NIM and book value",
        "Energy": "Global crude volatility and energy transition policy shifts create unpredictable earnings",
        "Consumer Cyclical": "Discretionary spending contracts sharply during any consumer confidence downturn",
    }
    if sector in SOPP and len(O) < 5:
        O.append(SOPP[sector])
    if sector in STHR and len(T) < 5:
        T.append(STHR[sector])
    if rec in ("buy", "strong_buy") and len(O) < 5:
        O.append(f"Analyst consensus '{rec.replace('_',' ').title()}' — street conviction supports near-term upside")
    elif rec in ("sell", "strong_sell") and len(T) < 5:
        T.append(f"Analyst consensus '{rec.replace('_',' ').title()}' — majority of sell-side sees downside risk")

    if not S: S.append(f"{name} is an established {sector} player with recognisable brand and market position")
    if not W: W.append("Competitive intensity demands continuous R&D and marketing spend to defend share")
    if not O: O.append("Strategic partnerships or new geographies could provide a valuation re-rating catalyst")
    if not T: T.append("Macro headwinds and INR volatility remain persistent background risks for all Indian equities")

    tech_stance = "bullish" if "bullish" in ma_bias else "bearish" if "bearish" in ma_bias else "mixed"
    fund_stance = "strong" if (profit_margin or 0) > 0.15 and (roe or 0) > 0.12 else "moderate" if (profit_margin or 0) > 0.05 else "weak"
    hold_line = (
        f" Institutions hold {pct_inst:.0f}% — smart money is {'overweight' if pct_inst > 40 else 'moderately positioned'}." if pct_inst else ""
    )
    summary = (
        f"{name} ({ticker}) has a {fund_stance} fundamental profile in the {sector} sector. "
        f"Technically {tech_stance}: {ma_bias}{', RSI ' + str(rsi) if tech else ''}"
        f"{'— Golden Cross adds conviction' if golden else '— Death Cross signals caution' if death else ''}. "
        f"{hold_line} "
        f"Overall stance is {'constructive — look for volume-confirmed breakout' if tech_stance == 'bullish' and fund_stance != 'weak' else 'cautious — wait for MA stabilisation before adding exposure'}."
    )

    return SWOTInsights(
        strengths=S[:5], weaknesses=W[:5], opportunities=O[:5], threats=T[:5],
        summary=summary.strip(),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ── AI callers ─────────────────────────────────────────────────────────────

async def call_gemini(ticker: str, context: str) -> SWOTInsights:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=os.getenv("GEMINI_API_KEY", ""), base_url=GEMINI_BASE_URL)
    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            messages=[
                {"role": "system", "content": "You are a senior equity research analyst. Respond with valid JSON only."},
                {"role": "user",   "content": build_swot_prompt(ticker, context)},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
        ),
        timeout=45.0,
    )
    raw = json.loads(resp.choices[0].message.content)
    return SWOTInsights(
        strengths=raw.get("strengths", []), weaknesses=raw.get("weaknesses", []),
        opportunities=raw.get("opportunities", []), threats=raw.get("threats", []),
        summary=raw.get("summary", ""),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


async def call_openai(ticker: str, context: str) -> SWOTInsights:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a senior equity research analyst. Respond with valid JSON only."},
                {"role": "user",   "content": build_swot_prompt(ticker, context)},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
        ),
        timeout=30.0,
    )
    raw = json.loads(resp.choices[0].message.content)
    return SWOTInsights(
        strengths=raw.get("strengths", []), weaknesses=raw.get("weaknesses", []),
        opportunities=raw.get("opportunities", []), threats=raw.get("threats", []),
        summary=raw.get("summary", ""),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ── Main endpoint ──────────────────────────────────────────────────────────

@router.post("/api/insights/{ticker}", response_model=InsightsResponse)
@limiter.limit("10/minute")
async def generate_insights(ticker: str, request: Request):
    ticker = validate_ticker(ticker)
    cached = cache.get(f"insights:{ticker}")
    if cached:
        return cached

    try:
        info, news_items, tech, holdings = await asyncio.gather(
            yfc.fetch_info(ticker),
            yfc.fetch_news(ticker),
            _get_technicals(ticker),
            _get_holdings_context(ticker),
            return_exceptions=True,
        )
        if isinstance(info, Exception) or not info:
            raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")
        news_items = [] if isinstance(news_items, Exception) else (news_items or [])
        tech       = {} if isinstance(tech,       Exception) else (tech or {})
        holdings   = {} if isinstance(holdings,   Exception) else (holdings or {})
        headlines  = [
            i.get("title", "") or i.get("content", {}).get("title", "")
            for i in news_items[:10] if i
        ]
        headlines = [h for h in headlines if h]
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Data provider unavailable")

    context = format_prompt_context(ticker, info, headlines, tech, holdings)

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    insights: SWOTInsights | None = None

    if gemini_key and gemini_key.startswith("sk-"):
        try:
            insights = await call_gemini(ticker, context)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="AI analysis timed out — try again")
        except Exception as e:
            print(f"[insights] Gemini error: {e}")

    if insights is None and openai_key and openai_key.startswith("sk-"):
        try:
            insights = await call_openai(ticker, context)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="AI analysis timed out — try again")
        except Exception as e:
            print(f"[insights] OpenAI error: {e}")

    if insights is None:
        insights = generate_fallback_swot(ticker, info, tech, holdings)

    result = InsightsResponse(ticker=ticker, insights=insights)
    cache.set(f"insights:{ticker}", result, ttl=3600)
    return result
