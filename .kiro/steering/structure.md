# Project Structure

```
TradeAssist/
├── backend/
│   ├── main.py              # FastAPI app entry point — CORS, rate limiting, router registration, lifespan
│   ├── models.py            # All Pydantic response models (single source of truth for API shapes)
│   ├── database.py          # SQLite connection, init_db(), schema migrations (raw sqlite3, no ORM)
│   ├── cache.py             # In-memory TTL cache — get/set/clear helpers
│   ├── yf_client.py         # yfinance wrapper / helpers
│   ├── requirements.txt
│   ├── .env                 # Local secrets (gitignored)
│   ├── .env.example         # Committed template
│   ├── tradeassist.db       # SQLite database file (gitignored)
│   └── routers/
│       ├── __init__.py
│       ├── auth.py          # POST /auth/register, /auth/login, GET /auth/me
│       ├── market.py        # Quote, fundamentals, financials, technical, trend, screener,
│       │                    #   valuation, cashflow, recommendation, holdings, btst, swing,
│       │                    #   chart, orb-scanner
│       ├── search.py        # GET /api/search — Nifty 500 autocomplete; startup_load()
│       ├── insights.py      # POST /api/insights/:ticker — GPT-4o-mini SWOT
│       ├── chat.py          # POST /api/chat/:ticker — AI chat assistant
│       ├── trades.py        # Pinned trades CRUD (user-scoped)
│       └── strategies.py    # Pine Script strategies CRUD + fork
│
└── frontend/
    ├── index.html
    ├── vite.config.ts       # /api proxy → :8000
    ├── tailwind.config.js
    ├── package.json
    └── src/
        ├── main.tsx         # React root mount
        ├── App.tsx          # Root component — layout, section toggle, favourites, auth gate
        ├── AuthContext.tsx  # React context for auth state (user, login, logout, loading)
        ├── api.ts           # All API call functions (axios, one function per endpoint)
        ├── types.ts         # TypeScript interfaces mirroring backend Pydantic models
        ├── utils.ts         # Shared formatting/utility helpers
        ├── tradeTracker.ts  # Paper trades logic (localStorage-backed)
        ├── index.css        # Tailwind base + global styles
        └── components/
            ├── AuthPage.tsx
            ├── StockSearch.tsx
            ├── QuoteHeader.tsx
            ├── FundamentalsPanel.tsx
            ├── ProfitRevenuePanel.tsx
            ├── ValuationPanel.tsx
            ├── CashFlowPanel.tsx
            ├── TechnicalPanel.tsx
            ├── TrendPanel.tsx
            ├── RecommendationPanel.tsx
            ├── AIInsightsPanel.tsx
            ├── ScreenerPanel.tsx
            ├── HoldingsPanel.tsx
            ├── BTSTPanel.tsx
            ├── SwingPanel.tsx
            ├── SwingSearchWidget.tsx
            ├── ChartPanel.tsx
            ├── ORBScannerPanel.tsx
            ├── PineScriptPanel.tsx
            ├── PaperTradesPanel.tsx
            ├── PinnedTradesPanel.tsx
            ├── ChatWidget.tsx
            ├── Logo.tsx
            └── Skeleton.tsx
```

## Key Conventions

### Backend

- **One router per domain** — add new feature endpoints to an existing router or create a new file in `routers/`, then register it in `main.py`.
- **All response shapes defined in `models.py`** — never define Pydantic models inline inside routers.
- **Cache everything expensive** — use `cache.get(key)` / `cache.set(key, value, ttl)` around yfinance calls. Default TTL is 300s.
- **Auth is JWT Bearer** — protected routes use a `get_current_user` dependency from `routers/auth.py`. User data is scoped by `user_id`.
- **No ORM** — database access uses raw `sqlite3` via `database.get_conn()`. Always use parameterised queries.
- **Rate limiting** — apply `@limiter.limit("N/minute")` decorator on any public/expensive endpoint.

### Frontend

- **One component per panel** — each dashboard section maps 1:1 to a component in `src/components/`.
- **All API calls in `api.ts`** — components never import axios directly; they call typed functions from `api.ts`.
- **Types in `types.ts`** — all API response interfaces live here, mirroring backend models. Keep them in sync when models change.
- **Data fetching via React Query** — use `useQuery` with a stable `queryKey` of `[endpoint, ticker]`. Set `staleTime` to avoid redundant refetches (5–60 min depending on data volatility).
- **Error boundaries per panel** — wrap each panel in `<PanelBoundary name="...">` to prevent one failing panel from crashing the whole page.
- **Tailwind only** — no CSS modules or styled-components. Use the `panel` utility class for consistent card styling.
- **localStorage keys** are prefixed `ta_` (e.g., `ta_token`, `ta_last_ticker`, `ta_favourites`).
