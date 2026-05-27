"""Dev-only instant sign-in links (demo helper).

Covers the two endpoints in server/routers/auth.py:

  * POST /api/auth/dev/instant-link
      dev origin + default body → 200; mints a recovery-less account
        (providers == []), returns a /auth/instant?token=... URL whose
        token resolves via /me to that account; echoes the linked
        browser_id.
      `next` is appended (url-encoded) when relative; an open-redirect
        target ("//evil.com", "https://x") is dropped → no `next` param.
      production origin (or no Origin) → 503 (feature is dev-only).

  * POST /api/auth/instant/adopt
      valid token on a DIFFERENT browser → 200 profile + links that
        browser to the account (user_browsers row).
      the link makes the account's browser-keyed memberships visible to
        the recipient browser (end-to-end: seed a group under the mint
        browser, see it via /groups/empty on the recipient browser).
      invalid token → 400; production origin → 503.

Gating is via the request Origin header (services/fe_origin.is_prod_origin):
tests pass `Origin: http://localhost:3000` for the dev path and
`https://whoeverwants.com` (or omit it) for the prod path.
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

DEV_ORIGIN = "http://localhost:3000"
PROD_ORIGIN = "https://whoeverwants.com"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def browser_id():
    return str(uuid.uuid4())


def _headers(bid=None, token=None, origin=DEV_ORIGIN):
    h = {}
    if bid:
        h["X-Browser-Id"] = bid
    if token:
        h["Authorization"] = f"Bearer {token}"
    if origin:
        h["Origin"] = origin
    return h


# ---------------------------------------------------------------- mint


def test_mint_returns_link_and_resolvable_token(client, browser_id):
    resp = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "Demo Sam"},
        headers=_headers(bid=browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "/auth/instant?token=" in body["url"]
    assert body["session_token"] in body["url"]
    assert len(body["session_token"]) >= 16
    assert body["name"] == "Demo Sam"
    assert body["browser_id"] == browser_id

    me = client.get(
        "/api/auth/me", headers=_headers(bid=browser_id, token=body["session_token"])
    )
    assert me.status_code == 200, me.text
    assert me.json()["user_id"] == body["user_id"]
    # Recovery-less: only the device-bound 'browser' identity (migration 128),
    # no durable sign-in method.
    assert me.json()["providers"] == ["browser"]


def test_mint_default_name(client, browser_id):
    resp = client.post(
        "/api/auth/dev/instant-link", json={}, headers=_headers(bid=browser_id)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Demo User"


def test_mint_appends_relative_next(client, browser_id):
    resp = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "X", "next": "/g/~abc?p=~def"},
        headers=_headers(bid=browser_id),
    )
    assert resp.status_code == 200, resp.text
    url = resp.json()["url"]
    assert "next=" in url
    # url-encoded so the query separators in the path don't leak into the
    # instant link's own query string.
    assert "%2Fg%2F~abc" in url


@pytest.mark.parametrize("bad_next", ["//evil.com", "https://evil.com", "evil", "\\x"])
def test_mint_drops_open_redirect_next(client, browser_id, bad_next):
    resp = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "X", "next": bad_next},
        headers=_headers(bid=browser_id),
    )
    assert resp.status_code == 200, resp.text
    assert "next=" not in resp.json()["url"]


def test_mint_503_on_prod_origin(client, browser_id):
    resp = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "X"},
        headers=_headers(bid=browser_id, origin=PROD_ORIGIN),
    )
    assert resp.status_code == 503, resp.text


def test_mint_503_when_no_origin(client, browser_id):
    # No Origin header → resolve_fe_origin falls back to prod → gated off.
    resp = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "X"},
        headers=_headers(bid=browser_id, origin=None),
    )
    assert resp.status_code == 503, resp.text


# ---------------------------------------------------------------- adopt


def test_adopt_links_recipient_browser(client):
    bid_a = str(uuid.uuid4())
    bid_b = str(uuid.uuid4())
    mint = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "Linker"},
        headers=_headers(bid=bid_a),
    )
    token = mint.json()["session_token"]
    user_id = mint.json()["user_id"]

    adopt = client.post(
        "/api/auth/instant/adopt",
        json={"token": token},
        headers=_headers(bid=bid_b),
    )
    assert adopt.status_code == 200, adopt.text
    assert adopt.json()["user_id"] == user_id

    with psycopg.connect(TEST_DB_URL) as conn:
        row = conn.execute(
            "SELECT user_id FROM user_browsers WHERE browser_id = %s::uuid",
            (bid_b,),
        ).fetchone()
    assert row is not None and str(row[0]) == user_id


def test_adopt_makes_seeded_group_visible(client):
    """End-to-end: a group seeded under the mint browser is visible to the
    recipient browser after adopt (membership union across browsers linked
    to the same account)."""
    bid_a = str(uuid.uuid4())
    bid_b = str(uuid.uuid4())
    mint = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "Seeder"},
        headers=_headers(bid=bid_a),
    )
    token = mint.json()["session_token"]

    # Seed an empty group whose membership is keyed on the MINT browser.
    with psycopg.connect(TEST_DB_URL) as conn:
        gid = conn.execute(
            "INSERT INTO groups DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) "
            "VALUES (%s::uuid, %s::uuid)",
            (str(gid), bid_a),
        )
        conn.commit()

    adopt = client.post(
        "/api/auth/instant/adopt",
        json={"token": token},
        headers=_headers(bid=bid_b),
    )
    assert adopt.status_code == 200, adopt.text

    # On the recipient browser, with the session bearer, the seeded group
    # shows up via the account → linked-browsers union.
    empty = client.post(
        "/api/groups/empty", headers=_headers(bid=bid_b, token=token)
    )
    assert empty.status_code == 200, empty.text
    assert str(gid) in {g["id"] for g in empty.json()}


def test_adopt_400_on_bad_token(client, browser_id):
    resp = client.post(
        "/api/auth/instant/adopt",
        json={"token": "not-a-real-token-aaaaaaaa"},
        headers=_headers(bid=browser_id),
    )
    assert resp.status_code == 400, resp.text


def test_adopt_503_on_prod_origin(client, browser_id):
    # Mint on a dev origin so the token is valid, then try to adopt on prod.
    mint = client.post(
        "/api/auth/dev/instant-link",
        json={"name": "X"},
        headers=_headers(bid=browser_id),
    )
    token = mint.json()["session_token"]
    resp = client.post(
        "/api/auth/instant/adopt",
        json={"token": token},
        headers=_headers(bid=str(uuid.uuid4()), origin=PROD_ORIGIN),
    )
    assert resp.status_code == 503, resp.text
