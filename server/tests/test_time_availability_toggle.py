"""Integration tests for the time-question "Ask for Availability before Voting"
toggle.

ON (the default, `suggestion_deadline_minutes` set + a poll prephase cutoff):
the two-phase availability → preferences flow — the question opens with
`options` NULL (availability phase).

OFF (`suggestion_deadline_minutes` unset, no poll prephase): the server derives
the candidate slots from the creator's day_time_windows + duration at create
time, so the question lands with `options` populated and the poll opens straight
into the preference (like/dislike) ballot.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def client():
    return TestClient(app)


def _future_date(days: int = 3) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


def _future_iso(hours: int = 48) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _time_question(day: str, *, with_availability: bool) -> dict:
    """A time question with a single 2-hour window + fixed 2h duration, so the
    derived candidate-slot set is exactly one slot ("<day> 18:00-20:00")."""
    q = {
        "question_type": "time",
        "category": "time",
        "day_time_windows": [
            {"day": day, "windows": [{"min": "18:00", "max": "20:00"}]}
        ],
        "duration_window": {
            "minValue": 2,
            "maxValue": 2,
            "minEnabled": True,
            "maxEnabled": True,
        },
        "min_availability_percent": 95,
    }
    if with_availability:
        q["suggestion_deadline_minutes"] = 120
    return q


def _create(client, *, with_availability: bool) -> dict:
    day = _future_date()
    body = {
        "creator_name": "Test User",
        "response_deadline": _future_iso(),
        "questions": [_time_question(day, with_availability=with_availability)],
    }
    if with_availability:
        body["prephase_deadline_minutes"] = 120
    resp = client.post("/api/polls", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json(), day


class TestAvailabilityToggleOn:
    def test_availability_phase_leaves_options_unset(self, client):
        data, _day = _create(client, with_availability=True)
        q = data["questions"][0]
        # Availability phase: slots aren't finalized yet.
        assert q["options"] is None
        # Poll carries a prephase (availability) cutoff.
        assert data["prephase_deadline"] is not None


class TestAvailabilityToggleOff:
    def test_slots_finalized_at_create(self, client):
        data, day = _create(client, with_availability=False)
        q = data["questions"][0]
        # No availability phase → candidate slots derived from the creator's
        # window now, so the poll opens straight into the preference ballot.
        assert q["options"] == [f"{day} 18:00-20:00"]
        assert data["prephase_deadline"] is None

    def test_preference_vote_accepted_immediately(self, client):
        data, day = _create(client, with_availability=False)
        slot = f"{day} 18:00-20:00"
        question_id = data["questions"][0]["id"]
        resp = client.post(
            f"/api/polls/{data['id']}/votes",
            json={
                "voter_name": "Voter A",
                "items": [
                    {
                        "question_id": question_id,
                        "vote_type": "time",
                        "liked_slots": [slot],
                        "disliked_slots": [],
                    }
                ],
            },
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code in (200, 201), resp.text

    def test_empty_windows_stay_in_availability_phase(self, client):
        # A degenerate time question with no windows can't derive any slots, so
        # finalization is a no-op and options stays NULL (no behavior change vs.
        # the pre-toggle world).
        resp = client.post(
            "/api/polls",
            json={
                "creator_name": "Test User",
                "response_deadline": _future_iso(),
                "questions": [{"question_type": "time", "category": "time"}],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["questions"][0]["options"] is None
        assert data["prephase_deadline"] is None
