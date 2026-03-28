"""Tests for the polls API endpoints.

Uses FastAPI TestClient with an in-memory approach: we spin up a real
Postgres database via the existing Docker Compose setup and run tests
against it. For CI or environments without Postgres, tests are skipped.
"""

import os
import uuid

import pytest

# Set DATABASE_URL before importing app modules
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


@pytest.fixture
def creator_secret():
    return f"test-secret-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def sample_poll(client, creator_secret):
    """Create a sample yes/no poll and return its data."""
    resp = client.post(
        "/api/polls",
        json={
            "title": "Test Poll",
            "category": "yes_no",
            "creator_secret": creator_secret,
        },
    )
    assert resp.status_code == 201
    return resp.json()


# --- Health check ---


class TestHealth:
    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("ok", "degraded")


# --- Create poll ---


class TestCreatePoll:
    def test_create_yes_no_poll(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "title": "Lunch?",
                "category": "yes_no",
                "creator_secret": creator_secret,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Lunch?"
        assert data["category"] == "yes_no"
        assert data["is_closed"] is False
        assert data["short_id"] is not None
        assert data["id"] is not None

    def test_create_poll_with_options(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "title": "Favorite color?",
                "category": "ranked_choice",
                "options": ["Red", "Blue", "Green"],
                "creator_secret": creator_secret,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["options"] == ["Red", "Blue", "Green"]
        assert data["category"] == "ranked_choice"

    def test_create_poll_with_deadline(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "title": "RSVP",
                "category": "yes_no",
                "response_deadline": "2026-12-31T23:59:59+00:00",
                "creator_secret": creator_secret,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["response_deadline"] is not None

    def test_create_participation_poll(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "title": "Game night",
                "category": "participation",
                "min_participants": 4,
                "max_participants": 8,
                "creator_secret": creator_secret,
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["min_participants"] == 4
        assert data["max_participants"] == 8


# --- Get poll ---


class TestGetPoll:
    def test_get_poll_by_id(self, client, sample_poll):
        resp = client.get(f"/api/polls/{sample_poll['id']}")
        assert resp.status_code == 200
        assert resp.json()["title"] == "Test Poll"

    def test_get_poll_by_short_id(self, client, sample_poll):
        resp = client.get(f"/api/polls/by-short-id/{sample_poll['short_id']}")
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_poll["id"]

    def test_get_poll_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/api/polls/{fake_id}")
        assert resp.status_code == 404

    def test_get_poll_by_short_id_not_found(self, client):
        resp = client.get("/api/polls/by-short-id/zzzzzz")
        assert resp.status_code == 404


# --- Submit vote ---


class TestSubmitVote:
    def test_submit_yes_vote(self, client, sample_poll):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["yes_no_choice"] == "yes"
        assert data["is_abstain"] is False

    def test_submit_no_vote(self, client, sample_poll):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "no"},
        )
        assert resp.status_code == 201
        assert resp.json()["yes_no_choice"] == "no"

    def test_submit_abstain_vote(self, client, sample_poll):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "is_abstain": True},
        )
        assert resp.status_code == 201
        assert resp.json()["is_abstain"] is True

    def test_submit_vote_with_name(self, client, sample_poll):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={
                "vote_type": "yes_no",
                "yes_no_choice": "yes",
                "voter_name": "Alice",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["voter_name"] == "Alice"

    def test_submit_vote_poll_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{fake_id}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        assert resp.status_code == 404

    def test_submit_vote_poll_closed(self, client, sample_poll, creator_secret):
        # Close the poll first
        client.post(
            f"/api/polls/{sample_poll['id']}/close",
            json={"creator_secret": creator_secret},
        )
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        assert resp.status_code == 400


# --- Get votes ---


class TestGetVotes:
    def test_get_votes_empty(self, client, sample_poll):
        resp = client.get(f"/api/polls/{sample_poll['id']}/votes")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_votes_after_voting(self, client, sample_poll):
        # Submit two votes
        client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "no"},
        )
        resp = client.get(f"/api/polls/{sample_poll['id']}/votes")
        assert resp.status_code == 200
        votes = resp.json()
        assert len(votes) == 2

    def test_get_votes_poll_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/api/polls/{fake_id}/votes")
        assert resp.status_code == 404


# --- Edit vote ---


class TestEditVote:
    def test_edit_vote(self, client, sample_poll):
        # Submit vote
        vote_resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        vote_id = vote_resp.json()["id"]

        # Edit it
        resp = client.put(
            f"/api/polls/{sample_poll['id']}/votes/{vote_id}",
            json={"yes_no_choice": "no"},
        )
        assert resp.status_code == 200
        assert resp.json()["yes_no_choice"] == "no"

    def test_edit_vote_not_found(self, client, sample_poll):
        fake_vote_id = str(uuid.uuid4())
        resp = client.put(
            f"/api/polls/{sample_poll['id']}/votes/{fake_vote_id}",
            json={"yes_no_choice": "no"},
        )
        assert resp.status_code == 404

    def test_edit_vote_poll_closed(self, client, sample_poll, creator_secret):
        # Submit vote
        vote_resp = client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        vote_id = vote_resp.json()["id"]

        # Close poll
        client.post(
            f"/api/polls/{sample_poll['id']}/close",
            json={"creator_secret": creator_secret},
        )

        # Try to edit
        resp = client.put(
            f"/api/polls/{sample_poll['id']}/votes/{vote_id}",
            json={"yes_no_choice": "no"},
        )
        assert resp.status_code == 400


# --- Results ---


class TestResults:
    def test_results_empty_poll(self, client, sample_poll):
        resp = client.get(f"/api/polls/{sample_poll['id']}/results")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_votes"] == 0
        assert data["winner"] is None

    def test_results_with_votes(self, client, sample_poll):
        # Submit 3 yes, 1 no
        for _ in range(3):
            client.post(
                f"/api/polls/{sample_poll['id']}/votes",
                json={"vote_type": "yes_no", "yes_no_choice": "yes"},
            )
        client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "no"},
        )

        resp = client.get(f"/api/polls/{sample_poll['id']}/results")
        assert resp.status_code == 200
        data = resp.json()
        assert data["yes_count"] == 3
        assert data["no_count"] == 1
        assert data["total_votes"] == 4
        assert data["winner"] == "yes"
        assert data["yes_percentage"] == 75
        assert data["no_percentage"] == 25

    def test_results_with_abstain(self, client, sample_poll):
        client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes"},
        )
        client.post(
            f"/api/polls/{sample_poll['id']}/votes",
            json={"vote_type": "yes_no", "is_abstain": True},
        )

        resp = client.get(f"/api/polls/{sample_poll['id']}/results")
        data = resp.json()
        assert data["yes_count"] == 1
        assert data["abstain_count"] == 1
        assert data["total_votes"] == 2
        assert data["winner"] == "yes"

    def test_results_poll_not_found(self, client):
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/api/polls/{fake_id}/results")
        assert resp.status_code == 404


# --- Close / Reopen ---


class TestCloseReopen:
    def test_close_poll(self, client, sample_poll, creator_secret):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/close",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 200
        assert resp.json()["is_closed"] is True
        assert resp.json()["close_reason"] == "manual"

    def test_close_poll_wrong_secret(self, client, sample_poll):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/close",
            json={"creator_secret": "wrong-secret"},
        )
        assert resp.status_code == 403

    def test_reopen_poll(self, client, sample_poll, creator_secret):
        # Close first
        client.post(
            f"/api/polls/{sample_poll['id']}/close",
            json={"creator_secret": creator_secret},
        )
        # Reopen
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/reopen",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 200
        assert resp.json()["is_closed"] is False
        assert resp.json()["close_reason"] is None

    def test_reopen_poll_wrong_secret(self, client, sample_poll):
        resp = client.post(
            f"/api/polls/{sample_poll['id']}/reopen",
            json={"creator_secret": "wrong-secret"},
        )
        assert resp.status_code == 403


# --- Accessible polls ---


class TestAccessiblePolls:
    def test_accessible_polls_empty(self, client):
        resp = client.post("/api/polls/accessible", json={"poll_ids": []})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_accessible_polls(self, client, sample_poll):
        resp = client.post(
            "/api/polls/accessible",
            json={"poll_ids": [sample_poll["id"]]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == sample_poll["id"]

    def test_accessible_polls_filters_nonexistent(self, client, sample_poll):
        fake_id = str(uuid.uuid4())
        resp = client.post(
            "/api/polls/accessible",
            json={"poll_ids": [sample_poll["id"], fake_id]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
