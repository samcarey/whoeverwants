"""Integration tests for the groups API (Phase B.3 / C.3).

Covers:
  - POST /api/groups/mine  — discovery + accessibility in one call
  - GET  /api/groups/by-route-id/{route_id} — by short_id and uuid
  - BrowserIdMiddleware — header echo + auto-mint

Visibility-enforcement tests live in test_groups_visibility.py.
Shared fixtures (`client`, `creator_secret`, `browser_id`) and helpers
(`create_poll`, `create_followup`, `bid_headers`) live in `conftest.py`.

Like test_polls_api.py these need a real Postgres reachable via DATABASE_URL.
"""

import re
import uuid

from tests.conftest import bid_headers, create_followup, create_poll


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


class TestMyGroups:
    """`/api/groups/mine` is membership-only — `group_members` is the
    single source of truth (the legacy `accessible_question_ids` forget
    bridge has been removed). Tests pin the same `browser_id` through
    `create_poll` (which auto-joins the creator as a member) and the
    `/mine` POST so the creator sees their own groups. The
    `accessible_question_ids` field is still sent (older bundles do) but
    the server ignores it."""

    def test_empty_input_returns_empty(self, client):
        resp = client.post("/api/groups/mine", json={"accessible_question_ids": []})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_single_question_returns_its_poll(
        self, client, creator_secret, browser_id,
    ):
        poll = create_poll(client, creator_secret, browser_id=browser_id)

        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        polls = resp.json()
        assert len(polls) == 1
        assert polls[0]["id"] == poll["id"]

    def test_followup_chain_returns_every_poll_in_group(
        self, client, creator_secret, browser_id,
    ):
        """Membership in a multi-poll group returns EVERY visible poll in
        that group — the creator auto-joins on each create, so all three
        polls in the same group are visible from the one membership row."""
        root = create_poll(client, creator_secret, browser_id=browser_id)
        child1 = create_followup(
            client, creator_secret, root["questions"][0]["id"],
            browser_id=browser_id,
        )
        child2 = create_followup(
            client, creator_secret, child1["questions"][0]["id"],
            browser_id=browser_id,
        )

        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        polls = resp.json()
        ids = {p["id"] for p in polls}
        assert ids == {root["id"], child1["id"], child2["id"]}

    def test_two_unrelated_groups_both_returned(
        self, client, creator_secret, browser_id,
    ):
        a = create_poll(client, creator_secret, browser_id=browser_id)
        b = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {a["id"], b["id"]}

    def test_no_membership_returns_empty(self, client, creator_secret):
        """A browser that created nothing (and is a member of nothing) sees
        an empty list, even if it passes an arbitrary
        `accessible_question_ids` — the field is ignored now that the
        bridge is gone."""
        # Create a poll under a DIFFERENT (auto-minted) browser_id, then
        # query /mine under a fresh browser with the question id in the
        # (ignored) accessible list.
        other = create_poll(client, creator_secret)
        resp = client.post(
            "/api/groups/mine",
            json={
                "accessible_question_ids": [other["questions"][0]["id"]],
            },
            headers=bid_headers(str(uuid.uuid4())),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_unknown_question_id_returns_empty(self, client):
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": [str(uuid.uuid4())]},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_inline_results_default_on(
        self, client, creator_secret, browser_id,
    ):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        polls = resp.json()
        # Open question with no votes still has the `results` field on the
        # question (since show_preliminary_results defaults to True and the
        # question has no min_responses gate).
        assert polls[0]["questions"][0].get("results") is not None

    def test_inline_results_off_when_requested(
        self, client, creator_secret, browser_id,
    ):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.post(
            "/api/groups/mine",
            json={
                "accessible_question_ids": [],
                "include_results": False,
            },
            headers=bid_headers(browser_id),
        )
        polls = resp.json()
        assert polls[0]["questions"][0].get("results") is None


class TestGroupByRouteId:
    """by-route-id auto-joins the visitor to the resolved group inline
    (idempotent ON CONFLICT) and returns the polls visible per the
    group-membership rule. Tests pin the same browser_id through
    create + read so the creator's auto-join makes them a member from
    the first call."""

    def test_resolves_by_root_poll_short_id(
        self, client, creator_secret, browser_id,
    ):
        root = create_poll(client, creator_secret, browser_id=browser_id)
        child = create_followup(
            client, creator_secret, root["questions"][0]["id"],
            browser_id=browser_id,
        )

        # groupShortId is the root poll's short_id today.
        resp = client.get(
            f"/api/groups/by-route-id/{root['short_id']}",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        polls = resp.json()
        ids = {p["id"] for p in polls}
        assert ids == {root["id"], child["id"]}

    def test_resolves_by_root_poll_uuid(
        self, client, creator_secret, browser_id,
    ):
        root = create_poll(client, creator_secret, browser_id=browser_id)
        create_followup(
            client, creator_secret, root["questions"][0]["id"],
            browser_id=browser_id,
        )

        resp = client.get(
            f"/api/groups/by-route-id/{root['id']}",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert root["id"] in ids

    def test_resolves_by_child_poll_short_id(
        self, client, creator_secret, browser_id,
    ):
        """Even if the user types a child poll's short_id into the route id
        slot, we still return the WHOLE group — that's the only sensible
        definition of `/g/<routeId>`."""
        root = create_poll(client, creator_secret, browser_id=browser_id)
        child = create_followup(
            client, creator_secret, root["questions"][0]["id"],
            browser_id=browser_id,
        )

        resp = client.get(
            f"/api/groups/by-route-id/{child['short_id']}",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {root["id"], child["id"]}

    def test_unknown_route_id_returns_404(self, client):
        resp = client.get(f"/api/groups/by-route-id/zzznotreal")
        assert resp.status_code == 404

    def test_include_results_query_param(
        self, client, creator_secret, browser_id,
    ):
        root = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.get(
            f"/api/groups/by-route-id/{root['short_id']}?include_results=false",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        polls = resp.json()
        assert polls[0]["questions"][0].get("results") is None


class TestGroupPreview:
    """The link-preview endpoint must surface the poll's REAL title (e.g.
    a user-typed yes_no prompt) — not the generic category name. Earlier
    the endpoint built the title purely from `generate_poll_title` using
    categories/contexts, so a yes_no poll titled "Should we get pizza?"
    rendered as "Yes/No?" in iMessage / Slack / Twitter previews."""

    def test_yes_no_user_typed_title_is_used(
        self, client, creator_secret, browser_id,
    ):
        poll = create_poll(
            client,
            creator_secret,
            browser_id=browser_id,
            title="Should we get pizza tonight?",
        )
        resp = client.get(f"/api/groups/by-route-id/{poll['short_id']}/preview")
        assert resp.status_code == 200
        assert resp.json()["title"] == "Should we get pizza tonight?"

    def test_group_title_override_is_bypassed(
        self, client, creator_secret, browser_id,
    ):
        """`groups.title` overrides are a group-name override (often a
        participant-name string like "Alice, Bob") and would mislead a
        link-preview consumer. The poll's actual subject must win."""
        poll = create_poll(
            client,
            creator_secret,
            browser_id=browser_id,
            title="Should we get pizza tonight?",
            group_title="Alice, Bob",
        )
        resp = client.get(f"/api/groups/by-route-id/{poll['short_id']}/preview")
        assert resp.status_code == 200
        assert resp.json()["title"] == "Should we get pizza tonight?"

    def test_falls_back_to_auto_title_when_question_title_missing(
        self, client, creator_secret, browser_id,
    ):
        """A poll created with no explicit title still gets an
        auto-generated one stamped on `questions[0].title` at create time
        (see `_resolve_question_title` in routers/polls.py). The preview
        surfaces THAT — never reaches the inner `generate_poll_title`
        fallback in normal flow. This test just confirms preview returns
        SOMETHING reasonable when no title is supplied (i.e. the stamped
        auto-title)."""
        poll = create_poll(
            client,
            creator_secret,
            browser_id=browser_id,
        )
        resp = client.get(f"/api/groups/by-route-id/{poll['short_id']}/preview")
        assert resp.status_code == 200
        title = resp.json()["title"]
        # Auto-titled for a single yes_no question, but the only invariant
        # we care about: not empty.
        assert title

    def test_empty_group_returns_200_with_default_title(
        self, client, browser_id,
    ):
        """An empty group (no polls) must NOT 404 on /preview — the
        GroupNotFound page uses /preview to distinguish "private + no
        access" from "doesn't exist". Returning 404 here would
        mis-classify a private empty group as missing."""
        resp = client.post("/api/groups", headers=bid_headers(browser_id))
        assert resp.status_code == 201, resp.text
        group = resp.json()

        resp = client.get(
            f"/api/groups/by-route-id/{group['short_id']}/preview"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"]  # default fallback when no override is set
        assert body["description"] is None

    def test_empty_group_uses_title_override(
        self, client, browser_id,
    ):
        """When the empty group has a `groups.title` override (set via
        /edit-title), the preview surfaces it. Unlike the populated case,
        the override is honored here because there's no poll subject to
        defer to."""
        resp = client.post("/api/groups", headers=bid_headers(browser_id))
        assert resp.status_code == 201, resp.text
        group = resp.json()

        title_resp = client.post(
            f"/api/groups/{group['short_id']}/title",
            json={"group_title": "Movie Night 2026"},
            headers=bid_headers(browser_id),
        )
        assert title_resp.status_code == 200, title_resp.text

        resp = client.get(
            f"/api/groups/by-route-id/{group['short_id']}/preview"
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Movie Night 2026"

    def test_unknown_route_still_returns_404(self, client):
        """Sanity: a truly nonexistent group must still 404. The
        empty-group fallback only activates AFTER `resolve_group_id_from_route_id`
        succeeds."""
        resp = client.get("/api/groups/by-route-id/zzznotreal/preview")
        assert resp.status_code == 404


class TestBrowserIdMiddleware:
    def test_response_carries_browser_id_header(self, client, creator_secret):
        """First-visit case: client sends no header; server mints + echoes one."""
        resp = client.post("/api/groups/mine", json={"accessible_question_ids": []})
        assert resp.status_code == 200
        bid = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert bid is not None
        assert UUID_RE.match(bid)

    def test_supplied_browser_id_is_echoed(self, client):
        my_id = str(uuid.uuid4())
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": my_id},
        )
        assert resp.status_code == 200
        echoed = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert echoed == my_id

    def test_malformed_browser_id_is_replaced(self, client):
        resp = client.post(
            "/api/groups/mine",
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
        resp = client.get("/api/groups/by-route-id/zzznotreal")
        assert resp.status_code == 404
        echoed = resp.headers.get("X-Browser-Id") or resp.headers.get("x-browser-id")
        assert echoed and UUID_RE.match(echoed)


class TestGroupShortIdKeyspace:
    """Phase B.4: every PollResponse carries group_id + group_short_id, and
    fresh groups.short_ids are minted from a separate `~`-prefixed keyspace
    that's collision-free with polls.short_id."""

    def test_create_poll_returns_group_id_and_group_short_id(
        self, client, creator_secret,
    ):
        poll = create_poll(client, creator_secret)
        assert poll.get("group_id") is not None
        assert UUID_RE.match(poll["group_id"])
        # Fresh groups minted post-migration-101 are prefixed with `~`,
        # which guarantees no collision with the base62-encoded poll
        # short_ids (`0-9 A-Z a-z`).
        assert poll.get("group_short_id") is not None
        assert poll["group_short_id"].startswith("~")

    def test_followup_inherits_parent_group_short_id(
        self, client, creator_secret,
    ):
        root = create_poll(client, creator_secret)
        child = create_followup(client, creator_secret, root["questions"][0]["id"])
        assert root["group_id"] == child["group_id"]
        assert root["group_short_id"] == child["group_short_id"]

    def test_get_poll_returns_group_short_id(self, client, creator_secret):
        poll = create_poll(client, creator_secret)
        resp = client.get(f"/api/polls/{poll['short_id']}")
        assert resp.status_code == 200
        assert resp.json().get("group_short_id") == poll["group_short_id"]

    def test_resolves_by_group_short_id(
        self, client, creator_secret, browser_id,
    ):
        """Phase B.4: /g/<routeId> with the new `~`-prefixed group short_id
        resolves the same way as the legacy root-poll-short-id form."""
        root = create_poll(client, creator_secret, browser_id=browser_id)
        child = create_followup(
            client, creator_secret, root["questions"][0]["id"],
            browser_id=browser_id,
        )
        group_short_id = root["group_short_id"]
        resp = client.get(
            f"/api/groups/by-route-id/{group_short_id}",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {root["id"], child["id"]}

    def test_resolves_by_group_id_uuid(
        self, client, creator_secret, browser_id,
    ):
        root = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.get(
            f"/api/groups/by-route-id/{root['group_id']}",
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert root["id"] in ids

    def test_my_groups_carries_group_short_id(
        self, client, creator_secret, browser_id,
    ):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=bid_headers(browser_id),
        )
        assert resp.status_code == 200
        polls = resp.json()
        assert polls[0]["group_short_id"] == poll["group_short_id"]
        assert polls[0]["group_id"] == poll["group_id"]
