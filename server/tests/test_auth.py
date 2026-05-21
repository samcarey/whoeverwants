"""End-to-end tests for the Phase A+B auth surface.

Exercises the magic-link request → verify → /me / sign-out loop against
a live database. Magic-link emails go through `services.email.send_email`'s
logging fallback when `RESEND_API_KEY` is unset, so no SMTP setup needed
for tests.

Token capture: the magic-link request endpoint never returns the raw
token (it goes out via email). For tests we read the token straight out
of the `magic_link_tokens` table after the request — `consume_magic_link`
needs the RAW token (not the hash) for the predicate, so the helper
re-mints by inserting a known-token row instead of reading the hash and
trying to reverse it.
"""

import os
import uuid

import psycopg
import pytest

from services.auth import (
    consume_magic_link,
    generate_token,
    hash_token,
    is_valid_email,
    issue_magic_link,
    normalize_email,
    resolve_or_merge_user,
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


def _bid_headers(bid: str | None) -> dict:
    return {"X-Browser-Id": bid} if bid else {}


def _bearer_headers(bid: str | None, token: str) -> dict:
    h = _bid_headers(bid)
    h["Authorization"] = f"Bearer {token}"
    return h


def _issue_known_magic_link(email: str, browser_id: str | None = None) -> str:
    """Insert a magic-link token with a known raw value and return it.
    Bypasses the request endpoint so tests can drive verify directly.
    """
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


def _delete_user_for_email(email: str) -> None:
    """Clean up after merge tests so identity rows don't accumulate."""
    norm = normalize_email(email)
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM users WHERE id IN ("
                "  SELECT user_id FROM user_identities WHERE email = %s"
                ")",
                (norm,),
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Pure-helper tests (no DB)
# ---------------------------------------------------------------------------


class TestEmailValidation:
    def test_valid(self):
        assert is_valid_email("alice@example.com")
        assert is_valid_email("ALICE@EXAMPLE.COM")  # case shouldn't matter
        assert is_valid_email("a.b+c@sub.example.com")

    def test_invalid(self):
        for bad in [
            "",
            "no-at-sign",
            "missing-tld@x",
            "@example.com",
            "alice@",
            "two@@example.com",
            "white space@example.com",
            None,
            12345,
        ]:
            assert not is_valid_email(bad), f"expected invalid: {bad!r}"

    def test_normalize_trims_and_lowercases(self):
        assert normalize_email("  Alice@Example.COM  ") == "alice@example.com"


class TestTokenPrimitives:
    def test_generate_token_unique(self):
        seen = {generate_token() for _ in range(100)}
        assert len(seen) == 100  # collision would imply broken RNG

    def test_hash_is_deterministic(self):
        t = generate_token()
        assert hash_token(t) == hash_token(t)

    def test_hash_differs_per_token(self):
        assert hash_token(generate_token()) != hash_token(generate_token())


# ---------------------------------------------------------------------------
# Magic-link request endpoint
# ---------------------------------------------------------------------------


class TestMagicLinkRequest:
    def test_returns_202_for_valid_email(self, client, browser_id):
        email = f"req-{uuid.uuid4().hex[:8]}@example.com"
        resp = client.post(
            "/api/auth/magic-link/request",
            json={"email": email},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 202, resp.text
        body = resp.json()
        assert body["accepted"] is True
        assert "email_configured" in body

    def test_rejects_invalid_email_with_400(self, client, browser_id):
        resp = client.post(
            "/api/auth/magic-link/request",
            json={"email": "not-an-email"},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 400

    def test_pydantic_rejects_empty_email(self, client, browser_id):
        resp = client.post(
            "/api/auth/magic-link/request",
            json={"email": ""},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 422

    def test_throttle_silently_accepted(self, client, browser_id):
        # Two requests for the same email within the cooldown window
        # both 202 — server doesn't leak that the second was throttled.
        email = f"throttle-{uuid.uuid4().hex[:8]}@example.com"
        for _ in range(2):
            resp = client.post(
                "/api/auth/magic-link/request",
                json={"email": email},
                headers=_bid_headers(browser_id),
            )
            assert resp.status_code == 202


# ---------------------------------------------------------------------------
# Magic-link verify endpoint
# ---------------------------------------------------------------------------


class TestMagicLinkVerify:
    def test_verifies_valid_token_and_issues_session(self, client, browser_id):
        email = f"verify-{uuid.uuid4().hex[:8]}@example.com"
        token = _issue_known_magic_link(email, browser_id)

        resp = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_token"]
        assert len(body["session_token"]) >= 16
        assert body["expires_at"]
        assert body["user"]["email"] == normalize_email(email)
        assert body["user"]["providers"] == ["email"]
        assert body["user"]["user_id"]

    def test_rejects_invalid_token(self, client, browser_id):
        resp = client.post(
            "/api/auth/magic-link/verify",
            json={"token": "abcdefghij" + "X" * 20},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 400
        assert "Invalid" in resp.json()["detail"]

    def test_token_is_single_use(self, client, browser_id):
        email = f"single-{uuid.uuid4().hex[:8]}@example.com"
        token = _issue_known_magic_link(email, browser_id)

        resp1 = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        assert resp1.status_code == 200

        resp2 = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        assert resp2.status_code == 400

    def test_expired_token_rejected(self, client, browser_id):
        token = generate_token()
        # Insert an already-expired token directly.
        with psycopg.connect(TEST_DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO magic_link_tokens
                      (token_hash, email, browser_id, expires_at)
                    VALUES
                      (%s, %s, %s, NOW() - INTERVAL '5 minutes')
                    """,
                    (hash_token(token), "expired@example.com", browser_id),
                )
            conn.commit()

        resp = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 400

    def test_same_email_resolves_to_same_user_across_verifies(self, client, browser_id):
        email = f"persist-{uuid.uuid4().hex[:8]}@example.com"
        token1 = _issue_known_magic_link(email, browser_id)
        resp1 = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token1},
            headers=_bid_headers(browser_id),
        )
        assert resp1.status_code == 200
        user_id_1 = resp1.json()["user"]["user_id"]

        token2 = _issue_known_magic_link(email, browser_id)
        resp2 = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token2},
            headers=_bid_headers(browser_id),
        )
        assert resp2.status_code == 200
        assert resp2.json()["user"]["user_id"] == user_id_1


# ---------------------------------------------------------------------------
# /me + sign-out
# ---------------------------------------------------------------------------


class TestMeAndSignOut:
    def test_me_401_without_session(self, client, browser_id):
        resp = client.get("/api/auth/me", headers=_bid_headers(browser_id))
        assert resp.status_code == 401

    def test_me_returns_user_with_session(self, client, browser_id):
        email = f"me-{uuid.uuid4().hex[:8]}@example.com"
        token = _issue_known_magic_link(email, browser_id)
        verify_resp = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        session_token = verify_resp.json()["session_token"]

        me_resp = client.get(
            "/api/auth/me",
            headers=_bearer_headers(browser_id, session_token),
        )
        assert me_resp.status_code == 200, me_resp.text
        body = me_resp.json()
        assert body["email"] == normalize_email(email)
        assert body["providers"] == ["email"]

    def test_sign_out_revokes_session(self, client, browser_id):
        email = f"signout-{uuid.uuid4().hex[:8]}@example.com"
        token = _issue_known_magic_link(email, browser_id)
        verify_resp = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        session_token = verify_resp.json()["session_token"]

        # Sign out
        signout_resp = client.post(
            "/api/auth/sign-out",
            headers=_bearer_headers(browser_id, session_token),
        )
        assert signout_resp.status_code == 204

        # Subsequent /me with same token → 401
        me_resp = client.get(
            "/api/auth/me",
            headers=_bearer_headers(browser_id, session_token),
        )
        assert me_resp.status_code == 401

    def test_me_401_without_authorization_header(self, client, browser_id):
        """Even after signing in on this browser, /me requires the
        Authorization header — IdentityMiddleware no longer falls back
        to the user_browsers link, to keep anonymous requests off the
        DB entirely."""
        email = f"no-fallback-{uuid.uuid4().hex[:8]}@example.com"
        token = _issue_known_magic_link(email, browser_id)
        verify_resp = client.post(
            "/api/auth/magic-link/verify",
            json={"token": token},
            headers=_bid_headers(browser_id),
        )
        assert verify_resp.status_code == 200

        # No Authorization header → 401, even though the same browser
        # was just used to sign in.
        me_resp = client.get(
            "/api/auth/me", headers=_bid_headers(browser_id)
        )
        assert me_resp.status_code == 401


# ---------------------------------------------------------------------------
# Account merge (direct service-level test — no provider router yet)
# ---------------------------------------------------------------------------


class TestAccountMerge:
    def test_same_provider_same_id_resolves_to_same_user(self, browser_id):
        email = f"merge-same-{uuid.uuid4().hex[:8]}@example.com"
        try:
            with psycopg.connect(TEST_DB_URL) as conn:
                conn.autocommit = False
                from psycopg.rows import dict_row
                conn.row_factory = dict_row
                with conn.cursor(row_factory=dict_row) as cur:
                    r1 = resolve_or_merge_user(
                        cur, provider="email", provider_user_id=email, email=email
                    )
                    r2 = resolve_or_merge_user(
                        cur, provider="email", provider_user_id=email, email=email
                    )
                    assert r1.user_id == r2.user_id
                    assert r1.is_new_user is True
                    assert r2.is_new_user is False
                conn.commit()
        finally:
            _delete_user_for_email(email)

    def test_cross_provider_same_email_merges(self):
        email = f"merge-cross-{uuid.uuid4().hex[:8]}@example.com"
        try:
            with psycopg.connect(TEST_DB_URL) as conn:
                from psycopg.rows import dict_row
                with conn.cursor(row_factory=dict_row) as cur:
                    r1 = resolve_or_merge_user(
                        cur, provider="email", provider_user_id=email, email=email
                    )
                    r2 = resolve_or_merge_user(
                        cur,
                        provider="google",
                        provider_user_id="google-sub-12345",
                        email=email,
                    )
                    assert r1.user_id == r2.user_id, (
                        "expected Google sign-in for already-registered email to merge"
                    )
                    assert r2.is_new_user is False
                conn.commit()
        finally:
            _delete_user_for_email(email)

    def test_different_email_does_not_merge(self):
        e1 = f"distinct-1-{uuid.uuid4().hex[:8]}@example.com"
        e2 = f"distinct-2-{uuid.uuid4().hex[:8]}@example.com"
        try:
            with psycopg.connect(TEST_DB_URL) as conn:
                from psycopg.rows import dict_row
                with conn.cursor(row_factory=dict_row) as cur:
                    r1 = resolve_or_merge_user(
                        cur, provider="email", provider_user_id=e1, email=e1
                    )
                    r2 = resolve_or_merge_user(
                        cur, provider="email", provider_user_id=e2, email=e2
                    )
                    assert r1.user_id != r2.user_id
                conn.commit()
        finally:
            _delete_user_for_email(e1)
            _delete_user_for_email(e2)
