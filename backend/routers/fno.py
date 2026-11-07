"""
/api/fno — FnO desk: Kotak Neo option chains, positioning analytics and
GenAI trade suggestions (suggestions only — no order placement).

Data comes exclusively from Kotak Neo:
  • consumer key only (KOTAK_CONSUMER_KEY) serves expiries + option chain
  • a full session (mobile/UCC/TOTP/MPIN via /connect) is optional but
    future-proofs quotes and other session endpoints

NOTE: no `from __future__ import annotations` here — string annotations
break under slowapi's limiter wrapper (same gotcha as routers/auth.py).
"""
import asyncio
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import cache
import fno_ai
import fno_analysis
import kotak_client
from ratelimit import limiter
from routers.auth import get_optional_user

router = APIRouter()


class ConnectIn(BaseModel):
    mobile_number: str = Field(min_length=8, max_length=20)
    ucc: str = Field(min_length=2, max_length=20)
    totp: str = Field(min_length=4, max_length=8)
    mpin: str = Field(min_length=4, max_length=8)


class SuggestIn(BaseModel):
    underlying: str
    expiry: str | None = None
    risk_profile: str = "balanced"   # conservative | balanced | aggressive


def _underlying(value: str) -> str:
    u = value.strip().upper()
    if not u or len(u) > 20:
        raise HTTPException(400, "Invalid underlying symbol")
    return u


async def _chain_and_analysis(underlying: str, expiry: str | None) -> tuple[dict, dict]:
    key = f"fno-chain:{underlying}:{expiry or 'nearest'}"
    cached = cache.get(key)
    if cached is not None:
        return cached["chain"], cached["analysis"]

    try:
        raw = await asyncio.to_thread(kotak_client.option_chain, underlying, expiry, 40)
    except kotak_client.KotakError as e:
        raise HTTPException(503, str(e))
    chain = fno_analysis.normalise_chain(raw, underlying, expiry)
    if not chain["strikes"]:
        raise HTTPException(404, f"No option-chain data returned for {underlying}")
    analysis = fno_analysis.analyse(chain)
    if analysis.get("error"):
        raise HTTPException(404, analysis["error"])
    cache.set(key, {"chain": chain, "analysis": analysis}, ttl=120)
    return chain, analysis


# ── Status / session ─────────────────────────────────────────────────────────

@router.get("/api/fno/status")
async def fno_status(user: Annotated[Optional[dict], Depends(get_optional_user)]):
    return {
        "configured": kotak_client.is_configured(),
        "connected": kotak_client.is_connected(),
        "package_installed": kotak_client.package_installed(),
        "index_underlyings": fno_analysis.INDEX_UNDERLYINGS,
        "stock_underlyings": fno_analysis.STOCK_UNDERLYINGS,
    }


@router.post("/api/fno/connect")
@limiter.limit("5/minute")
async def fno_connect(body: ConnectIn, request: Request):
    try:
        return await asyncio.to_thread(
            kotak_client.connect,
            body.mobile_number.strip(), body.ucc.strip().upper(),
            body.totp.strip(), body.mpin.strip(),
        )
    except kotak_client.KotakError as e:
        raise HTTPException(400, str(e))


@router.post("/api/fno/disconnect")
async def fno_disconnect():
    await asyncio.to_thread(kotak_client.disconnect)
    return {"connected": False}


# ── Market data ──────────────────────────────────────────────────────────────

@router.get("/api/fno/expiries")
async def fno_expiries(underlying: str):
    u = _underlying(underlying)
    key = f"fno-expiries:{u}"
    if (cached := cache.get(key)) is not None:
        return cached
    try:
        exps = await asyncio.to_thread(kotak_client.expiries, u)
    except kotak_client.KotakError as e:
        raise HTTPException(503, str(e))
    out = {"underlying": u, "expiries": exps}
    cache.set(key, out, ttl=1800)
    return out


@router.get("/api/fno/chain")
async def fno_chain(underlying: str, expiry: str | None = None):
    u = _underlying(underlying)
    chain, _ = await _chain_and_analysis(u, expiry)
    return chain


@router.get("/api/fno/analysis")
async def fno_analysis_ep(underlying: str, expiry: str | None = None):
    u = _underlying(underlying)
    chain, analysis = await _chain_and_analysis(u, expiry)
    return {
        "underlying": u,
        "expiry": chain["expiry"],
        "lot_size": chain["lot_size"],
        "spot_est": chain["spot_est"],
        "strikes": chain["strikes"],
        **analysis,
    }


# ── GenAI suggestions ────────────────────────────────────────────────────────

@router.post("/api/fno/suggest")
@limiter.limit("10/minute")
async def fno_suggest(body: SuggestIn, request: Request,
                      user: Annotated[Optional[dict], Depends(get_optional_user)]):
    u = _underlying(body.underlying)
    risk = body.risk_profile if body.risk_profile in ("conservative", "balanced", "aggressive") else "balanced"

    key = f"fno-suggest:{u}:{body.expiry or 'nearest'}:{risk}"
    if (cached := cache.get(key)) is not None:
        return cached

    chain, analysis = await _chain_and_analysis(u, body.expiry)
    try:
        suggestion = await fno_ai.suggest(u, chain["expiry"] or "", analysis, chain, risk)
    except Exception as e:
        raise HTTPException(502, f"AI suggestion failed: {e}")
    out = {
        "underlying": u,
        "expiry": chain["expiry"],
        "spot_est": chain["spot_est"],
        "lot_size": chain["lot_size"],
        "sentiment": analysis.get("sentiment"),
        "sentiment_score": analysis.get("sentiment_score"),
        **fno_ai.to_dict(suggestion),
    }
    cache.set(key, out, ttl=300)
    return out
