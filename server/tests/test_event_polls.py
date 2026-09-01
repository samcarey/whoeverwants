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
    with psycopg.connect(TEST_DB_URL, row_factory=psycopg.rows.dict_row) as conn:
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


# ---------------------------------------------------------------------------
# Poll OPTIONS (migration 161): the activity's rules for every poll it starts
# ---------------------------------------------------------------------------


def _opts(**over):
    """Poll options with a zone, so the lead times are computable. UTC keeps
    the expected instants readable (the slot's wall clock IS the UTC clock)."""
    return {
        "deadline": "event_start",
        "suggestions": "none",
        "winner_method": "consensus",
        "timezone": "UTC",
        **over,
    }


def _poll_of(client, bid, act):
    evs = [e for e in _events(client, browser_id=bid) if e["activity"].lower() == act.lower()]
    assert evs and evs[0]["poll"], "expected a started poll on the event card"
    r = client.get(f"/api/polls/{evs[0]['poll']['poll_short_id']}", headers=bid_headers(bid))
    assert r.status_code == 200, r.text
    return r.json()


def _at(day: str, hhmm: str):
    from datetime import datetime

    return datetime.fromisoformat(f"{day}T{hhmm}:00+00:00")


def _parse(value):
    from datetime import datetime

    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


class TestPollOptionsRoundTrip:
    def test_options_round_trip(self, client):
        bid = str(uuid.uuid4())
        act = _act("Bouldering")
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(_day(3)),
            activities=[{"name": act, "poll_options": _opts(deadline="2h", suggestions="event:1d")}],
        )
        po = _slots(client, browser_id=bid)[0]["activities"][0]["poll_options"]
        assert po == {
            "deadline": "2h",
            "suggestions": "event:1d",
            "winner_method": "consensus",
            "timezone": "UTC",
        }

    def test_unknown_values_fall_back_per_field(self, client):
        bid = str(uuid.uuid4())
        act = _act("Chess")
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(_day(3)),
            activities=[
                {
                    "name": act,
                    # Junk in every field + a bogus cutoff base.
                    "poll_options": {
                        "deadline": "17 fortnights",
                        "suggestions": "whenever:3h",
                        "winner_method": "vibes",
                    },
                }
            ],
        )
        po = _slots(client, browser_id=bid)[0]["activities"][0]["poll_options"]
        assert po["deadline"] == "event_start"
        assert po["suggestions"] == "none"
        assert po["winner_method"] == "consensus"
        assert "timezone" not in po

    def test_options_survive_a_poll_being_detached(self, client):
        # They're the activity's rules, not the draft's — reattaching a poll
        # later must not need them re-picked.
        bid = str(uuid.uuid4())
        act = _act("Darts")
        day = _day(3)
        slot_id = _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {"name": act, "poll_draft": _ranked_draft(), "poll_options": _opts(deadline="1d")}
            ],
        )
        r = client.put(
            f"/api/slots/{slot_id}",
            json={
                "day_time_windows": _dtw(day),
                "activities": [{"name": act, "poll_draft": None, "poll_options": _opts(deadline="1d")}],
            },
            headers=bid_headers(bid),
        )
        assert r.status_code == 200, r.text
        a = _slots(client, browser_id=bid)[0]["activities"][0]
        assert a["poll_draft"] is None
        assert a["poll_options"]["deadline"] == "1d"


class TestStartedPollDeadlines:
    def test_deadline_at_event_start(self, client):
        bid = str(uuid.uuid4())
        act = _act("Climbing")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _ranked_draft(), "poll_options": _opts()}],
        )
        poll = _poll_of(client, bid, act)
        # Solo owner, 09:00–17:00, no time prefs → the event starts at 09:00.
        assert _parse(poll["response_deadline"]) == _at(day, "09:00")
        assert poll["prephase_deadline"] is None

    def test_deadline_leads_the_event(self, client):
        bid = str(uuid.uuid4())
        act = _act("Bowling")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {"name": act, "poll_draft": _ranked_draft(), "poll_options": _opts(deadline="2h")}
            ],
        )
        assert _parse(_poll_of(client, bid, act)["response_deadline"]) == _at(day, "07:00")

    def test_no_timezone_means_no_deadline(self, client):
        # The pre-161 behavior: without the attacher's zone a wall-clock slot
        # time can't be turned into an instant, so the poll starts open-ended.
        bid = str(uuid.uuid4())
        act = _act("Sailing")
        day = _day(4)
        opts = _opts(deadline="2h")
        opts.pop("timezone")
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _ranked_draft(), "poll_options": opts}],
        )
        assert _poll_of(client, bid, act)["response_deadline"] is None

    def test_unknown_timezone_means_no_deadline(self, client):
        bid = str(uuid.uuid4())
        act = _act("Kayaking")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {
                    "name": act,
                    "poll_draft": _ranked_draft(),
                    "poll_options": _opts(timezone="Mars/Olympus_Mons"),
                }
            ],
        )
        assert _poll_of(client, bid, act)["response_deadline"] is None

    def test_options_absent_keeps_pre_161_behavior(self, client):
        bid = str(uuid.uuid4())
        act = _act("Curling")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[{"name": act, "poll_draft": _ranked_draft()}],
        )
        poll = _poll_of(client, bid, act)
        assert poll["response_deadline"] is None
        assert poll["prephase_deadline"] is None

    def test_past_deadline_is_dropped_rather_than_starting_a_closed_poll(self, client):
        # An event today whose start already passed would compute a deadline
        # in the past; the poll starts open-ended instead of born closed.
        bid = str(uuid.uuid4())
        act = _act("Brunch")
        day = _day(0)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day, "00:01", "23:59"),
            activities=[
                {"name": act, "poll_draft": _ranked_draft(), "poll_options": _opts(deadline="4d")}
            ],
        )
        poll = _poll_of(client, bid, act)
        assert poll["response_deadline"] is None
        assert poll["is_closed"] is False


class TestStartedPollSuggestions:
    def test_suggestions_open_the_poll_option_less_and_seed_the_draft(self, client):
        bid = str(uuid.uuid4())
        act = _act("Dinner out")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {
                    "name": act,
                    "poll_draft": _ranked_draft(),
                    "poll_options": _opts(deadline="event_start", suggestions="event:2h"),
                }
            ],
        )
        poll = _poll_of(client, bid, act)
        assert _parse(poll["prephase_deadline"]) == _at(day, "07:00")
        q = poll["questions"][0]
        # Collecting: the ballot isn't fixed yet…
        assert q["options"] is None
        assert q["suggestion_deadline_minutes"] is not None
        # …and the drafted options ride along as the attacher's suggestions.
        r = client.get(f"/api/questions/{q['id']}/results", headers=bid_headers(bid))
        assert r.status_code == 200, r.text
        names = {s["option"] for s in (r.json().get("suggestion_counts") or [])}
        assert names == {"Dune", "Barbie"}

    def test_suggestions_cutoff_measured_from_the_deadline(self, client):
        bid = str(uuid.uuid4())
        act = _act("Board games")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {
                    "name": act,
                    "poll_draft": _ranked_draft(),
                    "poll_options": _opts(deadline="2h", suggestions="deadline:1h"),
                }
            ],
        )
        poll = _poll_of(client, bid, act)
        assert _parse(poll["response_deadline"]) == _at(day, "07:00")
        assert _parse(poll["prephase_deadline"]) == _at(day, "06:00")

    def test_suggestions_cannot_outlast_voting(self, client):
        # "1 hour before event" with voting closing 4 days before it would put
        # the cutoff after the deadline — clamped to just inside it.
        bid = str(uuid.uuid4())
        act = _act("Picnic")
        day = _day(6)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {
                    "name": act,
                    "poll_draft": _ranked_draft(),
                    "poll_options": _opts(deadline="4d", suggestions="event:1h"),
                }
            ],
        )
        poll = _poll_of(client, bid, act)
        deadline = _parse(poll["response_deadline"])
        prephase = _parse(poll["prephase_deadline"])
        assert deadline == _at(day, "09:00") - timedelta(days=4)
        assert prephase == deadline - timedelta(minutes=1)

    def test_yes_no_ignores_suggestions(self, client):
        bid = str(uuid.uuid4())
        act = _act("Nightcap")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {
                    "name": act,
                    "poll_draft": _yes_no_draft(),
                    "poll_options": _opts(suggestions="event:2h"),
                }
            ],
        )
        poll = _poll_of(client, bid, act)
        assert poll["questions"][0]["question_type"] == "yes_no"
        assert poll["prephase_deadline"] is None


class TestStartedPollWinnerMethod:
    def test_options_win_over_the_draft(self, client):
        bid = str(uuid.uuid4())
        act = _act("Trivia")
        day = _day(4)
        _create_slot(
            client,
            browser_id=bid,
            day_time_windows=_dtw(day),
            activities=[
                {
                    "name": act,
                    # The draft says consensus; the activity's options say
                    # favorite, and the activity is the source of truth.
                    "poll_draft": _ranked_draft(),
                    "poll_options": _opts(winner_method="favorite"),
                }
            ],
        )
        assert _poll_of(client, bid, act)["questions"][0]["winner_method"] == "favorite"
