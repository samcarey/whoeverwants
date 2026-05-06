"""Integration tests for the threads API (Phase B.3).

Covers:
  - POST /api/threads/mine  — discovery + accessibility in one call
  - GET  /api/threads/by-route-id/{route_id} — by short_id and uuid
  - BrowserIdMiddleware — header echo + auto-mint

Like test_polls_api.py these need a real Postgres reachable via DATABASE_URL.
"""

import os
import re
import uuid

import pytest

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from fastapi.testclient import TestClient

from main import app


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def creator_secret():
    return f"test-secret-{uuid.uuid4().hex[:8]}"


def _yes_no_question(**overrides) -> dict:
    base = {"question_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


def _create_poll(client, creator_secret: str, **kwargs) -> dict:
    payload = {
        "creator_secret": creator_secret,
        "questions": [_yes_no_question()],
    }
    payload.update(kwargs)
    resp = client.post("/api/polls", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_followup(client, creator_secret: str, parent_question_id: str) -> dict:
    """Create a poll wrapped in a follow-up to `parent_question_id`."""
    return _create_poll(
        client,
        creator_secret,
        follow_up_to=parent_question_id,
    )


class TestMyThreads:
    def test_empty_input_returns_empty(self, client):
        resp = client.post("/api/threads/mine", json={"accessible_question_ids": []})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_single_question_returns_its_poll(self, client, creator_secret):
        poll = _create_poll(client, creator_secret)
        question_id = poll["questions"][0]["id"]

        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": [question_id]},
        )
        assert resp.status_code == 200
        polls = resp.json()
        assert len(polls) == 1
        assert polls[0]["id"] == poll["id"]

    def test_followup_chain_returns_every_poll_in_thread(self, client, creator_secret):
        """Asking for ONE question in a multi-poll thread should return EVERY
        poll in that thread — that's the discovery + accessibility merge."""
        root = _create_poll(client, creator_secret)
        child1 = _create_followup(client, creator_secret, root["questions"][0]["id"])
        child2 = _create_followup(client, creator_secret, child1["questions"][0]["id"])

        # Pass only the deepest question; discovery walks via thread_id back to
        # the root and returns every poll.
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": [child2["questions"][0]["id"]]},
        )
        assert resp.status_code == 200
        polls = resp.json()
        ids = {p["id"] for p in polls}
        assert ids == {root["id"], child1["id"], child2["id"]}

    def test_two_unrelated_threads_both_returned(self, client, creator_secret):
        a = _create_poll(client, creator_secret)
        b = _create_poll(client, creator_secret)
        resp = client.post(
            "/api/threads/mine",
            json={
                "accessible_question_ids": [
                    a["questions"][0]["id"],
                    b["questions"][0]["id"],
                ],
            },
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {a["id"], b["id"]}

    def test_unknown_question_id_returns_empty(self, client):
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": [str(uuid.uuid4())]},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_inline_results_default_on(self, client, creator_secret):
        poll = _create_poll(client, creator_secret)
        question_id = poll["questions"][0]["id"]
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": [question_id]},
        )
        polls = resp.json()
        # Open question with no votes still has the `results` field on the
        # question (since show_preliminary_results defaults to True and the
        # question has no min_responses gate).
        assert polls[0]["questions"][0].get("results") is not None

    def test_inline_results_off_when_requested(self, client, creator_secret):
        poll = _create_poll(client, creator_secret)
        question_id = poll["questions"][0]["id"]
        resp = client.post(
            "/api/threads/mine",
            json={
                "accessible_question_ids": [question_id],
                "include_results": False,
            },
        )
        polls = resp.json()
        assert polls[0]["questions"][0].get("results") is None


class TestThreadByRouteId:
    def test_resolves_by_root_poll_short_id(self, client, creator_secret):
        root = _create_poll(client, creator_secret)
        child = _create_followup(client, creator_secret, root["questions"][0]["id"])

        # threadShortId is the root poll's short_id today.
        resp = client.get(f"/api/threads/by-route-id/{root['short_id']}")
        assert resp.status_code == 200
        polls = resp.json()
        ids = {p["id"] for p in polls}
        assert ids == {root["id"], child["id"]}

    def test_resolves_by_root_poll_uuid(self, client, creator_secret):
        root = _create_poll(client, creator_secret)
        _create_followup(client, creator_secret, root["questions"][0]["id"])

        resp = client.get(f"/api/threads/by-route-id/{root['id']}")
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert root["id"] in ids

    def test_resolves_by_child_poll_short_id(self, client, creator_secret):
        """Even if the user types a child poll's short_id into the route id
        slot, we still return the WHOLE thread — that's the only sensible
        definition of `/t/<routeId>`."""
        root = _create_poll(client, creator_secret)
        child = _create_followup(client, creator_secret, root["questions"][0]["id"])

        resp = client.get(f"/api/threads/by-route-id/{child['short_id']}")
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {root["id"], child["id"]}

    def test_unknown_route_id_returns_404(self, client):
        resp = client.get(f"/api/threads/by-route-id/zzznotreal")
        assert resp.status_code == 404

    def test_include_results_query_param(self, client, creator_secret):
        root = _create_poll(client, creator_secret)
        resp = client.get(
            f"/api/threads/by-route-id/{root['short_id']}?include_results=false",
        )
        assert resp.status_code == 200
        polls = resp.json()
        assert polls[0]["questions"][0].get("results") is None


class TestBrowserIdMiddleware:
    def test_response_carries_browser_id_header(self, client, creator_secret):
        """First-visit case: client sends no header; server mints + echoes one."""
        resp = client.post("/api/threads/mine", json={"accessible_question_ids": []})
        assert resp.status_code == 200
        bid = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert bid is not None
        assert UUID_RE.match(bid)

    def test_supplied_browser_id_is_echoed(self, client):
        my_id = str(uuid.uuid4())
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": my_id},
        )
        assert resp.status_code == 200
        echoed = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert echoed == my_id

    def test_malformed_browser_id_is_replaced(self, client):
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": "not-a-uuid"},
        )
        assert resp.status_code == 200
        echoed = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert echoed and UUID_RE.match(echoed)
        assert echoed != "not-a-uuid"

    def test_browser_id_set_even_on_404(self, client):
        """Adoption MUST work on error responses too — first-visit failed
        request should still leave the FE with a server-issued id."""
        resp = client.get("/api/threads/by-route-id/zzznotreal")
        assert resp.status_code == 404
        echoed = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert echoed and UUID_RE.match(echoed)
