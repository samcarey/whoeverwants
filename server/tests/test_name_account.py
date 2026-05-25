"""Name-only account creation + recovery-reminder flag + OAuth identity
linking (the "provide a name to create an account" flow + the home-page
"add a recovery method" nudge).

Covers:
  * POST /api/auth/account/name
      anonymous + valid name → 200, session issued, providers == [],
        name set, recovery_reminder_dismissed == False; the session
        token resolves via /me.
      invalid name (empty / control chars / too long) → 400/422.
      signed-in (passkey-only) → names the EXISTING account (no new
        user minted; providers unchanged, name updated).
  * POST /api/auth/me/recovery-reminder
      anonymous → 401; signed-in → flips the flag both ways.
  * OAuth linking — a signed-in name-only account that does Google
      sign-in LINKS Google to the current account (providers gains
      'google', user_id unchanged) instead of switching accounts;
      a Google identity already owned by another user → 409.
"""

from __future__ import annotations

import os
import time
import uuid

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ.setdefault(
    "GOOGLE_OAUTH_CLIENT_IDS", "test-google-client-id.apps.googleusercontent.com"
)

import services.oauth as oauth_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from services.auth import generate_token, hash_token  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def browser_id():
    return str(uuid.uuid4())


def _bid(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer(bid, token):
    h = _bid(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _create_passkey_only_user(browser_id):
    """A users row + passkey identity + session — the state anonymous
    passkey registration leaves an account in."""
    token = generate_token()
    cred_id = f"cred-{uuid.uuid4().hex}"
    with psycopg.connect(TEST_DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO users DEFAULT VALUES RETURNING id")
            user_id = str(cur.fetchone()[0])
            cur.execute(
                "INSERT INTO user_identities (provider, provider_user_id, user_id, email) "
                "VALUES ('passkey', %s, %s::uuid, NULL)",
                (cred_id, user_id),
            )
            cur.execute(
                "INSERT INTO user_browsers (browser_id, user_id) VALUES (%s::uuid, %s::uuid) "
                "ON CONFLICT (browser_id) DO NOTHING",
                (browser_id, user_id),
            )
            cur.execute(
                "INSERT INTO sessions (token_hash, user_id, browser_id, expires_at, last_used_at) "
                "VALUES (%s, %s::uuid, %s::uuid, NOW() + INTERVAL '30 days', NOW())",
                (hash_token(token), user_id, browser_id),
            )
        conn.commit()
    return token, user_id


# --------------------------------------------------------------- account/name


def test_create_name_account_anonymous(client, browser_id):
    resp = client.post(
        "/api/auth/account/name",
        json={"name": "Alice Tester"},
        headers=_bid(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["session_token"]) >= 16
    user = body["user"]
    assert user["name"] == "Alice Tester"
    assert user["providers"] == []
    assert user["recovery_reminder_dismissed"] is False

    # The issued token resolves via /me to the same recovery-less account.
    me = client.get(
        "/api/auth/me", headers=_bearer(browser_id, body["session_token"])
    )
    assert me.status_code == 200, me.text
    assert me.json()["user_id"] == user["user_id"]
    assert me.json()["providers"] == []


def test_create_name_account_trims_and_validates(client, browser_id):
    resp = client.post(
        "/api/auth/account/name",
        json={"name": "  Bob  "},
        headers=_bid(browser_id),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["name"] == "Bob"


@pytest.mark.parametrize("bad", ["", "   ", "x\x00y", "n" * 51])
def test_create_name_account_rejects_bad_names(client, browser_id, bad):
    resp = client.post(
        "/api/auth/account/name", json={"name": bad}, headers=_bid(browser_id)
    )
    assert resp.status_code in (400, 422), resp.text


def test_create_name_account_signed_in_names_existing(client, browser_id):
    """A signed-in (passkey-only) account that hits this endpoint sets
    its name rather than minting a second user."""
    token, user_id = _create_passkey_only_user(browser_id)
    resp = client.post(
        "/api/auth/account/name",
        json={"name": "Renamed"},
        headers=_bearer(browser_id, token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["user_id"] == user_id  # same account
    assert body["user"]["name"] == "Renamed"
    assert body["user"]["providers"] == ["passkey"]  # identity untouched


# ------------------------------------------------------------ recovery-reminder


def test_recovery_reminder_requires_signin(client, browser_id):
    resp = client.post(
        "/api/auth/me/recovery-reminder",
        json={"dismissed": True},
        headers=_bid(browser_id),
    )
    assert resp.status_code == 401


def test_recovery_reminder_toggles(client, browser_id):
    create = client.post(
        "/api/auth/account/name",
        json={"name": "Carol"},
        headers=_bid(browser_id),
    )
    token = create.json()["session_token"]

    dismissed = client.post(
        "/api/auth/me/recovery-reminder",
        json={"dismissed": True},
        headers=_bearer(browser_id, token),
    )
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json()["recovery_reminder_dismissed"] is True

    restored = client.post(
        "/api/auth/me/recovery-reminder",
        json={"dismissed": False},
        headers=_bearer(browser_id, token),
    )
    assert restored.status_code == 200
    assert restored.json()["recovery_reminder_dismissed"] is False


# ------------------------------------------------------------- OAuth linking


@pytest.fixture
def google_keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@pytest.fixture(autouse=True)
def patch_google_jwks(monkeypatch, google_keypair):
    _, pub = google_keypair

    class _FakeKey:
        def __init__(self, k):
            self.key = k

    class _FakeClient:
        def get_signing_key_from_jwt(self, _t):
            return _FakeKey(pub)

    monkeypatch.setattr(oauth_module, "_google_jwks_client", lambda: _FakeClient())
    monkeypatch.setattr(
        oauth_module,
        "_GOOGLE_AUDIENCES",
        ("test-google-client-id.apps.googleusercontent.com",),
    )


def _sign_google(private_key, *, sub, email=None):
    if email is None:
        email = f"g-{uuid.uuid4().hex[:10]}@example.com"
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": "test-google-client-id.apps.googleusercontent.com",
            "sub": sub,
            "email": email,
            "email_verified": True,
            "iat": now,
            "exp": now + 600,
        },
        private_key,
        algorithm="RS256",
    )


def test_oauth_links_to_signed_in_name_account(client, browser_id, google_keypair):
    private, _ = google_keypair
    # Name-only account.
    create = client.post(
        "/api/auth/account/name", json={"name": "Dave"}, headers=_bid(browser_id)
    )
    token = create.json()["session_token"]
    user_id = create.json()["user"]["user_id"]

    # Sign in with Google WHILE signed in → link, not switch.
    g = client.post(
        "/api/auth/oauth/google",
        json={"id_token": _sign_google(private, sub=f"sub-{uuid.uuid4().hex}")},
        headers=_bearer(browser_id, token),
    )
    assert g.status_code == 200, g.text
    body = g.json()
    assert body["user"]["user_id"] == user_id  # same account
    assert "google" in body["user"]["providers"]
    assert body["user"]["name"] == "Dave"  # name preserved


def test_oauth_link_conflict_when_identity_owned_elsewhere(
    client, browser_id, google_keypair
):
    private, _ = google_keypair
    sub = f"sub-{uuid.uuid4().hex}"

    # Another browser signs in with this Google sub anonymously → owns it.
    other_bid = str(uuid.uuid4())
    first = client.post(
        "/api/auth/oauth/google",
        json={"id_token": _sign_google(private, sub=sub, email="owner@example.com")},
        headers=_bid(other_bid),
    )
    assert first.status_code == 200, first.text

    # A different name-only account tries to link the SAME sub → 409.
    create = client.post(
        "/api/auth/account/name", json={"name": "Eve"}, headers=_bid(browser_id)
    )
    token = create.json()["session_token"]
    conflict = client.post(
        "/api/auth/oauth/google",
        json={"id_token": _sign_google(private, sub=sub, email="owner@example.com")},
        headers=_bearer(browser_id, token),
    )
    assert conflict.status_code == 409, conflict.text
