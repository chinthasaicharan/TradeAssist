"""
fno_analysis.py — normalise Kotak Neo option-chain payloads and derive
positioning analytics: PCR, max pain, OI buildup, support/resistance and a
sentiment score. Pure functions — no network, no SDK.
"""
from __future__ import annotations

# Index underlyings offered as quick chips; stock options work too when the
# user types/uses the stock list (Neo pSymbolName = e.g. RELIANCE).
INDEX_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]
STOCK_UNDERLYINGS = [
    "RELIANCE", "HDFCBANK", "ICICIBANK", "SBIN", "TCS", "INFY",
    "TATASTEEL", "AXISBANK", "LT", "TITAN",
]

UNDERLYINGS = INDEX_UNDERLYINGS + STOCK_UNDERLYINGS


def _f(v) -> float | None:
    try:
        f = float(v)
        return None if f != f else f          # NaN guard
    except (TypeError, ValueError):
        return None


def _i(v) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ── Normalisation ─────────────────────────────────────────────────────────────

def _side(entry: dict) -> dict | None:
    inst = entry.get("instrument") or {}
    q = entry.get("quote") or {}
    oi = entry.get("openInterest") or {}
    ltp = _f(q.get("ltp"))
    prev = _f(q.get("prevClose") or q.get("close"))
    if ltp is None and prev is None and _i(oi.get("current")) is None:
        return None
    return {
        "symbol":     inst.get("symbol") or inst.get("neoSymbol") or "",
        "ltp":        ltp,
        "prev_close": prev,
        "volume":     _i(q.get("volume")) or 0,
        "oi":         _i(oi.get("current")) or 0,
        "oi_change":  _i(oi.get("change")) or 0,
        "moneyness":  inst.get("moneyness") or None,
    }


def normalise_chain(raw: dict, underlying: str, expiry: str | None) -> dict:
    """Kotak raw payload → {underlying, expiry, lot_size, spot_est, strikes[]}.

    Strikes are merged CE+PE rows sorted ascending; sides with no data are None.
    `spot_est` is the ATM strike when Neo tags one (exact spot needs the quotes
    API / a full session), else None.
    """
    data = (raw.get("data") if isinstance(raw.get("data"), dict) else raw) or {}
    common = data.get("common_data") or {}

    rows: dict[float, dict] = {}

    def put(e: dict, kind: str):
        inst = e.get("instrument") or {}
        k = _f(inst.get("strikePrice"))
        if k is None:
            return
        row = rows.setdefault(k, {"strike": k, "ce": None, "pe": None})
        s = _side(e)
        if s is not None:
            row[kind] = s

    for e in (data.get("call") or []):
        put(e, "ce")
    for e in (data.get("put") or []):
        put(e, "pe")

    strikes = [rows[k] for k in sorted(rows)]
    spot_est = None
    for row in strikes:
        for side in ("ce", "pe"):
            if row[side] and row[side].get("moneyness") == "ATM":
                spot_est = row["strike"]
                break
        if spot_est is not None:
            break

    return {
        "underlying": underlying,
        "expiry": expiry or common.get("expiry") or common.get("expiryDate") or None,
        "source": "kotak",
        "lot_size": _i(common.get("lotSize") or common.get("lot_size")),
        "spot_est": spot_est,
        "strikes": strikes,
    }


# ── Analytics ─────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def max_pain(strikes: list[dict]) -> float | None:
    """Strike minimizing total option-holder payout at expiry."""
    best, best_pain = None, None
    for s in strikes:
        settle = s["strike"]
        payout = 0.0
        for row in strikes:
            k = row["strike"]
            if row["ce"] and row["ce"]["oi"]:
                payout += row["ce"]["oi"] * max(0.0, settle - k)
            if row["pe"] and row["pe"]["oi"]:
                payout += row["pe"]["oi"] * max(0.0, k - settle)
        if best_pain is None or payout < best_pain:
            best_pain, best = payout, settle
    return best


def _buildup(side: dict) -> str | None:
    """Classify one option's OI/price action: long buildup, short buildup,
    short covering or long unwinding."""
    price_up = None
    if side.get("ltp") is not None and side.get("prev_close"):
        price_up = side["ltp"] > side["prev_close"]
    oi_up = (side.get("oi_change") or 0) > 0
    oi_down = (side.get("oi_change") or 0) < 0
    if price_up is None or not (oi_up or oi_down):
        return None
    if oi_up:
        return "long buildup" if price_up else "short buildup"
    return "short covering" if price_up else "long unwinding"


# direction each classification pushes the underlying (CE side / PE side)
_BIAS = {
    "ce": {"long buildup": 1, "short covering": 1, "short buildup": -1, "long unwinding": -1},
    "pe": {"short buildup": 1, "short covering": 1, "long buildup": -1, "long unwinding": -1},
}


def _dominant_buildup(strikes: list[dict], kind: str) -> tuple[str | None, float]:
    """(dominant classification, bias in [-1, 1]) weighted by |ΔOI|."""
    tally: dict[str, float] = {}
    for row in strikes:
        side = row.get(kind)
        if not side:
            continue
        b = _buildup(side)
        if b:
            tally[b] = tally.get(b, 0.0) + abs(side.get("oi_change") or 0)
    total = sum(tally.values())
    if not total:
        return None, 0.0
    top = max(tally, key=tally.get)
    dom = _BIAS[kind][top]
    # dominant share × direction, softened
    share = tally[top] / total
    return top, dom * share


def analyse(chain: dict) -> dict:
    """Positioning analytics over a normalised chain."""
    strikes = chain.get("strikes") or []
    with_oi = [r for r in strikes if (r["ce"] and r["ce"]["oi"]) or (r["pe"] and r["pe"]["oi"])]
    if not with_oi:
        return {"error": "no open-interest data in chain"}

    total_ce_oi = sum(r["ce"]["oi"] for r in strikes if r["ce"])
    total_pe_oi = sum(r["pe"]["oi"] for r in strikes if r["pe"])
    total_ce_chg = sum(r["ce"]["oi_change"] for r in strikes if r["ce"])
    total_pe_chg = sum(r["pe"]["oi_change"] for r in strikes if r["pe"])
    pcr = round(total_pe_oi / total_ce_oi, 3) if total_ce_oi else None

    pain = max_pain(with_oi)
    ref = chain.get("spot_est") or pain
    atm = chain.get("spot_est")

    # OI-concentration levels: top PE OI at/below ref = supports, top CE OI
    # at/above ref = resistances
    pe_rows = sorted(
        ({"strike": r["strike"], "oi": r["pe"]["oi"]} for r in strikes
         if r["pe"] and r["pe"]["oi"] and (ref is None or r["strike"] <= ref * 1.001)),
        key=lambda x: -x["oi"])
    ce_rows = sorted(
        ({"strike": r["strike"], "oi": r["ce"]["oi"]} for r in strikes
         if r["ce"] and r["ce"]["oi"] and (ref is None or r["strike"] >= ref * 0.999)),
        key=lambda x: -x["oi"])

    ce_dom, ce_bias = _dominant_buildup(strikes, "ce")
    pe_dom, pe_bias = _dominant_buildup(strikes, "pe")

    # sentiment score −100..100
    score = 0.0
    if pcr is not None:
        score += _clamp((pcr - 1.0) * 30, -25, 25)
    total_oi = total_ce_oi + total_pe_oi
    if total_oi:
        score += _clamp((total_pe_chg - total_ce_chg) / total_oi * 50, -25, 25)
    if pain and ref:
        score += _clamp((ref / pain - 1) * 200, -20, 20)
    score += _clamp((pe_bias + ce_bias) * 10, -20, 20)
    score = int(round(_clamp(score, -100, 100)))

    if score >= 50:    sentiment = "Strong Bullish"
    elif score >= 20:  sentiment = "Bullish"
    elif score <= -50: sentiment = "Strong Bearish"
    elif score <= -20: sentiment = "Bearish"
    else:              sentiment = "Neutral"

    notes: list[str] = []
    if pcr is not None:
        notes.append(f"PCR (OI) {pcr:.2f} — {'put writers dominant (bullish)' if pcr > 1.1 else 'call writers dominant (bearish)' if pcr < 0.9 else 'balanced'}")
    notes.append(f"Max pain at {pain:g}" if pain is not None else "Max pain unavailable")
    if ce_dom:
        notes.append(f"Call side: {ce_dom} across strikes")
    if pe_dom:
        notes.append(f"Put side: {pe_dom} across strikes")
    if pe_rows:
        notes.append(f"Strongest put OI (support) at {pe_rows[0]['strike']:g}")
    if ce_rows:
        notes.append(f"Strongest call OI (resistance) at {ce_rows[0]['strike']:g}")

    return {
        "pcr_oi": pcr,
        "total_ce_oi": total_ce_oi,
        "total_pe_oi": total_pe_oi,
        "total_ce_oi_change": total_ce_chg,
        "total_pe_oi_change": total_pe_chg,
        "max_pain": pain,
        "atm": atm,
        "supports": pe_rows[:3],
        "resistances": ce_rows[:3],
        "call_buildup": ce_dom,
        "put_buildup": pe_dom,
        "buildup_bias": round((ce_bias + pe_bias) / 2, 3),
        "sentiment": sentiment,
        "sentiment_score": score,
        "notes": notes,
        "strikes_analysed": len(with_oi),
    }
