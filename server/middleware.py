"""Middleware for FastAPI: rate limiting + Phase B.3 browser_id capture."""

import os
import re
import time
import uuid
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


# uuid4 form, lowercase hex; rejects anything else so a hostile client can't
# inject a free-form value through the header.
_BROWSER_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


class BrowserIdMiddleware(BaseHTTPMiddleware):
    """Phase B.3: capture or mint a `browser_id` for the request.

    Reads the `X-Browser-Id` header (which the FE attaches from
    `lib/browserIdentity.ts`). When absent or malformed, the server mints a
    fresh uuid and returns it in the `X-Browser-Id` response header — first
    visit, the FE captures the response value and persists it to localStorage
    so future requests carry the same id.

    A header (rather than a cookie) is used because the FE talks to the API
    same-origin via Next.js rewrites in prod and via direct host in dev/CI;
    cookies under either setup would require flipping CORS to credentialed
    mode which doesn't compose with `allow_origins=["*"]`. The header avoids
    the entire CORS minefield while giving Phase C the same identity
    guarantee.

    Phase B.3 only captures; nothing on the read path enforces yet. Phase C
    will add the membership table and start gating visibility on this id.
    """

    def __init__(self, app, header_name: str = "X-Browser-Id"):
        super().__init__(app)
        self._header = header_name

    @staticmethod
    def _normalize(value: str | None) -> str | None:
        if not value:
            return None
        v = value.strip().lower()
        return v if _BROWSER_ID_RE.match(v) else None

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = self._normalize(request.headers.get(self._header))
        browser_id = incoming or str(uuid.uuid4())
        request.state.browser_id = browser_id

        response = await call_next(request)
        # Always echo the (possibly newly-minted) browser_id so the FE can
        # adopt server-assigned ids on first visit. A subsequent request
        # already carrying the id sees the same value echoed back, which is
        # cheap and keeps the response shape stable.
        response.headers[self._header] = browser_id
        return response


def browser_id_from_request(request: Request) -> str | None:
    """Read the browser_id captured by `BrowserIdMiddleware`. The middleware
    always sets the field for requests routed through the FastAPI app, but
    the `getattr` fallback covers direct `TestClient` instantiation and any
    rare path that bypasses middleware.
    """
    return getattr(request.state, "browser_id", None)
