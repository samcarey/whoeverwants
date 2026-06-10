"""Phase E (group privacy) end-to-end coverage.

Exercises the rules documented in `docs/auth-access-model.md`:
  * Anonymous create → public, no creator_user_id.
  * Signed-in create → private, creator_user_id recorded.
  * `/by-route-id/{id}` for a private group: non-member 404, member 200.
  * `/summary` and `/image` mirror that gating.
  * Legacy `accessible_question_ids` bridge does NOT grant access to
    private groups.
  * `POST /api/groups/{id}/privacy`: only the recorded creator (via
    user_id match) can flip; legacy/anonymous-created groups can't be
    flipped; valid flips persist.
  * Privacy state surfaces on `PollResponse` (via group_privacy /
    group_creator_user_id) and `GroupSummary`.

Tests use the shared `client` fixture from `conftest.py`. A signed-in
caller is constructed via the magic-link verify endpoint — same path
the production FE uses — so the session token is real.
"""

import os
import uuid

import psycopg
import pytest

from services.auth import (
    generate_token,
    hash_token,
    normalize_email,
)
from tests.conftest import PNG_B64, TEST_DB_URL


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def stranger_browser():
    return str(uuid.uuid4())


def _bid_headers(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer_headers(bid, token):
    h = _bid_headers(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _issue_known_magic_link(email, browser_id):
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO magic_link_tokens
                  (token_hash, email, browser_id, expires_at)
                VALUES
                  (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id),
            )
        conn.commit()
    return token


def _sign_in(client, browser_id, email=None):
    """Run a full magic-link verify and return (session_token, user_id)."""
    email = email or f"phaseE-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_known_magic_link(email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def _create_empty_group(client, browser_id, token=None):
    resp = client.post(
        "/api/groups",
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_poll(client, browser_id, token=None, **kwargs):
    payload = {
        "creator_secret": f"secret-{uuid.uuid4().hex[:8]}",
        "creator_name": "Phase E Tester",
        "questions": [{"question_type": "yes_no", "category": "yes_no"}],
    }
    payload.update(kwargs)
    resp = client.post(
        "/api/polls",
        json=payload,
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _set_group_privacy_direct(group_id, privacy):
    """Bypass the API to flip privacy when tests need to simulate a
    scenario the API doesn't expose (e.g. legacy group already private)."""
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "UPDATE groups SET privacy = %s WHERE id = %s",
            (privacy, group_id),
        )


# ---------------------------------------------------------------------------
# Group create — privacy assigned at create time
# ---------------------------------------------------------------------------


class TestCreateGroupPrivacy:
    def test_anonymous_creates_public_group_with_auto_creator(
        self, client, creator_browser
    ):
        # Migration 142: anonymous create still yields a PUBLIC group, but a
        # lightweight auto-account is minted and recorded as creator (= admin
        # #1) so no group is ever admin-less.
        g = _create_empty_group(client, creator_browser)
        assert g["privacy"] == "public"
        assert g["creator_user_id"] is not None

    def test_signed_in_creates_private_group_with_creator(
        self, client, creator_browser
    ):
        token, user_id = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        assert g["privacy"] == "private"
        assert g["creator_user_id"] == user_id

    def test_anonymous_poll_creates_public_group(
        self, client, creator_browser
    ):
        poll = _create_poll(client, creator_browser)
        assert poll["group_privacy"] == "public"
        # Migration 142: the group records the poll's auto-account creator even
        # for anonymous creates (privacy stays public, decoupled from creator).
        assert poll["group_creator_user_id"] is not None

    def test_signed_in_poll_creates_private_group(
        self, client, creator_browser
    ):
        token, user_id = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        assert poll["group_privacy"] == "private"
        assert poll["group_creator_user_id"] == user_id

    def test_existing_group_id_does_not_change_privacy(
        self, client, creator_browser
    ):
        """Adding a follow-up poll to an existing group doesn't flip
        privacy — privacy is set-at-create-time."""
        # Anonymous user mints a public group.
        first = _create_poll(client, creator_browser)
        group_id = first["group_id"]
        assert first["group_privacy"] == "public"

        # Sign in later, add a poll to the same group. The group stays
        # public — privacy never gets retroactively flipped here.
        token, _user_id = _sign_in(client, creator_browser)
        followup = _create_poll(
            client, creator_browser, token, group_id=group_id
        )
        assert followup["group_id"] == group_id
        assert followup["group_privacy"] == "public"
        # Migration 142: the original anonymous create recorded an auto-account
        # creator; adding follow-ups doesn't touch it (or the privacy).
        assert (
            followup["group_creator_user_id"]
            == first["group_creator_user_id"]
            is not None
        )


# ---------------------------------------------------------------------------
# /by-route-id/{id} — private gating
# ---------------------------------------------------------------------------


class TestByRouteIdPrivacy:
    def test_private_group_404s_strangers(
        self, client, creator_browser, stranger_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        # Stranger has no membership row.
        resp = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 404

    def test_private_group_visible_to_member(
        self, client, creator_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        # Creator auto-joined on create; the read works.
        resp = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert ids == {poll["id"]}

    def test_public_group_auto_joins_stranger(
        self, client, creator_browser, stranger_browser
    ):
        poll = _create_poll(client, creator_browser)
        # Pre-Phase-E behavior: stranger visits, gets the polls.
        resp = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200
        # Stranger is now a member (inline auto-join).
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT 1 FROM group_members "
                "WHERE group_id = %s AND browser_id = %s",
                (poll["group_id"], stranger_browser),
            ).fetchone()
        assert row is not None

    def test_private_group_does_not_auto_join_stranger(
        self, client, creator_browser, stranger_browser
    ):
        """The 404 path must NOT have written a membership row, or a
        stranger's 'try-to-peek' would leak group membership."""
        token, _ = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_browser),
        )
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT 1 FROM group_members "
                "WHERE group_id = %s AND browser_id = %s",
                (poll["group_id"], stranger_browser),
            ).fetchone()
        assert row is None


# ---------------------------------------------------------------------------
# /summary + /image gating mirrors /by-route-id
# ---------------------------------------------------------------------------


class TestSummaryAndImagePrivacy:
    def test_summary_private_404s_strangers(
        self, client, creator_browser, stranger_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        resp = client.get(
            f"/api/groups/by-route-id/{g['short_id']}/summary",
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 404

    def test_summary_private_visible_to_member(
        self, client, creator_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        resp = client.get(
            f"/api/groups/by-route-id/{g['short_id']}/summary",
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["privacy"] == "private"

    def test_summary_public_no_gate(
        self, client, creator_browser, stranger_browser
    ):
        g = _create_empty_group(client, creator_browser)
        resp = client.get(
            f"/api/groups/by-route-id/{g['short_id']}/summary",
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200
        assert resp.json()["privacy"] == "public"

    def test_image_get_is_public_even_for_private_groups(
        self, client, creator_browser, stranger_browser
    ):
        """The avatar `/image` GET is intentionally PUBLIC (no membership
        gate) even for private groups. It's rendered with a plain
        `<img src>`, which can't carry the X-Browser-Id / bearer headers
        the membership check reads, so gating it 404'd the avatar for
        every member (the "set a group image → question mark" bug). The
        unguessable short_id is the capability token. A stranger with the
        URL can fetch the bytes — consistent with the already-public
        `POST /image`, `POST /title`, and `/preview` endpoints."""
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)

        # No image set yet → 404 "Image not set" (NOT a privacy 404).
        not_set = client.get(
            f"/api/groups/by-route-id/{g['short_id']}/image",
            headers=_bid_headers(stranger_browser),
        )
        assert not_set.status_code == 404

        # Creator uploads an avatar.
        up = client.post(
            f"/api/groups/{g['short_id']}/image",
            headers=_bearer_headers(creator_browser, token),
            json={"image_base64": PNG_B64, "mime_type": "image/png"},
        )
        assert up.status_code == 200, up.text

        # A stranger (no membership, fresh browser, no bearer) — mirroring
        # a header-less `<img>` request — can now fetch the bytes.
        resp = client.get(
            f"/api/groups/by-route-id/{g['short_id']}/image",
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "image/png"
        assert len(resp.content) > 0

        # A truly header-less request (the real `<img>` case) also works.
        bare = client.get(f"/api/groups/by-route-id/{g['short_id']}/image")
        assert bare.status_code == 200


# ---------------------------------------------------------------------------
# /api/groups/mine — `accessible_question_ids` bridge removed entirely
# ---------------------------------------------------------------------------


class TestMineNoBridge:
    """The legacy `accessible_question_ids` "forget bridge" has been
    removed — `group_members` is the single source of truth. A
    non-member who passes a question_id in the (ignored) list sees
    nothing, regardless of the group's privacy."""

    def test_accessible_ids_do_not_grant_private_group_access(
        self, client, creator_browser, stranger_browser
    ):
        """A stranger passing a private group's question_id in the
        ignored `accessible_question_ids` list still sees nothing —
        they're not a `group_members` row."""
        token, _ = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        question_id = poll["questions"][0]["id"]
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": [question_id]},
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_accessible_ids_do_not_grant_public_group_access(
        self, client, creator_browser, stranger_browser
    ):
        """Bridge removal applies to public groups too: a non-member
        passing a public group's question_id sees nothing. Pre-removal
        the bridge would have surfaced the whole public group."""
        poll = _create_poll(client, creator_browser)
        question_id = poll["questions"][0]["id"]
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": [question_id]},
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# POST /api/groups/{id}/privacy — toggle endpoint authorization
# ---------------------------------------------------------------------------


class TestUpdateGroupPrivacy:
    def test_creator_can_flip_private_to_public(
        self, client, creator_browser, stranger_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        assert g["privacy"] == "private"
        # Flip to public.
        resp = client.post(
            f"/api/groups/{g['short_id']}/privacy",
            json={"privacy": "public"},
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["privacy"] == "public"
        # Stranger can now see the group.
        resp2 = client.get(
            f"/api/groups/by-route-id/{g['short_id']}",
            headers=_bid_headers(stranger_browser),
        )
        assert resp2.status_code == 200

    def test_creator_can_flip_back_to_private(
        self, client, creator_browser, stranger_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        # Flip to public, then back to private.
        client.post(
            f"/api/groups/{g['short_id']}/privacy",
            json={"privacy": "public"},
            headers=_bearer_headers(creator_browser, token),
        )
        resp = client.post(
            f"/api/groups/{g['short_id']}/privacy",
            json={"privacy": "private"},
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200
        assert resp.json()["privacy"] == "private"

    def test_no_account_caller_401(
        self, client, creator_browser, stranger_browser
    ):
        # Migration 142: admin-gated. A caller whose browser resolves to NO
        # account (fresh browser, no bearer) gets 401. NOTE the creator's own
        # browser would still resolve to its account via the user_browsers
        # link even without the bearer, so we use a fresh unlinked browser.
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        resp = client.post(
            f"/api/groups/{g['short_id']}/privacy",
            json={"privacy": "public"},
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 401

    def test_non_creator_signed_in_403(
        self, client, creator_browser, stranger_browser
    ):
        creator_token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, creator_token)
        # A different signed-in user tries to flip.
        stranger_token, _ = _sign_in(client, stranger_browser)
        resp = client.post(
            f"/api/groups/{g['short_id']}/privacy",
            json={"privacy": "public"},
            headers=_bearer_headers(stranger_browser, stranger_token),
        )
        assert resp.status_code == 403

    def test_legacy_group_without_creator_403(
        self, client, creator_browser, stranger_browser
    ):
        """Anonymous-created groups have creator_user_id NULL. Phase E
        keeps these immutable — no one can flip them via the toggle.
        Phase I will add an 'anonymous → claim → private' migration."""
        poll = _create_poll(client, creator_browser)  # anonymous create
        # Sign in *after* creating; this user wasn't the creator.
        token, _ = _sign_in(client, stranger_browser)
        resp = client.post(
            f"/api/groups/{poll['group_short_id']}/privacy",
            json={"privacy": "private"},
            headers=_bearer_headers(stranger_browser, token),
        )
        assert resp.status_code == 403

    def test_invalid_privacy_value_400(self, client, creator_browser):
        token, _ = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        resp = client.post(
            f"/api/groups/{g['short_id']}/privacy",
            json={"privacy": "semi-public"},
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 400

    def test_unknown_group_404(self, client, creator_browser):
        token, _ = _sign_in(client, creator_browser)
        resp = client.post(
            "/api/groups/does-not-exist/privacy",
            json={"privacy": "public"},
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Privacy state survives writes — surfaced on PollResponse + GroupSummary
# ---------------------------------------------------------------------------


class TestPrivacyFieldSurfacing:
    def test_poll_response_carries_privacy(
        self, client, creator_browser
    ):
        token, user_id = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        # Read back via /api/polls/by-id; the JOIN should surface the
        # joined groups columns.
        resp = client.get(
            f"/api/polls/by-id/{poll['id']}",
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["group_privacy"] == "private"
        assert body["group_creator_user_id"] == user_id

    def test_empty_groups_carry_privacy(self, client, creator_browser):
        token, user_id = _sign_in(client, creator_browser)
        g = _create_empty_group(client, creator_browser, token)
        # /api/groups/empty should surface the privacy + creator fields too.
        resp = client.post(
            "/api/groups/empty",
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200
        match = [x for x in resp.json() if x["id"] == g["id"]]
        assert match, "Expected the freshly-created empty group to appear"
        assert match[0]["privacy"] == "private"
        assert match[0]["creator_user_id"] == user_id


# ---------------------------------------------------------------------------
# Member visibility — already a member of a private group still sees it
# ---------------------------------------------------------------------------


class TestPrivateMemberVisibility:
    def test_mine_lists_private_groups_for_members(
        self, client, creator_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=_bearer_headers(creator_browser, token),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] in ids

    def test_mine_excludes_private_groups_for_non_members(
        self, client, creator_browser, stranger_browser
    ):
        token, _ = _sign_in(client, creator_browser)
        poll = _create_poll(client, creator_browser, token)
        # Stranger has no membership — and no bridge — should see nothing.
        resp = client.post(
            "/api/groups/mine",
            json={"accessible_question_ids": []},
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200
        ids = {p["id"] for p in resp.json()}
        assert poll["id"] not in ids

    def test_post_phase_e_flip_to_private_hides_from_strangers(
        self, client, creator_browser, stranger_browser
    ):
        """Public group → stranger visits (auto-joins) → creator
        flips to private → stranger still sees it (member). Different
        stranger has no row → 404."""
        token, _ = _sign_in(client, creator_browser)
        # Create as public via the flip path — sign-in mints private, so
        # start with anonymous + claim via signed-in flip.
        # Simpler: create signed-in (private) and flip to public, then
        # have stranger A visit (joins), then flip back to private.
        poll = _create_poll(client, creator_browser, token)
        # Flip to public so stranger A can join.
        client.post(
            f"/api/groups/{poll['group_short_id']}/privacy",
            json={"privacy": "public"},
            headers=_bearer_headers(creator_browser, token),
        )
        # Stranger A visits and auto-joins.
        stranger_a = str(uuid.uuid4())
        resp_a1 = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_a),
        )
        assert resp_a1.status_code == 200
        # Flip back to private.
        client.post(
            f"/api/groups/{poll['group_short_id']}/privacy",
            json={"privacy": "private"},
            headers=_bearer_headers(creator_browser, token),
        )
        # Stranger A is still a member → still 200.
        resp_a2 = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_a),
        )
        assert resp_a2.status_code == 200
        # Stranger B (never joined) gets 404.
        stranger_b = stranger_browser
        resp_b = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_b),
        )
        assert resp_b.status_code == 404


# ---------------------------------------------------------------------------
# Grandfathered groups behavior
# ---------------------------------------------------------------------------


class TestGrandfatheredGroups:
    def test_create_paths_always_record_a_creator(
        self, client, creator_browser
    ):
        """Migration 142: every group-create path records a creator (= admin
        #1) so no NULL-creator group is ever minted, even anonymously. The
        invariant lives in app code + `group_admins`, not a NOT NULL on the
        (still-nullable, vestigial) `creator_user_id` column."""
        # Empty-group create (anonymous → auto-account creator).
        g = _create_empty_group(client, creator_browser)
        assert g["creator_user_id"] is not None
        # Poll create (anonymous → auto-account creator).
        poll = _create_poll(client, creator_browser)
        assert poll["group_creator_user_id"] is not None

    def test_legacy_group_remains_accessible_to_strangers(
        self, client, creator_browser, stranger_browser
    ):
        """A group manually flipped to 'public' should still 200 for
        strangers — covers groups grandfathered by the migration."""
        # Anonymous create → public. Then verify stranger access.
        poll = _create_poll(client, creator_browser)
        resp = client.get(
            f"/api/groups/by-route-id/{poll['group_short_id']}",
            headers=_bid_headers(stranger_browser),
        )
        assert resp.status_code == 200
