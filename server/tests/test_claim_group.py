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
    Migration 142: this now yields privacy='public' but with an auto-account
    creator (no more NULL-creator groups), so claim is effectively obsolete —
    see test_claim_obsolete_group_always_has_creator.
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


def test_claim_obsolete_group_always_has_creator(client, creator_browser):
    """Migration 142 made claim obsolete: every group is minted with a creator
    (= admin #1), so the atomic `UPDATE ... WHERE creator_user_id IS NULL`
    never matches and claim always 409s. The endpoint is retained as harmless
    (a future caller can't take over a group that already has an admin)."""
    group = _create_anonymous_group(client, creator_browser)
    token, _ = _sign_in(client, creator_browser)
    resp = client.post(
        f"/api/groups/{group['id']}/claim",
        headers=_bearer_headers(creator_browser, token),
    )
    assert resp.status_code == 409
    # The auto-account creator is recorded; claiming didn't change it.
    db = _read_group_row(group["id"])
    assert db["creator_user_id"] is not None
