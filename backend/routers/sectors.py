"""
/api/sectors — sector-level dashboard: daily performance + net cash flows.

Performance source: NIFTY sector indices on Yahoo (^NSEBANK, ^CNXIT, …)
where a ticker exists; otherwise an equal-weight mean of the sector's
Nifty 50 constituents. "Net cash flow" is a money-flow proxy per stock:

    flow = (close − prev_close) × volume

summed over the sector's constituents and reported in ₹ crore. Positive on
net-uptick days, negative on net-downtick days — a proxy, not actual FII/DII
fund flows.
"""
from __future__ import annotations

import asyncio
import logging

import pandas as pd
from fastapi import APIRouter

import cache
import yf_client as yfc
from sector_map import SECTOR_INDICES, SECTOR_ORDER, tickers_by_sector

log = logging.getLogger(__name__)
router = APIRouter()

BENCHMARK = ("Nifty 50", "^NSEI")
FLOW_DIV = 1e7          # ₹ → crore
SCAN_BATCH = 5          # mirrors the smart-money scanner's pacing
SCAN_PAUSE = 0.8
DAILY_POINTS = 10       # daily % changes kept per sector for the spark bars


def _pct(a: float | None, b: float | None) -> float | None:
    if a is None or b in (None, 0):
        return None
    return round((a / b - 1) * 100, 2)


def _hist_rows(hist: pd.DataFrame | None) -> list[tuple[str, float, int]]:
    """[(date, close, volume)] with NaN-safe extraction."""
    if hist is None or hist.empty:
        return []
    rows: list[tuple[str, float, int]] = []
    for dt, r in hist.iterrows():
        c = r.get("Close")
        if c is None or pd.isna(c):
            continue
        v = r.get("Volume")
        rows.append((
            dt.strftime("%Y-%m-%d") if hasattr(dt, "strftime") else str(dt),
            float(c),
            int(v) if v is not None and not pd.isna(v) else 0,
        ))
    return rows


def _window_changes(closes: list[float]) -> dict:
    """1d / 5d / 1m % change + last-10-session daily changes from a close series."""
    n = len(closes)
    daily = [
        {"date": None, "pct": _pct(closes[i], closes[i - 1])}
        for i in range(max(1, n - DAILY_POINTS), n)
    ]
    return {
        "change_1d": _pct(closes[-1], closes[-2]) if n >= 2 else None,
        "change_5d": _pct(closes[-1], closes[-6]) if n >= 6 else None,
        "change_1m": _pct(closes[-1], closes[-22]) if n >= 22 else None,
        "daily_changes": daily,
    }


async def _index_snapshot(symbol: str) -> dict | None:
    """Performance block for an index (or None if Yahoo has no data)."""
    try:
        hist = await yfc.fetch_history(symbol, period="3mo", interval="1d")
        rows = _hist_rows(hist)
    except Exception as e:
        log.warning("sector index %s unavailable: %s", symbol, e)
        return None
    if len(rows) < 2:
        return None
    closes = [r[1] for r in rows]
    out = _window_changes(closes)
    out["value"] = round(closes[-1], 2)
    start = max(1, len(rows) - DAILY_POINTS)
    out["daily_changes"] = [
        {"date": rows[i][0], "pct": _pct(closes[i], closes[i - 1])}
        for i in range(start, len(rows))
    ]
    return out


async def _stock_snapshot(ticker: str) -> dict | None:
    """Per-stock price, 1d/5d change, volumes and money-flow proxy."""
    try:
        hist = await yfc.fetch_history(ticker, period="2mo", interval="1d")
        rows = _hist_rows(hist)
    except Exception:
        return None
    if len(rows) < 2:
        return None
    closes = [r[1] for r in rows]
    # daily flow (₹ Cr): signed move × that session's volume
    flows: dict[str, float] = {}
    for i in range(1, len(rows)):
        flows[rows[i][0]] = (closes[i] - closes[i - 1]) * rows[i][2] / FLOW_DIV
    dates = [r[0] for r in rows]
    flow_1d = flows.get(dates[-1])
    flow_5d = sum(flows.get(d, 0.0) for d in dates[-5:])
    return {
        "ticker": ticker,
        "date": dates[-1],
        "price": round(closes[-1], 2),
        "pct_1d": _pct(closes[-1], closes[-2]),
        "pct_5d": _pct(closes[-1], closes[-6]) if len(closes) >= 6 else None,
        "pct_1m": _pct(closes[-1], closes[-22]) if len(closes) >= 22 else None,
        "volume": rows[-1][2],
        "flow_1d_cr": round(flow_1d, 2) if flow_1d is not None else None,
        "flow_5d_cr": round(flow_5d, 2),
    }


@router.get("/api/sectors")
async def list_sectors():
    """Sector list with constituents — feeds strategy-scan universe pickers."""
    grouped = tickers_by_sector()
    return [
        {"name": name, "index": SECTOR_INDICES.get(name), "tickers": grouped.get(name, [])}
        for name in SECTOR_ORDER if grouped.get(name)
    ]


@router.get("/api/sectors/overview")
async def sectors_overview():
    """One snapshot: benchmark + per-sector performance, flows and movers."""
    if (cached := cache.get("sectors-overview")) is not None:
        return cached

    grouped = tickers_by_sector()
    all_tickers = [t for ts in grouped.values() for t in ts]

    # ── constituents + indices in paced batches ─────────────────────────────
    stocks: dict[str, dict | None] = {}

    async def run_batches(items: list[str], fn) -> dict:
        out: dict = {}
        for i in range(0, len(items), SCAN_BATCH):
            batch = items[i:i + SCAN_BATCH]
            results = await asyncio.gather(*(fn(x) for x in batch))
            out.update(dict(zip(batch, results)))
            if i + SCAN_BATCH < len(items):
                await asyncio.sleep(SCAN_PAUSE)
        return out

    stocks = await run_batches(all_tickers, _stock_snapshot)

    index_symbols = sorted({s for s in SECTOR_INDICES.values() if s} | {BENCHMARK[1]})
    indices = await run_batches(index_symbols, _index_snapshot)

    # ── assemble per-sector rows ────────────────────────────────────────────
    sectors: list[dict] = []
    for name in SECTOR_ORDER:
        tickers = grouped.get(name, [])
        members = [stocks[t] for t in tickers if stocks.get(t)]
        if not members:
            continue
        idx_sym = SECTOR_INDICES.get(name)
        idx = indices.get(idx_sym) if idx_sym else None

        pct_1ds = [m["pct_1d"] for m in members if m["pct_1d"] is not None]
        flow_1d = round(sum(m["flow_1d_cr"] or 0.0 for m in members), 2)
        flow_5d = round(sum(m["flow_5d_cr"] or 0.0 for m in members), 2)
        adv = sum(1 for p in pct_1ds if p > 0)
        dec = sum(1 for p in pct_1ds if p < 0)
        gainers = [m for m in members if m["pct_1d"] is not None]
        top_gainer = max(gainers, key=lambda m: m["pct_1d"]) if gainers else None
        top_loser = min(gainers, key=lambda m: m["pct_1d"]) if gainers else None

        # index perf when available, else equal-weight mean of constituents
        def _mean(field: str) -> float | None:
            vals = [m[field] for m in members if m.get(field) is not None]
            return round(sum(vals) / len(vals), 2) if vals else None

        if idx:
            perf = {
                "change_1d": idx["change_1d"], "change_5d": idx["change_5d"],
                "change_1m": idx["change_1m"], "daily_changes": idx["daily_changes"],
            }
        else:
            perf = {
                "change_1d": _mean("pct_1d"),
                "change_5d": _mean("pct_5d"),
                "change_1m": _mean("pct_1m"),
                "daily_changes": [],
            }

        sectors.append({
            "name": name,
            "index": idx_sym,
            "index_value": idx["value"] if idx else None,
            **perf,
            "constituents": len(members),
            "advancers": adv,
            "decliners": dec,
            "flow_1d_cr": flow_1d,
            "flow_5d_cr": flow_5d,
            "top_gainer": ({k: top_gainer[k] for k in ("ticker", "pct_1d")} if top_gainer else None),
            "top_loser": ({k: top_loser[k] for k in ("ticker", "pct_1d")} if top_loser else None),
            "stocks": sorted(members, key=lambda m: (m["pct_1d"] is not None, m["pct_1d"] or 0), reverse=True),
        })
    sectors.sort(key=lambda s: (s["change_1d"] is not None, s["change_1d"] or 0), reverse=True)

    bench_idx = indices.get(BENCHMARK[1])
    if bench_idx:
        bench = {
            "name": BENCHMARK[0], "index": BENCHMARK[1],
            "value": bench_idx["value"], "change_1d": bench_idx["change_1d"],
            "change_5d": bench_idx["change_5d"], "change_1m": bench_idx["change_1m"],
            "daily_changes": bench_idx["daily_changes"],
        }
    else:
        bench = {"name": BENCHMARK[0], "index": BENCHMARK[1], "value": None,
                 "change_1d": None, "change_5d": None, "change_1m": None,
                 "daily_changes": []}
    all_members = [s for s in stocks.values() if s]
    all_pcts = [m["pct_1d"] for m in all_members if m["pct_1d"] is not None]
    out = {
        "as_of": max((m["date"] for m in all_members), default=None),
        "benchmark": bench,
        "advancers": sum(1 for p in all_pcts if p > 0),
        "decliners": sum(1 for p in all_pcts if p < 0),
        "unchanged": sum(1 for p in all_pcts if p == 0),
        "total_flow_1d_cr": round(sum(m["flow_1d_cr"] or 0.0 for m in all_members), 2),
        "total_flow_5d_cr": round(sum(m["flow_5d_cr"] or 0.0 for m in all_members), 2),
        "scanned": len(all_members),
        "sectors": sectors,
    }

    # as_of = latest session date seen across constituents
    cache.set("sectors-overview", out, ttl=300)
    return out
