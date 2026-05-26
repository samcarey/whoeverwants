"""Tests for rate-limiting and browser-id middleware."""

import asyncio
import re
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from middleware import BrowserIdMiddleware, RateLimitMiddleware


class FakeRequest:
    def __init__(self, method="GET", path="/api/questions", client_ip="1.2.3.4"):
        self.method = method
        self.url = MagicMock()
        self.url.path = path
        self.headers = {}
        self.client = MagicMock()
        self.client.host = client_ip


class TestRateLimitMiddleware:
    def setup_method(self):
        self.app = MagicMock()
        self.middleware = RateLimitMiddleware(self.app, read_rpm=5, write_rpm=2)

    def test_check_rate_allows_within_limit(self):
        for _ in range(5):
            assert self.middleware._check_rate("test_key", 5) is True

    def test_check_rate_blocks_over_limit(self):
        for _ in range(5):
            self.middleware._check_rate("test_key", 5)
        assert self.middleware._check_rate("test_key", 5) is False

    def test_check_rate_expires_old_entries(self):
        # Fill up the bucket
        for _ in range(5):
            self.middleware._check_rate("test_key", 5)
        assert self.middleware._check_rate("test_key", 5) is False

        # Manually expire entries by manipulating timestamps
        import threading
        with self.middleware._lock:
            self.middleware._buckets["test_key"] = [
                time.monotonic() - 61  # 61 seconds ago = expired
                for _ in range(5)
            ]

        # Should be allowed again
        assert self.middleware._check_rate("test_key", 5) is True

    def test_separate_read_write_limits(self):
        # Read limit is 5
        for _ in range(5):
            assert self.middleware._check_rate("1.2.3.4:read", 5) is True
        assert self.middleware._check_rate("1.2.3.4:read", 5) is False

        # Write limit is 2 — should be independent
        for _ in range(2):
            assert self.middleware._check_rate("1.2.3.4:write", 2) is True
        assert self.middleware._check_rate("1.2.3.4:write", 2) is False

    def test_different_ips_independent(self):
        for _ in range(5):
            self.middleware._check_rate("1.1.1.1:read", 5)
        assert self.middleware._check_rate("1.1.1.1:read", 5) is False
        # Different IP should still be allowed
        assert self.middleware._check_rate("2.2.2.2:read", 5) is True

    def test_get_client_ip_from_header(self):
        req = FakeRequest()
        req.headers["x-forwarded-for"] = "10.0.0.1, 10.0.0.2"
        assert self.middleware._get_client_ip(req) == "10.0.0.1"

    def test_get_client_ip_from_client(self):
        req = FakeRequest(client_ip="5.6.7.8")
        assert self.middleware._get_client_ip(req) == "5.6.7.8"

    def test_is_write_methods(self):
        assert self.middleware._is_write("POST") is True
        assert self.middleware._is_write("PUT") is True
        assert self.middleware._is_write("DELETE") is True
        assert self.middleware._is_write("PATCH") is True
        assert self.middleware._is_write("GET") is False
        assert self.middleware._is_write("HEAD") is False


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _run_browser_id(headers: dict | None) -> tuple[str, "MagicMock"]:
    """Run BrowserIdMiddleware.dispatch with fake request/response and return
    `(echoed_id, response_mock)`. Uses asyncio.run to drive the async path."""
    mw = BrowserIdMiddleware(MagicMock())
    request = MagicMock()
    request.headers = headers or {}
    request.state = MagicMock()
    response = MagicMock()
    response.headers = {}

    async def call_next(_req):
        return response

    out = asyncio.run(mw.dispatch(request, call_next))
    assert out is response
    return response.headers.get("X-Browser-Id"), response


class TestBrowserIdMiddleware:
    def test_normalize_accepts_valid_uuid(self):
        v = "0123abcd-89ef-4567-89ab-cdef01234567"
        assert BrowserIdMiddleware._normalize(v) == v

    def test_normalize_rejects_invalid(self):
        for bad in (None, "", "not-a-uuid", "0123abcd-89ef-4567-89ab-cdef0123456"):
            assert BrowserIdMiddleware._normalize(bad) is None

    def test_normalize_rejects_nil_uuid(self):
        # The nil UUID is shape-valid but never a real identity — reject it so
        # the request gets a freshly-minted id (iOS all-zeros badge bug).
        assert BrowserIdMiddleware._normalize(
            "00000000-0000-0000-0000-000000000000"
        ) is None
        # Mixed-case nil is normalized to lowercase first, then rejected.
        assert BrowserIdMiddleware._normalize(
            "00000000-0000-0000-0000-000000000000".upper()
        ) is None

    def test_dispatch_replaces_nil_uuid(self):
        echoed, _ = _run_browser_id(
            headers={"X-Browser-Id": "00000000-0000-0000-0000-000000000000"}
        )
        assert echoed and UUID_RE.match(echoed)
        assert echoed != "00000000-0000-0000-0000-000000000000"

    def test_normalize_lowercases(self):
        v = "0123ABCD-89EF-4567-89AB-CDEF01234567"
        assert BrowserIdMiddleware._normalize(v) == v.lower()

    def test_dispatch_mints_when_header_missing(self):
        echoed, _ = _run_browser_id(headers=None)
        assert echoed and UUID_RE.match(echoed)

    def test_dispatch_echoes_supplied_header(self):
        my_id = "11111111-2222-4333-8444-555555555555"
        echoed, _ = _run_browser_id(headers={"X-Browser-Id": my_id})
        assert echoed == my_id

    def test_dispatch_replaces_malformed_header(self):
        echoed, _ = _run_browser_id(headers={"X-Browser-Id": "garbage"})
        assert echoed and UUID_RE.match(echoed)
        assert echoed != "garbage"

    def test_dispatch_sets_request_state(self):
        my_id = "11111111-2222-4333-8444-555555555555"
        request = MagicMock()
        request.headers = {"X-Browser-Id": my_id}
        request.state = MagicMock()
        response = MagicMock()
        response.headers = {}
        mw = BrowserIdMiddleware(MagicMock())

        async def call_next(_req):
            assert request.state.browser_id == my_id
            return response

        out = asyncio.run(mw.dispatch(request, call_next))
        assert out is response
