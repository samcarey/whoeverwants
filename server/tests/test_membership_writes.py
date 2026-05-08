"""Write-only membership tests.

Covers:
  * thread_members written on POST /api/polls (creator auto-joins)
  * thread_members written on POST /api/polls/{id}/votes (voter auto-joins)
  * thread_members written on GET /api/threads/by-route-id/{id} (visit auto-joins)
  * Idempotency: composite PK + ON CONFLICT DO NOTHING preserves the
    original joined_at watermark
  * Browser_id isolation: two browsers voting in one thread produce two rows
  * Decoupling: vote/create membership write is in a separate transaction
    from the triggering action — a vote that fails validation still
    leaves thread_members in place

The visit-path auto-join is inline in the by-route-id read transaction,
so it can't be observed without going through `/api/threads/by-route-id`.
Read-side visibility filtering tests live in `test_threads_visibility.py`.

Shared fixtures (`client`, `creator_secret`, `browser_id`) and helpers
(`create_poll`) live in `conftest.py`.
"""

import uuid

import psycopg

from tests.conftest import TEST_DB_URL, create_poll


def _thread_members(thread_id):
    """Return list of (browser_id, joined_at) tuples for a thread."""
    with psycopg.connect(TEST_DB_URL) as conn:
        rows = conn.execute(
            "SELECT browser_id, joined_at FROM thread_members WHERE thread_id = %s",
            (thread_id,),
        ).fetchall()
    return rows


class TestCreatePollMembership:
    def test_creator_auto_joins_thread(self, client, creator_secret, browser_id):
        poll = create_poll(client, creator_secret, browser_id=browser_id)
        thread_id = poll["thread_id"]
        rows = _thread_members(thread_id)
        assert len(rows) == 1
        assert str(rows[0][0]) == browser_id

    def test_followup_creator_joins_parent_thread(
        self, client, creator_secret, browser_id
    ):
        root = create_poll(client, creator_secret, browser_id=browser_id)
        thread_id = root["thread_id"]
        # Same browser adds a poll to the same thread — already a member;
        # ON CONFLICT keeps the thread_members row count at 1.
        followup = create_poll(
            client,
            creator_secret,
            browser_id=browser_id,
            thread_id=thread_id,
        )
        assert followup["thread_id"] == thread_id
        rows = _thread_members(thread_id)
        assert len(rows) == 1

    def test_followup_creator_from_different_browser_adds_row(
        self, client, creator_secret, browser_id
    ):
        root = create_poll(client, creator_secret, browser_id=browser_id)
        thread_id = root["thread_id"]
        other = str(uuid.uuid4())
        create_poll(
            client, creator_secret, browser_id=other, thread_id=thread_id
        )
        rows = _thread_members(root["thread_id"])
        bids = {str(r[0]) for r in rows}
        assert bids == {browser_id, other}


class TestVoteMembership:
    def test_voter_auto_joins_thread(self, client, creator_secret, browser_id):
        # Creator on browser A; voter on browser B.
        creator_browser = browser_id
        poll = create_poll(client, creator_secret, browser_id=creator_browser)
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
        poll = create_poll(client, creator_secret, browser_id=browser_id)
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
        poll = create_poll(client, creator_secret, browser_id=browser_id)
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


class TestVisitAutoJoin:
    """Visiting `/api/threads/by-route-id/{id}` writes thread_members
    inline. Migration 106 made thread URLs the canonical 'invite' — the
    bare URL grants whole-thread membership."""

    def test_visit_creates_thread_members_row(self, client, creator_secret):
        poll = create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        resp = client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": visitor_browser},
        )
        assert resp.status_code == 200

        rows = _thread_members(poll["thread_id"])
        bids = {str(r[0]) for r in rows}
        assert visitor_browser in bids

    def test_visit_is_idempotent(self, client, creator_secret):
        poll = create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        for _ in range(3):
            resp = client.get(
                f"/api/threads/by-route-id/{poll['short_id']}",
                headers={"X-Browser-Id": visitor_browser},
            )
            assert resp.status_code == 200

        rows = _thread_members(poll["thread_id"])
        bids = [str(r[0]) for r in rows if str(r[0]) == visitor_browser]
        assert len(bids) == 1

    def test_visit_preserves_original_joined_at(self, client, creator_secret):
        """Re-visit must NOT advance `joined_at` — the closed-before-join
        filter compares against the FIRST visit's watermark, so a churn
        of revisits would silently un-hide newly-closed polls otherwise."""
        poll = create_poll(client, creator_secret)
        visitor_browser = str(uuid.uuid4())
        client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": visitor_browser},
        )
        first = next(
            r[1] for r in _thread_members(poll["thread_id"])
            if str(r[0]) == visitor_browser
        )
        client.get(
            f"/api/threads/by-route-id/{poll['short_id']}",
            headers={"X-Browser-Id": visitor_browser},
        )
        second = next(
            r[1] for r in _thread_members(poll["thread_id"])
            if str(r[0]) == visitor_browser
        )
        assert first == second

    def test_visit_404_does_not_create_row(self, client):
        bogus = "zzznotreal"
        visitor_browser = str(uuid.uuid4())
        resp = client.get(
            f"/api/threads/by-route-id/{bogus}",
            headers={"X-Browser-Id": visitor_browser},
        )
        assert resp.status_code == 404
        # Sanity: no rows for this browser anywhere.
        with psycopg.connect(TEST_DB_URL) as conn:
            rows = conn.execute(
                "SELECT 1 FROM thread_members WHERE browser_id = %s",
                (visitor_browser,),
            ).fetchall()
        assert rows == []
