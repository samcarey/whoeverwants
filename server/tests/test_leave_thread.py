"""Phase C.3 follow-up — DELETE /api/threads/{route_id}/membership.

The "leave thread" endpoint is the explicit teardown counterpart to the
auto-join writes in Phase C.2. It exists so the FE can retire the legacy
`accessible_question_ids` bridge in `/api/threads/mine`: once the FE
calls DELETE on forget-of-last-poll (or via an explicit "leave thread"
UX), `thread_members` becomes the sole source of truth for "is this
thread on my home list" and the bridge is dead code.

Covers:
  * Member can leave their own thread (row removed, subsequent /mine
    excludes the thread).
  * Idempotent: leaving twice still returns 204 even though the second
    call has nothing to remove.
  * Strangers (no membership row) get 204 — operation is "ensure no
    membership exists".
  * 404 on unknown route_id — distinguishes "thread doesn't exist"
    from "no membership to remove".
  * `poll_access` rows are NOT touched by leaving — direct-link access
    persists across leaves.
  * Resolves all four route_id forms (threads.short_id, threads.id,
    polls.short_id, polls.id).
  * Leaving doesn't affect OTHER browsers' membership in the thread.

Shared fixtures (`client`, `creator_secret`, `browser_id`) and helpers
(`create_poll`) live in `conftest.py`.
"""

import uuid

import psycopg

from tests.conftest import TEST_DB_URL, bid_headers, create_poll


def _thread_members(thread_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id FROM thread_members WHERE thread_id = %s",
            (thread_id,),
        ).fetchall()
    return [str(r[0]) for r in rows]


def _poll_access(poll_id, browser_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT 1 FROM poll_access WHERE poll_id = %s AND browser_id = %s",
            (poll_id, browser_id),
        ).fetchall()
    return len(rows) == 1


class TestLeaveThread:
    def test_member_can_leave(self, client, creator_secret, browser_id):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        thread_id = poll["thread_id"]
        # Sanity: creator auto-joined.
        assert browser_id in _thread_members(thread_id)

        resp = client.delete(
            f"/api/threads/{poll['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        assert browser_id not in _thread_members(thread_id)

    def test_after_leave_thread_disappears_from_mine(
        self, client, creator_secret, browser_id,
    ):
        kept = create_poll(client, creator_secret, browser_id=browser_id)
        leaving = create_poll(client, creator_secret, browser_id=browser_id)
        # Both threads visible before the leave.
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        ids = {p["id"] for p in resp.json()}
        assert ids == {kept["id"], leaving["id"]}

        # Leave one.
        resp = client.delete(
            f"/api/threads/{leaving['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204

        # Membership-only call (no legacy bridge) excludes the left thread.
        resp = client.post(
            "/api/threads/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        ids = {p["id"] for p in resp.json()}
        assert ids == {kept["id"]}

    def test_idempotent_double_leave(self, client, creator_secret, browser_id):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        first = client.delete(
            f"/api/threads/{poll['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert first.status_code == 204
        # No row to delete the second time, but the endpoint still 204s.
        second = client.delete(
            f"/api/threads/{poll['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert second.status_code == 204
        assert browser_id not in _thread_members(poll["thread_id"])

    def test_stranger_leave_is_noop_204(
        self, client, creator_secret, browser_id,
    ):
        """A user with no membership row in the thread can still call
        DELETE — they get 204 because the post-condition ("no membership
        exists") was already true. The creator's row is untouched."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        stranger = str(uuid.uuid4())

        resp = client.delete(
            f"/api/threads/{poll['short_id']}/membership",
            headers=bid_headers(stranger),
        )
        assert resp.status_code == 204
        # Creator still a member.
        assert browser_id in _thread_members(poll["thread_id"])

    def test_unknown_route_id_404s(self, client, browser_id):
        resp = client.delete(
            "/api/threads/zzznotreal/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 404

    def test_leave_does_not_revoke_poll_access(
        self, client, creator_secret, browser_id,
    ):
        """Leaving a thread tears down `thread_members` only. Per-poll
        access (poll_access rows) survives the leave — direct-link
        relationships are independent of thread membership."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        # Stranger grants themselves direct access AND happens to hold
        # membership through some other path. Simulate by using the
        # creator (who's both a member AND we'll grant per-poll access).
        grant = client.post(
            f"/api/polls/{poll['id']}/access",
            headers=bid_headers(browser_id),
        )
        assert grant.status_code == 204
        assert _poll_access(poll["id"], browser_id) is True

        resp = client.delete(
            f"/api/threads/{poll['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        # Membership gone.
        assert browser_id not in _thread_members(poll["thread_id"])
        # Poll access preserved.
        assert _poll_access(poll["id"], browser_id) is True

    def test_resolves_thread_short_id(
        self, client, creator_secret, browser_id,
    ):
        """Route id = threads.short_id (the canonical post-B.4 form,
        starting with `~`)."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        thread_short_id = poll["thread_short_id"]
        assert thread_short_id  # Phase B.4 mints one for every new thread

        resp = client.delete(
            f"/api/threads/{thread_short_id}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        assert browser_id not in _thread_members(poll["thread_id"])

    def test_resolves_thread_uuid(self, client, creator_secret, browser_id):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.delete(
            f"/api/threads/{poll['thread_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        assert browser_id not in _thread_members(poll["thread_id"])

    def test_resolves_poll_uuid(self, client, creator_secret, browser_id):
        """Legacy form: route id = polls.id resolves via the polls.id
        fallback in resolve_thread_id_from_route_id."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.delete(
            f"/api/threads/{poll['id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        assert browser_id not in _thread_members(poll["thread_id"])

    def test_leave_is_per_browser(
        self, client, creator_secret, browser_id,
    ):
        """One browser leaving doesn't touch another browser's membership
        in the same thread."""
        root = create_poll(client, creator_secret, browser_id=browser_id)
        other = str(uuid.uuid4())
        # `other` joins by creating a follow-up.
        create_poll(
            client, creator_secret, browser_id=other,
            follow_up_to=root["questions"][0]["id"],
        )
        members = set(_thread_members(root["thread_id"]))
        assert browser_id in members and other in members

        # `browser_id` leaves.
        resp = client.delete(
            f"/api/threads/{root['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204

        members = set(_thread_members(root["thread_id"]))
        assert browser_id not in members
        assert other in members

    def test_no_browser_id_header_still_204_for_known_thread(
        self, client, creator_secret, browser_id,
    ):
        """A request with no X-Browser-Id header for a real thread is a
        no-op (no row to remove) but still 204. Unknown threads still
        404 — resolution fails before the no-op check."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        # Note: TestClient's BrowserIdMiddleware mints a fresh browser_id
        # when no X-Browser-Id header is provided, so this isn't truly
        # "no browser_id" — it's "a fresh browser_id that has no
        # membership row anywhere". Either way the endpoint is a no-op
        # with 204, which is the contract.
        resp = client.delete(f"/api/threads/{poll['short_id']}/membership")
        assert resp.status_code == 204
        # Creator's membership row is untouched.
        assert browser_id in _thread_members(poll["thread_id"])
