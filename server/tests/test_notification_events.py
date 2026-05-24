"""Migration 120 / notification-events backend.

Covers the plumbing for poll-closed + phase-transition push notifications:
  * votes.browser_id capture + /viewed watermark
  * close / reopen / cutoff idempotency flags + inline fan-out wiring
  * the cron tick: auth, deadline-close, idempotent claim
  * the phase-transition recipient skip-logic (the user-specified rule)

Push delivery itself isn't exercised (it needs a real subscribed endpoint).
Instead `services.push._dispatch_pushes` is monkeypatched to capture WHICH
subscriptions the fan-out selected — that's the logic worth testing.
"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from tests.conftest import TEST_DB_URL, bid_headers, create_poll

import routers.internal
import routers.polls
import services.push


def _db():
    return psycopg.connect(TEST_DB_URL)


def _suggestion_poll(client, creator_secret, creator_bid, **overrides) -> dict:
    body = {
        "creator_secret": creator_secret,
        "creator_name": "Creator",
        "prephase_deadline_minutes": 120,
        "questions": [
            {
                "question_type": "ranked_choice",
                "category": "restaurant",
                "suggestion_deadline_minutes": 120,
            }
        ],
    }
    body.update(overrides)
    resp = client.post("/api/polls", json=body, headers=bid_headers(creator_bid))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _submit_suggestion(client, poll, voter_bid, name, suggestion):
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(voter_bid),
        json={
            "voter_name": name,
            "items": [
                {
                    "question_id": poll["questions"][0]["id"],
                    "vote_type": "ranked_choice",
                    "suggestions": [suggestion],
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text


def _insert_member_and_sub(group_id, browser_id):
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


# --------------------------------------------------------------------------
# browser_id capture + /viewed watermark
# --------------------------------------------------------------------------


def test_vote_records_browser_id(client, creator_secret):
    bid = str(uuid.uuid4())
    voter = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=bid)
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(voter),
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
    with _db() as conn:
        row = conn.execute(
            "SELECT browser_id FROM votes WHERE question_id = %s",
            (poll["questions"][0]["id"],),
        ).fetchone()
    assert row is not None and str(row[0]) == voter


def test_vote_records_poll_view(client, creator_secret):
    voter = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(voter),
        json={
            "voter_name": "Vee",
            "items": [
                {
                    "question_id": poll["questions"][0]["id"],
                    "vote_type": "yes_no",
                    "yes_no_choice": "no",
                }
            ],
        },
    )
    with _db() as conn:
        row = conn.execute(
            "SELECT 1 FROM poll_views WHERE browser_id = %s AND poll_id = %s",
            (voter, poll["id"]),
        ).fetchone()
    assert row is not None


def test_viewed_endpoint_upserts_watermark(client, creator_secret):
    viewer = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    r1 = client.post(f"/api/polls/{poll['id']}/viewed", headers=bid_headers(viewer))
    assert r1.status_code == 204
    with _db() as conn:
        first = conn.execute(
            "SELECT last_viewed_at FROM poll_views WHERE browser_id=%s AND poll_id=%s",
            (viewer, poll["id"]),
        ).fetchone()[0]
    r2 = client.post(f"/api/polls/{poll['id']}/viewed", headers=bid_headers(viewer))
    assert r2.status_code == 204
    with _db() as conn:
        second = conn.execute(
            "SELECT last_viewed_at FROM poll_views WHERE browser_id=%s AND poll_id=%s",
            (viewer, poll["id"]),
        ).fetchone()[0]
    assert second >= first  # upsert moved the watermark forward (or equal)


def test_viewed_unknown_poll_is_noop(client):
    # Valid-uuid-shaped but nonexistent poll → 204, no row, no 500.
    ghost = str(uuid.uuid4())
    viewer = str(uuid.uuid4())
    resp = client.post(f"/api/polls/{ghost}/viewed", headers=bid_headers(viewer))
    assert resp.status_code == 204
    with _db() as conn:
        row = conn.execute(
            "SELECT 1 FROM poll_views WHERE poll_id=%s", (ghost,)
        ).fetchone()
    assert row is None


# --------------------------------------------------------------------------
# close / reopen / cutoff flags + inline fan-out wiring
# --------------------------------------------------------------------------


def test_close_sets_flag_and_fires(client, creator_secret, monkeypatch):
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: calls.append((poll_id, payload)),
    )
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"creator_secret": creator_secret, "close_reason": "manual"},
    )
    assert resp.status_code == 200, resp.text
    with _db() as conn:
        flag = conn.execute(
            "SELECT close_notified FROM polls WHERE id=%s", (poll["id"],)
        ).fetchone()[0]
    assert flag is True
    assert len(calls) == 1
    assert calls[0][0] == poll["id"]
    # Line 1 = '<event> in "<group name>"'; line 2 (body) = icon + poll title.
    # No group_title override here, so the group name falls back to the
    # deduplicated participant names (just the creator so far). The single
    # yes_no question contributes the 👍 category icon.
    assert calls[0][1]["title"] == 'Poll closed in "Test User"'
    assert calls[0][1]["body"] == f"👍 {poll['title']}"
    assert calls[0][1]["badge"] == 1


def test_close_twice_fires_once(client, creator_secret, monkeypatch):
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: calls.append(poll_id),
    )
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    body = {"creator_secret": creator_secret, "close_reason": "manual"}
    client.post(f"/api/polls/{poll['id']}/close", json=body)
    client.post(f"/api/polls/{poll['id']}/close", json=body)
    assert calls.count(poll["id"]) == 1


def test_reopen_resets_close_notified(client, creator_secret):
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    client.post(
        f"/api/polls/{poll['id']}/close",
        json={"creator_secret": creator_secret, "close_reason": "manual"},
    )
    client.post(
        f"/api/polls/{poll['id']}/reopen",
        json={"creator_secret": creator_secret},
    )
    with _db() as conn:
        flag = conn.execute(
            "SELECT close_notified FROM polls WHERE id=%s", (poll["id"],)
        ).fetchone()[0]
    assert flag is False


def test_cutoff_suggestions_sets_flag_and_fires(client, creator_secret, monkeypatch):
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_phase_transition",
        lambda group_id, poll_id, payload, **kw: calls.append((poll_id, payload, kw)),
    )
    cbid = str(uuid.uuid4())
    poll = _suggestion_poll(client, creator_secret, cbid)
    _submit_suggestion(client, poll, str(uuid.uuid4()), "Ann", "Tacos")
    resp = client.post(
        f"/api/polls/{poll['id']}/cutoff-suggestions",
        json={"creator_secret": creator_secret},
    )
    assert resp.status_code == 200, resp.text
    with _db() as conn:
        flag = conn.execute(
            "SELECT prephase_notified FROM polls WHERE id=%s", (poll["id"],)
        ).fetchone()[0]
    assert flag is True
    assert len(calls) == 1
    # Group name (quoted) = deduplicated participants, creator first then
    # voters. The single restaurant question contributes the 🍽️ icon.
    assert calls[0][1]["title"] == 'Voting is open in "Creator, Ann"'
    assert calls[0][1]["body"] == f"🍽️ {poll['title']}"
    assert "prevoting_on" in calls[0][2]


# --------------------------------------------------------------------------
# cron tick
# --------------------------------------------------------------------------


def test_tick_requires_secret(client, monkeypatch):
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "")
    resp = client.post("/api/internal/tick")
    assert resp.status_code == 503


def test_tick_rejects_wrong_secret(client, monkeypatch):
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "right")
    resp = client.post(
        "/api/internal/tick", headers={"Authorization": "Bearer wrong"}
    )
    assert resp.status_code == 403


def test_tick_closes_past_deadline_and_is_idempotent(client, creator_secret, monkeypatch):
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "sek")
    closed = []
    monkeypatch.setattr(
        routers.internal, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: closed.append(poll_id),
    )
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    poll = create_poll(
        client, creator_secret, browser_id=str(uuid.uuid4()), response_deadline=past
    )
    # Created with a past deadline but is_closed still false (create doesn't
    # eagerly close) — the tick is what flips it.
    with _db() as conn:
        assert conn.execute(
            "SELECT is_closed FROM polls WHERE id=%s", (poll["id"],)
        ).fetchone()[0] is False

    headers = {"Authorization": "Bearer sek"}
    assert client.post("/api/internal/tick", headers=headers).status_code == 200
    with _db() as conn:
        row = conn.execute(
            "SELECT is_closed, close_reason, close_notified FROM polls WHERE id=%s",
            (poll["id"],),
        ).fetchone()
    assert row[0] is True and row[1] == "deadline" and row[2] is True

    # Second tick must not re-claim this poll.
    client.post("/api/internal/tick", headers=headers)
    assert closed.count(poll["id"]) == 1


def test_tick_transitions_past_prephase(client, creator_secret, monkeypatch):
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "sek")
    fired = []
    monkeypatch.setattr(
        routers.internal, "fan_out_phase_transition",
        lambda group_id, poll_id, payload, **kw: fired.append(poll_id),
    )
    poll = _suggestion_poll(client, creator_secret, str(uuid.uuid4()))
    # Force the prephase deadline into the past.
    with _db() as conn:
        conn.execute(
            "UPDATE polls SET prephase_deadline = %s WHERE id = %s",
            (datetime.now(timezone.utc) - timedelta(minutes=5), poll["id"]),
        )
    client.post("/api/internal/tick", headers={"Authorization": "Bearer sek"})
    with _db() as conn:
        flag = conn.execute(
            "SELECT prephase_notified FROM polls WHERE id=%s", (poll["id"],)
        ).fetchone()[0]
    assert flag is True
    assert poll["id"] in fired


# --------------------------------------------------------------------------
# phase-transition recipient skip-logic — the core rule
# --------------------------------------------------------------------------


def _capture_recipients(monkeypatch):
    captured = {}

    def fake(subscriptions, payload, vapid):
        captured["ids"] = {s["browser_id"] for s in subscriptions}

    monkeypatch.setattr(services.push, "_dispatch_pushes", fake)
    return captured


def test_transition_skips_only_satisfied_prevoters(client, creator_secret, monkeypatch):
    """Skip a member only when prevoting was on AND they prevoted AND no
    option-adding contribution arrived after their last view. Everyone else
    is notified — including never-prevoters and prevoters with unseen options."""
    cbid = str(uuid.uuid4())
    poll = _suggestion_poll(client, creator_secret, cbid)
    group_id = poll["group_id"]
    poll_id = poll["id"]

    a, b, c = (str(uuid.uuid4()) for _ in range(3))
    # A and C prevote (vote rows carry their browser_id + record a poll_view);
    # B never prevotes.
    _submit_suggestion(client, poll, c, "Cara", "Pizza")
    _submit_suggestion(client, poll, a, "Ada", "Sushi")
    _insert_member_and_sub(group_id, b)
    # Give A + C subscriptions so they can be selected; A/C already joined via
    # voting.
    with _db() as conn:
        for bid in (a, c):
            conn.execute(
                "INSERT INTO push_subscriptions (browser_id, kind, endpoint) "
                "VALUES (%s, 'web_push', %s) ON CONFLICT DO NOTHING",
                (bid, f"https://example.test/{bid}"),
            )
        # Pin deterministic view watermarks: A viewed AFTER the latest
        # contribution, C viewed BEFORE it.
        conn.execute(
            "UPDATE poll_views SET last_viewed_at=%s WHERE browser_id=%s AND poll_id=%s",
            (datetime(2030, 1, 1, 0, 2, tzinfo=timezone.utc), a, poll_id),
        )
        conn.execute(
            "UPDATE poll_views SET last_viewed_at=%s WHERE browser_id=%s AND poll_id=%s",
            (datetime(2030, 1, 1, 0, 0, tzinfo=timezone.utc), c, poll_id),
        )

    latest = datetime(2030, 1, 1, 0, 1, tzinfo=timezone.utc)
    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_phase_transition(
        group_id, poll_id, {"title": "Voting is open"},
        prevoting_on=True, latest_contribution=latest,
    )
    # A satisfied → skipped. B (never prevoted) + C (stale view) → notified.
    assert captured["ids"] == {b, c}


def test_transition_prevoting_off_notifies_everyone(client, creator_secret, monkeypatch):
    cbid = str(uuid.uuid4())
    poll = _suggestion_poll(client, creator_secret, cbid, allow_pre_ranking=False)
    group_id = poll["group_id"]
    poll_id = poll["id"]

    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    _submit_suggestion(client, poll, a, "Ada", "Sushi")  # A prevoted + viewed now
    _insert_member_and_sub(group_id, b)
    with _db() as conn:
        conn.execute(
            "INSERT INTO push_subscriptions (browser_id, kind, endpoint) "
            "VALUES (%s, 'web_push', %s) ON CONFLICT DO NOTHING",
            (a, f"https://example.test/{a}"),
        )

    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_phase_transition(
        group_id, poll_id, {"title": "Voting is open"},
        prevoting_on=False, latest_contribution=datetime(2030, 1, 1, tzinfo=timezone.utc),
    )
    # Prevoting off → the skip-case can't apply; A (a prevoter) is still notified.
    assert {a, b} <= captured["ids"]


def test_closed_fan_out_includes_whole_group(client, creator_secret, monkeypatch):
    cbid = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=cbid)
    group_id = poll["group_id"]
    m1, m2 = str(uuid.uuid4()), str(uuid.uuid4())
    _insert_member_and_sub(group_id, m1)
    _insert_member_and_sub(group_id, m2)

    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_poll_closed(group_id, poll["id"], {"title": "Poll closed"})
    # No actor exclusion — both members selected.
    assert {m1, m2} <= captured["ids"]
