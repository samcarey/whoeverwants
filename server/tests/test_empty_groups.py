"""Tests for the empty-group endpoints.

The home "+" FAB creates a real group up-front (`POST /api/groups`) so
the user can name and share it before adding polls. The group page
falls back to `GET /api/groups/by-route-id/{id}/summary` when the
polls list is empty, and the home list merges in
`POST /api/groups/empty` alongside `/mine`.

Shared fixtures (`client`, `creator_secret`, `browser_id`) and helpers
(`create_poll`, `bid_headers`) live in `conftest.py`.
"""

import re
import uuid

from tests.conftest import bid_headers, close_poll, create_poll


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


class TestCreateGroup:
    def test_creates_empty_group_and_returns_summary(self, client, browser_id):
        resp = client.post("/api/groups", headers=bid_headers(browser_id))
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert UUID_RE.match(body["id"]) is not None
        # short_id is minted by the DB trigger from sequential_id.
        assert body["short_id"]
        assert body["title"] is None
        assert body["created_at"]

    def test_creator_is_auto_joined_as_member(self, client, browser_id):
        """The new group should immediately appear on
        `POST /api/groups/empty` for the creator, confirming the inline
        membership write landed."""
        resp = client.post("/api/groups", headers=bid_headers(browser_id))
        assert resp.status_code == 201, resp.text
        new_id = resp.json()["id"]

        empty = client.post(
            "/api/groups/empty", headers=bid_headers(browser_id),
        )
        assert empty.status_code == 200, empty.text
        empty_ids = {g["id"] for g in empty.json()}
        assert new_id in empty_ids

    def test_missing_browser_id_returns_400(self, client):
        # Override BrowserIdMiddleware's mint by sending an explicit empty
        # header — middleware accepts any string, but we route 400 from
        # the handler when no id is available.
        resp = client.post("/api/groups", headers={"X-Browser-Id": ""})
        # TestClient/middleware path: an empty header may still produce a
        # minted id. Two acceptable outcomes — 201 (middleware minted) or
        # 400 (handler rejected). The contract is "no orphan groups", so
        # if it's 201 the new group MUST appear on /empty for whatever
        # browser_id the middleware echoed back.
        if resp.status_code == 201:
            echoed = resp.headers.get("X-Browser-Id") or resp.headers.get(
                "x-browser-id"
            )
            assert echoed
            new_id = resp.json()["id"]
            empty = client.post(
                "/api/groups/empty", headers={"X-Browser-Id": echoed},
            )
            assert empty.status_code == 200
            assert new_id in {g["id"] for g in empty.json()}
        else:
            assert resp.status_code == 400

    def test_two_creates_produce_two_groups(self, client, browser_id):
        a = client.post("/api/groups", headers=bid_headers(browser_id)).json()
        b = client.post("/api/groups", headers=bid_headers(browser_id)).json()
        assert a["id"] != b["id"]
        assert a["short_id"] != b["short_id"]

        empty = client.post(
            "/api/groups/empty", headers=bid_headers(browser_id),
        ).json()
        ids = {g["id"] for g in empty}
        assert a["id"] in ids
        assert b["id"] in ids


class TestGetMyEmptyGroups:
    def test_no_membership_returns_empty_list(self, client, browser_id):
        resp = client.post(
            "/api/groups/empty", headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_groups_with_polls_are_excluded(
        self, client, creator_secret, browser_id,
    ):
        """A group with at least one poll is NOT empty — it should appear
        on `/mine`, not `/empty`."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        # Brand-new group on top.
        empty_group = client.post(
            "/api/groups", headers=bid_headers(browser_id),
        ).json()

        resp = client.post(
            "/api/groups/empty", headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        ids = {g["id"] for g in resp.json()}
        assert empty_group["id"] in ids
        # The poll's group has at least one poll, so it's NOT empty.
        assert poll["group_id"] not in ids

    def test_other_browsers_groups_are_excluded(
        self, client, browser_id,
    ):
        """Each browser sees only the empty groups it joined."""
        other = str(uuid.uuid4())
        client.post("/api/groups", headers=bid_headers(other))
        # The "other" browser's empty group should not appear for `browser_id`.
        resp = client.post(
            "/api/groups/empty", headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_missing_browser_id_returns_empty_list(self, client):
        """Without a browser_id, we can't resolve any membership — the
        response is empty rather than 400 because the FE may legitimately
        call this before the middleware lands an id."""
        resp = client.post("/api/groups/empty", headers={"X-Browser-Id": ""})
        # Middleware may mint an id; in that case the response is [].
        assert resp.status_code == 200
        # Either no groups for the empty header, or no groups for the
        # freshly minted id — both produce an empty list.
        assert resp.json() == []

    def test_group_with_all_polls_hidden_pre_join_appears(
        self, client, creator_secret, browser_id,
    ):
        """The home-list gap from the June 2026 prod report: a member
        whose group's every poll closed BEFORE they joined gets nothing
        from `/mine` (closed-before-join filter) — so `/empty` must
        surface the group (with `has_polls: true`) or it has no home
        entry at all and the only way back is the invite URL."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = close_poll(client, poll)
        assert resp.status_code == 200, resp.text

        # A late joiner: visiting the (public) group URL auto-joins with
        # joined_at = now, which is AFTER the poll closed.
        joiner = str(uuid.uuid4())
        read = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=bid_headers(joiner),
        )
        assert read.status_code == 200, read.text
        # The closed-pre-join poll is filtered from the group read…
        assert read.json() == []

        # …and /mine is equally empty…
        mine = client.post(
            "/api/groups/mine",
            json={"include_results": False},
            headers=bid_headers(joiner),
        )
        assert mine.status_code == 200
        assert mine.json() == []

        # …so /empty must carry the group, flagged as having (hidden)
        # polls so the FE renders the hidden-history row, not the
        # "new group — tap to add a poll" copy.
        empty = client.post("/api/groups/empty", headers=bid_headers(joiner))
        assert empty.status_code == 200, empty.text
        by_id = {g["id"]: g for g in empty.json()}
        assert poll["group_id"] in by_id
        assert by_id[poll["group_id"]]["has_polls"] is True

    def test_closed_poll_group_stays_off_empty_for_pre_close_member(
        self, client, creator_secret, browser_id,
    ):
        """The creator joined before the close, so the closed poll is
        still visible to them — the group belongs to their `/mine`
        response and must NOT also appear on `/empty`."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = close_poll(client, poll)
        assert resp.status_code == 200, resp.text

        empty = client.post(
            "/api/groups/empty", headers=bid_headers(browser_id),
        )
        assert empty.status_code == 200
        assert poll["group_id"] not in {g["id"] for g in empty.json()}

    def test_open_poll_group_stays_off_empty_for_late_joiner(
        self, client, creator_secret, browser_id,
    ):
        """An open poll is visible to any member regardless of join
        time, so its group is `/mine` territory — never `/empty`."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        joiner = str(uuid.uuid4())
        read = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=bid_headers(joiner),
        )
        assert read.status_code == 200, read.text

        empty = client.post("/api/groups/empty", headers=bid_headers(joiner))
        assert empty.status_code == 200
        assert poll["group_id"] not in {g["id"] for g in empty.json()}


class TestGroupSummary:
    def test_returns_metadata_for_empty_group(self, client, browser_id):
        new_group = client.post(
            "/api/groups", headers=bid_headers(browser_id),
        ).json()
        # By short_id.
        resp = client.get(
            f"/api/groups/by-route-id/{new_group['short_id']}/summary",
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == new_group["id"]
        assert body["short_id"] == new_group["short_id"]
        assert body["title"] is None
        assert body["created_at"]
        # A brand-new group has no polls — the FE uses this to show the
        # create-first-poll flow rather than the To Do/New/Old tabs.
        assert body["has_polls"] is False

    def test_returns_metadata_for_populated_group(
        self, client, creator_secret, browser_id,
    ):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}/summary",
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == poll["group_id"]
        assert body["short_id"] == poll["group_short_id"]
        assert body["has_polls"] is True

    def test_has_polls_true_even_when_all_hidden_pre_join(
        self, client, creator_secret, browser_id,
    ):
        """A late joiner whose visibility hides every poll still gets
        `has_polls: True` from the summary — so the group page shows the
        To Do/New/Old tabs (with empty messages) rather than a blank page.

        The summary endpoint is visibility-blind for public groups, so a
        fresh browser that has never joined still sees `has_polls: True`
        as long as the group has any poll at all."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        stranger = str(uuid.uuid4())
        resp = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}/summary",
            headers=bid_headers(stranger),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["has_polls"] is True

    def test_unknown_route_id_returns_404(self, client):
        resp = client.get("/api/groups/by-route-id/zzznotreal/summary")
        assert resp.status_code == 404

    def test_resolves_by_poll_short_id(
        self, client, creator_secret, browser_id,
    ):
        """Summary endpoint accepts the same four route-id forms as the
        sibling read endpoint (groups.short_id, groups.id, polls.short_id,
        polls.id)."""
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.get(
            f"/api/groups/by-route-id/{poll['short_id']}/summary",
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == poll["group_id"]
