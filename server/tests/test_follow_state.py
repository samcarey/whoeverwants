"""Gap 1: per-poll follow/ignore state ("To Do · New · Old").

Covers the round-trip (new → old → new) surfaced on the group read's
`viewer_follow_state`, per-browser isolation, the endpoint's validation, the
recency tiebreak + `old_poll_ids_for_browsers` unit behavior, and the
to-do-badge suppression for ✕'d polls.
"""

import uuid

from tests.conftest import bid_headers, create_poll
from database import get_db
from services.follow_state import (
    effective_follow_states,
    old_poll_ids_for_browsers,
    set_follow_state,
)


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
