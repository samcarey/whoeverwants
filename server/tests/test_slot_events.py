"""Slot events (migration 152): the matching engine that proposes gatherings
from overlapping slots, and the confirm/cancel flow with its capacity gating
(met / can_confirm / "Full" / freed-on-cancel)."""

import uuid

import pytest
from datetime import date, timedelta

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from services.slot_events import (
    _Candidate,
    _best_start,
    _intersect,
    _needed_more,
    _preferred_viable_start,
    _set_ok,
)
from tests.conftest import TEST_DB_URL, bid_headers


@pytest.fixture(autouse=True)
def _instant_settlement(monkeypatch):
    """Pin the pre-162 semantics for this suite: with a deadline that is
    always already past, every key settles on its first confirm, so the party
    model below (Full / second party / moves) is exercised exactly as before.
    Deferred settlement has its own suite (test_slot_settlement.py)."""
    import services.slot_events as se

    monkeypatch.setattr(se, "SETTLE_LEAD_HOURS", 10**6)


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


def _confirm(client, *, browser_id, day, activity, confirmed=True, event_id=None):
    return client.post(
        "/api/slots/events/confirmation",
        json={"day": day, "activity": activity, "confirmed": confirmed, "event_id": event_id},
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
    assert _set_ok([a, b, c], {}, {}, require_min=False)
    # a caps the party at 2 → the trio fails, the pair passes.
    a.max_people = 2
    assert not _set_ok([a, b, c], {}, {}, require_min=False)
    assert _set_ok([a, b], {}, {}, require_min=False)
    # a excludes c outright.
    a.max_people = None
    a.exclude_people = {"c"}
    assert not _set_ok([a, c], {}, {}, require_min=False)
    # a's include set claims only b → c fails, b passes.
    a.exclude_people = set()
    a.include_people = {"b"}
    assert _set_ok([a, b], {}, {}, require_min=False)
    assert not _set_ok([a, c], {}, {}, require_min=False)
    # include via group membership.
    a.include_people = set()
    a.include_groups = {"g1"}
    assert _set_ok([a, c], {"g1": {"c"}}, {}, require_min=False)
    assert not _set_ok([a, c], {"g1": {"b"}}, {}, require_min=False)


def test_set_ok_minimum_only_when_required():
    a, b = _cand("a", min_people=3), _cand("b")
    # Growing set: minimums exempt. Final set: minimums enforced.
    assert _set_ok([a, b], {}, {}, require_min=False)
    assert not _set_ok([a, b], {}, {}, require_min=True)


def test_set_ok_needs_a_common_window():
    a, b = _cand("a", windows=[(540, 720)]), _cand("b", windows=[(780, 1020)])
    assert not _set_ok([a, b], {}, {}, require_min=False)


def test_viable_with_reaches_minimum_via_third_person():
    a = _cand("a", min_people=3)
    b, c = _cand("b"), _cand("c")
    assert _preferred_viable_start(a, [b], {}, {}) is None
    assert _preferred_viable_start(a, [b, c], {}, {}) == 540


def test_solo_viewer_with_default_minimum_is_viable_alone():
    """No global two-person floor: a viewer whose "At Least" is "Just me"
    (the default) can gather alone; an explicit minimum of 2 can't."""
    assert _preferred_viable_start(_cand("a"), [], {}, {}) == 540
    assert _preferred_viable_start(_cand("a", min_people=2), [], {}, {}) is None


def test_earliest_viable_start_is_the_min_headcount_time():
    """A pair could start at 9:00; the trio only at noon. A needs company
    (min 2) so the singleton doesn't shortcut; B's minimum of 2 is met by the
    pair, so 9:00 is "the earliest time that allows the minimum amount of
    people to attend" — the trio's later window doesn't drag it."""
    a = _cand("a", windows=[(540, 1020)], min_people=2)
    b = _cand("b", windows=[(540, 1020)], min_people=2)
    c = _cand("c", windows=[(720, 1020)])
    assert _preferred_viable_start(a, [b, c], {}, {}) == 540
    # Force the trio (b needs 3) → the common window shifts to noon.
    b.min_people = 3
    assert _preferred_viable_start(a, [b, c], {}, {}) == 720


def test_liked_start_beats_earliest():
    """A liked mark inside the common window wins over the bare window start —
    the whole point of per-activity time preferences."""
    a = _cand("a", liked={840})  # 14:00
    b = _cand("b")
    assert _preferred_viable_start(a, [b], {}, {}) == 840


def test_disliked_window_start_is_escaped():
    """When the earliest start is somebody's disliked mark, the pick steps to
    the next non-disliked candidate rather than landing on it."""
    a = _cand("a", disliked={540})  # dislikes 9:00, the window start
    b = _cand("b")
    # 9:30 (disliked + one step) scores (0 dislikes) over 9:00's (1 dislike).
    assert _preferred_viable_start(a, [b], {}, {}) == 570


def test_likes_outvote_a_single_dislike_only_when_clean():
    """Fewest dislikes is the primary key (the time-poll winner rule): a start
    two people like but one dislikes loses to a clean liked start."""
    a = _cand("a", liked={840, 900})
    b = _cand("b", liked={840}, disliked=set())
    c = _cand("c", disliked={840})
    # 840 has 2 likes but 1 dislike; 900 has 1 like, 0 dislikes → 900 wins.
    assert _best_start([a, b, c], [(540, 1020)]) == 900


def test_no_preferences_reduce_to_earliest():
    a, b = _cand("a"), _cand("b")
    assert _best_start([a, b], [(540, 1020)]) == 540


def test_duration_bounds_must_be_mutually_satisfiable():
    """min 3h vs max 2h can never agree on a length — the set is not viable,
    growing or final (growth only tightens the bounds)."""
    a = _cand("a", min_dur=180)
    b = _cand("b", max_dur=120)
    assert not _set_ok([a, b], {}, {}, require_min=False)
    assert not _set_ok([a, b], {}, {}, require_min=True)
    # Compatible bounds (3h fits under a 4h cap) pass.
    b.max_dur = 240
    assert _set_ok([a, b], {}, {}, require_min=False)


def test_event_must_fit_the_shared_window():
    """A 2h window can't hold a 3h minimum — no event, whatever the people
    math says."""
    a = _cand("a", windows=[(540, 660)], min_dur=180)  # 9–11, wants ≥3h
    b = _cand("b", windows=[(540, 660)])
    assert not _set_ok([a, b], {}, {}, require_min=False)
    a.min_dur = 120  # exactly fits
    assert _set_ok([a, b], {}, {}, require_min=False)


def test_start_cannot_outlast_someones_window():
    """A liked start too close to the window's end is skipped — an event may
    not start where the binding minimum would run past the shared window."""
    a = _cand("a", min_dur=120, liked={960})  # loves 4 PM, but needs 2h before 5 PM
    b = _cand("b")
    # 16:00 + 2h > 17:00 → the liked mark is invalid; earliest fitting start wins.
    assert _best_start([a, b], [(540, 1020)]) == 540
    # A liked mark that still fits (3 PM + 2h = 5 PM exactly) is honored.
    a.liked = {900}
    assert _best_start([a, b], [(540, 1020)]) == 900


def test_growth_that_breaks_the_fit_falls_back_to_the_fitting_pair():
    """The trio's extra member squeezes the shared window below the binding
    minimum, so the viable pick is the pair — duration gating composes with
    the subset walk. A needs company (min 2) so going alone isn't the out."""
    a = _cand("a", windows=[(540, 1020)], min_dur=240, min_people=2)  # needs 4h
    b = _cand("b", windows=[(540, 1020)])
    c = _cand("c", windows=[(540, 720)])  # only 9–12 — a trio has just 3h
    assert _preferred_viable_start(a, [b, c], {}, {}) == 540
    # And if EVERY companion shrinks the window below the minimum → nothing.
    b.windows = [(540, 720)]
    assert _preferred_viable_start(a, [b, c], {}, {}) is None


def test_needed_more_requires_a_fitting_window():
    """More people can't stretch a too-short window: a solo whose own window
    can't hold their minimum gets NO near-miss (nothing would fix it)."""
    # min_people 2 so the solo isn't simply viable outright.
    a = _cand("a", windows=[(540, 660)], min_dur=240, min_people=2)  # 2h window, wants 4h
    assert _needed_more(a, [], {}, {}) is None
    # With a fitting window the near-miss math is unchanged.
    a.min_dur = 60
    assert _needed_more(a, [], {}, {}) == 1


def test_needed_more_counts_the_gap():
    # Alone with the default "Just me" minimum: viable outright, no near-miss
    # (the fresh confirmable card handles it).
    assert _needed_more(_cand("a"), [], {}, {}) is None
    # Alone but wanting company: one short.
    assert _needed_more(_cand("a", min_people=2), [], {}, {}) == 1
    # A minimum of 4 with one compatible other: two short.
    a = _cand("a", min_people=4)
    assert _needed_more(a, [_cand("b")], {}, {}) == 2
    # A maximum below the binding minimum can never fit the missing heads.
    a = _cand("a", min_people=4, max_people=3)
    assert _needed_more(a, [_cand("b")], {}, {}) is None


# --- API ---------------------------------------------------------------------


def test_two_overlapping_slots_propose_an_event_and_pair_up(client):
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
    # A's "At Least" defaults to "Just me" → going alone already counts.
    assert r.json()["met"]

    r = _confirm(client, browser_id=b, day=day, activity=act.lower())
    assert r.status_code == 200
    assert r.json()["met"] and r.json()["confirmed_count"] == 2
    # The card's window narrows to what the confirmed pair shares, and the
    # "@ time" is when they can actually start.
    assert r.json()["window"] == {"min": "10:00", "max": "14:00"}
    assert r.json()["time"] == "10:00"
    # And A sees the met state too.
    assert _events(client, browser_id=a)[0]["met"]


def test_time_prefs_move_the_proposed_time(client):
    """A liked start inside the overlap pulls the card's "@ time" off the bare
    window start — end-to-end through the time_prefs column."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Frisbee")
    _create_slot(
        client,
        browser_id=a,
        day_time_windows=_dtw(day, "09:00", "17:00"),
        activities=[{"name": act, "time_prefs": {"liked": ["14:00"], "disliked": []}}],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day, "10:00", "16:00"), activities=[act])
    assert _events(client, browser_id=a)[0]["time"] == "14:00"
    # The met set's time honors the preference too.
    _confirm(client, browser_id=a, day=day, activity=act)
    r = _confirm(client, browser_id=b, day=day, activity=act)
    assert r.status_code == 200 and r.json()["met"]
    assert r.json()["time"] == "14:00"


def test_duration_bounds_shape_events_end_to_end(client):
    """min_hours/max_hours through the API: a 2h minimum pins the start to
    where it still fits the overlap; an incompatible pair (min 3h vs max 2h)
    degrades both to near-misses."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Museum")
    # A: 12–5 wanting >=2h WITH company (min 2, so going alone at the liked
    # start isn't the out). B: 12–2 → the overlap is exactly 2h, so the ONLY
    # viable start is noon; anything later would outlast B's window.
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day, "12:00", "17:00"),
        activities=[{
            "name": act, "min_hours": 2,
            "who_with": [{"min_people": 2}],
            "time_prefs": {"liked": ["13:00"], "disliked": []},
        }],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day, "12:00", "14:00"), activities=[act])
    ev = _events(client, browser_id=a)[0]
    # A's liked 13:00 would run to 15:00 — past B's window — so it's ignored.
    assert ev["needed"] == 0 and ev["time"] == "12:00"

    # An incompatible duration pair can never gather TOGETHER: C (wants >=3h
    # with company) degrades to a near-miss — D doesn't count toward it —
    # while D (no company requirement) still gets their own solo-viable card.
    act2 = _act("Golf")
    c, d = str(uuid.uuid4()), str(uuid.uuid4())
    _create_slot(
        client, browser_id=c, day_time_windows=_dtw(day),
        activities=[{"name": act2, "min_hours": 3, "who_with": [{"min_people": 2}]}],
    )
    _create_slot(
        client, browser_id=d, day_time_windows=_dtw(day),
        activities=[{"name": act2, "max_hours": 2}],
    )
    c_evs = [e for e in _events(client, browser_id=c) if e["activity"] == act2]
    assert len(c_evs) == 1 and c_evs[0]["needed"] == 1 and not c_evs[0]["can_confirm"]
    d_evs = [e for e in _events(client, browser_id=d) if e["activity"] == act2]
    assert len(d_evs) == 1 and d_evs[0]["needed"] == 0 and d_evs[0]["can_confirm"]


def test_joiner_whose_minimum_cannot_fit_is_locked_out(client):
    """can_confirm gating: a met party stays Full for a viewer whose own
    minimum duration can't fit the window they'd share with it."""
    a, b, c = (str(uuid.uuid4()) for _ in range(3))
    day = _day(1)
    act = _act("Sauna")
    _create_slot(client, browser_id=a, day_time_windows=_dtw(day), activities=[act])
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    # C only has 9–11 and insists on >=4h.
    _create_slot(
        client, browser_id=c, day_time_windows=_dtw(day, "09:00", "11:00"),
        activities=[{"name": act, "min_hours": 4}],
    )
    _confirm(client, browser_id=a, day=day, activity=act)
    assert _confirm(client, browser_id=b, day=day, activity=act).json()["met"]
    ev = _events(client, browser_id=c)[0]
    assert not ev["can_confirm"] and not ev["viewer_confirmed"]
    assert _confirm(client, browser_id=c, day=day, activity=act).status_code == 409


def test_non_overlapping_windows_propose_a_near_miss(client):
    """No shared window → no JOINT event. Both want company (min 2), so each
    declarer sees a "needs 1 more" near-miss rather than nothing (the
    incompatible other doesn't count toward it)."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Chess")
    wants_company = [{"name": act, "who_with": [{"min_people": 2}]}]
    _create_slot(client, browser_id=a, day_time_windows=_dtw(day, "09:00", "12:00"), activities=wants_company)
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day, "13:00", "17:00"), activities=wants_company)
    for bid in (a, b):
        evs = _events(client, browser_id=bid)
        assert len(evs) == 1
        ev = evs[0]
        assert ev["needed"] == 1 and not ev["can_confirm"] and ev["time"] is None


def test_solo_candidate_can_go_alone(client):
    """You declared, nobody else has it, and your "At Least" is the default
    "Just me" → a confirmable event, and confirming it means it's ON. An
    event still happens if only one person goes."""
    a = str(uuid.uuid4())
    day = _day(1)
    act = _act("Reading")
    _create_slot(client, browser_id=a, day_time_windows=_dtw(day), activities=[act])
    evs = _events(client, browser_id=a)
    assert len(evs) == 1
    ev = evs[0]
    assert ev["needed"] == 0 and ev["can_confirm"] and not ev["met"]
    assert ev["time"] == "09:00"
    r = _confirm(client, browser_id=a, day=day, activity=act)
    assert r.status_code == 200, r.text
    assert r.json()["met"] and r.json()["confirmed_count"] == 1


def test_solo_candidate_wanting_company_sees_a_near_miss(client):
    """The dead end that remains a dead end: alone AND your minimum needs a
    second person → "needs 1 more", not confirmable."""
    a = str(uuid.uuid4())
    act = _act("Doubles")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(_day(1)),
        activities=[{"name": act, "who_with": [{"min_people": 2}]}],
    )
    evs = _events(client, browser_id=a)
    assert len(evs) == 1
    assert evs[0]["needed"] == 1 and not evs[0]["can_confirm"] and not evs[0]["met"]
    # Not confirmable — the server gates it, not just the FE flag.
    assert _confirm(client, browser_id=a, day=_day(1), activity=act).status_code == 409


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

    r = _confirm(client, browser_id=a, day=day, activity=act)
    assert r.status_code == 200
    p1 = r.json()["id"]
    assert _confirm(client, browser_id=b, day=day, activity=act).json()["met"]

    # A's pair is Full for C — joining would blow past A's maximum.
    ev = next(e for e in _events(client, browser_id=c) if e["id"] == p1)
    assert not ev["can_confirm"] and not ev["viewer_confirmed"]
    # The server is the real gate, not the FE's advisory flag: targeting the
    # full party directly is refused (a bare confirm would instead mint C's
    # own solo party — the spawn-a-second-event base case).
    assert _confirm(client, browser_id=c, day=day, activity=act, event_id=p1).status_code == 409

    # B cancels → capacity frees → C can join A's party.
    r = _confirm(client, browser_id=b, day=day, activity=act, confirmed=False)
    assert r.status_code == 200 and not r.json()["viewer_confirmed"]
    ev = next(e for e in _events(client, browser_id=c) if e["id"] == p1)
    assert ev["can_confirm"]
    assert _confirm(client, browser_id=c, day=day, activity=act, event_id=p1).status_code == 200


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

    # A confirms → C joining A's party would put C at A's table → that party
    # is Full for C, but the SAME rule that proposed the original event
    # re-fires for the leftovers: a fresh card appears (a B+C pair works).
    r = _confirm(client, browser_id=a, day=day, activity=act)
    assert r.status_code == 200
    p1 = r.json()["id"]
    cards = _events(client, browser_id=c)
    assert [(ev["id"] == p1, ev["can_confirm"]) for ev in cards] == [(True, False), (False, True)]
    assert cards[1]["id"] is None and cards[1]["confirmed_count"] == 0

    # C confirming lands in a NEW party, not A's.
    r = _confirm(client, browser_id=c, day=day, activity=act)
    assert r.status_code == 200
    assert r.json()["id"] not in (None, p1) and r.json()["viewer_confirmed"]
    # B can join either party (fine with everyone) — no fresh card for B.
    b_cards = _events(client, browser_id=b)
    assert len(b_cards) == 2 and all(ev["can_confirm"] and ev["id"] for ev in b_cards)


def test_pairwise_impossible_event_is_not_proposed(client):
    a, c = str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, a, "Ana")
    c_uid = _sign_in(client, c, "Cal")
    _make_contact(client, a, c)
    day = _day(1)
    act = _act("Darts")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{
            "name": act,
            "who_with": [{"min_people": 2, "exclude_people": [{"id": c_uid, "name": "Cal"}]}],
        }],
    )
    _create_slot(
        client, browser_id=c, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"min_people": 2}]}],
    )
    # Both want company, but the only possible pair violates A's exclusion →
    # no VIABLE event for anyone; both fall back to a near-miss (the
    # incompatible other doesn't count toward it).
    for bid in (a, c):
        evs = _events(client, browser_id=bid)
        assert len(evs) == 1 and evs[0]["needed"] == 1 and not evs[0]["can_confirm"]


def test_minimum_people_gates_the_proposal_until_a_third_arrives(client):
    a, b, c = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    day = _day(1)
    act = _act("Volleyball")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"min_people": 3}]}],
    )
    _create_slot(client, browser_id=b, day_time_windows=_dtw(day), activities=[act])
    # Two candidates can't reach A's minimum of 3 → no viable event for A yet,
    # so A sees the near-miss: one more person makes it work. B (default
    # "Just me" minimum) is solo-viable regardless, so B gets a fresh card.
    assert [e["needed"] for e in _events(client, browser_id=a)] == [1]
    b_evs = _events(client, browser_id=b)
    assert [e["needed"] for e in b_evs] == [0] and b_evs[0]["can_confirm"]

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

    r = _confirm(client, browser_id=a, day=day, activity=act)
    assert r.status_code == 200
    p1 = r.json()["id"]
    # B is inside A's include set → fine; C is not → A's party is Full for C,
    # and C's confirm spawns a second gathering instead of failing.
    assert _events(client, browser_id=b)[0]["can_confirm"]
    c_p1 = next(ev for ev in _events(client, browser_id=c) if ev["id"] == p1)
    assert not c_p1["can_confirm"]
    r = _confirm(client, browser_id=c, day=day, activity=act)
    assert r.status_code == 200 and r.json()["id"] not in (None, p1)


def test_full_party_spawns_a_second_identical_event(client):
    """The headline behavior: when a party fills up, an identical fresh event
    appears for whoever got left out — the proposal rule's base case
    re-firing, not a special case — and it dissolves again when everyone
    cancels."""
    a, b, c, d = (str(uuid.uuid4()) for _ in range(4))
    day = _day(1)
    act = _act("Climbing")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"max_people": 2}]}],
    )
    for bid in (b, c, d):
        _create_slot(client, browser_id=bid, day_time_windows=_dtw(day), activities=[act])

    p1 = _confirm(client, browser_id=a, day=day, activity=act).json()["id"]
    assert _confirm(client, browser_id=b, day=day, activity=act).json()["met"]

    # C is locked out of the pair — and sees a fresh identical event.
    cards = _events(client, browser_id=c)
    assert [(ev["id"] == p1, ev["can_confirm"]) for ev in cards] == [(True, False), (False, True)]
    p2 = _confirm(client, browser_id=c, day=day, activity=act).json()["id"]
    assert p2 not in (None, p1)

    # D now has a JOINABLE second party, so no third card spawns for D.
    d_cards = _events(client, browser_id=d)
    assert [ev["id"] for ev in d_cards] == [p2, p1]
    assert d_cards[0]["can_confirm"] and not d_cards[1]["can_confirm"]
    assert _confirm(client, browser_id=d, day=day, activity=act, event_id=p2).json()["met"]

    # A sees both parties; the second is Full for A (their own max of 2).
    a_cards = _events(client, browser_id=a)
    assert [ev["id"] for ev in a_cards] == [p1, p2]
    assert not a_cards[1]["can_confirm"]

    # Everyone leaves party 2 → it dissolves back into the fresh card.
    _confirm(client, browser_id=c, day=day, activity=act, confirmed=False)
    _confirm(client, browser_id=d, day=day, activity=act, confirmed=False)
    d_cards = _events(client, browser_id=d)
    assert [(ev["id"] == p1, ev["id"] is None) for ev in d_cards] == [(True, False), (False, True)]


def test_confirming_another_party_moves_the_confirmation(client):
    """One confirmation per (day, activity): joining a different party leaves
    the old one."""
    a, b, c, d = (str(uuid.uuid4()) for _ in range(4))
    day = _day(1)
    act = _act("Poker")
    _create_slot(
        client, browser_id=a, day_time_windows=_dtw(day),
        activities=[{"name": act, "who_with": [{"max_people": 2}]}],
    )
    for bid in (b, c, d):
        _create_slot(client, browser_id=bid, day_time_windows=_dtw(day), activities=[act])
    p1 = _confirm(client, browser_id=a, day=day, activity=act).json()["id"]
    _confirm(client, browser_id=b, day=day, activity=act)
    p2 = _confirm(client, browser_id=c, day=day, activity=act).json()["id"]
    _confirm(client, browser_id=d, day=day, activity=act, event_id=p2)

    # B defects from A's pair to the other party.
    r = _confirm(client, browser_id=b, day=day, activity=act, event_id=p2)
    assert r.status_code == 200 and r.json()["id"] == p2 and r.json()["confirmed_count"] == 3
    by_id = {ev["id"]: ev for ev in _events(client, browser_id=b)}
    assert by_id[p1]["confirmed_count"] == 1  # A alone now
    assert by_id[p2]["viewer_confirmed"]


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
    # confirmation stops counting. B's solo confirmation stands on its own
    # (default "Just me" minimum → still a met event of one).
    r = client.delete(f"/api/slots/{slot_id}", headers=bid_headers(a))
    assert r.status_code == 204
    ev = _events(client, browser_id=b)[0] if _events(client, browser_id=b) else None
    assert ev is None or ev["confirmed_count"] == 1


def test_event_preferences_round_trip(client):
    """Confirming two events on one day, then POSTing /events/preferences,
    stores the fallback order (tier index = rank, top first) and the events
    list echoes it back as viewer_pref_rank — for THIS viewer only."""
    day = _day(41)
    act_a = _act("Climbing")
    act_b = _act("Karaoke")
    b1, b2 = str(uuid.uuid4()), str(uuid.uuid4())
    _sign_in(client, b1, "Pria")
    _sign_in(client, b2, "Quinn")
    _create_slot(client, browser_id=b1, day_time_windows=_dtw(day), activities=[act_a, act_b])
    _create_slot(client, browser_id=b2, day_time_windows=_dtw(day), activities=[act_a, act_b])
    for act in (act_a, act_b):
        assert _confirm(client, browser_id=b1, day=day, activity=act).status_code == 200
        assert _confirm(client, browser_id=b2, day=day, activity=act).status_code == 200

    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert mine[act_a.lower()]["viewer_pref_rank"] is None  # never ordered yet
    ids = {k: e["id"] for k, e in mine.items()}

    # B first, A as the backup.
    r = client.post(
        "/api/slots/events/preferences",
        json={"day": day, "tiers": [[ids[act_b.lower()]], [ids[act_a.lower()]]]},
        headers=bid_headers(b1),
    )
    assert r.status_code == 200, r.text
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert mine[act_b.lower()]["viewer_pref_rank"] == 1
    assert mine[act_a.lower()]["viewer_pref_rank"] == 2

    # Per-viewer: the other member's cards carry no rank.
    others = {e["activity"].lower(): e for e in _events(client, browser_id=b2) if e["viewer_confirmed"]}
    assert others[act_a.lower()]["viewer_pref_rank"] is None
    assert others[act_b.lower()]["viewer_pref_rank"] is None


def test_event_preferences_linked_tier_and_garbage_ids(client):
    """One tier holding both events = LINKED (equal rank — attending both
    regardless of overlap). Malformed / foreign ids are silently ignored."""
    day = _day(42)
    act_a = _act("Trivia")
    act_b = _act("Painting")
    b1 = str(uuid.uuid4())
    _sign_in(client, b1, "Rae")
    _create_slot(client, browser_id=b1, day_time_windows=_dtw(day), activities=[act_a, act_b])
    for act in (act_a, act_b):
        assert _confirm(client, browser_id=b1, day=day, activity=act).status_code == 200

    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    ids = {k: e["id"] for k, e in mine.items()}

    r = client.post(
        "/api/slots/events/preferences",
        json={"day": day, "tiers": [[ids[act_a.lower()], ids[act_b.lower()]]]},
        headers=bid_headers(b1),
    )
    assert r.status_code == 200, r.text
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert mine[act_a.lower()]["viewer_pref_rank"] == 1
    assert mine[act_b.lower()]["viewer_pref_rank"] == 1

    # Garbage tiers touch nothing: not-a-uuid + an unknown uuid leave the
    # stored linked ranks exactly as they were.
    r = client.post(
        "/api/slots/events/preferences",
        json={"day": day, "tiers": [["not-a-uuid"], [str(uuid.uuid4())]]},
        headers=bid_headers(b1),
    )
    assert r.status_code == 200, r.text
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert mine[act_a.lower()]["viewer_pref_rank"] == 1
    assert mine[act_b.lower()]["viewer_pref_rank"] == 1


def _set_prefs(client, browser_id, day, tiers):
    r = client.post(
        "/api/slots/events/preferences",
        json={"day": day, "tiers": tiers},
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 200, r.text


def test_backup_confirmation_is_inert_while_top_choice_is_met(client):
    """The preference order BITES: a confirmation ranked below a same-day met
    event goes standby (excluded from met/count), and reactivates the moment
    the top choice collapses — the modal's "the next is your backup"
    promise, live."""
    day = _day(43)
    act_a = _act("Climbing")
    act_b = _act("Karaoke")
    b1 = str(uuid.uuid4())
    _sign_in(client, b1, "Sol")
    _create_slot(client, browser_id=b1, day_time_windows=_dtw(day), activities=[act_a, act_b])
    for act in (act_a, act_b):
        assert _confirm(client, browser_id=b1, day=day, activity=act).status_code == 200

    # Unordered: both solo confirmations are met, nothing is standby.
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert mine[act_a.lower()]["met"] and mine[act_b.lower()]["met"]
    assert not mine[act_a.lower()]["standby"] and not mine[act_b.lower()]["standby"]

    # A first, B the backup → B goes standby: not met, count 0.
    _set_prefs(client, b1, day, [[mine[act_a.lower()]["id"]], [mine[act_b.lower()]["id"]]])
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    top, back = mine[act_a.lower()], mine[act_b.lower()]
    assert top["met"] and not top["standby"]
    assert back["standby"] and not back["met"] and back["confirmed_count"] == 0
    assert back["viewer_confirmed"]  # still their confirmation — button = cancel

    # The top choice falls through (backed out) → the backup activates.
    assert _confirm(client, browser_id=b1, day=day, activity=act_a, confirmed=False).status_code == 200
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert set(mine) == {act_b.lower()}
    assert mine[act_b.lower()]["met"] and not mine[act_b.lower()]["standby"]


def test_linked_equal_ranks_do_not_suppress(client):
    """Equal ranks = LINKED ("&" — attending both): neither event suppresses
    the other even though both are met."""
    day = _day(44)
    act_a = _act("Trivia")
    act_b = _act("Bowling")
    b1 = str(uuid.uuid4())
    _sign_in(client, b1, "Tam")
    _create_slot(client, browser_id=b1, day_time_windows=_dtw(day), activities=[act_a, act_b])
    for act in (act_a, act_b):
        assert _confirm(client, browser_id=b1, day=day, activity=act).status_code == 200
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    _set_prefs(client, b1, day, [[mine[act_a.lower()]["id"], mine[act_b.lower()]["id"]]])
    mine = {e["activity"].lower(): e for e in _events(client, browser_id=b1) if e["viewer_confirmed"]}
    assert mine[act_a.lower()]["met"] and mine[act_b.lower()]["met"]
    assert not mine[act_a.lower()]["standby"] and not mine[act_b.lower()]["standby"]


def test_standby_frees_a_seat_for_someone_else(client):
    """A standby member doesn't hold a seat: once X's top choice is on, X's
    backup confirmation stops counting against Y's max — so Z, previously
    locked out ("Full"), can join, both on the card and at the confirm
    gate."""
    day = _day(45)
    act_top = _act("Climbing")
    act_back = _act("Karaoke")
    x, y, z = (str(uuid.uuid4()) for _ in range(3))
    _sign_in(client, x, "Xen")
    _sign_in(client, y, "Yara")
    _sign_in(client, z, "Zed")
    _create_slot(client, browser_id=x, day_time_windows=_dtw(day), activities=[act_top, act_back])
    _create_slot(
        client, browser_id=y, day_time_windows=_dtw(day),
        activities=[{"name": act_back, "who_with": [{"max_people": 2}]}],
    )
    _create_slot(client, browser_id=z, day_time_windows=_dtw(day), activities=[act_back])

    assert _confirm(client, browser_id=x, day=day, activity=act_top).status_code == 200
    assert _confirm(client, browser_id=x, day=day, activity=act_back).status_code == 200
    assert _confirm(client, browser_id=y, day=day, activity=act_back).status_code == 200

    # Unordered, X counts: the pair {X, Y} caps Y's max of 2 → Z is Full.
    z_card = next(e for e in _events(client, browser_id=z) if e["confirmed_count"] > 0)
    assert not z_card["can_confirm"]
    party = z_card["id"]

    # X ranks the other activity first (it's met solo) → X goes standby on
    # this one → the seat frees for Z.
    x_cards = {e["activity"].lower(): e for e in _events(client, browser_id=x) if e["viewer_confirmed"]}
    _set_prefs(client, x, day, [[x_cards[act_top.lower()]["id"]], [x_cards[act_back.lower()]["id"]]])
    z_card = next(e for e in _events(client, browser_id=z) if e["id"] == party)
    assert z_card["can_confirm"] and z_card["confirmed_count"] == 1  # just Yara
    r = _confirm(client, browser_id=z, day=day, activity=act_back, event_id=party)
    assert r.status_code == 200, r.text
    # The active pair {Y, Z} is met (Y's max 2 holds with X on standby).
    assert r.json()["met"] and r.json()["confirmed_count"] == 2
