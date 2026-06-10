"""Gap 1: per-poll follow/ignore state ("To Do · New · Old").

Covers the round-trip (new → old → new) surfaced on the group read's
`viewer_follow_state`, per-browser isolation, the endpoint's validation, the
recency tiebreak + `old_poll_ids_for_browsers` unit behavior, and the
to-do-badge suppression for ✕'d polls.
"""

import uuid
from datetime import datetime, timezone

from tests.conftest import bid_headers, close_poll, create_poll, reopen_poll
from database import get_db
from services.follow_state import (
    effective_follow_states,
    old_poll_ids_for_browsers,
    set_follow_state,
)
from services.questions import _time_outcome_settled, maybe_auto_age_poll


def _new_group_and_poll(conn):
    """Insert a bare group + poll (no questions) so FKs hold; returns
    (group_id, poll_id str). Caller deletes the group (CASCADE) to clean up."""
    gid = conn.execute("INSERT INTO groups DEFAULT VALUES RETURNING id").fetchone()["id"]
    poll_id = str(
        conn.execute(
            "INSERT INTO polls (group_id, creator_name) VALUES (%s, 'x') RETURNING id",
            (gid,),
        ).fetchone()["id"]
    )
    return gid, poll_id


def _read_poll(client, group_short_id, poll_id, bid):
    resp = client.post(
        "/api/groups/mine",
        json={"include_results": False},
        headers=bid_headers(bid),
    )
    assert resp.status_code == 200, resp.text
    for mp in resp.json():
        if mp["id"] == poll_id:
            return mp
    raise AssertionError(f"poll {poll_id} not in /mine for browser {bid}")


def test_default_follow_state_is_new(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    mp = _read_poll(client, poll["group_short_id"], poll["id"], browser_id)
    assert mp["viewer_follow_state"] == "new"


def test_ignore_then_refollow_round_trip(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)

    # ✕ → old
    r = client.post(
        f"/api/polls/{poll['id']}/follow-state",
        json={"state": "old"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 204, r.text
    mp = _read_poll(client, poll["group_short_id"], poll["id"], browser_id)
    assert mp["viewer_follow_state"] == "old"

    # + → new
    r = client.post(
        f"/api/polls/{poll['id']}/follow-state",
        json={"state": "new"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 204, r.text
    mp = _read_poll(client, poll["group_short_id"], poll["id"], browser_id)
    assert mp["viewer_follow_state"] == "new"


def test_follow_state_is_per_browser(client, browser_id):
    """Another member of the same group is unaffected by one browser's ✕."""
    poll = create_poll(client, browser_id=browser_id)
    other = str(uuid.uuid4())
    # `other` joins by visiting the group URL (auto-join on public group read).
    client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}",
        headers=bid_headers(other),
    )
    # Creator ✕'s the poll.
    client.post(
        f"/api/polls/{poll['id']}/follow-state",
        json={"state": "old"},
        headers=bid_headers(browser_id),
    )
    # The other member still sees it as new.
    resp = client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}",
        headers=bid_headers(other),
    )
    assert resp.status_code == 200
    target = next(mp for mp in resp.json() if mp["id"] == poll["id"])
    assert target["viewer_follow_state"] == "new"


def test_invalid_state_rejected(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)
    r = client.post(
        f"/api/polls/{poll['id']}/follow-state",
        json={"state": "archived"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 400


def test_unknown_poll_404(client, browser_id):
    r = client.post(
        f"/api/polls/{uuid.uuid4()}/follow-state",
        json={"state": "old"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 404


def test_recency_tiebreak_across_browsers():
    """effective_follow_states picks the most-recently-updated row across the
    caller's browser set; old_poll_ids_for_browsers mirrors it."""
    poll_id = None
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    with get_db() as conn:
        # Minimal group + poll so the FK holds.
        gid = conn.execute(
            "INSERT INTO groups DEFAULT VALUES RETURNING id"
        ).fetchone()["id"]
        poll_id = str(
            conn.execute(
                "INSERT INTO polls (group_id, creator_name) "
                "VALUES (%s, 'x') RETURNING id",
                (gid,),
            ).fetchone()["id"]
        )
        # Browser A ✕ (old), then browser B + (new) more recently.
        set_follow_state(conn, poll_id, a, "old")
        set_follow_state(conn, poll_id, b, "new")
        # Most recent across {A, B} is B's 'new' → effective new.
        states = effective_follow_states(conn, [poll_id], browser_ids=[a, b])
        assert states.get(poll_id) == "new"
        assert old_poll_ids_for_browsers(conn, [a, b]) == set()
        # From browser A alone the row is still 'old'.
        assert effective_follow_states(conn, [poll_id], browser_ids=[a]) == {
            poll_id: "old"
        }
        assert old_poll_ids_for_browsers(conn, [a]) == {poll_id}
        conn.execute("DELETE FROM groups WHERE id = %s", (gid,))


def test_ignored_poll_drops_out_of_todo_badge(client, browser_id):
    """A ✕'d poll no longer contributes to the to-do app-icon badge."""
    poll = create_poll(client, browser_id=browser_id)

    def badge():
        r = client.get(
            "/api/notifications/badge?todo_mode=true",
            headers=bid_headers(browser_id),
        )
        assert r.status_code == 200, r.text
        return r.json()["count"]

    before = badge()
    assert before >= 1  # the fresh open poll the creator hasn't voted on
    client.post(
        f"/api/polls/{poll['id']}/follow-state",
        json={"state": "old"},
        headers=bid_headers(browser_id),
    )
    assert badge() == before - 1


# === Migration 142: auto-age finished polls into Old (for everyone, one-time) ===


def test_closing_nontime_poll_files_it_old_for_everyone(client, browser_id):
    """A closed non-time poll auto-moves to Old for the creator AND a second
    member (no explicit ✕ needed). The inline close path stamps auto_aged_at."""
    poll = create_poll(client, browser_id=browser_id)
    other = str(uuid.uuid4())
    client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}", headers=bid_headers(other)
    )
    assert close_poll(client, poll).status_code == 200
    for bid in (browser_id, other):
        mp = _read_poll(client, poll["group_short_id"], poll["id"], bid)
        assert mp["viewer_follow_state"] == "old"


def test_readd_after_auto_age_returns_to_relevant(client, browser_id):
    """The aging is undoable: + after it aged brings it back to Relevant, and
    sticks. A second member who didn't + still sees it in Old."""
    poll = create_poll(client, browser_id=browser_id)
    other = str(uuid.uuid4())
    client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}", headers=bid_headers(other)
    )
    assert close_poll(client, poll).status_code == 200
    assert (
        _read_poll(client, poll["group_short_id"], poll["id"], browser_id)[
            "viewer_follow_state"
        ]
        == "old"
    )
    r = client.post(
        f"/api/polls/{poll['id']}/follow-state",
        json={"state": "new"},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 204, r.text
    assert (
        _read_poll(client, poll["group_short_id"], poll["id"], browser_id)[
            "viewer_follow_state"
        ]
        == "new"
    )
    # The other member never re-added → still Old.
    assert (
        _read_poll(client, poll["group_short_id"], poll["id"], other)[
            "viewer_follow_state"
        ]
        == "old"
    )


def test_reopen_clears_auto_age(client, browser_id):
    """Reopening a poll un-dones it: auto_aged_at is cleared, so it leaves Old."""
    poll = create_poll(client, browser_id=browser_id)
    assert close_poll(client, poll).status_code == 200
    assert (
        _read_poll(client, poll["group_short_id"], poll["id"], browser_id)[
            "viewer_follow_state"
        ]
        == "old"
    )
    assert reopen_poll(client, poll).status_code == 200
    assert (
        _read_poll(client, poll["group_short_id"], poll["id"], browser_id)[
            "viewer_follow_state"
        ]
        == "new"
    )


def test_auto_age_overrides_pre_aging_state_once_then_readd_wins():
    """A + tapped BEFORE aging is overridden once (→ old); a + tapped AFTER
    aging wins (→ new). Auto-aging never adds to the push/badge suppression set
    (`old_poll_ids_for_browsers`) — only an explicit ✕ does."""
    a = str(uuid.uuid4())
    with get_db() as conn:
        gid, poll_id = _new_group_and_poll(conn)
        # Pre-aging + (follow row), THEN age (clock_timestamp advances per stmt).
        set_follow_state(conn, poll_id, a, "new")
        conn.execute(
            "UPDATE polls SET auto_aged_at = clock_timestamp() WHERE id = %s::uuid",
            (poll_id,),
        )
        assert effective_follow_states(conn, [poll_id], browser_ids=[a]) == {
            poll_id: "old"
        }
        # The auto-aged poll is NOT a push/badge-suppressed 'old' (no explicit ✕).
        assert old_poll_ids_for_browsers(conn, [a]) == set()

        # + again, now AFTER aging → wins.
        set_follow_state(conn, poll_id, a, "new")
        assert effective_follow_states(conn, [poll_id], browser_ids=[a]) == {
            poll_id: "new"
        }
        conn.execute("DELETE FROM groups WHERE id = %s", (gid,))


def test_auto_aged_with_no_follow_row_reads_old_but_not_suppressed():
    b = str(uuid.uuid4())
    with get_db() as conn:
        gid, poll_id = _new_group_and_poll(conn)
        conn.execute(
            "UPDATE polls SET auto_aged_at = clock_timestamp() WHERE id = %s::uuid",
            (poll_id,),
        )
        assert effective_follow_states(conn, [poll_id], browser_ids=[b]) == {
            poll_id: "old"
        }
        # No explicit ✕ → not suppressed → a poll-closed push still reaches them.
        assert old_poll_ids_for_browsers(conn, [b]) == set()
        conn.execute("DELETE FROM groups WHERE id = %s", (gid,))


def test_maybe_auto_age_poll_gating():
    """Only a closed poll ages; idempotent once stamped. (A poll with no
    time/showtime question is 'done' the moment it closes — here a
    zero-question poll vacuously satisfies that.)"""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        gid, poll_id = _new_group_and_poll(conn)
        assert maybe_auto_age_poll(conn, poll_id, now) is False  # still open
        conn.execute(
            "UPDATE polls SET is_closed = true WHERE id = %s::uuid", (poll_id,)
        )
        assert maybe_auto_age_poll(conn, poll_id, now) is True  # closed → ages
        assert maybe_auto_age_poll(conn, poll_id, now) is False  # already aged
        conn.execute("DELETE FROM groups WHERE id = %s", (gid,))


def test_time_outcome_settled_branches():
    """_time_outcome_settled: future winning slot blocks aging; a past slot,
    cancelled event, and no-winner all count as settled. The question id is
    bogus (no votes), so the only signal is options / time_event_cancelled."""
    now = datetime.now(timezone.utc)

    def q(options, cancelled=False, qtype="time"):
        return {
            "id": str(uuid.uuid4()),
            "question_type": qtype,
            "title": "t",
            "created_at": now,
            "response_deadline": None,
            "options": options,
            "time_event_cancelled": cancelled,
        }

    with get_db() as conn:
        # Upcoming winning slot → NOT settled (poll stays out of Old).
        assert _time_outcome_settled(conn, q(["2099-06-10 19:00-21:00"]), now) is False
        # Past winning slot → settled.
        assert _time_outcome_settled(conn, q(["2000-06-10 19:00-21:00"]), now) is True
        # Cancelled event → settled.
        assert _time_outcome_settled(conn, q([], cancelled=True), now) is True
        # No winner (no finalized slots) → settled.
        assert _time_outcome_settled(conn, q([]), now) is True
        # Showtime behaves the same (future slot blocks).
        assert (
            _time_outcome_settled(conn, q(["2099-06-10 19:00-21:00"], qtype="showtime"), now)
            is False
        )
