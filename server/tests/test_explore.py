"""Tests for the /explore feed (migration 143).

An explore poll (`POST /api/polls` with `explore: true`) is filed into the
caller's per-user "explore group" (`privacy='explore'`), which:
  * surfaces only at `POST /api/groups/explore` (own polls, newest-first),
  * NEVER appears on `/api/groups/mine` or `/empty`,
  * is members-only (the creator's group URL resolves; strangers 404).

Shared fixtures + helpers live in `conftest.py`.
"""

import uuid

from tests.conftest import bid_headers, create_poll


def _create_explore_poll(client, browser_id, title="Explore Q"):
    return create_poll(
        client,
        browser_id=browser_id,
        explore=True,
        questions=[{"question_type": "yes_no", "title": title}],
        title=title,
    )


class TestExploreFeed:
    def test_empty_feed_for_new_caller(self, client, browser_id):
        resp = client.post("/api/groups/explore", headers=bid_headers(browser_id))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["group"] is None
        assert body["polls"] == []

    def test_create_explore_poll_appears_in_feed(self, client, browser_id):
        poll = _create_explore_poll(client, browser_id, "Coffee?")
        resp = client.post("/api/groups/explore", headers=bid_headers(browser_id))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["group"] is not None
        assert body["group"]["privacy"] == "explore"
        ids = {p["id"] for p in body["polls"]}
        assert poll["id"] in ids

    def test_explore_poll_not_in_mine_or_empty(self, client, browser_id):
        _create_explore_poll(client, browser_id, "Hidden from home")
        mine = client.post(
            "/api/groups/mine",
            json={"include_results": False},
            headers=bid_headers(browser_id),
        )
        assert mine.status_code == 200, mine.text
        assert mine.json() == []
        empty = client.post("/api/groups/empty", headers=bid_headers(browser_id))
        assert empty.status_code == 200, empty.text
        # The explore group must not surface as an "empty group" either.
        assert empty.json() == []

    def test_regular_poll_not_in_explore_feed(self, client, browser_id):
        regular = create_poll(client, browser_id=browser_id)
        resp = client.post("/api/groups/explore", headers=bid_headers(browser_id))
        assert resp.status_code == 200, resp.text
        ids = {p["id"] for p in resp.json()["polls"]}
        assert regular["id"] not in ids

    def test_another_user_cannot_see_my_explore_polls(self, client, browser_id):
        _create_explore_poll(client, browser_id, "Mine only")
        other = str(uuid.uuid4())
        resp = client.post("/api/groups/explore", headers=bid_headers(other))
        assert resp.status_code == 200, resp.text
        assert resp.json()["group"] is None
        assert resp.json()["polls"] == []

    def test_explore_polls_reuse_one_group(self, client, browser_id):
        a = _create_explore_poll(client, browser_id, "First")
        b = _create_explore_poll(client, browser_id, "Second")
        assert a["group_id"] == b["group_id"]
        resp = client.post("/api/groups/explore", headers=bid_headers(browser_id))
        ids = {p["id"] for p in resp.json()["polls"]}
        assert {a["id"], b["id"]} <= ids

    def test_explore_group_url_is_members_only(self, client, browser_id):
        """The explore group's own URL resolves for the creator but 404s a
        stranger (members-only, like a private group)."""
        poll = _create_explore_poll(client, browser_id, "Members only")
        route = poll["group_short_id"] or poll["group_id"]
        # Creator (member) can read it.
        mine = client.get(
            f"/api/groups/by-route-id/{route}", headers=bid_headers(browser_id)
        )
        assert mine.status_code == 200, mine.text
        assert poll["id"] in {p["id"] for p in mine.json()}
        # A stranger gets 404 (no auto-join for explore groups).
        stranger = client.get(
            f"/api/groups/by-route-id/{route}",
            headers=bid_headers(str(uuid.uuid4())),
        )
        assert stranger.status_code == 404, stranger.text
