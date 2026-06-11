"""Invite-members ("address book") end-to-end coverage.

Exercises `GET /api/groups/{id}/invitable-accounts` +
`POST /api/groups/{id}/members` and the `services/contacts.py` helpers:

  * candidate list = caller's contacts (accounts they currently share a
    group with) MINUS accounts already in the target group, MINUS self.
  * sort: current shared-group count desc, then last_seen_at desc.
  * any member can invite; non-members get 403.
  * only the caller's own contacts can be added (guessed user_ids / accounts
    you've never encountered are silently skipped).
  * adding is idempotent (already-a-member → not re-added, added=0).

Membership is set up by direct DB inserts (group_members keyed on each
signed-in user's browser) rather than driving the full join flow — the
join flow is covered by test_join_requests / test_groups_visibility; here
we only care about the contact + invite behavior on top of it.
"""

import uuid

import psycopg
import pytest

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL


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
                INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at)
                VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id),
            )
        conn.commit()
    return token


def _set_display_name(user_id, name):
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET display_name = %s WHERE id = %s::uuid",
                (name, user_id),
            )
        conn.commit()


def _sign_in(client, browser_id, name=None):
    """Magic-link verify → (token, user_id). Sets a display_name (directly in
    the DB) so the account surfaces with a name in the candidate list."""
    email = f"invite-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_known_magic_link(email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    uid = body["user"]["user_id"]
    if name:
        _set_display_name(uid, name)
    return token, uid


def _create_group(client, browser_id, token):
    resp = client.post("/api/groups", headers=_bearer_headers(browser_id, token))
    assert resp.status_code == 201, resp.text
    return resp.json()  # {id, short_id, ...}


def _add_member_direct(group_id, browser_id):
    """Insert a group_members row directly (bypasses the join flow)."""
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO group_members (group_id, browser_id)
                VALUES (%s::uuid, %s::uuid)
                ON CONFLICT (group_id, browser_id) DO NOTHING
                """,
                (group_id, browser_id),
            )
        conn.commit()


def _members(group_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id::text FROM group_members WHERE group_id = %s::uuid",
            (group_id,),
        ).fetchall()
    return {r[0] for r in rows}


@pytest.fixture
def people():
    return {k: str(uuid.uuid4()) for k in ("a", "b", "c", "d", "e")}


def test_candidates_exclude_members_and_sort_by_shared_count(client, people):
    # A is the inviter; B already in the target group; C shares 2 other
    # groups with A; D shares 1. Expect candidates = [C, D] (count 2, 1),
    # B and A excluded.
    tok_a, _ = _sign_in(client, people["a"], name="Alice")
    tok_b, _ = _sign_in(client, people["b"], name="Bob")
    tok_c, _ = _sign_in(client, people["c"], name="Cara")
    tok_d, _ = _sign_in(client, people["d"], name="Dan")

    target = _create_group(client, people["a"], tok_a)
    _add_member_direct(target["id"], people["b"])

    g1 = _create_group(client, people["a"], tok_a)
    _add_member_direct(g1["id"], people["c"])
    _add_member_direct(g1["id"], people["d"])

    g2 = _create_group(client, people["a"], tok_a)
    _add_member_direct(g2["id"], people["c"])

    resp = client.get(
        f"/api/groups/{target['short_id']}/invitable-accounts",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    names = [r["name"] for r in rows]
    assert "Bob" not in names  # already a member of target
    assert "Alice" not in names  # self
    assert names == ["Cara", "Dan"]  # sorted by shared_group_count desc
    assert rows[0]["shared_group_count"] == 2
    assert rows[1]["shared_group_count"] == 1


def test_add_members_idempotent_and_notifies_new(client, people):
    tok_a, _ = _sign_in(client, people["a"], name="Alice")
    tok_c, uid_c = _sign_in(client, people["c"], name="Cara")

    target = _create_group(client, people["a"], tok_a)
    g1 = _create_group(client, people["a"], tok_a)
    _add_member_direct(g1["id"], people["c"])  # makes C a contact of A

    # Warm A's contact list (reconcile runs inline on the candidates GET).
    client.get(
        f"/api/groups/{target['short_id']}/invitable-accounts",
        headers=_bearer_headers(people["a"], tok_a),
    )

    # Add C to the target group.
    resp = client.post(
        f"/api/groups/{target['short_id']}/members",
        json={"user_ids": [uid_c]},
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["added"] == 1
    assert people["c"] in _members(target["id"])

    # C is now a member → excluded from the candidate list.
    resp2 = client.get(
        f"/api/groups/{target['short_id']}/invitable-accounts",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert "Cara" not in [r["name"] for r in resp2.json()]

    # Re-adding is a no-op.
    resp3 = client.post(
        f"/api/groups/{target['short_id']}/members",
        json={"user_ids": [uid_c]},
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp3.json()["added"] == 0


def test_cannot_add_non_contacts(client, people):
    tok_a, _ = _sign_in(client, people["a"], name="Alice")
    _tok_e, uid_e = _sign_in(client, people["e"], name="Eve")  # shares nothing with A

    target = _create_group(client, people["a"], tok_a)

    # Eve is a real account but not a contact of A; a random uuid isn't an
    # account at all. Both are silently skipped → added=0, no membership.
    resp = client.post(
        f"/api/groups/{target['short_id']}/members",
        json={"user_ids": [uid_e, str(uuid.uuid4()), "not-a-uuid"]},
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["added"] == 0
    assert people["e"] not in _members(target["id"])


def test_non_member_forbidden(client, people):
    tok_a, _ = _sign_in(client, people["a"], name="Alice")
    tok_e, uid_a = _sign_in(client, people["e"], name="Eve")

    g1 = _create_group(client, people["a"], tok_a)  # A's group; E not a member

    resp = client.get(
        f"/api/groups/{g1['short_id']}/invitable-accounts",
        headers=_bearer_headers(people["e"], tok_e),
    )
    assert resp.status_code == 403, resp.text

    resp2 = client.post(
        f"/api/groups/{g1['short_id']}/members",
        json={"user_ids": [str(uuid.uuid4())]},
        headers=_bearer_headers(people["e"], tok_e),
    )
    assert resp2.status_code == 403, resp2.text


def _remove_member_direct(group_id, browser_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM group_members
                 WHERE group_id = %s::uuid AND browser_id = %s::uuid
                """,
                (group_id, browser_id),
            )
        conn.commit()


def test_forget_contact_sticks_only_without_shared_groups(client, people):
    tok_a, _ = _sign_in(client, people["a"], name="Alice")
    _tok_c, uid_c = _sign_in(client, people["c"], name="Cara")

    target = _create_group(client, people["a"], tok_a)
    g1 = _create_group(client, people["a"], tok_a)
    _add_member_direct(g1["id"], people["c"])  # C becomes a contact via g1

    def candidate_names():
        resp = client.get(
            f"/api/groups/{target['short_id']}/invitable-accounts",
            headers=_bearer_headers(people["a"], tok_a),
        )
        assert resp.status_code == 200, resp.text
        return [r["name"] for r in resp.json()]

    assert "Cara" in candidate_names()  # warms contacts via inline reconcile

    # Forgetting while STILL sharing g1: allowed, but the next reconcile
    # (inline on the candidates GET) re-adds — documented semantics.
    resp = client.delete(
        f"/api/users/me/contacts/{uid_c}",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 204, resp.text
    assert "Cara" in candidate_names()

    # No shared groups anymore → forgetting sticks (the FE only offers the
    # button in this case).
    _remove_member_direct(g1["id"], people["c"])
    resp2 = client.delete(
        f"/api/users/me/contacts/{uid_c}",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp2.status_code == 204, resp2.text
    assert "Cara" not in candidate_names()


def test_forget_contact_idempotent_and_validates_id(client, people):
    tok_a, _ = _sign_in(client, people["a"], name="Alice")

    # Never-a-contact (or repeat) deletes are 204 no-ops.
    resp = client.delete(
        f"/api/users/me/contacts/{uuid.uuid4()}",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 204, resp.text

    # Account-less caller has no contacts — still an idempotent 204.
    resp2 = client.delete(
        f"/api/users/me/contacts/{uuid.uuid4()}",
        headers=_bid_headers(str(uuid.uuid4())),
    )
    assert resp2.status_code == 204, resp2.text

    # Malformed id → 404 via require_uuid, never a 500.
    resp3 = client.delete(
        "/api/users/me/contacts/not-a-uuid",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp3.status_code == 404, resp3.text


def test_unknown_route_404(client, people):
    tok_a, _ = _sign_in(client, people["a"], name="Alice")
    resp = client.get(
        "/api/groups/nonexistent-route/invitable-accounts",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 404
