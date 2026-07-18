"""
Lightweight SQLite database layer using Python's built-in sqlite3.
No ORM, no new dependencies beyond stdlib.

DB path priority:
  1. DATABASE_PATH env var (set this in Render to /var/data/tradeassist.db)
  2. /var/data/tradeassist.db  (Render persistent disk mount point)
  3. <backend_dir>/tradeassist.db  (local dev fallback)
"""
import os
import sqlite3
from pathlib import Path

def _resolve_db_path() -> Path:
    # Explicit override via env var
    env = os.getenv("DATABASE_PATH", "").strip()
    if env:
        p = Path(env)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    # Render persistent disk convention
    render_path = Path("/var/data/tradeassist.db")
    if render_path.parent.exists():
        return render_path
    # Local dev fallback
    return Path(__file__).parent / "tradeassist.db"

DB_PATH = _resolve_db_path()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create/migrate tables. Safe to call repeatedly (all IF NOT EXISTS)."""
    with get_conn() as conn:
        # ── Users ─────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           TEXT PRIMARY KEY,          -- UUID
                email        TEXT UNIQUE NOT NULL,
                username     TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at   TEXT NOT NULL,             -- ISO-8601
                is_active    INTEGER NOT NULL DEFAULT 1
            )
        """)

        # ── Pinned trades (user-scoped) ────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pinned_trades (
                id            TEXT PRIMARY KEY,
                user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                ticker        TEXT NOT NULL,
                company_name  TEXT NOT NULL,
                trade_type    TEXT NOT NULL CHECK (trade_type IN ('BTST','Recommendation')),
                verdict       TEXT NOT NULL,
                entry_price   REAL NOT NULL,
                target_price  REAL NOT NULL,
                stop_loss     REAL NOT NULL,
                risk_reward   REAL NOT NULL,
                confidence    REAL NOT NULL,
                pinned_at     TEXT NOT NULL,
                note          TEXT NOT NULL DEFAULT ''
            )
        """)

        # Add user_id to existing table if migrating from old schema
        try:
            conn.execute("ALTER TABLE pinned_trades ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'")
        except Exception:
            pass  # column already exists

        # ── Pine Script Strategies (user-scoped) ──────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pine_strategies (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name         TEXT NOT NULL,
                description  TEXT NOT NULL DEFAULT '',
                script       TEXT NOT NULL,
                is_builtin   INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
        """)

        conn.commit()
