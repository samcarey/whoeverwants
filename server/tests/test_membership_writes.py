"""Phase C.2 — write-only membership tests.

Covers:
  * thread_members written on POST /api/polls (creator auto-joins)
  * thread_members written on POST /api/polls/{id}/votes (voter auto-joins)
  * poll_access written on POST /api/polls/{id}/access (direct-link grant)
  * Idempotency: composite PK + ON CONFLICT DO NOTHING preserves the
    original joined_at / granted_at watermark
  * Browser_id isolation: two browsers voting in one thread produce two rows
  * Decoupling: membership write is in a separate transaction from the
    triggering action — a vote that fails validation still leaves
    thread_members in place

Phase C.2 doesn't enforce visibility yet; these tests verify the writes
happen, not that any read path filters on them.
"""

import os
import re
import uuid

import pytest

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

import psycopg
from fastapi.testclient import TestClient

from main import app


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def creator_secret():
    return f"test-secret-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def browser_id():
    return str(uuid.uuid4())


def _yes_no_question(**overrides) -> dict:
    base = {"question_type": "yes_no", "category": "yes_no"}
    base.update(overrides)
    return base


def _create_poll(client, creator_secret, *, browser_id=None, **kwargs):
    payload = {
        "creator_secret": creator_secret,
        "questions": [_yes_no_question()],
    }
    payload.update(kwargs)
    headers = {"X-Browser-Id": browser_id} if browser_id else {}
    resp = client.post("/api/polls", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _thread_members(thread_id):
    """Return list of (browser_id, joined_at) tuples for a thread."""
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id, joined_at FROM thread_members WHERE thread_id = %s",
            (thread_id,),
        ).fetchall()
    return rows


def _poll_access(poll_id):
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id, granted_at FROM poll_access WHERE poll_id = %s",
            (poll_id,),
        ).fetchall()
    return rows


class TestCreatePollMembership:
    def test_creator_auto_joins_thread(self, client, creator_secret, browser_id):
        poll = _create_poll(client, creator_secret, browser_id=browser_id)
        thread_id = poll["thread_id"]
        rows = _thread_members(thread_id)
        assert len(rows) == 1
        assert str(rows[0][0]) == browser_id

    def test_followup_creator_joins_parent_thread(
        self, client, creator_secret, browser_id
    ):
        root = _create_poll(client, creator_secret, browser_id=browser_id)
        parent_qid = root["questions"][0]["id"]
        # Same browser creates a follow-up — already a member; ON CONFLICT
        # keeps the thread_members row count at 1.
        followup = _create_poll(
            client,
            creator_secret,
            browser_id=browser_id,
            follow_up_to=parent_qid,
        )
        # Both polls share the same thread_id.
        assert followup["thread_id"] == root["thread_id"]
        rows = _thread_members(root["thread_id"])
        assert len(rows) == 1

    def test_followup_creator_from_different_browser_adds_row(
        self, client, creator_secret, browser_id
    ):
        root = _create_poll(client, creator_secret, browser_id=browser_id)
        parent_qid = root["questions"][0]["id"]
        other = str(uuid.uuid4())
        _create_poll(
            client, creator_secret, browser_id=other, follow_up_to=parent_qid
        )
        rows = _thread_members(root["thread_id"])
        bids = {str(r[0]) for r in rows}
        assert bids == {browser_id, other}


class TestVoteMembership:
    def test_voter_auto_joins_thread(self, client, creator_secret, browser_id):
        # Creator on browser A; voter on browser B.
        creator_browser = browser_id
        poll = _create_poll(client, creator_secret, browser_id=creator_browser)
        sub = poll["questions"][0]

        voter_browser = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sub["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                ],
            },
            headers={"X-Browser-Id": voter_browser},
        )
        assert resp.status_code == 201, resp.text

        rows = _thread_members(poll["thread_id"])
        bids = {str(r[0]) for r in rows}
        assert bids == {creator_browser, voter_browser}

    def test_idempotent_on_repeat_votes(self, client, creator_secret, browser_id):
        poll = _create_poll(client, creator_secret, browser_id=browser_id)
        sub = poll["questions"][0]

        # First vote — creates thread_members row for this browser.
        first = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sub["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                ],
            },
            headers={"X-Browser-Id": browser_id},
        )
        assert first.status_code == 201

        rows_before = _thread_members(poll["thread_id"])
        joined_at_before = next(
            r[1] for r in rows_before if str(r[0]) == browser_id
        )

        # Edit the vote — same browser, same thread; ON CONFLICT preserves
        # the original joined_at watermark (critical for Phase C.3 visibility).
        vote_id = first.json()[0]["id"]
        edit = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "items": [
                    {
                        "question_id": sub["id"],
                        "vote_id": vote_id,
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
            headers={"X-Browser-Id": browser_id},
        )
        assert edit.status_code == 201

        rows_after = _thread_members(poll["thread_id"])
        # Same row count (one per distinct browser, deduped by composite PK).
        assert len(rows_after) == len(rows_before)
        joined_at_after = next(
            r[1] for r in rows_after if str(r[0]) == browser_id
        )
        assert joined_at_before == joined_at_after

    def test_membership_survives_vote_validation_failure(
        self, client, creator_secret, browser_id
    ):
        """Membership writes run BEFORE the vote in their own transaction.
        A vote that the validator rejects still leaves the user as a thread
        member — they 'attempted to participate' which is the trigger
        regardless of whether the ballot was well-formed."""
        poll = _create_poll(client, creator_secret, browser_id=browser_id)
        sub = poll["questions"][0]

        voter_browser = str(uuid.uuid4())
        # Same question_id twice — the endpoint rejects this with 400.
        resp = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [
                    {
                        "question_id": sub["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    },
                    {
                        "question_id": sub["id"],
                        "vote_type": "yes_no",
                        "yes_no_choice": "no",
                    },
                ],
            },
            headers={"X-Browser-Id": voter_browser},
        )
        assert resp.status_code == 400

        # No vote landed.
        votes = client.get(f"/api/questions/{sub['id']}/votes").json()
        assert all(v["voter_name"] != "Bob" for v in votes)

        # But the membership write fired (it ran in its own transaction
        # before the vote validation triggered the rollback).
        rows = _thread_members(poll["thread_id"])
        bids = {str(r[0]) for r in rows}
        assert voter_browser in bids


class TestPollAccessEndpoint:
    def test_grant_writes_row(self, client, creator_secret):
        poll = _create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{poll['id']}/access",
            headers={"X-Browser-Id": visitor_browser},
        )
        assert resp.status_code == 204

        rows = _poll_access(poll["id"])
        bids = {str(r[0]) for r in rows}
        assert visitor_browser in bids

    def test_grant_is_idempotent(self, client, creator_secret):
        poll = _create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        for _ in range(3):
            resp = client.post(
                f"/api/polls/{poll['id']}/access",
                headers={"X-Browser-Id": visitor_browser},
            )
            assert resp.status_code == 204

        rows = _poll_access(poll["id"])
        # Same browser, multiple grants → exactly one row.
        bids = [str(r[0]) for r in rows if str(r[0]) == visitor_browser]
        assert len(bids) == 1

    def test_grant_preserves_original_granted_at(self, client, creator_secret):
        poll = _create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        client.post(
            f"/api/polls/{poll['id']}/access",
            headers={"X-Browser-Id": visitor_browser},
        )
        first = next(
            r[1] for r in _poll_access(poll["id"]) if str(r[0]) == visitor_browser
        )
        # Re-grant; granted_at watermark must NOT advance.
        client.post(
            f"/api/polls/{poll['id']}/access",
            headers={"X-Browser-Id": visitor_browser},
        )
        second = next(
            r[1] for r in _poll_access(poll["id"]) if str(r[0]) == visitor_browser
        )
        assert first == second

    def test_grant_404_for_unknown_poll(self, client):
        bogus = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{bogus}/access",
            headers={"X-Browser-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404

    def test_grant_does_not_create_thread_members(self, client, creator_secret):
        """Direct-link access does NOT transitively grant thread membership.
        Phase C.3 will resolve visibility as the union of `thread_members`
        and `poll_access`; verifying the boundary here keeps that semantics
        intact."""
        poll = _create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        resp = client.post(
            f"/api/polls/{poll['id']}/access",
            headers={"X-Browser-Id": visitor_browser},
        )
        assert resp.status_code == 204

        rows = _thread_members(poll["thread_id"])
        bids = {str(r[0]) for r in rows}
        assert visitor_browser not in bids
