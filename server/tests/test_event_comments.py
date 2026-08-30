"""Event comments (migration 157): the poll-comments model keyed on the
event's (day, LOWER(activity)) identity — candidates-only access, account-
aware ownership, and the shared reaction machinery over the event table."""

import uuid
from datetime import date, timedelta

from tests.conftest import bid_headers


def _act(base: str) -> str:
    return f"{base} {uuid.uuid4().hex[:6]}"


def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def _dtw(day: str) -> list[dict]:
    return [{"day": day, "windows": [{"min": "09:00", "max": "17:00"}]}]


def _make_candidate(client, browser_id, day, activity):
    r = client.post(
        "/api/slots",
        json={"day_time_windows": _dtw(day), "activities": [{"name": activity}]},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 200, r.text


def _post(client, browser_id, day, activity, body, name="Commenter"):
    return client.post(
        "/api/slots/events/comments",
        json={"day": day, "activity": activity, "commenter_name": name, "body": body},
        headers=bid_headers(browser_id),
    )


def _list(client, browser_id, day, activity):
    return client.get(
        f"/api/slots/events/comments?day={day}&activity={activity}",
        headers=bid_headers(browser_id),
    )


def test_candidate_posts_and_lists(client):
    bid = str(uuid.uuid4())
    act, day = _act("Karaoke"), _day(3)
    _make_candidate(client, bid, day, act)
    r = _post(client, bid, day, act, "who's driving?", name="Dana")
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["is_mine"] is True
    assert created["commenter_name"] == "Dana"
    assert created["body"] == "who's driving?"

    listed = _list(client, bid, day, act)
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert [c["body"] for c in rows] == ["who's driving?"]
    assert rows[0]["is_mine"] is True


def test_non_candidate_gets_404(client):
    a, stranger = str(uuid.uuid4()), str(uuid.uuid4())
    act, day = _act("Bowling"), _day(3)
    _make_candidate(client, a, day, act)
    assert _list(client, stranger, day, act).status_code == 404
    assert _post(client, stranger, day, act, "hi").status_code == 404


def test_other_candidate_sees_not_mine_and_cannot_edit(client):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    act, day = _act("Tennis"), _day(4)
    _make_candidate(client, a, day, act)
    _make_candidate(client, b, day, act)
    cid = _post(client, a, day, act, "bring rackets", name="Alex").json()["id"]

    rows = _list(client, b, day, act).json()
    assert rows[0]["is_mine"] is False

    # B can't edit or delete A's comment (ownership folded into the WHERE).
    r = client.put(
        f"/api/slots/events/comments/{cid}",
        json={"body": "hacked"},
        headers=bid_headers(b),
    )
    assert r.status_code == 404
    r = client.delete(f"/api/slots/events/comments/{cid}", headers=bid_headers(b))
    assert r.status_code == 404

    # A edits + deletes their own.
    r = client.put(
        f"/api/slots/events/comments/{cid}",
        json={"body": "bring rackets AND water"},
        headers=bid_headers(a),
    )
    assert r.status_code == 200, r.text
    assert r.json()["edited_at"] is not None
    assert client.delete(
        f"/api/slots/events/comments/{cid}", headers=bid_headers(a)
    ).status_code == 204


def test_reaction_toggle_round_trip(client):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    act, day = _act("Hike"), _day(5)
    _make_candidate(client, a, day, act)
    _make_candidate(client, b, day, act)
    cid = _post(client, a, day, act, "sunrise start?", name="Priya").json()["id"]

    r = client.post(
        f"/api/slots/events/comments/{cid}/reactions",
        json={"emoji": "👍"},
        headers=bid_headers(b),
    )
    assert r.status_code == 200, r.text
    assert r.json() == [{"emoji": "👍", "count": 1, "mine": True}]

    # A sees the count without `mine`.
    rows = _list(client, a, day, act).json()
    assert rows[0]["reactions"] == [{"emoji": "👍", "count": 1, "mine": False}]

    # Toggling again removes it.
    r = client.post(
        f"/api/slots/events/comments/{cid}/reactions",
        json={"emoji": "👍"},
        headers=bid_headers(b),
    )
    assert r.status_code == 200
    assert r.json() == []


def test_name_and_body_required(client):
    bid = str(uuid.uuid4())
    act, day = _act("Chess"), _day(6)
    _make_candidate(client, bid, day, act)
    r = client.post(
        "/api/slots/events/comments",
        json={"day": day, "activity": act, "commenter_name": "", "body": "hi"},
        headers=bid_headers(bid),
    )
    assert r.status_code == 400
    assert _post(client, bid, day, act, "   ").status_code == 400
