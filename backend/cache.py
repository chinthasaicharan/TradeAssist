"""Simple in-memory TTL cache."""
import time
from typing import Any

_store: dict[str, tuple[Any, float]] = {}


def get(key: str) -> Any | None:
    entry = _store.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.time() > expires_at:
        del _store[key]
        return None
    return value


def set(key: str, value: Any, ttl: int = 300) -> None:
    _store[key] = (value, time.time() + ttl)


def clear() -> None:
    _store.clear()
