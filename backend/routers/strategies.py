"""
/api/strategies  — CRUD for Pine Script strategies + custom condition engine.

Strategies come in two flavours:
  • rule-based  — conditions JSON stored; Pine script auto-generated on save;
                  can be evaluated against a ticker or scanned across a universe
  • raw Pine    — user-authored script, conditions = []

No login required: logged-out users share the 'anon' bucket; logged-in users
see only their own strategies (built-ins are always visible).
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator

import cache
from database import get_conn
from routers.auth import get_optional_user
from strategy_engine import (
    INDICATORS,
    evaluate_conditions,
    generate_pine,
    validate_condition,
)
from sector_map import get_sector_for

router = APIRouter()

ANON_USER = "anon"


class ConditionIn(BaseModel):
    indicator: str
    operator: str
    value: float | str

    @model_validator(mode="after")
    def check_rule(self):
        err = validate_condition(self.model_dump())
        if err:
            raise ValueError(err)
        return self


class StrategyIn(BaseModel):
    name:        str
    description: str = ""
    script:      str = ""
    conditions:  list[ConditionIn] = []

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Strategy name cannot be empty")
        if len(v) > 100:
            raise ValueError("Strategy name must be ≤ 100 characters")
        return v

    @model_validator(mode="after")
    def check_body(self):
        if len(self.conditions) > 12:
            raise ValueError("A strategy can have at most 12 conditions")
        if not self.conditions and not self.script.strip():
            raise ValueError("Script cannot be empty")
        return self


class StrategyOut(BaseModel):
    id:          str
    name:        str
    description: str
    script:      str
    conditions:  list[dict]
    is_builtin:  bool
    created_at:  str
    updated_at:  str


class EvalIn(BaseModel):
    ticker: str


class ScanIn(BaseModel):
    tickers: list[str] = []


def _row(row) -> StrategyOut:
    try:
        conditions = json.loads(row["conditions"] or "[]")
    except Exception:
        conditions = []
    return StrategyOut(
        id=row["id"], name=row["name"], description=row["description"],
        script=row["script"], conditions=conditions,
        is_builtin=bool(row["is_builtin"]),
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


def _finalize(body: StrategyIn) -> tuple[str, str]:
    """Returns (script, conditions_json). Rule-based → generated Pine."""
    if body.conditions:
        script = generate_pine(body.name, body.description,
                               [c.model_dump() for c in body.conditions])
        conds_json = json.dumps([c.model_dump() for c in body.conditions])
    else:
        script, conds_json = body.script, "[]"
    return script, conds_json


def _get_strategy(strategy_id: str, uid: str):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM pine_strategies WHERE id=? AND user_id=?", (strategy_id, uid)
        ).fetchone()


FIBO_SUPERTREND_SCRIPT = '''//@version=6
strategy("Fib + Supertrend | 1:3 RR", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10)
fibLookback = input.int(50, "Fib Lookback Bars", minval=10)
stLength    = input.int(10, "Supertrend ATR Len", minval=1)
stMult      = input.float(3.0, "Supertrend Mult", minval=0.5, step=0.1)
rrRatio     = input.float(3.0, "Reward : Risk",   minval=1.0, step=0.5)
[stLine, stDir] = ta.supertrend(stMult, stLength)
stBull = stDir < 0
swingHigh = ta.highest(high, fibLookback)
swingLow  = ta.lowest(low,  fibLookback)
fibRange  = swingHigh - swingLow
fib382 = swingLow + fibRange * 0.382
fib618 = swingLow + fibRange * 0.618
plot(swingLow,  "Fib 0%",    color=color.new(color.gray, 60))
plot(fib382,    "Fib 38.2%", color=color.new(color.orange, 40), linewidth=2)
plot(fib618,    "Fib 61.8%", color=color.new(color.lime,   40), linewidth=2)
plot(swingHigh, "Fib 100%",  color=color.new(color.gray, 60))
bgcolor(close >= fib382 and close <= fib618 ? color.new(color.lime, 92) : na)
atr = ta.atr(14)
longCond  = stBull     and close >= fib382 and close <= fib618 and ta.crossover(close, stLine)
shortCond = not stBull and close >= fib382 and close <= fib618 and ta.crossunder(close, stLine)
if longCond
    sl = math.min(swingLow, close - atr)
    tp = close + (close - sl) * rrRatio
    strategy.entry("Long", strategy.long)
    strategy.exit("Long X", "Long", limit=tp, stop=sl)
if shortCond
    sl = math.max(swingHigh, close + atr)
    tp = close - (sl - close) * rrRatio
    strategy.entry("Short", strategy.short)
    strategy.exit("Short X", "Short", limit=tp, stop=sl)
plot(stLine, "Supertrend", color=stBull ? color.lime : color.red, linewidth=2)
'''

BUILTIN_STRATEGIES = [
    {
        "id": "builtin-fib-supertrend-v1",
        "name": "Fibonacci + Supertrend (1:3 RR)",
        "description": "Enters in the 38.2–61.8% golden zone when Supertrend confirms direction. R:R = 1:3.",
        "script": FIBO_SUPERTREND_SCRIPT,
    }
]


@router.get("/api/strategies", response_model=list[StrategyOut])
def list_strategies(user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM pine_strategies WHERE user_id = ? ORDER BY is_builtin DESC, created_at DESC",
            (uid,),
        ).fetchall()
    user_strats = [_row(r) for r in rows]
    existing_ids = {s.id for s in user_strats}
    now = datetime.now(timezone.utc).isoformat()
    builtins = [
        StrategyOut(id=b["id"], name=b["name"], description=b["description"],
                    script=b["script"], conditions=[], is_builtin=True,
                    created_at=now, updated_at=now)
        for b in BUILTIN_STRATEGIES if b["id"] not in existing_ids
    ]
    return builtins + user_strats


@router.post("/api/strategies", response_model=StrategyOut, status_code=201)
def create_strategy(body: StrategyIn, user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    now, new_id = datetime.now(timezone.utc).isoformat(), str(uuid.uuid4())
    script, conds_json = _finalize(body)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO pine_strategies (id,user_id,name,description,script,conditions,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
            (new_id, uid, body.name, body.description, script, conds_json, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pine_strategies WHERE id=?", (new_id,)).fetchone()
    return _row(row)


@router.put("/api/strategies/{strategy_id}", response_model=StrategyOut)
def update_strategy(strategy_id: str, body: StrategyIn,
                    user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    now = datetime.now(timezone.utc).isoformat()
    script, conds_json = _finalize(body)
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE pine_strategies SET name=?,description=?,script=?,conditions=?,updated_at=? WHERE id=? AND user_id=? AND is_builtin=0",
            (body.name, body.description, script, conds_json, now, strategy_id, uid),
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Strategy not found or is a built-in")
        row = conn.execute("SELECT * FROM pine_strategies WHERE id=?", (strategy_id,)).fetchone()
    return _row(row)


@router.delete("/api/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str, user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    with get_conn() as conn:
        result = conn.execute(
            "DELETE FROM pine_strategies WHERE id=? AND user_id=? AND is_builtin=0",
            (strategy_id, uid),
        )
        conn.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Strategy not found or is a built-in")


@router.post("/api/strategies/{strategy_id}/fork", response_model=StrategyOut, status_code=201)
def fork_strategy(strategy_id: str, user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    now, new_id = datetime.now(timezone.utc).isoformat(), str(uuid.uuid4())
    source: dict | None = next((b for b in BUILTIN_STRATEGIES if b["id"] == strategy_id), None)
    if source is None:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM pine_strategies WHERE id=? AND user_id=?", (strategy_id, uid)
            ).fetchone()
        if row is None:
            raise HTTPException(404, "Strategy not found")
        source = dict(row)
    raw_conds = source.get("conditions")
    if isinstance(raw_conds, str):
        conditions = raw_conds or "[]"
    else:
        conditions = json.dumps(raw_conds or [])
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO pine_strategies (id,user_id,name,description,script,conditions,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
            (new_id, uid, f"Copy of {source['name']}", source.get("description",""),
             source["script"], conditions, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pine_strategies WHERE id=?", (new_id,)).fetchone()
    return _row(row)


# ── Evaluation + market scan ──────────────────────────────────────────────────

def _load_conditions(strategy_id: str, uid: str) -> list[dict]:
    row = _get_strategy(strategy_id, uid)
    if row is None:
        raise HTTPException(404, "Strategy not found")
    try:
        conds = json.loads(row["conditions"] or "[]")
    except Exception:
        conds = []
    if not conds:
        raise HTTPException(400, "This strategy has no conditions to evaluate (raw Pine script)")
    return conds


@router.post("/api/strategies/{strategy_id}/evaluate")
async def evaluate_strategy(strategy_id: str, body: EvalIn,
                            user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    conds = _load_conditions(strategy_id, uid)
    ticker = body.ticker.strip().upper()

    cache_key = f"strategy-eval:{strategy_id}:{ticker}"
    if (cached := cache.get(cache_key)) is not None:
        return cached

    import yf_client as yfc
    hist = await yfc.fetch_history(ticker, period="2y", interval="1d")
    if hist is None or hist.empty:
        raise HTTPException(404, f"No history available for {ticker}")

    result = evaluate_conditions(conds, hist)
    result["ticker"] = ticker
    cache.set(cache_key, result, ttl=300)
    return result


@router.post("/api/strategies/{strategy_id}/scan")
async def scan_strategy(strategy_id: str, body: ScanIn,
                        user: Annotated[Optional[dict], Depends(get_optional_user)]):
    uid = user["id"] if user else ANON_USER
    conds = _load_conditions(strategy_id, uid)

    from routers.market import DEFAULT_SMC_WATCHLIST
    tickers = [t.strip().upper() for t in body.tickers if t and t.strip()]
    if not tickers:
        tickers = list(DEFAULT_SMC_WATCHLIST)
    tickers = tickers[:50]

    cache_key = f"strategy-scan:{strategy_id}:{','.join(sorted(tickers))}"
    if (cached := cache.get(cache_key)) is not None:
        return cached

    import yf_client as yfc

    async def scan_one(ticker: str) -> Optional[dict]:
        try:
            hist = await yfc.fetch_history(ticker, period="2y", interval="1d")
            if hist is None or hist.empty:
                return None
            r = evaluate_conditions(conds, hist)
            ctx = r["context"]
            sector = await get_sector_for(ticker)
            return {
                "ticker": ticker,
                "sector": sector,
                "passed": r["passed"],
                "passed_count": sum(1 for x in r["results"] if x["passed"]),
                "total": len(r["results"]),
                "summary": {
                    "price": ctx.get("price"),
                    "rsi": ctx.get("rsi"),
                    "price_vs_ma50": ctx.get("price_vs_ma50"),
                    "supertrend": ctx.get("supertrend"),
                    "momentum_52w": ctx.get("momentum_52w"),
                },
            }
        except Exception:
            return None   # dead symbol, delisted, rate-limit — just skip

    # Batches of 5, mirroring the smart-money scanner's pacing
    rows: list[dict] = []
    for i in range(0, len(tickers), 5):
        batch = tickers[i:i + 5]
        results = await asyncio.gather(*(scan_one(t) for t in batch))
        rows.extend(r for r in results if r is not None)
        if i + 5 < len(tickers):
            await asyncio.sleep(0.8)

    rows.sort(key=lambda r: (not r["passed"], -r["passed_count"], r["ticker"]))
    out = {"scanned": len(rows), "matched": sum(1 for r in rows if r["passed"]), "results": rows}
    cache.set(cache_key, out, ttl=600)
    return out
