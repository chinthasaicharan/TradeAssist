"""
yf_client.py — rate-limit-safe yfinance wrapper for TradeAssist

Strategy:
  1. curl_cffi Chrome session  → passes Yahoo TLS fingerprint check
  2. asyncio.Semaphore(3)      → allow 3 concurrent Yahoo calls
  3. Adaptive throttle         → 1s between calls, backs off on 429
  4. Symbol fallback           → .NS → .BO → bare → fail
  5. In-memory result cache    → avoids repeat fetches for hot symbols
  6. Jitter on retry           → prevents thundering-herd on server restart
"""
import asyncio
import logging
import time
import random
from typing import Any

import pandas as pd

log = logging.getLogger(__name__)

# ── curl_cffi Chrome session ───────────────────────────────────────────────
try:
    from curl_cffi import requests as cffi_requests
    _SESSION = cffi_requests.Session(impersonate="chrome110")
    _YF_SESSION = _SESSION   # alias used by cashflow endpoint
    log.info("[yfc] curl_cffi Chrome110 session ready")
except Exception as e:
    _SESSION = None
    _YF_SESSION = None
    log.warning(f"[yfc] curl_cffi unavailable ({e}), using default requests")

# ── Rate-limit config ──────────────────────────────────────────────────────
MAX_RETRIES  = 3
BASE_DELAY   = 4.0     # first retry delay (seconds)
INTER_DELAY  = 0.4     # minimum gap between any two Yahoo calls

_last_call_time: float = 0.0
_backoff_until:  float = 0.0  # global cooldown after a 429
_throttle_lock = None         # threading.Lock, created lazily


def _get_lock():
    global _throttle_lock
    if _throttle_lock is None:
        import threading
        _throttle_lock = threading.Lock()
    return _throttle_lock


def _throttle():
    global _last_call_time, _backoff_until
    with _get_lock():
        now = time.monotonic()
        # Respect global backoff from a 429
        wait = max(_backoff_until - now, INTER_DELAY - (now - _last_call_time))
        if wait > 0:
            time.sleep(wait + random.uniform(0, 0.2))
        _last_call_time = time.monotonic()


def _is_429(exc: Exception) -> bool:
    s = str(exc).lower()
    return "429" in s or "too many requests" in s or "rate limit" in s


def _is_not_found(exc: Exception) -> bool:
    s = str(exc).lower()
    return "404" in s or "not found" in s or "no data found" in s or "delisted" in s


# ── Ticker alias map — renamed/rebranded stocks ───────────────────────────
# When Yahoo Finance drops an old symbol, map it to the current one here.
TICKER_ALIASES: dict[str, str] = {
    "ZOMATO.NS": "ETERNAL.NS",
    "ZOMATO.BO": "ETERNAL.BO",
    "ZOMATO":    "ETERNAL",
}

def resolve_ticker(symbol: str) -> str:
    """Return canonical ticker, resolving any known aliases."""
    return TICKER_ALIASES.get(symbol.upper().strip(), symbol.upper().strip())


# ── Symbol fallback chain ──────────────────────────────────────────────────
def _fallback_symbols(symbol: str) -> list[str]:
    """Return ordered list of symbols to try: .NS → .BO → bare → original."""
    sym = symbol.upper().strip()
    candidates = [sym]
    base = sym.replace(".NS", "").replace(".BO", "")
    if sym.endswith(".NS"):
        candidates = [sym, f"{base}.BO", base]
    elif sym.endswith(".BO"):
        candidates = [sym, f"{base}.NS", base]
    elif "." not in sym:
        candidates = [f"{sym}.NS", f"{sym}.BO", sym]
    # Deduplicate preserving order
    seen, out = set(), []
    for c in candidates:
        if c not in seen:
            seen.add(c); out.append(c)
    return out


# ── yfinance ticker factory ────────────────────────────────────────────────
def _ticker(symbol: str):
    import yfinance as yf
    if _SESSION is not None:
        return yf.Ticker(symbol, session=_SESSION)
    return yf.Ticker(symbol)


# ── Sync fetch primitives ──────────────────────────────────────────────────

def _fetch_info_sync(symbol: str) -> dict:
    global _backoff_until
    for sym in _fallback_symbols(symbol):
        for attempt in range(MAX_RETRIES + 1):
            _throttle()
            try:
                info = _ticker(sym).info or {}
                if info and len(info) > 5 and (
                    info.get("regularMarketPrice") or info.get("currentPrice") or
                    info.get("longName") or info.get("shortName")
                ):
                    # Tag which symbol actually worked
                    info["_resolved_symbol"] = sym
                    return info
                # Stub / empty — not a 429
                log.warning(f"[yfc] empty info for {sym}")
                break   # try next fallback symbol
            except Exception as exc:
                if _is_429(exc):
                    delay = BASE_DELAY * (2 ** attempt) + random.uniform(1, 3)
                    _backoff_until = time.monotonic() + delay
                    log.warning(f"[yfc] 429 info/{sym}, cooling {delay:.0f}s")
                    time.sleep(delay)
                elif _is_not_found(exc):
                    log.warning(f"[yfc] not found: {sym}, trying next")
                    break
                else:
                    log.warning(f"[yfc] info/{sym} failed: {exc}")
                    break
    return {}


def _fetch_history_sync(symbol: str, period: str, interval: str) -> pd.DataFrame:
    global _backoff_until
    for sym in _fallback_symbols(symbol):
        for attempt in range(MAX_RETRIES + 1):
            _throttle()
            try:
                hist = _ticker(sym).history(period=period, interval=interval)
                if hist is not None and not hist.empty:
                    return hist
                log.warning(f"[yfc] empty history for {sym}")
                break
            except Exception as exc:
                if _is_429(exc):
                    delay = BASE_DELAY * (2 ** attempt) + random.uniform(1, 3)
                    _backoff_until = time.monotonic() + delay
                    log.warning(f"[yfc] 429 hist/{sym}, cooling {delay:.0f}s")
                    time.sleep(delay)
                elif _is_not_found(exc):
                    log.warning(f"[yfc] not found hist: {sym}, trying next")
                    break
                else:
                    log.warning(f"[yfc] history/{sym} failed: {exc}")
                    break
    return pd.DataFrame()


def _fetch_financials_sync(symbol: str) -> tuple[Any, Any]:
    global _backoff_until
    for sym in _fallback_symbols(symbol):
        for attempt in range(MAX_RETRIES + 1):
            _throttle()
            try:
                t = _ticker(sym)
                ann = t.financials
                qtr = t.quarterly_financials
                if ann is not None and not ann.empty:
                    return ann, qtr
                break
            except Exception as exc:
                if _is_429(exc):
                    delay = BASE_DELAY * (2 ** attempt) + random.uniform(1, 3)
                    _backoff_until = time.monotonic() + delay
                    time.sleep(delay)
                else:
                    log.warning(f"[yfc] financials/{sym} failed: {exc}")
                    break
    return None, None


def _fetch_news_sync(symbol: str) -> list:
    global _backoff_until
    for sym in _fallback_symbols(symbol):
        for attempt in range(MAX_RETRIES + 1):
            _throttle()
            try:
                news = _ticker(sym).news or []
                if news:
                    return news
                break
            except Exception as exc:
                if _is_429(exc):
                    delay = BASE_DELAY * (2 ** attempt)
                    _backoff_until = time.monotonic() + delay
                    time.sleep(delay)
                else:
                    log.warning(f"[yfc] news/{sym} failed: {exc}")
                    break
    return []


def _fetch_holdings_sync(symbol: str) -> dict:
    global _backoff_until
    for sym in _fallback_symbols(symbol):
        for attempt in range(MAX_RETRIES + 1):
            _throttle()
            try:
                t = _ticker(sym)
                mh = t.major_holders
                return {
                    "major": mh,
                    "inst":  t.institutional_holders,
                    "mf":    t.mutualfund_holders,
                }
            except Exception as exc:
                if _is_429(exc):
                    delay = BASE_DELAY * (2 ** attempt)
                    _backoff_until = time.monotonic() + delay
                    time.sleep(delay)
                else:
                    log.warning(f"[yfc] holdings/{sym} failed: {exc}")
                    break
    return {"major": None, "inst": None, "mf": None}


# ── Semaphore — limit to 5 concurrent Yahoo calls ────────────────────────
_sem: asyncio.Semaphore | None = None

def _get_sem() -> asyncio.Semaphore:
    global _sem
    if _sem is None:
        _sem = asyncio.Semaphore(5)
    return _sem


# ── Async wrappers ─────────────────────────────────────────────────────────

async def fetch_info(symbol: str) -> dict:
    symbol = resolve_ticker(symbol)
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_info_sync, symbol
        )


async def fetch_history(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    symbol = resolve_ticker(symbol)
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: _fetch_history_sync(symbol, period, interval)
        )


async def fetch_financials(symbol: str) -> tuple[Any, Any]:
    symbol = resolve_ticker(symbol)
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_financials_sync, symbol
        )


async def fetch_news(symbol: str) -> list:
    symbol = resolve_ticker(symbol)
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_news_sync, symbol
        )


async def fetch_holdings(symbol: str) -> dict:
    symbol = resolve_ticker(symbol)
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_holdings_sync, symbol
        )


def _fetch_cashflow_sync(symbol: str) -> tuple:
    """Fetch cashflow + income statements via the same retry/throttle pattern."""
    global _backoff_until
    for sym in _fallback_symbols(symbol):
        for attempt in range(MAX_RETRIES + 1):
            _throttle()
            try:
                t = _ticker(sym)
                cf_ann  = t.cashflow
                cf_qtr  = t.quarterly_cashflow
                is_ann  = t.income_stmt
                is_qtr  = t.quarterly_income_stmt
                if cf_ann is not None and not cf_ann.empty:
                    return cf_ann, cf_qtr, is_ann, is_qtr
                break
            except Exception as exc:
                if _is_429(exc):
                    delay = BASE_DELAY * (2 ** attempt) + random.uniform(1, 3)
                    _backoff_until = time.monotonic() + delay
                    log.warning(f"[yfc] 429 cashflow/{sym}, cooling {delay:.0f}s")
                    time.sleep(delay)
                else:
                    log.warning(f"[yfc] cashflow/{sym} failed: {exc}")
                    break
    return None, None, None, None


async def fetch_cashflow_statements(symbol: str) -> tuple:
    """Returns (cf_annual, cf_quarterly, income_annual, income_quarterly)."""
    symbol = resolve_ticker(symbol)
    async with _get_sem():
        return await asyncio.get_event_loop().run_in_executor(
            None, _fetch_cashflow_sync, symbol
        )
