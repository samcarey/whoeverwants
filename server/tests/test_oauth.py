"""Phase C: tests for the Apple / Google OAuth verify endpoints.

Strategy: we can't call Google / Apple from CI, so the tests monkey-patch
`services.oauth._google_jwks_client` / `_apple_jwks_client` to return a
client whose JWKS contains a key pair we generate locally. Tests then
issue tokens signed by our local private key — those pass signature
verification, and we vary the claims (audience, issuer, expiry,
email_verified) to drive every branch of the verifier.

This keeps `services/oauth.py` faithfully exercised — the actual JWT
decode + audience/issuer/expiry checks all run.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL


def _ensure_provider_config():
    """Set env vars + reload the oauth module so module-level constants
    pick them up. Tests rely on these being set BEFORE the module is
    imported anywhere."""
    os.environ.setdefault(
        "GOOGLE_OAUTH_CLIENT_IDS",
        "test-google-client-id.apps.googleusercontent.com",
    )
    os.environ.setdefault(
        "APPLE_OAUTH_AUDIENCES",
        "com.whoeverwants.app,com.whoeverwants.web",
    )


_ensure_provider_config()

# Importing this BEFORE app/main forces the module-level audience tuples
# in services.oauth to capture our test env vars rather than empty
# defaults. importlib.reload would also work but this is simpler.
import services.oauth as oauth_module  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Local signing key + fake JWKS client
# ---------------------------------------------------------------------------


class _FakeSigningKey:
    """Mimics PyJWK.SigningKey enough for `signing_key.key` access in
    services.oauth._verify."""

    def __init__(self, public_key):
        self.key = public_key


class _FakeJWKSClient:
    """Stand-in for PyJWKClient: any get_signing_key_from_jwt call
    returns the single key we were constructed with. The verifier
    doesn't actually care about `kid` matching — it just needs a public
    key it can verify the signature against."""

    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, _id_token):
        return _FakeSigningKey(self._public_key)


@pytest.fixture(scope="module")
def google_keypair():
    """RS256 keypair for signing fake Google tokens."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private.public_key()
    return private, public


@pytest.fixture(scope="module")
def apple_keypair():
    """ES256 keypair (P-256 curve) for signing fake Apple tokens."""
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key()
    return private, public


@pytest.fixture(autouse=True)
def patch_jwks(monkeypatch, google_keypair, apple_keypair):
    """Swap the real PyJWKClient instances for our local fakes for every
    test in this module. The verifier still does a real JWT decode +
    claim check; only the JWKS fetch is short-circuited."""
    _, google_pub = google_keypair
    _, apple_pub = apple_keypair
    monkeypatch.setattr(
        oauth_module,
        "_google_jwks_client",
        lambda: _FakeJWKSClient(google_pub),
    )
    monkeypatch.setattr(
        oauth_module,
        "_apple_jwks_client",
        lambda: _FakeJWKSClient(apple_pub),
    )
    # Override the module-level audience tuples in case other tests
    # imported the module before _ensure_provider_config ran.
    monkeypatch.setattr(
        oauth_module,
        "_GOOGLE_AUDIENCES",
        ("test-google-client-id.apps.googleusercontent.com",),
    )
    monkeypatch.setattr(
        oauth_module,
        "_APPLE_AUDIENCES",
        ("com.whoeverwants.app", "com.whoeverwants.web"),
    )


def _sign_google(
    private_key,
    *,
    sub: str = "google-sub-12345",
    audience: str = "test-google-client-id.apps.googleusercontent.com",
    issuer: str = "https://accounts.google.com",
    email: str | None = "user@example.com",
    email_verified=True,
    expires_in_seconds: int = 600,
) -> str:
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": sub,
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    if email is not None:
        payload["email"] = email
        payload["email_verified"] = email_verified
    return jwt.encode(payload, private_key, algorithm="RS256")


def _sign_apple(
    private_key,
    *,
    sub: str = "apple-sub-67890",
    audience: str = "com.whoeverwants.app",
    issuer: str = "https://appleid.apple.com",
    email: str | None = "user@privaterelay.appleid.com",
    email_verified="true",
    expires_in_seconds: int = 600,
) -> str:
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": sub,
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    if email is not None:
        payload["email"] = email
        payload["email_verified"] = email_verified
    return jwt.encode(payload, private_key, algorithm="ES256")


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def browser_id():
    return str(uuid.uuid4())


def _bid_headers(bid: str | None) -> dict:
    return {"X-Browser-Id": bid} if bid else {}


# ---------------------------------------------------------------------------
# Pure verifier tests (services.oauth)
# ---------------------------------------------------------------------------


class TestGoogleVerifier:
    def test_valid_token_returns_identity(self, google_keypair):
        private, _ = google_keypair
        token = _sign_google(private)
        identity = oauth_module.verify_google_id_token(token)
        assert identity.provider == "google"
        assert identity.provider_user_id == "google-sub-12345"
        assert identity.email == "user@example.com"
        assert identity.email_verified is True

    def test_unverified_email_returns_none_email(self, google_keypair):
        private, _ = google_keypair
        token = _sign_google(private, email_verified=False)
        identity = oauth_module.verify_google_id_token(token)
        # Identity is still valid (sub is trusted), but email isn't
        # surfaced as the merge key.
        assert identity.provider_user_id == "google-sub-12345"
        assert identity.email is None
        assert identity.email_verified is False

    def test_wrong_audience_rejected(self, google_keypair):
        private, _ = google_keypair
        token = _sign_google(private, audience="some-other-client-id")
        with pytest.raises(oauth_module.OAuthVerificationError):
            oauth_module.verify_google_id_token(token)

    def test_wrong_issuer_rejected(self, google_keypair):
        private, _ = google_keypair
        token = _sign_google(private, issuer="https://attacker.example.com")
        with pytest.raises(oauth_module.OAuthVerificationError):
            oauth_module.verify_google_id_token(token)

    def test_expired_token_rejected(self, google_keypair):
        private, _ = google_keypair
        token = _sign_google(private, expires_in_seconds=-60)
        with pytest.raises(oauth_module.OAuthVerificationError):
            oauth_module.verify_google_id_token(token)

    def test_malformed_token_rejected(self):
        with pytest.raises(oauth_module.OAuthVerificationError):
            oauth_module.verify_google_id_token("not-a-real-token")


class TestAppleVerifier:
    def test_valid_token_returns_identity(self, apple_keypair):
        private, _ = apple_keypair
        token = _sign_apple(private)
        identity = oauth_module.verify_apple_id_token(token)
        assert identity.provider == "apple"
        assert identity.provider_user_id == "apple-sub-67890"
        assert identity.email == "user@privaterelay.appleid.com"
        assert identity.email_verified is True

    def test_accepts_string_true_email_verified(self, apple_keypair):
        private, _ = apple_keypair
        token = _sign_apple(private, email_verified="true")
        identity = oauth_module.verify_apple_id_token(token)
        assert identity.email_verified is True
        assert identity.email == "user@privaterelay.appleid.com"

    def test_accepts_alternate_audience(self, apple_keypair):
        private, _ = apple_keypair
        # Web Service ID is the second audience in our test config.
        token = _sign_apple(private, audience="com.whoeverwants.web")
        identity = oauth_module.verify_apple_id_token(token)
        assert identity.provider_user_id == "apple-sub-67890"

    def test_rejects_unknown_audience(self, apple_keypair):
        private, _ = apple_keypair
        token = _sign_apple(private, audience="com.attacker.app")
        with pytest.raises(oauth_module.OAuthVerificationError):
            oauth_module.verify_apple_id_token(token)

    def test_repeat_sign_in_without_email(self, apple_keypair):
        """Apple omits email on every sign-in after the first. The
        verifier accepts that and surfaces None for email."""
        private, _ = apple_keypair
        token = _sign_apple(private, email=None)
        identity = oauth_module.verify_apple_id_token(token)
        assert identity.email is None
        assert identity.provider_user_id == "apple-sub-67890"


# ---------------------------------------------------------------------------
# Endpoint tests (POST /api/auth/oauth/{google,apple})
# ---------------------------------------------------------------------------


def _delete_user_for_sub(provider: str, sub: str) -> None:
    """Clean up so the same sub across tests doesn't accumulate."""
    import psycopg

    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM users WHERE id IN ("
                "  SELECT user_id FROM user_identities "
                "  WHERE provider = %s AND provider_user_id = %s"
                ")",
                (provider, sub),
            )
        conn.commit()


class TestGoogleOAuthEndpoint:
    def test_valid_token_issues_session(
        self, client, browser_id, google_keypair
    ):
        private, _ = google_keypair
        sub = f"google-sub-{uuid.uuid4().hex[:12]}"
        email = f"goog-{uuid.uuid4().hex[:8]}@example.com"
        token = _sign_google(private, sub=sub, email=email)
        try:
            resp = client.post(
                "/api/auth/oauth/google",
                json={"id_token": token},
                headers=_bid_headers(browser_id),
            )
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body["session_token"]
            assert body["user"]["email"] == email.lower()
            assert "google" in body["user"]["providers"]
        finally:
            _delete_user_for_sub("google", sub)

    def test_invalid_token_400(self, client, browser_id):
        resp = client.post(
            "/api/auth/oauth/google",
            json={"id_token": "x" * 200},  # passes Pydantic, fails decode
            headers=_bid_headers(browser_id),
        )
        assert resp.status_code == 400

    def test_repeat_sign_in_same_user(self, client, browser_id, google_keypair):
        private, _ = google_keypair
        sub = f"google-sub-{uuid.uuid4().hex[:12]}"
        email = f"reuse-{uuid.uuid4().hex[:8]}@example.com"
        try:
            r1 = client.post(
                "/api/auth/oauth/google",
                json={"id_token": _sign_google(private, sub=sub, email=email)},
                headers=_bid_headers(browser_id),
            )
            r2 = client.post(
                "/api/auth/oauth/google",
                json={"id_token": _sign_google(private, sub=sub, email=email)},
                headers=_bid_headers(browser_id),
            )
            assert r1.status_code == 200 and r2.status_code == 200
            assert r1.json()["user"]["user_id"] == r2.json()["user"]["user_id"]
        finally:
            _delete_user_for_sub("google", sub)


class TestAppleOAuthEndpoint:
    def test_valid_token_issues_session(self, client, browser_id, apple_keypair):
        private, _ = apple_keypair
        sub = f"apple-sub-{uuid.uuid4().hex[:12]}"
        email = f"apple-{uuid.uuid4().hex[:8]}@example.com"
        token = _sign_apple(private, sub=sub, email=email)
        try:
            resp = client.post(
                "/api/auth/oauth/apple",
                json={"id_token": token},
                headers=_bid_headers(browser_id),
            )
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert "apple" in body["user"]["providers"]
        finally:
            _delete_user_for_sub("apple", sub)

    def test_repeat_sign_in_without_email_resolves_to_same_user(
        self, client, browser_id, apple_keypair
    ):
        """Apple omits email after the first sign-in. The repeat call
        should still resolve to the same user via the (provider, sub)
        lookup."""
        private, _ = apple_keypair
        sub = f"apple-sub-{uuid.uuid4().hex[:12]}"
        email = f"first-{uuid.uuid4().hex[:8]}@example.com"
        try:
            r1 = client.post(
                "/api/auth/oauth/apple",
                json={"id_token": _sign_apple(private, sub=sub, email=email)},
                headers=_bid_headers(browser_id),
            )
            r2 = client.post(
                "/api/auth/oauth/apple",
                json={"id_token": _sign_apple(private, sub=sub, email=None)},
                headers=_bid_headers(browser_id),
            )
            assert r1.status_code == 200 and r2.status_code == 200
            assert r1.json()["user"]["user_id"] == r2.json()["user"]["user_id"]
        finally:
            _delete_user_for_sub("apple", sub)


# ---------------------------------------------------------------------------
# Cross-provider merge (account linking on shared verified email)
# ---------------------------------------------------------------------------


class TestCrossProviderMerge:
    def test_email_signin_then_google_signin_same_email_merges(
        self, client, browser_id, google_keypair
    ):
        """A user who first signed in with magic link, then later signs
        in with Google using the same verified email, should land on the
        same user_id (one row in `users`, two rows in `user_identities`).
        """
        from services.auth import generate_token, hash_token, normalize_email
        import psycopg

        email = f"merge-{uuid.uuid4().hex[:8]}@example.com"
        sub = f"google-sub-{uuid.uuid4().hex[:12]}"

        # Step 1: magic-link sign-in.
        ml_token = generate_token()
        with psycopg.connect(TEST_DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO magic_link_tokens
                      (token_hash, email, browser_id, expires_at)
                    VALUES
                      (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                    """,
                    (hash_token(ml_token), normalize_email(email), browser_id),
                )
            conn.commit()

        try:
            r1 = client.post(
                "/api/auth/magic-link/verify",
                json={"token": ml_token},
                headers=_bid_headers(browser_id),
            )
            assert r1.status_code == 200
            email_user_id = r1.json()["user"]["user_id"]

            # Step 2: Google sign-in with the SAME verified email.
            private, _ = google_keypair
            google_token = _sign_google(private, sub=sub, email=email)
            r2 = client.post(
                "/api/auth/oauth/google",
                json={"id_token": google_token},
                headers=_bid_headers(browser_id),
            )
            assert r2.status_code == 200
            assert r2.json()["user"]["user_id"] == email_user_id
            assert set(r2.json()["user"]["providers"]) == {"email", "google"}
        finally:
            _delete_user_for_sub("google", sub)
            with psycopg.connect(TEST_DB_URL) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM users WHERE id IN ("
                        "  SELECT user_id FROM user_identities WHERE email = %s"
                        ")",
                        (normalize_email(email),),
                    )
                conn.commit()


# ---------------------------------------------------------------------------
# Providers endpoint
# ---------------------------------------------------------------------------


class TestProvidersEndpoint:
    def test_reports_configured_providers(self, client):
        resp = client.get("/api/auth/providers")
        assert resp.status_code == 200
        body = resp.json()
        # In the test env both Google and Apple are configured via the
        # module-level monkeypatch in `patch_jwks`.
        assert body["email"] is True
        assert body["google"] is True
        assert body["apple"] is True


# ---------------------------------------------------------------------------
# 503 when provider is unconfigured
# ---------------------------------------------------------------------------


class TestUnconfiguredProvider:
    def test_google_503_when_unconfigured(self, client, monkeypatch):
        monkeypatch.setattr(oauth_module, "_GOOGLE_AUDIENCES", ())
        resp = client.post(
            "/api/auth/oauth/google",
            json={"id_token": "x" * 200},
        )
        assert resp.status_code == 503

    def test_apple_503_when_unconfigured(self, client, monkeypatch):
        monkeypatch.setattr(oauth_module, "_APPLE_AUDIENCES", ())
        resp = client.post(
            "/api/auth/oauth/apple",
            json={"id_token": "x" * 200},
        )
        assert resp.status_code == 503
