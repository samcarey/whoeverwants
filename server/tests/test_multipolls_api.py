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

    def test_rejects_participation_sub_poll(self, client, creator_secret):
        resp = client.post(
            "/api/multipolls",
            json={
                "creator_secret": creator_secret,
                "sub_polls": [{"poll_type": "participation"}],
            },
        )
        assert resp.status_code == 400
        assert "participation" in resp.json()["detail"].lower()

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
