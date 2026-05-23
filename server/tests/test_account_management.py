"""Phase I (account management) end-to-end coverage.

Two features, both documented in docs/auth-access-model.md → Phase I:

  * Recovery email — attach an email identity to an account that lacks
    one (passkey-only / OAuth-only). Two steps:
      - POST /api/auth/recovery-email/request {email}
          anonymous → 401
          signed-in passkey-only + valid email → 202 accepted
          signed-in account that ALREADY has an email → 400
          invalid email → 400
      - POST /api/auth/recovery-email/verify {token}
          anonymous → 401
          invalid / expired token → 400
          token's user_id != session user_id → 403 (token survives)
          email already used by another account → 409 (token survives)
          happy path → 200, 'email' now in providers, email surfaces
          + the attached email can then SIGN IN to the same user
  * Account deletion — DELETE /api/auth/me
      anonymous → 401
      signed-in → 204, session invalidated, user row gone
      cascade: groups they created survive with creator_user_id NULL;
               sessions / identities / browser links gone; browser
               keeps its group_members row (reverts to anonymous)

  * Flow isolation — a recovery token can't be redeemed as a sign-in and
    vice versa (the two consume predicates are user_id NULL vs NOT NULL).

Mirrors test_auth.py's helpers: tokens are minted directly into
`magic_link_tokens` with a known raw value so verify can be driven
without scraping the email log.
"""

import os
import uuid

import psycopg
import pytest

from services.auth import (
    attach_email_identity,
    generate_token,
    hash_token,
    normalize_email,
)

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def browser_id():
    return str(uuid.uuid4())


def _bid_headers(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer_headers(bid, token):
    h = _bid_headers(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _unique_email() -> str:
    return f"phasei-{uuid.uuid4().hex[:10]}@example.com"


def _issue_signin_token(email, browser_id=None) -> str:
    """A sign-in magic-link token (user_id NULL)."""
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO magic_link_tokens
                  (token_hash, email, browser_id, expires_at)
                VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id),
            )
        conn.commit()
    return token


def _mint_recovery_token(email, user_id, browser_id=None) -> str:
    """A recovery-email-attach token (user_id set)."""
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO magic_link_tokens
                  (token_hash, email, browser_id, user_id, expires_at)
                VALUES (%s, %s, %s, %s::uuid, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id, user_id),
            )
        conn.commit()
    return token


def _sign_in_email(client, browser_id, email=None):
    """Full magic-link sign-in (creates an 'email' identity). Returns
    (session_token, user_id, normalized_email)."""
    raw = email or _unique_email()
    token = _issue_signin_token(raw, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"], normalize_email(raw)


def _create_passkey_only_user(browser_id):
    """Insert a users row + a passkey-provider identity (no email) + a
    session, returning (session_token, user_id). Mirrors the state Phase
    D anonymous passkey registration leaves an account in."""
    token = generate_token()
    cred_id = f"cred-{uuid.uuid4().hex}"
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO users DEFAULT VALUES RETURNING id")
            user_id = str(cur.fetchone()[0])
            cur.execute(
                """
                INSERT INTO user_identities
                  (provider, provider_user_id, user_id, email)
                VALUES ('passkey', %s, %s::uuid, NULL)
                """,
                (cred_id, user_id),
            )
            cur.execute(
                """
                INSERT INTO user_browsers (browser_id, user_id)
                VALUES (%s::uuid, %s::uuid)
                ON CONFLICT (browser_id) DO NOTHING
                """,
                (browser_id, user_id),
            )
            cur.execute(
                """
                INSERT INTO sessions
                  (token_hash, user_id, browser_id, expires_at, last_used_at)
                VALUES (%s, %s::uuid, %s::uuid, NOW() + INTERVAL '30 days', NOW())
                """,
                (hash_token(token), user_id, browser_id),
            )
        conn.commit()
    return token, user_id


def _row_count(sql, params):
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()[0]


# --------------------------------------------------------------------- request


def test_recovery_request_anonymous_401(client, browser_id):
    resp = client.post(
        "/api/auth/recovery-email/request",
        json={"email": _unique_email()},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 401, resp.text


def test_recovery_request_passkey_only_accepted(client, browser_id):
    token, _ = _create_passkey_only_user(browser_id)
    resp = client.post(
        "/api/auth/recovery-email/request",
        json={"email": _unique_email()},
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 202, resp.text
    assert resp.json()["accepted"] is True


def test_recovery_request_rejected_when_account_already_has_email(
    client, browser_id
):
    token, _, _ = _sign_in_email(client, browser_id)
    resp = client.post(
        "/api/auth/recovery-email/request",
        json={"email": _unique_email()},
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 400, resp.text
    assert "already has an email" in resp.json()["detail"].lower()


def test_recovery_request_invalid_email_400(client, browser_id):
    token, _ = _create_passkey_only_user(browser_id)
    resp = client.post(
        "/api/auth/recovery-email/request",
        json={"email": "not-an-email"},
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------- verify


def test_recovery_verify_anonymous_401(client, browser_id):
    token, user_id = _create_passkey_only_user(browser_id)
    rtoken = _mint_recovery_token(_unique_email(), user_id)
    # No Authorization header → not signed in.
    resp = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": rtoken},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 401, resp.text


def test_recovery_verify_invalid_token_400(client, browser_id):
    token, _ = _create_passkey_only_user(browser_id)
    resp = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": generate_token()},
        headers=_bearer_headers(browser_id, token),
    )
    assert resp.status_code == 400, resp.text


def test_recovery_verify_happy_path_attaches_and_can_sign_in(
    client, browser_id
):
    session_token, user_id = _create_passkey_only_user(browser_id)
    email = _unique_email()
    rtoken = _mint_recovery_token(email, user_id, browser_id)

    resp = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": rtoken},
        headers=_bearer_headers(browser_id, session_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "email" in body["providers"]
    assert "passkey" in body["providers"]
    assert body["email"] == normalize_email(email)
    assert body["user_id"] == user_id

    # The token is now spent — a replay 400s.
    replay = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": rtoken},
        headers=_bearer_headers(browser_id, session_token),
    )
    assert replay.status_code == 400, replay.text

    # The attached email can now SIGN IN, resolving to the SAME user.
    signin_token = _issue_signin_token(email, str(uuid.uuid4()))
    signin = client.post(
        "/api/auth/magic-link/verify",
        json={"token": signin_token},
        headers=_bid_headers(str(uuid.uuid4())),
    )
    assert signin.status_code == 200, signin.text
    assert signin.json()["user"]["user_id"] == user_id


def test_recovery_verify_wrong_user_403_token_survives(client):
    # User A requests recovery for an email; user B (signed in) clicks it.
    bid_a = str(uuid.uuid4())
    bid_b = str(uuid.uuid4())
    _, user_a = _create_passkey_only_user(bid_a)
    session_b, _ = _create_passkey_only_user(bid_b)
    email = _unique_email()
    rtoken = _mint_recovery_token(email, user_a, bid_a)

    # B (a different account) clicks A's link → 403, no attach.
    resp = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": rtoken},
        headers=_bearer_headers(bid_b, session_b),
    )
    assert resp.status_code == 403, resp.text
    assert _row_count(
        "SELECT COUNT(*) FROM user_identities WHERE provider='email' AND provider_user_id=%s",
        (normalize_email(email),),
    ) == 0

    # The token survived B's wrong-device click — A can still redeem it.
    session_a, _ = _create_passkey_only_user(bid_a)  # fresh session for A's browser
    # (re-link the original user to bid_a so the session matches user_a)
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE sessions SET user_id = %s::uuid WHERE token_hash = %s",
                (user_a, hash_token(session_a)),
            )
        conn.commit()
    ok = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": rtoken},
        headers=_bearer_headers(bid_a, session_a),
    )
    assert ok.status_code == 200, ok.text
    assert "email" in ok.json()["providers"]


def test_recovery_verify_email_conflict_409_token_survives(client):
    # User A owns email E (signed in via magic-link). User B (passkey-only)
    # tries to attach E → 409, E stays bound to A only.
    bid_a = str(uuid.uuid4())
    bid_b = str(uuid.uuid4())
    _, user_a, email = _sign_in_email(client, bid_a)
    session_b, user_b = _create_passkey_only_user(bid_b)
    rtoken = _mint_recovery_token(email, user_b, bid_b)

    resp = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": rtoken},
        headers=_bearer_headers(bid_b, session_b),
    )
    assert resp.status_code == 409, resp.text
    # E still belongs only to A.
    assert _row_count(
        "SELECT COUNT(*) FROM user_identities WHERE provider='email' AND provider_user_id=%s",
        (email,),
    ) == 1
    assert _row_count(
        "SELECT COUNT(*) FROM user_identities WHERE provider='email' AND provider_user_id=%s AND user_id=%s::uuid",
        (email, user_b),
    ) == 0


# ----------------------------------------------------- attach_email_identity()


def test_attach_email_identity_branches():
    """Unit-level coverage of the three return discriminators."""
    email = _unique_email()
    with psycopg.connect(TEST_DB_URL, row_factory=psycopg.rows.dict_row) as conn:
        # Fresh passkey-only user.
        user_id = str(
            conn.execute("INSERT INTO users DEFAULT VALUES RETURNING id").fetchone()["id"]
        )
        conn.execute(
            "INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('passkey', %s, %s::uuid)",
            (f"cred-{uuid.uuid4().hex}", user_id),
        )

        assert attach_email_identity(conn, user_id=user_id, email=email) == "attached"
        assert attach_email_identity(conn, user_id=user_id, email=email) == "already_linked"

        # A different user claiming the same email → conflict.
        other = str(
            conn.execute("INSERT INTO users DEFAULT VALUES RETURNING id").fetchone()["id"]
        )
        assert attach_email_identity(conn, user_id=other, email=email) == "conflict"
        conn.rollback()


# ---------------------------------------------------------------- flow isolation


def test_signin_token_cannot_be_redeemed_as_recovery(client, browser_id):
    session_token, _ = _create_passkey_only_user(browser_id)
    signin_token = _issue_signin_token(_unique_email())  # user_id NULL
    resp = client.post(
        "/api/auth/recovery-email/verify",
        json={"token": signin_token},
        headers=_bearer_headers(browser_id, session_token),
    )
    assert resp.status_code == 400, resp.text


def test_recovery_token_cannot_be_redeemed_as_signin(client, browser_id):
    _, user_id = _create_passkey_only_user(browser_id)
    rtoken = _mint_recovery_token(_unique_email(), user_id)  # user_id set
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": rtoken},
        headers=_bid_headers(str(uuid.uuid4())),
    )
    assert resp.status_code == 400, resp.text


# --------------------------------------------------------------- delete account


def test_delete_account_anonymous_401(client, browser_id):
    resp = client.delete("/api/auth/me", headers=_bid_headers(browser_id))
    assert resp.status_code == 401, resp.text


def test_delete_account_invalidates_session_and_removes_user(client, browser_id):
    session_token, user_id = _create_passkey_only_user(browser_id)
    # Sanity: /me works before deletion.
    me = client.get("/api/auth/me", headers=_bearer_headers(browser_id, session_token))
    assert me.status_code == 200, me.text

    resp = client.delete(
        "/api/auth/me", headers=_bearer_headers(browser_id, session_token)
    )
    assert resp.status_code == 204, resp.text

    # Session is gone — the same token no longer resolves.
    me2 = client.get(
        "/api/auth/me", headers=_bearer_headers(browser_id, session_token)
    )
    assert me2.status_code == 401, me2.text

    assert _row_count("SELECT COUNT(*) FROM users WHERE id=%s::uuid", (user_id,)) == 0
    assert _row_count(
        "SELECT COUNT(*) FROM user_identities WHERE user_id=%s::uuid", (user_id,)
    ) == 0
    assert _row_count(
        "SELECT COUNT(*) FROM user_browsers WHERE user_id=%s::uuid", (user_id,)
    ) == 0


def test_delete_account_keeps_created_group_with_null_creator(client, browser_id):
    session_token, user_id = _create_passkey_only_user(browser_id)
    # Signed-in create → private group with creator_user_id = user_id.
    grp = client.post(
        "/api/groups", headers=_bearer_headers(browser_id, session_token)
    )
    assert grp.status_code == 201, grp.text
    group = grp.json()
    group_id = group["id"]
    assert group["creator_user_id"] == user_id

    resp = client.delete(
        "/api/auth/me", headers=_bearer_headers(browser_id, session_token)
    )
    assert resp.status_code == 204, resp.text

    # Group survives; creator_user_id is SET NULL.
    assert _row_count("SELECT COUNT(*) FROM groups WHERE id=%s::uuid", (group_id,)) == 1
    assert _row_count(
        "SELECT COUNT(*) FROM groups WHERE id=%s::uuid AND creator_user_id IS NULL",
        (group_id,),
    ) == 1
    # The browser keeps its membership (reverts to anonymous).
    assert _row_count(
        "SELECT COUNT(*) FROM group_members WHERE group_id=%s::uuid AND browser_id=%s::uuid",
        (group_id, browser_id),
    ) == 1
