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

from tests.conftest import TEST_DB_URL, bid_headers, create_poll, creator_headers

import routers.internal
import routers.polls
import services.push
from services.auth import generate_token, hash_token, normalize_email
from services.follow_state import set_follow_state


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


def _time_poll(client, creator_secret, creator_bid, **overrides) -> dict:
    body = {
        "creator_secret": creator_secret,
        "creator_name": "Creator",
        "prephase_deadline_minutes": 120,
        "questions": [
            {
                "question_type": "time",
                "category": "time",
                "suggestion_deadline_minutes": 120,
            }
        ],
    }
    body.update(overrides)
    resp = client.post("/api/polls", json=body, headers=bid_headers(creator_bid))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _viable_time_question(min_participants: int | None = None) -> dict:
    """A time question with concrete creator windows + a 1-hour duration so
    `_finalize_time_slots` can generate real candidate slots. With
    min_participants=1 a single availability submission yields a surviving slot;
    omit it (defaults to 2) to make a single voter unable to clear the gate →
    'event's off'."""
    q = {
        "question_type": "time",
        "category": "time",
        "suggestion_deadline_minutes": 120,
        "day_time_windows": [
            {"day": "2030-01-01", "windows": [{"min": "09:00", "max": "17:00"}]}
        ],
        "duration_window": {
            "minEnabled": True,
            "minValue": 1,
            "maxEnabled": True,
            "maxValue": 1,
        },
    }
    if min_participants is not None:
        q["min_participants"] = min_participants
    return q


def _submit_availability(client, poll, voter_bid, name):
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(voter_bid),
        json={
            "voter_name": name,
            "items": [
                {
                    "question_id": poll["questions"][0]["id"],
                    "vote_type": "time",
                    "voter_day_time_windows": [
                        {
                            "day": "2030-01-01",
                            "windows": [{"min": "09:00", "max": "17:00"}],
                        }
                    ],
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text


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
# viewed_total turnout denominator (counts-only, account-collapsed)
# --------------------------------------------------------------------------


def test_viewed_total_counts_distinct_viewers(client, creator_secret):
    # Three browsers open the poll (one of them also votes); the creator never
    # views. viewed_total = 3 distinct viewers; the extra view from voting
    # doesn't double-count its browser.
    creator = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=creator)
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    for bid in (a, b, c):
        assert (
            client.post(
                f"/api/polls/{poll['id']}/viewed", headers=bid_headers(bid)
            ).status_code
            == 204
        )
    client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(a),
        json={
            "voter_name": "Aa",
            "items": [
                {
                    "question_id": poll["questions"][0]["id"],
                    "vote_type": "yes_no",
                    "yes_no_choice": "yes",
                }
            ],
        },
    )
    resp = client.get(f"/api/polls/by-id/{poll['id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["viewed_total"] == 3


def test_viewed_total_collapses_account_browsers(client, creator_secret):
    # Two browsers linked to one account + one anonymous browser all view the
    # poll. The account's two devices collapse to a single viewer, so
    # viewed_total = 2 (account + anon), not 3.
    creator = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=creator)
    bid_a, bid_b, bid_other = (
        str(uuid.uuid4()),
        str(uuid.uuid4()),
        str(uuid.uuid4()),
    )
    user_id = str(uuid.uuid4())
    with _db() as conn:
        conn.execute("INSERT INTO users (id) VALUES (%s)", (user_id,))
        conn.execute(
            "INSERT INTO user_browsers (browser_id, user_id) VALUES (%s, %s), (%s, %s)",
            (bid_a, user_id, bid_b, user_id),
        )
        conn.commit()
    for bid in (bid_a, bid_b, bid_other):
        client.post(f"/api/polls/{poll['id']}/viewed", headers=bid_headers(bid))
    resp = client.get(f"/api/polls/by-id/{poll['id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["viewed_total"] == 2


def test_suggestion_count_distinct(client, creator_secret):
    # Two voters propose options (one is a duplicate); suggestion_count is the
    # distinct non-empty set. A plain yes/no poll has 0.
    cbid = str(uuid.uuid4())
    poll = _suggestion_poll(client, creator_secret, cbid)
    qid = poll["questions"][0]["id"]
    for name, sugg in [("Ana", ["Thai", "Pizza"]), ("Ben", ["Sushi", "Thai"])]:
        r = client.post(
            f"/api/polls/{poll['id']}/votes",
            headers=bid_headers(str(uuid.uuid4())),
            json={
                "voter_name": name,
                "items": [
                    {"question_id": qid, "vote_type": "ranked_choice", "suggestions": sugg}
                ],
            },
        )
        assert r.status_code == 201, r.text
    # distinct across both: Thai, Pizza, Sushi = 3
    assert client.get(f"/api/polls/by-id/{poll['id']}").json()["suggestion_count"] == 3
    # yes/no poll has no suggestions.
    yn = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    assert client.get(f"/api/polls/by-id/{yn['id']}").json()["suggestion_count"] == 0


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
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
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
    # Path form (`/g/<group>/p/<poll>`), not the legacy `?p=` query form, so the
    # tap opens the poll detail page directly without flashing the group list.
    assert calls[0][1]["url"] == f"/g/{poll['group_short_id']}/p/{poll['short_id']}"
    # Base payload carries NO hardcoded badge — the real per-recipient count is
    # injected downstream in _dispatch_pushes (_payload_for), so a failed count
    # computation never stamps a phantom "1".
    assert "badge" not in calls[0][1]


def test_new_poll_notification_uses_path_url(client, creator_secret, monkeypatch):
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_new_poll",
        lambda group_id, creator_browser_id, payload: calls.append(payload),
    )
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    assert len(calls) == 1
    # Path form, not `?p=` — tapping the new-poll notification lands straight on
    # the poll detail page (no group-list flash + redirect).
    assert calls[0]["url"] == f"/g/{poll['group_short_id']}/p/{poll['short_id']}"


def test_close_twice_fires_once(client, creator_secret, monkeypatch):
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: calls.append(poll_id),
    )
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    body = {"close_reason": "manual"}
    hdrs = creator_headers(poll)
    client.post(f"/api/polls/{poll['id']}/close", json=body, headers=hdrs)
    client.post(f"/api/polls/{poll['id']}/close", json=body, headers=hdrs)
    assert calls.count(poll["id"]) == 1


def test_reopen_resets_close_notified(client, creator_secret):
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    hdrs = creator_headers(poll)
    client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=hdrs,
    )
    client.post(
        f"/api/polls/{poll['id']}/reopen",
        json={},
        headers=hdrs,
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
        json={},
        headers=bid_headers(cbid),
    )
    assert resp.status_code == 200, resp.text
    with _db() as conn:
        flag = conn.execute(
            "SELECT prephase_notified FROM polls WHERE id=%s", (poll["id"],)
        ).fetchone()[0]
    assert flag is True
    assert len(calls) == 1
    # Group name (quoted) = deduplicated participants, creator first then
    # voters. A ranked_choice suggestion poll transitioning out of its
    # prephase means new options to rank → "New options available".
    # The single restaurant question contributes the 🍽️ icon on line 2.
    assert calls[0][1]["title"] == 'New options available in "Creator, Ann"'
    assert calls[0][1]["body"] == f"🍽️ {poll['title']}"
    assert "prevoting_on" in calls[0][2]


def test_cutoff_availability_uses_time_to_vote_copy(client, creator_secret, monkeypatch):
    """A time poll's availability phase ending opens the like/dislike vote, so
    its transition push reads 'Time to vote' rather than the suggestion copy."""
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_phase_transition",
        lambda group_id, poll_id, payload, **kw: calls.append((poll_id, payload, kw)),
    )
    cbid = str(uuid.uuid4())
    # A VIABLE poll: creator windows + a 1-hr duration + min_participants=1, so
    # Ann's single availability produces a surviving slot (no cancellation).
    poll = _time_poll(
        client, creator_secret, cbid,
        questions=[_viable_time_question(min_participants=1)],
    )
    _submit_availability(client, poll, str(uuid.uuid4()), "Ann")
    resp = client.post(
        f"/api/polls/{poll['id']}/cutoff-availability",
        json={},
        headers=bid_headers(cbid),
    )
    assert resp.status_code == 200, resp.text
    assert len(calls) == 1
    assert calls[0][1]["title"] == 'Time to vote in "Creator, Ann"'
    # Line 2 still carries the poll's own title prefixed with the 📅 icon.
    assert calls[0][1]["body"] == f"📅 {poll['title']}"


def test_cutoff_availability_cancels_unviable_event(client, creator_secret, monkeypatch):
    """A time poll where no slot meets the Minimum Participants gate is an
    'event's off' cancellation: cutting off availability auto-closes the poll
    and fires a poll-CLOSED push, NOT a 'voting is open' transition push."""
    transition_calls = []
    close_calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_phase_transition",
        lambda group_id, poll_id, payload, **kw: transition_calls.append((poll_id, payload)),
    )
    monkeypatch.setattr(
        routers.polls, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: close_calls.append((poll_id, payload)),
    )
    cbid = str(uuid.uuid4())
    # min_participants defaults to 2; a single availability submission can't
    # clear the bar for any slot, so the event cancels.
    poll = _time_poll(
        client, creator_secret, cbid, questions=[_viable_time_question()]
    )
    _submit_availability(client, poll, str(uuid.uuid4()), "Ann")
    resp = client.post(
        f"/api/polls/{poll['id']}/cutoff-availability",
        json={},
        headers=bid_headers(cbid),
    )
    assert resp.status_code == 200, resp.text
    # Auto-closed as cancelled — no "voting is open" push.
    assert resp.json()["is_closed"] is True
    assert resp.json()["close_reason"] == "cancelled"
    assert transition_calls == []
    assert len(close_calls) == 1
    assert close_calls[0][1]["title"] == 'Poll closed in "Creator, Ann"'


def test_transition_event_phrase_per_prephase_kind():
    """Direct coverage of the prephase → event-phrase mapping, including the
    mixed-kind and no-prephase fallbacks to the generic copy."""
    phrase = routers.polls._transition_event_phrase
    assert phrase([{"question_type": "ranked_choice"}]) == "New options available"
    assert phrase([{"question_type": "time"}]) == "Time to vote"
    # A poll mixing both prephase kinds can't pick one → generic fallback.
    assert (
        phrase([{"question_type": "ranked_choice"}, {"question_type": "time"}])
        == "Voting is open"
    )
    # Defensive: anything without a recognized prephase kind also falls back.
    assert phrase([{"question_type": "yes_no"}]) == "Voting is open"
    assert phrase([]) == "Voting is open"


# --------------------------------------------------------------------------
# poll-closed outcome summary ("Decided: …" body)
# --------------------------------------------------------------------------


def _capture_close(monkeypatch):
    calls = []
    monkeypatch.setattr(
        routers.polls, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: calls.append(payload),
    )
    return calls


def _vote_yes_no(client, poll, qid, bid, name, choice):
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(bid),
        json={
            "voter_name": name,
            "items": [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": choice}
            ],
        },
    )
    assert resp.status_code in (200, 201), resp.text


def _vote_ranked(client, poll, qid, bid, name, ranking):
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(bid),
        json={
            "voter_name": name,
            "items": [
                {
                    "question_id": qid,
                    "vote_type": "ranked_choice",
                    "ranked_choices": ranking,
                }
            ],
        },
    )
    assert resp.status_code in (200, 201), resp.text


def test_close_notification_yes_no_outcome(client, creator_secret, monkeypatch):
    """A decided yes/no poll's close push delivers the OUTCOME on line 2
    ('Decided: Yes'), not just the poll title."""
    calls = _capture_close(monkeypatch)
    cbid = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=cbid)
    qid = poll["questions"][0]["id"]
    _vote_yes_no(client, poll, qid, str(uuid.uuid4()), "Ann", "yes")
    _vote_yes_no(client, poll, qid, str(uuid.uuid4()), "Bo", "yes")
    _vote_yes_no(client, poll, qid, str(uuid.uuid4()), "Cy", "no")
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text
    assert len(calls) == 1
    assert calls[0]["body"] == "Decided: Yes"
    assert calls[0]["title"].startswith("Poll closed in ")


def test_close_notification_ranked_choice_outcome(client, creator_secret, monkeypatch):
    """A fixed-options ranked_choice poll's close push names the winning option."""
    calls = _capture_close(monkeypatch)
    cbid = str(uuid.uuid4())
    poll = create_poll(
        client,
        creator_secret,
        browser_id=cbid,
        questions=[
            {
                "question_type": "ranked_choice",
                "category": "restaurant",
                "options": ["Thai", "Sushi"],
            }
        ],
    )
    qid = poll["questions"][0]["id"]
    _vote_ranked(client, poll, qid, str(uuid.uuid4()), "Ann", ["Thai", "Sushi"])
    _vote_ranked(client, poll, qid, str(uuid.uuid4()), "Bo", ["Thai", "Sushi"])
    _vote_ranked(client, poll, qid, str(uuid.uuid4()), "Cy", ["Sushi", "Thai"])
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text
    assert len(calls) == 1
    assert calls[0]["body"] == "Decided: Thai"


def test_close_notification_multi_question_outcome(client, creator_secret, monkeypatch):
    """A multi-question poll joins each question's winner with ' · '."""
    calls = _capture_close(monkeypatch)
    cbid = str(uuid.uuid4())
    poll = create_poll(
        client,
        creator_secret,
        browser_id=cbid,
        questions=[
            {"question_type": "yes_no", "category": "yes_no"},
            {
                "question_type": "ranked_choice",
                "category": "restaurant",
                "options": ["Thai", "Sushi"],
            },
        ],
    )
    yn_qid = poll["questions"][0]["id"]
    rc_qid = poll["questions"][1]["id"]
    vbid = str(uuid.uuid4())
    # One voter answers both questions in a single atomic batch.
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(vbid),
        json={
            "voter_name": "Ann",
            "items": [
                {"question_id": yn_qid, "vote_type": "yes_no", "yes_no_choice": "yes"},
                {
                    "question_id": rc_qid,
                    "vote_type": "ranked_choice",
                    "ranked_choices": ["Sushi", "Thai"],
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text
    assert len(calls) == 1
    assert calls[0]["body"] == "Decided: Yes · Sushi"


def test_close_notification_no_decision_falls_back_to_title(client, creator_secret, monkeypatch):
    """A yes/no tie reaches no decision, so the body keeps the poll-title form."""
    calls = _capture_close(monkeypatch)
    cbid = str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=cbid)
    qid = poll["questions"][0]["id"]
    _vote_yes_no(client, poll, qid, str(uuid.uuid4()), "Ann", "yes")
    _vote_yes_no(client, poll, qid, str(uuid.uuid4()), "Bo", "no")
    resp = client.post(
        f"/api/polls/{poll['id']}/close",
        json={"close_reason": "manual"},
        headers=creator_headers(poll),
    )
    assert resp.status_code == 200, resp.text
    assert len(calls) == 1
    assert calls[0]["body"] == f"👍 {poll['title']}"


def test_format_slot_label():
    """The time-slot key formatter produces a compact friendly label and is
    minute-aware (drops ':00')."""
    fmt = routers.polls._format_slot_label
    assert fmt("2030-01-05 19:00-20:00") == "Sat Jan 5, 7 PM"
    assert fmt("2030-01-05 09:30-10:00") == "Sat Jan 5, 9:30 AM"
    assert fmt("2030-01-05 00:00-01:00") == "Sat Jan 5, 12 AM"
    assert fmt("2030-01-05 12:00-13:00") == "Sat Jan 5, 12 PM"
    # Unparseable input falls back to the raw key rather than raising.
    assert fmt("garbage") == "garbage"


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


def test_tick_cancels_unviable_time_event(client, creator_secret, monkeypatch):
    """A deadline-driven availability cutoff where no slot meets the Minimum
    Participants gate auto-closes the poll as 'cancelled' and fires NO 'voting
    is open' transition push. The close push then fires on the NEXT tick (step
    2 claims the un-notified close)."""
    monkeypatch.setattr(routers.internal, "_TICK_SECRET", "sek")
    transitions, closes = [], []
    monkeypatch.setattr(
        routers.internal, "fan_out_phase_transition",
        lambda group_id, poll_id, payload, **kw: transitions.append(poll_id),
    )
    monkeypatch.setattr(
        routers.internal, "fan_out_poll_closed",
        lambda group_id, poll_id, payload: closes.append(poll_id),
    )
    cbid = str(uuid.uuid4())
    # min_participants defaults to 2; one availability submission can't make any
    # slot viable → the event cancels at the cutoff.
    poll = _time_poll(
        client, creator_secret, cbid, questions=[_viable_time_question()]
    )
    _submit_availability(client, poll, str(uuid.uuid4()), "Ann")
    with _db() as conn:
        conn.execute(
            "UPDATE polls SET prephase_deadline = %s WHERE id = %s",
            (datetime.now(timezone.utc) - timedelta(minutes=5), poll["id"]),
        )

    headers = {"Authorization": "Bearer sek"}
    first = client.post("/api/internal/tick", headers=headers).json()
    assert first["cancelled"] == 1
    with _db() as conn:
        row = conn.execute(
            "SELECT is_closed, close_reason, time_event_cancelled "
            "FROM polls JOIN questions ON questions.poll_id = polls.id "
            "WHERE polls.id=%s",
            (poll["id"],),
        ).fetchone()
    assert row[0] is True and row[1] == "cancelled" and row[2] is True
    assert transitions == []           # no misleading "voting is open" push
    assert closes == []                # close push deferred to the next tick

    # Next tick: the un-notified close gets claimed → poll-closed push.
    client.post("/api/internal/tick", headers=headers)
    assert closes == [poll["id"]]


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


# --------------------------------------------------------------------------
# Gap 1: Old-set suppression on the fan-out (account-aware, cross-device)
# --------------------------------------------------------------------------


def _sign_in(client, browser_id, email):
    """Sign `browser_id` into `email`'s account via magic-link verify, linking
    the browser to the account's user_id (user_browsers)."""
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


def test_ignore_on_one_device_silences_account_push(client, creator_secret, monkeypatch):
    """✕'ing a poll on device A files it in the viewer's Old tab; the poll-closed
    push must then skip BOTH of that account's devices, not just A. Mirrors the
    account-aware badge suppression."""
    email = f"ignore-{uuid.uuid4().hex[:8]}@example.com"
    bid_a, bid_b, other = (str(uuid.uuid4()) for _ in range(3))
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    group_id = poll["group_id"]
    poll_id = poll["id"]

    # A + B are the same account (same email); `other` is an unrelated member.
    _sign_in(client, bid_a, email)
    _sign_in(client, bid_b, email)
    for bid in (bid_a, bid_b, other):
        _insert_member_and_sub(group_id, bid)

    # Sanity: before any ✕, every member is a recipient.
    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_poll_closed(group_id, poll_id, {"title": "Poll closed"})
    assert {bid_a, bid_b, other} <= captured["ids"]

    # ✕ on device A only.
    with _db() as conn:
        set_follow_state(conn, poll_id, bid_a, "old")
        conn.commit()

    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_poll_closed(group_id, poll_id, {"title": "Poll closed"})
    # Account-aware: BOTH A and B are silenced; the unrelated member still gets it.
    assert bid_a not in captured["ids"]
    assert bid_b not in captured["ids"]
    assert other in captured["ids"]


def test_refollow_on_other_device_wins_by_recency(client, creator_secret, monkeypatch):
    """Effective state across an account is recency-based: ✕ on A then + on B
    (later) → most-recent row is 'new' → the poll is no longer ignored, so both
    devices are notified again. clock_timestamp() ordering makes same-test writes
    deterministic."""
    email = f"refollow-{uuid.uuid4().hex[:8]}@example.com"
    bid_a, bid_b = str(uuid.uuid4()), str(uuid.uuid4())
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    group_id = poll["group_id"]
    poll_id = poll["id"]

    _sign_in(client, bid_a, email)
    _sign_in(client, bid_b, email)
    _insert_member_and_sub(group_id, bid_a)
    _insert_member_and_sub(group_id, bid_b)

    with _db() as conn:
        set_follow_state(conn, poll_id, bid_a, "old")  # ✕ on A
        set_follow_state(conn, poll_id, bid_b, "new")  # later + on B
        conn.commit()

    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_poll_closed(group_id, poll_id, {"title": "Poll closed"})
    # Most-recent row ('new' on B) wins → not ignored → both notified.
    assert {bid_a, bid_b} <= captured["ids"]


def test_anonymous_ignore_stays_per_browser(client, creator_secret, monkeypatch):
    """A member with no account (no user_browsers row) only suppresses their own
    browser — there's no account to union across, so ✕ on one anonymous browser
    can't silence an unrelated anonymous member."""
    poll = create_poll(client, creator_secret, browser_id=str(uuid.uuid4()))
    group_id = poll["group_id"]
    poll_id = poll["id"]
    m1, m2 = str(uuid.uuid4()), str(uuid.uuid4())
    _insert_member_and_sub(group_id, m1)
    _insert_member_and_sub(group_id, m2)

    with _db() as conn:
        set_follow_state(conn, poll_id, m1, "old")
        conn.commit()

    captured = _capture_recipients(monkeypatch)
    services.push.fan_out_poll_closed(group_id, poll_id, {"title": "Poll closed"})
    assert m1 not in captured["ids"]
    assert m2 in captured["ids"]


def test_compute_badge_count_nil_uuid_returns_zero():
    """The RFC 4122 nil UUID is never a real browser. compute_badge_count must
    short-circuit to 0 (before touching the DB, hence conn=None here) so a
    device that ever sends the nil id can't inherit a stranger group's unread
    count as its app-icon badge. Regression for the iOS all-zeros badge bug."""
    from services.groups import NIL_UUID

    assert services.push.compute_badge_count(
        None, NIL_UUID, todo_mode=False, on_voting_open=True, on_results=True
    ) == 0
    assert services.push.compute_badge_count(
        None, NIL_UUID, todo_mode=True, on_voting_open=False, on_results=False
    ) == 0
    assert services.push.compute_badge_count(
        None, None, todo_mode=False, on_voting_open=True, on_results=True
    ) == 0
