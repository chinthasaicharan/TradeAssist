"""
sector_map.py — static sector taxonomy for the Nifty 50 universe + helper
lookup for arbitrary tickers.

Two consumers:
  • routers/sectors.py   — sector dashboard (performance + money flows)
  • routers/strategies.py — tags scan rows with a sector so the UI can
                            filter scan results sector-wise

Taxonomy mirrors the NIFTY sector index families so each sector can show
authoritative index performance from Yahoo when a ticker exists:
  Banking & Financials   → ^NSEBANK      Automobile          → ^CNXAUTO
  Information Technology → ^CNXIT        Pharma & Healthcare → ^CNXPHARMA
  Oil, Gas & Energy      → ^CNXENERGY    Metals & Mining     → ^CNXMETAL
  FMCG                   → ^CNXFMCG      Infrastructure...   → ^CNXINFRA (best effort)

Sectors without a reliable Yahoo index (Cement, Consumer, Telecom, Defence)
fall back to an equal-weight mean of their constituents.
"""

from __future__ import annotations

# sector display name → Yahoo index ticker (None → constituents only)
SECTOR_INDICES: dict[str, str | None] = {
    "Banking & Financials":        "^NSEBANK",
    "Information Technology":      "^CNXIT",
    "Oil, Gas & Energy":           "^CNXENERGY",   # includes power utilities
    "FMCG":                        "^CNXFMCG",
    "Automobile":                  "^CNXAUTO",
    "Pharma & Healthcare":         "^CNXPHARMA",
    "Metals & Mining":             "^CNXMETAL",
    "Infrastructure & Industrials": "^CNXINFRA",
    "Cement & Materials":          None,
    "Consumer & Retail":           None,
    "Telecom & Internet":          None,
    "Defence & Aerospace":         None,
}

# display order for dashboards / filters (biggest weight first)
SECTOR_ORDER: list[str] = [
    "Banking & Financials",
    "Information Technology",
    "Oil, Gas & Energy",
    "FMCG",
    "Automobile",
    "Pharma & Healthcare",
    "Metals & Mining",
    "Infrastructure & Industrials",
    "Cement & Materials",
    "Consumer & Retail",
    "Telecom & Internet",
    "Defence & Aerospace",
]

# Nifty 50 constituents (+ TMCV.NS, the Tata Motors CV successor) → sector
NIFTY50_SECTOR_MAP: dict[str, str] = {
    # Banking & Financials
    "HDFCBANK.NS":   "Banking & Financials",
    "ICICIBANK.NS":  "Banking & Financials",
    "SBIN.NS":       "Banking & Financials",
    "KOTAKBANK.NS":  "Banking & Financials",
    "AXISBANK.NS":   "Banking & Financials",
    "INDUSINDBK.NS": "Banking & Financials",
    "BAJFINANCE.NS": "Banking & Financials",
    "BAJAJFINSV.NS": "Banking & Financials",
    "SHRIRAMFIN.NS": "Banking & Financials",
    # Information Technology
    "TCS.NS":        "Information Technology",
    "INFY.NS":       "Information Technology",
    "WIPRO.NS":      "Information Technology",
    "HCLTECH.NS":    "Information Technology",
    "TECHM.NS":      "Information Technology",
    # Oil, Gas & Energy (incl. power)
    "RELIANCE.NS":   "Oil, Gas & Energy",
    "ONGC.NS":       "Oil, Gas & Energy",
    "BPCL.NS":       "Oil, Gas & Energy",
    "COALINDIA.NS":  "Oil, Gas & Energy",
    "NTPC.NS":       "Oil, Gas & Energy",
    "POWERGRID.NS":  "Oil, Gas & Energy",
    # FMCG
    "HINDUNILVR.NS": "FMCG",
    "ITC.NS":        "FMCG",
    "NESTLEIND.NS":  "FMCG",
    "BRITANNIA.NS":  "FMCG",
    "DABUR.NS":      "FMCG",
    "TATACONSUM.NS": "FMCG",
    # Automobile
    "MARUTI.NS":     "Automobile",
    "EICHERMOT.NS":  "Automobile",
    "HEROMOTOCO.NS": "Automobile",
    "BAJAJ-AUTO.NS": "Automobile",
    "M&M.NS":        "Automobile",
    "TMCV.NS":       "Automobile",
    "TATAMOTORS.NS": "Automobile",   # demerged Oct 2025; fetches fail → skipped
    # Pharma & Healthcare
    "SUNPHARMA.NS":  "Pharma & Healthcare",
    "DRREDDY.NS":    "Pharma & Healthcare",
    "CIPLA.NS":      "Pharma & Healthcare",
    "DIVISLAB.NS":   "Pharma & Healthcare",
    # Metals & Mining
    "JSWSTEEL.NS":   "Metals & Mining",
    "TATASTEEL.NS":  "Metals & Mining",
    "HINDALCO.NS":   "Metals & Mining",
    # Infrastructure & Industrials
    "LT.NS":         "Infrastructure & Industrials",
    "ADANIENT.NS":   "Infrastructure & Industrials",
    "ADANIPORTS.NS": "Infrastructure & Industrials",
    # Cement & Materials
    "ULTRACEMCO.NS": "Cement & Materials",
    "GRASIM.NS":     "Cement & Materials",
    # Consumer & Retail
    "TITAN.NS":      "Consumer & Retail",
    "TRENT.NS":      "Consumer & Retail",
    # Telecom & Internet
    "BHARTIARTL.NS": "Telecom & Internet",
    "ETERNAL.NS":    "Telecom & Internet",
    # Defence & Aerospace
    "BEL.NS":        "Defence & Aerospace",
    "HAL.NS":        "Defence & Aerospace",
}

_tickers_by_sector: dict[str, list[str]] | None = None


def tickers_by_sector() -> dict[str, list[str]]:
    """Sector name → its Nifty 50 constituent tickers (stable order)."""
    global _tickers_by_sector
    if _tickers_by_sector is None:
        grouped: dict[str, list[str]] = {name: [] for name in SECTOR_ORDER}
        for ticker, sector in NIFTY50_SECTOR_MAP.items():
            grouped.setdefault(sector, []).append(ticker)
        _tickers_by_sector = grouped
    return _tickers_by_sector


async def get_sector_for(ticker: str) -> str | None:
    """Sector for any ticker: static map first, then Yahoo info (24h cache).

    Returns None when Yahoo doesn't classify the symbol. Custom-ticker scans
    use this so every scan row still carries a sector label.
    """
    t = ticker.upper()
    if t in NIFTY50_SECTOR_MAP:
        return NIFTY50_SECTOR_MAP[t]

    import cache
    key = f"sector-lookup:{t}"
    if (hit := cache.get(key)) is not None:
        return hit or None
    try:
        import yf_client as yfc
        info = await yfc.fetch_info(t)
        sector = (info or {}).get("sector")
    except Exception:
        sector = None
    cache.set(key, sector or "", ttl=86400)
    return sector or None
