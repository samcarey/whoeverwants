"""Roster endpoint coverage: `GET /api/groups/{id}/members`.

The /info "Members" list used to be built from poll participants
(`Group.participantNames`), so a member who joined via approve / invite /
"Add people" but hadn't voted on a poll yet was invisible. This endpoint
reads the ACTUAL `group_members` roster instead. Covered here:

  * named members (account display_name) are listed individually;
  * account-aware de-dup (one person on N browsers = one entry);
  * nameless members roll up into `anonymous_count`;
  * private groups are members-only (404 to non-members).

Membership is set up by direct DB inserts (the join flow itself is covered
by test_join_requests / test_invite_members).
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
    """Magic-link verify → (session_token, user_id). Returns the SESSION
    token (not the consumed magic-link token) so the bearer resolves a
    user_id at create time — create_group keys privacy on the genuine
    bearer session, not the browser→account fallback."""
    email = f"roster-{uuid.uuid4().hex[:8]}@example.com"
    link_token = _issue_known_magic_link(email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": link_token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    uid = body["user"]["user_id"]
    if name:
        _set_display_name(uid, name)
    return body["session_token"], uid


def _link_browser(user_id, browser_id):
    """Link a second browser to an existing account (ON CONFLICT update)."""
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_browsers (browser_id, user_id)
                VALUES (%s::uuid, %s::uuid)
                ON CONFLICT (browser_id) DO UPDATE SET user_id = EXCLUDED.user_id
                """,
                (browser_id, user_id),
            )
        conn.commit()


def _create_group(client, browser_id, token):
    resp = client.post("/api/groups", headers=_bearer_headers(browser_id, token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _add_member_direct(group_id, browser_id):
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


@pytest.fixture
def people():
    return {k: str(uuid.uuid4()) for k in ("a", "b", "c", "d", "e")}


def test_roster_lists_named_members_not_just_participants(client, people):
    """The reported bug: a creator + an approved member who has never voted.
    Both must appear even though there are no polls."""
    tok_a, _ = _sign_in(client, people["a"], name="Sam")
    tok_b, _ = _sign_in(client, people["b"], name="Bob")
    group = _create_group(client, people["a"], tok_a)  # creator auto-joined
    _add_member_direct(group["id"], people["b"])  # Bob "approved", no poll

    resp = client.get(
        f"/api/groups/{group['short_id']}/members",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = sorted(m["name"] for m in body["members"])
    assert names == ["Bob", "Sam"]
    assert body["anonymous_count"] == 0


def test_roster_dedups_account_across_browsers(client, people):
    """One person signed in on two browsers (both group members) is ONE
    member entry, not two."""
    tok_a, uid_a = _sign_in(client, people["a"], name="Sam")
    group = _create_group(client, people["a"], tok_a)
    # Second browser, same account, also a member.
    _link_browser(uid_a, people["b"])
    _add_member_direct(group["id"], people["b"])

    resp = client.get(
        f"/api/groups/{group['short_id']}/members",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [m["name"] for m in body["members"]] == ["Sam"]
    assert body["anonymous_count"] == 0


def test_roster_rolls_up_anonymous_members(client, people):
    """A nameless browser member (no account, no voter_name) rolls into
    anonymous_count rather than appearing as a blank row."""
    tok_a, _ = _sign_in(client, people["a"], name="Sam")
    group = _create_group(client, people["a"], tok_a)
    _add_member_direct(group["id"], people["c"])  # anonymous browser, no account

    resp = client.get(
        f"/api/groups/{group['short_id']}/members",
        headers=_bearer_headers(people["a"], tok_a),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [m["name"] for m in body["members"]] == ["Sam"]
    assert body["anonymous_count"] == 1


def test_roster_private_group_is_members_only(client, people):
    """A non-member of a private group gets 404 (don't leak the roster)."""
    tok_a, _ = _sign_in(client, people["a"], name="Sam")
    group = _create_group(client, people["a"], tok_a)  # signed-in → private

    # Stranger browser, not a member, no account.
    resp = client.get(
        f"/api/groups/{group['short_id']}/members",
        headers=_bid_headers(people["e"]),
    )
    assert resp.status_code == 404
