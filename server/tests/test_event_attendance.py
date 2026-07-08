"""Event layer Phase 1 (migration 146, docs/event-layer-plan.md).

A closed poll whose time question produced a winning slot HAS an event:
attendees are PRESUMED IN from their ballots (availability covering the
winner, or not-disliking it), with `event_attendance` rows as the per-person
exceptions ('out' = back-out, 'in' = late opt-in). Covers derivation for both
the preference-only and availability flows, the back-out/opt-in round trip,
the member gate, and endpoint validation.
"""

import uuid

from tests.conftest import (
    bid_headers,
    close_poll,
    create_poll,
    creator_headers,
)

DAY = "2030-01-01"
ONE_HOUR = {
    "minEnabled": True,
    "minValue": 1,
    "maxEnabled": True,
    "maxValue": 1,
}


def _time_poll(client, creator_bid, *, availability_phase=False, windows=None):
    """A single-time-question poll. Without an availability phase the slots
    finalize at create (voters go straight to like/dislike); with one, voters
    submit windows first and the creator cuts the phase off."""
    q = {
        "question_type": "time",
        "category": "time",
        "day_time_windows": windows
        or [{"day": DAY, "windows": [{"min": "09:00", "max": "12:00"}]}],
        "duration_window": ONE_HOUR,
    }
    kwargs = {}
    if availability_phase:
        q["suggestion_deadline_minutes"] = 120
        kwargs["prephase_deadline_minutes"] = 120  # poll-level arm (mig 118)
    return create_poll(client, browser_id=creator_bid, questions=[q], **kwargs)


def _vote(client, poll, bid, name, *, liked=None, disliked=None,
          windows=None, abstain=False):
    item = {
        "question_id": poll["questions"][0]["id"],
        "vote_type": "time",
    }
    if abstain:
        item["is_abstain"] = True
    else:
        if windows is not None:
            item["voter_day_time_windows"] = windows
        if liked is not None:
            item["liked_slots"] = liked
        if disliked is not None:
            item["disliked_slots"] = disliked
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        headers=bid_headers(bid),
        json={"voter_name": name, "items": [item]},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_event(client, poll, bid, expect_status=200):
    r = client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}"
        f"/poll/{poll['short_id']}/event",
        headers=bid_headers(bid),
    )
    assert r.status_code == expect_status, r.text
    return r.json() if expect_status == 200 else None


def _set_attendance(client, poll, bid, status, expect=204):
    r = client.post(
        f"/api/polls/{poll['id']}/attendance",
        json={"status": status},
        headers=bid_headers(bid),
    )
    assert r.status_code == expect, r.text


def _names(event, status=None):
    return sorted(
        a["name"]
        for a in event["attendees"]
        if status is None or a["status"] == status
    )


def test_open_poll_has_no_event(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(client, creator)
    ev = _get_event(client, poll, creator)
    assert ev["has_event"] is False
    assert ev["attendees"] == []


def test_yes_no_poll_has_no_event(client, browser_id):
    poll = create_poll(client, browser_id=browser_id)  # default yes_no
    assert close_poll(client, poll).status_code == 200
    ev = _get_event(client, poll, browser_id)
    assert ev["has_event"] is False


def test_decided_poll_presumes_non_disliking_voters_in(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(client, creator)
    options = poll["questions"][0]["options"]
    s_early, s_mid = options[0], options[1]

    alice, bob, carol, erin = (str(uuid.uuid4()) for _ in range(4))
    _vote(client, poll, alice, "Alice", liked=[s_mid])
    _vote(client, poll, bob, "Bob", liked=[s_mid])
    _vote(client, poll, carol, "Carol", liked=[s_mid], disliked=[s_early])
    _vote(client, poll, erin, "Erin", abstain=True)
    assert close_poll(client, poll).status_code == 200

    ev = _get_event(client, poll, alice)
    assert ev["has_event"] is True
    # fewest dislikes excludes s_early; most likes → s_mid.
    assert ev["slot_key"] == s_mid
    assert ev["in_count"] == 3
    assert _names(ev) == ["Alice", "Bob", "Carol"]  # abstainer excluded
    assert ev["viewer_status"] == "in"
    # Viewer sorts first.
    assert ev["attendees"][0]["name"] == "Alice"
    assert ev["attendees"][0]["is_viewer"] is True


def test_back_out_and_rejoin(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(client, creator)
    s = poll["questions"][0]["options"][0]
    alice, bob = str(uuid.uuid4()), str(uuid.uuid4())
    _vote(client, poll, alice, "Alice", liked=[s])
    _vote(client, poll, bob, "Bob", liked=[s])
    assert close_poll(client, poll).status_code == 200

    _set_attendance(client, poll, bob, "out")
    ev = _get_event(client, poll, bob)
    assert ev["in_count"] == 1
    assert ev["viewer_status"] == "out"
    assert _names(ev, "out") == ["Bob"]
    # Alice's view is unaffected except the count.
    ev_a = _get_event(client, poll, alice)
    assert ev_a["viewer_status"] == "in"
    assert ev_a["in_count"] == 1

    _set_attendance(client, poll, bob, "in")
    ev = _get_event(client, poll, bob)
    assert ev["in_count"] == 2
    assert ev["viewer_status"] == "in"


def test_late_opt_in_from_non_voter(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(client, creator)
    s = poll["questions"][0]["options"][0]
    alice = str(uuid.uuid4())
    _vote(client, poll, alice, "Alice", liked=[s])
    assert close_poll(client, poll).status_code == 200

    dave = str(uuid.uuid4())
    # Dave joins the (public) group by visiting it, then opts in.
    client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}",
        headers=bid_headers(dave),
    )
    ev = _get_event(client, poll, dave)
    assert ev["viewer_status"] is None
    _set_attendance(client, poll, dave, "in")
    ev = _get_event(client, poll, dave)
    assert ev["viewer_status"] == "in"
    assert ev["in_count"] == 2
    # The opt-in row has no account → nameless attendee chip.
    assert any(a["is_viewer"] and a["name"] is None for a in ev["attendees"])


def test_availability_based_derivation(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(
        client,
        creator,
        availability_phase=True,
        windows=[{"day": DAY, "windows": [{"min": "09:00", "max": "17:00"}]}],
    )
    alice, bob, carol = (str(uuid.uuid4()) for _ in range(3))
    morning = [{"day": DAY, "windows": [{"min": "09:00", "max": "12:00"}]}]
    afternoon = [{"day": DAY, "windows": [{"min": "13:00", "max": "17:00"}]}]
    _vote(client, poll, alice, "Alice", windows=morning)
    _vote(client, poll, bob, "Bob", windows=morning)
    _vote(client, poll, carol, "Carol", windows=afternoon)

    r = client.post(
        f"/api/polls/{poll['id']}/cutoff-availability",
        json={},
        headers=creator_headers(poll),
    )
    assert r.status_code == 200, r.text
    assert close_poll(client, poll).status_code == 200

    ev = _get_event(client, poll, alice)
    assert ev["has_event"] is True
    # min_participants default (2) keeps only the morning slots (Alice+Bob);
    # no preferences → earliest surviving slot wins.
    assert ev["slot_key"].startswith(f"{DAY} 09:00")
    assert _names(ev) == ["Alice", "Bob"]  # Carol isn't available → not presumed
    assert ev["in_count"] == 2


def test_event_endpoint_is_member_gated(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(client, creator)
    assert close_poll(client, poll).status_code == 200
    stranger = str(uuid.uuid4())
    r = client.get(
        f"/api/groups/by-route-id/{poll['group_short_id']}"
        f"/poll/{poll['short_id']}/event",
        headers=bid_headers(stranger),
    )
    # This endpoint (like /voter-identities) never writes membership, and the
    # stranger never visited the group URL — the member gate 404s.
    assert r.status_code == 404


def test_attendance_endpoint_validation(client):
    creator = str(uuid.uuid4())
    poll = _time_poll(client, creator)
    _set_attendance(client, poll, creator, "maybe", expect=400)
    r = client.post(
        f"/api/polls/{uuid.uuid4()}/attendance",
        json={"status": "out"},
        headers=bid_headers(creator),
    )
    assert r.status_code == 404
