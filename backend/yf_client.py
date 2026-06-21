"""
yf_client.py — rate-limit-safe yfinance wrapper for TradeAssist

Strategy:
  1. curl_cffi Chrome session  → passes Yahoo's TLS fingerprint check
  2. asyncio.Semaphore(1)      → only ONE Yahoo request at a time (safest)
  3. 1-second gap between calls → avoids burst triggering IP ban
  4. 3 retries × exponential backoff on 429
  5. App-level TTL cache (cache.py) keeps hot data in-memory
"""
import asyncio
import logging
import time
from typing import Any

import pandas as pd

log = logging.getLogger(__name__)

# ── curl_cffi session (Chrome impersonation) ───────────────────────────────
try:
    from curl_cffi import requests as cffi_requests
    _SESSION = cffi_requests.Session(impersonate="chrome110")
    log.info("[yfc] curl_cffi Chrome110 session ready")
except Exception as e:
    _SESSION = None
    log.warning(f"[yfc] curl_cffi unavailable ({e}), using default requests")

# ── Rate-limit config ──────────────────────────────────────────────────────
MAX_RETRIES = 3
BASE_DELAY  = 4.0      # seconds before first retry
INTER_DELAY = 1.2      # seconds to sleep between ANY two Yahoo calls

_last_call_time: float = 0.0


def _throttle():
    """Sleep enough so we never fire requests faster than INTER_DELAY apart."""
    global _last_call_time
    now = time.monotonic()
    gap = now - _last_call_time
    if gap < INTER_DELAY:
        time.sleep(INTER_DELAY - gap)
    _last_call_time = time.monotonic()


def _is_429(exc: Exception) -> bool:
    return "429" in str(exc) or "Too Many Requests" in str(exc).lower()


# ── yfinance ticker factory ────────────────────────────────────────────────
def _ticker(symbol: str):
    import yfinance as yf
    if _SESSION is not None:
        return yf.Ticker(symbol, session=_SESSION)
    return yf.Ticker(symbol)


# ── Sync fetch primitives ──────────────────────────────────────────────────

def _fetch_info_sync(symbol: str) -> dict:
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        try:
            info = _ticker(symbol).info or {}
            if info and len(info) > 5:
                return info
            # Empty / stub response — not a 429, just no data
            log.warning(f"[yfc] empty info for {symbol}")
            return {}
        except Exception as exc:
            if _is_429(exc) and attempt < MAX_RETRIES:
                delay = BASE_DELAY * (2 ** attempt)
                log.warning(f"[yfc] 429 info/{symbol}, retry {attempt+1} in {delay:.0f}s")
                time.sleep(delay)
            else:
                log.warning(f"[yfc] info/{symbol} failed: {exc}")
                break
    return {}


def _fetch_history_sync(symbol: str, period: str, interval: str) -> pd.DataFrame:
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        try:
            hist = _ticker(symbol).history(period=period, interval=interval)
            if hist is not None and not hist.empty:
                return hist
            log.warning(f"[yfc] empty history for {symbol}")
            return pd.DataFrame()
        except Exception as exc:
            if _is_429(exc) and attempt < MAX_RETRIES:
                delay = BASE_DELAY * (2 ** attempt)
                log.warning(f"[yfc] 429 hist/{symbol}, retry {attempt+1} in {delay:.0f}s")
                time.sleep(delay)
            else:
                log.warning(f"[yfc] history/{symbol} failed: {exc}")
                break
    return pd.DataFrame()


def _fetch_financials_sync(symbol: str) -> tuple[Any, Any]:
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        try:
            t = _ticker(symbol)
            ann = t.financials
            qtr = t.quarterly_financials
            return ann, qtr
        except Exception as exc:
            if _is_429(exc) and attempt < MAX_RETRIES:
                delay = BASE_DELAY * (2 ** attempt)
                log.warning(f"[yfc] 429 fin/{symbol}, retry {attempt+1} in {delay:.0f}s")
                time.sleep(delay)
            else:
                log.warning(f"[yfc] financials/{symbol} failed: {exc}")
                break
    return None, None


def _fetch_news_sync(symbol: str) -> list:
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        try:
            return _ticker(symbol).news or []
        except Exception as exc:
            if _is_429(exc) and attempt < MAX_RETRIES:
                time.sleep(BASE_DELAY * (2 ** attempt))
            else:
                log.warning(f"[yfc] news/{symbol} failed: {exc}")
                break
    return []


def _fetch_holdings_sync(symbol: str) -> dict:
    """Fetch major_holders, institutional_holders, mutualfund_holders."""
    for attempt in range(MAX_RETRIES + 1):
        _throttle()
        try:
            t = _ticker(symbol)
            return {
                "major":    t.major_holders,
                "inst":     t.institutional_holders,
                "mf":       t.mutualfund_holders,
            }
        except Exception as exc:
            if _is_429(exc) and attempt < MAX_RETRIES:
                delay = BASE_DELAY * (2 ** attempt)
                log.warning(f"[yfc] 429 holdings/{symbol}, retry {attempt+1} in {delay:.0f}s")
                time.sleep(delay)
            else:
                log.warning(f"[yfc] holdings/{symbol} failed: {exc}")
                break
    return {"major": None, "inst": None, "mf": None}


# ── Semaphore — ONE request at a time ────────────────────────────────────
# Lazy init avoids "attached to a different event loop" on uvicorn reload
_sem: asyncio.Semaphore | None = None

def _get_sem() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(1)
    return _sem


# ── Async wrappers ─────────────────────────────────────────────────────────

async def fetch_info(symbol: str) -> dict:
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_info_sync, symbol
        )


async def fetch_history(
    symbol: str, period: str = "1y", interval: str = "1d"
) -> pd.DataFrame:
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: _fetch_history_sync(symbol, period, interval)
        )


async def fetch_financials(symbol: str) -> tuple[Any, Any]:
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_financials_sync, symbol
        )


async def fetch_news(symbol: str) -> list:
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_news_sync, symbol
        )


async def fetch_holdings(symbol: str) -> dict:
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_holdings_sync, symbol
        )
