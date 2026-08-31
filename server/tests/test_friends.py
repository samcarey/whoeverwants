"""Friends system (migration 158): request lifecycle, block lists, private
contact groups, the shareable friend code / profile link, event-based
friend suggestions, the friends-only who-with picker, and the block
partition in event matching (blocked pairs never share a suggested event,
but each still gets events without the other)."""

import uuid
from datetime import date, timedelta

import psycopg

from services.auth import generate_token, hash_token, normalize_email
from tests.conftest import TEST_DB_URL, bid_headers


def _act(base: str) -> str:
    return f"{base} {uuid.uuid4().hex[:6]}"


def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def _dtw(day: str, min_: str = "09:00", max_: str = "17:00") -> list[dict]:
    return [{"day": day, "windows": [{"min": min_, "max": max_}]}]


def _sign_in(client, browser_id, name):
    email = f"friend-{uuid.uuid4().hex[:8]}@example.com"
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
    r = client.post(
        "/api/auth/magic-link/verify", json={"token": token}, headers=bid_headers(browser_id)
    )
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["user_id"]
    with psycopg.connect(TEST_DB_URL) as conn:
        conn.execute("UPDATE users SET display_name = %s WHERE id = %s::uuid", (name, uid))
        conn.commit()
    return uid


def _person(client, name):
    bid = str(uuid.uuid4())
    uid = _sign_in(client, bid, name)
    return bid, uid


def _overview(client, bid):
    r = client.get("/api/friends", headers=bid_headers(bid))
    assert r.status_code == 200, r.text
    return r.json()


def _send(client, bid, *, to_user_id=None, code=None):
    return client.post(
        "/api/friends/requests",
        json={"to_user_id": to_user_id, "code": code},
        headers=bid_headers(bid),
    )


def _befriend(client, a_bid, b_bid, b_uid, a_uid):
    """a requests b, b requests a back (auto-accept)."""
    assert _send(client, a_bid, to_user_id=b_uid).json()["status"] == "requested"
    assert _send(client, b_bid, to_user_id=a_uid).json()["status"] == "friends"


def _create_slot(client, *, browser_id, day, activity, windows=("09:00", "17:00")):
    r = client.post(
        "/api/slots",
        json={
            "day_time_windows": _dtw(day, *windows),
            "activities": [{"name": activity}],
        },
        headers=bid_headers(browser_id),
    )
    assert r.status_code == 200, r.text


def _events(client, bid):
    r = client.get("/api/slots/events", headers=bid_headers(bid))
    assert r.status_code == 200, r.text
    return r.json()["events"]


# ---------------------------------------------------------------------------
# Requests + friendships
# ---------------------------------------------------------------------------

def test_request_accept_round_trip(client):
    a_bid, a_uid = _person(client, "Ava")
    b_bid, b_uid = _person(client, "Ben")

    assert _send(client, a_bid, to_user_id=b_uid).json()["status"] == "requested"
    ov_a = _overview(client, a_bid)
    assert [o["user_id"] for o in ov_a["outgoing"]] == [b_uid]

    ov_b = _overview(client, b_bid)
    assert [i["user_id"] for i in ov_b["incoming"]] == [a_uid]
    req_id = ov_b["incoming"][0]["id"]

    r = client.post(f"/api/friends/requests/{req_id}/accept", headers=bid_headers(b_bid))
    assert r.status_code == 200, r.text

    assert [f["user_id"] for f in _overview(client, a_bid)["friends"]] == [b_uid]
    assert [f["user_id"] for f in _overview(client, b_bid)["friends"]] == [a_uid]


def test_mutual_requests_auto_accept(client):
    a_bid, a_uid = _person(client, "Cara")
    b_bid, b_uid = _person(client, "Dev")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    assert [f["user_id"] for f in _overview(client, a_bid)["friends"]] == [b_uid]


def test_reject_then_re_request(client):
    a_bid, a_uid = _person(client, "Esme")
    b_bid, b_uid = _person(client, "Finn")
    _send(client, a_bid, to_user_id=b_uid)
    req_id = _overview(client, b_bid)["incoming"][0]["id"]
    r = client.post(f"/api/friends/requests/{req_id}/reject", headers=bid_headers(b_bid))
    assert r.status_code == 200
    assert _overview(client, b_bid)["incoming"] == []
    # Rejection isn't a wall — a fresh request can be sent later.
    assert _send(client, a_bid, to_user_id=b_uid).json()["status"] == "requested"
    assert len(_overview(client, b_bid)["incoming"]) == 1


def test_unfriend_and_group_membership_pruned(client):
    a_bid, a_uid = _person(client, "Gia")
    b_bid, b_uid = _person(client, "Hal")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    g = client.post(
        "/api/friends/groups",
        json={"name": _act("Crew"), "member_ids": [b_uid]},
        headers=bid_headers(a_bid),
    )
    assert g.status_code == 201, g.text
    groups = _overview(client, a_bid)["groups"]
    assert [m["user_id"] for m in groups[0]["members"]] == [b_uid]

    r = client.delete(f"/api/friends/friendship/{b_uid}", headers=bid_headers(a_bid))
    assert r.status_code == 204
    ov = _overview(client, a_bid)
    assert ov["friends"] == []
    assert ov["groups"][0]["members"] == []


def test_only_recipient_can_accept(client):
    a_bid, a_uid = _person(client, "Ida")
    b_bid, b_uid = _person(client, "Jon")
    _send(client, a_bid, to_user_id=b_uid)
    req_id = _overview(client, b_bid)["incoming"][0]["id"]
    # The SENDER can't accept their own request.
    r = client.post(f"/api/friends/requests/{req_id}/accept", headers=bid_headers(a_bid))
    assert r.status_code == 404


def test_anonymous_gets_empty_overview_and_401_on_write(client):
    fresh = str(uuid.uuid4())
    ov = _overview(client, fresh)
    assert ov["signed_in"] is False
    assert ov["friends"] == []
    # Note: POSTing mints nothing — a browser-linked account doesn't exist
    # and writes require one.
    r = _send(client, str(uuid.uuid4()), to_user_id=str(uuid.uuid4()))
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

def test_block_severs_and_hides(client):
    a_bid, a_uid = _person(client, "Kai")
    b_bid, b_uid = _person(client, "Lea")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)

    r = client.post("/api/friends/blocks", json={"user_id": b_uid}, headers=bid_headers(a_bid))
    assert r.status_code == 200
    ov_a = _overview(client, a_bid)
    assert ov_a["friends"] == []
    assert [b["user_id"] for b in ov_a["blocked"]] == [b_uid]
    # The blocked side sees the friendship gone but never the block itself.
    ov_b = _overview(client, b_bid)
    assert ov_b["friends"] == []
    assert ov_b["blocked"] == []
    # A request from the blocked party reports success but creates nothing.
    assert _send(client, b_bid, to_user_id=a_uid).json()["status"] == "requested"
    assert _overview(client, a_bid)["incoming"] == []

    # Unblock → requests flow again.
    r = client.delete(f"/api/friends/blocks/{b_uid}", headers=bid_headers(a_bid))
    assert r.status_code == 204
    assert _send(client, b_bid, to_user_id=a_uid).json()["status"] == "requested"
    assert len(_overview(client, a_bid)["incoming"]) == 1


def test_block_from_incoming_request(client):
    a_bid, a_uid = _person(client, "Mia")
    b_bid, b_uid = _person(client, "Noe")
    _send(client, a_bid, to_user_id=b_uid)
    req_id = _overview(client, b_bid)["incoming"][0]["id"]
    r = client.post(f"/api/friends/requests/{req_id}/block", headers=bid_headers(b_bid))
    assert r.status_code == 200
    ov = _overview(client, b_bid)
    assert ov["incoming"] == []
    assert [b["user_id"] for b in ov["blocked"]] == [a_uid]


# ---------------------------------------------------------------------------
# Profile link
# ---------------------------------------------------------------------------

def test_profile_link_flow(client):
    a_bid, a_uid = _person(client, "Ora")
    b_bid, b_uid = _person(client, "Pia")
    code = _overview(client, a_bid)["friend_code"]
    assert code

    r = client.get(f"/api/friends/profile/{code}", headers=bid_headers(b_bid))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Ora"
    assert r.json()["relationship"] == "none"

    # The opener taps Add friend → a request lands on the OWNER's side.
    assert _send(client, b_bid, code=code).json()["status"] == "requested"
    assert (
        client.get(f"/api/friends/profile/{code}", headers=bid_headers(b_bid)).json()["relationship"]
        == "outgoing"
    )
    assert [i["user_id"] for i in _overview(client, a_bid)["incoming"]] == [b_uid]

    # Blocked-by-owner viewers see a dead link.
    client.post("/api/friends/blocks", json={"user_id": b_uid}, headers=bid_headers(a_bid))
    assert client.get(f"/api/friends/profile/{code}", headers=bid_headers(b_bid)).status_code == 404

    # The code is stable across overview reads.
    assert _overview(client, a_bid)["friend_code"] == code


def test_profile_unknown_code_404(client):
    assert client.get("/api/friends/profile/not-a-real-code").status_code == 404


# ---------------------------------------------------------------------------
# Suggestions (people from shared suggested events)
# ---------------------------------------------------------------------------

def test_event_co_candidates_are_suggested(client):
    a_bid, a_uid = _person(client, "Quinn")
    b_bid, b_uid = _person(client, "Rey")
    act, day = _act("Bocce"), _day(3)
    _create_slot(client, browser_id=a_bid, day=day, activity=act)
    _create_slot(client, browser_id=b_bid, day=day, activity=act)

    assert a_uid in [s["user_id"] for s in _overview(client, b_bid)["suggestions"]]
    assert b_uid in [s["user_id"] for s in _overview(client, a_bid)["suggestions"]]

    # Once friends, they drop out of suggestions.
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    assert b_uid not in [s["user_id"] for s in _overview(client, a_bid)["suggestions"]]


# ---------------------------------------------------------------------------
# Contact groups
# ---------------------------------------------------------------------------

def test_contact_group_crud_and_friend_gate(client):
    a_bid, a_uid = _person(client, "Sol")
    b_bid, b_uid = _person(client, "Tam")
    stranger_uid = _person(client, "Uma")[1]
    _befriend(client, a_bid, b_bid, b_uid, a_uid)

    name = _act("Board Gamers")
    g = client.post(
        "/api/friends/groups",
        json={"name": name, "member_ids": [b_uid, stranger_uid]},
        headers=bid_headers(a_bid),
    )
    assert g.status_code == 201, g.text
    gid = g.json()["id"]
    groups = _overview(client, a_bid)["groups"]
    # Non-friends are silently filtered out of membership.
    assert [m["user_id"] for m in groups[0]["members"]] == [b_uid]

    # Duplicate name → 409.
    dup = client.post(
        "/api/friends/groups", json={"name": name.upper()}, headers=bid_headers(a_bid)
    )
    assert dup.status_code == 409

    r = client.put(
        f"/api/friends/groups/{gid}",
        json={"name": _act("Renamed"), "member_ids": []},
        headers=bid_headers(a_bid),
    )
    assert r.status_code == 200
    assert _overview(client, a_bid)["groups"][0]["members"] == []

    # Another user can't touch it.
    r = client.put(
        f"/api/friends/groups/{gid}", json={"name": "hax"}, headers=bid_headers(b_bid)
    )
    assert r.status_code == 404

    assert client.delete(f"/api/friends/groups/{gid}", headers=bid_headers(a_bid)).status_code == 204
    assert _overview(client, a_bid)["groups"] == []


def test_who_with_candidates_are_friends_and_contact_groups(client):
    a_bid, a_uid = _person(client, "Vic")
    b_bid, b_uid = _person(client, "Wyn")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    gname = _act("Climbers")
    client.post(
        "/api/friends/groups",
        json={"name": gname, "member_ids": [b_uid]},
        headers=bid_headers(a_bid),
    )
    r = client.get("/api/slots/who-with-candidates", headers=bid_headers(a_bid))
    assert r.status_code == 200, r.text
    cands = r.json()["candidates"]
    assert {"kind": "people", "name": "Wyn"} in [
        {"kind": c["kind"], "name": c["name"]} for c in cands
    ]
    assert gname in [c["name"] for c in cands if c["kind"] == "groups"]


def test_who_with_contact_group_ref_matches_in_events(client):
    """A With pick of a CONTACT group resolves in matching: only the group's
    members satisfy the include condition."""
    a_bid, a_uid = _person(client, "Xen")
    b_bid, b_uid = _person(client, "Yara")
    c_bid, c_uid = _person(client, "Zed")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    act, day = _act("Chess"), _day(4)
    gid = client.post(
        "/api/friends/groups",
        json={"name": _act("Chess Club"), "member_ids": [b_uid]},
        headers=bid_headers(a_bid),
    ).json()["id"]

    r = client.post(
        "/api/slots",
        json={
            "day_time_windows": _dtw(day),
            "activities": [
                {
                    "name": act,
                    "who_with": [
                        {
                            "min_people": 2,
                            "max_people": None,
                            "groups": [{"id": gid, "name": "Chess Club"}],
                            "people": [],
                            "exclude_groups": [],
                            "exclude_people": [],
                        }
                    ],
                }
            ],
        },
        headers=bid_headers(a_bid),
    )
    assert r.status_code == 200, r.text
    _create_slot(client, browser_id=b_bid, day=day, activity=act)
    _create_slot(client, browser_id=c_bid, day=day, activity=act)

    # A's condition admits B (in the contact group); a viable {A, B} exists.
    a_cards = [e for e in _events(client, a_bid) if e["activity"].lower() == act.lower()]
    assert a_cards, "A should get a card (B satisfies the group include)"
    # C is not in the group, so C alone can't satisfy A's include — but C and
    # B can still gather without A's condition applying to them.
    c_cards = [e for e in _events(client, c_bid) if e["activity"].lower() == act.lower()]
    assert c_cards


# ---------------------------------------------------------------------------
# Block partition in matching
# ---------------------------------------------------------------------------

def test_blocked_pair_never_shares_an_event_but_each_still_matches(client):
    a_bid, a_uid = _person(client, "Ash")
    b_bid, b_uid = _person(client, "Bo")
    c_bid, c_uid = _person(client, "Cy")
    act, day = _act("Padel"), _day(5)
    for bid in (a_bid, b_bid, c_bid):
        _create_slot(client, browser_id=bid, day=day, activity=act)

    # Pre-block: everyone sees one shared proposal.
    assert [e for e in _events(client, a_bid) if e["activity"].lower() == act.lower()]

    client.post("/api/friends/blocks", json={"user_id": b_uid}, headers=bid_headers(a_bid))

    # A confirms; B joining A's party must fail, but B+C works.
    r = client.post(
        "/api/slots/events/confirmation",
        json={"day": day, "activity": act, "confirmed": True},
        headers=bid_headers(a_bid),
    )
    assert r.status_code == 200, r.text
    a_party = r.json()["id"]

    rb = client.post(
        "/api/slots/events/confirmation",
        json={"day": day, "activity": act, "confirmed": True, "event_id": a_party},
        headers=bid_headers(b_bid),
    )
    assert rb.status_code == 409  # Full — the block partitions them

    # B without a target gets their OWN party (minted), never A's.
    rb2 = client.post(
        "/api/slots/events/confirmation",
        json={"day": day, "activity": act, "confirmed": True},
        headers=bid_headers(b_bid),
    )
    assert rb2.status_code == 200, rb2.text
    assert rb2.json()["id"] != a_party

    # A's cards never mention B; B's never mention A. C still sees both
    # parties (C blocked no one).
    a_names = {n for e in _events(client, a_bid) for n in e["confirmed_names"]}
    b_names = {n for e in _events(client, b_bid) for n in e["confirmed_names"]}
    assert "Bo" not in a_names
    assert "Ash" not in b_names
    c_cards = [e for e in _events(client, c_bid) if e["activity"].lower() == act.lower()]
    c_names = {n for e in c_cards for n in e["confirmed_names"]}
    assert {"Ash", "Bo"} <= c_names


def test_blocked_users_activities_not_suggested(client):
    a_bid, a_uid = _person(client, "Dot")
    b_bid, b_uid = _person(client, "Eli")
    act, day = _act("Karting"), _day(6)
    _create_slot(client, browser_id=b_bid, day=day, activity=act)

    r = client.post(
        "/api/slots/suggestions",
        json={"day_time_windows": _dtw(day)},
        headers=bid_headers(a_bid),
    )
    all_names = [s["name"] for g in r.json().values() for s in g]
    assert act in all_names

    client.post("/api/friends/blocks", json={"user_id": b_uid}, headers=bid_headers(a_bid))
    r = client.post(
        "/api/slots/suggestions",
        json={"day_time_windows": _dtw(day)},
        headers=bid_headers(a_bid),
    )
    all_names = [s["name"] for g in r.json().values() for s in g]
    assert act not in all_names


# ---------------------------------------------------------------------------
# Nested contact groups (migration 159)
# ---------------------------------------------------------------------------

def test_nested_groups_round_trip_and_cycle_refused(client):
    a_bid, a_uid = _person(client, "Faye")
    b_bid, b_uid = _person(client, "Gus")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    inner = client.post(
        "/api/friends/groups",
        json={"name": _act("Inner"), "member_ids": [b_uid]},
        headers=bid_headers(a_bid),
    ).json()["id"]
    outer = client.post(
        "/api/friends/groups",
        json={"name": _act("Outer"), "child_group_ids": [inner]},
        headers=bid_headers(a_bid),
    ).json()["id"]

    groups = {g["id"]: g for g in _overview(client, a_bid)["groups"]}
    assert [c["id"] for c in groups[outer]["child_groups"]] == [inner]

    # Cycle refused: Inner can't contain Outer (silently dropped, like
    # non-friend members). Self-containment refused too.
    r = client.put(
        f"/api/friends/groups/{inner}",
        json={"child_group_ids": [outer, inner]},
        headers=bid_headers(a_bid),
    )
    assert r.status_code == 200
    groups = {g["id"]: g for g in _overview(client, a_bid)["groups"]}
    assert groups[inner]["child_groups"] == []
    # The original nesting is untouched.
    assert [c["id"] for c in groups[outer]["child_groups"]] == [inner]


def test_nested_group_ref_expands_in_matching(client):
    """A With pick of an OUTER group admits people who are only members of
    its nested INNER group — the recursive expansion in matching."""
    a_bid, a_uid = _person(client, "Hana")
    b_bid, b_uid = _person(client, "Ivo")
    _befriend(client, a_bid, b_bid, b_uid, a_uid)
    act, day = _act("Poker"), _day(4)
    inner = client.post(
        "/api/friends/groups",
        json={"name": _act("Inner Circle"), "member_ids": [b_uid]},
        headers=bid_headers(a_bid),
    ).json()["id"]
    outer = client.post(
        "/api/friends/groups",
        json={"name": _act("Everyone"), "child_group_ids": [inner]},
        headers=bid_headers(a_bid),
    ).json()["id"]

    r = client.post(
        "/api/slots",
        json={
            "day_time_windows": _dtw(day),
            "activities": [
                {
                    "name": act,
                    "who_with": [
                        {
                            "min_people": 2,
                            "max_people": None,
                            "groups": [{"id": outer, "name": "Everyone"}],
                            "people": [],
                            "exclude_groups": [],
                            "exclude_people": [],
                        }
                    ],
                }
            ],
        },
        headers=bid_headers(a_bid),
    )
    assert r.status_code == 200, r.text
    _create_slot(client, browser_id=b_bid, day=day, activity=act)

    # B satisfies A's include only via Inner nested under Everyone.
    a_cards = [e for e in _events(client, a_bid) if e["activity"].lower() == act.lower()]
    assert a_cards, "outer-group pick should admit the nested group's member"
