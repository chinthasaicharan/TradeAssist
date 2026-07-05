"""
/api/strategies  — CRUD for user Pine Script strategies.
All endpoints require a valid JWT. Strategies are scoped per user.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from database import get_conn
from routers.auth import get_current_user

router = APIRouter()

# ── Pydantic models ───────────────────────────────────────────────────────────

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
        id=row["id"],
        name=row["name"],
        description=row["description"],
        script=row["script"],
        is_builtin=bool(row["is_builtin"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── Built-in strategy — Fibonacci + Supertrend (PineScript v6) ───────────────

FIBO_SUPERTREND_SCRIPT = '''//@version=6
strategy("Fib + Supertrend | 1:3 RR", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10)

// ── Inputs ────────────────────────────────────────────────────────────────────
fibLookback   = input.int(50,   "Fib Lookback Bars",  minval=10)
stLength      = input.int(10,   "Supertrend ATR Len", minval=1)
stMult        = input.float(3.0,"Supertrend Mult",    minval=0.5, step=0.1)
rrRatio       = input.float(3.0,"Reward : Risk",      minval=1.0, step=0.5)  // 1:3

// ── Supertrend ────────────────────────────────────────────────────────────────
[stLine, stDir] = ta.supertrend(stMult, stLength)
stBull = stDir < 0   // true when price is above supertrend (bullish)

// ── Fibonacci levels ──────────────────────────────────────────────────────────
swingHigh = ta.highest(high, fibLookback)
swingLow  = ta.lowest(low,  fibLookback)
fibRange  = swingHigh - swingLow

fib0    = swingLow
fib236  = swingLow + fibRange * 0.236
fib382  = swingLow + fibRange * 0.382
fib500  = swingLow + fibRange * 0.500
fib618  = swingLow + fibRange * 0.618
fib786  = swingLow + fibRange * 0.786
fib1000 = swingHigh

// Draw Fibonacci levels
plot(fib0,    "Fib 0%",    color=color.new(color.gray,  60), linewidth=1)
plot(fib236,  "Fib 23.6%", color=color.new(color.yellow,50), linewidth=1)
plot(fib382,  "Fib 38.2%", color=color.new(color.orange,40), linewidth=1, style=plot.style_circles)
plot(fib500,  "Fib 50%",   color=color.new(color.white, 40), linewidth=1)
plot(fib618,  "Fib 61.8%", color=color.new(color.lime,  40), linewidth=2, style=plot.style_circles)
plot(fib786,  "Fib 78.6%", color=color.new(color.aqua,  50), linewidth=1)
plot(fib1000, "Fib 100%",  color=color.new(color.gray,  60), linewidth=1)

// Highlight golden zone (38.2% – 61.8%)
goldenZoneTop    = fib618
goldenZoneBottom = fib382
bgcolor(close >= goldenZoneBottom and close <= goldenZoneTop ? color.new(color.lime, 92) : na, title="Golden Zone BG")

// ── Entry conditions ──────────────────────────────────────────────────────────
// LONG: Price bounces off golden zone (38.2-61.8%) AND Supertrend is bullish
longCondition = stBull and
     close >= goldenZoneBottom and close <= goldenZoneTop and
     ta.crossover(close, stLine)

// SHORT: Price rejects from golden zone AND Supertrend is bearish
shortCondition = not stBull and
     close >= goldenZoneBottom and close <= goldenZoneTop and
     ta.crossunder(close, stLine)

// ── Risk management (1 : 3 reward ratio) ─────────────────────────────────────
atr = ta.atr(14)

// Long trade levels
longEntry  = close
longStop   = math.min(swingLow, longEntry - atr)          // stop below swing low or 1 ATR
longRisk   = longEntry - longStop
longTarget = longEntry + longRisk * rrRatio                 // 1:3 RR

// Short trade levels
shortEntry  = close
shortStop   = math.max(swingHigh, shortEntry + atr)        // stop above swing high or 1 ATR
shortRisk   = shortStop - shortEntry
shortTarget = shortEntry - shortRisk * rrRatio              // 1:3 RR

// ── Execute trades ────────────────────────────────────────────────────────────
if longCondition
    strategy.entry("Long", strategy.long)
    strategy.exit("Long TP/SL", "Long", limit=longTarget, stop=longStop)
    label.new(bar_index, low - atr, "▲ LONG\\nEntry: " + str.tostring(longEntry, "#.##") + "\\nTP: " + str.tostring(longTarget, "#.##") + "\\nSL: " + str.tostring(longStop, "#.##"),
         style=label.style_label_up, color=color.new(color.lime, 10), textcolor=color.white, size=size.small)

if shortCondition
    strategy.entry("Short", strategy.short)
    strategy.exit("Short TP/SL", "Short", limit=shortTarget, stop=shortStop)
    label.new(bar_index, high + atr, "▼ SHORT\\nEntry: " + str.tostring(shortEntry, "#.##") + "\\nTP: " + str.tostring(shortTarget, "#.##") + "\\nSL: " + str.tostring(shortStop, "#.##"),
         style=label.style_label_down, color=color.new(color.red, 10), textcolor=color.white, size=size.small)

// ── Supertrend visual ─────────────────────────────────────────────────────────
stColor = stBull ? color.lime : color.red
plot(stLine, "Supertrend", color=stColor, linewidth=2)

// ── Info table ────────────────────────────────────────────────────────────────
var table infoTbl = table.new(position.top_right, 2, 5, bgcolor=color.new(color.black, 60), border_width=1)
if barstate.islast
    table.cell(infoTbl, 0, 0, "Fib + ST Strategy", text_color=color.white,  text_size=size.small, bgcolor=color.new(color.purple, 40))
    table.cell(infoTbl, 1, 0, "1:" + str.tostring(rrRatio), text_color=color.yellow, text_size=size.small, bgcolor=color.new(color.purple, 40))
    table.cell(infoTbl, 0, 1, "Fib 61.8%", text_color=color.gray,  text_size=size.tiny)
    table.cell(infoTbl, 1, 1, str.tostring(fib618, "#.##"), text_color=color.lime,  text_size=size.tiny)
    table.cell(infoTbl, 0, 2, "Fib 38.2%", text_color=color.gray,  text_size=size.tiny)
    table.cell(infoTbl, 1, 2, str.tostring(fib382, "#.##"), text_color=color.orange, text_size=size.tiny)
    table.cell(infoTbl, 0, 3, "ST Signal",  text_color=color.gray,  text_size=size.tiny)
    table.cell(infoTbl, 1, 3, stBull ? "BULL" : "BEAR", text_color=stBull ? color.lime : color.red, text_size=size.tiny)
    table.cell(infoTbl, 0, 4, "ATR(14)",   text_color=color.gray,  text_size=size.tiny)
    table.cell(infoTbl, 1, 4, str.tostring(atr, "#.##"),           text_color=color.aqua,   text_size=size.tiny)
'''

BUILTIN_STRATEGIES = [
    {
        "id": "builtin-fib-supertrend-v1",
        "name": "Fibonacci + Supertrend (1:3 RR)",
        "description": "Combines Fibonacci retracement golden zone (38.2%–61.8%) with Supertrend for entry confirmation. Entries trigger when price is in the golden zone and Supertrend confirms direction. Risk:Reward = 1:3.",
        "script": FIBO_SUPERTREND_SCRIPT,
        "is_builtin": True,
    }
]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/api/strategies", response_model=list[StrategyOut])
def list_strategies(user: Annotated[dict, Depends(get_current_user)]):
    """Return built-in strategies first, then user-created ones."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM pine_strategies WHERE user_id = ? ORDER BY is_builtin DESC, created_at DESC",
            (user["id"],),
        ).fetchall()
    user_strategies = [_row(r) for r in rows]

    # Inject built-ins if user has no copy yet (check by id)
    existing_ids = {s.id for s in user_strategies}
    builtins_out = []
    for b in BUILTIN_STRATEGIES:
        if b["id"] not in existing_ids:
            now = datetime.now(timezone.utc).isoformat()
            builtins_out.append(StrategyOut(
                id=b["id"],
                name=b["name"],
                description=b["description"],
                script=b["script"],
                is_builtin=True,
                created_at=now,
                updated_at=now,
            ))

    return builtins_out + user_strategies


@router.post("/api/strategies", response_model=StrategyOut, status_code=201)
def create_strategy(body: StrategyIn, user: Annotated[dict, Depends(get_current_user)]):
    now    = datetime.now(timezone.utc).isoformat()
    new_id = str(uuid.uuid4())

    with get_conn() as conn:
        conn.execute(
            """INSERT INTO pine_strategies (id, user_id, name, description, script, is_builtin, created_at, updated_at)
               VALUES (?,?,?,?,?,0,?,?)""",
            (new_id, user["id"], body.name, body.description, body.script, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pine_strategies WHERE id = ?", (new_id,)).fetchone()
    return _row(row)


@router.put("/api/strategies/{strategy_id}", response_model=StrategyOut)
def update_strategy(
    strategy_id: str,
    body: StrategyIn,
    user: Annotated[dict, Depends(get_current_user)],
):
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        result = conn.execute(
            """UPDATE pine_strategies
               SET name=?, description=?, script=?, updated_at=?
               WHERE id=? AND user_id=? AND is_builtin=0""",
            (body.name, body.description, body.script, now, strategy_id, user["id"]),
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(404, "Strategy not found or cannot edit a built-in strategy")
        row = conn.execute("SELECT * FROM pine_strategies WHERE id = ?", (strategy_id,)).fetchone()
    return _row(row)


@router.delete("/api/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str, user: Annotated[dict, Depends(get_current_user)]):
    with get_conn() as conn:
        result = conn.execute(
            "DELETE FROM pine_strategies WHERE id=? AND user_id=? AND is_builtin=0",
            (strategy_id, user["id"]),
        )
        conn.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Strategy not found or cannot delete a built-in strategy")


@router.post("/api/strategies/{strategy_id}/fork", response_model=StrategyOut, status_code=201)
def fork_strategy(strategy_id: str, user: Annotated[dict, Depends(get_current_user)]):
    """Clone any strategy (including built-ins) as a personal editable copy."""
    now    = datetime.now(timezone.utc).isoformat()
    new_id = str(uuid.uuid4())

    # Find strategy — could be a built-in (not in DB)
    source: dict | None = None
    for b in BUILTIN_STRATEGIES:
        if b["id"] == strategy_id:
            source = b
            break

    if source is None:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM pine_strategies WHERE id=? AND user_id=?",
                (strategy_id, user["id"]),
            ).fetchone()
        if row is None:
            raise HTTPException(404, "Strategy not found")
        source = dict(row)

    with get_conn() as conn:
        conn.execute(
            """INSERT INTO pine_strategies (id, user_id, name, description, script, is_builtin, created_at, updated_at)
               VALUES (?,?,?,?,?,0,?,?)""",
            (new_id, user["id"], f"Copy of {source['name']}", source["description"], source["script"], now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pine_strategies WHERE id = ?", (new_id,)).fetchone()
    return _row(row)
