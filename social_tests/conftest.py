"""Shared fixtures and report infrastructure for social testing.

Tests run against the live API on a dev/canary server. Set
SOCIAL_TEST_API_URL to target a specific server (defaults to the canary
tier, api.latest.whoeverwants.com, which auto-deploys on every push to
main).

--------------------------------------------------------------------------
WHAT CHANGED (May 2026 refresh)
--------------------------------------------------------------------------
The original social suite was written against an API surface that has
since shifted in three load-bearing ways. The harness now models the
*current* contract:

  1. **A name is required to participate.** `POST /api/polls` rejects a
     blank `creator_name` (400) and `POST /api/polls/{id}/votes` rejects a
     blank `voter_name` (400). There is no hidden-ballot anonymous vote
     anymore — every voter supplies a *name or alias* that the rest of the
     group sees. The old "anonymous dissenter" model is gone; see
     `test_identity_and_naming.py` for the social fallout.

  2. **Authorship is identity-based, not secret-based.** `creator_secret`
     was retired (migration 123). The creator of a poll is the account
     resolved from the request's bearer token, or — for an anonymous
     creator — a lightweight account auto-minted at create time and bound
     to the request's `X-Browser-Id`. Close / reopen / cutoff authorize by
     matching that account; a different browser gets 403. The harness pins
     one browser id per `Person`, so the person who created a poll is the
     one who can administer it.

  3. **Groups, not chains.** `follow_up_to` / forks are gone. Polls live in
     flat **groups** keyed by `group_id` (a uuid the create response
     returns). A follow-up is "another poll added to the same group_id."
     A multi-question poll bundles several category ballots (Restaurant +
     Time + Yes/No) under one wrapper that votes and closes atomically.

`Person` is the unit of a human-with-a-device: a name + its own browser id
+ HTTP client. Most scenarios run with one `organizer` casting every
named vote (a single browser may cast many votes, one per name); spawn
extra people with `api.person("Pat")` when a scenario needs a *distinct*
author, member, or unauthorized stranger.
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

DEFAULT_ORGANIZER = "Organizer"


# ── Field routing ───────────────────────────────────────────────────────────
# The server accepts different fields on each request shape; split incoming
# kwargs into per-question / poll-level / vote-item bags.
_QUESTION_FIELDS = (
    "options", "options_metadata", "context", "suggestion_deadline_minutes",
    "initial_suggestions", "min_availability_percent", "day_time_windows",
    "duration_window", "reference_latitude", "reference_longitude",
    "reference_location_label", "category", "category_icon", "is_auto_title",
)
_POLL_FIELDS = (
    "response_deadline", "prephase_deadline", "prephase_deadline_minutes",
    "group_id", "group_title", "context", "details", "min_responses",
    "show_preliminary_results", "allow_pre_ranking",
)
_VOTE_ITEM_FIELDS = (
    "vote_type", "yes_no_choice", "ranked_choices", "ranked_choice_tiers",
    "suggestions", "is_abstain", "is_ranking_abstain",
    "voter_day_time_windows", "voter_duration",
    "liked_slots", "disliked_slots", "options_metadata",
)


def _question_payload(poll_type: str, **kwargs) -> dict:
    """Build one `questions[]` entry. Legacy `poll_type='suggestion'` maps to
    a ranked_choice question with a suggestion-collection phase."""
    if poll_type == "suggestion":
        poll_type = "ranked_choice"
        kwargs.setdefault("suggestion_deadline_minutes", 60)
    q: dict = {
        "question_type": poll_type,
        # yes_no needs category="yes_no" for the server's auto-title;
        # everything else defaults to "custom".
        "category": kwargs.pop("category", None)
        or ("yes_no" if poll_type == "yes_no" else "custom"),
    }
    for k in _QUESTION_FIELDS:
        if k in kwargs and kwargs[k] is not None:
            q[k] = kwargs[k]
    return q


def make_client() -> httpx.Client:
    """A client pinned to one fresh X-Browser-Id (one device / identity)."""
    browser_id = str(uuid.uuid4())
    return httpx.Client(
        base_url=API_URL,
        timeout=30.0,
        headers={"X-Browser-Id": browser_id},
    )


class Person:
    """One human-with-a-device. Owns a name, a browser id, and an HTTP client.

    Creating a poll auto-mints an account bound to this browser, so this is
    also the identity that can close/reopen/cutoff what it created. Voting
    just needs a name, so one Person can cast many differently-named votes
    (the common single-organizer scenario)."""

    def __init__(self, name: str, result: "SocialTestResult | None" = None):
        self.name = name
        self.client = make_client()
        self._result = result
        self._first_question_id: dict[str, str] = {}

    def close(self):
        self.client.close()

    # -- low-level request with rate-limit retry -----------------------------

    def _request(self, method, url, expected, err_prefix, **kwargs) -> httpx.Response:
        for attempt in range(MAX_RETRIES):
            resp = self.client.request(method, url, **kwargs)
            if resp.status_code == 429:
                time.sleep(min(2 ** attempt, MAX_BACKOFF_SECONDS))
                continue
            if expected is not None:
                assert resp.status_code == expected, f"{err_prefix}: {resp.status_code} {resp.text}"
            return resp
        raise AssertionError(f"{err_prefix}: rate limited after {MAX_RETRIES} retries")

    def _record_poll(self, data: dict):
        """Stash question ids + record the first poll for report linking."""
        if data.get("questions"):
            self._first_question_id[data["id"]] = data["questions"][0]["id"]
        if self._result is not None and "poll_id" not in self._result.details:
            self._result.record("poll_id", data.get("id"))
            self._result.record("group_short_id", data.get("group_short_id"))
            self._result.record("poll_short_id", data.get("short_id"))

    # -- create --------------------------------------------------------------

    def create_poll(self, title: str, poll_type: str, *,
                    creator_name: str | None = None, group_id: str | None = None,
                    **kwargs) -> dict:
        """Create a single-question poll. `creator_name` defaults to this
        Person's name. Pass `group_id` to add the poll to an existing group
        (the new-architecture replacement for follow_up_to)."""
        if REPORT_URL and self._result and "details" not in kwargs:
            anchor = self._result.test_name
            kwargs["details"] = f"Test: {anchor}\n{REPORT_URL}#{anchor}"
        poll_fields = {k: kwargs.pop(k) for k in _POLL_FIELDS if k in kwargs}
        question = _question_payload(poll_type, **kwargs)
        payload = {
            "creator_name": creator_name or self.name,
            "title": title,
            "questions": [question],
            **poll_fields,
        }
        if group_id:
            payload["group_id"] = group_id
        resp = self._request("POST", "/api/polls", 201, "Failed to create poll", json=payload)
        data = resp.json()
        self._record_poll(data)
        return data

    def create_multi_poll(self, title: str | None, questions: list[dict], *,
                          creator_name: str | None = None, group_id: str | None = None,
                          **poll_fields) -> dict:
        """Create a multi-question poll. `questions` is a list of dicts, each
        `{"poll_type": ..., **question_fields}`. The whole poll votes and
        closes atomically."""
        if REPORT_URL and self._result and "details" not in poll_fields:
            poll_fields["details"] = f"Test: {self._result.test_name}\n{REPORT_URL}#{self._result.test_name}"
        q_payloads = [
            _question_payload(q.pop("poll_type"), **q) for q in (dict(x) for x in questions)
        ]
        payload = {
            "creator_name": creator_name or self.name,
            "questions": q_payloads,
            **{k: v for k, v in poll_fields.items() if k in _POLL_FIELDS or k in ("is_auto_title",)},
        }
        if title is not None:
            payload["title"] = title
        if group_id:
            payload["group_id"] = group_id
        resp = self._request("POST", "/api/polls", 201, "Failed to create multi poll", json=payload)
        data = resp.json()
        self._record_poll(data)
        return data

    # -- vote ----------------------------------------------------------------

    def _question_id_for(self, poll_id: str, index: int = 0) -> str:
        poll = self.get_poll(poll_id)
        return poll["questions"][index]["id"]

    def _build_item(self, poll_id: str, *, question_index=0, question_id=None,
                    vote_id=None, **fields) -> dict:
        if fields.get("vote_type") == "suggestion":
            fields["vote_type"] = "ranked_choice"
        qid = question_id or self._first_question_id.get(poll_id) or self._question_id_for(poll_id, question_index)
        item: dict = {"question_id": qid}
        if vote_id is not None:
            item["vote_id"] = vote_id
        for k in _VOTE_ITEM_FIELDS:
            if k in fields:
                item[k] = fields[k]
        return item

    def vote(self, poll_id: str, voter_name: str, *, question_index=0,
             vote_id=None, expect=201, **fields) -> dict | httpx.Response:
        """Cast (or edit, if vote_id) one question's ballot. `voter_name` is
        required by the server. Pass `expect=400` to assert a rejection and
        get the raw Response back."""
        item = self._build_item(poll_id, question_index=question_index, vote_id=vote_id, **fields)
        body: dict = {"voter_name": voter_name, "items": [item]}
        resp = self._request("POST", f"/api/polls/{poll_id}/votes", expect, "Failed to vote", json=body)
        if expect != 201:
            return resp
        votes = resp.json()
        return votes[0] if isinstance(votes, list) and votes else votes

    def vote_anonymous(self, poll_id: str, *, question_index=0, **fields) -> httpx.Response:
        """Attempt a vote with NO name — the server rejects this (400). Returns
        the raw Response so the test can assert the rejection."""
        item = self._build_item(poll_id, question_index=question_index, **fields)
        return self._request("POST", f"/api/polls/{poll_id}/votes", None, "Anon vote", json={"items": [item]})

    def vote_batch(self, poll_id: str, voter_name: str, items: list[dict], expect=201):
        """Submit ballots across several questions of one poll, atomically.
        Each item is `{"question_index" or "question_id": ..., **fields}`."""
        built = [
            self._build_item(poll_id, **item) for item in (dict(x) for x in items)
        ]
        body = {"voter_name": voter_name, "items": built}
        resp = self._request("POST", f"/api/polls/{poll_id}/votes", expect, "Failed batch vote", json=body)
        return resp.json() if expect == 201 else resp

    def edit_vote(self, poll_id: str, vote_id: str, voter_name: str, *, question_index=0, **fields):
        return self.vote(poll_id, voter_name, question_index=question_index, vote_id=vote_id, **fields)

    # -- admin (identity-authorized; only the creator's Person succeeds) -----

    def close_poll(self, poll_id: str, reason: str = "manual", expect=200):
        resp = self._request("POST", f"/api/polls/{poll_id}/close", expect,
                             "Failed to close poll", json={"close_reason": reason})
        return resp.json() if expect == 200 else resp

    def reopen_poll(self, poll_id: str, expect=200):
        resp = self._request("POST", f"/api/polls/{poll_id}/reopen", expect,
                             "Failed to reopen poll", json={})
        return resp.json() if expect == 200 else resp

    def cutoff_suggestions(self, poll_id: str, expect=200):
        resp = self._request("POST", f"/api/polls/{poll_id}/cutoff-suggestions", expect,
                             "Failed to cutoff suggestions", json={})
        return resp.json() if expect == 200 else resp

    def cutoff_availability(self, poll_id: str, expect=200):
        resp = self._request("POST", f"/api/polls/{poll_id}/cutoff-availability", expect,
                             "Failed to cutoff availability", json={})
        return resp.json() if expect == 200 else resp

    def view_poll(self, poll_id: str):
        """Record a 'viewed' watermark (opens the poll detail page)."""
        return self._request("POST", f"/api/polls/{poll_id}/viewed", 204, "Failed to view poll")

    # -- reads ---------------------------------------------------------------

    def get_results(self, poll_id: str, question_index: int = 0) -> dict:
        qid = self._first_question_id.get(poll_id) if question_index == 0 else None
        qid = qid or self._question_id_for(poll_id, question_index)
        resp = self._request("GET", f"/api/questions/{qid}/results", 200, "Failed to get results")
        return resp.json()

    def get_poll(self, poll_id: str) -> dict:
        resp = self._request("GET", f"/api/polls/by-id/{poll_id}", 200, "Failed to get poll")
        return resp.json()

    def get_votes(self, poll_id: str, question_index: int = 0) -> list[dict]:
        qid = self._first_question_id.get(poll_id) if question_index == 0 else None
        qid = qid or self._question_id_for(poll_id, question_index)
        resp = self._request("GET", f"/api/questions/{qid}/votes", 200, "Failed to get votes")
        return resp.json()

    def get_group(self, route_id: str, expect=200):
        """Fetch the group's visible polls (membership-aware). 404 → no access."""
        resp = self._request("GET", f"/api/groups/by-route-id/{route_id}", expect,
                             "Failed to get group")
        return resp.json() if expect == 200 else resp


class World:
    """A scenario's cast. `organizer` is the default actor; `person(name)`
    mints additional people with their own device identities."""

    def __init__(self, result):
        self._result = result
        self.organizer = Person(DEFAULT_ORGANIZER, result)
        self._people = [self.organizer]

    def person(self, name: str) -> Person:
        p = Person(name, self._result)
        self._people.append(p)
        return p

    def stranger(self) -> Person:
        """An unrelated device — for unauthorized-action tests."""
        p = Person("Stranger", self._result)
        self._people.append(p)
        return p

    def close(self):
        for p in self._people:
            p.close()

    # Delegate the common organizer operations so `api.create_poll(...)`,
    # `api.vote(...)`, etc. read naturally for single-actor scenarios.
    def __getattr__(self, item):
        return getattr(self.organizer, item)


@pytest.fixture
def api(result):
    world = World(result)
    try:
        yield world
    finally:
        world.close()


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
        self.details = {}
        self.assertions = []
        self.failure_message = ""

    def assert_technical(self, description: str, condition: bool, detail: str = ""):
        self.assertions.append((description, condition, detail))
        if not condition:
            self.technical_pass = False

    def mark_social(self, badge: str, note: str = ""):
        self.social_badge = badge
        if note:
            self.details["social_note"] = note

    def record(self, key: str, value):
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
    r = SocialTestResult()
    r.test_name = request.node.name
    r.category = request.node.module.__name__.replace("test_", "").replace("_scenarios", "")
    raw_doc = request.node.function.__doc__ or ""
    first, _, rest = raw_doc.strip().partition("\n")
    r.docstring = (first + "\n" + textwrap.dedent(rest)).strip() if rest else first.strip()
    _test_results.append(r)
    return r


def pytest_runtest_makereport(item, call):
    if call.when == "call" and call.excinfo:
        for r in _test_results:
            if r.test_name == item.name:
                r.technical_pass = False
                r.failure_message = str(call.excinfo.value)
                break


def pytest_sessionfinish(session, exitstatus):
    output_path = os.environ.get("SOCIAL_TEST_RESULTS_PATH", "/tmp/social_test_results.json")
    results = [r.to_dict() for r in _test_results]
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
