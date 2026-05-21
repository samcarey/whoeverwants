"""Tests for Phase D — Passkey (WebAuthn) helpers + routes.

The webauthn library's own test suite exhaustively covers the
verification ceremonies (signature checks, attestation parsing,
clone-detection). What we test here is the surface we own:

  - DB helpers in `services/passkeys.py` (challenge stash/consume,
    credential list/get/delete/rename).
  - Route-level wiring: providers endpoint reports `passkey`, options
    endpoints return correctly-shaped dicts, auth gates fire as
    expected (registration requires sign-in, anon authentication
    options work, list/delete/rename require sign-in + ownership).
  - Configuration: `PASSKEYS_DISABLED=1` flips capability + 503s the
    verify endpoints.

Verifying actual attestation / assertion bytes requires a fake
authenticator (e.g. `soft_webauthn`); deferred until that's a real
need. The integration test that exercises a real ceremony lives in the
FE via Playwright + the browser's virtual authenticator API (TODO —
separate PR).
"""

import os
import uuid

import psycopg
import pytest

from services.auth import generate_token, hash_token, normalize_email
from services.passkeys import (
    _b64url_decode,
    _b64url_encode,
    _consume_challenge,
    _stash_challenge,
    delete_passkey,
    get_passkey_by_credential_id,
    list_user_passkeys,
    passkey_configured,
    rename_passkey,
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


@pytest.fixture
def db_conn():
    """Direct psycopg connection with dict_row factory so tests can use
    the same row-shape conventions the service code expects (`row["c"]`,
    not `row[0]`)."""
    conn = psycopg.connect(TEST_DB_URL, row_factory=psycopg.rows.dict_row)
    yield conn
    conn.rollback()
    conn.close()


def _create_user(conn) -> str:
    """Insert a fresh users row + identity row and return user_id."""
    row = conn.execute(
        "INSERT INTO users DEFAULT VALUES RETURNING id"
    ).fetchone()
    user_id = str(row["id"])
    # Add an email identity so the registration options endpoint has a
    # display label.
    conn.execute(
        """
        INSERT INTO user_identities (provider, provider_user_id, user_id, email)
        VALUES ('email', %(e)s, %(u)s::uuid, %(e)s)
        """,
        {
            "e": f"user-{uuid.uuid4().hex[:8]}@example.com",
            "u": user_id,
        },
    )
    conn.commit()
    return user_id


def _bid_headers(bid: str | None) -> dict:
    return {
        "X-Browser-Id": bid,
        # Origin drives `_resolve_fe_origin` and `_resolve_rp_id`. Use a
        # whitelisted dev host so the test doesn't fall through to the
        # default prod origin (which would still work but cluster the
        # tests behind a less explicit rp_id).
        "Origin": "http://localhost:3000",
    } if bid else {"Origin": "http://localhost:3000"}


def _bearer_headers(bid: str | None, token: str) -> dict:
    h = _bid_headers(bid)
    h["Authorization"] = f"Bearer {token}"
    return h


def _issue_session_for(user_id: str, browser_id: str) -> str:
    """Insert a session row directly so tests can drive authenticated
    routes without going through the magic-link verify flow."""
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sessions
                  (token_hash, user_id, browser_id, expires_at, last_used_at)
                VALUES
                  (%s, %s::uuid, %s::uuid, NOW() + INTERVAL '90 days', NOW())
                """,
                (hash_token(token), user_id, browser_id),
            )
        conn.commit()
    return token


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestB64UrlRoundTrip:
    def test_encode_decode_roundtrip(self):
        for raw in [b"", b"hello", os.urandom(32), os.urandom(64)]:
            encoded = _b64url_encode(raw)
            # No padding survives — b64url stripped trailing '='s.
            assert "=" not in encoded
            assert _b64url_decode(encoded) == raw

    def test_decode_tolerates_missing_padding(self):
        # Real WebAuthn responses arrive without padding.
        original = b"\x00\x01\x02\x03"
        encoded = _b64url_encode(original)
        assert _b64url_decode(encoded) == original


# ---------------------------------------------------------------------------
# Challenge persistence
# ---------------------------------------------------------------------------


class TestChallengeStash:
    def test_stash_then_consume_returns_value(self, db_conn, browser_id):
        challenge_bytes = os.urandom(32)
        stashed = _stash_challenge(
            db_conn,
            browser_id=browser_id,
            kind="registration",
            challenge=challenge_bytes,
            user_id=None,
        )
        db_conn.commit()
        consumed = _consume_challenge(
            db_conn, browser_id=browser_id, kind="registration"
        )
        db_conn.commit()
        assert consumed is not None
        assert consumed.challenge == stashed
        assert _b64url_decode(consumed.challenge) == challenge_bytes

    def test_consume_is_single_use(self, db_conn, browser_id):
        _stash_challenge(
            db_conn,
            browser_id=browser_id,
            kind="authentication",
            challenge=os.urandom(32),
            user_id=None,
        )
        db_conn.commit()
        first = _consume_challenge(
            db_conn, browser_id=browser_id, kind="authentication"
        )
        db_conn.commit()
        second = _consume_challenge(
            db_conn, browser_id=browser_id, kind="authentication"
        )
        db_conn.commit()
        assert first is not None
        assert second is None, "consume should delete the row"

    def test_stash_overwrites_prior_of_same_kind(self, db_conn, browser_id):
        # Two registration option requests in a row: the second should
        # invalidate the first.
        first = _stash_challenge(
            db_conn,
            browser_id=browser_id,
            kind="registration",
            challenge=os.urandom(32),
            user_id=None,
        )
        second = _stash_challenge(
            db_conn,
            browser_id=browser_id,
            kind="registration",
            challenge=os.urandom(32),
            user_id=None,
        )
        db_conn.commit()
        assert first != second
        consumed = _consume_challenge(
            db_conn, browser_id=browser_id, kind="registration"
        )
        db_conn.commit()
        assert consumed is not None
        assert consumed.challenge == second

    def test_kinds_are_independent(self, db_conn, browser_id):
        # Registration and authentication challenges can coexist for
        # one browser (different ceremony in each tab).
        _stash_challenge(
            db_conn,
            browser_id=browser_id,
            kind="registration",
            challenge=os.urandom(32),
            user_id=None,
        )
        _stash_challenge(
            db_conn,
            browser_id=browser_id,
            kind="authentication",
            challenge=os.urandom(32),
            user_id=None,
        )
        db_conn.commit()
        assert _consume_challenge(
            db_conn, browser_id=browser_id, kind="registration"
        )
        db_conn.commit()
        # Authentication is still there.
        assert _consume_challenge(
            db_conn, browser_id=browser_id, kind="authentication"
        )
        db_conn.commit()

    def test_expired_challenge_not_consumed(self, db_conn, browser_id):
        # Insert a row with expires_at in the past.
        db_conn.execute(
            """
            INSERT INTO passkey_challenges
              (browser_id, kind, challenge, expires_at)
            VALUES
              (%(b)s::uuid, 'registration', 'expired-challenge',
               NOW() - INTERVAL '1 hour')
            """,
            {"b": browser_id},
        )
        db_conn.commit()
        consumed = _consume_challenge(
            db_conn, browser_id=browser_id, kind="registration"
        )
        db_conn.commit()
        assert consumed is None


# ---------------------------------------------------------------------------
# Credential storage
# ---------------------------------------------------------------------------


def _insert_credential(
    conn, user_id: str, *, name: str | None = None, sign_count: int = 0
) -> str:
    credential_id = _b64url_encode(os.urandom(32))
    conn.execute(
        """
        INSERT INTO passkey_credentials
          (credential_id, user_id, public_key, sign_count, name)
        VALUES
          (%(c)s, %(u)s::uuid, %(pk)s, %(sc)s, %(n)s)
        """,
        {
            "c": credential_id,
            "u": user_id,
            "pk": b"fake-public-key-bytes",
            "sc": sign_count,
            "n": name,
        },
    )
    conn.commit()
    return credential_id


class TestCredentialStorage:
    def test_list_returns_user_passkeys_newest_first(self, db_conn):
        user_id = _create_user(db_conn)
        c1 = _insert_credential(db_conn, user_id, name="First")
        c2 = _insert_credential(db_conn, user_id, name="Second")
        rows = list_user_passkeys(db_conn, user_id)
        assert len(rows) == 2
        # ORDER BY created_at DESC — Second was inserted second so newer.
        assert rows[0].credential_id == c2
        assert rows[1].credential_id == c1

    def test_list_only_returns_owner(self, db_conn):
        user_a = _create_user(db_conn)
        user_b = _create_user(db_conn)
        _insert_credential(db_conn, user_a)
        _insert_credential(db_conn, user_b)
        rows = list_user_passkeys(db_conn, user_a)
        assert len(rows) == 1
        assert rows[0].user_id == user_a

    def test_get_by_credential_id(self, db_conn):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id, name="Test")
        row = get_passkey_by_credential_id(db_conn, cid)
        assert row is not None
        assert row.credential_id == cid
        assert row.name == "Test"

    def test_get_returns_none_for_unknown(self, db_conn):
        assert get_passkey_by_credential_id(db_conn, "nonexistent") is None

    def test_delete_only_by_owner(self, db_conn):
        user_a = _create_user(db_conn)
        user_b = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_a)
        # Wrong user can't delete.
        assert delete_passkey(db_conn, user_id=user_b, credential_id=cid) is False
        db_conn.commit()
        assert get_passkey_by_credential_id(db_conn, cid) is not None
        # Owner can.
        assert delete_passkey(db_conn, user_id=user_a, credential_id=cid) is True
        db_conn.commit()
        assert get_passkey_by_credential_id(db_conn, cid) is None

    def test_rename(self, db_conn):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id, name="Old")
        assert rename_passkey(
            db_conn, user_id=user_id, credential_id=cid, name="New"
        )
        db_conn.commit()
        row = get_passkey_by_credential_id(db_conn, cid)
        assert row.name == "New"

    def test_rename_empty_clears(self, db_conn):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id, name="Old")
        rename_passkey(db_conn, user_id=user_id, credential_id=cid, name="   ")
        db_conn.commit()
        row = get_passkey_by_credential_id(db_conn, cid)
        assert row.name is None

    def test_rename_truncates_to_120(self, db_conn):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id)
        rename_passkey(
            db_conn, user_id=user_id, credential_id=cid, name="A" * 500
        )
        db_conn.commit()
        row = get_passkey_by_credential_id(db_conn, cid)
        assert len(row.name) == 120

    def test_rename_only_by_owner(self, db_conn):
        user_a = _create_user(db_conn)
        user_b = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_a, name="Owner")
        assert rename_passkey(
            db_conn, user_id=user_b, credential_id=cid, name="Spoof"
        ) is False
        db_conn.commit()
        row = get_passkey_by_credential_id(db_conn, cid)
        assert row.name == "Owner"


# ---------------------------------------------------------------------------
# Capability flag
# ---------------------------------------------------------------------------


class TestPasskeyConfigured:
    def test_default_enabled(self, monkeypatch):
        monkeypatch.delenv("PASSKEYS_DISABLED", raising=False)
        assert passkey_configured() is True

    def test_disabled_via_env(self, monkeypatch):
        monkeypatch.setenv("PASSKEYS_DISABLED", "1")
        assert passkey_configured() is False
        monkeypatch.setenv("PASSKEYS_DISABLED", "true")
        assert passkey_configured() is False

    def test_other_values_still_enabled(self, monkeypatch):
        monkeypatch.setenv("PASSKEYS_DISABLED", "")
        assert passkey_configured() is True
        monkeypatch.setenv("PASSKEYS_DISABLED", "0")
        assert passkey_configured() is True


# ---------------------------------------------------------------------------
# Route-level — providers endpoint
# ---------------------------------------------------------------------------


class TestProvidersEndpoint:
    def test_includes_passkey(self, client, browser_id):
        resp = client.get(
            "/api/auth/providers", headers=_bid_headers(browser_id)
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "passkey" in body
        # Default: enabled when PASSKEYS_DISABLED is unset.
        assert body["passkey"] is True

    def test_passkey_false_when_disabled(self, client, browser_id, monkeypatch):
        monkeypatch.setenv("PASSKEYS_DISABLED", "1")
        resp = client.get(
            "/api/auth/providers", headers=_bid_headers(browser_id)
        )
        assert resp.json()["passkey"] is False


# ---------------------------------------------------------------------------
# Route-level — registration options
# ---------------------------------------------------------------------------


class TestPasskeyRegistrationOptions:
    def test_anonymous_mints_user_and_returns_options(
        self, client, browser_id, db_conn
    ):
        """Anonymous registration (no Authorization header): server mints
        a fresh user_id up front, returns options dict with that
        user_id encoded into the WebAuthn `user.id` field. The matching
        user_identities row is written at verify time, so the row will
        be orphan-cleaned if verify is never called (5-min challenge
        TTL expires; orphan user remains until manual cleanup)."""
        resp = client.post(
            "/api/auth/passkey/registration/options",
            json={},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "challenge" in body
        assert body["user"]["id"]
        # excludeCredentials is empty for a fresh user.
        assert body.get("excludeCredentials") == []
        # Confirm a `users` row was minted.
        challenge_row = db_conn.execute(
            "SELECT user_id FROM passkey_challenges WHERE browser_id = %s::uuid AND kind = 'registration'",
            (browser_id,),
        ).fetchone()
        assert challenge_row is not None
        assert challenge_row["user_id"] is not None
        user_row = db_conn.execute(
            "SELECT id FROM users WHERE id = %s::uuid",
            (str(challenge_row["user_id"]),),
        ).fetchone()
        assert user_row is not None

    def test_returns_options_when_signed_in(
        self, client, browser_id, db_conn
    ):
        user_id = _create_user(db_conn)
        token = _issue_session_for(user_id, browser_id)
        resp = client.post(
            "/api/auth/passkey/registration/options",
            json={},
            headers=_bearer_headers(browser_id, token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # Standard WebAuthn options shape.
        assert "challenge" in body
        assert "rp" in body
        assert body["rp"]["id"] == "localhost"  # from Origin header
        assert "user" in body
        assert body["user"]["id"]  # base64url-encoded user id bytes
        assert "pubKeyCredParams" in body
        # Empty list when no prior credentials.
        assert body.get("excludeCredentials") == []

    def test_503_when_passkeys_disabled(
        self, client, browser_id, monkeypatch
    ):
        monkeypatch.setenv("PASSKEYS_DISABLED", "1")
        resp = client.post(
            "/api/auth/passkey/registration/options",
            json={},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 503

    def test_exclude_credentials_contains_existing(
        self, client, browser_id, db_conn
    ):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id)
        token = _issue_session_for(user_id, browser_id)
        resp = client.post(
            "/api/auth/passkey/registration/options",
            json={},
            headers=_bearer_headers(browser_id, token),
        )
        body = resp.json()
        ids = [c["id"] for c in body.get("excludeCredentials", [])]
        assert cid in ids


# ---------------------------------------------------------------------------
# Route-level — authentication options
# ---------------------------------------------------------------------------


class TestPasskeyAuthenticationOptions:
    def test_anonymous_ok(self, client, browser_id):
        resp = client.post(
            "/api/auth/passkey/authentication/options",
            json={},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "challenge" in body
        assert "rpId" in body

    def test_503_when_disabled(self, client, browser_id, monkeypatch):
        monkeypatch.setenv("PASSKEYS_DISABLED", "1")
        resp = client.post(
            "/api/auth/passkey/authentication/options",
            json={},
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Route-level — verify endpoints with invalid input
# ---------------------------------------------------------------------------


class TestPasskeyVerifyInvalidInput:
    def test_registration_verify_400_without_options_first(
        self, client, browser_id
    ):
        # Verify with no prior options call: challenge stash is empty,
        # so the helper raises PasskeyError → 400. Anonymous request
        # path — registration is no longer auth-gated.
        resp = client.post(
            "/api/auth/passkey/registration/verify",
            json={
                "credential": {
                    "id": "abc",
                    "rawId": "abc",
                    "type": "public-key",
                    "response": {},
                },
                "name": None,
            },
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 400
        assert "expired" in resp.json()["detail"].lower()

    def test_authentication_verify_400_without_options_first(
        self, client, browser_id
    ):
        resp = client.post(
            "/api/auth/passkey/authentication/verify",
            json={
                "credential": {
                    "id": "abc",
                    "rawId": "abc",
                    "type": "public-key",
                    "response": {},
                },
            },
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Route-level — list / delete / rename
# ---------------------------------------------------------------------------


class TestPasskeyManagement:
    def test_list_requires_sign_in(self, client, browser_id):
        resp = client.get(
            "/api/auth/passkeys", headers=_bid_headers(browser_id)
        )
        assert resp.status_code == 401

    def test_list_returns_user_passkeys(self, client, browser_id, db_conn):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id, name="My Phone")
        token = _issue_session_for(user_id, browser_id)
        resp = client.get(
            "/api/auth/passkeys",
            headers=_bearer_headers(browser_id, token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["passkeys"]) == 1
        assert body["passkeys"][0]["credential_id"] == cid
        assert body["passkeys"][0]["name"] == "My Phone"

    def test_delete_204s_on_owned_credential(
        self, client, browser_id, db_conn
    ):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id)
        token = _issue_session_for(user_id, browser_id)
        resp = client.delete(
            f"/api/auth/passkeys/{cid}",
            headers=_bearer_headers(browser_id, token),
        )
        assert resp.status_code == 204

    def test_delete_404s_on_other_users_credential(
        self, client, browser_id, db_conn
    ):
        owner = _create_user(db_conn)
        stranger = _create_user(db_conn)
        cid = _insert_credential(db_conn, owner)
        stranger_token = _issue_session_for(stranger, browser_id)
        resp = client.delete(
            f"/api/auth/passkeys/{cid}",
            headers=_bearer_headers(browser_id, stranger_token),
        )
        assert resp.status_code == 404
        # And the credential is still there.
        assert get_passkey_by_credential_id(db_conn, cid) is not None

    def test_rename_updates_name(self, client, browser_id, db_conn):
        user_id = _create_user(db_conn)
        cid = _insert_credential(db_conn, user_id, name="Original")
        token = _issue_session_for(user_id, browser_id)
        resp = client.patch(
            f"/api/auth/passkeys/{cid}",
            json={"name": "Updated"},
            headers=_bearer_headers(browser_id, token),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated"

    def test_rename_404_for_unknown_credential(
        self, client, browser_id, db_conn
    ):
        user_id = _create_user(db_conn)
        token = _issue_session_for(user_id, browser_id)
        resp = client.patch(
            "/api/auth/passkeys/nonexistent",
            json={"name": "Whatever"},
            headers=_bearer_headers(browser_id, token),
        )
        assert resp.status_code == 404
