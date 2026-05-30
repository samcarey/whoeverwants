"""Visibility-aware single-poll read.

`GET /api/groups/by-route-id/{route_id}/poll/{poll_ref}` is the direct
poll-link landing path (`/g/<group>/p/<poll>`). Unlike the
visibility-blind `GET /api/polls/{short_id}`, it enforces the group
visibility rule so a late joiner who taps a link to a poll that closed
BEFORE they joined gets a `hidden_pre_join` marker (existence + closure
timing only — never the contents) instead of either the leaked contents
or a misleading "not found".

Companion to `test_groups_visibility.py` (the group-level read). Shared
fixtures (`client`, `creator_secret`) and helpers (`create_poll`,
`creator_headers`) live in `conftest.py`.
"""

import uuid

import psycopg
import pytest

from tests.conftest import TEST_DB_URL, create_poll, creator_headers


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def stranger_browser():
    return str(uuid.uuid4())


def _close_poll(poll: dict, client):
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text


def _set_poll_updated_at(poll_id: str, dt_iso: str):
    """Backdate updated_at (the closed_at proxy) below a join watermark."""
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE polls SET updated_at = %s WHERE id = %s",
            (dt_iso, poll_id),
        )


def _set_group_private(group_id: str):
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE groups SET privacy = 'private' WHERE id = %s",
            (group_id,),
        )


def _get_poll(client, route_id, poll_ref, browser_id):
    return client.get(
        f"/api/groups/by-route-id/{route_id}/poll/{poll_ref}",
        headers={"X-Browser-Id": browser_id},
    )


class TestGroupPollVisibility:
    def test_member_sees_visible_poll(self, client, creator_secret, creator_browser):
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = _get_poll(client, poll["short_id"], poll["short_id"], creator_browser)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "visible"
        assert body["poll"]["id"] == poll["id"]

    def test_stranger_auto_joins_open_poll(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Landing on a public group's poll link joins the caller (like the
        group read) and surfaces the open poll."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = _get_poll(client, poll["short_id"], poll["short_id"], stranger_browser)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "visible"
        assert body["poll"]["id"] == poll["id"]

    def test_late_joiner_closed_pre_join_poll_is_hidden(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """The headline case: a poll closed BEFORE the caller joined returns
        a hidden_pre_join marker with closure timing — never the contents."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll, client)
        _set_poll_updated_at(poll["id"], "2000-01-01T00:00:00Z")

        resp = _get_poll(client, poll["short_id"], poll["short_id"], stranger_browser)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "hidden_pre_join"
        assert body["poll"] is None
        assert body["closed_at"] is not None

    def test_member_sees_own_closed_poll(
        self, client, creator_secret, creator_browser,
    ):
        """A poll the caller closed themselves stays visible — they joined
        the group before it closed."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll, client)
        resp = _get_poll(client, poll["short_id"], poll["short_id"], creator_browser)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "visible"
        assert body["poll"]["id"] == poll["id"]

    def test_resolve_poll_by_uuid(self, client, creator_secret, creator_browser):
        """poll_ref accepts a poll uuid as well as a short_id."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = _get_poll(client, poll["short_id"], poll["id"], creator_browser)
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "visible"

    def test_unknown_poll_in_group_404s(
        self, client, creator_secret, creator_browser,
    ):
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = _get_poll(
            client, poll["short_id"], "zzznotreal", creator_browser,
        )
        assert resp.status_code == 404

    def test_cross_group_poll_ref_404s(
        self, client, creator_secret, creator_browser,
    ):
        """A poll id that belongs to a DIFFERENT group does not resolve under
        this group's route — the lookup is scoped to the group."""
        a = create_poll(client, creator_secret, browser_id=creator_browser)
        b = create_poll(client, creator_secret, browser_id=creator_browser)
        # Ask for b's poll under a's group route → not found in a's group.
        resp = _get_poll(client, a["short_id"], b["short_id"], creator_browser)
        assert resp.status_code == 404

    def test_unknown_route_404s(self, client, creator_browser):
        resp = _get_poll(client, "zzznotreal", "alsoreal", creator_browser)
        assert resp.status_code == 404

    def test_private_group_non_member_404s(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """A non-member of a private group gets 404 at the boundary — same
        as the group read — never a hidden_pre_join leak of existence."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _set_group_private(poll["group_id"])
        resp = _get_poll(client, poll["short_id"], poll["short_id"], stranger_browser)
        assert resp.status_code == 404
