"""Phase I — claim an anonymous-created / grandfathered group.

Covers `POST /api/groups/{route_id}/claim`:
  * 401 anonymous caller.
  * 404 unresolvable route.
  * 403 signed-in non-member.
  * 200 signed-in member of a NULL-creator group → claim succeeds,
    response carries the new creator_user_id, DB row reflects the
    write, privacy state is unchanged.
  * 409 second-claim attempt (same caller OR a different signed-in
    member) — the atomic UPDATE prevents takeover after the first
    claim lands.
  * Post-claim, the privacy endpoint accepts a flip from the new
    creator (proves the claim actually unlocks creator-only
    authorization downstream).

Reuses the magic-link sign-in helper + direct-DB privacy seeder from
`test_group_privacy.py`'s pattern.
"""

import uuid

import psycopg
import pytest

from services.auth import (
    generate_token,
    hash_token,
    normalize_email,
)
from tests.conftest import TEST_DB_URL


@pytest.fixture
def creator_browser():
    return str(uuid.uuid4())


@pytest.fixture
def stranger_browser():
    return str(uuid.uuid4())


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
                INSERT INTO magic_link_tokens
                  (token_hash, email, browser_id, expires_at)
                VALUES
                  (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id),
            )
        conn.commit()
    return token


def _sign_in(client, browser_id, email=None):
    email = email or f"phaseI-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_known_magic_link(email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def _create_anonymous_group(client, browser_id):
    """Create a fresh group via the anonymous (no-bearer) path.
    Result: privacy='public', creator_user_id=NULL — exactly the
    'grandfathered / anonymous-created' shape claim is for.
    """
    resp = client.post(
        "/api/groups",
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _read_group_row(group_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        row = conn.execute(
            "SELECT privacy, creator_user_id FROM groups WHERE id = %s",
            (group_id,),
        ).fetchone()
    if not row:
        return None
    privacy, creator_user_id = row
    return {
        "privacy": privacy,
        "creator_user_id": str(creator_user_id) if creator_user_id else None,
    }


def test_claim_requires_sign_in(client, creator_browser):
    group = _create_anonymous_group(client, creator_browser)
    resp = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bid_headers(creator_browser),
    )
    assert resp.status_code == 401


def test_claim_404_on_unknown_route(client, creator_browser):
    _, _ = _sign_in(client, creator_browser)
    # Look-alike uuid that doesn't exist
    fake = "00000000-0000-0000-0000-000000000001"
    token, _ = _sign_in(client, creator_browser, email="claim404@example.com")
    resp = client.post(
        f"/api/groups/{fake}/claim",
        headers=_bearer_headers(creator_browser, token),
    )
    assert resp.status_code == 404


def test_claim_403_when_not_a_member(
    client, creator_browser, stranger_browser
):
    """A signed-in user who has never visited the group can't claim
    it — the membership gate is the only proof-of-relevance we have."""
    group = _create_anonymous_group(client, creator_browser)
    token, _ = _sign_in(client, stranger_browser, email="stranger@example.com")
    resp = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(stranger_browser, token),
    )
    assert resp.status_code == 403


def test_claim_succeeds_for_signed_in_member(client, creator_browser):
    group = _create_anonymous_group(client, creator_browser)
    # Anonymous-create wrote the member row keyed on creator_browser.
    # Sign in on the SAME browser so user_browsers links the session's
    # user_id to that browser → the member walk finds the row.
    token, user_id = _sign_in(client, creator_browser)
    resp = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(creator_browser, token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["group_id"] == group["id"]
    assert body["creator_user_id"] == user_id
    # Privacy state is preserved — claim doesn't auto-flip to private.
    assert body["privacy"] == "public"
    # DB write committed:
    db = _read_group_row(group["id"])
    assert db["creator_user_id"] == user_id
    assert db["privacy"] == "public"


def test_claim_409_when_already_claimed_by_same_user(
    client, creator_browser
):
    group = _create_anonymous_group(client, creator_browser)
    token, _ = _sign_in(client, creator_browser)
    first = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(creator_browser, token),
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(creator_browser, token),
    )
    assert second.status_code == 409


def test_claim_409_when_already_claimed_by_someone_else(
    client, creator_browser, stranger_browser
):
    """Once claimed, the row is no longer NULL → no other member can
    re-claim. Even if the second signed-in user has membership, the
    atomic UPDATE WHERE creator_user_id IS NULL bounces them with 409."""
    group = _create_anonymous_group(client, creator_browser)
    first_token, first_user_id = _sign_in(client, creator_browser)
    resp = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(creator_browser, first_token),
    )
    assert resp.status_code == 200

    # Second user joins via the read endpoint (auto-join writes a
    # group_members row for their browser on the public group), then
    # signs in and tries to claim.
    second_user_browser = str(uuid.uuid4())
    join = client.get(
        f"/api/groups/by-route-id/{group['id']}",
        headers=_bid_headers(second_user_browser),
    )
    assert join.status_code == 200
    second_token, _ = _sign_in(
        client, second_user_browser, email="second@example.com"
    )
    resp = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(second_user_browser, second_token),
    )
    assert resp.status_code == 409
    # DB still reflects the FIRST user as creator — no takeover.
    db = _read_group_row(group["id"])
    assert db["creator_user_id"] == first_user_id


def test_claim_unlocks_privacy_toggle(client, creator_browser):
    """Smoke test that claiming actually unlocks downstream
    creator-only authorization. Before claim, privacy flip 403s
    (the legacy 'no recorded creator' branch). After claim, the
    same caller's flip succeeds."""
    group = _create_anonymous_group(client, creator_browser)
    token, _ = _sign_in(client, creator_browser)
    # Pre-claim flip is rejected — the group has no recorded creator.
    pre = client.post(
        f"/api/groups/{group['id']}/privacy",
        json={"privacy": "private"},
        headers=_bearer_headers(creator_browser, token),
    )
    assert pre.status_code == 403
    # Claim, then re-attempt the flip.
    claim = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(creator_browser, token),
    )
    assert claim.status_code == 200
    post = client.post(
        f"/api/groups/{group['id']}/privacy",
        json={"privacy": "private"},
        headers=_bearer_headers(creator_browser, token),
    )
    assert post.status_code == 200, post.text
    assert post.json()["privacy"] == "private"
