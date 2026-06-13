"""Visibility enforcement on the groups read endpoints.

`group_members` is the SINGLE source of truth for visibility — the
legacy `accessible_question_ids` "forget bridge" has been removed. The
`accessible_question_ids` field is still accepted on the request body
(older client bundles send it) but the server ignores it entirely.

Covers:
  * /api/groups/mine returns only polls in groups the caller (or any
    browser linked to their user_id) is a member of — regardless of any
    accessible_question_ids value
  * /api/groups/by-route-id/{id} auto-joins the visitor (any visit grants
    group membership inline) and returns the visible polls
  * Closed-poll filter: closed-before-joined_at hidden for members
  * 404 only when route resolution fails; an empty visible-polls list
    still returns 200 with [] so the FE can render group chrome

The companion file `test_membership_writes.py` covers the WRITE side
(auto-join from create / vote / visit). This file covers the READ side.

Shared fixtures (`client`, `creator_secret`) and helpers (`create_poll`)
live in `conftest.py`.
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
    """Close as the creator. Migration 123: authorization is identity-based,
    so replay the creating browser_id (recorded by conftest.create_poll)."""
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
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


def _stranger_get_group(client, route_id, browser_id, *, p=None):
    qs = f"?p={p}" if p else ""
    return client.get(
        f"/api/groups/by-route-id/{route_id}{qs}",
        headers={"X-Browser-Id": browser_id},
    )


# ---------------------------------------------------------------------------
# /api/groups/mine
# ---------------------------------------------------------------------------


class TestMyGroupsVisibility:
    def test_member_sees_their_group(self, client, creator_secret, creator_browser):
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        # Note: no accessible_question_ids — pure membership signal.
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {poll["id"]}

    def test_stranger_sees_no_groups(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_non_member_with_accessible_ids_sees_nothing(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Bridge removed: a caller who is NOT a `group_members` row sees
        nothing, even if they pass a valid question_id in the (ignored)
        `accessible_question_ids` list. Membership is the only signal."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        child = create_poll(
            client, creator_secret, browser_id=creator_browser,
            group_id=root["group_id"],
        )
        # Stranger passes a real question id, but has no membership row.
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": [child["questions"][0]["id"]]},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_member_sees_all_groups_regardless_of_accessible_ids(
        self, client, creator_secret, creator_browser,
    ):
        """A member sees ALL their member groups' visible polls regardless
        of the `accessible_question_ids` value. The forget bridge that used
        to narrow the home list to "groups still in the localStorage list"
        is gone — passing a list that omits a member-group's questions no
        longer drops that group. (Forget is now "leave the group".)"""
        a = create_poll(client, creator_secret, browser_id=creator_browser)
        b = create_poll(client, creator_secret, browser_id=creator_browser)

        # Caller passes only `a`'s question id (b omitted). Pre-fix the
        # forget bridge would have dropped `b`; now both show.
        resp = client.post(
            "/api/groups/mine",
            json={
                "accessible_question_ids": [a["questions"][0]["id"]],
            },
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {a["id"], b["id"]}

    def test_empty_accessible_ids_returns_full_member_groups(
        self, client, creator_secret, creator_browser,
    ):
        """Membership-only callers (empty accessible_question_ids list)
        see every group they're a member of — unchanged by the bridge
        removal, but worth pinning."""
        a = create_poll(client, creator_secret, browser_id=creator_browser)
        b = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": creator_browser},
        )
        ids = {p["id"] for p in resp.json()}
        assert ids == {a["id"], b["id"]}

    def test_closed_before_join_hidden_for_member(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Closed-before-joined_at: user should NOT see polls that closed
        before they joined the group. The closed_at proxy is
        polls.updated_at."""
        # Creator opens + closes a poll.
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll, client)
        # Backdate the close so it lives in the distant past.
        _set_poll_updated_at(poll["id"], "2000-01-01T00:00:00Z")

        # A second user joins by creating a follow-up *after* the close.
        # They become a group member with joined_at = NOW(); the closed
        # poll's closed_at (year 2000) is < joined_at, so it's filtered out.
        followup = create_poll(
            client, creator_secret, browser_id=stranger_browser,
            group_id=poll["group_id"],
        )

        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # The new follow-up is open, so the user sees it. The original
        # closed-pre-join poll is hidden.
        assert poll["id"] not in ids
        assert followup["id"] in ids

# ---------------------------------------------------------------------------
# /api/groups/by-route-id/{route_id}
# ---------------------------------------------------------------------------


class TestByRouteIdVisibility:
    def test_member_can_read(self, client, creator_secret, creator_browser):
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.get(
            f"/api/groups/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_stranger_visit_auto_joins_and_sees_group(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """Migration 106: any visit to a group URL writes group_members
        inline. The stranger becomes a group member as part of the
        read."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        child = create_poll(
            client, creator_secret, browser_id=creator_browser,
            group_id=root["group_id"],
        )
        resp = _stranger_get_group(
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
        visit grants whole-group membership regardless of `?p`."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        child = create_poll(
            client, creator_secret, browser_id=creator_browser,
            group_id=root["group_id"],
        )
        resp = _stranger_get_group(
            client, root["short_id"], stranger_browser, p=child["short_id"],
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        # Whole group visible; `?p` does not narrow visibility.
        assert ids == {root["id"], child["id"]}

    def test_stranger_visit_to_group_with_pre_join_closed_poll_omits_it(
        self, client, creator_secret, creator_browser, stranger_browser,
    ):
        """User spec: 'if they received a direct link to a poll closed
        before they joined the group, just show the group and don't try
        to show the old poll.' The group renders, the closed-pre-join
        poll is filtered out."""
        root = create_poll(client, creator_secret, browser_id=creator_browser)
        # Close root in the distant past — before the stranger joins.
        _close_poll(root, client)
        _set_poll_updated_at(root["id"], "2000-01-01T00:00:00Z")
        # Add a still-open follow-up.
        followup = create_poll(
            client, creator_secret, browser_id=creator_browser,
            group_id=root["group_id"],
        )

        resp = _stranger_get_group(
            client, root["short_id"], stranger_browser, p=root["short_id"],
        )
        # Group itself resolves → 200, but the linked closed-pre-join poll
        # is filtered out. The follow-up is still visible.
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert root["id"] not in ids
        assert followup["id"] in ids

    def test_unknown_route_id_404s(self, client, stranger_browser):
        resp = _stranger_get_group(client, "zzznotreal", stranger_browser)
        assert resp.status_code == 404

    def test_member_sees_closed_polls_within_membership_window(
        self, client, creator_secret, creator_browser,
    ):
        """A member who closed their own poll still sees it — joined_at <=
        closed_at since membership predates the close."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        _close_poll(poll, client)
        resp = client.get(
            f"/api/groups/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids


# ---------------------------------------------------------------------------
# Phase D — visibility spans all browsers linked to one user_id
# ---------------------------------------------------------------------------


def _link_browser_to_user(browser_id: str, user_id: str) -> None:
    """Insert a user_browsers row to simulate signing the user in on
    this browser. Bypasses the auth flow so tests don't need to drive a
    full magic-link round-trip per fixture."""
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_browsers (browser_id, user_id, linked_at)
                VALUES (%s::uuid, %s::uuid, NOW())
                ON CONFLICT (browser_id) DO UPDATE SET user_id = EXCLUDED.user_id
                """,
                (browser_id, user_id),
            )
        conn.commit()


def _new_user_id() -> str:
    """Mint a fresh users row and return its uuid. Tests use this when
    they need a user_id that's referentially valid for user_browsers
    FK constraints."""
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO users DEFAULT VALUES RETURNING id")
            user_id = str(cur.fetchone()[0])
        conn.commit()
    return user_id


def _issue_session_for(user_id: str, browser_id: str) -> str:
    """Mint a session row directly so tests can drive auth-gated
    endpoints. Mirrors test_passkeys.py's same helper."""
    import hashlib
    import secrets as _secrets
    token = _secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions
                  (token_hash, user_id, browser_id, expires_at, last_used_at)
                VALUES
                  (%s, %s::uuid, %s::uuid, NOW() + INTERVAL '90 days', NOW())
                """,
                (token_hash, user_id, browser_id),
            )
        conn.commit()
    return token


class TestMultiBrowserUserVisibility:
    """Regression: a user signed in on browser A creates a group; the same
    user signed in on browser B should see that group. Pre-fix the
    visibility filter keyed only on browser_id, so the second browser saw
    nothing — even though the membership row's browser_id was linked to
    the same user_id."""

    def test_mine_returns_membership_across_linked_browsers(
        self, client, creator_secret, creator_browser, stranger_browser
    ):
        user_id = _new_user_id()
        _link_browser_to_user(creator_browser, user_id)
        _link_browser_to_user(stranger_browser, user_id)

        # Browser A creates a poll → group_members row keyed on A.
        poll = create_poll(client, creator_secret, browser_id=creator_browser)

        # Browser B authenticates as the same user. /api/groups/mine
        # should surface the poll even though B has no membership row.
        token = _issue_session_for(user_id, stranger_browser)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={
                "X-Browser-Id": stranger_browser,
                "Authorization": f"Bearer {token}",
            },
        )
        assert resp.status_code == 200, resp.text
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_by_route_id_visible_across_linked_browsers(
        self, client, creator_secret, creator_browser, stranger_browser
    ):
        user_id = _new_user_id()
        _link_browser_to_user(creator_browser, user_id)
        _link_browser_to_user(stranger_browser, user_id)
        poll = create_poll(client, creator_secret, browser_id=creator_browser)

        token = _issue_session_for(user_id, stranger_browser)
        resp = client.get(
            f"/api/groups/by-route-id/{poll['short_id']}",
            headers={
                "X-Browser-Id": stranger_browser,
                "Authorization": f"Bearer {token}",
            },
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_anonymous_other_browser_does_NOT_see_it(
        self, client, creator_secret, creator_browser, stranger_browser
    ):
        """Sanity check: the expansion is gated on user_id. A bare other
        browser (no session) still doesn't see the creator's groups."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] not in ids

    def test_linked_browser_without_bearer_sees_account_groups(
        self, client, creator_secret, creator_browser, stranger_browser
    ):
        """The iMessage extension + Siri carry ONLY X-Browser-Id, never the
        bearer — so /mine must resolve the account from the browser→account
        link, not just the bearer. A browser linked to the account (e.g. a
        fresh browser id after an app reinstall, re-linked on sign-in) must
        see the account's groups even with no Authorization header. Pre-fix,
        load_user_visibility keyed only on the literal browser_id when no
        bearer was present, so this surfaced an empty list (the reported
        'no polls yet' in the Messages drawer)."""
        user_id = _new_user_id()
        _link_browser_to_user(creator_browser, user_id)
        _link_browser_to_user(stranger_browser, user_id)

        # Group created + joined on browser A.
        poll = create_poll(client, creator_secret, browser_id=creator_browser)

        # Browser B is linked to the same account but sends NO bearer — the
        # extension/Siri shape. It has no group_members row of its own.
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": stranger_browser},
        )
        assert resp.status_code == 200, resp.text
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_empty_groups_listed_across_linked_browsers(
        self, client, creator_browser, stranger_browser
    ):
        """POST /api/groups creates an empty group + auto-joins the
        creator. The same user on a different browser should see it
        in /api/groups/empty."""
        user_id = _new_user_id()
        _link_browser_to_user(creator_browser, user_id)
        _link_browser_to_user(stranger_browser, user_id)

        resp = client.post(
            "/api/groups",
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 201
        group_id = resp.json()["id"]

        token = _issue_session_for(user_id, stranger_browser)
        resp = client.post(
            "/api/groups/empty",
            headers={
                "X-Browser-Id": stranger_browser,
                "Authorization": f"Bearer {token}",
            },
        )
        assert resp.status_code == 200
        ids = {g["id"] for g in resp.json()}
        assert group_id in ids

    def test_leave_removes_all_linked_browsers(
        self, client, creator_secret, creator_browser, stranger_browser
    ):
        """Tapping "leave" on one device should remove the user from the
        group across ALL their linked browsers — otherwise the next
        visit on another linked browser would re-surface the group via
        that browser's still-present row."""
        user_id = _new_user_id()
        _link_browser_to_user(creator_browser, user_id)
        _link_browser_to_user(stranger_browser, user_id)
        poll = create_poll(client, creator_secret, browser_id=creator_browser)

        # Sign in as the user on stranger_browser and call DELETE
        # /membership. The current browser has no membership row, but
        # creator_browser does — the expanded delete should remove it.
        token = _issue_session_for(user_id, stranger_browser)
        resp = client.delete(
            f"/api/groups/{poll['short_id']}/membership",
            headers={
                "X-Browser-Id": stranger_browser,
                "Authorization": f"Bearer {token}",
            },
        )
        assert resp.status_code == 204

        # /mine on the original creator browser should NOT see the
        # poll anymore.
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers={"X-Browser-Id": creator_browser},
        )
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] not in ids

    def test_accessible_ids_never_drop_signed_in_user_membership(
        self, client, creator_secret, creator_browser, stranger_browser
    ):
        """Regression (now invariant for all callers): the
        `accessible_question_ids` body field must not affect which
        member-groups surface on /mine. A signed-in user on Browser B
        sees a group created on Browser A even when B sends a bogus
        accessible_question_ids list. The forget bridge that used to
        intersect member groups with the list has been removed
        entirely."""
        user_id = _new_user_id()
        _link_browser_to_user(creator_browser, user_id)
        _link_browser_to_user(stranger_browser, user_id)
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        token = _issue_session_for(user_id, stranger_browser)

        # Browser B sends an accessible_question_ids that doesn't
        # include the new poll's question (typical state: legacy
        # localStorage from prior anonymous activity).
        bogus_qid = str(uuid.uuid4())
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": [bogus_qid]},
            headers={
                "X-Browser-Id": stranger_browser,
                "Authorization": f"Bearer {token}",
            },
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids, (
            "Signed-in user lost their membership signal to a stale "
            "accessible_question_ids list"
        )

    def test_accessible_ids_ignored_for_anonymous_too(
        self, client, creator_secret, creator_browser
    ):
        """The bridge removal applies to anonymous callers as well: an
        anonymous member sees their group regardless of the
        `accessible_question_ids` value. "Forget" is now "leave the
        group" (DELETE /membership), NOT "drop the question from the
        localStorage list"."""
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
        # Same browser (a member), no auth, sending a bogus
        # accessible_question_ids that doesn't include the poll's question.
        bogus_qid = str(uuid.uuid4())
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": [bogus_qid]},
            headers={"X-Browser-Id": creator_browser},
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids, (
            "Member should still see their group — the accessible_question_ids "
            "forget bridge has been removed"
        )
