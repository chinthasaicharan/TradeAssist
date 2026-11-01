"""
Strategy condition engine — evaluates user-defined indicator rules against
daily OHLCV history and generates an equivalent Pine Script v6 strategy.

Indicator math is imported from routers.market (the same helpers the
Technical panel uses) so numbers match across the app.

A "condition" is a dict: {"indicator": str, "operator": str, "value": float|str}
ALL conditions must pass (AND) for a strategy to match.
"""
from __future__ import annotations

import math

from routers.market import (
    clean_hist,
    compute_sma,
    _compute_atr,
    _compute_ema_series,
    _compute_macd_series,
    _compute_rsi_series,
    _compute_supertrend_series,
)

# ── Catalog ───────────────────────────────────────────────────────────────────

NUMERIC_OPS = ["gt", "lt", "gte", "lte", "eq", "cross_above", "cross_below"]
OP_LABEL = {"gt": ">", "lt": "<", "gte": "≥", "lte": "≤", "eq": "=",
            "cross_above": "crosses above", "cross_below": "crosses below"}

INDICATORS: dict[str, dict] = {
    "price":          {"label": "Price",                 "kind": "numeric"},
    "rsi":            {"label": "RSI (14)",              "kind": "numeric"},
    "price_vs_ma20":  {"label": "Price vs MA 20 (%)",    "kind": "numeric"},
    "price_vs_ma50":  {"label": "Price vs MA 50 (%)",    "kind": "numeric"},
    "price_vs_ma200": {"label": "Price vs MA 200 (%)",   "kind": "numeric"},
    "golden_cross":   {"label": "MA 50/200 cross",       "kind": "string",
                       "options": ["golden", "death"]},
    "macd_state":     {"label": "MACD vs signal",        "kind": "string",
                       "options": ["bullish", "bearish"]},
    "macd_cross":     {"label": "MACD crossover (last 5 sessions)", "kind": "string",
                       "options": ["bullish", "bearish", "none"]},
    "supertrend":     {"label": "Supertrend (10, 3)",    "kind": "string",
                       "options": ["bullish", "bearish"]},
    "volume_ratio":   {"label": "Volume vs 20d avg (x)", "kind": "numeric"},
    "momentum_52w":   {"label": "52-week momentum (%)",  "kind": "numeric"},
    "range_position": {"label": "52-week range position (%)", "kind": "numeric"},
    "atr_pct":        {"label": "ATR (14) as % of price", "kind": "numeric"},
}


def validate_condition(c: dict) -> str | None:
    """Returns an error message, or None when the condition is valid."""
    ind, op, val = c.get("indicator"), c.get("operator"), c.get("value")
    if ind not in INDICATORS:
        return f"Unknown indicator: {ind}"
    kind = INDICATORS[ind]["kind"]
    if kind == "numeric":
        if op not in NUMERIC_OPS:
            return f"Operator {op} not allowed for {ind}"
        if not isinstance(val, (int, float)) or isinstance(val, bool) or not math.isfinite(val):
            return f"{INDICATORS[ind]['label']} needs a numeric value"
    else:
        if op != "eq":
            return f"{INDICATORS[ind]['label']} only supports '='"
        if val not in INDICATORS[ind]["options"]:
            return f"{INDICATORS[ind]['label']} must be one of {INDICATORS[ind]['options']}"
    return None


# ── Context computation ───────────────────────────────────────────────────────

def _f(v) -> float:
    return float(v)


def compute_context(hist) -> dict:
    """
    Compute every indicator (last value + the series needed for crossover
    checks) from a daily OHLCV DataFrame. Rows with NaN are dropped first.
    """
    clean = clean_hist(hist)
    closes  = [_f(x) for x in clean["Close"].tolist()]
    highs   = [_f(x) for x in clean["High"].tolist()]
    lows    = [_f(x) for x in clean["Low"].tolist()]
    volumes = [_f(x) for x in clean["Volume"].tolist()]
    n = len(closes)
    if n < 30:
        raise ValueError(f"Not enough history ({n} bars) to evaluate conditions")

    price = closes[-1]

    ma20_s  = compute_sma(closes, 20)
    ma50_s  = compute_sma(closes, 50)
    ma200_s = compute_sma(closes, 200)
    ma20, ma50, ma200 = ma20_s[-1], ma50_s[-1], ma200_s[-1]

    vs = lambda ma: round((price / ma - 1) * 100, 2) if ma else None   # noqa: E731

    rsi_s = _compute_rsi_series(closes)

    macd_s, sig_s, _ = _compute_macd_series(closes)
    macd_state = "bullish" if (macd_s[-1] is not None and sig_s[-1] is not None
                               and macd_s[-1] > sig_s[-1]) else "bearish"
    # Crossover within the last 5 sessions?
    macd_cross = "none"
    for i in range(max(26, n - 5), n):
        a0, b0 = macd_s[i - 1], sig_s[i - 1]
        a1, b1 = macd_s[i], sig_s[i]
        if None in (a0, b0, a1, b1):
            continue
        if a0 <= b0 and a1 > b1:
            macd_cross = "bullish"
        elif a0 >= b0 and a1 < b1:
            macd_cross = "bearish"

    _, st_bull = _compute_supertrend_series(highs, lows, closes)

    vol_avg = sum(volumes[-20:]) / 20 if sum(volumes[-20:]) > 0 else 0.0
    volume_ratio = round(volumes[-1] / vol_avg, 2) if vol_avg > 0 else None

    base = closes[-252] if n >= 253 else closes[0]
    momentum_52w = round((price - base) / base * 100, 2)

    w = min(n, 252)
    lo52, hi52 = min(lows[-w:]), max(highs[-w:])
    range_position = round((price - lo52) / (hi52 - lo52) * 100, 1) if hi52 > lo52 else 50.0

    atr = _compute_atr(highs, lows, closes)
    atr_pct = round(atr / price * 100, 2) if price else None

    values = {
        "price": price,
        "rsi": rsi_s[-1],
        "price_vs_ma20": vs(ma20),
        "price_vs_ma50": vs(ma50),
        "price_vs_ma200": vs(ma200),
        "golden_cross": ("golden" if (ma50 and ma200 and ma50 > ma200)
                         else "death" if (ma50 and ma200) else None),
        "macd_state": macd_state,
        "macd_cross": macd_cross,
        "supertrend": "bullish" if st_bull[-1] else "bearish",
        "volume_ratio": volume_ratio,
        "momentum_52w": momentum_52w,
        "range_position": range_position,
        "atr_pct": atr_pct,
    }

    # Series needed for cross_above / cross_below checks
    vs_series = lambda ma_s: [                                              # noqa: E731
        round((c / m - 1) * 100, 2) if (c is not None and m is not None) else None
        for c, m in zip(closes, ma_s)
    ]
    series = {
        "price": closes,
        "rsi": rsi_s,
        "price_vs_ma20": vs_series(ma20_s),
        "price_vs_ma50": vs_series(ma50_s),
        "price_vs_ma200": vs_series(ma200_s),
        "volume_ratio": None,      # crosses not supported (noisy) — gt/lt only
        "momentum_52w": None,
        "range_position": None,
        "atr_pct": None,
    }

    return {"values": values, "series": series}


def _series_for(ind: str, ctx: dict) -> list[float | None]:
    """Rebuild a series for indicators whose cross checks need them."""
    return ctx["series"].get(ind) or []


def _check(rule: dict, ctx: dict) -> dict:
    ind, op = rule["indicator"], rule["operator"]
    val = rule["value"]
    meta = INDICATORS[ind]
    actual = ctx["values"].get(ind)

    if meta["kind"] == "string":
        passed = (op == "eq") and (actual is not None
                                   and str(val).lower() == str(actual).lower())
        return {"indicator": ind, "label": meta["label"], "actual": actual,
                "operator": op, "threshold": val, "passed": bool(passed)}

    if actual is None:
        return {"indicator": ind, "label": meta["label"], "actual": None,
                "operator": op, "threshold": val, "passed": False}

    # Crossover operators work on the indicator series around the threshold
    if op in ("cross_above", "cross_below"):
        s = _series_for(ind, ctx)
        passed = False
        lookback = range(max(1, len(s) - 5), len(s))
        for i in lookback:
            a, b = s[i - 1], s[i]
            if a is None or b is None:
                continue
            if op == "cross_above" and a <= val < b:
                passed = True; break
            if op == "cross_below" and a >= val > b:
                passed = True; break
        return {"indicator": ind, "label": meta["label"], "actual": actual,
                "operator": op, "threshold": val, "passed": passed}

    ops = {"gt": actual > val, "lt": actual < val, "gte": actual >= val,
           "lte": actual <= val, "eq": abs(actual - val) < 1e-9}
    return {"indicator": ind, "label": meta["label"], "actual": round(actual, 2),
            "operator": op, "threshold": val, "passed": bool(ops[op])}


def evaluate_conditions(conditions: list[dict], hist) -> dict:
    """
    Evaluate all conditions against OHLCV history.
    Returns {"passed": bool, "results": [...], "context": {...latest values}}.
    """
    ctx = compute_context(hist)
    results = [_check(c, ctx) for c in conditions]
    return {
        "passed": bool(results) and all(r["passed"] for r in results),
        "results": results,
        "context": {k: v for k, v in ctx["values"].items()},
    }


# ── Pine Script generation ────────────────────────────────────────────────────

def _fmt(v) -> str:
    if isinstance(v, str):
        return v
    return f"{v:g}" if isinstance(v, float) else str(v)


def _rule_text(rule: dict) -> str:
    ind, op, val = rule["indicator"], rule["operator"], rule["value"]
    meta = INDICATORS[ind]
    if meta["kind"] == "string":
        return f"{meta['label']} is {val}"
    return f"{meta['label']} {OP_LABEL[op]} {_fmt(val)}"


def _pine_expr(rule: dict) -> str:
    ind, op, val = rule["indicator"], rule["operator"], rule["value"]
    if ind == "price":
        if op == "cross_above":
            return f"ta.crossover(close, {val})"
        if op == "cross_below":
            return f"ta.crossunder(close, {val})"
        return f"close {OP_LABEL[op]} {val}"
    if ind == "rsi":
        return f"rsiVal {OP_LABEL[op]} {val}"
    if ind.startswith("price_vs_ma"):
        ma = {"price_vs_ma20": "ma20", "price_vs_ma50": "ma50",
              "price_vs_ma200": "ma200"}[ind]
        if op == "cross_above":
            return f"ta.crossover(close, {ma})"
        if op == "cross_below":
            return f"ta.crossunder(close, {ma})"
        return f"(close / {ma} - 1) * 100 {OP_LABEL[op]} {val}"
    if ind == "golden_cross":
        return f"ma50 > ma200" if val == "golden" else f"ma50 < ma200"
    if ind == "macd_state":
        return "macdLine > sigLine" if val == "bullish" else "macdLine < sigLine"
    if ind == "macd_cross":
        if val == "bullish":
            return "ta.crossover(macdLine, sigLine)"
        if val == "bearish":
            return "ta.crossunder(macdLine, sigLine)"
        return ("nz(ta.barssince(ta.crossover(macdLine, sigLine)), 9999) > 5 and "
                "nz(ta.barssince(ta.crossunder(macdLine, sigLine)), 9999) > 5")
    if ind == "supertrend":
        return "stBull" if val == "bullish" else "not stBull"
    if ind == "volume_ratio":
        return f"volume > volAvg * {val}"
    if ind == "momentum_52w":
        return f"(close[252] > 0 ? (close / close[252] - 1) * 100 : 0) {OP_LABEL[op]} {val}"
    if ind == "range_position":
        return f"(close - lo252) / math.max(hi252 - lo252, 0.0001) * 100 {OP_LABEL[op]} {val}"
    if ind == "atr_pct":
        return f"atrVal / close * 100 {OP_LABEL[op]} {val}"
    return "false"


def generate_pine(name: str, description: str, conditions: list[dict]) -> str:
    """Generate a Pine v6 strategy from conditions (long when ALL rules true)."""
    safe_name = name.replace('"', "'")
    lines = [
        "//@version=6",
        f'strategy("{safe_name}", overlay=true, '
        "default_qty_type=strategy.percent_of_equity, default_qty_value=10)",
        "",
        f"// ── Generated by TradeAssist — {safe_name}",
    ]
    if description:
        for dline in description.splitlines()[:4]:
            lines.append(f"// {dline}")
    lines.append("// All conditions must be true (AND) to stay long.")
    lines += ["", "// ── Indicators"]
    lines += [
        "rsiVal   = ta.rsi(close, 14)",
        "ma20     = ta.sma(close, 20)",
        "ma50     = ta.sma(close, 50)",
        "ma200    = ta.sma(close, 200)",
        "[stLine, stDir] = ta.supertrend(3.0, 10)",
        "stBull   = stDir < 0",
        "macdLine = ta.ema(close, 12) - ta.ema(close, 26)",
        "sigLine  = ta.ema(macdLine, 9)",
        "volAvg   = ta.sma(volume, 20)",
        "atrVal   = ta.atr(14)",
        "hi252    = ta.highest(high, 252)",
        "lo252    = ta.lowest(low, 252)",
        "",
        "// ── Conditions",
    ]
    exprs = []
    for i, rule in enumerate(conditions):
        lines.append(f"// • {_rule_text(rule)}")
        lines.append(f"c{i} = {_pine_expr(rule)}")
        exprs.append(f"c{i}")
    lines.append(f"allCond = {' and '.join(exprs) if exprs else 'true'}")
    lines += [
        "",
        "if allCond and strategy.position_size == 0",
        '    strategy.entry("Long", strategy.long)',
        "if not allCond and strategy.position_size > 0",
        '    strategy.close("Long")',
        "",
        'plot(ma20,  "MA 20",  color=color.new(color.orange, 40))',
        'plot(ma50,  "MA 50",  color=color.new(color.blue, 40))',
        'plot(ma200, "MA 200", color=color.new(color.red, 40))',
    ]
    return "\n".join(lines)
