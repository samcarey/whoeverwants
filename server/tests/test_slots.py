"""Playlist slots (migration 148): create round-trip, the 3-group activity
suggestion ranking (overlap / yours / others, no cross-group dupes), the
account-synced blacklist filtering + editing, and the per-activity "who with"
condition (reference shape, identity resolution, and the picker's
candidates)."""

import uuid
from datetime import date, datetime, timedelta, timezone

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL, bid_headers


def _day(offset: int) -> str:
    """A day `offset` days from today. Any test that LISTS slots must use a
    FUTURE day — the list endpoint reaps fully-past slots, so a hardcoded date
    would silently start failing the suite once it went by."""
    return (date.today() + timedelta(days=offset)).isoformat()


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


def _candidates(client, *, browser_id, kind=None):
    r = client.get("/api/slots/who-with-candidates", headers=bid_headers(browser_id))
    assert r.status_code == 200, r.text
    rows = r.json()["candidates"]
    return [c for c in rows if kind is None or c["kind"] == kind]


def _ref(name: str, id_: str | None = None) -> dict:
    return {"id": id_, "name": name}


def _entry(min_people, max_people, **lists) -> dict:
    """A who-with entry as the API returns it — every list key present, absent
    ones null."""
    out = {"min_people": min_people, "max_people": max_people}
    for k in ("groups", "people", "exclude_groups", "exclude_people"):
        out[k] = lists.get(k)
    return out


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
        day_time_windows=_dtw(_day(1), "10:00", "12:15"),
        activities=[{"name": "Bowling", "emoji": "🎳"}, "Coffee"],
    )
    r = _list_slots(client, browser_id=bid)
    assert r.status_code == 200, r.text
    slots = r.json()["slots"]
    assert len(slots) == 1
    s = slots[0]
    assert s["day_time_windows"] == _dtw(_day(1), "10:00", "12:15")
    names = [(a["name"], a["emoji"]) for a in s["activities"]]
    assert ("Bowling", "🎳") in names
    assert ("Coffee", None) in names


def test_activity_participant_range_round_trips(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw(_day(1), "10:00", "12:15"),
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
        day_time_windows=_dtw(_day(1)),
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
        day_time_windows=_dtw(_day(1)),
        activities=[
            {
                "name": "Hiking",
                "who_with": [
                    # Bare strings are still accepted (older clients / raw API)
                    # and land as name-only refs.
                    {"min_people": 2, "max_people": 5, "groups": ["Climbing Crew"]},
                    {"min_people": 2, "max_people": 3, "people": [{"name": "Alex"}]},
                ],
            },
            {"name": "Coffee"},  # no entries → null
        ],
    )
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    by_name = {a["name"]: a for a in s["activities"]}
    ww = by_name["Hiking"]["who_with"]
    assert len(ww) == 2
    assert ww[0] == _entry(2, 5, groups=[_ref("Climbing Crew")])
    assert ww[1] == _entry(2, 3, people=[_ref("Alex")])
    assert by_name["Coffee"]["who_with"] is None


def test_activity_who_with_sanitized(client):
    bid = str(uuid.uuid4())
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw(_day(1)),
        activities=[
            {
                "name": "Games",
                "who_with": [
                    # min > max bumps max up; blank names dropped.
                    {"min_people": 6, "max_people": 2, "people": ["  Priya  ", "   "]},
                    # An id the caller can't reach is NULLED, not dropped —
                    # the pick survives as a name-only condition.
                    {"exclude_groups": [{"id": str(uuid.uuid4()), "name": "Randos"}]},
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
    assert len(ww) == 2
    assert ww[0] == _entry(6, 6, people=[_ref("Priya")])
    assert ww[1] == _entry(None, None, exclude_groups=[_ref("Randos")])
    assert by_name["Chess"]["who_with"] is None


def test_update_slot_preserves_who_with_when_resent(client):
    """The FE's edit-time save re-sends the slot's activities verbatim — the
    who_with entries must survive the wholesale delete + re-insert."""
    bid = str(uuid.uuid4())
    slot_id = _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw(_day(1)),
        activities=[{"name": "Hiking", "who_with": [{"min_people": 2, "groups": ["Crew"]}]}],
    ).json()["id"]
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    r = client.put(
        f"/api/slots/{slot_id}",
        json={"day_time_windows": _dtw(_day(2)), "activities": s["activities"]},
        headers=bid_headers(bid),
    )
    assert r.status_code == 200
    s2 = _list_slots(client, browser_id=bid).json()["slots"][0]
    assert s2["day_time_windows"][0]["day"] == _day(2)
    assert s2["activities"][0]["who_with"] == [_entry(2, None, groups=[_ref("Crew")])]


def test_who_with_candidates_empty_for_new_browser(client):
    assert _candidates(client, browser_id=str(uuid.uuid4())) == []


def test_who_with_candidates_lists_the_callers_groups(client):
    """A group the caller is a member of is pickable, keyed on its real id. A
    brand-new group has no title and no participants, so it reads as the same
    "New Group" the FE shows for it."""
    bid = str(uuid.uuid4())
    group_id = client.post("/api/groups", headers=bid_headers(bid)).json()["id"]
    groups = _candidates(client, browser_id=bid, kind="groups")
    assert [g["id"] for g in groups] == [group_id]
    assert groups[0]["name"] == "New Group"


def test_who_with_candidates_rank_recently_picked_first(client):
    """The picker's order is "what you reached for last", so a group used in a
    who-with outranks one that has never been picked."""
    bid = str(uuid.uuid4())
    older = client.post("/api/groups", headers=bid_headers(bid)).json()["id"]
    newer = client.post("/api/groups", headers=bid_headers(bid)).json()["id"]
    # Name them so the alphabetical fallback would put "A…" first — the
    # recency sort has to override that to prove it is doing the work.
    for gid, title in ((older, "Aardvarks"), (newer, "Zebras")):
        client.post(f"/api/groups/{gid}/title", json={"group_title": title}, headers=bid_headers(bid))
    assert [g["name"] for g in _candidates(client, browser_id=bid, kind="groups")] == [
        "Aardvarks",
        "Zebras",
    ]
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw(_day(1)),
        activities=[{"name": "Hiking", "who_with": [{"groups": [{"id": newer, "name": "Zebras"}]}]}],
    )
    assert [g["name"] for g in _candidates(client, browser_id=bid, kind="groups")] == [
        "Zebras",
        "Aardvarks",
    ]


def test_who_with_group_id_resolves_and_refreshes_its_name(client):
    """A real membership keeps its id, and the stored display name is refreshed
    from the group so a rename doesn't leave the pick reading stale."""
    bid = str(uuid.uuid4())
    group_id = client.post("/api/groups", headers=bid_headers(bid)).json()["id"]
    client.post(f"/api/groups/{group_id}/title", json={"group_title": "Climbing Crew"}, headers=bid_headers(bid))
    _create_slot(
        client,
        browser_id=bid,
        day_time_windows=_dtw(_day(1)),
        # Deliberately stale name on the way in.
        activities=[{"name": "Hiking", "who_with": [{"groups": [{"id": group_id, "name": "Old Name"}]}]}],
    )
    s = _list_slots(client, browser_id=bid).json()["slots"][0]
    assert s["activities"][0]["who_with"] == [
        _entry(None, None, groups=[_ref("Climbing Crew", group_id)])
    ]


def test_who_with_group_id_of_a_group_youre_not_in_is_nulled(client):
    """Someone else's group id can't be laundered into a who-with by guessing
    it — the id is dropped, though the typed name survives."""
    owner, outsider = str(uuid.uuid4()), str(uuid.uuid4())
    group_id = client.post("/api/groups", headers=bid_headers(owner)).json()["id"]
    _create_slot(
        client,
        browser_id=outsider,
        day_time_windows=_dtw(_day(1)),
        activities=[{"name": "Hiking", "who_with": [{"groups": [{"id": group_id, "name": "Theirs"}]}]}],
    )
    s = _list_slots(client, browser_id=outsider).json()["slots"][0]
    assert s["activities"][0]["who_with"] == [_entry(None, None, groups=[_ref("Theirs")])]


def _sign_in(client, browser_id, name):
    """Magic-link verify → a signed-in account with a display name, so it can
    surface as somebody else's contact. Mirrors test_invite_members' helper;
    the who-with people list only ever holds NAMED accounts."""
    email = f"whowith-{uuid.uuid4().hex[:8]}@example.com"
    token = generate_token()
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            """
            INSERT INTO magic_link_tokens (token_hash, email, browser_id, expires_at)
            VALUES (%s, %s, %s, NOW() + INTERVAL '15 minutes')
            """,
            (hash_token(token), normalize_email(email), browser_id),
        )
        conn.commit()
    r = client.post("/api/auth/magic-link/verify", json={"token": token}, headers=bid_headers(browser_id))
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["user_id"]
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute("UPDATE users SET display_name = %s WHERE id = %s::uuid", (name, uid))
        conn.commit()
    return uid


def _share_a_group(client, a_browser, b_browser):
    """Put two browsers in one group so each becomes the other's contact."""
    gid = client.post("/api/groups", headers=bid_headers(a_browser)).json()["id"]
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) VALUES (%s::uuid, %s::uuid)"
            " ON CONFLICT DO NOTHING",
            (gid, b_browser),
        )
        conn.commit()
    return gid


def test_who_with_candidates_list_contacts(client):
    """People come from the caller's address book — the same population the
    invite-members picker uses — and the endpoint reconciles inline, so someone
    they only just started sharing a group with is immediately pickable."""
    me, them = str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, me, "Me")
    _sign_in(client, them, "Priya")
    _share_a_group(client, me, them)
    people = _candidates(client, browser_id=me, kind="people")
    assert [p["name"] for p in people] == ["Priya"]
    assert people[0]["id"]


def test_who_with_candidates_rank_across_groups_and_people(client):
    """The ranking is GLOBAL, not per kind: a person picked recently outranks
    a group that never was. Splitting the list by kind would make every group
    beat every person, which is not what "what I reached for last" means."""
    me, them = str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, me, "Me")
    them_uid = _sign_in(client, them, "Priya")
    _share_a_group(client, me, them)
    # Groups lead while nothing has been picked (everything ties).
    assert [c["kind"] for c in _candidates(client, browser_id=me)] == ["groups", "people"]

    _create_slot(
        client,
        browser_id=me,
        day_time_windows=_dtw(_day(1)),
        activities=[{"name": "Hiking", "who_with": [{"people": [{"id": them_uid, "name": "Priya"}]}]}],
    )
    assert [c["name"] for c in _candidates(client, browser_id=me)] == ["Priya", "New Group"]


def test_who_with_person_id_resolves_only_for_a_contact(client):
    """A contact's id sticks (and their name refreshes from the account); a
    stranger's id is nulled down to a name-only pick."""
    me, them, stranger = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, me, "Me")
    them_uid = _sign_in(client, them, "Priya")
    stranger_uid = _sign_in(client, stranger, "Nobody")
    _share_a_group(client, me, them)
    _candidates(client, browser_id=me)  # reconcile the address book

    _create_slot(
        client,
        browser_id=me,
        day_time_windows=_dtw(_day(1)),
        activities=[
            {
                "name": "Hiking",
                "who_with": [
                    {
                        "people": [{"id": them_uid, "name": "stale"}],
                        "exclude_people": [{"id": stranger_uid, "name": "Nobody"}],
                    }
                ],
            }
        ],
    )
    s = _list_slots(client, browser_id=me).json()["slots"][0]
    assert s["activities"][0]["who_with"] == [
        _entry(
            None, None,
            people=[_ref("Priya", them_uid)],
            exclude_people=[_ref("Nobody")],
        )
    ]


def test_list_slots_empty_for_new_browser(client):
    r = _list_slots(client, browser_id=str(uuid.uuid4()))
    assert r.status_code == 200
    assert r.json()["slots"] == []


def test_list_slots_scoped_to_owner(client):
    a = str(uuid.uuid4())
    b = str(uuid.uuid4())
    _create_slot(client, browser_id=a, day_time_windows=_dtw(_day(2)), activities=["Yoga"])
    # A fresh browser sees none of A's slots (its own account is separate).
    r = _list_slots(client, browser_id=b)
    assert r.status_code == 200
    assert r.json()["slots"] == []


def test_update_slot_replaces_windows_and_activities(client):
    bid = str(uuid.uuid4())
    r = _create_slot(client, browser_id=bid, day_time_windows=_dtw(_day(3)), activities=["Hiking"])
    slot_id = r.json()["id"]

    r = client.put(
        f"/api/slots/{slot_id}",
        json={
            "day_time_windows": _dtw(_day(4), "14:00", "16:00"),
            "activities": [{"name": "Climbing", "emoji": "🧗"}],
        },
        headers=bid_headers(bid),
    )
    assert r.status_code == 200, r.text

    slots = _list_slots(client, browser_id=bid).json()["slots"]
    assert len(slots) == 1
    s = slots[0]
    assert s["day_time_windows"] == _dtw(_day(4), "14:00", "16:00")
    assert [(a["name"], a["emoji"]) for a in s["activities"]] == [("Climbing", "🧗")]


def test_update_slot_404_for_non_owner(client):
    owner = str(uuid.uuid4())
    r = _create_slot(client, browser_id=owner, day_time_windows=_dtw(_day(5)), activities=["Yoga"])
    slot_id = r.json()["id"]
    other = str(uuid.uuid4())
    r = client.put(
        f"/api/slots/{slot_id}",
        json={"day_time_windows": _dtw(_day(6)), "activities": ["Nope"]},
        headers=bid_headers(other),
    )
    assert r.status_code == 404


def test_update_slot_malformed_id_404_not_500(client):
    r = client.put(
        "/api/slots/not-a-uuid",
        json={"day_time_windows": _dtw(_day(7)), "activities": []},
        headers=bid_headers(str(uuid.uuid4())),
    )
    assert r.status_code == 404


def test_delete_slot_removes_it(client):
    bid = str(uuid.uuid4())
    r = _create_slot(client, browser_id=bid, day_time_windows=_dtw(_day(8)), activities=["Hiking"])
    slot_id = r.json()["id"]
    r = client.delete(f"/api/slots/{slot_id}", headers=bid_headers(bid))
    assert r.status_code == 204, r.text
    assert _list_slots(client, browser_id=bid).json()["slots"] == []


def test_delete_slot_404_for_non_owner(client):
    owner = str(uuid.uuid4())
    r = _create_slot(client, browser_id=owner, day_time_windows=_dtw(_day(9)), activities=["Yoga"])
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


# --- Auto-delete of fully-past slots ----------------------------------------


def test_list_purges_slot_entirely_in_the_past(client):
    bid = str(uuid.uuid4())
    _create_slot(client, browser_id=bid, day_time_windows=_dtw(_day(-30)), activities=["Yoga"])
    assert _list_slots(client, browser_id=bid).json()["slots"] == []


def test_list_keeps_future_slot(client):
    bid = str(uuid.uuid4())
    _create_slot(client, browser_id=bid, day_time_windows=_dtw(_day(30)), activities=["Yoga"])
    assert len(_list_slots(client, browser_id=bid).json()["slots"]) == 1


def test_list_keeps_slot_with_any_future_window(client):
    """Only a slot whose LAST window has ended is past — an old window
    alongside an upcoming one keeps the whole slot alive."""
    bid = str(uuid.uuid4())
    dtw = _dtw(_day(-30)) + _dtw(_day(30))
    _create_slot(client, browser_id=bid, day_time_windows=dtw, activities=["Yoga"])
    assert len(_list_slots(client, browser_id=bid).json()["slots"]) == 1


def test_slot_end_is_the_latest_window_end():
    """`_slot_end` drives the purge, so pin its two non-obvious rules: it takes
    the LATEST end across every window, and `max <= min` is the cross-midnight
    convention (the window ends on the following day)."""
    from services.slots import PAST_GRACE_HOURS, _slot_end

    assert _slot_end(_dtw("2026-03-01", "09:00", "17:00")) == datetime(2026, 3, 1, 17, tzinfo=timezone.utc)
    # Latest wins regardless of the order the days arrive in.
    both = _dtw("2026-03-05", "09:00", "10:00") + _dtw("2026-03-01", "09:00", "10:00")
    assert _slot_end(both) == datetime(2026, 3, 5, 10, tzinfo=timezone.utc)
    # 22:00 -> 02:00 rolls into the next day; 09:00 -> 09:00 is a full 24h.
    assert _slot_end(_dtw("2026-03-01", "22:00", "02:00")) == datetime(2026, 3, 2, 2, tzinfo=timezone.utc)
    assert _slot_end(_dtw("2026-03-01", "09:00", "09:00")) == datetime(2026, 3, 2, 9, tzinfo=timezone.utc)
    # No usable window -> no end -> never purged.
    assert _slot_end([]) is None
    assert _slot_end([{"day": "2026-03-01", "windows": []}]) is None
    # The grace must clear UTC-12 or a slot could be reaped while its owner is
    # still living in it.
    assert PAST_GRACE_HOURS >= 12


def test_list_keeps_windowless_slot(client):
    """No usable window = no "past" to be in; never auto-deleted."""
    bid = str(uuid.uuid4())
    _create_slot(client, browser_id=bid, day_time_windows=[], activities=["Yoga"])
    assert len(_list_slots(client, browser_id=bid).json()["slots"]) == 1
