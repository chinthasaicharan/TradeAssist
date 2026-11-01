"""
Postgres (Neon) layer for the users table — auth data lives in hosted
Postgres; user content (pinned trades, strategies) stays in SQLite on disk
(see database.py).

Enabled only when DATABASE_URL is set. Auth endpoints degrade to 503 without
it, so the app still runs locally with zero setup.
"""
from __future__ import annotations

import logging
import os

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger("db_postgres")


def database_url() -> str:
    return os.getenv("DATABASE_URL", "").strip()


def postgres_enabled() -> bool:
    return bool(database_url())


def get_pg() -> psycopg.Connection:
    """
    Fresh connection per call — auth traffic is tiny, and Neon's pooler
    (PgBouncer in transaction mode) rejects named prepared statements, so
    psycopg's auto-prepare is disabled.
    """
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL not set — Postgres disabled")
    conn = psycopg.connect(url, row_factory=dict_row, sslmode="require", connect_timeout=10)
    conn.prepare_threshold = None   # PgBouncer-safe
    return conn


_ensured = False


def init_postgres() -> bool:
    """Create the users table. Idempotent; returns True once ready."""
    global _ensured
    if _ensured or not postgres_enabled():
        return _ensured
    with get_pg() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,          -- UUID
                email         TEXT UNIQUE NOT NULL,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL,             -- ISO-8601
                is_active     BOOLEAN NOT NULL DEFAULT TRUE
            )
        """)
        conn.commit()
    _ensured = True
    log.info("Postgres users table ready")
    return True
