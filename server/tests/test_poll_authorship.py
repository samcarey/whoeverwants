"""Identity-based poll authorship (migrations 122 + 123).

Every poll records a `creator_user_id`:
  * signed-in creator → their session user_id,
  * anonymous creator → a lightweight account auto-minted at create time
    (from the required creator name) and bound to the creating browser_id
    via `user_browsers`.

Migration 123 retired the per-browser `creator_secret` entirely. A poll
mutation (close / reopen / cutoff) is authorized iff the caller's resolved
user_id — bearer session, else the account linked to their browser_id —
matches the poll's `creator_user_id`. Cross-device works for signed-in
creators (every linked browser resolves to the same account); the anonymous
creator's creating browser keeps authority via the auto-minted account.

The per-response `viewer_is_creator` flag mirrors that gate.

Authorization is the shared `_authorize_poll` helper, so close + reopen
exercise the same gate every poll mutation uses.

Mirrors test_group_privacy.py's signed-in helpers (real magic-link verify).
"""

import uuid

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL


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
                VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')
                """,
                (hash_token(token), normalize_email(email), browser_id),
            )
        conn.commit()
    return token


def _sign_in(client, browser_id, email=None):
    """Full magic-link verify → (session_token, user_id)."""
    email = email or f"authorship-{uuid.uuid4().hex[:8]}@example.com"
    token = _issue_known_magic_link(email, browser_id)
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["session_token"], body["user"]["user_id"]


def _create_poll(client, browser_id, token=None, **kwargs):
    payload = {
        "creator_name": "Authorship Tester",
        "questions": [{"question_type": "yes_no", "category": "yes_no"}],
    }
    payload.update(kwargs)
    resp = client.post(
        "/api/polls", json=payload, headers=_bearer_headers(browser_id, token)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# creator_user_id is recorded at create time + surfaced on the response
# ---------------------------------------------------------------------------


class TestCreatorUserIdRecording:
    def test_signed_in_create_records_creator_user_id(self, client):
        bid = str(uuid.uuid4())
        token, user_id = _sign_in(client, bid)
        poll = _create_poll(client, bid, token)
        assert poll["creator_user_id"] == user_id

    def test_anonymous_create_records_a_creator_user_id(self, client):
        """Migration 123: anonymous creators get a lightweight auto-minted
        account, so creator_user_id is NON-null even with no sign-in."""
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        assert poll["creator_user_id"] is not None

    def test_anonymous_creates_reuse_one_account_per_browser(self, client):
        """A second create from the same browser reuses the auto-account
        rather than minting a fresh one each time."""
        bid = str(uuid.uuid4())
        poll1 = _create_poll(client, bid)
        poll2 = _create_poll(client, bid)
        assert poll1["creator_user_id"] == poll2["creator_user_id"]

    def test_creator_user_id_survives_readback(self, client):
        bid = str(uuid.uuid4())
        token, user_id = _sign_in(client, bid)
        poll = _create_poll(client, bid, token)
        resp = client.get(
            f"/api/polls/by-id/{poll['id']}",
            headers=_bearer_headers(bid, token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["creator_user_id"] == user_id


# ---------------------------------------------------------------------------
# viewer_is_creator reflects the per-caller gate
# ---------------------------------------------------------------------------


class TestViewerIsCreator:
    def test_create_response_marks_viewer_creator(self, client):
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        assert poll["viewer_is_creator"] is True

    def test_anon_creator_browser_reads_true(self, client):
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        resp = client.get(
            f"/api/polls/by-id/{poll['id']}", headers=_bid_headers(bid)
        )
        assert resp.json()["viewer_is_creator"] is True

    def test_stranger_browser_reads_false(self, client):
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        resp = client.get(
            f"/api/polls/by-id/{poll['id']}",
            headers=_bid_headers(str(uuid.uuid4())),
        )
        assert resp.json()["viewer_is_creator"] is False

    def test_signed_in_creator_reads_true_cross_device(self, client):
        bid_a = str(uuid.uuid4())
        token, _ = _sign_in(client, bid_a)
        poll = _create_poll(client, bid_a, token)
        # Same account, a different browser → still the creator.
        resp = client.get(
            f"/api/polls/by-id/{poll['id']}",
            headers=_bearer_headers(str(uuid.uuid4()), token),
        )
        assert resp.json()["viewer_is_creator"] is True


# ---------------------------------------------------------------------------
# Signed-in creator authorizes mutations cross-device
# ---------------------------------------------------------------------------


class TestAccountCreatorCrossDevice:
    def test_close_from_other_device(self, client):
        """Creator signs in on browser A, creates the poll. On browser B
        (different browser_id, same account token) the session authorizes
        the close."""
        bid_a = str(uuid.uuid4())
        token, _ = _sign_in(client, bid_a)
        poll = _create_poll(client, bid_a, token)

        bid_b = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bearer_headers(bid_b, token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_closed"] is True

    def test_reopen_from_other_device(self, client):
        bid_a = str(uuid.uuid4())
        token, _ = _sign_in(client, bid_a)
        poll = _create_poll(client, bid_a, token)
        client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bearer_headers(bid_a, token),
        )
        bid_b = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{poll['id']}/reopen",
            json={},
            headers=_bearer_headers(bid_b, token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_closed"] is False


# ---------------------------------------------------------------------------
# Anonymous creator authorizes from their creating browser
# ---------------------------------------------------------------------------


class TestAnonymousCreatorBrowser:
    def test_creating_browser_closes(self, client):
        """No sign-in: the anonymous creator's own browser authorizes via the
        account auto-linked to its browser_id."""
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bid_headers(bid),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_closed"] is True

    def test_different_anonymous_browser_cannot_close(self, client):
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bid_headers(str(uuid.uuid4())),
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Non-creators are rejected
# ---------------------------------------------------------------------------


class TestNonCreatorRejected:
    def test_other_signed_in_user_cannot_close(self, client):
        creator_bid = str(uuid.uuid4())
        creator_token, _ = _sign_in(client, creator_bid)
        poll = _create_poll(client, creator_bid, creator_token)

        stranger_bid = str(uuid.uuid4())
        stranger_token, _ = _sign_in(client, stranger_bid)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bearer_headers(stranger_bid, stranger_token),
        )
        assert resp.status_code == 403, resp.text

    def test_fully_anonymous_stranger_cannot_close(self, client):
        creator_bid = str(uuid.uuid4())
        token, _ = _sign_in(client, creator_bid)
        poll = _create_poll(client, creator_bid, token)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bid_headers(str(uuid.uuid4())),
        )
        assert resp.status_code == 403, resp.text
