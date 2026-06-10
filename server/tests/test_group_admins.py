"""Group admin system (migration 142) end-to-end coverage.

Covers:
  * Group create seeds the creator as admin #1 (signed-in AND the anonymous
    auto-account path).
  * GET /members surfaces `viewer_is_admin` + per-member `is_admin`.
  * POST /{route}/admins promotes a member; admin-only; target must be a member.
  * POST /{route}/members/{user_id}/boot removes a non-admin and revokes the
    invite they joined through (works on public groups too now); rejects
    admins and self. POST /{route}/members/by-handle/{handle}/boot removes an
    anonymous member by their opaque roster handle (admin-only).
  * Auto-promotion: when the last admin leaves, the oldest remaining
    account-member is promoted so the group always has an admin.
  * Title/image edits are admin-gated (Q6).
"""

import uuid

import psycopg
import pytest

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import PNG_B64, TEST_DB_URL


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def member_browser():
    return str(uuid.uuid4())


def _bid(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _auth(bid, token):
    h = _bid(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _sign_in(client, browser_id, email=None, name=None):
    """Sign in via magic link AND set a display name, so the account appears in
    the named roster (where per-member is_admin is observable). FE-created
    accounts always have a name; magic-link verify alone leaves it NULL."""
    email = email or f"admin-{uuid.uuid4().hex[:8]}@example.com"
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at) "
            "VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')",
            (hash_token(token), normalize_email(email), browser_id),
        )
        conn.commit()
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    session_token = body["session_token"]
    user_id = body["user"]["user_id"]
    name = name or f"User-{uuid.uuid4().hex[:6]}"
    named = client.post(
        "/api/auth/me/name",
        json={"name": name},
        headers=_auth(browser_id, session_token),
    )
    assert named.status_code == 200, named.text
    return session_token, user_id


def _create_private_group(client, bid, token):
    resp = client.post("/api/groups", headers=_auth(bid, token))
    assert resp.status_code == 201, resp.text
    g = resp.json()
    assert g["privacy"] == "private"
    return g


def _members(client, route_id, bid, token=None):
    resp = client.get(
        f"/api/groups/{route_id}/members", headers=_auth(bid, token)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _mint_invite(client, route_id, bid, token):
    resp = client.post(
        f"/api/groups/{route_id}/invites",
        json={"mode": "single"},
        headers=_auth(bid, token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()  # carries id + token


def _redeem(client, raw_token, bid, token):
    resp = client.post(
        f"/api/auth/invites/{raw_token}/redeem", headers=_auth(bid, token)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _add_member_via_invite(client, group, admin_bid, admin_token, member_bid):
    """Sign a fresh account in on member_bid and join `group` via an invite.
    Returns (member_token, member_user_id, invite_id)."""
    invite = _mint_invite(client, group["id"], admin_bid, admin_token)
    member_token, member_uid = _sign_in(client, member_bid)
    _redeem(client, invite["token"], member_bid, member_token)
    return member_token, member_uid, invite["id"]


# --------------------------------------------------------------------- create


def test_signed_in_creator_is_admin(client, creator_browser):
    token, user_id = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    roster = _members(client, g["short_id"], creator_browser, token)
    assert roster["viewer_is_admin"] is True
    me = [m for m in roster["members"] if m["user_id"] == user_id]
    assert me and me[0]["is_admin"] is True


def test_anonymous_creator_auto_account_is_admin(client, creator_browser):
    # No bearer → public group with an auto-account creator who is admin #1.
    resp = client.post("/api/groups", headers=_bid(creator_browser))
    assert resp.status_code == 201, resp.text
    g = resp.json()
    roster = _members(client, g["short_id"], creator_browser)
    assert roster["viewer_is_admin"] is True


# -------------------------------------------------------------------- promote


def test_promote_member_to_admin(client, creator_browser, member_browser):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    member_token, member_uid, _ = _add_member_via_invite(
        client, g, creator_browser, token, member_browser
    )
    # Before: member is not an admin.
    roster = _members(client, g["short_id"], creator_browser, token)
    member_row = [m for m in roster["members"] if m["user_id"] == member_uid]
    assert member_row and member_row[0]["is_admin"] is False

    resp = client.post(
        f"/api/groups/{g['short_id']}/admins",
        json={"user_id": member_uid},
        headers=_auth(creator_browser, token),
    )
    assert resp.status_code == 200, resp.text

    # After: member is an admin and can do an admin action (mint an invite).
    roster2 = _members(client, g["short_id"], member_browser, member_token)
    assert roster2["viewer_is_admin"] is True
    minted = client.post(
        f"/api/groups/{g['short_id']}/invites",
        json={"mode": "multi"},
        headers=_auth(member_browser, member_token),
    )
    assert minted.status_code == 201, minted.text


def test_promote_requires_admin(client, creator_browser, member_browser):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    member_token, member_uid, _ = _add_member_via_invite(
        client, g, creator_browser, token, member_browser
    )
    # The (non-admin) member tries to promote themselves → 403.
    resp = client.post(
        f"/api/groups/{g['short_id']}/admins",
        json={"user_id": member_uid},
        headers=_auth(member_browser, member_token),
    )
    assert resp.status_code == 403


def test_promote_non_member_400(client, creator_browser):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    # A signed-in account that never joined this group.
    _, outsider_uid = _sign_in(client, str(uuid.uuid4()))
    resp = client.post(
        f"/api/groups/{g['short_id']}/admins",
        json={"user_id": outsider_uid},
        headers=_auth(creator_browser, token),
    )
    assert resp.status_code == 400


# ----------------------------------------------------------------------- boot


def test_boot_member_revokes_their_invite(
    client, creator_browser, member_browser
):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    member_token, member_uid, invite_id = _add_member_via_invite(
        client, g, creator_browser, token, member_browser
    )

    resp = client.post(
        f"/api/groups/{g['short_id']}/members/{member_uid}/boot",
        headers=_auth(creator_browser, token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["booted"] is True

    # Membership gone: the booted member now 404s on the private group read.
    read = client.get(
        f"/api/groups/by-route-id/{g['short_id']}",
        headers=_auth(member_browser, member_token),
    )
    assert read.status_code == 404

    # The invite they joined through is revoked.
    with psycopg.connect(TEST_DB_URL) as conn:
        row = conn.execute(
            "SELECT revoked_at FROM group_invites WHERE id = %s", (invite_id,)
        ).fetchone()
    assert row is not None and row[0] is not None


def test_boot_allowed_on_public_group(client, creator_browser, member_browser):
    # Public group (anonymous create). Booting a named member now works on
    # public groups too (owner revised the original private-only Q3 rule).
    resp = client.post("/api/groups", headers=_bid(creator_browser))
    g = resp.json()
    assert g["privacy"] == "public"
    # A second browser visits → auto-joins, then signs in (named member).
    member_token, member_uid = _sign_in(client, member_browser)
    client.get(
        f"/api/groups/by-route-id/{g['short_id']}",
        headers=_auth(member_browser, member_token),
    )
    boot = client.post(
        f"/api/groups/{g['short_id']}/members/{member_uid}/boot",
        headers=_bid(creator_browser),
    )
    assert boot.status_code == 200, boot.text
    assert boot.json()["booted"] is True
    # Membership row gone.
    members = _members(client, g["short_id"], creator_browser)
    assert all(m["user_id"] != member_uid for m in members["members"])


def test_boot_anonymous_member_by_handle(
    client, creator_browser, member_browser
):
    # Public group; an anonymous (no-name) browser drive-by joins, then the
    # admin boots them via the opaque handle from /members.
    resp = client.post("/api/groups", headers=_bid(creator_browser))
    g = resp.json()
    # Anonymous visitor (no account, no name) auto-joins.
    client.get(
        f"/api/groups/by-route-id/{g['short_id']}", headers=_bid(member_browser)
    )
    roster = _members(client, g["short_id"], creator_browser)
    assert roster["anonymous_count"] >= 1
    assert len(roster["anonymous_members"]) == roster["anonymous_count"]
    handle = roster["anonymous_members"][0]["handle"]
    # The raw browser_id must never appear in the response.
    import json as _json

    assert member_browser not in _json.dumps(roster)

    boot = client.post(
        f"/api/groups/{g['short_id']}/members/by-handle/{handle}/boot",
        headers=_bid(creator_browser),
    )
    assert boot.status_code == 200, boot.text
    after = _members(client, g["short_id"], creator_browser)
    assert after["anonymous_count"] == roster["anonymous_count"] - 1

    # A non-admin can't boot anonymous members.
    other = str(uuid.uuid4())
    client.get(
        f"/api/groups/by-route-id/{g['short_id']}", headers=_bid(other)
    )
    roster2 = _members(client, g["short_id"], creator_browser)
    if roster2["anonymous_members"]:
        denied = client.post(
            f"/api/groups/{g['short_id']}/members/by-handle/"
            f"{roster2['anonymous_members'][0]['handle']}/boot",
            headers=_bid(other),
        )
        assert denied.status_code in (401, 403)


def test_boot_admin_rejected(client, creator_browser, member_browser):
    token, creator_uid = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    member_token, member_uid, _ = _add_member_via_invite(
        client, g, creator_browser, token, member_browser
    )
    # Promote member, then a co-admin can't boot another admin.
    client.post(
        f"/api/groups/{g['short_id']}/admins",
        json={"user_id": member_uid},
        headers=_auth(creator_browser, token),
    )
    resp = client.post(
        f"/api/groups/{g['short_id']}/members/{creator_uid}/boot",
        headers=_auth(member_browser, member_token),
    )
    assert resp.status_code == 403


def test_boot_self_rejected(client, creator_browser):
    token, creator_uid = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    resp = client.post(
        f"/api/groups/{g['short_id']}/members/{creator_uid}/boot",
        headers=_auth(creator_browser, token),
    )
    assert resp.status_code == 400


def test_boot_requires_admin(client, creator_browser, member_browser):
    token, creator_uid = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    member_token, member_uid, _ = _add_member_via_invite(
        client, g, creator_browser, token, member_browser
    )
    # Non-admin member tries to boot the creator → 403.
    resp = client.post(
        f"/api/groups/{g['short_id']}/members/{creator_uid}/boot",
        headers=_auth(member_browser, member_token),
    )
    assert resp.status_code == 403


# ------------------------------------------------------------- auto-promotion


def test_last_admin_leave_promotes_oldest_member(
    client, creator_browser, member_browser
):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    member_token, member_uid, _ = _add_member_via_invite(
        client, g, creator_browser, token, member_browser
    )
    # Creator (the only admin) leaves the group.
    leave = client.delete(
        f"/api/groups/{g['short_id']}/membership",
        headers=_auth(creator_browser, token),
    )
    assert leave.status_code == 204
    # The remaining member was auto-promoted to admin.
    roster = _members(client, g["short_id"], member_browser, member_token)
    assert roster["viewer_is_admin"] is True
    with psycopg.connect(TEST_DB_URL) as conn:
        row = conn.execute(
            "SELECT 1 FROM group_admins WHERE group_id = %s AND user_id = %s",
            (g["id"], member_uid),
        ).fetchone()
    assert row is not None


# ------------------------------------------------------------- edits admin-gated


def test_title_edit_admin_gated(client, creator_browser):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    # Fresh unlinked browser (no account) → 401.
    anon = client.post(
        f"/api/groups/{g['short_id']}/title",
        json={"group_title": "Hijacked"},
        headers=_bid(str(uuid.uuid4())),
    )
    assert anon.status_code == 401
    # Admin can edit.
    ok = client.post(
        f"/api/groups/{g['short_id']}/title",
        json={"group_title": "Trip Planning"},
        headers=_auth(creator_browser, token),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["title"] == "Trip Planning"


def test_image_edit_admin_gated(client, creator_browser, member_browser):
    token, _ = _sign_in(client, creator_browser)
    g = _create_private_group(client, creator_browser, token)
    # A signed-in non-member can't set the avatar → 403.
    stranger_token, _ = _sign_in(client, member_browser)
    forbidden = client.post(
        f"/api/groups/{g['short_id']}/image",
        json={"image_base64": PNG_B64, "mime_type": "image/png"},
        headers=_auth(member_browser, stranger_token),
    )
    assert forbidden.status_code == 403
    # Admin can.
    ok = client.post(
        f"/api/groups/{g['short_id']}/image",
        json={"image_base64": PNG_B64, "mime_type": "image/png"},
        headers=_auth(creator_browser, token),
    )
    assert ok.status_code == 200, ok.text
