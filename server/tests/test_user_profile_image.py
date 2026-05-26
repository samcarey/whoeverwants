"""Account-keyed profile photo (migration 124).

The profile image moved from per-browser (`user_profiles.browser_id`) to
per-account (`user_profiles.user_id`): it follows the user across devices and
clears on sign-out. Uploading requires an account — when the caller has none,
the upload mints a lightweight one from the supplied name (mirrors poll
creation). Reads/deletes never mint.
"""

import uuid

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL

# 1x1 transparent PNG.
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _bid_headers(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer_headers(bid, token):
    h = _bid_headers(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _sign_in(client, browser_id, email=None):
    """Full magic-link verify → (session_token, user_id)."""
    email = email or f"photo-{uuid.uuid4().hex[:8]}@example.com"
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
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def _upload(client, headers, name=None):
    body = {"image_base64": PNG_B64, "mime_type": "image/png"}
    if name is not None:
        body["creator_name"] = name
    return client.post("/api/users/me/image", json=body, headers=headers)


class TestAnonymousUpload:
    def test_upload_without_account_or_name_400s(self, client):
        bid = str(uuid.uuid4())
        resp = _upload(client, _bid_headers(bid))  # no name, no account
        assert resp.status_code == 400, resp.text

    def test_upload_with_name_mints_account_and_keys_photo(self, client):
        bid = str(uuid.uuid4())
        resp = _upload(client, _bid_headers(bid), name="Alice")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        user_id = body["user_id"]
        assert user_id, "expected a minted account user_id"
        assert body["image_updated_at"]
        # The browser is now linked to the minted account.
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT user_id FROM user_browsers WHERE browser_id = %s", (bid,)
            ).fetchone()
        assert row and str(row[0]) == user_id
        # Image is served at the account URL.
        img = client.get(f"/api/users/by-user-id/{user_id}/image")
        assert img.status_code == 200
        assert img.headers["content-type"] == "image/png"

    def test_profile_read_never_mints(self, client):
        bid = str(uuid.uuid4())
        resp = client.get("/api/users/me/profile", headers=_bid_headers(bid))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["user_id"] is None
        assert body["image_updated_at"] is None
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT user_id FROM user_browsers WHERE browser_id = %s", (bid,)
            ).fetchone()
        assert row is None, "GET /me/profile must not create an account"


class TestSignedInPhoto:
    def test_upload_keys_to_session_account(self, client):
        bid = str(uuid.uuid4())
        token, user_id = _sign_in(client, bid)
        resp = _upload(client, _bearer_headers(bid, token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["user_id"] == user_id
        # /me/profile reflects it for the signed-in caller.
        prof = client.get(
            "/api/users/me/profile", headers=_bearer_headers(bid, token)
        )
        assert prof.json()["user_id"] == user_id
        assert prof.json()["image_updated_at"]

    def test_photo_follows_account_to_second_device(self, client):
        # Both devices sign in with the same email → same account.
        email = f"shared-{uuid.uuid4().hex[:8]}@example.com"
        bid_a = str(uuid.uuid4())
        token_a, user_id = _sign_in(client, bid_a, email=email)
        assert _upload(client, _bearer_headers(bid_a, token_a)).status_code == 200
        bid_b = str(uuid.uuid4())
        token_b, user_id_b = _sign_in(client, bid_b, email=email)
        assert user_id_b == user_id, "same email should resolve to the same account"
        prof_b = client.get(
            "/api/users/me/profile", headers=_bearer_headers(bid_b, token_b)
        )
        assert prof_b.json()["user_id"] == user_id
        assert prof_b.json()["image_updated_at"], "photo should follow the account"

    def test_photo_hidden_after_sign_out(self, client):
        bid = str(uuid.uuid4())
        token, user_id = _sign_in(client, bid)
        assert _upload(client, _bearer_headers(bid, token)).status_code == 200
        # Sign out unlinks the browser → caller resolves to no account.
        client.post("/api/auth/sign-out", headers=_bearer_headers(bid, token))
        prof = client.get("/api/users/me/profile", headers=_bid_headers(bid))
        assert prof.json()["user_id"] is None
        assert prof.json()["image_updated_at"] is None
        # The bytes still exist on the account (for the next sign-in), they're
        # just not resolvable anonymously.
        img = client.get(f"/api/users/by-user-id/{user_id}/image")
        assert img.status_code == 200

    def test_delete_clears_account_image(self, client):
        bid = str(uuid.uuid4())
        token, user_id = _sign_in(client, bid)
        assert _upload(client, _bearer_headers(bid, token)).status_code == 200
        resp = client.delete(
            "/api/users/me/image", headers=_bearer_headers(bid, token)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["image_updated_at"] is None
        img = client.get(f"/api/users/by-user-id/{user_id}/image")
        assert img.status_code == 404
