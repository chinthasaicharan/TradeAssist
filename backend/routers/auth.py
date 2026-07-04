"""
/api/auth  — register, login, me
JWT-based auth, 3-day expiry, bcrypt passwords.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, field_validator

from database import get_conn

router = APIRouter()
bearer = HTTPBearer()

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


class TokenOut(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int  # seconds
    user:         UserOut


class UserOut(BaseModel):
    id:         str
    email:      str
    username:   str
    created_at: str


# Fix forward reference
TokenOut.model_rebuild()


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


# ── Dependency — use in any protected route ───────────────────────────────────

def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(bearer)]
) -> dict:
    """FastAPI dependency. Returns user row dict or raises 401."""
    user_id = _decode_token(creds.credentials)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found or deactivated")
    return dict(row)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/api/auth/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn):
    now     = datetime.now(timezone.utc).isoformat()
    user_id = str(uuid.uuid4())

    with get_conn() as conn:
        # Check uniqueness
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ? OR username = ?",
            (body.email, body.username),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email or username already taken")

        conn.execute(
            "INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?,?,?,?,?)",
            (user_id, body.email, body.username, _hash_password(body.password), now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    token = _create_token(user_id)
    user  = UserOut(id=row["id"], email=row["email"], username=row["username"], created_at=row["created_at"])
    return TokenOut(access_token=token, expires_in=TOKEN_DAYS * 86400, user=user)


@router.post("/api/auth/login", response_model=TokenOut)
def login(body: LoginIn):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE (email = ? OR username = ?) AND is_active = 1",
            (body.login, body.login),
        ).fetchone()

    if not row or not _verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = _create_token(row["id"])
    user  = UserOut(id=row["id"], email=row["email"], username=row["username"], created_at=row["created_at"])
    return TokenOut(access_token=token, expires_in=TOKEN_DAYS * 86400, user=user)


@router.get("/api/auth/me", response_model=UserOut)
def me(current_user: Annotated[dict, Depends(get_current_user)]):
    return UserOut(
        id=current_user["id"],
        email=current_user["email"],
        username=current_user["username"],
        created_at=current_user["created_at"],
    )
