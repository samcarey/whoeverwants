"""Polls attached to Playlist activities (migration 156): the poll_draft
round-trip on slot_activities, and the start-on-viability flow — when the
events engine finds a viable gathering for a (day, activity) key that has an
attached draft, a REAL poll is created (one per key), its candidates become
group members, and the events payload carries the poll ref."""

import uuid
from datetime import date, timedelta

import psycopg

from tests.conftest import TEST_DB_URL, bid_headers


def _act(base: str) -> str:
    """Per-test-unique activity name (events key on (day, LOWER(activity)) in
    a persistent dev DB — see test_slot_events._act)."""
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
    return r.json()["id"]


def _slots(client, *, browser_id):
    r = client.get("/api/slots", headers=bid_headers(browser_id))
    assert r.status_code == 200, r.text
    return r.json()["slots"]


def _events(client, *, browser_id):
    r = client.get("/api/slots/events", headers=bid_headers(browser_id))
    assert r.status_code == 200, r.text
    return r.json()["events"]


def _ranked_draft(title="Dune or Barbie for movie night?", options=("Dune", "Barbie")):
    return {
        "title": title,
        "question": {
            "question_type": "ranked_choice",
            "category": "movie",
            "options": list(options),
            "context": "movie night",
            "winner_method": "consensus",
            "is_auto_title": True,
        },
    }


def _yes_no_draft(prompt="Should we grab dinner after?"):
    return {
        "title": f"{prompt}?",
        "question": {
            "question_type": "yes_no",
            "context": prompt,
            "is_auto_title": False,
        },
    }


def _event_poll_rows(day, key):
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT poll_id, title FROM slot_event_polls"
            " WHERE day = %s::date AND LOWER(activity) = %s",
            (day, key),
        ).fetchall()
    return rows


class TestPollDraftRoundTrip:
    def test_valid_draft_round_trips(self, client):
        bid = str(uuid.uuid4())
        act = _act("Movies")
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(_day(3)),
            activities=[{"name": act, "poll_draft": _ranked_draft()}],
        )
        slots = _slots(client, browser_id=bid)
        pd = slots[0]["activities"][0]["poll_draft"]
        assert pd is not None
        assert pd["question"]["question_type"] == "ranked_choice"
        assert pd["question"]["options"] == ["Dune", "Barbie"]
        assert pd["question"]["context"] == "movie night"
        assert pd["title"] == "Dune or Barbie for movie night?"

    def test_incomplete_ranked_draft_is_dropped(self, client):
        bid = str(uuid.uuid4())
        act = _act("Games")
        draft = _ranked_draft(options=("Only one",))
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(_day(3)),
            activities=[{"name": act, "poll_draft": draft}],
        )
        slots = _slots(client, browser_id=bid)
        assert slots[0]["activities"][0]["poll_draft"] is None

    def test_junk_question_fields_are_whitelisted_away(self, client):
        bid = str(uuid.uuid4())
        act = _act("Trivia")
        draft = _ranked_draft()
        draft["question"]["supply_count"] = 99
        draft["question"]["day_time_windows"] = [{"day": "2030-01-01"}]
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(_day(3)),
            activities=[{"name": act, "poll_draft": draft}],
        )
        pd = _slots(client, browser_id=bid)[0]["activities"][0]["poll_draft"]
        assert "supply_count" not in pd["question"]
        assert "day_time_windows" not in pd["question"]


class TestStartOnViability:
    def test_solo_viable_gathering_starts_the_poll(self, client):
        # Default who-with minimum is 1 ("Just me"), so the owner alone is a
        # viable gathering — attaching the draft + saving starts the poll.
        bid = str(uuid.uuid4())
        act = _act("Movie night")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _ranked_draft()}],
        )
        rows = _event_poll_rows(day, act.lower())
        assert len(rows) == 1
        assert rows[0]["title"] == "Dune or Barbie for movie night?"

        evs = [e for e in _events(client, browser_id=bid) if e["activity"].lower() == act.lower()]
        assert evs, "the owner should see their event card"
        poll = evs[0]["poll"]
        assert poll is not None
        assert poll["title"] == "Dune or Barbie for movie night?"
        assert poll["is_closed"] is False
        assert poll["poll_short_id"]
        assert poll["group_short_id"]

        # The started poll is a real, readable poll with the drafted ballot.
        r = client.get(f"/api/polls/{poll['poll_short_id']}", headers=bid_headers(bid))
        assert r.status_code == 200, r.text
        q = r.json()["questions"][0]
        assert q["question_type"] == "ranked_choice"
        assert q["options"] == ["Dune", "Barbie"]

    def test_one_poll_per_key_across_resaves(self, client):
        bid = str(uuid.uuid4())
        act = _act("Poker")
        day = _day(5)
        slot_id = _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _yes_no_draft()}],
        )
        # Re-save the same slot (the editor's ✓) — the key already has a poll.
        r = client.put(
            f"/api/slots/{slot_id}",
            json={
                "day_time_windows": _dtw(day),
                "activities": [{"name": act, "poll_draft": _yes_no_draft()}],
            },
            headers=bid_headers(bid),
        )
        assert r.status_code == 200, r.text
        assert len(_event_poll_rows(day, act.lower())) == 1

    def test_yes_no_draft_starts_a_yes_no_poll(self, client):
        bid = str(uuid.uuid4())
        act = _act("Dinner")
        day = _day(6)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _yes_no_draft("Thai place this time")}],
        )
        evs = [e for e in _events(client, browser_id=bid) if e["activity"].lower() == act.lower()]
        poll = evs[0]["poll"]
        r = client.get(f"/api/polls/{poll['poll_short_id']}", headers=bid_headers(bid))
        assert r.status_code == 200, r.text
        q = r.json()["questions"][0]
        assert q["question_type"] == "yes_no"
        assert q["details"] == "Thai place this time"

    def test_candidates_become_group_members_and_see_the_poll(self, client):
        # A attaches the draft; B tags the same activity with an overlapping
        # window BEFORE A. When A's save starts the poll, BOTH are candidates
        # → both become members of the poll's group, and B's event card
        # carries the poll too.
        a_bid, b_bid = str(uuid.uuid4()), str(uuid.uuid4())
        act = _act("Frisbee")
        day = _day(7)
        _create_slot(
            client,
            browser_id=b_bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act}],
        )
        _create_slot(
            client,
            browser_id=a_bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _ranked_draft(title="Which park?", options=("North", "South"))}],
        )
        b_evs = [e for e in _events(client, browser_id=b_bid) if e["activity"].lower() == act.lower()]
        assert b_evs and b_evs[0]["poll"] is not None
        poll = b_evs[0]["poll"]
        assert poll["title"] == "Which park?"

        # B's browser is a member of the poll's group (added at start time),
        # so the poll shows on B's home list / is votable.
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                """
                SELECT 1
                  FROM slot_event_polls sep
                  JOIN polls p ON p.id = sep.poll_id
                  JOIN group_members gm ON gm.group_id = p.group_id
                  JOIN user_browsers ub ON ub.browser_id = gm.browser_id
                  JOIN slots s ON s.user_id = ub.user_id
                 WHERE sep.day = %s::date AND LOWER(sep.activity) = %s
                   AND ub.browser_id = %s::uuid
                 LIMIT 1
                """,
                (day, act.lower(), b_bid),
            ).fetchone()
        assert row is not None

    def test_no_draft_no_poll(self, client):
        bid = str(uuid.uuid4())
        act = _act("Chess")
        day = _day(8)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act}],
        )
        assert _event_poll_rows(day, act.lower()) == []
        evs = [e for e in _events(client, browser_id=bid) if e["activity"].lower() == act.lower()]
        assert evs and evs[0]["poll"] is None
