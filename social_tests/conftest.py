"""Shared fixtures and report infrastructure for social testing.

Tests run against the live API on the droplet (or a dev server).
Set SOCIAL_TEST_API_URL to target a specific server.
"""

import json
import os
import textwrap
import time
import uuid

import httpx
import pytest

API_URL = os.environ.get("SOCIAL_TEST_API_URL", "https://whoeverwants.com")
REPORT_URL = os.environ.get("SOCIAL_TEST_REPORT_URL", "")

MAX_RETRIES = 8
MAX_BACKOFF_SECONDS = 30


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def http_client():
    """Shared HTTP client for all tests."""
    with httpx.Client(base_url=API_URL, timeout=30.0) as client:
        yield client


@pytest.fixture
def creator_secret():
    """Unique creator secret per test."""
    return f"social-test-{uuid.uuid4().hex[:12]}"


# ── Helper functions available to all tests ───────────────────────────────────


class PollHelper:
    """Convenience wrapper for poll API operations with rate-limit retry."""

    def __init__(self, client: httpx.Client, result: "SocialTestResult | None" = None):
        self.client = client
        self._result = result

    def _request(self, method: str, url: str, expected: int, err_prefix: str, **kwargs) -> httpx.Response:
        """Make a request with automatic rate-limit retry."""
        for attempt in range(MAX_RETRIES):
            resp = self.client.request(method, url, **kwargs)
            if resp.status_code == 429:
                wait = min(2 ** attempt, MAX_BACKOFF_SECONDS)
                time.sleep(wait)
                continue
            assert resp.status_code == expected, f"{err_prefix}: {resp.text}"
            return resp
        raise AssertionError(f"{err_prefix}: rate limited after {MAX_RETRIES} retries")

    def create_poll(self, title: str, poll_type: str, creator_secret: str, **kwargs) -> dict:
        # Inject report back-link into poll details if report URL is configured
        if REPORT_URL and self._result and "details" not in kwargs:
            anchor = self._result.test_name
            kwargs["details"] = f"Test: {anchor}\n{REPORT_URL}#{anchor}"
        payload = {"title": title, "poll_type": poll_type, "creator_secret": creator_secret, **kwargs}
        resp = self._request("POST", "/api/polls", 201, "Failed to create poll", json=payload)
        data = resp.json()
        # Record the first poll's ID for report linking
        if self._result and "poll_id" not in self._result.details:
            self._result.record("poll_id", data.get("id"))
        return data

    def vote(self, poll_id: str, voter_name: str | None = None, **kwargs) -> dict:
        payload = {**kwargs}
        if voter_name is not None:
            payload["voter_name"] = voter_name
        resp = self._request("POST", f"/api/polls/{poll_id}/votes", 201, "Failed to vote", json=payload)
        return resp.json()

    def edit_vote(self, poll_id: str, vote_id: str, **kwargs) -> dict:
        resp = self._request("PUT", f"/api/polls/{poll_id}/votes/{vote_id}", 200, "Failed to edit vote", json=kwargs)
        return resp.json()

    def close_poll(self, poll_id: str, creator_secret: str, reason: str = "manual") -> dict:
        resp = self._request(
            "POST", f"/api/polls/{poll_id}/close", 200, "Failed to close poll",
            json={"creator_secret": creator_secret, "close_reason": reason},
        )
        return resp.json()

    def reopen_poll(self, poll_id: str, creator_secret: str) -> dict:
        resp = self._request(
            "POST", f"/api/polls/{poll_id}/reopen", 200, "Failed to reopen poll",
            json={"creator_secret": creator_secret},
        )
        return resp.json()

    def get_results(self, poll_id: str) -> dict:
        resp = self._request("GET", f"/api/polls/{poll_id}/results", 200, "Failed to get results")
        return resp.json()

    def get_poll(self, poll_id: str) -> dict:
        resp = self._request("GET", f"/api/polls/{poll_id}", 200, "Failed to get poll")
        return resp.json()

    def get_votes(self, poll_id: str) -> list[dict]:
        resp = self._request("GET", f"/api/polls/{poll_id}/votes", 200, "Failed to get votes")
        return resp.json()

    def get_participants(self, poll_id: str) -> list[dict]:
        resp = self._request("GET", f"/api/polls/{poll_id}/participants", 200, "Failed to get participants")
        return resp.json()

    def get_related(self, poll_ids: list[str]) -> dict:
        resp = self._request("POST", "/api/polls/related", 200, "Failed to get related polls", json={"poll_ids": poll_ids})
        return resp.json()


@pytest.fixture
def api(http_client, result):
    """PollHelper instance for convenient API calls."""
    return PollHelper(http_client, result)


# ── Result collection for report generation ───────────────────────────────────

_test_results = []


class SocialTestResult:
    """Captures test outcome + metadata for report generation."""

    def __init__(self):
        self.test_name = ""
        self.category = ""
        self.docstring = ""
        self.technical_pass = True
        self.social_badge = "FAIR"  # FAIR | AWKWARD | INSIGHT
        self.details = {}  # Arbitrary data for the report
        self.assertions = []  # List of (description, passed, detail)
        self.failure_message = ""

    def assert_technical(self, description: str, condition: bool, detail: str = ""):
        """Record a technical assertion."""
        self.assertions.append((description, condition, detail))
        if not condition:
            self.technical_pass = False

    def mark_social(self, badge: str, note: str = ""):
        """Set the social evaluation badge."""
        self.social_badge = badge
        if note:
            self.details["social_note"] = note

    def record(self, key: str, value):
        """Store arbitrary data for report."""
        self.details[key] = value

    def to_dict(self) -> dict:
        return {
            "test_name": self.test_name,
            "category": self.category,
            "docstring": self.docstring,
            "technical_pass": self.technical_pass,
            "social_badge": self.social_badge,
            "details": self.details,
            "assertions": [
                {"description": d, "passed": p, "detail": dt}
                for d, p, dt in self.assertions
            ],
            "failure_message": self.failure_message,
        }


@pytest.fixture
def result(request):
    """A SocialTestResult for the current test to populate."""
    r = SocialTestResult()
    r.test_name = request.node.name
    r.category = request.node.module.__name__.replace("test_", "").replace("_scenarios", "")
    raw_doc = request.node.function.__doc__ or ""
    # First line is flush with """, rest is indented — dedent them separately
    first, _, rest = raw_doc.strip().partition("\n")
    r.docstring = (first + "\n" + textwrap.dedent(rest)).strip() if rest else first.strip()
    _test_results.append(r)
    return r


def pytest_runtest_makereport(item, call):
    """Capture failure info into the test's SocialTestResult."""
    if call.when == "call" and call.excinfo:
        for r in _test_results:
            if r.test_name == item.name:
                r.technical_pass = False
                r.failure_message = str(call.excinfo.value)
                break


def pytest_sessionfinish(session, exitstatus):
    """Write collected results to JSON for report generation."""
    output_path = os.environ.get("SOCIAL_TEST_RESULTS_PATH", "/tmp/social_test_results.json")
    results = [r.to_dict() for r in _test_results]
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
