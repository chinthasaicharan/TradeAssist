"""
chat.py -- conversational stock Q&A endpoint
POST /api/chat/{ticker}
Body: { "messages": [{"role": "user"|"assistant", "content": "..."}], "question": "..." }
"""
import os
import re
import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel
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


def _safe_pct(val) -> float | None:
    try:
        v = float(str(val).replace("%", "").strip())
        v = v * 100 if v <= 1.0 else v
        return round(max(0.0, min(100.0, v)), 2)
    except Exception:
        return None


# ── Request / Response models ──────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str      # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str
    messages: list[ChatMessage] = []   # prior conversation turns


class ChatResponse(BaseModel):
    answer: str
    ticker: str
    generated_at: str


# ── Technical helpers (inline, same as insights.py) ───────────────────────

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


# ── Data gathering ─────────────────────────────────────────────────────────

async def _gather_stock_context(ticker: str) -> dict:
    """Fetch info + technicals + holdings and return a unified context dict."""
    cache_key = f"chat_ctx:{ticker}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    try:
        info_task  = yfc.fetch_info(ticker)
        hist_task  = yfc.fetch_history(ticker, period="1y", interval="1d")
        hold_task  = yfc.fetch_holdings(ticker)
        news_task  = yfc.fetch_news(ticker)

        info, hist, holdings_raw, news_items = await asyncio.gather(
            info_task, hist_task, hold_task, news_task,
            return_exceptions=True,
        )
    except Exception:
        return {}

    ctx: dict = {}

    # ── Fundamentals from info ─────────────────────────────────────────────
    if not isinstance(info, Exception) and info:
        ctx["name"]          = info.get("longName") or info.get("shortName") or ticker
        ctx["sector"]        = info.get("sector", "N/A")
        ctx["industry"]      = info.get("industry", "N/A")
        ctx["price"]         = safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        ctx["pe"]            = safe_float(info.get("trailingPE"))
        ctx["forward_pe"]    = safe_float(info.get("forwardPE"))
        ctx["eps"]           = safe_float(info.get("trailingEps"))
        ctx["market_cap"]    = info.get("marketCap")
        ctx["beta"]          = safe_float(info.get("beta"))
        ctx["div_yield"]     = safe_float(info.get("dividendYield"))
        ctx["roe"]           = safe_float(info.get("returnOnEquity"))
        ctx["roa"]           = safe_float(info.get("returnOnAssets"))
        ctx["debt_eq"]       = safe_float(info.get("debtToEquity"))
        ctx["profit_margin"] = safe_float(info.get("profitMargins"))
        ctx["gross_margin"]  = safe_float(info.get("grossMargins"))
        ctx["op_margin"]     = safe_float(info.get("operatingMargins"))
        ctx["rev_growth"]    = safe_float(info.get("revenueGrowth"))
        ctx["earn_growth"]   = safe_float(info.get("earningsGrowth"))
        ctx["week52_high"]   = safe_float(info.get("fiftyTwoWeekHigh"))
        ctx["week52_low"]    = safe_float(info.get("fiftyTwoWeekLow"))
        ctx["fcf"]           = safe_float(info.get("freeCashflow"))
        ctx["pb"]            = safe_float(info.get("priceToBook"))
        ctx["peg"]           = safe_float(info.get("pegRatio"))
        ctx["ev_ebitda"]     = safe_float(info.get("enterpriseToEbitda"))
        ctx["analyst_target"]= safe_float(info.get("targetMeanPrice"))
        ctx["analyst_rec"]   = info.get("recommendationKey", "")
        ctx["description"]   = info.get("longBusinessSummary", "")
        ctx["currency"]      = info.get("currency", "INR")
        ctx["exchange"]      = info.get("exchange", "NSE")

    # ── Technicals from price history ─────────────────────────────────────
    if not isinstance(hist, Exception) and hist is not None and not hist.empty:
        closes  = hist["Close"].tolist()
        volumes = hist["Volume"].tolist()
        price   = closes[-1]
        ma20  = _sma(closes, 20)
        ma50  = _sma(closes, 50)
        ma200 = _sma(closes, 200)
        rsi   = _rsi(closes)
        macd_v, macd_s = _macd(closes)
        avg_vol = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
        vol_ratio = round(volumes[-1] / avg_vol, 2) if avg_vol > 0 else 1.0
        w52_chg = round((closes[-1] - closes[-252]) / closes[-252] * 100, 1) if len(closes) >= 252 else None

        above = sum(1 for ma in [ma20, ma50, ma200] if ma and price > ma)
        ma_bias = (
            "strongly bullish (above all 3 MAs)" if above == 3 else
            "moderately bullish (above 2 of 3 MAs)" if above == 2 else
            "mildly bearish (above 1 of 3 MAs)" if above == 1 else
            "strongly bearish (below all 3 MAs)"
        )
        ctx.update({
            "tech_price": round(price, 2), "ma20": ma20, "ma50": ma50, "ma200": ma200,
            "rsi": rsi, "macd": macd_v, "macd_signal": macd_s,
            "vol_ratio": vol_ratio, "w52_chg": w52_chg, "ma_bias": ma_bias,
            "golden_cross": bool(ma50 and ma200 and ma50 > ma200),
            "death_cross":  bool(ma50 and ma200 and ma50 < ma200),
            "macd_bull":    macd_v > macd_s,
            "support":      round(min(closes[-20:]), 2),
            "resistance":   round(max(closes[-20:]), 2),
        })

    # ── Holdings ──────────────────────────────────────────────────────────
    if not isinstance(holdings_raw, Exception) and holdings_raw:
        mh_df = holdings_raw.get("major")
        pct_inst = pct_insider = None
        if mh_df is not None and not mh_df.empty:
            try:
                if "Value" in mh_df.columns:
                    for key, row in mh_df.iterrows():
                        k = str(key)
                        if "institutionsPercentHeld" in k:
                            pct_inst = _safe_pct(row["Value"])
                        elif "insidersPercentHeld" in k:
                            pct_insider = _safe_pct(row["Value"])
            except Exception:
                pass
        if pct_inst is None and not isinstance(info, Exception) and info:
            pct_inst = _safe_pct(info.get("heldPercentInstitutions"))
        if pct_insider is None and not isinstance(info, Exception) and info:
            pct_insider = _safe_pct(info.get("heldPercentInsiders"))
        ctx["pct_inst"]    = pct_inst
        ctx["pct_insider"] = pct_insider

    # ── News headlines ─────────────────────────────────────────────────────
    if not isinstance(news_items, Exception) and news_items:
        ctx["headlines"] = [
            i.get("title", "") or i.get("content", {}).get("title", "")
            for i in news_items[:6] if i
        ]
        ctx["headlines"] = [h for h in ctx["headlines"] if h]

    cache.set(cache_key, ctx, ttl=900)   # 15 min cache
    return ctx


# ── System prompt builder ──────────────────────────────────────────────────

def _build_system_prompt(ticker: str, ctx: dict) -> str:
    sym  = ctx.get("currency", "INR") == "INR" and "Rs." or "$"
    name = ctx.get("name", ticker)
    parts = [
        f"You are TradeAssist AI, a sharp and concise Indian equity research assistant.",
        f"The user is asking about {ticker} ({name}).",
        f"Answer in plain, direct language. Use bullet points for lists. Keep responses under 200 words unless the user asks for detail.",
        f"Always cite specific numbers when available. Never give generic advice — anchor every claim to the actual data below.",
        f"Add a brief disclaimer at the end of prediction/buy-sell answers: 'This is not financial advice.'",
        f"\n--- STOCK DATA FOR {ticker} ---",
    ]

    if ctx.get("price"):
        parts.append(f"Current Price: Rs.{ctx['price']}")
    if ctx.get("sector"):
        parts.append(f"Sector: {ctx['sector']} | Industry: {ctx.get('industry', 'N/A')}")

    # Fundamentals
    fund_lines = []
    if ctx.get("pe"):        fund_lines.append(f"P/E: {ctx['pe']:.1f}x")
    if ctx.get("forward_pe"):fund_lines.append(f"Forward P/E: {ctx['forward_pe']:.1f}x")
    if ctx.get("eps"):       fund_lines.append(f"EPS: {ctx['eps']:.2f}")
    if ctx.get("pb"):        fund_lines.append(f"P/B: {ctx['pb']:.2f}x")
    if ctx.get("peg"):       fund_lines.append(f"PEG: {ctx['peg']:.2f}")
    if ctx.get("ev_ebitda"): fund_lines.append(f"EV/EBITDA: {ctx['ev_ebitda']:.1f}x")
    if ctx.get("market_cap"):fund_lines.append(f"Market Cap: Rs.{ctx['market_cap']/1e9:.0f}B")
    if ctx.get("beta"):      fund_lines.append(f"Beta: {ctx['beta']:.2f}")
    if fund_lines:
        parts.append("Valuation: " + " | ".join(fund_lines))

    margin_lines = []
    if ctx.get("profit_margin"): margin_lines.append(f"Net Margin: {ctx['profit_margin']*100:.1f}%")
    if ctx.get("gross_margin"):  margin_lines.append(f"Gross Margin: {ctx['gross_margin']*100:.1f}%")
    if ctx.get("op_margin"):     margin_lines.append(f"Op Margin: {ctx['op_margin']*100:.1f}%")
    if ctx.get("roe"):           margin_lines.append(f"ROE: {ctx['roe']*100:.1f}%")
    if ctx.get("debt_eq"):       margin_lines.append(f"D/E: {ctx['debt_eq']:.1f}x")
    if ctx.get("rev_growth"):    margin_lines.append(f"Rev Growth: {ctx['rev_growth']*100:.1f}%")
    if margin_lines:
        parts.append("Profitability: " + " | ".join(margin_lines))

    if ctx.get("week52_high") and ctx.get("week52_low"):
        parts.append(f"52W Range: Rs.{ctx['week52_low']} - Rs.{ctx['week52_high']}")
    if ctx.get("div_yield"):
        parts.append(f"Dividend Yield: {ctx['div_yield']*100:.2f}%")
    if ctx.get("fcf"):
        parts.append(f"Free Cash Flow: Rs.{ctx['fcf']/1e9:.1f}B")

    # Technical
    if ctx.get("ma20") or ctx.get("rsi"):
        tech_lines = []
        if ctx.get("ma20"):  tech_lines.append(f"MA20: Rs.{ctx['ma20']}")
        if ctx.get("ma50"):  tech_lines.append(f"MA50: Rs.{ctx['ma50']}")
        if ctx.get("ma200"): tech_lines.append(f"MA200: Rs.{ctx['ma200']}")
        if ctx.get("rsi"):   tech_lines.append(f"RSI: {ctx['rsi']:.1f}")
        if ctx.get("support"):    tech_lines.append(f"20d Support: Rs.{ctx['support']}")
        if ctx.get("resistance"): tech_lines.append(f"20d Resistance: Rs.{ctx['resistance']}")
        parts.append("Technical: " + " | ".join(tech_lines))
        parts.append(f"MA Bias: {ctx.get('ma_bias', 'N/A')}")
        if ctx.get("golden_cross"): parts.append("Signal: GOLDEN CROSS active (bullish)")
        if ctx.get("death_cross"):  parts.append("Signal: DEATH CROSS active (bearish)")
        if ctx.get("macd_bull") is not None:
            parts.append(f"MACD: {'bullish crossover' if ctx['macd_bull'] else 'bearish crossover'}")
        if ctx.get("vol_ratio"):    parts.append(f"Volume vs 20d avg: {ctx['vol_ratio']:.2f}x")
        if ctx.get("w52_chg") is not None: parts.append(f"52W Return: {ctx['w52_chg']:+.1f}%")

    # Holdings
    if ctx.get("pct_inst") is not None:
        parts.append(f"Institutional ownership: {ctx['pct_inst']:.1f}%")
    if ctx.get("pct_insider") is not None:
        parts.append(f"Promoter/Insider ownership: {ctx['pct_insider']:.1f}%")

    # Analyst
    if ctx.get("analyst_target"):
        parts.append(f"Analyst consensus target: Rs.{ctx['analyst_target']:.0f} | Rating: {ctx.get('analyst_rec', 'N/A')}")

    # News
    if ctx.get("headlines"):
        parts.append("Recent news:")
        for h in ctx["headlines"][:5]:
            parts.append(f"  - {h}")

    if ctx.get("description"):
        parts.append(f"\nBusiness: {ctx['description'][:400]}")

    return "\n".join(parts)


# ── Rule-based fallback answerer ───────────────────────────────────────────

def _rule_based_answer(question: str, ticker: str, ctx: dict) -> str:
    q = question.lower()
    name = ctx.get("name", ticker)

    # Price
    if any(w in q for w in ["price", "trading at", "current", "rate", "value now"]):
        p = ctx.get("price") or ctx.get("tech_price")
        if p:
            chg = ""
            if ctx.get("w52_chg") is not None:
                chg = f" (52W return: {ctx['w52_chg']:+.1f}%)"
            hi = ctx.get("week52_high"); lo = ctx.get("week52_low")
            range_str = f" | 52W range: Rs.{lo} - Rs.{hi}" if hi and lo else ""
            return f"{name} is currently trading at **Rs.{p}**{range_str}{chg}."
        return f"Price data unavailable for {ticker} right now."

    # P/E / valuation
    if any(w in q for w in ["p/e", "pe ratio", "price to earnings", "valuation", "overvalued", "undervalued", "fair value", "peg", "p/b", "price to book"]):
        lines = [f"**Valuation snapshot for {name}:**"]
        if ctx.get("pe"):         lines.append(f"- Trailing P/E: {ctx['pe']:.1f}x")
        if ctx.get("forward_pe"): lines.append(f"- Forward P/E: {ctx['forward_pe']:.1f}x")
        if ctx.get("pb"):         lines.append(f"- P/B: {ctx['pb']:.2f}x")
        if ctx.get("peg"):        lines.append(f"- PEG ratio: {ctx['peg']:.2f} ({'attractive' if ctx['peg'] < 1 else 'stretched' if ctx['peg'] > 2.5 else 'moderate'})")
        if ctx.get("ev_ebitda"):  lines.append(f"- EV/EBITDA: {ctx['ev_ebitda']:.1f}x")
        if ctx.get("analyst_target"): lines.append(f"- Analyst target: Rs.{ctx['analyst_target']:.0f}")
        if len(lines) == 1:
            return f"Valuation data not available for {ticker}."
        return "\n".join(lines)

    # RSI / technical
    if any(w in q for w in ["rsi", "overbought", "oversold", "technical", "ma ", "moving average", "support", "resistance", "macd", "golden cross", "death cross"]):
        rsi = ctx.get("rsi")
        lines = [f"**Technical analysis for {name}:**"]
        if ctx.get("ma20"):  lines.append(f"- MA20: Rs.{ctx['ma20']}")
        if ctx.get("ma50"):  lines.append(f"- MA50: Rs.{ctx['ma50']}")
        if ctx.get("ma200"): lines.append(f"- MA200: Rs.{ctx['ma200']}")
        if rsi:
            rsi_lbl = "oversold - potential bounce" if rsi < 30 else "overbought - caution" if rsi > 70 else "neutral zone"
            lines.append(f"- RSI (14): {rsi:.1f} ({rsi_lbl})")
        if ctx.get("support"):    lines.append(f"- 20d Support: Rs.{ctx['support']}")
        if ctx.get("resistance"): lines.append(f"- 20d Resistance: Rs.{ctx['resistance']}")
        if ctx.get("golden_cross"): lines.append("- **Golden Cross active** - bullish long-term signal")
        if ctx.get("death_cross"):  lines.append("- **Death Cross active** - bearish long-term signal")
        if ctx.get("macd_bull") is not None:
            lines.append(f"- MACD: {'bullish crossover' if ctx['macd_bull'] else 'bearish crossover'}")
        if ctx.get("ma_bias"): lines.append(f"- Overall bias: {ctx['ma_bias']}")
        if len(lines) == 1:
            return f"Technical data unavailable for {ticker}."
        return "\n".join(lines)

    # Holdings / institutional
    if any(w in q for w in ["holding", "institutional", "fii", "dii", "promoter", "insider", "mutual fund", "ownership"]):
        lines = [f"**Ownership breakdown for {name}:**"]
        if ctx.get("pct_inst") is not None:    lines.append(f"- Institutional (FII+DII): {ctx['pct_inst']:.1f}%")
        if ctx.get("pct_insider") is not None: lines.append(f"- Promoter/Insider: {ctx['pct_insider']:.1f}%")
        if ctx.get("pct_inst") and ctx.get("pct_insider"):
            retail = max(0, 100 - ctx["pct_inst"] - ctx["pct_insider"])
            lines.append(f"- Public/Retail float: ~{retail:.1f}%")
        if len(lines) == 1:
            return f"Holdings data not available for {ticker} via Yahoo Finance."
        return "\n".join(lines)

    # ROE / profitability / margins
    if any(w in q for w in ["roe", "return on equity", "profitability", "margin", "profit", "roa", "return on asset"]):
        lines = [f"**Profitability metrics for {name}:**"]
        if ctx.get("profit_margin"): lines.append(f"- Net Profit Margin: {ctx['profit_margin']*100:.1f}%")
        if ctx.get("gross_margin"):  lines.append(f"- Gross Margin: {ctx['gross_margin']*100:.1f}%")
        if ctx.get("op_margin"):     lines.append(f"- Operating Margin: {ctx['op_margin']*100:.1f}%")
        if ctx.get("roe"):           lines.append(f"- ROE: {ctx['roe']*100:.1f}%")
        if ctx.get("roa"):           lines.append(f"- ROA: {ctx['roa']*100:.1f}%")
        if ctx.get("debt_eq"):       lines.append(f"- Debt/Equity: {ctx['debt_eq']:.1f}x")
        if len(lines) == 1:
            return f"Profitability data not available for {ticker}."
        return "\n".join(lines)

    # Growth
    if any(w in q for w in ["growth", "revenue", "earnings", "sales"]):
        lines = [f"**Growth metrics for {name}:**"]
        if ctx.get("rev_growth"):  lines.append(f"- Revenue Growth YoY: {ctx['rev_growth']*100:.1f}%")
        if ctx.get("earn_growth"): lines.append(f"- Earnings Growth YoY: {ctx['earn_growth']*100:.1f}%")
        if ctx.get("eps"):         lines.append(f"- EPS (TTM): Rs.{ctx['eps']:.2f}")
        if ctx.get("fcf"):         lines.append(f"- Free Cash Flow: Rs.{ctx['fcf']/1e9:.1f}B")
        if len(lines) == 1:
            return f"Growth data not available for {ticker}."
        return "\n".join(lines)

    # Buy/sell/invest prediction
    if any(w in q for w in ["buy", "sell", "invest", "should i", "recommend", "prediction", "target", "outlook", "forecast"]):
        rec = ctx.get("analyst_rec", "").replace("_", " ").title()
        target = ctx.get("analyst_target")
        price = ctx.get("price")
        ma_bias = ctx.get("ma_bias", "")
        rsi = ctx.get("rsi", 50)
        lines = [f"**Quick assessment for {name}:**"]
        if rec:       lines.append(f"- Analyst consensus: {rec}")
        if target and price:
            upside = (target - price) / price * 100
            lines.append(f"- Analyst target: Rs.{target:.0f} ({upside:+.1f}% from current Rs.{price})")
        if ma_bias:   lines.append(f"- Technical posture: {ma_bias}")
        rsi_lbl = "oversold (potential entry)" if rsi < 35 else "overbought (wait for pullback)" if rsi > 70 else f"neutral at {rsi:.0f}"
        lines.append(f"- RSI: {rsi_lbl}")
        if ctx.get("golden_cross"): lines.append("- Golden Cross active: long-term uptrend signal")
        if ctx.get("death_cross"):  lines.append("- Death Cross active: bearish medium-term signal")
        lines.append("\n*This is not financial advice. Do your own research before investing.*")
        return "\n".join(lines)

    # About / description
    if any(w in q for w in ["what is", "about", "business", "company", "describe", "sector", "industry"]):
        desc = ctx.get("description", "")
        sector = ctx.get("sector", "N/A")
        industry = ctx.get("industry", "N/A")
        cap = ctx.get("market_cap")
        cap_str = f" | Market Cap: Rs.{cap/1e9:.0f}B" if cap else ""
        intro = f"**{name} ({ticker})** — {sector} / {industry}{cap_str}"
        if desc:
            return f"{intro}\n\n{desc[:500]}{'...' if len(desc) > 500 else ''}"
        return intro

    # News
    if any(w in q for w in ["news", "headline", "latest", "recent", "update"]):
        headlines = ctx.get("headlines", [])
        if headlines:
            return f"**Recent news for {name}:**\n" + "\n".join(f"- {h}" for h in headlines)
        return f"No recent news found for {ticker}."

    # Generic fallback
    return (
        f"I have data on {name} ({ticker}) including price (Rs.{ctx.get('price', 'N/A')}), "
        f"P/E ({ctx.get('pe', 'N/A')}), RSI ({ctx.get('rsi', 'N/A')}), "
        f"and technical signals. Try asking about: price, valuation, technicals, holdings, profitability, growth, or buy/sell recommendation."
    )


# ── AI chat callers ────────────────────────────────────────────────────────

async def _call_ai(system_prompt: str, messages: list[ChatMessage], question: str) -> str | None:
    from openai import AsyncOpenAI

    history = [{"role": m.role, "content": m.content} for m in messages[-8:]]
    history.append({"role": "user", "content": question})

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    # Try Gemini first
    if gemini_key and gemini_key.startswith("sk-"):
        try:
            client = AsyncOpenAI(api_key=gemini_key, base_url=GEMINI_BASE_URL)
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
                    messages=[{"role": "system", "content": system_prompt}] + history,
                    temperature=0.5,
                    max_tokens=600,
                ),
                timeout=30.0,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[chat] Gemini error: {e}")

    # Try OpenAI
    if openai_key and openai_key.startswith("sk-"):
        try:
            client = AsyncOpenAI(api_key=openai_key)
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "system", "content": system_prompt}] + history,
                    temperature=0.5,
                    max_tokens=600,
                ),
                timeout=25.0,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[chat] OpenAI error: {e}")

    return None


# ── Main chat endpoint ─────────────────────────────────────────────────────

@router.post("/api/chat/{ticker}", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(ticker: str, body: ChatRequest, request: Request):
    ticker = validate_ticker(ticker)

    if not body.question or not body.question.strip():
        raise HTTPException(status_code=422, detail="Question cannot be empty")

    question = body.question.strip()[:500]   # cap input length

    # Gather stock context (cached 15 min)
    ctx = await _gather_stock_context(ticker)
    if not ctx:
        raise HTTPException(status_code=404, detail=f"No data found for {ticker}. Use NSE format e.g. RELIANCE.NS")

    system_prompt = _build_system_prompt(ticker, ctx)

    # Try AI first; fall back to rule-based
    answer = await _call_ai(system_prompt, body.messages, question)
    if not answer:
        answer = _rule_based_answer(question, ticker, ctx)

    return ChatResponse(
        answer=answer,
        ticker=ticker,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
