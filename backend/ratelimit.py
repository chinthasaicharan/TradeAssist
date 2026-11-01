"""Shared slowapi limiter so routers can rate-limit without importing main."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
