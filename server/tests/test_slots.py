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


def _list_slots(client, *, browser_id):
    return client.get("/api/slots", headers=bid_headers(browser_id))


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
    over_names = [a["name"] for a in body["overlapping"]]
    others_names = [a["name"] for a in body["others"]]
    # "Board games" overlaps → group 1.
    assert "Board games" in over_names
    # "Sailing" is another user's, non-overlapping → group 3 only.
    assert "Sailing" in others_names
    assert "Sailing" not in over_names
    # No activity appears in more than one group.
    seen = [a["name"] for a in body["overlapping"] + body["yours"] + body["others"]]
    assert len(seen) == len(set(a.lower() for a in seen))


def test_suggestions_yours_group(client):
    day = "2026-08-15"
    me = str(uuid.uuid4())
    _create_slot(client, browser_id=me, day_time_windows=_dtw("2026-01-01"), activities=["Pottery"])
    # A brand-new selection (no overlap with my old slot) still surfaces my
    # past activity under "yours".
    r = _suggestions(client, browser_id=me, day_time_windows=_dtw(day))
    assert r.status_code == 200
    assert "Pottery" in [a["name"] for a in r.json()["yours"]]


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
    assert "Karaoke" in [a["name"] for a in before["overlapping"]]

    r = client.post("/api/users/me/activity-blacklist", json={"activity": "karaoke"}, headers=bid_headers(me))
    assert r.status_code == 200, r.text
    assert any(a.lower() == "karaoke" for a in r.json()["activities"])

    after = _suggestions(client, browser_id=me, day_time_windows=_dtw(day)).json()
    assert "Karaoke" not in [a["name"] for a in after["overlapping"]]
    assert "Karaoke" not in [a["name"] for a in after["others"]]

    # Remove it and it comes back.
    r = client.request("DELETE", "/api/users/me/activity-blacklist", json={"activity": "Karaoke"}, headers=bid_headers(me))
    assert r.status_code == 200, r.text
    assert not any(a.lower() == "karaoke" for a in r.json()["activities"])
    restored = _suggestions(client, browser_id=me, day_time_windows=_dtw(day)).json()
    assert "Karaoke" in [a["name"] for a in restored["overlapping"]]


def test_get_blacklist_empty_for_new_browser(client):
    r = client.get("/api/users/me/activity-blacklist", headers=bid_headers(str(uuid.uuid4())))
    assert r.status_code == 200
    assert r.json()["activities"] == []


def test_create_slot_accepts_mixed_string_and_object_activities(client):
    # A bare string + a {name, emoji} object both persist (the wire coerces
    # strings to {name}).
    bid = str(uuid.uuid4())
    r = _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-10-10"),
        activities=["Hiking", {"name": "Climbing", "emoji": "🧗"}],
    )
    assert r.status_code == 200, r.text


def test_list_slots_round_trip(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-11-01", "10:00", "12:15"),
        activities=[{"name": "Bowling", "emoji": "🎳"}, "Coffee"],
    )
    r = _list_slots(client, browser_id=bid)
    assert r.status_code == 200, r.text
    slots = r.json()["slots"]
    assert len(slots) == 1
    s = slots[0]
    assert s["day_time_windows"] == _dtw("2026-11-01", "10:00", "12:15")
    names = [(a["name"], a["emoji"]) for a in s["activities"]]
    assert ("Bowling", "🎳") in names
    assert ("Coffee", None) in names


def test_activity_participant_range_round_trips(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-11-01", "10:00", "12:15"),
        activities=[
            {"name": "Poker", "min_people": 2, "max_people": 6},
            {"name": "Reading", "min_people": 3},  # min only
            {"name": "Movie", "max_people": 8},  # max only
            {"name": "Walk"},  # neither
        ],
    )
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    by_name = {a["name"]: a for a in s["activities"]}
    assert (by_name["Poker"]["min_people"], by_name["Poker"]["max_people"]) == (2, 6)
    assert (by_name["Reading"]["min_people"], by_name["Reading"]["max_people"]) == (3, None)
    assert (by_name["Movie"]["min_people"], by_name["Movie"]["max_people"]) == (None, 8)
    assert (by_name["Walk"]["min_people"], by_name["Walk"]["max_people"]) == (None, None)


def test_activity_participant_range_sanitized(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-11-01"),
        # min > max is bumped up; < 1 becomes unset; huge caps to MAX_PEOPLE.
        activities=[
            {"name": "Debate", "min_people": 5, "max_people": 2},
            {"name": "Solo", "min_people": 0, "max_people": 5000},
        ],
    )
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    by_name = {a["name"]: a for a in s["activities"]}
    assert (by_name["Debate"]["min_people"], by_name["Debate"]["max_people"]) == (5, 5)
    assert by_name["Solo"]["min_people"] is None
    assert by_name["Solo"]["max_people"] == 999


def test_activity_who_with_round_trips(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-11-01"),
        activities=[
            {
                "name": "Hiking",
                "who_with": [
                    {"min_people": 2, "max_people": 5, "groups": ["Climbing Crew"]},
                    {"min_people": 2, "max_people": 3, "people": ["Alex"]},
                ],
            },
            {"name": "Coffee"},  # no entries → null
        ],
    )
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    by_name = {a["name"]: a for a in s["activities"]}
    ww = by_name["Hiking"]["who_with"]
    assert len(ww) == 2
    assert ww[0] == {"min_people": 2, "max_people": 5, "groups": ["Climbing Crew"], "people": None}
    assert ww[1] == {"min_people": 2, "max_people": 3, "groups": None, "people": ["Alex"]}
    assert by_name["Coffee"]["who_with"] is None


def test_activity_who_with_sanitized(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-11-01"),
        activities=[
            {
                "name": "Games",
                "who_with": [
                    # min > max bumps max up; blank names dropped.
                    {"min_people": 6, "max_people": 2, "people": ["  Priya  ", "   "]},
                    # Entirely empty entry → dropped.
                    {"groups": [], "people": []},
                ],
            },
            # Every entry empty → who_with stored NULL, not [].
            {"name": "Chess", "who_with": [{}]},
        ],
    )
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    by_name = {a["name"]: a for a in s["activities"]}
    ww = by_name["Games"]["who_with"]
    assert len(ww) == 1
    assert ww[0] == {"min_people": 6, "max_people": 6, "groups": None, "people": ["Priya"]}
    assert by_name["Chess"]["who_with"] is None


def test_update_slot_preserves_who_with_when_resent(client):
    """The FE's edit-time save re-sends the slot's activities verbatim — the
    who_with entries must survive the wholesale delete + re-insert."""
    bid = str(uuid.uuid4())
    slot_id = _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw("2026-11-01"),
        activities=[{"name": "Hiking", "who_with": [{"min_people": 2, "groups": ["Crew"]}]}],
    ).json()["id"]
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    r = client.put(
        f"/api/slots/{slot_id}",
        json={"day_time_windows": _dtw("2026-11-02"), "activities": s["activities"]},
        headers=bid_headers(bid),
    )
    assert r.status_code == 200
    s2 = _list_slots(client, browser_id=bid).json()["slots"][0]
    assert s2["day_time_windows"][0]["day"] == "2026-11-02"
    assert s2["activities"][0]["who_with"] == [
        {"min_people": 2, "max_people": None, "groups": ["Crew"], "people": None}
    ]


def test_list_slots_empty_for_new_browser(client):
    r = _list_slots(client, browser_id=str(uuid.uuid4()))
    assert r.status_code == 200
    assert r.json()["slots"] == []


def test_list_slots_scoped_to_owner(client):
    a = str(uuid.uuid4())
    b = str(uuid.uuid4())
    _create_slot(client, browser_id=a, day_time_windows=_dtw("2026-11-02"), activities=["Yoga"])
    # A fresh browser sees none of A's slots (its own account is separate).
    r = _list_slots(client, browser_id=b)
    assert r.status_code == 200
    assert r.json()["slots"] == []


def test_update_slot_replaces_windows_and_activities(client):
    bid = str(uuid.uuid4())
    r = _create_slot(client, browser_id=bid, day_time_windows=_dtw("2026-11-03"), activities=["Hiking"])
    slot_id = r.json()["id"]

    r = client.put(
        f"/api/slots/{slot_id}",
        json={
            "day_time_windows": _dtw("2026-11-04", "14:00", "16:00"),
            "activities": [{"name": "Climbing", "emoji": "🧗"}],
        },
        headers=bid_headers(bid),
    )
    assert r.status_code == 200, r.text

    slots = _list_slots(client, browser_id=bid).json()["slots"]
    assert len(slots) == 1
    s = slots[0]
    assert s["day_time_windows"] == _dtw("2026-11-04", "14:00", "16:00")
    assert [(a["name"], a["emoji"]) for a in s["activities"]] == [("Climbing", "🧗")]


def test_update_slot_404_for_non_owner(client):
    owner = str(uuid.uuid4())
    r = _create_slot(client, browser_id=owner, day_time_windows=_dtw("2026-11-05"), activities=["Yoga"])
    slot_id = r.json()["id"]
    other = str(uuid.uuid4())
    r = client.put(
        f"/api/slots/{slot_id}",
        json={"day_time_windows": _dtw("2026-11-06"), "activities": ["Nope"]},
        headers=bid_headers(other),
    )
    assert r.status_code == 404


def test_update_slot_malformed_id_404_not_500(client):
    r = client.put(
        "/api/slots/not-a-uuid",
        json={"day_time_windows": _dtw("2026-11-07"), "activities": []},
        headers=bid_headers(str(uuid.uuid4())),
    )
    assert r.status_code == 404


def test_delete_slot_removes_it(client):
    bid = str(uuid.uuid4())
    r = _create_slot(client, browser_id=bid, day_time_windows=_dtw("2026-11-08"), activities=["Hiking"])
    slot_id = r.json()["id"]
    r = client.delete(f"/api/slots/{slot_id}", headers=bid_headers(bid))
    assert r.status_code == 204, r.text
    assert _list_slots(client, browser_id=bid).json()["slots"] == []


def test_delete_slot_404_for_non_owner(client):
    owner = str(uuid.uuid4())
    r = _create_slot(client, browser_id=owner, day_time_windows=_dtw("2026-11-09"), activities=["Yoga"])
    slot_id = r.json()["id"]
    r = client.delete(f"/api/slots/{slot_id}", headers=bid_headers(str(uuid.uuid4())))
    assert r.status_code == 404
    # Still there for the owner.
    assert len(_list_slots(client, browser_id=owner).json()["slots"]) == 1


def test_activity_emoji_round_trips_into_suggestions(client):
    day = "2026-10-05"
    other = str(uuid.uuid4())
    # Another user tags an activity WITH an emoji on an overlapping window.
    r = _create_slot(
        client,
        browser_id=other,
        day_time_windows=_dtw(day, "10:00", "12:00"),
        activities=[{"name": "Bowling", "emoji": "🎳"}],
    )
    assert r.status_code == 200, r.text

    me = str(uuid.uuid4())
    body = _suggestions(client, browser_id=me, day_time_windows=_dtw(day, "11:00", "13:00")).json()
    match = next((a for a in body["overlapping"] if a["name"] == "Bowling"), None)
    assert match is not None
    # The suggestion carries the tagging user's emoji.
    assert match["emoji"] == "🎳"
