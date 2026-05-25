"""Account-owned poll authorship (migration 122).

A poll created by a signed-in user records `creator_user_id`. That account
may close / reopen / cutoff the poll from ANY device it's signed in on,
authorized by its session bearer token alone — the per-browser
`creator_secret` never followed the user across browsers. The secret remains:
  * the SOLE authority for anonymous-created polls (creator_user_id NULL), and
  * a backwards-compatible fallback for the signed-in creator's own browser.

Authorization is the shared `_authorize_poll` helper, so close + reopen
exercise the same gate every poll mutation uses (cutoff endpoints included).

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


def _create_poll(client, browser_id, token=None, *, secret=None, **kwargs):
    secret = secret or f"secret-{uuid.uuid4().hex[:8]}"
    payload = {
        "creator_secret": secret,
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

    def test_anonymous_create_has_null_creator_user_id(self, client):
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)
        assert poll["creator_user_id"] is None

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
# Account creator authorizes mutations cross-device (no per-browser secret)
# ---------------------------------------------------------------------------


class TestAccountCreatorCrossDevice:
    def test_close_from_other_device_no_secret(self, client):
        """Creator signs in on browser A, creates the poll. On browser B
        (different browser_id, same account token, NO stored secret) the
        session authorizes the close."""
        bid_a = str(uuid.uuid4())
        token, _ = _sign_in(client, bid_a)
        poll = _create_poll(client, bid_a, token)

        bid_b = str(uuid.uuid4())  # a device that never saw the secret
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},  # creator_secret omitted entirely
            headers=_bearer_headers(bid_b, token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_closed"] is True

    def test_reopen_from_other_device_empty_secret(self, client):
        bid_a = str(uuid.uuid4())
        token, _ = _sign_in(client, bid_a)
        poll = _create_poll(client, bid_a, token)
        # Close it (via secret on the creating browser).
        client.post(
            f"/api/polls/{poll['id']}/close",
            json={"creator_secret": poll["creator_secret"]},
            headers=_bearer_headers(bid_a, token),
        )
        # Reopen from another browser using only the session.
        bid_b = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{poll['id']}/reopen",
            json={"creator_secret": ""},
            headers=_bearer_headers(bid_b, token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_closed"] is False


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

    def test_anonymous_cannot_close_account_poll_without_secret(self, client):
        creator_bid = str(uuid.uuid4())
        token, _ = _sign_in(client, creator_bid)
        poll = _create_poll(client, creator_bid, token)
        # No token, no secret.
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={},
            headers=_bid_headers(str(uuid.uuid4())),
        )
        assert resp.status_code == 403, resp.text

    def test_wrong_secret_no_session_rejected(self, client):
        creator_bid = str(uuid.uuid4())
        token, _ = _sign_in(client, creator_bid)
        poll = _create_poll(client, creator_bid, token)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={"creator_secret": "not-the-secret"},
            headers=_bid_headers(str(uuid.uuid4())),
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# creator_secret remains valid (backwards-compat + anonymous polls)
# ---------------------------------------------------------------------------


class TestSecretStillWorks:
    def test_creating_browser_secret_still_closes(self, client):
        """The signed-in creator's original browser keeps working via the
        secret even with no session attached (e.g. signed out)."""
        bid = str(uuid.uuid4())
        token, _ = _sign_in(client, bid)
        poll = _create_poll(client, bid, token)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={"creator_secret": poll["creator_secret"]},
            headers=_bid_headers(bid),  # no Authorization header
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_closed"] is True

    def test_anonymous_poll_requires_matching_secret(self, client):
        bid = str(uuid.uuid4())
        poll = _create_poll(client, bid)  # anonymous → creator_user_id NULL
        # Wrong secret → 403.
        bad = client.post(
            f"/api/polls/{poll['id']}/close",
            json={"creator_secret": "wrong"},
            headers=_bid_headers(bid),
        )
        assert bad.status_code == 403, bad.text
        # Correct secret → 200.
        good = client.post(
            f"/api/polls/{poll['id']}/close",
            json={"creator_secret": poll["creator_secret"]},
            headers=_bid_headers(bid),
        )
        assert good.status_code == 200, good.text
        assert good.json()["is_closed"] is True

    def test_signed_in_non_creator_with_correct_secret_still_closes(self, client):
        """The secret is authority regardless of session: someone who
        somehow has the secret (e.g. shared) can close even when their
        session doesn't match the creator. Documents the additive OR."""
        creator_bid = str(uuid.uuid4())
        creator_token, _ = _sign_in(client, creator_bid)
        poll = _create_poll(client, creator_bid, creator_token)

        other_bid = str(uuid.uuid4())
        other_token, _ = _sign_in(client, other_bid)
        resp = client.post(
            f"/api/polls/{poll['id']}/close",
            json={"creator_secret": poll["creator_secret"]},
            headers=_bearer_headers(other_bid, other_token),
        )
        assert resp.status_code == 200, resp.text
