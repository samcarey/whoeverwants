"""Rate limiting middleware for FastAPI."""

import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory token bucket rate limiter.

    Limits are per-IP. Separate limits for read and write operations.
    """

    def __init__(
        self,
        app,
        read_rpm: int = 120,   # GET requests per minute per IP
        write_rpm: int = 30,   # POST/PUT/DELETE requests per minute per IP
    ):
        super().__init__(app)
        self.read_rpm = read_rpm
        self.write_rpm = write_rpm
        self._buckets: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _is_write(self, method: str) -> bool:
        return method.upper() in ("POST", "PUT", "PATCH", "DELETE")

    def _check_rate(self, key: str, limit: int) -> bool:
        """Return True if request is allowed, False if rate-limited."""
        now = time.monotonic()
        window = 60.0  # 1 minute

        with self._lock:
            timestamps = self._buckets[key]
            # Remove expired entries
            self._buckets[key] = [t for t in timestamps if now - t < window]
            timestamps = self._buckets[key]

            if len(timestamps) >= limit:
                return False
            timestamps.append(now)
            return True

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip rate limiting entirely if disabled (for testing)
        if os.environ.get("DISABLE_RATE_LIMIT") == "1":
            return await call_next(request)

        # Skip rate limiting for health checks
        if request.url.path == "/health":
            return await call_next(request)

        ip = self._get_client_ip(request)
        is_write = self._is_write(request.method)
        limit = self.write_rpm if is_write else self.read_rpm
        kind = "write" if is_write else "read"
        key = f"{ip}:{kind}"

        if not self._check_rate(key, limit):
            return Response(
                content='{"detail":"Rate limit exceeded. Try again later."}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": "60"},
            )

        return await call_next(request)
