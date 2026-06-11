"""Phase G (group invite links) end-to-end coverage.

Exercises every documented behavior in `services/invites.py` +
`routers/groups.py: create/list/revoke` + `routers/auth.py: redeem`:

  * POST /api/groups/{id}/invites
    - anonymous → 401
    - non-creator → 403
    - groups with no recorded creator → 403
    - mode='single' enforces max_uses=1 regardless of body
    - mode='multi' accepts max_uses or NULL
    - cross-group target_poll_id silently downgraded to NULL
    - response surfaces the raw token + URL exactly once
  * GET /api/groups/{id}/invites
    - creator sees active invites; revoked/expired filtered out
    - non-creator → 403
  * DELETE /api/groups/{id}/invites/{invite_id}
    - creator revokes → 204
    - non-owner → 404 (no info leak)
    - already-revoked → 404
  * POST /api/auth/invites/{token}/redeem
    - anonymous → 401
    - invalid token → 404
    - revoked → 404
    - fully-used (single) → 404
    - expired → 404
    - fresh redeem → 200, writes membership, increments use_count
    - already-member → 200, already_member=true, use_count NOT bumped
    - target_poll_id surfaces target_poll_short_id

Tests follow the same magic-link sign-in pattern as
`test_group_privacy.py` + `test_join_requests.py`.
"""

import time
import uuid

import psycopg
import pytest

from services.auth import (
    generate_token,
    hash_token,
    normalize_email,
)
from tests.conftest import TEST_DB_URL


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def joiner_browser():
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
    raw_email = email or f"phaseg-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_known_magic_link(raw_email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def _create_private_group(client, browser_id, token):
    resp = client.post(
        "/api/groups",
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 201, resp.text
    group = resp.json()
    assert group["privacy"] == "private"
    return group


# ----------------------------------------------------------------- create


def test_create_invite_no_account_returns_401(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    # Migration 142: admin-gated. A fresh browser resolving to no account → 401
    # (the creator's own browser would still resolve via its account link even
    # without a bearer, so use an unlinked one).
    resp = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers={"X-Browser-Id": str(uuid.uuid4())},
    )
    assert resp.status_code == 401


def test_create_invite_non_creator_returns_403(
    client, creator_browser, joiner_browser
):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    jtoken, _ = _sign_in(client, joiner_browser)

    resp = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert resp.status_code == 403


def test_create_invite_creator_returns_token_and_url(
    client, creator_browser
):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["mode"] == "multi"
    assert body["use_count"] == 0
    assert body["token"], "raw token must be returned on create"
    assert body["url"].endswith(f"/invite/{body['token']}")


def test_create_invite_single_forces_max_uses_1(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    # Even if the caller passes max_uses=99, single mode normalizes to 1.
    resp = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "single", "max_uses": 99},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["mode"] == "single"
    assert body["max_uses"] == 1


def test_create_invite_invalid_mode_returns_400(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "weird"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 400


def test_create_invite_cross_group_target_poll_silently_dropped(
    client, creator_browser
):
    ctoken, cuser = _sign_in(client, creator_browser)
    group_a = _create_private_group(client, creator_browser, ctoken)

    # Create a poll in a DIFFERENT group (group B).
    second_browser = str(uuid.uuid4())
    btoken, _ = _sign_in(client, second_browser)
    group_b = _create_private_group(client, second_browser, btoken)
    poll_resp = client.post(
        "/api/polls",
        json={
            "creator_secret": f"x-{uuid.uuid4().hex[:6]}",
            "creator_name": "Other",
            "group_id": group_b["id"],
            "questions": [{"question_type": "yes_no", "category": "yes_no"}],
        },
        headers=_bearer_headers(second_browser, btoken),
    )
    assert poll_resp.status_code == 201, poll_resp.text
    other_poll_id = poll_resp.json()["id"]

    # Creator of group A tries to set group B's poll as target.
    resp = client.post(
        f"/api/groups/{group_a['id']}/invites",
        json={"mode": "multi", "target_poll_id": other_poll_id},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 201, resp.text
    # Silently dropped — target_poll_id is NULL in the response.
    assert resp.json()["target_poll_id"] is None


# ----------------------------------------------------------------- list


def test_list_invites_non_creator_returns_403(
    client, creator_browser, joiner_browser
):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    jtoken, _ = _sign_in(client, joiner_browser)

    resp = client.get(
        f"/api/groups/{group['id']}/invites",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert resp.status_code == 403


def test_list_invites_creator_sees_active(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "single"},
        headers=_bearer_headers(creator_browser, ctoken),
    )

    resp = client.get(
        f"/api/groups/{group['id']}/invites",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 2
    # List omits token + url (one-shot at create).
    for item in items:
        assert item.get("token") is None
        assert item.get("url") is None


def test_list_invites_excludes_revoked(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    invite_id = create.json()["id"]

    revoke = client.delete(
        f"/api/groups/{group['id']}/invites/{invite_id}",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert revoke.status_code == 204

    listed = client.get(
        f"/api/groups/{group['id']}/invites",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert listed.json() == []


# --------------------------------------------------------------- revoke


def test_revoke_non_creator_returns_403_at_group_level(
    client, creator_browser, joiner_browser
):
    """Trying to revoke a creator-owned invite from a different user
    fails the group-level creator gate (_require_creator) → 403,
    before the per-invite ownership check fires."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    invite_id = create.json()["id"]

    jtoken, _ = _sign_in(client, joiner_browser)
    resp = client.delete(
        f"/api/groups/{group['id']}/invites/{invite_id}",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert resp.status_code == 403


def test_revoke_unknown_invite_returns_404(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.delete(
        f"/api/groups/{group['id']}/invites/{uuid.uuid4()}",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 404


def test_revoke_malformed_invite_id_returns_404_not_500(
    client, creator_browser
):
    # The anonymous-path uuid tests in test_uuid_validation.py never reach
    # the ::uuid cast (401 at _require_admin first) — only an authenticated
    # admin exercises it. Before the require_uuid gate this raised
    # psycopg.errors.InvalidTextRepresentation → unhandled 500, which the
    # prod browser sees as a CORS-blocked opaque network error.
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    resp = client.delete(
        f"/api/groups/{group['id']}/invites/not-a-uuid",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert resp.status_code == 404, resp.text


def test_revoke_already_revoked_returns_404(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    invite_id = create.json()["id"]

    first = client.delete(
        f"/api/groups/{group['id']}/invites/{invite_id}",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert first.status_code == 204
    second = client.delete(
        f"/api/groups/{group['id']}/invites/{invite_id}",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert second.status_code == 404


# --------------------------------------------------------------- redeem


def test_redeem_anonymous_returns_401(client, creator_browser):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    raw_token = create.json()["token"]

    resp = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bid_headers(str(uuid.uuid4())),  # no bearer
    )
    assert resp.status_code == 401


def test_redeem_invalid_token_returns_404(client, joiner_browser):
    jtoken, _ = _sign_in(client, joiner_browser)
    resp = client.post(
        f"/api/auth/invites/{generate_token()}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert resp.status_code == 404


def test_redeem_revoked_returns_404(
    client, creator_browser, joiner_browser
):
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    invite_id = create.json()["id"]
    raw_token = create.json()["token"]

    client.delete(
        f"/api/groups/{group['id']}/invites/{invite_id}",
        headers=_bearer_headers(creator_browser, ctoken),
    )

    jtoken, _ = _sign_in(client, joiner_browser)
    resp = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert resp.status_code == 404


def test_redeem_grants_membership_and_visibility(
    client, creator_browser, joiner_browser
):
    """Happy path: joiner can't see the private group; redeem; can see
    it. Same shape as the Phase F approve happy-path test."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    raw_token = create.json()["token"]

    jtoken, _ = _sign_in(client, joiner_browser)
    pre = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert pre.status_code == 404

    redeem = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert redeem.status_code == 200, redeem.text
    body = redeem.json()
    assert body["group_id"] == group["id"]
    assert body["already_member"] is False

    post = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert post.status_code == 200


def test_redeem_single_use_consumed_after_first(
    client, creator_browser, joiner_browser
):
    """single-mode invite is fully-used after one redeem; a second
    joiner gets 404."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "single"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    raw_token = create.json()["token"]

    # First joiner consumes it.
    jtoken1, _ = _sign_in(client, joiner_browser)
    first = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken1),
    )
    assert first.status_code == 200

    # Second joiner hits 404.
    second_browser = str(uuid.uuid4())
    jtoken2, _ = _sign_in(client, second_browser)
    second = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(second_browser, jtoken2),
    )
    assert second.status_code == 404


def test_redeem_already_member_is_noop_no_use_count_bump(
    client, creator_browser, joiner_browser
):
    """A member re-clicking the URL shouldn't consume an invite use."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi", "max_uses": 5},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    raw_token = create.json()["token"]

    jtoken, _ = _sign_in(client, joiner_browser)
    first = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert first.status_code == 200
    assert first.json()["already_member"] is False

    # Same user re-clicks.
    second = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert second.status_code == 200
    assert second.json()["already_member"] is True

    # use_count should still be 1 (not 2).
    listed = client.get(
        f"/api/groups/{group['id']}/invites",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    items = listed.json()
    assert len(items) == 1
    assert items[0]["use_count"] == 1


def test_redeem_backdates_joined_at_to_invite_creation(
    client, creator_browser, joiner_browser
):
    """A poll that closed AFTER the invite was minted but BEFORE the
    joiner redeemed must remain visible to the joiner. `joined_at` is
    backdated to the invite's `created_at`, not the redeem time, so the
    closed-before-join filter doesn't hide polls that closed in the gap.
    """
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    invite = create.json()
    raw_token = invite["token"]

    # A poll created in the group, then closed.
    poll_resp = client.post(
        "/api/polls",
        json={
            "creator_name": "Creator",
            "group_id": group["id"],
            "questions": [{"question_type": "yes_no", "category": "yes_no"}],
        },
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert poll_resp.status_code == 201, poll_resp.text
    poll = poll_resp.json()
    close = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert close.status_code == 200, close.text

    # Pin the timeline deterministically: invite minted 2h ago, poll
    # closed 1h ago, redeem "now". Without the backdate joined_at would
    # be "now" and the poll (closed_at = now - 1h) would fall outside the
    # closed-before-join window.
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE group_invites SET created_at = NOW() - INTERVAL "
                "'2 hours' WHERE id = %s",
                (invite["id"],),
            )
            cur.execute(
                "UPDATE polls SET updated_at = NOW() - INTERVAL '1 hour' "
                "WHERE id = %s",
                (poll["id"],),
            )
        conn.commit()

    jtoken, _ = _sign_in(client, joiner_browser)
    redeem = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert redeem.status_code == 200, redeem.text

    listed = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert listed.status_code == 200, listed.text
    ids = [p["id"] for p in listed.json()]
    assert poll["id"] in ids, (
        "poll closed between invite-send and redeem must be visible"
    )


def test_redeem_returns_target_poll_short_id(
    client, creator_browser, joiner_browser
):
    """target_poll_id at invite-create surfaces target_poll_short_id
    in the redeem response so the FE can build the deep-link redirect."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)

    # Create a poll in the group.
    poll_resp = client.post(
        "/api/polls",
        json={
            "creator_secret": f"x-{uuid.uuid4().hex[:6]}",
            "creator_name": "Creator",
            "group_id": group["id"],
            "questions": [{"question_type": "yes_no", "category": "yes_no"}],
        },
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert poll_resp.status_code == 201
    poll = poll_resp.json()

    create = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi", "target_poll_id": poll["id"]},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    raw_token = create.json()["token"]

    jtoken, _ = _sign_in(client, joiner_browser)
    redeem = client.post(
        f"/api/auth/invites/{raw_token}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert redeem.status_code == 200
    body = redeem.json()
    assert body["target_poll_id"] == poll["id"]
    assert body["target_poll_short_id"] == poll["short_id"]


# --------------------------------------------------------------- preview


def _mint_invite(client, group, browser_id, token, **body):
    resp = client.post(
        f"/api/groups/{group['id']}/invites",
        json={"mode": "multi", **body},
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_invite_preview_returns_group_name(client, creator_browser):
    """The identity-free preview endpoint resolves a token to the
    group's display name so the FE shell can render an Open Graph
    title. No headers at all — crawlers carry no identity."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    titled = client.post(
        f"/api/groups/{group['id']}/title",
        json={"group_title": "Trip to Boise"},
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert titled.status_code == 200, titled.text
    invite = _mint_invite(client, group, creator_browser, ctoken)

    resp = client.get(f"/api/auth/invites/{invite['token']}/preview")
    assert resp.status_code == 200, resp.text
    assert resp.json()["group_name"] == "Trip to Boise"


def test_invite_preview_unnamed_group_returns_null(client, creator_browser):
    """A fresh empty group has no title override and no participants —
    group_name is null and the FE falls back to generic copy."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    invite = _mint_invite(client, group, creator_browser, ctoken)

    resp = client.get(f"/api/auth/invites/{invite['token']}/preview")
    assert resp.status_code == 200
    assert resp.json()["group_name"] is None


def test_invite_preview_invalid_token_returns_404(client):
    resp = client.get("/api/auth/invites/not-a-real-token/preview")
    assert resp.status_code == 404


def test_invite_preview_revoked_returns_404(client, creator_browser):
    """A revoked invite stops previewing — the group name shouldn't
    leak past revocation."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    invite = _mint_invite(client, group, creator_browser, ctoken)

    revoke = client.delete(
        f"/api/groups/{group['id']}/invites/{invite['id']}",
        headers=_bearer_headers(creator_browser, ctoken),
    )
    assert revoke.status_code == 204

    resp = client.get(f"/api/auth/invites/{invite['token']}/preview")
    assert resp.status_code == 404


def test_invite_preview_does_not_consume_use(
    client, creator_browser, joiner_browser
):
    """Crawler fetches must never burn an invite use: preview a
    single-use invite twice, then redeem successfully."""
    ctoken, _ = _sign_in(client, creator_browser)
    group = _create_private_group(client, creator_browser, ctoken)
    invite = _mint_invite(client, group, creator_browser, ctoken, mode="single")

    for _ in range(2):
        resp = client.get(f"/api/auth/invites/{invite['token']}/preview")
        assert resp.status_code == 200

    jtoken, _ = _sign_in(client, joiner_browser)
    redeem = client.post(
        f"/api/auth/invites/{invite['token']}/redeem",
        headers=_bearer_headers(joiner_browser, jtoken),
    )
    assert redeem.status_code == 200, redeem.text
