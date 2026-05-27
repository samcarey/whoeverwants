"""Sign-in absorb + `merge_accounts` (the accidental-multi-account fix).

A browser-only / identity-less account (the vote-first / name-only / auto-
created throwaway) used to be ORPHANED when its browser later signed in with
a real identity: `link_browser_to_user` repointed the browser, but the
account's polls/groups kept `creator_user_id` pointing at the now-unreachable
account, so the signed-in user lost authority over everything they'd made
before signing in.

`complete_sign_in` now absorbs that weak account instead:
  * incoming identity BRAND NEW   → upgrade the weak account in place (it
    gains the identity, keeps its polls; keeper = the weak account);
  * incoming identity PRE-EXISTING → fold the weak account's data into the
    real account (keeper = the real account).
A browser already on a DURABLE account is left alone (real account switch).

These tests drive the real magic-link verify path end-to-end and assert
against the DB that authorship moved and the source user was deleted.
"""

import uuid

import psycopg

from services.auth import (
    generate_token,
    hash_token,
    merge_accounts,
    normalize_email,
)
from tests.conftest import TEST_DB_URL


def _bid(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer(bid, token):
    h = _bid(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _issue_magic_link(email, browser_id):
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


def _sign_in(client, browser_id, email=None):
    email = email or f"merge-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_magic_link(email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify", json={"token": token}, headers=_bid(browser_id)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"], email


def _poll_creator(poll_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT creator_user_id FROM polls WHERE id = %s", (poll_id,))
            row = cur.fetchone()
    return str(row[0]) if row and row[0] else None


def _user_exists(user_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM users WHERE id = %s", (user_id,))
            return cur.fetchone() is not None


def _create_anon_poll(client, browser_id):
    """Anonymous poll create → mints an auto-account bound to the browser
    (no session). Returns (poll_id, auto_account_user_id)."""
    resp = client.post(
        "/api/polls",
        json={"creator_name": "Anon Maker", "questions": [{"question_type": "yes_no", "category": "yes_no"}]},
        headers=_bid(browser_id),
    )
    assert resp.status_code == 201, resp.text
    poll_id = resp.json()["id"]
    return poll_id, _poll_creator(poll_id)


# --------------------------------------------------------------------------
# Headline: anonymous auto-account is absorbed (upgraded in place) on sign-in
# --------------------------------------------------------------------------


def test_anon_autoaccount_upgraded_in_place_by_new_email(client):
    """Create a poll anonymously, then magic-link a BRAND-NEW email on the
    same browser. The auto-account stays the keeper, gains the email
    identity, and keeps its poll — no orphan, no new account."""
    bid = str(uuid.uuid4())
    poll_id, auto_uid = _create_anon_poll(client, bid)
    assert auto_uid is not None

    token, signed_in_uid, _ = _sign_in(client, bid)

    # Keeper IS the original auto-account (upgraded in place).
    assert signed_in_uid == auto_uid
    # Poll authorship unchanged → the signed-in user still owns it.
    assert _poll_creator(poll_id) == auto_uid
    # /me reports the email identity now lives on that account.
    me = client.get("/api/auth/me", headers=_bearer(bid, token))
    assert me.status_code == 200
    assert "email" in me.json()["providers"]
    # The signed-in user can mutate the poll (authority retained).
    closed = client.post(f"/api/polls/{poll_id}/close", json={}, headers=_bearer(bid, token))
    assert closed.status_code == 200, closed.text


def test_anon_autoaccount_merged_into_existing_account(client):
    """Account E exists (signed in on another browser). On a fresh browser,
    create a poll anonymously, then magic-link E. The auto-account folds
    INTO E: the poll moves to E and the auto-account is deleted."""
    # Device 2 establishes account E.
    other_bid = str(uuid.uuid4())
    email = f"shared-{uuid.uuid4().hex[:8]}@example.com"
    _, e_uid, _ = _sign_in(client, other_bid, email=email)

    # Device 1: anonymous poll, then sign in as the SAME email.
    bid = str(uuid.uuid4())
    poll_id, auto_uid = _create_anon_poll(client, bid)
    assert auto_uid != e_uid

    token, keeper_uid, _ = _sign_in(client, bid, email=email)

    assert keeper_uid == e_uid  # folded into the pre-existing real account
    assert _poll_creator(poll_id) == e_uid  # poll moved
    assert not _user_exists(auto_uid)  # throwaway deleted
    closed = client.post(f"/api/polls/{poll_id}/close", json={}, headers=_bearer(bid, token))
    assert closed.status_code == 200, closed.text


def test_name_only_account_upgraded_by_email(client):
    """A name-only account (session, no identity) that magic-links a new
    email keeps its identity-less account as keeper and gains email."""
    bid = str(uuid.uuid4())
    created = client.post("/api/auth/account/name", json={"name": "Nameless"}, headers=_bid(bid))
    assert created.status_code == 200, created.text
    name_uid = created.json()["user"]["user_id"]

    # Poll created while on the name-only account.
    resp = client.post(
        "/api/polls",
        json={"creator_name": "Nameless", "questions": [{"question_type": "yes_no", "category": "yes_no"}]},
        headers=_bearer(bid, created.json()["session_token"]),
    )
    assert resp.status_code == 201, resp.text
    poll_id = resp.json()["id"]
    assert _poll_creator(poll_id) == name_uid

    token, keeper_uid, _ = _sign_in(client, bid)
    assert keeper_uid == name_uid  # upgraded in place
    assert _poll_creator(poll_id) == name_uid
    me = client.get("/api/auth/me", headers=_bearer(bid, token))
    assert "email" in me.json()["providers"]


def test_durable_account_not_absorbed_on_switch(client):
    """Already on a real (email) account, magic-linking a DIFFERENT email is
    a switch, not a merge — the first account survives."""
    bid = str(uuid.uuid4())
    _, first_uid, _ = _sign_in(client, bid, email=f"first-{uuid.uuid4().hex[:8]}@example.com")
    _, second_uid, _ = _sign_in(client, bid, email=f"second-{uuid.uuid4().hex[:8]}@example.com")

    assert first_uid != second_uid
    assert _user_exists(first_uid)  # not deleted — durable accounts aren't absorbed
    assert _user_exists(second_uid)


# --------------------------------------------------------------------------
# merge_accounts primitive — constrained-table conflict handling
# --------------------------------------------------------------------------


def test_merge_accounts_keeps_dest_profile_and_moves_polls(client):
    """Direct merge_accounts: poll authorship moves; on a user_profiles PK
    collision the dest's photo is kept and the source's dropped; source
    user is deleted."""
    bid_src = str(uuid.uuid4())
    poll_id, src_uid = _create_anon_poll(client, bid_src)
    # A second auto-account to be the dest.
    poll_id2, dst_uid = _create_anon_poll(client, str(uuid.uuid4()))

    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            # Both accounts have a profile row → dest's must win.
            for uid, mime in ((src_uid, "image/png"), (dst_uid, "image/jpeg")):
                cur.execute(
                    "INSERT INTO user_profiles (user_id, image_data, image_mime_type, image_updated_at) "
                    "VALUES (%s::uuid, %s, %s, NOW())",
                    (uid, b"\x89PNG", mime),
                )
        conn.commit()
        with conn.cursor() as cur:
            merge_accounts(conn, source_user_id=src_uid, dest_user_id=dst_uid)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT creator_user_id FROM polls WHERE id = %s", (poll_id,))
            assert str(cur.fetchone()[0]) == dst_uid  # src poll moved to dest
            cur.execute("SELECT image_mime_type FROM user_profiles WHERE user_id = %s::uuid", (dst_uid,))
            assert cur.fetchone()[0] == "image/jpeg"  # dest's photo kept
            cur.execute("SELECT 1 FROM user_profiles WHERE user_id = %s::uuid", (src_uid,))
            assert cur.fetchone() is None  # src profile dropped
            cur.execute("SELECT 1 FROM users WHERE id = %s::uuid", (src_uid,))
            assert cur.fetchone() is None  # src user deleted
