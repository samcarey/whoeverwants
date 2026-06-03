"""Per-user "remind me to vote" notification setting (migration 136).

Covers:
  * validate_vote_reminder + reminder_offset (pure)
  * POST /api/auth/me/vote-reminder (signed-in only; rides /me)
  * claim_due_reminders selection: due/not-due, fire-once, skip voted / ignored
    / 'off', account-aware setting resolution
  * the cron tick's reminder pass end-to-end (fan_out_to_browsers monkeypatched)

Push delivery isn't exercised (needs a real subscribed endpoint) — the
recipient SELECTION + claim ledger are what's testable.
"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.conftest import TEST_DB_URL, bid_headers, create_poll
from services.auth import generate_token, hash_token, normalize_email
from services.validation import validate_vote_reminder
from services.vote_reminder import claim_due_reminders, reminder_offset

import routers.internal


def _db():
    return psycopg.connect(TEST_DB_URL)


def _now():
    return datetime.now(timezone.utc)


def _member(group_id, browser_id):
    """Add a group member browser + a push subscription so it's a real
    reminder target."""
    with _db() as conn:
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (group_id, browser_id),
        )
        conn.execute(
            "INSERT INTO push_subscriptions (browser_id, kind, endpoint) "
            "VALUES (%s, 'web_push', %s) ON CONFLICT DO NOTHING",
            (browser_id, f"https://example.test/{browser_id}"),
        )
        conn.commit()


def _set_account_reminder(browser_id, value):
    """Mint an account with the given vote_reminder and link `browser_id` to
    it, so the recipient query resolves the account setting."""
    with _db() as conn:
        uid = conn.execute(
            "INSERT INTO users (display_name, vote_reminder) VALUES ('M', %s) "
            "RETURNING id",
            (value,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO user_browsers (browser_id, user_id) VALUES (%s, %s) "
            "ON CONFLICT (browser_id) DO UPDATE SET user_id = EXCLUDED.user_id",
            (browser_id, uid),
        )
        conn.commit()


def _set_poll_times(poll_id, *, created_ago: timedelta, deadline_in: timedelta):
    """Force the poll's open window: created_at = now - created_ago,
    response_deadline = now + deadline_in. Lets fractional offsets land where
    we want without waiting real time."""
    now = _now()
    with _db() as conn:
        conn.execute(
            "UPDATE polls SET created_at = %s, response_deadline = %s WHERE id = %s",
            (now - created_ago, now + deadline_in, poll_id),
        )
        conn.commit()


def _vote_yes(client, poll, browser_id):
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(browser_id),
        json={
            "voter_name": "Vee",
            "items": [
                {
                    "question_id": poll["questions"][0]["id"],
                    "vote_type": "yes_no",
                    "yes_no_choice": "yes",
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text


def _claimed_browsers(now=None):
    """Run claim_due_reminders and return the flat set of claimed browser_ids.
    Uses a dict_row connection to match the app's get_db() row factory that
    claim_due_reminders expects."""
    with psycopg.connect(TEST_DB_URL, row_factory=dict_row) as conn:
        targets = claim_due_reminders(conn, now or _now())
        conn.commit()
    out = set()
    for _pid, bids in targets:
        out.update(bids)
    return out


# --------------------------------------------------------------------------
# pure helpers
# --------------------------------------------------------------------------


def test_validate_vote_reminder():
    assert validate_vote_reminder("0.2x") == "0.2x"
    assert validate_vote_reminder("1d") == "1d"
    assert validate_vote_reminder(None) == "0.2x"  # default
    assert validate_vote_reminder("") == "0.2x"
    with pytest.raises(Exception):
        validate_vote_reminder("2x")  # not an offered fraction
    with pytest.raises(Exception):
        validate_vote_reminder("bogus")


def test_reminder_offset():
    c = datetime(2026, 1, 1, tzinfo=timezone.utc)
    d = c + timedelta(hours=10)
    assert reminder_offset("off", c, d) is None
    assert reminder_offset("0.2x", c, d) == timedelta(hours=2)
    assert reminder_offset("0.5x", c, d) == timedelta(hours=5)
    assert reminder_offset("1h", c, d) == timedelta(hours=1)
    assert reminder_offset("1d", c, d) == timedelta(days=1)
    assert reminder_offset("unknown", c, d) is None


# --------------------------------------------------------------------------
# endpoint
# --------------------------------------------------------------------------


def _sign_in(client, browser_id, email):
    token = generate_token()
    with _db() as conn:
        conn.execute(
            "INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at) "
            "VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')",
            (hash_token(token), normalize_email(email), browser_id),
        )
        conn.commit()
    resp = client.post(
        "/api/auth/magic-link/verify",
        json={"token": token},
        headers=bid_headers(browser_id),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["session_token"]


def test_vote_reminder_endpoint(client):
    bid = str(uuid.uuid4())
    token = _sign_in(client, bid, f"vr-{uuid.uuid4().hex[:8]}@example.com")
    headers = {"X-Browser-Id": bid, "Authorization": f"Bearer {token}"}

    # Default rides /me.
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["vote_reminder"] == "0.2x"

    # Update + echo on the response and on /me.
    resp = client.post(
        "/api/auth/me/vote-reminder", json={"vote_reminder": "1d"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["vote_reminder"] == "1d"
    assert client.get("/api/auth/me", headers=headers).json()["vote_reminder"] == "1d"

    # Bad value → 400.
    bad = client.post(
        "/api/auth/me/vote-reminder", json={"vote_reminder": "5x"}, headers=headers
    )
    assert bad.status_code == 400

    # Anonymous → 401.
    anon = client.post(
        "/api/auth/me/vote-reminder",
        json={"vote_reminder": "off"},
        headers={"X-Browser-Id": str(uuid.uuid4())},
    )
    assert anon.status_code == 401


# --------------------------------------------------------------------------
# claim_due_reminders selection
# --------------------------------------------------------------------------


def test_reminder_fires_when_due_and_only_once(client):
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=1)).isoformat())
    _member(poll["group_id"], member)
    # default 0.2x: window 10h, offset 2h, fire_time = deadline - 2h = now - 1h → due.
    _set_poll_times(poll["id"], created_ago=timedelta(hours=9), deadline_in=timedelta(hours=1))

    first = _claimed_browsers()
    assert member in first
    # Fires exactly once — the ledger row blocks a re-claim.
    assert member not in _claimed_browsers()


def test_reminder_not_due_yet(client):
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=10)).isoformat())
    _member(poll["group_id"], member)
    # window ~10h, offset 2h, fire_time = now + 8h → not due.
    _set_poll_times(poll["id"], created_ago=timedelta(minutes=1), deadline_in=timedelta(hours=10))
    assert member not in _claimed_browsers()


def test_reminder_skips_voted(client):
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=1)).isoformat())
    _member(poll["group_id"], member)
    _vote_yes(client, poll, member)
    _set_poll_times(poll["id"], created_ago=timedelta(hours=9), deadline_in=timedelta(hours=1))
    assert member not in _claimed_browsers()


def test_reminder_skips_off(client):
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=1)).isoformat())
    _member(poll["group_id"], member)
    _set_account_reminder(member, "off")
    _set_poll_times(poll["id"], created_ago=timedelta(hours=9), deadline_in=timedelta(hours=1))
    assert member not in _claimed_browsers()


def test_reminder_skips_ignored(client):
    from services.follow_state import set_follow_state

    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=1)).isoformat())
    _member(poll["group_id"], member)
    with _db() as conn:
        set_follow_state(conn, poll_id=poll["id"], browser_id=member, state="old")
        conn.commit()
    _set_poll_times(poll["id"], created_ago=timedelta(hours=9), deadline_in=timedelta(hours=1))
    assert member not in _claimed_browsers()


def test_reminder_uses_account_setting(client):
    # 0.1x member: window 10h, offset 1h, fire_time = deadline - 1h = now + 1h →
    # NOT due, even though the default 0.2x WOULD be due for the same window.
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=2)).isoformat())
    _member(poll["group_id"], member)
    _set_account_reminder(member, "0.1x")
    _set_poll_times(poll["id"], created_ago=timedelta(hours=8), deadline_in=timedelta(hours=2))
    assert member not in _claimed_browsers()


def test_reminder_skips_closed_poll(client):
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=1)).isoformat())
    _member(poll["group_id"], member)
    _set_poll_times(poll["id"], created_ago=timedelta(hours=9), deadline_in=timedelta(hours=1))
    with _db() as conn:
        conn.execute("UPDATE polls SET is_closed = true WHERE id = %s", (poll["id"],))
        conn.commit()
    assert member not in _claimed_browsers()


# --------------------------------------------------------------------------
# tick integration
# --------------------------------------------------------------------------


def test_tick_fires_reminder(client, monkeypatch):
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "sek")
    sent = []
    monkeypatch.setattr(
        routers.internal,
        "fan_out_to_browsers",
        lambda browser_ids, payload: sent.append((tuple(sorted(browser_ids)), payload)),
    )
    member = str(uuid.uuid4())
    poll = create_poll(client, browser_id=str(uuid.uuid4()), response_deadline=(_now() + timedelta(hours=1)).isoformat())
    _member(poll["group_id"], member)
    _set_poll_times(poll["id"], created_ago=timedelta(hours=9), deadline_in=timedelta(hours=1))

    headers = {"Authorization": "Bearer sek"}
    body = client.post("/api/internal/tick", headers=headers).json()
    assert body["reminded"] >= 1
    assert sent, "expected a reminder fan-out"
    # The reminder payload nudges the recipient to vote.
    payloads = [p for _bids, p in sent]
    assert any(p["title"].startswith("Reminder to vote in ") for p in payloads)
    assert any(member in bids for bids, _p in sent)

    # Second tick must not re-fire (ledger claimed).
    sent.clear()
    client.post("/api/internal/tick", headers=headers)
    assert not any(member in bids for bids, _p in sent)
