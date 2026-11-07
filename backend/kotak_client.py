"""
kotak_client.py — Kotak Neo (NeoAPI) session wrapper for the FnO desk.

Access modes:
  • consumer key only (KOTAK_CONSUMER_KEY) — per Neo docs the expiries and
    option-chain endpoints need just the key; a key-only client is created
    on demand and cached.
  • full session — connect(mobile, ucc, totp, mpin) performs
    totp_login + totp_validate; the client is cached in memory until
    disconnect() or process restart (sessions last ~a day).

neo_api_client is imported lazily everywhere so the whole app keeps working
when the package isn't installed or credentials aren't set yet.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

log = logging.getLogger(__name__)

_session_client: Any | None = None     # full TOTP/MPIN session when connected
_key_client: Any | None = None         # consumer-key-only client (market data)
_lock = threading.Lock()


class KotakError(Exception):
    """Readable error for the API layer — message is user-safe."""


def consumer_key() -> str:
    return os.getenv("KOTAK_CONSUMER_KEY", "").strip()


def is_configured() -> bool:
    return bool(consumer_key())


def is_connected() -> bool:
    return _session_client is not None


def package_installed() -> bool:
    try:
        import neo_api_client  # noqa: F401
        return True
    except Exception:
        return False


def _err_text(e: Exception) -> str:
    """Extract the readable message out of NeoAPI errors."""
    msg = str(e).strip()
    # SDK often raises with a JSON-ish body: {"stat":"Not_Ok","error":[{"message":...}]}
    if "message" in msg:
        try:
            import json
            body = json.loads(msg[msg.index("{"):])
            errs = body.get("error") or []
            if errs and isinstance(errs, list):
                msg = str(errs[0].get("message") or msg)
            elif body.get("errMsg"):
                msg = str(body["errMsg"])
        except Exception:
            pass
    return msg[:300]


def _make_client() -> Any:
    from neo_api_client import NeoAPI
    return NeoAPI(
        consumer_key=consumer_key(),
        environment=os.getenv("KOTAK_ENVIRONMENT", "prod"),
    )


def _check(resp: Any, what: str) -> Any:
    """Raise KotakError when a Neo response reports Not_Ok."""
    if isinstance(resp, dict) and resp.get("stat") == "Not_Ok":
        errs = resp.get("error") or []
        msg = (
            errs[0].get("message", "") if errs and isinstance(errs, list) else ""
        ) or resp.get("errMsg") or resp.get("errmsg") or "request failed"
        raise KotakError(f"{what}: {msg}")
    return resp


def _market_client() -> Any:
    """Client for market data: connected session if any, else key-only."""
    global _key_client
    if _session_client is not None:
        return _session_client
    if not is_configured():
        raise KotakError(
            "Kotak Neo is not configured — set KOTAK_CONSUMER_KEY in backend/.env, "
            "then restart the backend (or connect a session from the FnO page)"
        )
    if _key_client is None:
        try:
            _key_client = _make_client()
        except Exception as e:
            raise KotakError(f"Kotak Neo client init failed: {_err_text(e)}")
    return _key_client


# ── Session (full login) ──────────────────────────────────────────────────────

def connect(mobile_number: str, ucc: str, totp: str, mpin: str) -> dict:
    """TOTP login + MPIN 2FA. Raises KotakError with a readable message."""
    global _session_client, _key_client
    if not is_configured():
        raise KotakError("KOTAK_CONSUMER_KEY is not set — add it to backend/.env first")
    try:
        c = _make_client()
        c.totp_login(mobile_number=mobile_number, ucc=ucc, totp=totp)
        c.totp_validate(mpin=mpin)
    except KotakError:
        raise
    except Exception as e:
        raise KotakError(f"Kotak Neo login failed: {_err_text(e)}")
    with _lock:
        _session_client = c
        _key_client = c          # session client also serves market data
    return {"connected": True}


def disconnect() -> None:
    global _session_client, _key_client
    with _lock:
        if _session_client is not None:
            try:
                _session_client.logout()
            except Exception:
                pass
            _session_client = None
        _key_client = None


# ── Market data ───────────────────────────────────────────────────────────────

def expiries(underlying: str) -> list[str]:
    """Available option expiries (ISO dates) for an underlying."""
    try:
        resp = _market_client().expiries(exchange="nse_fo", underlying=underlying)
        _check(resp, "expiries")
    except KotakError:
        raise
    except Exception as e:
        raise KotakError(f"expiries: {_err_text(e)}")
    data = resp.get("data", resp) if isinstance(resp, dict) else {}
    exps = data.get("expiries") or []
    return [str(e) for e in exps]


def option_chain(underlying: str, expiry: str | None = None, count: int = 40) -> dict:
    """Raw option chain payload (data.call[] / data.put[] per Neo docs).

    `count` must be a multiple of 10 (Neo 400s otherwise); covers 40 calls
    + 40 puts around the ATM by default.
    """
    n = max(10, min(80, int(round((count or 40) / 10.0)) * 10))
    kwargs: dict[str, Any] = {
        "exchange": "nse_fo", "underlying": underlying,
        "instrument_type": "option", "count": n,
    }
    if expiry:
        kwargs["expiry"] = expiry
    try:
        resp = _market_client().option_chain(**kwargs)
        _check(resp, "option chain")
    except KotakError:
        raise
    except Exception as e:
        raise KotakError(f"option chain: {_err_text(e)}")
    if not isinstance(resp, dict) or not (resp.get("data") or resp.get("call") or resp.get("put")):
        raise KotakError(f"option chain: empty response for {underlying}")
    return resp
