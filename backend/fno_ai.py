"""
fno_ai.py — GenAI option-strategy suggestions for the FnO desk.

Mirrors routers/insights.py's provider chain (Gemini → Groq → OpenAI →
deterministic template) but prompts an F&O derivatives persona with the
positioning snapshot from fno_analysis. Suggestions are informational —
the UI carries the not-advice disclaimer.
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

_PLACEHOLDER_KEYS = {"", "your-key", "your_api_key", "sk-...", "none", "set-yours"}


def _usable(key: str) -> bool:
    return key.strip().lower() not in _PLACEHOLDER_KEYS


@dataclass
class FnoTrade:
    action: str            # BUY | SELL
    option: str            # CE | PE
    strike: float | str
    rationale: str
    risk: str = ""
    invalidation: str = ""
    target: str = ""
    horizon: str = ""


@dataclass
class FnoSuggestion:
    bias: str              # Bullish | Bearish | Neutral
    confidence_pct: int
    trades: list[FnoTrade] = field(default_factory=list)
    summary: str = ""
    provider: str = ""
    generated_at: str = ""


SYSTEM_PROMPT = (
    "You are a professional NSE F&O derivatives strategist. You read option-chain "
    "positioning (PCR, max pain, OI buildup, support/resistance) and suggest "
    "option trades. Respond with valid JSON only. Be decisive but honest about "
    "risk — never invent data that isn't in the snapshot."
)


def _snapshot_prompt(underlying: str, expiry: str, analysis: dict,
                     chain: dict, risk_profile: str) -> str:
    compact = {
        "underlying": underlying,
        "expiry": expiry,
        "reference_spot": chain.get("spot_est"),   # ATM strike when exact spot unavailable
        "lot_size": chain.get("lot_size"),
        "pcr_oi": analysis.get("pcr_oi"),
        "total_ce_oi": analysis.get("total_ce_oi"),
        "total_pe_oi": analysis.get("total_pe_oi"),
        "ce_oi_change": analysis.get("total_ce_oi_change"),
        "pe_oi_change": analysis.get("total_pe_oi_change"),
        "max_pain": analysis.get("max_pain"),
        "supports": analysis.get("supports"),
        "resistances": analysis.get("resistances"),
        "call_buildup": analysis.get("call_buildup"),
        "put_buildup": analysis.get("put_buildup"),
        "sentiment": analysis.get("sentiment"),
        "sentiment_score": analysis.get("sentiment_score"),
        "analyst_notes": analysis.get("notes"),
    }
    # top-OI strikes give the model a feel for the chain shape
    rows = []
    for r in (chain.get("strikes") or []):
        ce, pe = r.get("ce"), r.get("pe")
        if (ce and ce.get("oi")) or (pe and pe.get("oi")):
            rows.append({
                "strike": r["strike"],
                "ce_oi": ce.get("oi") if ce else None,
                "ce_oi_chg": ce.get("oi_change") if ce else None,
                "ce_ltp": ce.get("ltp") if ce else None,
                "pe_oi": pe.get("oi") if pe else None,
                "pe_oi_chg": pe.get("oi_change") if pe else None,
                "pe_ltp": pe.get("ltp") if pe else None,
            })
    rows.sort(key=lambda x: abs((x["strike"] or 0) - (chain.get("spot_est") or x["strike"] or 0)))
    compact["chain_top_oi_strikes"] = rows[:12]

    return (
        f"Option-chain positioning snapshot for {underlying} expiring {expiry} "
        f"(risk profile: {risk_profile}):\n\n{json.dumps(compact, ensure_ascii=False)}\n\n"
        "Suggest 1-3 option trades for this expiry. Ground every rationale in the "
        "snapshot above (quote concrete OI/PCR/max-pain numbers). Prefer liquid "
        "strikes near ATM. Each trade needs: action (BUY or SELL), option (CE or PE), "
        "strike, rationale, risk, invalidation (what kills the view), target, horizon.\n\n"
        "Return JSON exactly like: "
        '{"bias": "Bullish|Bearish|Neutral", "confidence_pct": 0-100, '
        '"trades": [{"action": "...", "option": "CE|PE", "strike": 0, "rationale": "...", '
        '"risk": "...", "invalidation": "...", "target": "...", "horizon": "..."}], '
        '"summary": "one-paragraph read of the positioning"}'
    )


def _parse(raw_json: str, provider: str) -> FnoSuggestion:
    data = json.loads(raw_json)
    trades = []
    for t in (data.get("trades") or [])[:3]:
        trades.append(FnoTrade(
            action=str(t.get("action", "BUY")).upper(),
            option=str(t.get("option", "CE")).upper(),
            strike=t.get("strike", "ATM"),
            rationale=str(t.get("rationale", "")),
            risk=str(t.get("risk", "")),
            invalidation=str(t.get("invalidation", "")),
            target=str(t.get("target", "")),
            horizon=str(t.get("horizon", "")),
        ))
    return FnoSuggestion(
        bias=str(data.get("bias", "Neutral")),
        confidence_pct=int(data.get("confidence_pct") or 50),
        trades=trades,
        summary=str(data.get("summary", "")),
        provider=provider,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


async def _call(provider: str, prompt: str) -> FnoSuggestion:
    from openai import AsyncOpenAI
    if provider == "groq":
        client = AsyncOpenAI(api_key=os.getenv("GROQ_API_KEY", ""), base_url=GROQ_BASE_URL)
        model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
        timeout = 45.0
    elif provider == "gemini":
        client = AsyncOpenAI(api_key=os.getenv("GEMINI_API_KEY", ""), base_url=GEMINI_BASE_URL)
        model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        timeout = 45.0
    else:
        client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
        model = "gpt-4o-mini"
        timeout = 45.0
    resp = await asyncio.wait_for(
        client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
        ),
        timeout=timeout,
    )
    return _parse(resp.choices[0].message.content, provider)


def fallback_suggestion(analysis: dict, chain: dict) -> FnoSuggestion:
    """Deterministic suggestion when no AI provider is available — driven
    purely by the positioning score."""
    score = analysis.get("sentiment_score") or 0
    atm = analysis.get("atm") or chain.get("spot_est") or "ATM"
    sup = (analysis.get("supports") or [{}])[0].get("strike")
    res = (analysis.get("resistances") or [{}])[0].get("strike")
    bias = "Bullish" if score >= 20 else "Bearish" if score <= -20 else "Neutral"
    conf = min(80, 40 + abs(score) // 3)

    if score >= 20:
        trade = FnoTrade(
            action="BUY", option="CE", strike=atm,
            rationale=f"Positioning is bullish (score {score}): "
                      f"PCR {analysis.get('pcr_oi')}, put writing at {sup}, {analysis.get('put_buildup') or 'put-side supportive'}.",
            risk="Premium decay if the underlying stalls below resistance.",
            invalidation=f"Break below support {sup}",
            target=str(res) if res else "next resistance",
            horizon="this expiry week",
        )
    elif score <= -20:
        trade = FnoTrade(
            action="BUY", option="PE", strike=atm,
            rationale=f"Positioning is bearish (score {score}): "
                      f"PCR {analysis.get('pcr_oi')}, call writing at {res}, {analysis.get('call_buildup') or 'call-side pressure'}.",
            risk="Snapback rally toward max pain.",
            invalidation=f"Break above resistance {res}",
            target=str(sup) if sup else "next support",
            horizon="this expiry week",
        )
    else:
        trade = FnoTrade(
            action="SELL", option="CE", strike=res if res else atm,
            rationale=f"Neutral positioning (score {score}) with max pain at {analysis.get('max_pain')} — "
                      "writers usually dominate the range into expiry.",
            risk="Directional breakout away from max pain.",
            invalidation="Sustained move above resistance with OI unwinding",
            target="max pain",
            horizon="into expiry",
        )
    return FnoSuggestion(
        bias=bias, confidence_pct=conf, trades=[trade],
        summary=" ".join(analysis.get("notes") or []) or "Positioning-driven suggestion.",
        provider="template",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


async def suggest(underlying: str, expiry: str, analysis: dict,
                  chain: dict, risk_profile: str = "balanced") -> FnoSuggestion:
    """Provider chain: Groq → Gemini → OpenAI → deterministic template."""
    prompt = _snapshot_prompt(underlying, expiry, analysis, chain, risk_profile)
    providers = []
    if _usable(os.getenv("GROQ_API_KEY", "")):
        providers.append("groq")
    if _usable(os.getenv("GEMINI_API_KEY", "")):
        providers.append("gemini")
    if _usable(os.getenv("OPENAI_API_KEY", "")):
        providers.append("openai")

    for p in providers:
        try:
            return await _call(p, prompt)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("[fno-ai] %s failed: %s", p, e)
    return fallback_suggestion(analysis, chain)


def to_dict(s: FnoSuggestion) -> dict:
    return asdict(s)
