import os
import math
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv

from routers import search, market, insights, chat, trades, strategies, auth, sectors, fno
from database import init_db
from db_postgres import init_postgres
from ratelimit import limiter

load_dotenv()


# ── Custom JSON serialiser — converts nan/inf/-inf → null ─────────────────
def _sanitise(obj):
    """Recursively replace non-finite floats with None so json.dumps never crashes."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitise(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitise(v) for v in obj]
    return obj


class SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        import json
        return json.dumps(_sanitise(content), ensure_ascii=False).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        init_postgres()          # no-op when DATABASE_URL is unset
    except Exception as e:
        logging.warning("Postgres init failed (auth will 503 until reachable): %s", e)
    await search.startup_load()
    yield


app = FastAPI(
    title="TradeAssist API",
    version="1.0.0",
    lifespan=lifespan,
    default_response_class=SafeJSONResponse,   # ← sanitise every response
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

# Build allowed origins list — include all Vercel preview URL patterns
allowed_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    frontend_origin,
]

# Also allow all vercel.app subdomains (covers preview deploys)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(market.router)
app.include_router(insights.router)
app.include_router(chat.router)
app.include_router(trades.router)
app.include_router(strategies.router)
app.include_router(sectors.router)
app.include_router(fno.router)
app.include_router(auth.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
