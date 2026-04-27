"""Integration tests for the multipolls API.

Mirrors test_polls_api.py: requires a real Postgres reachable via DATABASE_URL,
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


def _yes_no_sub_poll(**overrides) -> dict:
    base = {"poll_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


def _restaurant_sub_poll(**overrides) -> dict:
    base = {
        "poll_type": "ranked_choice",
        "category": "restaurant",
        "options": ["Pizza Hut", "Chipotle"],
    }
    base.update(overrides)
    return base


class TestCreateMultipoll:
    def test_create_single_sub_poll(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["id"]
        assert data["short_id"]
        assert data["title"] == "Yes/No?"  # computed at read time
        assert len(data["sub_polls"]) == 1
        assert data["sub_polls"][0]["poll_type"] == "yes_no"
        assert data["sub_polls"][0]["category"] == "yes_no"

    def test_create_three_sub_polls_what_when_where(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "context": "Birthday",
                "sub_polls": [
                    _restaurant_sub_poll(),
                    {
                        "poll_type": "time",
                        "category": "time",
                    },
                    {
                        "poll_type": "ranked_choice",
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
        assert len(data["sub_polls"]) == 3
        # Sub-polls preserve insertion order
        assert [sp["category"] for sp in data["sub_polls"]] == [
            "restaurant",
            "time",
            "movie",
        ]

    def test_explicit_title_persisted_in_thread_title(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "title": "What should we do tonight?",
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["title"] == "What should we do tonight?"
        assert data["thread_title"] == "What should we do tonight?"

    def test_rejects_zero_sub_polls(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={"creator_secret": creator_secret, "sub_polls": []},
        )
        assert resp.status_code == 422  # pydantic min_length

    def test_rejects_two_time_sub_polls(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [
                    {"poll_type": "time", "category": "time"},
                    {"poll_type": "time", "category": "time"},
                ],
            },
        )
        assert resp.status_code == 400
        assert "time" in resp.json()["detail"].lower()

    def test_rejects_duplicate_kind_without_distinct_context(
        self, client, creator_secret
    ):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [
                    _restaurant_sub_poll(),
                    _restaurant_sub_poll(),
                ],
            },
        )
        assert resp.status_code == 400
        assert "distinct context" in resp.json()["detail"].lower()

    def test_accepts_duplicate_kind_with_distinct_context(
        self, client, creator_secret
    ):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [
                    _restaurant_sub_poll(context="Lunch"),
                    _restaurant_sub_poll(context="Dinner"),
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        # Each sub-poll preserves its per-sub-poll context in `details`.
        assert [sp["details"] for sp in data["sub_polls"]] == ["Lunch", "Dinner"]

    def test_rejects_prephase_after_response_deadline(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "response_deadline": "2030-01-01T12:00:00Z",
                "prephase_deadline": "2030-01-02T12:00:00Z",
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert resp.status_code == 400
        assert "before" in resp.json()["detail"].lower()


class TestReadMultipoll:
    def test_get_by_short_id(self, client, creator_secret):
        create = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        short_id = create.json()["short_id"]
        resp = client.get(f"/api/multipolls/{short_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["short_id"] == short_id
        assert len(data["sub_polls"]) == 1

    def test_get_by_uuid(self, client, creator_secret):
        create = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [_restaurant_sub_poll()],
            },
        )
        multipoll_id = create.json()["id"]
        resp = client.get(f"/api/multipolls/by-id/{multipoll_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == multipoll_id

    def test_get_missing_short_id_returns_404(self, client):
        resp = client.get("/api/multipolls/zzzzzz-not-real")
        assert resp.status_code == 404

    def test_get_missing_uuid_returns_404(self, client):
        resp = client.get(f"/api/multipolls/by-id/{uuid.uuid4()}")
        assert resp.status_code == 404


class TestSubPollLinkage:
    def test_existing_polls_keep_null_multipoll_id(self, client, creator_secret):
        """Legacy single-poll create path should not link to any multipoll."""
        resp = client.post(
            "/api/polls",
            json={
                "title": "Legacy poll",
                "poll_type": "yes_no",
                "creator_secret": creator_secret,
            },
        )
        assert resp.status_code == 201
        # The PollResponse doesn't currently expose multipoll_id; verify by
        # querying the DB directly via psycopg.
        import psycopg

        poll_id = resp.json()["id"]
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT multipoll_id, sub_poll_index FROM polls WHERE id = %s",
                (poll_id,),
            ).fetchone()
            assert row is not None
            assert row[0] is None
            assert row[1] is None

    def test_multipoll_subpoll_has_index(self, client, creator_secret):
        create = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [
                    _yes_no_sub_poll(),
                    _restaurant_sub_poll(),
                ],
            },
        )
        assert create.status_code == 201, create.text
        sub_polls = create.json()["sub_polls"]
        multipoll_id = create.json()["id"]

        import psycopg

        with psycopg.connect(TEST_DB_URL) as conn:
            for index, sp in enumerate(sub_polls):
                row = conn.execute(
                    "SELECT multipoll_id, sub_poll_index FROM polls WHERE id = %s",
                    (sp["id"],),
                ).fetchone()
                assert row is not None
                assert str(row[0]) == multipoll_id
                assert row[1] == index


class TestChainPropagation:
    """Phase 2.2: follow_up_to / fork_of are POLL ids in the request. The
    server resolves them to the parent's multipoll_id (or NULL for legacy
    parents) for the multipolls row, and copies the poll_id onto each
    sub-poll's polls.follow_up_to / polls.fork_of so the legacy thread
    aggregation keeps working until Phase 5."""

    def _create_multipoll_parent(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def _create_legacy_parent(self, client, creator_secret):
        resp = client.post(
            "/api/polls",
            json={
                "title": "Legacy parent",
                "poll_type": "yes_no",
                "creator_secret": creator_secret,
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_followup_to_multipoll_parent(self, client, creator_secret):
        parent = self._create_multipoll_parent(client, creator_secret)
        parent_sub_poll_id = parent["sub_polls"][0]["id"]
        parent_multipoll_id = parent["id"]

        child = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": parent_sub_poll_id,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert child.status_code == 201, child.text
        child_data = child.json()
        # multipolls.follow_up_to resolved to the parent's multipoll_id
        assert child_data["follow_up_to"] == parent_multipoll_id

        # polls.follow_up_to on the new sub-poll points at the parent poll_id
        # so legacy thread-walking still finds the chain.
        import psycopg

        child_sub_poll_id = child_data["sub_polls"][0]["id"]
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT follow_up_to, fork_of FROM polls WHERE id = %s",
                (child_sub_poll_id,),
            ).fetchone()
            assert row is not None
            assert str(row[0]) == parent_sub_poll_id
            assert row[1] is None

    def test_followup_to_legacy_parent(self, client, creator_secret):
        legacy_parent = self._create_legacy_parent(client, creator_secret)
        legacy_parent_id = legacy_parent["id"]

        child = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": legacy_parent_id,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert child.status_code == 201, child.text
        child_data = child.json()
        # Legacy parent has no multipoll wrapper, so multipolls.follow_up_to
        # stays NULL — but the polls row still chains to the legacy parent.
        assert child_data["follow_up_to"] is None

        import psycopg

        child_sub_poll_id = child_data["sub_polls"][0]["id"]
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT follow_up_to FROM polls WHERE id = %s",
                (child_sub_poll_id,),
            ).fetchone()
            assert str(row[0]) == legacy_parent_id

    def test_fork_of_multipoll_parent(self, client, creator_secret):
        parent = self._create_multipoll_parent(client, creator_secret)
        parent_sub_poll_id = parent["sub_polls"][0]["id"]
        parent_multipoll_id = parent["id"]

        child = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "fork_of": parent_sub_poll_id,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert child.status_code == 201, child.text
        child_data = child.json()
        assert child_data["fork_of"] == parent_multipoll_id
        assert child_data["follow_up_to"] is None

        import psycopg

        child_sub_poll_id = child_data["sub_polls"][0]["id"]
        with psycopg.connect(TEST_DB_URL) as conn:
            row = conn.execute(
                "SELECT follow_up_to, fork_of FROM polls WHERE id = %s",
                (child_sub_poll_id,),
            ).fetchone()
            assert row[0] is None
            assert str(row[1]) == parent_sub_poll_id

    def test_thread_title_inherits_from_multipoll_parent(self, client, creator_secret):
        parent = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "title": "Friday Night",
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert parent.status_code == 201
        parent_sub_poll_id = parent.json()["sub_polls"][0]["id"]

        child = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": parent_sub_poll_id,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert child.status_code == 201
        # No explicit title on the child; should inherit from the parent.
        assert child.json()["thread_title"] == "Friday Night"

    def test_thread_title_inherits_from_legacy_parent(self, client, creator_secret):
        # Set thread_title on a legacy poll directly (the API exposes it via
        # the existing /thread-title endpoint, but for a brittleness-free
        # test we just write to the row).
        legacy_parent = self._create_legacy_parent(client, creator_secret)
        legacy_parent_id = legacy_parent["id"]

        import psycopg

        with psycopg.connect(TEST_DB_URL) as conn:
            conn.execute(
                "UPDATE polls SET thread_title = %s WHERE id = %s",
                ("Saturday Plans", legacy_parent_id),
            )
            conn.commit()

        child = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": legacy_parent_id,
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert child.status_code == 201
        assert child.json()["thread_title"] == "Saturday Plans"

    def test_explicit_title_wins_over_parent_inheritance(self, client, creator_secret):
        parent = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "title": "Old Title",
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        parent_sub_poll_id = parent.json()["sub_polls"][0]["id"]

        child = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "follow_up_to": parent_sub_poll_id,
                "title": "New Title",
                "sub_polls": [_yes_no_sub_poll()],
            },
        )
        assert child.json()["thread_title"] == "New Title"


class TestMultipollOperations:
    """Multipoll-level close/reopen/cutoff endpoints (Phase 3)."""

    def _create_multi(self, client, creator_secret, sub_polls=None):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": sub_polls or [_yes_no_sub_poll(), _restaurant_sub_poll()],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_close_multipoll_closes_wrapper_and_all_sub_polls(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/multipolls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_closed"] is True
        assert data["close_reason"] == "manual"
        assert all(sp["is_closed"] is True for sp in data["sub_polls"])
        assert all(sp["close_reason"] == "manual" for sp in data["sub_polls"])

    def test_close_rejects_wrong_secret(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/multipolls/{multi['id']}/close",
            json={"creator_secret": "wrong-secret", "close_reason": "manual"},
        )
        assert resp.status_code == 403

    def test_close_404_on_unknown_id(self, client, creator_secret):
        resp = client.post(
            f"/api/multipolls/{uuid.uuid4()}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        assert resp.status_code == 404

    def test_reopen_multipoll_reopens_wrapper_and_all_sub_polls(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        client.post(
            f"/api/multipolls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        resp = client.post(
            f"/api/multipolls/{multi['id']}/reopen",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["is_closed"] is False
        assert data["close_reason"] is None
        assert all(sp["is_closed"] is False for sp in data["sub_polls"])
        assert all(sp["close_reason"] is None for sp in data["sub_polls"])

    def test_reopen_rejects_wrong_secret(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/multipolls/{multi['id']}/reopen",
            json={"creator_secret": "wrong"},
        )
        assert resp.status_code == 403

    def test_cutoff_suggestions_400_when_nothing_to_cutoff(self, client, creator_secret):
        # Default sub-polls don't have suggestion_deadline / no votes — nothing
        # is in a suggestion phase to begin with.
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/multipolls/{multi['id']}/cutoff-suggestions",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 400

    def test_cutoff_availability_400_when_no_time_sub_poll(self, client, creator_secret):
        multi = self._create_multi(client, creator_secret)
        resp = client.post(
            f"/api/multipolls/{multi['id']}/cutoff-availability",
            json={"creator_secret": creator_secret},
        )
        assert resp.status_code == 400

    def test_close_then_reopen_round_trip(self, client, creator_secret):
        multi = self._create_multi(
            client,
            creator_secret,
            sub_polls=[_yes_no_sub_poll(), _restaurant_sub_poll(), _yes_no_sub_poll(category="custom")],
        )
        client.post(
            f"/api/multipolls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        reopened = client.post(
            f"/api/multipolls/{multi['id']}/reopen",
            json={"creator_secret": creator_secret},
        ).json()
        assert reopened["is_closed"] is False
        assert len(reopened["sub_polls"]) == 3
        assert all(sp["is_closed"] is False for sp in reopened["sub_polls"])


class TestMultipollVoterAggregation:
    """Server-side aggregation of voter participation across sibling sub-polls.
    Per CLAUDE.md → "Addressability paradigm", these fields exist so the FE
    never iterates sub-poll vote rows to compute multipoll-level state."""

    @staticmethod
    def _vote(client, poll_id: str, voter_name: str | None, choice: str = "yes"):
        body = {
            "vote_type": "yes_no",
            "yes_no_choice": choice,
            "voter_name": voter_name,
        }
        resp = client.post(f"/api/polls/{poll_id}/votes", json=body)
        assert resp.status_code in (200, 201), resp.text

    def _make_two_yes_no_multi(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "context": "Test",
                "sub_polls": [
                    _yes_no_sub_poll(context="A"),
                    _yes_no_sub_poll(context="B"),
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_empty_multipoll_has_zero_respondents(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        data = client.get(f"/api/multipolls/by-id/{multi['id']}").json()
        assert data["voter_names"] == []
        assert data["anonymous_count"] == 0

    def test_named_voters_dedupe_across_sub_polls(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        # Alice + Bob vote on both; Carol only on A.
        for poll_id in (sp_a["id"], sp_b["id"]):
            self._vote(client, poll_id, "Alice")
            self._vote(client, poll_id, "Bob")
        self._vote(client, sp_a["id"], "Carol", choice="no")

        data = client.get(f"/api/multipolls/by-id/{multi['id']}").json()
        # Alice + Bob should each appear once (deduped); Carol once.
        assert sorted(data["voter_names"]) == ["Alice", "Bob", "Carol"]
        assert data["anonymous_count"] == 0

    def test_anonymous_count_is_max_per_sub_poll(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        # 3 anon on A, 2 anon on B → expect MAX = 3.
        for _ in range(3):
            self._vote(client, sp_a["id"], None)
        for _ in range(2):
            self._vote(client, sp_b["id"], None)
        data = client.get(f"/api/multipolls/by-id/{multi['id']}").json()
        assert data["voter_names"] == []
        assert data["anonymous_count"] == 3

    def test_mixed_named_and_anonymous(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        self._vote(client, sp_a["id"], "Alice")
        self._vote(client, sp_b["id"], "Alice")
        self._vote(client, sp_a["id"], None)
        self._vote(client, sp_a["id"], None)
        self._vote(client, sp_b["id"], None)
        data = client.get(f"/api/multipolls/by-id/{multi['id']}").json()
        assert data["voter_names"] == ["Alice"]
        # max(2 anon on A, 1 anon on B) = 2
        assert data["anonymous_count"] == 2

    def test_aggregation_returned_by_short_id_endpoint_too(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a = multi["sub_polls"][0]
        self._vote(client, sp_a["id"], "Alice")
        short_id = multi["short_id"]
        data = client.get(f"/api/multipolls/{short_id}").json()
        assert data["voter_names"] == ["Alice"]

    def test_aggregation_returned_after_close(self, client, creator_secret):
        multi = self._make_two_yes_no_multi(client, creator_secret)
        sp_a = multi["sub_polls"][0]
        self._vote(client, sp_a["id"], "Alice")
        closed = client.post(
            f"/api/multipolls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        ).json()
        assert closed["voter_names"] == ["Alice"]

    def test_create_response_omits_voter_data(self, client, creator_secret):
        # Newly-created multipoll has no votes — fields default to empty.
        multi = self._make_two_yes_no_multi(client, creator_secret)
        assert multi["voter_names"] == []
        assert multi["anonymous_count"] == 0


class TestMultipollUnifiedVoting:
    """POST /api/multipolls/{id}/votes — atomic batch vote across siblings.

    Per the Addressability paradigm, this is the multipoll-level entry point:
    one transaction, one voter_name, many sub-poll ballots. Validation runs
    per-sub-poll inside the same transaction; any item failure rolls back the
    whole batch.
    """

    def _make_multi(self, client, creator_secret, sub_polls=None):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "context": "Voting",
                "sub_polls": sub_polls
                or [_yes_no_sub_poll(context="A"), _yes_no_sub_poll(context="B")],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    def test_submits_votes_across_two_sub_polls_atomically(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "sub_poll_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        rows = resp.json()
        assert len(rows) == 2
        assert {r["poll_id"] for r in rows} == {sp_a["id"], sp_b["id"]}
        assert all(r["voter_name"] == "Alice" for r in rows)

        # Aggregation reflects the new votes.
        agg = client.get(f"/api/multipolls/by-id/{multi['id']}").json()
        assert agg["voter_names"] == ["Alice"]

    def test_edits_existing_votes_when_vote_id_set(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        first = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "sub_poll_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                ],
            },
        ).json()
        vote_a, vote_b = first[0], first[1]
        # Same voter changes both votes from yes → no via vote_id.
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_id": vote_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                    {
                        "sub_poll_id": sp_b["id"],
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
        # Only one vote per sub-poll (the existing rows were updated, not appended).
        for sub in multi["sub_polls"]:
            votes = client.get(f"/api/polls/{sub['id']}/votes").json()
            assert len(votes) == 1

    def test_mixed_insert_and_update_in_one_request(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        # Existing vote on A.
        existing_a = client.post(
            f"/api/polls/{sp_a['id']}/votes",
            json={"vote_type": "yes_no", "yes_no_choice": "yes", "voter_name": "Bob"},
        ).json()
        # Now batch: edit A + insert B.
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_id": existing_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                    {
                        "sub_poll_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        votes_a = client.get(f"/api/polls/{sp_a['id']}/votes").json()
        assert len(votes_a) == 1
        assert votes_a[0]["yes_no_choice"] == "no"  # was 'yes', edited
        votes_b = client.get(f"/api/polls/{sp_b['id']}/votes").json()
        assert len(votes_b) == 1
        assert votes_b[0]["yes_no_choice"] == "yes"

    def test_rolls_back_on_any_item_failure(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a, sp_b = multi["sub_polls"]
        # Item 0 valid; item 1 has invalid yes_no_choice → 400, no row should
        # be inserted into either sub-poll.
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "sub_poll_id": sp_b["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "maybe",  # invalid
                    },
                ],
            },
        )
        assert resp.status_code == 400, resp.text
        # Neither sub-poll should have any vote rows.
        assert client.get(f"/api/polls/{sp_a['id']}/votes").json() == []
        assert client.get(f"/api/polls/{sp_b['id']}/votes").json() == []

    def test_404_on_unknown_multipoll(self, client):
        resp = client.post(
            f"/api/multipolls/{uuid.uuid4()}/votes",
            json={
                "voter_name": "x",
                "items": [
                    {
                        "sub_poll_id": str(uuid.uuid4()),
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 404

    def test_400_when_sub_poll_doesnt_belong_to_multipoll(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        # Use a sub_poll_id that exists but on a different multipoll.
        other = self._make_multi(client, creator_secret)
        foreign_sp = other["sub_polls"][0]
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": foreign_sp["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 400

    def test_400_on_duplicate_sub_poll_ids(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a = multi["sub_polls"][0]
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
        )
        assert resp.status_code == 400

    def test_400_when_multipoll_is_closed(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        client.post(
            f"/api/multipolls/{multi['id']}/close",
            json={"creator_secret": creator_secret, "close_reason": "manual"},
        )
        sp_a = multi["sub_polls"][0]
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
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
            f"/api/multipolls/{multi['id']}/votes",
            json={"voter_name": "Alice", "items": []},
        )
        # Pydantic min_length=1 rejection.
        assert resp.status_code == 422

    def test_anonymous_voter_name(self, client, creator_secret):
        multi = self._make_multi(client, creator_secret)
        sp_a = multi["sub_polls"][0]
        resp = client.post(
            f"/api/multipolls/{multi['id']}/votes",
            json={
                "items": [
                    {
                        "sub_poll_id": sp_a["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
        )
        assert resp.status_code == 201
        rows = resp.json()
        assert rows[0]["voter_name"] is None
