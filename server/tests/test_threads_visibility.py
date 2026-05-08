"""Visibility enforcement on the threads read endpoints.

Covers:
  * /api/threads/mine returns only polls visible per the visibility rule
  * /api/threads/by-route-id/{id} auto-joins the visitor (any visit grants
    thread membership inline) and returns the visible polls
  * Closed-poll filter: closed-before-joined_at hidden for members, but
    bridged threads bypass the filter
  * Forget bridge: member-thread without legacy-list signal disappears
  * 404 only when route resolution fails; an empty visible-polls list
    still returns 200 with [] so the FE can render thread chrome

The companion file `test_membership_writes.py` covers the WRITE side
(auto-join from create / vote / visit). This file covers the READ side.

Shared fixtures (`client`, `creator_secret`) and helpers (`create_poll`)
live in `conftest.py`.
"""

import uuid

import psycopg
import pytest

from tests.conftest import TEST_DB_URL, create_poll


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def stranger_browser():
    return str(uuid.uuid4())


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
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
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
        create_poll(client, creator_secret, browser_id=creator_browser)
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
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        child = create_poll(
            client, creator_secret, browser_id=creator_browser,
            thread_id=root["thread_id"],
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
        kept = create_poll(client, creator_secret, browser_id=creator_browser)
        forgotten = create_poll(client, creator_secret, browser_id=creator_browser)

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
        a = create_poll(client, creator_secret, browser_id=creator_browser)
        b = create_poll(client, creator_secret, browser_id=creator_browser)
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
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll["id"], creator_secret, client)
        # Backdate the close so it lives in the distant past.
        _set_poll_updated_at(poll["id"], "2000-01-01T00:00:00Z")

        # A second user joins by creating a follow-up *after* the close.
        # They become a thread member with joined_at = NOW(); the closed
        # poll's closed_at (year 2000) is < joined_at, so it's filtered out.
        followup = create_poll(
            client, creator_secret, browser_id=stranger_browser,
            thread_id=poll["thread_id"],
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
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
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

# ---------------------------------------------------------------------------
# /api/threads/by-route-id/{route_id}
# ---------------------------------------------------------------------------


class TestByRouteIdVisibility:
    def test_member_can_read(self, client, creator_secret, creator_browser):
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_stranger_visit_auto_joins_and_sees_thread(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Migration 106: any visit to a thread URL writes thread_members
        inline. The stranger becomes a thread member as part of the
        read."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        child = create_poll(
            client, creator_secret, browser_id=creator_browser,
            thread_id=root["thread_id"],
        )
        resp = _stranger_get_thread(
            client, root["short_id"], stranger_browser,
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # Both polls are open and the visitor just joined → both visible.
        assert ids == {root["id"], child["id"]}

    def test_stranger_with_p_param_still_auto_joins(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """`?p=<pollShortId>` is purely cosmetic at the API level. The
        visit grants whole-thread membership regardless of `?p`."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        child = create_poll(
            client, creator_secret, browser_id=creator_browser,
            thread_id=root["thread_id"],
        )
        resp = _stranger_get_thread(
            client, root["short_id"], stranger_browser, p=child["short_id"],
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # Whole thread visible; `?p` does not narrow visibility.
        assert ids == {root["id"], child["id"]}

    def test_stranger_visit_to_thread_with_pre_join_closed_poll_omits_it(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """User spec: 'if they received a direct link to a poll closed
        before they joined the thread, just show the thread and don't try
        to show the old poll.' The thread renders, the closed-pre-join
        poll is filtered out."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        # Close root in the distant past — before the stranger joins.
        _close_poll(root["id"], creator_secret, client)
        _set_poll_updated_at(root["id"], "2000-01-01T00:00:00Z")
        # Add a still-open follow-up.
        followup = create_poll(
            client, creator_secret, browser_id=creator_browser,
            thread_id=root["thread_id"],
        )

        resp = _stranger_get_thread(
            client, root["short_id"], stranger_browser, p=root["short_id"],
        )
        # Thread itself resolves → 200, but the linked closed-pre-join poll
        # is filtered out. The follow-up is still visible.
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert root["id"] not in ids
        assert followup["id"] in ids

    def test_unknown_route_id_404s(self, client, stranger_browser):
        resp = _stranger_get_thread(client, "zzznotreal", stranger_browser)
        assert resp.status_code == 404

    def test_member_sees_closed_polls_within_membership_window(
        self, client, creator_secret, creator_browser,
    ):
        """A member who closed their own poll still sees it — joined_at <=
        closed_at since membership predates the close."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll["id"], creator_secret, client)
        resp = client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids
