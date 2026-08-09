"""
/api/strategies  — CRUD for Pine Script strategies (no auth required).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from database import get_conn

router = APIRouter()

ANON_USER = "anon"


class StrategyIn(BaseModel):
    name:        str
    description: str = ""
    script:      str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Strategy name cannot be empty")
        if len(v) > 100:
            raise ValueError("Strategy name must be ≤ 100 characters")
        return v

    @field_validator("script")
    @classmethod
    def script_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Script cannot be empty")
        return v


class StrategyOut(BaseModel):
    id:          str
    name:        str
    description: str
    script:      str
    is_builtin:  bool
    created_at:  str
    updated_at:  str


def _row(row) -> StrategyOut:
    return StrategyOut(
        id=row["id"], name=row["name"], description=row["description"],
        script=row["script"], is_builtin=bool(row["is_builtin"]),
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


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
def list_strategies():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM pine_strategies WHERE user_id = ? ORDER BY is_builtin DESC, created_at DESC",
            (ANON_USER,),
        ).fetchall()
    user_strats = [_row(r) for r in rows]
    existing_ids = {s.id for s in user_strats}
    now = datetime.now(timezone.utc).isoformat()
    builtins = [
        StrategyOut(id=b["id"], name=b["name"], description=b["description"],
                    script=b["script"], is_builtin=True, created_at=now, updated_at=now)
        for b in BUILTIN_STRATEGIES if b["id"] not in existing_ids
    ]
    return builtins + user_strats


@router.post("/api/strategies", response_model=StrategyOut, status_code=201)
def create_strategy(body: StrategyIn):
    now, new_id = datetime.now(timezone.utc).isoformat(), str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO pine_strategies (id,user_id,name,description,script,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)",
            (new_id, ANON_USER, body.name, body.description, body.script, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pine_strategies WHERE id=?", (new_id,)).fetchone()
    return _row(row)


@router.put("/api/strategies/{strategy_id}", response_model=StrategyOut)
def update_strategy(strategy_id: str, body: StrategyIn):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE pine_strategies SET name=?,description=?,script=?,updated_at=? WHERE id=? AND user_id=? AND is_builtin=0",
            (body.name, body.description, body.script, now, strategy_id, ANON_USER),
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Strategy not found or is a built-in")
        row = conn.execute("SELECT * FROM pine_strategies WHERE id=?", (strategy_id,)).fetchone()
    return _row(row)


@router.delete("/api/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str):
    with get_conn() as conn:
        result = conn.execute(
            "DELETE FROM pine_strategies WHERE id=? AND user_id=? AND is_builtin=0",
            (strategy_id, ANON_USER),
        )
        conn.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Strategy not found or is a built-in")


@router.post("/api/strategies/{strategy_id}/fork", response_model=StrategyOut, status_code=201)
def fork_strategy(strategy_id: str):
    now, new_id = datetime.now(timezone.utc).isoformat(), str(uuid.uuid4())
    source: dict | None = next((b for b in BUILTIN_STRATEGIES if b["id"] == strategy_id), None)
    if source is None:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM pine_strategies WHERE id=? AND user_id=?", (strategy_id, ANON_USER)
            ).fetchone()
        if row is None:
            raise HTTPException(404, "Strategy not found")
        source = dict(row)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO pine_strategies (id,user_id,name,description,script,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)",
            (new_id, ANON_USER, f"Copy of {source['name']}", source.get("description",""), source["script"], now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pine_strategies WHERE id=?", (new_id,)).fetchone()
    return _row(row)
