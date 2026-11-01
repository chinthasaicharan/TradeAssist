"""
/api/auth  — register, login, me
JWT-based auth, 3-day expiry, bcrypt passwords. Users live in hosted
Postgres (Neon) via db_postgres; 503 when DATABASE_URL is not configured.

NOTE: no `from __future__ import annotations` here — string annotations
break FastAPI's type resolution when slowapi's limiter decorator wraps the
endpoint (the wrapper's __globals__ is slowapi's module, not this one).
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, EmailStr, field_validator

from db_postgres import get_pg, init_postgres, postgres_enabled
from ratelimit import limiter

router = APIRouter()
bearer    = HTTPBearer(auto_error=True)    # for required-auth endpoints
bearer_opt = HTTPBearer(auto_error=False)  # for optional-auth endpoints

# ── Config ────────────────────────────────────────────────────────────────────

SECRET_KEY  = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
ALGORITHM   = "HS256"
TOKEN_DAYS  = 3


# ── Pydantic models ───────────────────────────────────────────────────────────

class RegisterIn(BaseModel):
    email:    EmailStr
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_clean(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("Username may only contain letters, numbers, hyphens, underscores")
        return v

    @field_validator("password")
    @classmethod
    def password_strong(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class LoginIn(BaseModel):
    login:    str   # email or username
    password: str


class UserOut(BaseModel):
    id:         str
    email:      str
    username:   str
    created_at: str


class TokenOut(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int  # seconds
    user:         UserOut


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=12)).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _create_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _decode_token(token: str) -> str:
    """Returns user_id or raises HTTPException 401."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise ValueError
        return user_id
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _require_pg() -> None:
    """503 unless Postgres is configured and reachable."""
    if not postgres_enabled():
        raise HTTPException(status_code=503, detail="Auth not configured (DATABASE_URL missing)")
    try:
        init_postgres()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Auth database unavailable: {e}")


def _user_out(row) -> UserOut:
    return UserOut(id=row["id"], email=row["email"], username=row["username"],
                   created_at=row["created_at"])


# ── Dependencies — use in any route ──────────────────────────────────────────

def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(bearer)]
) -> dict:
    """FastAPI dependency. Returns user row dict or raises 401."""
    user_id = _decode_token(creds.credentials)
    _require_pg()
    with get_pg() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = %s AND is_active", (user_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return row


def get_optional_user(
    creds: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_opt)],
) -> Optional[dict]:
    """
    User row dict when a valid Bearer token is present, else None.
    Never raises 401 — for endpoints that serve both anon and logged-in users.
    """
    if creds is None:
        return None
    try:
        user_id = _decode_token(creds.credentials)
    except HTTPException:
        return None
    if not postgres_enabled():
        return None
    try:
        with get_pg() as conn:
            return conn.execute(
                "SELECT * FROM users WHERE id = %s AND is_active", (user_id,)
            ).fetchone()
    except Exception:
        return None   # DB hiccup → treat as anon rather than failing the request


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/auth/register", response_model=TokenOut, status_code=201)
@limiter.limit("10/minute")
def register(request: Request, body: RegisterIn):
    _require_pg()
    now     = datetime.now(timezone.utc).isoformat()
    user_id = str(uuid.uuid4())

    try:
        with get_pg() as conn:
            existing = conn.execute(
                "SELECT id FROM users WHERE email = %s OR username = %s",
                (body.email, body.username),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Email or username already taken")

            conn.execute(
                "INSERT INTO users (id, email, username, password_hash, created_at) VALUES (%s,%s,%s,%s,%s)",
                (user_id, body.email, body.username, _hash_password(body.password), now),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Email or username already taken")

    token = _create_token(user_id)
    return TokenOut(access_token=token, expires_in=TOKEN_DAYS * 86400, user=_user_out(row))


@router.post("/api/auth/login", response_model=TokenOut)
@limiter.limit("10/minute")
def login(request: Request, body: LoginIn):
    _require_pg()
    with get_pg() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE (email = %s OR username = %s) AND is_active",
            (body.login, body.login),
        ).fetchone()

    if not row or not _verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = _create_token(row["id"])
    return TokenOut(access_token=token, expires_in=TOKEN_DAYS * 86400, user=_user_out(row))


@router.get("/api/auth/me", response_model=UserOut)
def me(current_user: Annotated[dict, Depends(get_current_user)]):
    return _user_out(current_user)
