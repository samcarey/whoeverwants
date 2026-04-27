"""Integration tests for the polls API.

Mirrors test_questions_api.py: requires a real Postgres reachable via DATABASE_URL,
either the local Docker Compose db or the test database on the dev droplet.
"""

import os
import uuid

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


@pytest.fixture
def creator_secret():
    return f"test-secret-{uuid.uuid4().hex[:8]}"


def _yes_no_question(**overrides) -> dict:
    base = {"question_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


def _restaurant_question(**overrides) -> dict:
    base = {
        "question_type": "ranked_choice",
        "category": "restaurant",
        "options": ["Pizza Hut", "Chipotle"],
    }
    base.update(overrides)
    return base


class TestCreatePoll:
    def test_create_single_question(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["id"]
        assert data["short_id"]
        assert data["title"] == "Yes/No?"  # computed at read time
        assert len(data["questions"]) == 1
        assert data["questions"][0]["question_type"] == "yes_no"
        assert data["questions"][0]["category"] == "yes_no"

    def test_create_three_questions_what_when_where(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "context": "Birthday",
                "questions": [
                    _restaurant_question(),
                    {
                        "question_type": "time",
                        "category": "time",
                    },
                    {
                        "question_type": "ranked_choice",
                        "category": "movie",
                        "options": ["Dune", "Oppenheimer"],
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["context"] == "Birthday"
        assert data["title"] == "Restaurant, Time, and Movie for Birthday"
        assert len(data["questions"]) == 3
        # Sub-questions preserve insertion order
        assert [sp["category"] for sp in data["questions"]] == [
            "restaurant",
            "time",
            "movie",
        ]

    def test_explicit_title_persisted_in_thread_title(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "title": "What should we do tonight?",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["title"] == "What should we do tonight?"
        assert data["thread_title"] == "What should we do tonight?"

    def test_rejects_zero_questions(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={"creator_secret": creator_secret, "questions": []},
        )
        assert resp.status_code == 422  # pydantic min_length

    def test_rejects_two_time_questions(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [
                    {"question_type": "time", "category": "time"},
                    {"question_type": "time", "category": "time"},
                ],
            },
        )
        assert resp.status_code == 400
        assert "time" in resp.json()["detail"].lower()

    def test_rejects_duplicate_kind_without_distinct_context(
        self, client, creator_secret
    ):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [
                    _restaurant_question(),
                    _restaurant_question(),
                ],
            },
        )
        assert resp.status_code == 400
        assert "distinct context" in resp.json()["detail"].lower()

    def test_accepts_duplicate_kind_with_distinct_context(
        self, client, creator_secret
    ):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [
                    _restaurant_question(context="Lunch"),
                    _restaurant_question(context="Dinner"),
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        # Each question preserves its per-question context in `details`.
        assert [sp["details"] for sp in data["questions"]] == ["Lunch", "Dinner"]

    def test_rejects_prephase_after_response_deadline(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "response_deadline": "2030-01-01T12:00:00Z",
                "prephase_deadline": "2030-01-02T12:00:00Z",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 400
        assert "before" in resp.json()["detail"].lower()


class TestReadPoll:
    def test_get_by_short_id(self, client, creator_secret):
        create = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [_yes_no_question()],
            },
        )
        short_id = create.json()["short_id"]
        resp = client.get(f"/api/polls/{short_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["short_id"] == short_id
        assert len(data["questions"]) == 1

    def test_get_by_uuid(self, client, creator_secret):
        create = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [_restaurant_question()],
            },
        )
        poll_id = create.json()["id"]
        resp = client.get(f"/api/polls/by-id/{poll_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == poll_id

    def test_get_missing_short_id_returns_404(self, client):
        resp = client.get("/api/polls/zzzzzz-not-real")
        assert resp.status_code == 404

    def test_get_missing_uuid_returns_404(self, client):
        resp = client.get(f"/api/polls/by-id/{uuid.uuid4()}")
        assert resp.status_code == 404


class TestQuestionLinkage:
    def test_poll_question_has_index(self, client, creator_secret):
        create = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [
                    _yes_no_question(),
                    _restaurant_question(),
                ],
            },
        )
        assert create.status_code == 201, create.text
        questions = create.json()["questions"]
        poll_id = create.json()["id"]

        import psycopg

        with psycopg.connect(TEST_DB_URL) as conn:
            for index, sp in enumerate(questions):
                row = conn.execute(
                    "SELECT poll_id, question_index FROM questions WHERE id = %s",
                    (sp["id"],),
                ).fetchone()
                assert row is not None
                assert str(row[0]) == poll_id
                assert row[1] == index


class TestChainPropagation:
    """Phase 2.2 + 3.5: follow_up_to is a QUESTION id in the request. The server
    resolves it to the parent's poll_id for the polls row.

    Phase 5: the per-question questions.follow_up_to column was dropped — chain
    walking is poll-level only. Legacy single-question parents no longer
    exist (every question has a poll wrapper)."""

    def _create_poll_parent(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_followup_to_poll_parent(self, client, creator_secret):
        parent = self._create_poll_parent(client, creator_secret)
        parent_question_id = parent["questions"][0]["id"]
        parent_poll_id = parent["id"]

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": parent_question_id,
                "questions": [_yes_no_question()],
            },
        )
        assert child.status_code == 201, child.text
        child_data = child.json()
        # polls.follow_up_to resolved to the parent's poll_id
        assert child_data["follow_up_to"] == parent_poll_id

        # The child question's QuestionResponse exposes the wrapper's chain via
        # poll_follow_up_to.
        child_question = child_data["questions"][0]
        assert child_question["poll_follow_up_to"] == parent_poll_id

    def test_thread_title_inherits_from_poll_parent(self, client, creator_secret):
        parent = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "title": "Friday Night",
                "questions": [_yes_no_question()],
            },
        )
        assert parent.status_code == 201
        parent_question_id = parent.json()["questions"][0]["id"]

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": parent_question_id,
                "questions": [_yes_no_question()],
            },
        )
        assert child.status_code == 201
        # No explicit title on the child; should inherit from the parent.
        assert child.json()["thread_title"] == "Friday Night"

    def test_explicit_title_wins_over_parent_inheritance(self, client, creator_secret):
        parent = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "title": "Old Title",
                "questions": [_yes_no_question()],
            },
        )
        parent_question_id = parent.json()["questions"][0]["id"]

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": parent_question_id,
                "title": "New Title",
                "questions": [_yes_no_question()],
            },
        )
        assert child.json()["thread_title"] == "New Title"


class TestPollOperations:
    """Poll-level close/reopen/cutoff endpoints (Phase 3)."""

    def _create_multi(self, client, creator_secret, questions=None):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": questions or [_yes_no_question(), _restaurant_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_close_poll_closes_wrapper_and_all_questions(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/polls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_closed"] is True
        assert data["close_reason"] == "manual"
        assert all(sp["is_closed"] is True for sp in data["questions"])
        assert all(sp["close_reason"] == "manual" for sp in data["questions"])

    def test_close_rejects_wrong_secret(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/polls/{multi['id']}/close",
            json={"creator_secret": "wrong-secret", "close_reason": "manual"},
        )
        assert resp.status_code == 403

    def test_close_404_on_unknown_id(self, client, creator_secret):
        resp = client.post(
            f"/api/polls/{uuid.uuid4()}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        assert resp.status_code == 404

    def test_reopen_poll_reopens_wrapper_and_all_questions(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        client.post(
            f"/api/polls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        resp = client.post(
            f"/api/polls/{multi['id']}/reopen",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_closed"] is False
        assert data["close_reason"] is None
        assert all(sp["is_closed"] is False for sp in data["questions"])
        assert all(sp["close_reason"] is None for sp in data["questions"])

    def test_reopen_rejects_wrong_secret(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/polls/{multi['id']}/reopen",
            json={"creator_secret": "wrong"},
        )
        assert resp.status_code == 403

    def test_cutoff_suggestions_400_when_nothing_to_cutoff(self, client, creator_secret):
        # Default questions don't have suggestion_deadline / no votes — nothing
        # is in a suggestion phase to begin with.
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/polls/{multi['id']}/cutoff-suggestions",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 400

    def test_cutoff_availability_400_when_no_time_question(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/polls/{multi['id']}/cutoff-availability",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 400

    def test_close_then_reopen_round_trip(self, client, creator_secret):
        multi = self._create_multi(
            client,
            creator_secret,
            questions=[_yes_no_question(), _restaurant_question(), _yes_no_question(category="custom")],
        )
        client.post(
            f"/api/polls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        reopened = client.post(
            f"/api/polls/{multi['id']}/reopen",
            json={"creator_secret": creator_secret},
        ).json()
        assert reopened["is_closed"] is False
        assert len(reopened["questions"]) == 3
        assert all(sp["is_closed"] is False for sp in reopened["questions"])


class TestPollVoterAggregation:
    """Server-side aggregation of voter participation across sibling questions.
    Per CLAUDE.md → "Addressability paradigm", these fields exist so the FE
    never iterates question vote rows to compute poll-level state."""

    @staticmethod
    def _vote(client, question_id: str, voter_name: str | None, choice: str = "yes", *, poll_id: str):
        # Phase 5: per-question vote endpoints removed; route through the
        # poll batch endpoint as a single-item submission.
        resp = client.post(
            f"/api/polls/{poll_id}/votes",
            json={
                "voter_name": voter_name,
                "items": [
                    {
                        "question_id": question_id,
                        "vote_type": "yes_no",
                        "yes_no_choice": choice,
                    }
                ],
            },
        )
        assert resp.status_code in (200, 201), resp.text

    def _make_two_yes_no_multi(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "context": "Test",
                "questions": [
                    _yes_no_question(context="A"),
                    _yes_no_question(context="B"),
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_empty_poll_has_zero_respondents(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        data = client.get(f"/api/polls/by-id/{multi['id']}").json()
        assert data["voter_names"] == []
        assert data["anonymous_count"] == 0

    def test_named_voters_dedupe_across_questions(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        # Alice + Bob vote on both; Carol only on A.
        for question_id in (sp_a["id"], sp_b["id"]):
            self._vote(client, question_id, "Alice", poll_id=multi["id"])
            self._vote(client, question_id, "Bob", poll_id=multi["id"])
        self._vote(client, sp_a["id"], "Carol", choice="no", poll_id=multi["id"])

        data = client.get(f"/api/polls/by-id/{multi['id']}").json()
        # Alice + Bob should each appear once (deduped); Carol once.
        assert sorted(data["voter_names"]) == ["Alice", "Bob", "Carol"]
        assert data["anonymous_count"] == 0

    def test_anonymous_count_is_max_per_question(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        # 3 anon on A, 2 anon on B → expect MAX = 3.
        for _ in range(3):
            self._vote(client, sp_a["id"], None, poll_id=multi["id"])
        for _ in range(2):
            self._vote(client, sp_b["id"], None, poll_id=multi["id"])
        data = client.get(f"/api/polls/by-id/{multi['id']}").json()
        assert data["voter_names"] == []
        assert data["anonymous_count"] == 3

    def test_mixed_named_and_anonymous(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        self._vote(client, sp_a["id"], "Alice", poll_id=multi["id"])
        self._vote(client, sp_b["id"], "Alice", poll_id=multi["id"])
        self._vote(client, sp_a["id"], None, poll_id=multi["id"])
        self._vote(client, sp_a["id"], None, poll_id=multi["id"])
        self._vote(client, sp_b["id"], None, poll_id=multi["id"])
        data = client.get(f"/api/polls/by-id/{multi['id']}").json()
        assert data["voter_names"] == ["Alice"]
        # max(2 anon on A, 1 anon on B) = 2
        assert data["anonymous_count"] == 2

    def test_aggregation_returned_by_short_id_endpoint_too(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a = multi["questions"][0]
        self._vote(client, sp_a["id"], "Alice", poll_id=multi["id"])
        short_id = multi["short_id"]
        data = client.get(f"/api/polls/{short_id}").json()
        assert data["voter_names"] == ["Alice"]

    def test_aggregation_returned_after_close(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a = multi["questions"][0]
        self._vote(client, sp_a["id"], "Alice", poll_id=multi["id"])
        closed = client.post(
            f"/api/polls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        ).json()
        assert closed["voter_names"] == ["Alice"]

    def test_create_response_omits_voter_data(self, client, creator_secret):
        # Newly-created poll has no votes — fields default to empty.
        multi = self._make_two_yes_no_multi(client, creator_secret)
        assert multi["voter_names"] == []
        assert multi["anonymous_count"] == 0


class TestPollUnifiedVoting:
    """POST /api/polls/{id}/votes — atomic batch vote across siblings.

    Per the Addressability paradigm, this is the poll-level entry point:
    one transaction, one voter_name, many question ballots. Validation runs
    per-question inside the same transaction; any item failure rolls back the
    whole batch.
    """

    def _make_multi(self, client, creator_secret, questions=None):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "context": "Voting",
                "questions": questions
                or [_yes_no_question(context="A"), _yes_no_question(context="B")],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_submits_votes_across_two_questions_atomically(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "question_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        rows = resp.json()
        assert len(rows) == 2
        assert {r["question_id"] for r in rows} == {sp_a["id"], sp_b["id"]}
        assert all(r["voter_name"] == "Alice" for r in rows)

        # Aggregation reflects the new votes.
        agg = client.get(f"/api/polls/by-id/{multi['id']}").json()
        assert agg["voter_names"] == ["Alice"]

    def test_edits_existing_votes_when_vote_id_set(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        first = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "question_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                ],
            },
        ).json()
        vote_a, vote_b = first[0], first[1]
        # Same voter changes both votes from yes → no via vote_id.
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_id": vote_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                    {
                        "question_id": sp_b["id"],
                        "vote_id": vote_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        rows = resp.json()
        assert all(r["yes_no_choice"] == "no" for r in rows)
        # Only one vote per question (the existing rows were updated, not appended).
        for sub in multi["questions"]:
            votes = client.get(f"/api/questions/{sub['id']}/votes").json()
            assert len(votes) == 1

    def test_mixed_insert_and_update_in_one_request(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        # Existing vote on A — seed via the poll batch endpoint.
        seed = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        ).json()
        existing_a = next(v for v in seed if v["question_id"] == sp_a["id"])
        # Now batch: edit A + insert B.
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_id": existing_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                    {
                        "question_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        votes_a = client.get(f"/api/questions/{sp_a['id']}/votes").json()
        assert len(votes_a) == 1
        assert votes_a[0]["yes_no_choice"] == "no"  # was 'yes', edited
        votes_b = client.get(f"/api/questions/{sp_b['id']}/votes").json()
        assert len(votes_b) == 1
        assert votes_b[0]["yes_no_choice"] == "yes"

    def test_rolls_back_on_any_item_failure(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        # Item 0 valid; item 1 has invalid yes_no_choice → 400, no row should
        # be inserted into either question.
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "question_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "maybe",  # invalid
                    },
                ],
            },
        )
        assert resp.status_code == 400, resp.text
        # Neither question should have any vote rows.
        assert client.get(f"/api/questions/{sp_a['id']}/votes").json() == []
        assert client.get(f"/api/questions/{sp_b['id']}/votes").json() == []

    def test_404_on_unknown_poll(self, client):
        resp = client.post(
            f"/api/polls/{uuid.uuid4()}/votes",
            json={
                "voter_name": "x",
                "items": [
                    {
                        "question_id": str(uuid.uuid4()),
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 404

    def test_400_when_question_doesnt_belong_to_poll(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        # Use a question_id that exists but on a different poll.
        other = self._make_multi(client, creator_secret)
        foreign_sp = other["questions"][0]
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": foreign_sp["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 400

    def test_400_on_duplicate_question_ids(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a = multi["questions"][0]
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
        )
        assert resp.status_code == 400

    def test_400_when_poll_is_closed(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        client.post(
            f"/api/polls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        sp_a = multi["questions"][0]
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 400

    def test_422_on_empty_items(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={"voter_name": "Alice", "items": []},
        )
        # Pydantic min_length=1 rejection.
        assert resp.status_code == 422

    def test_anonymous_voter_name(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a = multi["questions"][0]
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 201
        rows = resp.json()
        assert rows[0]["voter_name"] is None
