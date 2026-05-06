"""Phase C.3 — visibility enforcement on the threads read endpoints.

Covers:
  * /api/threads/mine returns only polls visible per the visibility rule
  * /api/threads/by-route-id/{id} 404s on non-members with no `?p` grant
  * `?p=<pollShortId>` auto-grant on by-route-id surfaces the targeted poll
  * Closed-poll filter: closed-before-joined_at hidden for members, but
    bridged threads bypass the filter
  * Direct per-poll grant bypasses the closed_at filter
  * `?p=` outside the resolved thread is ignored (no cross-thread leak)
  * Forget bridge: member-thread without legacy-list signal disappears
  * Strangers see neither members' threads nor /by-route-id contents

The companion file `test_membership_writes.py` covers the WRITE side of
Phase C.2 (auto-join + access-grant). This file covers the READ side that
C.3 introduces. Both depend on a real Postgres reachable via DATABASE_URL
and the migration set including 102.
"""

import os
import time
import uuid

import pytest

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

import psycopg
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def creator_secret():
    return f"test-secret-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def stranger_browser():
    return str(uuid.uuid4())


def _yes_no_question(**overrides) -> dict:
    base = {"question_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


def _create_poll(client, creator_secret, *, browser_id, **kwargs) -> dict:
    payload = {
        "creator_secret": creator_secret,
        "questions": [_yes_no_question()],
    }
    payload.update(kwargs)
    resp = client.post(
        "/api/polls",
        json=payload,
        headers={"X-Browser-Id": browser_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _close_poll(poll_id: str, creator_secret: str, client):
    resp = client.post(
        f"/api/polls/{poll_id}/close",
        json={"creator_secret": creator_secret, "close_reason": "manual"},
    )
    assert resp.status_code == 200, resp.text


def _set_poll_updated_at(poll_id: str, dt_iso: str):
    """Backdate updated_at so closed_at falls before some join watermark.
    Works around the close trigger setting updated_at = NOW()."""
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE polls SET updated_at = %s WHERE id = %s",
            (dt_iso, poll_id),
        )


def _set_member_joined_at(thread_id: str, browser_id: str, dt_iso: str):
    """Set thread_members.joined_at directly so we can simulate "joined
    after the poll closed". Used in place of waiting real wall-clock time."""
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE thread_members SET joined_at = %s "
            "WHERE thread_id = %s AND browser_id = %s",
            (dt_iso, thread_id, browser_id),
        )


def _stranger_get_thread(client, route_id, browser_id, *, p=None):
    qs = f"?p={p}" if p else ""
    return client.get(
        f"/api/threads/by-route-id/{route_id}{qs}",
        headers={"X-Browser-Id": browser_id},
    )


# ---------------------------------------------------------------------------
# /api/threads/mine
# ---------------------------------------------------------------------------


class TestMyThreadsVisibility:
    def test_member_sees_their_thread(self, client, creator_secret, creator_browser):
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        # Note: no accessible_question_ids — pure membership signal.
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {poll["id"]}

    def test_stranger_sees_no_threads(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        _create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_legacy_bridge_grants_thread_visibility(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """A pre-B.3 user shows up with their localStorage list and no
        thread_members rows. The bridge treats those question_ids as
        thread-level access, preserving Phase B.3 behavior for legacy
        callers."""
        root = _create_poll(client, creator_secret, browser_id=creator_browser)
        child = _create_poll(
            client, creator_secret, browser_id=creator_browser,
            follow_up_to=root["questions"][0]["id"],
        )
        # Stranger passes ONE question id; bridge fans out to its whole
        # thread (every poll, no closed_at filter).
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": [child["questions"][0]["id"]]},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {root["id"], child["id"]}

    def test_forget_bridge_drops_member_thread_without_signal(
        self, client, creator_secret, creator_browser,
    ):
        """When the FE passes accessible_question_ids and a member-thread
        has no question_id in the list, the home view drops it. Without
        this carve-out, forgetting every question in a thread wouldn't
        narrow the home list because the user is still a thread_members
        row in that thread (until an explicit leave action lands)."""
        # Two unrelated threads, both with the same creator browser.
        kept = _create_poll(client, creator_secret, browser_id=creator_browser)
        forgotten = _create_poll(client, creator_secret, browser_id=creator_browser)

        # Pretend the user only has the `kept` question in localStorage.
        resp = client.post(
            "/api/threads/mine",
            json={
                "accessible_question_ids": [kept["questions"][0]["id"]],
            },
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {kept["id"]}
        assert forgotten["id"] not in ids

    def test_no_legacy_list_returns_full_member_threads(
        self, client, creator_secret, creator_browser,
    ):
        """Membership-only callers (empty accessible_question_ids list)
        skip the forget-bridge narrowing — the bridge is opt-in."""
        a = _create_poll(client, creator_secret, browser_id=creator_browser)
        b = _create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": creator_browser},
        )
        ids = {p["id"] for p in resp.json()}
        assert ids == {a["id"], b["id"]}

    def test_closed_before_join_hidden_for_member(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Closed-before-joined_at: user should NOT see polls that closed
        before they joined the thread. The closed_at proxy is
        polls.updated_at."""
        # Creator opens + closes a poll.
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll["id"], creator_secret, client)
        # Backdate the close so it lives in the distant past.
        _set_poll_updated_at(poll["id"], "2000-01-01T00:00:00Z")

        # A second user joins by creating a follow-up *after* the close.
        # They become a thread member with joined_at = NOW(); the closed
        # poll's closed_at (year 2000) is < joined_at, so it's filtered out.
        followup = _create_poll(
            client, creator_secret, browser_id=stranger_browser,
            follow_up_to=poll["questions"][0]["id"],
        )

        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # The new follow-up is open, so the user sees it. The original
        # closed-pre-join poll is hidden.
        assert poll["id"] not in ids
        assert followup["id"] in ids

    def test_closed_before_join_visible_via_legacy_bridge(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Legacy bridge bypasses closed_at — pre-B.3 users with a
        localStorage list see the full thread regardless of close timing."""
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll["id"], creator_secret, client)
        _set_poll_updated_at(poll["id"], "2000-01-01T00:00:00Z")

        # Stranger has only a legacy localStorage list; no membership.
        resp = client.post(
            "/api/threads/mine",
            json={
                "accessible_question_ids": [poll["questions"][0]["id"]],
            },
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_per_poll_grant_visible_outside_thread_membership(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """A user with `poll_access` for one poll in a thread sees just
        that poll — even with no thread_members row and no legacy bridge."""
        root = _create_poll(client, creator_secret, browser_id=creator_browser)
        child = _create_poll(
            client, creator_secret, browser_id=creator_browser,
            follow_up_to=root["questions"][0]["id"],
        )

        # Stranger grants themselves poll_access on the child only.
        grant = client.post(
            f"/api/polls/{child['id']}/access",
            headers={"X-Browser-Id": stranger_browser},
        )
        assert grant.status_code == 204

        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # Only the granted poll is visible; the sibling root is hidden.
        assert ids == {child["id"]}


# ---------------------------------------------------------------------------
# /api/threads/by-route-id/{route_id}
# ---------------------------------------------------------------------------


class TestByRouteIdVisibility:
    def test_member_can_read(self, client, creator_secret, creator_browser):
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_stranger_404s(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        resp = _stranger_get_thread(
            client, poll["short_id"], stranger_browser,
        )
        assert resp.status_code == 404

    def test_stranger_with_p_query_sees_only_that_poll(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """`?p=<pollShortId>` triggers the inline auto-grant: stranger
        becomes a poll_access holder for that poll, sees it, but NOT
        siblings in the same thread."""
        root = _create_poll(client, creator_secret, browser_id=creator_browser)
        child = _create_poll(
            client, creator_secret, browser_id=creator_browser,
            follow_up_to=root["questions"][0]["id"],
        )
        resp = _stranger_get_thread(
            client, root["short_id"], stranger_browser, p=child["short_id"],
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # Only the targeted poll visible; root is sibling-only and stays
        # hidden because direct-link access doesn't transitively grant
        # thread membership.
        assert ids == {child["id"]}

    def test_stranger_p_outside_thread_is_ignored(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """`?p` referencing a poll in a DIFFERENT thread can't be used to
        grant cross-thread access. The auto-grant lookup is scoped to the
        resolved thread, so a mismatched `?p` is silently ignored and the
        endpoint 404s the user out (no other visibility)."""
        thread_a = _create_poll(client, creator_secret, browser_id=creator_browser)
        thread_b = _create_poll(client, creator_secret, browser_id=creator_browser)

        resp = _stranger_get_thread(
            client, thread_a["short_id"], stranger_browser,
            p=thread_b["short_id"],
        )
        assert resp.status_code == 404

        # Verify no poll_access was written for thread_b's poll.
        with psycopg.connect(TEST_DB_URL) as conn:
            rows = conn.execute(
                "SELECT 1 FROM poll_access WHERE poll_id = %s AND browser_id = %s",
                (thread_b["id"], stranger_browser),
            ).fetchall()
        assert rows == []

    def test_p_grant_persists_across_calls(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Once `?p` writes the grant, the poll stays visible without
        repeating the param — confirming it landed in poll_access, not
        just transient state in the response."""
        root = _create_poll(client, creator_secret, browser_id=creator_browser)
        # First call with ?p — establishes grant.
        resp1 = _stranger_get_thread(
            client, root["short_id"], stranger_browser, p=root["short_id"],
        )
        assert resp1.status_code == 200

        # Second call WITHOUT ?p — visibility comes from the persisted
        # poll_access row.
        resp2 = _stranger_get_thread(
            client, root["short_id"], stranger_browser,
        )
        assert resp2.status_code == 200
        ids = {p["id"] for p in resp2.json()}
        assert ids == {root["id"]}

    def test_unknown_route_id_404s(self, client, stranger_browser):
        resp = _stranger_get_thread(client, "zzznotreal", stranger_browser)
        assert resp.status_code == 404

    def test_member_sees_closed_polls_within_membership_window(
        self, client, creator_secret, creator_browser,
    ):
        """A member who closed their own poll still sees it — joined_at <=
        closed_at since membership predates the close."""
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll["id"], creator_secret, client)
        resp = client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids
