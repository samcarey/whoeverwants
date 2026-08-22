"""Slot events (migration 152): the matching engine that proposes gatherings
from overlapping slots, and the confirm/cancel flow with its capacity gating
(met / can_confirm / "Full" / freed-on-cancel)."""

import uuid
from datetime import date, timedelta

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from services.slot_events import (
    _Candidate,
    _earliest_viable_start,
    _intersect,
    _set_ok,
)
from tests.conftest import TEST_DB_URL, bid_headers


def _act(base: str) -> str:
    """A per-test-unique activity name. Events key on (day, LOWER(activity))
    in a PERSISTENT dev DB, so a reused name + future day would pull earlier
    runs' slots into this test's candidate set."""
    return f"{base} {uuid.uuid4().hex[:6]}"


def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def _dtw(day: str, min_: str = "09:00", max_: str = "17:00") -> list[dict]:
    return [{"day": day, "windows": [{"min": min_, "max": max_}]}]


def _create_slot(client, *, browser_id, day_time_windows, activities):
    r = client.post(
        "/api/slots",
        json={"day_time_windows": day_time_windows, "activities": activities},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 200, r.text
    return r


def _events(client, *, browser_id):
    r = client.get("/api/slots/events", headers=bid_headers(browser_id))
    assert r.status_code == 200, r.text
    return r.json()["events"]


def _confirm(client, *, browser_id, day, activity, confirmed=True):
    return client.post(
        "/api/slots/events/confirmation",
        json={"day": day, "activity": activity, "confirmed": confirmed},
        headers=bid_headers(browser_id),
    )


def _sign_in(client, browser_id, name):
    """Magic-link verify → a named signed-in account (see test_slots)."""
    email = f"event-{uuid.uuid4().hex[:8]}@example.com"
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
    gid = client.post("/api/groups", headers=bid_headers(a_browser)).json()["id"]
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute(
            "INSERT INTO group_members (group_id, browser_id) VALUES (%s::uuid, %s::uuid)"
            " ON CONFLICT DO NOTHING",
            (gid, b_browser),
        )
        conn.commit()
    return gid


def _make_contact(client, a_browser, b_browser):
    """B becomes A's contact (and vice versa) so id-bearing who-with refs to B
    survive A's save (the resolve-on-save gate)."""
    _share_a_group(client, a_browser, b_browser)
    # Reconcile A's address book (the candidates endpoint does it inline).
    client.get("/api/slots/who-with-candidates", headers=bid_headers(a_browser))


def _cand(uid, windows=((540, 1020),), **kw):
    c = _Candidate(user_id=uid, name=uid, windows=list(windows))
    for k, v in kw.items():
        setattr(c, k, v)
    return c


# --- Pure engine -------------------------------------------------------------


def test_intersect_interval_lists():
    assert _intersect([(540, 720)], [(600, 1020)]) == [(600, 720)]
    assert _intersect([(540, 720)], [(780, 1020)]) == []
    assert _intersect([(540, 600), (900, 1020)], [(0, 1440)]) == [(540, 600), (900, 1020)]


def test_set_ok_max_and_exclude_and_include():
    a, b, c = _cand("a"), _cand("b"), _cand("c")
    assert _set_ok([a, b, c], {}, require_min=False)
    # a caps the party at 2 → the trio fails, the pair passes.
    a.max_people = 2
    assert not _set_ok([a, b, c], {}, require_min=False)
    assert _set_ok([a, b], {}, require_min=False)
    # a excludes c outright.
    a.max_people = None
    a.exclude_people = {"c"}
    assert not _set_ok([a, c], {}, require_min=False)
    # a's include set claims only b → c fails, b passes.
    a.exclude_people = set()
    a.include_people = {"b"}
    assert _set_ok([a, b], {}, require_min=False)
    assert not _set_ok([a, c], {}, require_min=False)
    # include via group membership.
    a.include_people = set()
    a.include_groups = {"g1"}
    assert _set_ok([a, c], {"g1": {"c"}}, require_min=False)
    assert not _set_ok([a, c], {"g1": {"b"}}, require_min=False)


def test_set_ok_minimum_only_when_required():
    a, b = _cand("a", min_people=3), _cand("b")
    # Growing set: minimums exempt. Final set: minimums enforced.
    assert _set_ok([a, b], {}, require_min=False)
    assert not _set_ok([a, b], {}, require_min=True)


def test_set_ok_needs_a_common_window():
    a, b = _cand("a", windows=[(540, 720)]), _cand("b", windows=[(780, 1020)])
    assert not _set_ok([a, b], {}, require_min=False)


def test_viable_with_reaches_minimum_via_third_person():
    a = _cand("a", min_people=3)
    b, c = _cand("b"), _cand("c")
    assert _earliest_viable_start(a, [b], {}) is None
    assert _earliest_viable_start(a, [b, c], {}) == 540


def test_earliest_viable_start_is_the_min_headcount_time():
    """A pair could start at 9:00; the trio only at noon. B's minimum of 2 is
    met by the pair, so 9:00 is "the earliest time that allows the minimum
    amount of people to attend" — the trio's later window doesn't drag it."""
    a = _cand("a", windows=[(540, 1020)])
    b = _cand("b", windows=[(540, 1020)], min_people=2)
    c = _cand("c", windows=[(720, 1020)])
    assert _earliest_viable_start(a, [b, c], {}) == 540
    # Force the trio (b needs 3) → the common window shifts to noon.
    b.min_people = 3
    assert _earliest_viable_start(a, [b, c], {}) == 720


# --- API ---------------------------------------------------------------------


def test_two_overlapping_slots_propose_an_event_and_meet_on_two_confirms(client):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Hiking")
    _create_slot(client, browser_id=a, day_time_windows=_dtw(day), activities=[act])
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day, "10:00", "14:00"), activities=[act.lower()])

    for bid in (a, b):
        evs = _events(client, browser_id=bid)
        assert len(evs) == 1
        ev = evs[0]
        assert ev["day"] == day and ev["activity"].lower() == act.lower()
        assert ev["confirmed_count"] == 0 and not ev["met"] and ev["can_confirm"]

    r = _confirm(client, browser_id=a, day=day, activity=act)
    assert r.status_code == 200, r.text
    assert r.json()["viewer_confirmed"] and r.json()["confirmed_count"] == 1
    assert not r.json()["met"]  # one person isn't an event

    r = _confirm(client, browser_id=b, day=day, activity=act.lower())
    assert r.status_code == 200
    assert r.json()["met"] and r.json()["confirmed_count"] == 2
    # The card's window narrows to what the confirmed pair shares, and the
    # "@ time" is when they can actually start.
    assert r.json()["window"] == {"min": "10:00", "max": "14:00"}
    assert r.json()["time"] == "10:00"
    # And A sees the met state too.
    assert _events(client, browser_id=a)[0]["met"]


def test_non_overlapping_windows_propose_nothing(client):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Chess")
    _create_slot(client, browser_id=a, day_time_windows=_dtw(day, "09:00", "12:00"), activities=[act])
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day, "13:00", "17:00"), activities=[act])
    assert _events(client, browser_id=a) == []
    assert _events(client, browser_id=b) == []


def test_solo_candidate_sees_no_event(client):
    a = str(uuid.uuid4())
    act = _act("Reading")
    _create_slot(client, browser_id=a, day_time_windows=_dtw(_day(1)), activities=[act])
    assert _events(client, browser_id=a) == []


def test_max_people_makes_the_event_full_until_someone_cancels(client):
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Climbing")
    # A will only go as a pair.
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"min_people": 2, "max_people": 2}]}],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    _create_slot(client, browser_id=c, day_time_windows=_dtw(day), activities=[act])

    assert _confirm(client, browser_id=a, day=day, activity=act).status_code == 200
    assert _confirm(client, browser_id=b, day=day, activity=act).json()["met"]

    # C's view flips to Full — joining would blow past A's maximum.
    ev = _events(client, browser_id=c)[0]
    assert not ev["can_confirm"] and not ev["viewer_confirmed"]
    # The server is the real gate, not the FE's advisory flag.
    assert _confirm(client, browser_id=c, day=day, activity=act).status_code == 409

    # B cancels → capacity frees → C can join.
    r = _confirm(client, browser_id=b, day=day, activity=act, confirmed=False)
    assert r.status_code == 200 and not r.json()["viewer_confirmed"]
    ev = _events(client, browser_id=c)[0]
    assert ev["can_confirm"]
    assert _confirm(client, browser_id=c, day=day, activity=act).status_code == 200


def test_confirmed_members_exclusion_gates_a_late_joiner(client):
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, a, "Ana")
    _sign_in(client, b, "Bo")
    c_uid = _sign_in(client, c, "Cal")
    _make_contact(client, a, c)  # so A's id-ref to C survives the save
    day = _day(1)
    act = _act("Poker")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"exclude_people": [{"id": c_uid, "name": "Cal"}]}]}],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    _create_slot(client, browser_id=c, day_time_windows=_dtw(day), activities=[act])

    # C still sees the event — a C+B pair would work — and can confirm now.
    assert _events(client, browser_id=c)[0]["can_confirm"]

    # A confirms → C joining would put C at A's table → Full for C.
    assert _confirm(client, browser_id=a, day=day, activity=act).status_code == 200
    ev = _events(client, browser_id=c)[0]
    assert not ev["can_confirm"]
    assert _confirm(client, browser_id=c, day=day, activity=act).status_code == 409
    # B is fine with everyone.
    assert _events(client, browser_id=b)[0]["can_confirm"]


def test_pairwise_impossible_event_is_not_proposed(client):
    a, c = str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, a, "Ana")
    c_uid = _sign_in(client, c, "Cal")
    _make_contact(client, a, c)
    day = _day(1)
    act = _act("Darts")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"exclude_people": [{"id": c_uid, "name": "Cal"}]}]}],
    )
    _create_slot(client, browser_id=c, day_time_windows=_dtw(day), activities=[act])
    # The only possible pair violates A's exclusion → no event for anyone.
    assert _events(client, browser_id=a) == []
    assert _events(client, browser_id=c) == []


def test_minimum_people_gates_the_proposal_until_a_third_arrives(client):
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Volleyball")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"min_people": 3}]}],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    # Two candidates can't reach A's minimum of 3 → nothing proposed to A.
    assert _events(client, browser_id=a) == []
    # B's own condition is unconstrained, and a viable trio doesn't exist yet
    # either (any set with A needs 3, and without A there's only B) → nothing.
    assert _events(client, browser_id=b) == []

    _create_slot(client, browser_id=c, day_time_windows=_dtw(day), activities=[act])
    evs = _events(client, browser_id=a)
    assert len(evs) == 1
    # Every viable group needs all three (A's min), so the time is when all
    # three can start.
    assert evs[0]["time"] == "09:00"
    # Met only once all three confirm.
    _confirm(client, browser_id=a, day=day, activity=act)
    r = _confirm(client, browser_id=b, day=day, activity=act)
    assert not r.json()["met"]  # A's min of 3 not reached yet
    r = _confirm(client, browser_id=c, day=day, activity=act)
    assert r.json()["met"] and r.json()["confirmed_count"] == 3


def test_include_set_restricts_to_group_members(client):
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, a, "Ana")
    _sign_in(client, b, "Bo")
    _sign_in(client, c, "Cal")
    gid = _share_a_group(client, a, b)  # B is in A's group; C is not
    client.get("/api/slots/who-with-candidates", headers=bid_headers(a))
    day = _day(1)
    act = _act("Trivia")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"groups": [{"id": gid, "name": "Crew"}]}]}],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    _create_slot(client, browser_id=c, day_time_windows=_dtw(day), activities=[act])

    assert _confirm(client, browser_id=a, day=day, activity=act).status_code == 200
    # B is inside A's include set → fine; C is not → Full.
    assert _events(client, browser_id=b)[0]["can_confirm"]
    assert not _events(client, browser_id=c)[0]["can_confirm"]
    assert _confirm(client, browser_id=c, day=day, activity=act).status_code == 409


def test_confirm_without_a_matching_slot_404s(client):
    a = str(uuid.uuid4())
    act = _act("Hiking")
    _create_slot(client, browser_id=a, day_time_windows=_dtw(_day(1)), activities=[act])
    assert _confirm(client, browser_id=a, day=_day(1), activity=_act("Bowling")).status_code == 404
    assert _confirm(client, browser_id=str(uuid.uuid4()), day=_day(1), activity=act).status_code == 404


def test_deleting_the_slot_drops_the_confirmation_from_the_math(client):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Hiking")
    slot_id = _create_slot(client, browser_id=a, day_time_windows=_dtw(day), activities=[act]).json()["id"]
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    _confirm(client, browser_id=a, day=day, activity=act)
    _confirm(client, browser_id=b, day=day, activity=act)
    assert _events(client, browser_id=b)[0]["met"]

    # A deletes their slot → A is no longer a candidate; their stale
    # confirmation stops counting and the event un-meets.
    r = client.delete(f"/api/slots/{slot_id}", headers=bid_headers(a))
    assert r.status_code == 204
    ev = _events(client, browser_id=b)[0] if _events(client, browser_id=b) else None
    assert ev is None or (ev["confirmed_count"] == 1 and not ev["met"])
