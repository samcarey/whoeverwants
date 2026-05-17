"""Shared fixtures and report infrastructure for social testing.

Tests run against the live API on the droplet (or a dev server).
Set SOCIAL_TEST_API_URL to target a specific server.

PollHelper exposes the *legacy* single-poll-type API surface (poll_type,
vote_type) on top of the current poll-of-questions architecture: each
`create_poll(title, poll_type, ...)` mints a 1-question poll, and every
vote / read routes through the poll's first question by default. Tests
that want multi-question behavior can read `poll['questions']` directly.
"""

import json
import os
import textwrap
import time
import uuid

import httpx
import pytest

API_URL = os.environ.get("SOCIAL_TEST_API_URL", "https://api.latest.whoeverwants.com")
REPORT_URL = os.environ.get("SOCIAL_TEST_REPORT_URL", "")

MAX_RETRIES = 8
MAX_BACKOFF_SECONDS = 30


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def http_client():
    """Shared HTTP client for all tests. Pins one X-Browser-Id per session
    so that group-visibility (membership) is preserved across reads —
    otherwise every read mints a fresh browser_id and Phase C.3 visibility
    filter hides our own polls from us."""
    browser_id = str(uuid.uuid4())
    with httpx.Client(
        base_url=API_URL,
        timeout=30.0,
        headers={"X-Browser-Id": browser_id},
    ) as client:
        yield client


@pytest.fixture
def creator_secret():
    """Unique creator secret per test."""
    return f"social-test-{uuid.uuid4().hex[:12]}"


# ── Helper functions available to all tests ───────────────────────────────────


# Default category to attach to a single-question wrapper, by poll_type.
# `yes_no` polls need category="yes_no" because the server's auto-title
# function recognises that label. Other types default to "custom".
_DEFAULT_CATEGORY = {"yes_no": "yes_no"}


def _question_payload(poll_type: str, **kwargs) -> dict:
    """Build a single CreateQuestionRequest dict for the given poll_type."""
    q: dict = {
        "question_type": poll_type,
        "category": kwargs.pop("category", None) or _DEFAULT_CATEGORY.get(poll_type, "custom"),
    }
    # Pass through optional fields that map 1:1 onto CreateQuestionRequest.
    for k in (
        "options",
        "options_metadata",
        "context",
        "suggestion_deadline_minutes",
        "min_availability_percent",
        "day_time_windows",
        "duration_window",
        "reference_latitude",
        "reference_longitude",
        "reference_location_label",
        "is_auto_title",
    ):
        if k in kwargs and kwargs[k] is not None:
            q[k] = kwargs.pop(k)
    return q


class PollHelper:
    """Convenience wrapper for poll API operations with rate-limit retry.

    The external `(title, poll_type, ...)` shape matches the original
    social-tests API; internally each call mints a 1-question poll and
    routes votes through the poll batch endpoint."""

    def __init__(self, client: httpx.Client, result: "SocialTestResult | None" = None):
        self.client = client
        self._result = result
        # Tracks the first-question id for each poll we create so the test
        # can keep using `poll["id"]` (a poll id) and we route into the
        # right question id on the wire.
        self._first_question_id: dict[str, str] = {}

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
        """Create a single-question poll wrapping one `poll_type` question.

        Legacy `poll_type='suggestion'` translates to a ranked_choice question
        with `suggestion_deadline_minutes` set (the new architecture treats
        suggestion-collection as a phase of a ranked_choice question, not a
        separate type). Default 60-minute suggestion window unless overridden.
        """
        # Inject report back-link into poll details if report URL is configured
        if REPORT_URL and self._result and "details" not in kwargs:
            anchor = self._result.test_name
            kwargs["details"] = f"Test: {anchor}\n{REPORT_URL}#{anchor}"

        # Translate legacy `suggestion` poll_type to current shape.
        if poll_type == "suggestion":
            poll_type = "ranked_choice"
            kwargs.setdefault("suggestion_deadline_minutes", 60)

        # Extract poll-level fields the server expects on CreatePollRequest.
        poll_fields = {}
        for k in (
            "creator_name", "response_deadline", "prephase_deadline",
            "prephase_deadline_minutes", "group_id", "group_title",
            "context", "details", "min_responses", "show_preliminary_results",
            "allow_pre_ranking", "is_auto_title",
        ):
            if k in kwargs:
                poll_fields[k] = kwargs.pop(k)
        # Anything left is per-question (options, suggestion_deadline_minutes, etc.).
        question = _question_payload(poll_type, **kwargs)
        payload = {
            "creator_secret": creator_secret,
            "title": title,
            "questions": [question],
            **poll_fields,
        }
        resp = self._request("POST", "/api/polls", 201, "Failed to create poll", json=payload)
        data = resp.json()
        # Stash the first question's id so vote/get_results/etc. can find it.
        if data.get("questions"):
            self._first_question_id[data["id"]] = data["questions"][0]["id"]
        # Record the first poll's ID for report linking
        if self._result and "poll_id" not in self._result.details:
            self._result.record("poll_id", data.get("id"))
        return data

    def _question_id_for(self, poll_id: str) -> str:
        """Resolve a poll_id to its first question's id, fetching if needed."""
        if poll_id in self._first_question_id:
            return self._first_question_id[poll_id]
        poll = self.get_poll(poll_id)
        qid = poll["questions"][0]["id"]
        self._first_question_id[poll_id] = qid
        return qid

    def vote(self, poll_id: str, voter_name: str | None = None, **kwargs) -> dict:
        """Submit a vote on the poll's first question via the batch endpoint."""
        # Translate legacy vote_type=suggestion.
        if kwargs.get("vote_type") == "suggestion":
            kwargs["vote_type"] = "ranked_choice"
        question_id = kwargs.pop("question_id", None) or self._question_id_for(poll_id)
        item: dict = {"question_id": question_id}
        # Migrate vote-type fields onto the item.
        for k in (
            "vote_type", "yes_no_choice", "ranked_choices", "ranked_choice_tiers",
            "suggestions", "is_abstain", "is_ranking_abstain",
            "voter_day_time_windows", "voter_duration",
            "liked_slots", "disliked_slots",
        ):
            if k in kwargs:
                item[k] = kwargs.pop(k)
        body: dict = {"items": [item]}
        if voter_name is not None:
            body["voter_name"] = voter_name
        resp = self._request("POST", f"/api/polls/{poll_id}/votes", 201, "Failed to vote", json=body)
        # Endpoint returns a list; the legacy API returned a single dict.
        votes = resp.json()
        return votes[0] if isinstance(votes, list) and votes else votes

    def edit_vote(self, poll_id: str, vote_id: str, **kwargs) -> dict:
        """Edit an existing vote — routes through the batch endpoint with vote_id set."""
        question_id = kwargs.pop("question_id", None) or self._question_id_for(poll_id)
        item: dict = {"question_id": question_id, "vote_id": vote_id}
        for k in (
            "vote_type", "yes_no_choice", "ranked_choices", "ranked_choice_tiers",
            "suggestions", "is_abstain", "is_ranking_abstain",
            "voter_day_time_windows", "voter_duration",
            "liked_slots", "disliked_slots",
        ):
            if k in kwargs:
                item[k] = kwargs.pop(k)
        body: dict = {"items": [item]}
        voter_name = kwargs.pop("voter_name", None)
        if voter_name is not None:
            body["voter_name"] = voter_name
        resp = self._request("POST", f"/api/polls/{poll_id}/votes", 201, "Failed to edit vote", json=body)
        votes = resp.json()
        return votes[0] if isinstance(votes, list) and votes else votes

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

    def cutoff_suggestions(self, poll_id: str, creator_secret: str) -> dict:
        resp = self._request(
            "POST", f"/api/polls/{poll_id}/cutoff-suggestions", 200, "Failed to cutoff suggestions",
            json={"creator_secret": creator_secret},
        )
        return resp.json()

    def get_results(self, poll_id: str) -> dict:
        """Fetch the first question's results."""
        qid = self._question_id_for(poll_id)
        resp = self._request("GET", f"/api/questions/{qid}/results", 200, "Failed to get results")
        return resp.json()

    def get_poll(self, poll_id: str) -> dict:
        resp = self._request("GET", f"/api/polls/by-id/{poll_id}", 200, "Failed to get poll")
        return resp.json()

    def get_votes(self, poll_id: str) -> list[dict]:
        """Fetch the first question's votes."""
        qid = self._question_id_for(poll_id)
        resp = self._request("GET", f"/api/questions/{qid}/votes", 200, "Failed to get votes")
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
