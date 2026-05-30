"""Integration tests for the polls API.

Mirrors test_questions_api.py: requires a real Postgres reachable via DATABASE_URL,
either the local Docker Compose db or the test database on the dev droplet.
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
                "creator_secret": creator_secret, "creator_name": "Test User",
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
                "creator_secret": creator_secret, "creator_name": "Test User",
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
        assert data["title"] == "Restaurant, Time, Movie for Birthday"
        assert len(data["questions"]) == 3
        # Sub-questions preserve insertion order
        assert [sp["category"] for sp in data["questions"]] == [
            "restaurant",
            "time",
            "movie",
        ]

    def test_explicit_title_does_not_pollute_group_title(self, client, creator_secret):
        # `req.title` is the poll's DISPLAY title (e.g. a user-typed yes_no
        # prompt). It must NOT be written to `polls.group_title`, which is
        # the group-name override consulted by the FE when computing
        # Group.title. Conflating the two caused the user-reported "group
        # name silently becomes a poll's title" bug.
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "title": "What should we do tonight?",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["title"] == "What should we do tonight?"
        assert data["group_title"] is None

    def test_explicit_group_title_persisted(self, client, creator_secret):
        # The dedicated `group_title` field is the only path that should
        # write to `polls.group_title` on poll creation.
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_title": "Friday Night Plans",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["group_title"] == "Friday Night Plans"
        # The override flows through to the computed display title too.
        assert data["title"] == "Friday Night Plans"

    def test_rejects_missing_creator_name(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 400, resp.text
        assert "name" in resp.json()["detail"].lower()

    def test_rejects_whitespace_creator_name(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "creator_name": "   ",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 400, resp.text

    def test_rejects_overlong_creator_name(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "creator_name": "A" * 51,
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 400, resp.text

    def test_rejects_creator_name_with_control_char(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "creator_name": "Bad\x07name",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 400, resp.text

    def test_creator_name_is_trimmed(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret,
                "creator_name": "  Alice  ",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["creator_name"] == "Alice"

    def test_rejects_zero_questions(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={"creator_secret": creator_secret, "creator_name": "Test User", "questions": []},
        )
        assert resp.status_code == 422  # pydantic min_length

    def test_rejects_two_time_questions(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
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
                "creator_secret": creator_secret, "creator_name": "Test User",
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
                "creator_secret": creator_secret, "creator_name": "Test User",
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
                "creator_secret": creator_secret, "creator_name": "Test User",
                "response_deadline": "2030-01-01T12:00:00Z",
                "prephase_deadline": "2030-01-02T12:00:00Z",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 400
        assert "before" in resp.json()["detail"].lower()


class TestPrephaseStartsAtCreation:
    """The suggestion / availability countdown starts at poll creation — it is
    no longer deferred until the first submission."""

    def _suggestion_poll(self, client, creator_secret, **poll_overrides) -> dict:
        body = {
            "creator_secret": creator_secret,
            "creator_name": "Test User",
            "prephase_deadline_minutes": 120,
            "questions": [
                {
                    "question_type": "ranked_choice",
                    "category": "restaurant",
                    "suggestion_deadline_minutes": 120,
                }
            ],
        }
        body.update(poll_overrides)
        resp = client.post("/api/polls", json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()

    def _parse(self, iso: str) -> datetime:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))

    def test_prephase_deadline_armed_at_creation(self, client, creator_secret):
        data = self._suggestion_poll(client, creator_secret)
        assert data["prephase_deadline"] is not None
        delta = self._parse(data["prephase_deadline"]) - datetime.now(timezone.utc)
        # ~120 minutes out, generous tolerance for clock + test latency.
        assert timedelta(minutes=118) < delta < timedelta(minutes=122)

    def test_prephase_deadline_capped_below_response_deadline(self, client, creator_secret):
        response_deadline = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        data = self._suggestion_poll(client, creator_secret, response_deadline=response_deadline)
        assert self._parse(data["prephase_deadline"]) < self._parse(response_deadline)

    def test_submitting_a_suggestion_does_not_rearm_deadline(self, client, creator_secret):
        data = self._suggestion_poll(client, creator_secret)
        original = data["prephase_deadline"]
        resp = client.post(
            f"/api/polls/{data['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [
                    {
                        "question_id": data["questions"][0]["id"],
                        "vote_type": "ranked_choice",
                        "suggestions": ["Tacos"],
                    }
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        after = client.get(f"/api/polls/by-id/{data['id']}").json()
        assert after["prephase_deadline"] == original


class TestReadPoll:
    def test_get_by_short_id(self, client, creator_secret):
        create = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
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
                "creator_secret": creator_secret, "creator_name": "Test User",
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
                "creator_secret": creator_secret, "creator_name": "Test User",
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


class TestGroupAddition:
    """Migration 105 retired the `follow_up_to` chain pointer. Polls join an
    existing group by passing `req.group_id`; groups.title is the single
    source of truth for the group-name override (no per-poll copies)."""

    def _create_root(self, client, creator_secret, **kwargs):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "questions": [_yes_no_question()],
                **kwargs,
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_poll_added_to_group_inherits_group_id(self, client, creator_secret):
        parent = self._create_root(client, creator_secret)
        group_id = parent["group_id"]
        assert group_id is not None

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_id": group_id,
                "questions": [_yes_no_question()],
            },
        )
        assert child.status_code == 201, child.text
        assert child.json()["group_id"] == group_id

    def test_unknown_group_id_falls_through_to_fresh_group(
        self, client, creator_secret
    ):
        # Unknown group_id is silently ignored; the new poll lands in a
        # freshly-minted group instead of 404'ing the request.
        bogus = str(uuid.uuid4())
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_id": bogus,
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["group_id"] != bogus

    def test_group_title_lives_at_group_level(self, client, creator_secret):
        # Setting `group_title` on a root-poll create writes to groups.title;
        # subsequent polls in the same group see the SAME group_title.
        parent = self._create_root(
            client, creator_secret, group_title="Friday Night"
        )
        group_id = parent["group_id"]
        assert parent["group_title"] == "Friday Night"

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_id": group_id,
                "questions": [_yes_no_question()],
            },
        )
        assert child.json()["group_title"] == "Friday Night"

    def test_explicit_group_title_overwrites_existing(
        self, client, creator_secret
    ):
        # `group_title` on a poll-create is symmetric with the dedicated
        # group-title endpoint: passing it always sets `groups.title`,
        # both for fresh groups and additions to existing groups.
        parent = self._create_root(
            client, creator_secret, group_title="Old Title"
        )
        group_id = parent["group_id"]

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_id": group_id,
                "group_title": "New Title",
                "questions": [_yes_no_question()],
            },
        )
        assert child.json()["group_title"] == "New Title"
        # Parent re-read picks up the same updated title.
        refetched = client.get(f"/api/polls/by-id/{parent['id']}")
        assert refetched.json()["group_title"] == "New Title"

    def test_poll_title_does_not_pollute_group_title(
        self, client, creator_secret
    ):
        # Regression for the original "group name silently becomes a
        # poll's title" bug: `req.title` (poll display title) must never
        # leak into `groups.title` (group name override).
        parent = self._create_root(
            client, creator_secret, title="Should we order pizza?"
        )
        assert parent["group_title"] is None
        assert parent["title"] == "Should we order pizza?"

        # A poll added to the same group also picks up no group_title.
        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_id": parent["group_id"],
                "questions": [_yes_no_question()],
            },
        )
        assert child.json()["group_title"] is None

    def test_update_group_title_endpoint(self, client, creator_secret):
        parent = self._create_root(client, creator_secret)
        group_id = parent["group_id"]

        # Set
        resp = client.post(
            f"/api/groups/{group_id}/title",
            json={"group_title": "Renamed"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == "Renamed"
        assert body["group_id"] == group_id

        # Subsequent poll reads see the new title.
        refetched = client.get(f"/api/polls/by-id/{parent['id']}")
        assert refetched.json()["group_title"] == "Renamed"

        # Clear
        cleared = client.post(
            f"/api/groups/{group_id}/title",
            json={"group_title": ""},
        )
        assert cleared.json()["title"] is None
        assert client.get(
            f"/api/polls/by-id/{parent['id']}"
        ).json()["group_title"] is None

    def test_update_group_title_resolves_route_id_forms(
        self, client, creator_secret
    ):
        parent = self._create_root(client, creator_secret)
        # groups.short_id is the canonical FE-facing form
        for route_id in (parent["group_id"], parent["group_short_id"]):
            r = client.post(
                f"/api/groups/{route_id}/title",
                json={"group_title": f"name-{route_id[:6]}"},
            )
            assert r.status_code == 200, r.text


class TestGroupId:
    """Phase B.1: every new poll has a group_id. Root polls get a fresh
    group row; polls added to an existing group (`req.group_id`) reuse
    it. Migration 105 retired `polls.follow_up_to` so chain-walking is
    gone — these tests now assert the flat group_id semantics directly.
    """

    def _group_id_for(self, poll_id: str) -> str | None:
        import psycopg

        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT group_id FROM polls WHERE id = %s",
                (poll_id,),
            ).fetchone()
            assert row is not None
            return str(row[0]) if row[0] is not None else None

    def test_root_poll_gets_fresh_group(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "questions": [_yes_no_question()],
            },
        )
        assert resp.status_code == 201, resp.text
        group_id = self._group_id_for(resp.json()["id"])
        assert group_id is not None
        assert uuid.UUID(group_id)  # valid uuid

    def test_two_root_polls_get_distinct_groups(self, client, creator_secret):
        a = client.post(
            "/api/polls",
            json={"creator_secret": creator_secret, "creator_name": "Test User", "questions": [_yes_no_question()]},
        )
        b = client.post(
            "/api/polls",
            json={"creator_secret": creator_secret, "creator_name": "Test User", "questions": [_yes_no_question()]},
        )
        assert self._group_id_for(a.json()["id"]) != self._group_id_for(b.json()["id"])

    def test_group_id_param_reuses_group(self, client, creator_secret):
        parent = client.post(
            "/api/polls",
            json={"creator_secret": creator_secret, "creator_name": "Test User", "questions": [_yes_no_question()]},
        )
        parent_group_id = self._group_id_for(parent.json()["id"])

        child = client.post(
            "/api/polls",
            json={
                "creator_secret": creator_secret, "creator_name": "Test User",
                "group_id": parent_group_id,
                "questions": [_yes_no_question()],
            },
        )
        assert child.status_code == 201, child.text
        assert self._group_id_for(child.json()["id"]) == parent_group_id

    def test_chain_of_additions_share_group(self, client, creator_secret):
        # Multiple polls added to the same group all share the same
        # group_id — analog of the old "grandchild inherits root group"
        # assertion now that there's no chain walk.
        root = client.post(
            "/api/polls",
            json={"creator_secret": creator_secret, "creator_name": "Test User", "questions": [_yes_no_question()]},
        )
        root_group = self._group_id_for(root.json()["id"])

        for _ in range(2):
            resp = client.post(
                "/api/polls",
                json={
                    "creator_secret": creator_secret, "creator_name": "Test User",
                    "group_id": root_group,
                    "questions": [_yes_no_question()],
                },
            )
            assert resp.status_code == 201, resp.text
            assert self._group_id_for(resp.json()["id"]) == root_group


class TestPollOperations:
    """Poll-level close/reopen/cutoff endpoints (Phase 3).

    Migration 123: authorization is identity-based. `_create_multi` pins a
    browser_id (the anonymous creator's auto-account is bound to it) and
    `_hdr` replays it on the mutation calls so they authorize as the creator.
    """

    def _create_multi(self, client, questions=None):
        bid = str(uuid.uuid4())
        resp = client.post(
            "/api/polls",
            json={
                "creator_name": "Test User",
                "questions": questions or [_yes_no_question(), _restaurant_question()],
            },
            headers={"X-Browser-Id": bid},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        data["_bid"] = bid
        return data

    @staticmethod
    def _hdr(multi):
        return {"X-Browser-Id": multi["_bid"]}

    def test_close_poll_closes_wrapper_and_all_questions(self, client):
        multi = self._create_multi(client)
        resp = client.post(
            f"/api/polls/{multi['id']}/close",
            json={"close_reason": "manual"},
            headers=self._hdr(multi),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_closed"] is True
        assert data["close_reason"] == "manual"
        for sp in data["questions"]:
            assert "is_closed" not in sp
            assert "close_reason" not in sp

    def test_close_rejects_non_creator(self, client):
        multi = self._create_multi(client)
        # A different browser (no account link to the creator) can't close.
        resp = client.post(
            f"/api/polls/{multi['id']}/close",
            json={"close_reason": "manual"},
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 403

    def test_close_404_on_unknown_id(self, client):
        resp = client.post(
            f"/api/polls/{uuid.uuid4()}/close",
            json={"close_reason": "manual"},
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404

    def test_reopen_poll_reopens_wrapper_and_all_questions(self, client):
        multi = self._create_multi(client)
        client.post(
            f"/api/polls/{multi['id']}/close",
            json={"close_reason": "manual"},
            headers=self._hdr(multi),
        )
        resp = client.post(
            f"/api/polls/{multi['id']}/reopen",
            json={},
            headers=self._hdr(multi),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_closed"] is False
        assert data["close_reason"] is None
        for sp in data["questions"]:
            assert "is_closed" not in sp
            assert "close_reason" not in sp

    def test_reopen_rejects_non_creator(self, client):
        multi = self._create_multi(client)
        resp = client.post(
            f"/api/polls/{multi['id']}/reopen",
            json={},
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 403

    def test_cutoff_suggestions_400_when_nothing_to_cutoff(self, client):
        # Default questions don't have suggestion_deadline / no votes — nothing
        # is in a suggestion phase to begin with.
        multi = self._create_multi(client)
        resp = client.post(
            f"/api/polls/{multi['id']}/cutoff-suggestions",
            json={},
            headers=self._hdr(multi),
        )
        assert resp.status_code == 400

    def test_cutoff_availability_400_when_no_time_question(self, client):
        multi = self._create_multi(client)
        resp = client.post(
            f"/api/polls/{multi['id']}/cutoff-availability",
            json={},
            headers=self._hdr(multi),
        )
        assert resp.status_code == 400

    def test_close_then_reopen_round_trip(self, client):
        multi = self._create_multi(
            client,
            questions=[_yes_no_question(), _restaurant_question(), _yes_no_question(category="custom")],
        )
        client.post(
            f"/api/polls/{multi['id']}/close",
            json={"close_reason": "manual"},
            headers=self._hdr(multi),
        )
        reopened = client.post(
            f"/api/polls/{multi['id']}/reopen",
            json={},
            headers=self._hdr(multi),
        ).json()
        assert reopened["is_closed"] is False
        assert len(reopened["questions"]) == 3
        for sp in reopened["questions"]:
            assert "is_closed" not in sp


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

    def _make_two_yes_no_multi(self, client, creator_secret=None):
        bid = str(uuid.uuid4())
        resp = client.post(
            "/api/polls",
            json={
                "creator_name": "Test User",
                "context": "Test",
                "questions": [
                    _yes_no_question(context="A"),
                    _yes_no_question(context="B"),
                ],
            },
            headers={"X-Browser-Id": bid},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        data["_bid"] = bid
        return data

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

    def test_anonymous_vote_rejected(self, client, creator_secret):
        # Name-required policy: server rejects null/empty voter_name on
        # POST /api/polls/<id>/votes. `anonymous_count` aggregation only
        # ever populates from pre-policy legacy rows.
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a = multi["questions"][0]
        resp = client.post(
            f"/api/polls/{multi['id']}/votes",
            json={
                "voter_name": None,
                "items": [
                    {
                        "question_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 400, resp.text

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
            json={"close_reason": "manual"},
            headers={"X-Browser-Id": multi["_bid"]},
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

    def _make_multi(self, client, creator_secret=None, questions=None):
        bid = str(uuid.uuid4())
        resp = client.post(
            "/api/polls",
            json={
                "creator_name": "Test User",
                "context": "Voting",
                "questions": questions
                or [_yes_no_question(context="A"), _yes_no_question(context="B")],
            },
            headers={"X-Browser-Id": bid},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        data["_bid"] = bid
        return data

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
        # Pin the voter's browser so the privacy-scoped GET /votes can read
        # back this voter's own rows (the endpoint only returns the caller's).
        voter = str(uuid.uuid4())
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
            headers={"X-Browser-Id": voter},
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
            headers={"X-Browser-Id": voter},
        )
        assert resp.status_code == 201, resp.text
        rows = resp.json()
        assert all(r["yes_no_choice"] == "no" for r in rows)
        # Only one vote per question (the existing rows were updated, not appended).
        for sub in multi["questions"]:
            votes = client.get(
                f"/api/questions/{sub['id']}/votes",
                headers={"X-Browser-Id": voter},
            ).json()
            assert len(votes) == 1

    def test_mixed_insert_and_update_in_one_request(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["questions"]
        # Pin the voter's browser across every insert + read so the
        # privacy-scoped GET /votes returns this voter's own rows.
        voter = str(uuid.uuid4())
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
            headers={"X-Browser-Id": voter},
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
            headers={"X-Browser-Id": voter},
        )
        assert resp.status_code == 201, resp.text
        votes_a = client.get(
            f"/api/questions/{sp_a['id']}/votes", headers={"X-Browser-Id": voter}
        ).json()
        assert len(votes_a) == 1
        assert votes_a[0]["yes_no_choice"] == "no"  # was 'yes', edited
        votes_b = client.get(
            f"/api/questions/{sp_b['id']}/votes", headers={"X-Browser-Id": voter}
        ).json()
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
            json={"close_reason": "manual"},
            headers={"X-Browser-Id": multi["_bid"]},
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

    def test_voter_name_required(self, client, creator_secret):
        # Name-required policy: server rejects omitted voter_name on
        # POST /api/polls/<id>/votes.
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
        assert resp.status_code == 400, resp.text
