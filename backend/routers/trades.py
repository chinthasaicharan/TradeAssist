"""
/api/trades  — CRUD for pinned trade recommendations (no auth required).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_conn

router = APIRouter()

# Shared anonymous user ID — all trades stored under one bucket
ANON_USER = "anon"

class TradeIn(BaseModel):
    ticker:       str
    company_name: str
    trade_type:   Literal["BTST", "Recommendation"]
    verdict:      str
    entry_price:  float
    target_price: float
    stop_loss:    float
    risk_reward:  float
    confidence:   float

class NoteIn(BaseModel):
    note: str

class TradeOut(BaseModel):
    id:           str
    ticker:       str
    company_name: str
    trade_type:   Literal["BTST", "Recommendation"]
    verdict:      str
    entry_price:  float
    target_price: float
    stop_loss:    float
    risk_reward:  float
    confidence:   float
    pinned_at:    str
    note:         str

def _row(row) -> TradeOut:
    return TradeOut(**{k: row[k] for k in TradeOut.model_fields})

@router.get("/api/trades", response_model=list[TradeOut])
def list_trades():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM pinned_trades WHERE user_id = ? ORDER BY pinned_at DESC",
            (ANON_USER,),
        ).fetchall()
    return [_row(r) for r in rows]

@router.post("/api/trades", response_model=TradeOut, status_code=201)
def create_trade(body: TradeIn):
    now    = datetime.now(timezone.utc).isoformat()
    new_id = f"{body.ticker}-{body.trade_type}-{int(datetime.now(timezone.utc).timestamp()*1000)}"
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM pinned_trades WHERE user_id = ? AND ticker = ? AND trade_type = ?",
            (ANON_USER, body.ticker, body.trade_type),
        )
        conn.execute(
            """INSERT INTO pinned_trades
               (id, user_id, ticker, company_name, trade_type, verdict,
                entry_price, target_price, stop_loss, risk_reward, confidence, pinned_at, note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'')""",
            (new_id, ANON_USER, body.ticker, body.company_name, body.trade_type,
             body.verdict, body.entry_price, body.target_price, body.stop_loss,
             body.risk_reward, body.confidence, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pinned_trades WHERE id = ?", (new_id,)).fetchone()
    return _row(row)

@router.patch("/api/trades/{trade_id}/note", response_model=TradeOut)
def update_note(trade_id: str, body: NoteIn):
    with get_conn() as conn:
        conn.execute(
            "UPDATE pinned_trades SET note = ? WHERE id = ? AND user_id = ?",
            (body.note, trade_id, ANON_USER),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM pinned_trades WHERE id = ? AND user_id = ?",
            (trade_id, ANON_USER),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Trade not found")
    return _row(row)

@router.delete("/api/trades/{trade_id}", status_code=204)
def delete_trade(trade_id: str):
    with get_conn() as conn:
        result = conn.execute(
            "DELETE FROM pinned_trades WHERE id = ? AND user_id = ?",
            (trade_id, ANON_USER),
        )
        conn.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Trade not found")

@router.get("/api/trades/check/{ticker}/{trade_type}")
def check_pinned(ticker: str, trade_type: Literal["BTST", "Recommendation"]):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM pinned_trades WHERE user_id = ? AND ticker = ? AND trade_type = ?",
            (ANON_USER, ticker, trade_type),
        ).fetchone()
    return {"pinned": row is not None, "id": row["id"] if row else None}
