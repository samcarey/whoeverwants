"""Tests for GET /api/polls/{short_id}/summary — the identity-free compact
summary powering the iMessage live transcript bubble (Phase 2 of
docs/imessage-extension-plan.md)."""

import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import (
    close_poll,
    create_poll,
    group_members_for,
    yes_no_question,
)


def _future_date(days: int = 3) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


def _future_iso(hours: int = 72) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _vote_yes_no(client, poll, voter_name, choice, *, question_id=None, browser_id=None):
    body = {
        "voter_name": voter_name,
        "items": [
            {
                "question_id": question_id or poll["questions"][0]["id"],
                "vote_type": "yes_no",
                "yes_no_choice": choice,
            }
        ],
    }
    headers = {"X-Browser-Id": browser_id or str(uuid.uuid4())}
    resp = client.post(f"/api/polls/{poll['id']}/votes", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _summary(client, poll, **kwargs):
    resp = client.get(f"/api/polls/{poll['short_id']}/summary", **kwargs)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPollSummary:
    def test_unknown_short_id_404(self, client):
        resp = client.get("/api/polls/zzzzzzzz/summary")
        assert resp.status_code == 404

    def test_yes_no_counts_and_result_text(self, client):
        poll = create_poll(client, title="Pizza night?")
        _vote_yes_no(client, poll, "Ann", "yes")
        _vote_yes_no(client, poll, "Bob", "yes")
        _vote_yes_no(client, poll, "Cara", "no")
        s = _summary(client, poll)
        assert s["poll_id"] == poll["id"]
        assert s["short_id"] == poll["short_id"]
        assert s["title"] == "Pizza night?"
        assert s["is_closed"] is False
        assert s["respondent_count"] == 3
        (q,) = s["questions"]
        assert q["question_type"] == "yes_no"
        assert q["yes_count"] == 2
        assert q["no_count"] == 1
        assert q["result_text"] == "Yes 2 · No 1"
        # Single-question polls carry no disambiguator label.
        assert q["label"] is None

    def test_no_votes_yet(self, client):
        poll = create_poll(client)
        s = _summary(client, poll)
        assert s["respondent_count"] == 0
        assert s["questions"][0]["result_text"] == "No votes yet"

    def test_identity_free_and_no_membership_write(self, client):
        """The endpoint needs no identity headers AND must not auto-join the
        caller (a transcript bubble render is passive, not a visit)."""
        poll = create_poll(client)
        before = set(group_members_for(poll["group_id"]))
        resp = client.get(f"/api/polls/{poll['short_id']}/summary")
        assert resp.status_code == 200
        assert set(group_members_for(poll["group_id"])) == before

    def test_multi_question_labels(self, client):
        poll = create_poll(
            client,
            questions=[
                yes_no_question(context="Up for it?"),
                {
                    "question_type": "ranked_choice",
                    "category": "restaurant",
                    "context": "Dinner",
                    "options": ["Thai", "Sushi"],
                },
            ],
        )
        s = _summary(client, poll)
        labels = {q["question_type"]: q["label"] for q in s["questions"]}
        # yes_no label is the typed context alone (the "Yes/No is a category,
        # not display text" rule); the ranked question gets "<Label> for <Ctx>".
        assert labels["yes_no"] == "Up for it?"
        assert labels["ranked_choice"] == "Restaurant for Dinner"

    def test_closed_ranked_choice_winner(self, client):
        poll = create_poll(
            client,
            questions=[
                {
                    "question_type": "ranked_choice",
                    "category": "custom",
                    "options": ["Thai", "Sushi"],
                }
            ],
        )
        qid = poll["questions"][0]["id"]
        body = {
            "voter_name": "Ann",
            "items": [
                {
                    "question_id": qid,
                    "vote_type": "ranked_choice",
                    "ranked_choices": ["Thai", "Sushi"],
                }
            ],
        }
        resp = client.post(
            f"/api/polls/{poll['id']}/votes",
            json=body,
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 201, resp.text
        s_open = _summary(client, poll)
        assert s_open["questions"][0]["result_text"] == "Leading: Thai"
        # The expanded ranked ballot (Phase 5) needs the candidate list.
        assert s_open["questions"][0]["options"] == ["Thai", "Sushi"]
        assert close_poll(client, poll).status_code == 200
        s_closed = _summary(client, poll)
        assert s_closed["is_closed"] is True
        assert s_closed["questions"][0]["result_text"] == "Winner: Thai"

    def test_options_only_surfaced_for_ranked_choice(self, client):
        """`options` rides only ranked_choice questions (the ballot ranks
        them); yes_no / limited_supply leave it null so the bubble never tries
        to rank a two-button question."""
        poll = create_poll(
            client,
            questions=[
                yes_no_question(context="Up for it?"),
                {
                    "question_type": "ranked_choice",
                    "category": "custom",
                    "context": "Dinner",
                    "options": ["Thai", "Sushi", "Pizza"],
                },
            ],
        )
        s = _summary(client, poll)
        by_type = {q["question_type"]: q for q in s["questions"]}
        assert by_type["yes_no"]["options"] is None
        assert by_type["ranked_choice"]["options"] == ["Thai", "Sushi", "Pizza"]

    def test_limited_supply_claimed_line(self, client):
        poll = create_poll(
            client,
            title="2 spare tickets",
            questions=[
                {
                    "question_type": "limited_supply",
                    "category": "custom",
                    "supply_count": 2,
                }
            ],
        )
        qid = poll["questions"][0]["id"]
        resp = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Ann",
                "items": [{"question_id": qid, "vote_type": "limited_supply"}],
            },
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 201, resp.text
        s = _summary(client, poll)
        q = s["questions"][0]
        assert q["result_text"] == "1/2 claimed"
        assert q["secured_count"] == 1
        assert q["supply_count"] == 2

    def test_group_name_falls_back_to_participants(self, client):
        """Groups without a title override resolve to the participant-names
        display name (group_display_name), not null."""
        poll = create_poll(client, creator_name="Sam")
        s = _summary(client, poll)
        assert s["group_name"] == "Sam"

    def test_response_deadline_has_no_microseconds(self, client):
        """The Swift consumer parses with ISO8601DateFormatter, which rejects
        6-digit fractional seconds — the endpoint strips them."""
        poll = create_poll(client, response_deadline="2030-01-01T18:30:00.123456+00:00")
        s = _summary(client, poll)
        assert s["response_deadline"] is not None
        assert "." not in s["response_deadline"]


class TestSummarySlots:
    """`slots` (key + friendly label) rides finalized time / showtime questions
    so the iMessage expanded want/neutral/can't ballot can render + submit
    (Phase 5). The Swift slot-label mirror was deleted in Phase 2, so the label
    MUST come from the server."""

    def test_finalized_time_surfaces_slots_only_for_time(self, client):
        d1, d2 = _future_date(3), _future_date(4)
        # A no-availability time question finalizes its slots at create, so the
        # poll opens straight into the preference ballot — exactly the bubble's
        # votable state. Paired with a yes_no question to prove slots ride only
        # the time question.
        body = {
            "creator_name": "Host",
            "response_deadline": _future_iso(),
            "questions": [
                {"question_type": "yes_no", "context": "Bring snacks?"},
                {
                    "question_type": "time",
                    "category": "time",
                    "day_time_windows": [
                        {"day": d1, "windows": [{"min": "18:00", "max": "20:00"}]},
                        {"day": d2, "windows": [{"min": "18:00", "max": "20:00"}]},
                    ],
                    "duration_window": {
                        "minValue": 2, "maxValue": 2,
                        "minEnabled": True, "maxEnabled": True,
                    },
                },
            ],
        }
        resp = client.post("/api/polls", json=body)
        assert resp.status_code == 201, resp.text
        s = _summary(client, resp.json())
        by_type = {q["question_type"]: q for q in s["questions"]}
        assert by_type["yes_no"]["slots"] is None
        time_slots = by_type["time"]["slots"]
        assert [x["key"] for x in time_slots] == [
            f"{d1} 18:00-20:00",
            f"{d2} 18:00-20:00",
        ]
        # Server renders a friendly label distinct from the raw key.
        assert all(x["label"] and x["label"] != x["key"] for x in time_slots)

    def test_time_in_availability_phase_has_no_slots(self, client):
        d = _future_date(3)
        body = {
            "creator_name": "Host",
            "response_deadline": _future_iso(),
            "prephase_deadline_minutes": 120,
            "questions": [
                {
                    "question_type": "time",
                    "category": "time",
                    "suggestion_deadline_minutes": 120,
                    "day_time_windows": [
                        {"day": d, "windows": [{"min": "18:00", "max": "20:00"}]}
                    ],
                    "duration_window": {
                        "minValue": 2, "maxValue": 2,
                        "minEnabled": True, "maxEnabled": True,
                    },
                }
            ],
        }
        resp = client.post("/api/polls", json=body)
        assert resp.status_code == 201, resp.text
        s = _summary(client, resp.json())
        # Still collecting availability (options unfinalized) → read-only bubble.
        assert s["questions"][0]["slots"] is None

    def test_showtime_surfaces_slots_and_vote_updates_result(self, client):
        keys = ["2026-06-20 19:10-21:56", "2026-06-20 21:30-23:56"]
        body = {
            "creator_name": "Host",
            "response_deadline": _future_iso(),
            "questions": [
                {
                    "question_type": "showtime",
                    "category": "showtime",
                    "context": "Dune: Part Two",
                    "is_auto_title": True,
                    "options": keys,
                    "options_metadata": {
                        keys[0]: {"cinema_name": "Alamo", "format": "70mm"},
                        keys[1]: {"cinema_name": "Alamo", "format": "Digital"},
                    },
                }
            ],
        }
        resp = client.post("/api/polls", json=body)
        assert resp.status_code == 201, resp.text
        poll = resp.json()
        qid = poll["questions"][0]["id"]
        s = _summary(client, poll)
        slots = s["questions"][0]["slots"]
        assert [x["key"] for x in slots] == keys
        assert all(x["label"] and x["label"] != x["key"] for x in slots)
        # A want vote moves the "Leading:" line (same path the bubble vote uses).
        vote = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Voter",
                "items": [{
                    "question_id": qid,
                    "vote_type": "showtime",
                    "liked_slots": [keys[1]],
                    "disliked_slots": [keys[0]],
                }],
            },
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert vote.status_code == 201, vote.text
        s2 = _summary(client, poll)
        assert s2["questions"][0]["result_text"].startswith("Leading:")
