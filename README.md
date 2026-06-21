# TradeAssist — Stock Analysis Dashboard

A full-stack stock analysis tool: React (Vite + TypeScript + Tailwind) frontend + Python FastAPI backend.

## Features

| Section | What you get |
|---|---|
| **Quote Header** | Live price, change, volume, market status |
| **Fundamentals** | P/E, EPS, Market Cap, Beta, ROE, Debt/Equity, 52-week range, sector/industry |
| **Revenue & Profit** | Annual / Quarterly bar+line charts (Recharts) |
| **AI Insights (SWOT)** | GPT-4o-mini SWOT analysis (or rule-based fallback if no API key) |
| **Support & Resistance** | Price chart with annotated support/resistance levels |
| **Trend Analysis** | RSI, MACD, SMA 50/200, short-term & long-term bias |
| **Similar Stocks Screener** | Sector peers ranked by similarity score |

---

## Quick Start

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
copy .env.example .env        # edit OPENAI_API_KEY if you have one
uvicorn main:app --reload --port 8000
```

Backend runs at **http://localhost:8000**

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:5173** (auto-proxies `/api` → backend)

---

## Configuration

Edit `backend/.env`:

```
OPENAI_API_KEY=sk-...       # Optional — enables AI SWOT via GPT-4o-mini
FRONTEND_ORIGIN=http://localhost:5173
```

Without an OpenAI key the app still works — SWOT falls back to a rule-based analysis derived from the stock's fundamentals.

---

## Project Structure

```
TradeAssist/
├── backend/
│   ├── main.py              # FastAPI app, CORS, rate limiting
│   ├── models.py            # Pydantic response models
│   ├── cache.py             # In-memory TTL cache
│   ├── routers/
│   │   ├── search.py        # GET /api/search
│   │   ├── market.py        # quote, fundamentals, financials, technical, trend, screener
│   │   └── insights.py      # POST /api/insights/:ticker (SWOT)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── api.ts
    │   ├── types.ts
    │   ├── utils.ts
    │   └── components/
    │       ├── StockSearch.tsx
    │       ├── QuoteHeader.tsx
    │       ├── FundamentalsPanel.tsx
    │       ├── ProfitRevenuePanel.tsx
    │       ├── AIInsightsPanel.tsx
    │       ├── TechnicalPanel.tsx
    │       ├── TrendPanel.tsx
    │       └── ScreenerPanel.tsx
    ├── vite.config.ts       # /api proxy → :8000
    ├── tailwind.config.js
    └── package.json
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/search?q=` | Autocomplete ticker search |
| GET | `/api/quote/:ticker` | Live quote + market status |
| GET | `/api/fundamentals/:ticker` | Key financial metrics |
| GET | `/api/financials/:ticker` | Revenue/profit annual + quarterly |
| GET | `/api/technical/:ticker` | Support/resistance levels + price history |
| GET | `/api/trend/:ticker` | RSI, MACD, SMA signals + trend bias |
| GET | `/api/screener/:ticker` | Similar stocks by sector + fundamentals |
| POST | `/api/insights/:ticker` | AI SWOT analysis |

## Data Sources

- **Market data**: [yfinance](https://github.com/ranaroussi/yfinance) (free, no API key needed)
- **AI analysis**: OpenAI GPT-4o-mini (optional — rule-based fallback available)
