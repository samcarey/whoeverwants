"""Tests for rate limiting middleware."""

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from middleware import RateLimitMiddleware


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
