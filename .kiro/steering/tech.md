# Tech Stack

## Backend

- **Runtime**: Python 3.x
- **Framework**: FastAPI 0.111.0
- **Server**: Uvicorn 0.29.0 (with standard extras)
- **Data validation**: Pydantic v2
- **Database**: SQLite via stdlib `sqlite3` (no ORM) — WAL mode, foreign keys enabled
- **Auth**: JWT via `python-jose`, passwords hashed with `bcrypt`
- **Rate limiting**: SlowAPI 0.1.9 (keyed by remote address)
- **Market data**: yfinance ≥0.2.50 + curl-cffi for scrape resilience
- **AI**: OpenAI Python SDK 1.0+ (GPT-4o-mini); rule-based fallback when no key
- **Caching**: Custom in-memory TTL cache (`cache.py`) — no Redis
- **Config**: `python-dotenv` — variables loaded from `backend/.env`
- **HTTP client**: httpx + requests

## Frontend

- **Framework**: React 19 + TypeScript 5.8
- **Build tool**: Vite 6
- **Styling**: Tailwind CSS 3
- **Data fetching**: TanStack React Query v5 + Axios
- **Charts**: Recharts 3 (bar/line), lightweight-charts 5 (candlestick)
- **Package manager**: npm

## Common Commands

### Backend

```bash
cd backend

# Create and activate virtualenv (first time)
python -m venv .venv
.venv\Scripts\activate        # Windows

# Install dependencies
pip install -r requirements.txt

# Run dev server
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Dev server (http://localhost:5173)
npm run dev

# Type-check + production build
npm run build

# Preview production build
npm run preview
```

## Environment Variables

File: `backend/.env` (copy from `backend/.env.example`)

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | No | Enables GPT-4o-mini SWOT; falls back to rule-based if absent |
| `FRONTEND_ORIGIN` | No | CORS allowed origin (default: `http://localhost:5173`) |

Frontend uses `VITE_API_URL` env var to point to a remote backend (e.g., Render). When absent, Vite proxies `/api` → `localhost:8000`.

## API Proxy

Vite dev server proxies all `/api/*` requests to `http://localhost:8000`. Configured in `frontend/vite.config.ts`.
