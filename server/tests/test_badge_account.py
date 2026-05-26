"""Account-aware unread app-badge (poll "seen" state).

Viewing or voting on a poll on one device clears the unread badge on the
user's other signed-in devices. poll_views / votes / group_members stay
browser-keyed; the badge READ unions across the account's linked browsers
(`_caller_browser_ids`), mirroring group-visibility's union.
"""

import uuid

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL, create_poll


def _bid_headers(bid):
    return {"X-Browser-Id": bid} if bid else {}


def _bearer(bid, token):
    h = _bid_headers(bid)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _sign_in(client, browser_id, email):
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at) "
            "VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')",
            (hash_token(token), normalize_email(email), browser_id),
        )
        conn.commit()
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=_bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["session_token"]


def _add_member(group_id, browser_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (group_id, browser_id),
        )
        conn.commit()


def _badge(client, bid, token, **params):
    qs = "&".join(f"{k}={str(v).lower()}" for k, v in params.items())
    resp = client.get(
        f"/api/notifications/badge?{qs}" if qs else "/api/notifications/badge",
        headers=_bearer(bid, token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["count"]


def test_view_on_one_device_clears_unread_badge_on_another(client):
    email = f"badge-{uuid.uuid4().hex[:8]}@example.com"
    bid_a, bid_b = str(uuid.uuid4()), str(uuid.uuid4())
    creator = str(uuid.uuid4())
    token_a = _sign_in(client, bid_a, email)
    token_b = _sign_in(client, bid_b, email)

    poll = create_poll(client, browser_id=creator)
    group_id = poll["group_id"]
    _add_member(group_id, bid_a)
    _add_member(group_id, bid_b)

    # Unread on both devices (never viewed).
    assert _badge(client, bid_b, token_b, todo_mode=False) >= 1
    assert _badge(client, bid_a, token_a, todo_mode=False) >= 1

    # View the poll on device A.
    seen = client.post(
        f"/api/polls/{poll['id']}/viewed", headers=_bearer(bid_a, token_a)
    )
    assert seen.status_code in (200, 204), seen.text

    # Device B's unread badge drops — A's view counts for the account.
    assert _badge(client, bid_b, token_b, todo_mode=False) == 0
    assert _badge(client, bid_a, token_a, todo_mode=False) == 0


def test_vote_on_one_device_clears_todo_badge_on_another(client):
    email = f"badge-{uuid.uuid4().hex[:8]}@example.com"
    bid_a, bid_b = str(uuid.uuid4()), str(uuid.uuid4())
    creator = str(uuid.uuid4())
    token_a = _sign_in(client, bid_a, email)
    token_b = _sign_in(client, bid_b, email)

    poll = create_poll(client, browser_id=creator)
    group_id = poll["group_id"]
    _add_member(group_id, bid_a)
    _add_member(group_id, bid_b)

    # To-do: an open votable poll neither device has voted on.
    assert _badge(client, bid_b, token_b, todo_mode=True) >= 1

    # Vote on device A.
    qid = poll["questions"][0]["id"]
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=_bearer(bid_a, token_a),
        json={
            "voter_name": "Aye",
            "items": [{"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}],
        },
    )
    assert resp.status_code in (200, 201), resp.text

    # Device B's to-do badge drops — the account has voted.
    assert _badge(client, bid_b, token_b, todo_mode=True) == 0
