"""Playlist slots (migration 148): create round-trip, the 3-group activity
suggestion ranking (overlap / yours / others, no cross-group dupes), and the
account-synced blacklist filtering + editing."""

import uuid

from tests.conftest import bid_headers


def _dtw(day: str, min_: str = "09:00", max_: str = "17:00") -> list[dict]:
    return [{"day": day, "windows": [{"min": min_, "max": max_}]}]


def _create_slot(client, *, browser_id, day_time_windows, activities):
    return client.post(
        "/api/slots",
        json={"day_time_windows": day_time_windows, "activities": activities},
        headers=bid_headers(browser_id),
    )


def _suggestions(client, *, browser_id, day_time_windows):
    return client.post(
        "/api/slots/suggestions",
        json={"day_time_windows": day_time_windows},
        headers=bid_headers(browser_id),
    )


def test_create_slot_round_trip(client):
    bid = str(uuid.uuid4())
    r = _create_slot(client, browser_id=bid, day_time_windows=_dtw("2026-08-01"), activities=["Hiking", "hiking", " "])
    assert r.status_code == 200, r.text
    assert "id" in r.json()


def test_suggestions_group_overlapping_and_others_no_dupes(client):
    day = "2026-08-10"
    other = str(uuid.uuid4())
    # Another user tags "Board games" on an OVERLAPPING window and "Sailing"
    # on a NON-overlapping day.
    _create_slot(client, browser_id=other, day_time_windows=_dtw(day, "10:00", "12:00"), activities=["Board games"])
    _create_slot(client, browser_id=other, day_time_windows=_dtw("2026-09-01"), activities=["Sailing"])

    me = str(uuid.uuid4())
    r = _suggestions(client, browser_id=me, day_time_windows=_dtw(day, "11:00", "13:00"))
    assert r.status_code == 200, r.text
    body = r.json()
    # "Board games" overlaps → group 1.
    assert "Board games" in body["overlapping"]
    # "Sailing" is another user's, non-overlapping → group 3 only.
    assert "Sailing" in body["others"]
    assert "Sailing" not in body["overlapping"]
    # No activity appears in more than one group.
    seen = body["overlapping"] + body["yours"] + body["others"]
    assert len(seen) == len(set(a.lower() for a in seen))


def test_suggestions_yours_group(client):
    day = "2026-08-15"
    me = str(uuid.uuid4())
    _create_slot(client, browser_id=me, day_time_windows=_dtw("2026-01-01"), activities=["Pottery"])
    # A brand-new selection (no overlap with my old slot) still surfaces my
    # past activity under "yours".
    r = _suggestions(client, browser_id=me, day_time_windows=_dtw(day))
    assert r.status_code == 200
    assert "Pottery" in r.json()["yours"]


def test_blacklist_filters_and_round_trips(client):
    day = "2026-08-20"
    other = str(uuid.uuid4())
    _create_slot(client, browser_id=other, day_time_windows=_dtw(day), activities=["Karaoke"])

    me = str(uuid.uuid4())
    # Must have an account for the blacklist to persist — creating a slot
    # mints one bound to this browser.
    _create_slot(client, browser_id=me, day_time_windows=_dtw("2026-02-02"), activities=["Yoga"])

    # Karaoke shows up (overlapping other user) before blacklisting.
    before = _suggestions(client, browser_id=me, day_time_windows=_dtw(day)).json()
    assert "Karaoke" in before["overlapping"]

    r = client.post("/api/users/me/activity-blacklist", json={"activity": "karaoke"}, headers=bid_headers(me))
    assert r.status_code == 200, r.text
    assert any(a.lower() == "karaoke" for a in r.json()["activities"])

    after = _suggestions(client, browser_id=me, day_time_windows=_dtw(day)).json()
    assert "Karaoke" not in after["overlapping"]
    assert "Karaoke" not in after["others"]

    # Remove it and it comes back.
    r = client.request("DELETE", "/api/users/me/activity-blacklist", json={"activity": "Karaoke"}, headers=bid_headers(me))
    assert r.status_code == 200, r.text
    assert not any(a.lower() == "karaoke" for a in r.json()["activities"])
    restored = _suggestions(client, browser_id=me, day_time_windows=_dtw(day)).json()
    assert "Karaoke" in restored["overlapping"]


def test_get_blacklist_empty_for_new_browser(client):
    r = client.get("/api/users/me/activity-blacklist", headers=bid_headers(str(uuid.uuid4())))
    assert r.status_code == 200
    assert r.json()["activities"] == []
