"""Profile card + poll voter-roster coverage.

Exercises `GET /api/users/{user_id}/profile-card` and
`GET /api/groups/by-route-id/{route_id}/poll/{poll_ref}/voter-identities`:

  * profile-card returns name + account age + the groups BOTH the caller and
    the target belong to (caller-scoped intersection).
  * the poll voter roster returns one entry per distinct VOTER person
    (account-deduped, so two same-named voters are two entries), plus a
    rolled-up anonymous count — same shape as the group `/members` roster.

(The group `/members` roster itself is covered by the #683 tests.)

Creators auto-mint an account (display_name = creator_name) keyed on the
creating browser_id, so two polls created by two browsers give us two named
accounts that share a group — no magic-link sign-in needed.
"""

import uuid

import pytest

from tests.conftest import create_poll


def _bid(uid):
    return {"X-Browser-Id": uid}


def _vote(client, poll, qid, browser, name, choice):
    r = client.post(
        f"/api/polls/{poll['id']}/votes",
        json={
            "voter_name": name,
            "items": [
                {"question_id": qid, "vote_type": "yes_no", "yes_no_choice": choice}
            ],
        },
        headers=_bid(browser),
    )
    assert r.status_code == 201, r.text


@pytest.fixture
def browsers():
    return {k: str(uuid.uuid4()) for k in ("a", "b", "c", "d")}


def test_poll_voters_distinct_and_scoped(client, browsers):
    p1 = create_poll(client, browser_id=browsers["a"], creator_name="Alice")
    g = p1["group_id"]
    qid = p1["questions"][0]["id"]
    # Bob + Cara have accounts (they create polls in the group) and vote.
    create_poll(client, browser_id=browsers["b"], creator_name="Bob", group_id=g)
    create_poll(client, browser_id=browsers["c"], creator_name="Cara", group_id=g)
    _vote(client, p1, qid, browsers["b"], "Bob", "yes")
    _vote(client, p1, qid, browsers["c"], "Cara", "no")

    resp = client.get(
        f"/api/groups/by-route-id/{p1['group_short_id']}/poll/{p1['short_id']}/voter-identities",
        headers=_bid(browsers["a"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_name = {m["name"]: m for m in body["members"]}
    assert set(by_name) == {"Bob", "Cara"}  # Alice (creator, no vote) excluded
    assert by_name["Bob"]["user_id"] is not None


def test_poll_voters_distinguish_duplicate_names(client, browsers):
    # Two different accounts both named "Sam" vote → two entries, distinct ids.
    p1 = create_poll(client, browser_id=browsers["a"], creator_name="Alice")
    g = p1["group_id"]
    qid = p1["questions"][0]["id"]
    s1 = create_poll(client, browser_id=browsers["b"], creator_name="Sam", group_id=g)
    s2 = create_poll(client, browser_id=browsers["c"], creator_name="Sam", group_id=g)
    _vote(client, p1, qid, browsers["b"], "Sam", "yes")
    _vote(client, p1, qid, browsers["c"], "Sam", "no")

    resp = client.get(
        f"/api/groups/by-route-id/{p1['group_short_id']}/poll/{p1['short_id']}/voter-identities",
        headers=_bid(browsers["a"]),
    )
    assert resp.status_code == 200, resp.text
    sams = [m for m in resp.json()["members"] if m["name"] == "Sam"]
    ids = {m["user_id"] for m in sams}
    assert ids == {s1["creator_user_id"], s2["creator_user_id"]}
    assert len(sams) == 2


def test_poll_voters_non_member_404(client, browsers):
    p1 = create_poll(client, browser_id=browsers["a"], creator_name="Alice")
    resp = client.get(
        f"/api/groups/by-route-id/{p1['group_short_id']}/poll/{p1['short_id']}/voter-identities",
        headers=_bid(browsers["d"]),  # never participated → not a member
    )
    assert resp.status_code == 404, resp.text


def test_poll_voters_unknown_poll_404(client, browsers):
    p1 = create_poll(client, browser_id=browsers["a"], creator_name="Alice")
    resp = client.get(
        f"/api/groups/by-route-id/{p1['group_short_id']}/poll/ZZZZ/voter-identities",
        headers=_bid(browsers["a"]),
    )
    assert resp.status_code == 404


def test_profile_card_shows_shared_groups(client, browsers):
    # Shared group G (A + B); A-only group G2.
    p1 = create_poll(client, browser_id=browsers["a"], creator_name="Alice")
    g = p1["group_id"]
    g_route = p1["group_short_id"]
    p2 = create_poll(client, browser_id=browsers["b"], creator_name="Bob", group_id=g)
    bob_id = p2["creator_user_id"]
    create_poll(client, browser_id=browsers["a"], creator_name="Alice")  # G2

    resp = client.get(
        f"/api/users/{bob_id}/profile-card",
        headers=_bid(browsers["a"]),
    )
    assert resp.status_code == 200, resp.text
    card = resp.json()
    assert card["user_id"] == bob_id
    assert card["name"] == "Bob"
    assert card["created_at"]  # account age source
    routes = {sg["route_id"] for sg in card["shared_groups"]}
    assert g_route in routes


def test_profile_card_unknown_user_404(client, browsers):
    resp = client.get(
        f"/api/users/{uuid.uuid4()}/profile-card",
        headers=_bid(browsers["a"]),
    )
    assert resp.status_code == 404
