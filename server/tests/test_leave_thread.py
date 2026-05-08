"""DELETE /api/threads/{route_id}/membership — explicit "leave thread".

The "leave thread" endpoint is the explicit teardown counterpart to the
auto-join writes (creator on create, voter on vote, visitor on
by-route-id read). It exists so the FE can retire the legacy
`accessible_question_ids` bridge in `/api/threads/mine`: once the FE
calls DELETE on forget-of-last-poll (or via an explicit "leave thread"
UX), `thread_members` becomes the sole source of truth for "is this
thread on my home list" and the bridge is dead code.

Migration 106 retired per-poll access; thread membership is the only
access mechanism. Note that re-visiting a thread URL after leave will
write a fresh `thread_members` row with a new `joined_at` watermark.

Shared fixtures (`client`, `creator_secret`, `browser_id`) and helpers
(`create_poll`, `bid_headers`, `thread_members_for`) live in
`conftest.py`.
"""

import uuid

import pytest

from tests.conftest import (
    bid_headers,
    create_poll,
    thread_members_for,
)


class TestLeaveThread:
    def test_member_can_leave(self, client, creator_secret, browser_id):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        thread_id = poll["thread_id"]
        assert browser_id in thread_members_for(thread_id)

        resp = client.delete(
            f"/api/threads/{poll['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        assert browser_id not in thread_members_for(thread_id)

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
        assert browser_id not in thread_members_for(poll["thread_id"])

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
        assert browser_id in thread_members_for(poll["thread_id"])

    def test_unknown_route_id_404s(self, client, browser_id):
        resp = client.delete(
            "/api/threads/zzznotreal/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 404

    @pytest.mark.parametrize(
        "route_id_field",
        # Each form is a key on the `create_poll` response; the test picks
        # that field as the route_id and confirms `resolve_thread_id_from_route_id`
        # walks all four lookup paths.
        ["short_id", "thread_id", "thread_short_id", "id"],
    )
    def test_resolves_each_route_id_form(
        self, client, creator_secret, browser_id, route_id_field,
    ):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        route_id = poll[route_id_field]
        assert route_id, f"Expected create_poll response to carry {route_id_field}"

        resp = client.delete(
            f"/api/threads/{route_id}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204
        assert browser_id not in thread_members_for(poll["thread_id"])

    def test_leave_is_per_browser(
        self, client, creator_secret, browser_id,
    ):
        """One browser leaving doesn't touch another browser's membership
        in the same thread."""
        root = create_poll(client, creator_secret, browser_id=browser_id)
        other = str(uuid.uuid4())
        create_poll(
            client, creator_secret, browser_id=other,
            thread_id=root["thread_id"],
        )
        members = set(thread_members_for(root["thread_id"]))
        assert browser_id in members and other in members

        resp = client.delete(
            f"/api/threads/{root['short_id']}/membership",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 204

        members = set(thread_members_for(root["thread_id"]))
        assert browser_id not in members
        assert other in members

    def test_no_browser_id_header_still_204_for_known_thread(
        self, client, creator_secret, browser_id,
    ):
        """A request with no X-Browser-Id header for a real thread is a
        no-op (no row to remove) but still 204. Note: TestClient's
        BrowserIdMiddleware mints a fresh browser_id when none is
        provided, so this is "fresh browser_id with no membership" —
        same contract from the endpoint's perspective."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.delete(f"/api/threads/{poll['short_id']}/membership")
        assert resp.status_code == 204
        assert browser_id in thread_members_for(poll["thread_id"])
