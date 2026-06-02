"""Ballot privacy: GET /api/questions/{id}/votes returns ONLY the caller's vote.

Regression coverage for the leak documented in the Auth & Access Model TODO:
the endpoint used to return every vote row — pairing each `voter_name` with its
exact choice — to any unauthenticated caller, reconstructing the whole
who-voted-what map from a single request. It must now scope to the caller's own
vote(s) (their browser, unioned across their signed-in account). Cross-voter
data the UI legitimately needs lives elsewhere: aggregate results / IRV rounds
on `/results`, the participant roster (names decoupled from choices) on
`PollResponse.voter_names`, and the public suggestion brainstorm on
`QuestionResultsResponse.suggestion_counts`.
"""

import os
import uuid

TEST_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


def _client():
    return TestClient(app)


def _bid():
    return str(uuid.uuid4())


def _create_yes_no_poll(client, browser_id):
    resp = client.post(
        "/api/polls",
        json={
            "creator_name": "Creator",
            "questions": [{"question_type": "yes_no", "category": "yes_no"}],
        },
        headers={"X-Browser-Id": browser_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _vote(client, poll, question_id, *, name, choice, browser_id):
    resp = client.post(
        f"/api/polls/{poll['id']}/votes",
        json={
            "voter_name": name,
            "items": [
                {
                    "question_id": question_id,
                    "vote_type": "yes_no",
                    "yes_no_choice": choice,
                }
            ],
        },
        headers={"X-Browser-Id": browser_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_votes(client, question_id, *, browser_id=None):
    headers = {"X-Browser-Id": browser_id} if browser_id else {}
    resp = client.get(f"/api/questions/{question_id}/votes", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_voter_sees_only_their_own_vote():
    client = _client()
    creator = _bid()
    poll = _create_yes_no_poll(client, creator)
    qid = poll["questions"][0]["id"]

    alice = _bid()
    bob = _bid()
    _vote(client, poll, qid, name="Alice", choice="yes", browser_id=alice)
    _vote(client, poll, qid, name="Bob", choice="no", browser_id=bob)

    # Alice sees only Alice's row — never Bob's name+choice pairing.
    alice_votes = _get_votes(client, qid, browser_id=alice)
    assert len(alice_votes) == 1
    assert alice_votes[0]["voter_name"] == "Alice"
    assert alice_votes[0]["yes_no_choice"] == "yes"

    # Bob symmetrically sees only Bob's row.
    bob_votes = _get_votes(client, qid, browser_id=bob)
    assert len(bob_votes) == 1
    assert bob_votes[0]["voter_name"] == "Bob"
    assert bob_votes[0]["yes_no_choice"] == "no"


def test_stranger_browser_sees_nothing():
    """A browser that never voted (and a request with no identity at all) gets
    an empty list — the leak that returned everyone's ballots is closed."""
    client = _client()
    creator = _bid()
    poll = _create_yes_no_poll(client, creator)
    qid = poll["questions"][0]["id"]
    _vote(client, poll, qid, name="Alice", choice="yes", browser_id=_bid())

    # A fresh, unrelated browser.
    assert _get_votes(client, qid, browser_id=_bid()) == []
    # No X-Browser-Id at all — middleware mints a fresh one, which owns nothing.
    assert _get_votes(client, qid) == []


def _edit_vote(client, poll, question_id, vote_id, *, name, choice, browser_id):
    return client.post(
        f"/api/polls/{poll['id']}/votes",
        json={
            "voter_name": name,
            "items": [
                {
                    "question_id": question_id,
                    "vote_id": vote_id,
                    "vote_type": "yes_no",
                    "yes_no_choice": choice,
                }
            ],
        },
        headers={"X-Browser-Id": browser_id},
    )


def test_cannot_edit_another_voters_ballot():
    """Possession of a vote_id alone must not let one voter overwrite another's
    ballot — the belt-and-suspenders edit-ownership gate. (Vote UUIDs aren't
    cross-voter discoverable now that /votes is scoped, but the edit path
    enforces ownership too.)"""
    client = _client()
    poll = _create_yes_no_poll(client, _bid())
    qid = poll["questions"][0]["id"]

    alice = _bid()
    alice_vote = _vote(client, poll, qid, name="Alice", choice="yes", browser_id=alice)
    alice_vote_id = alice_vote[0]["id"]

    # Bob, somehow holding Alice's vote_id, tries to overwrite her ballot.
    bob = _bid()
    resp = _edit_vote(
        client, poll, qid, alice_vote_id, name="Bob", choice="no", browser_id=bob
    )
    assert resp.status_code == 403, resp.text

    # Alice's ballot is untouched.
    alice_votes = _get_votes(client, qid, browser_id=alice)
    assert len(alice_votes) == 1
    assert alice_votes[0]["yes_no_choice"] == "yes"


def test_owner_can_edit_their_own_ballot():
    """The gate only blocks cross-voter edits — the owner still edits freely."""
    client = _client()
    poll = _create_yes_no_poll(client, _bid())
    qid = poll["questions"][0]["id"]

    alice = _bid()
    alice_vote = _vote(client, poll, qid, name="Alice", choice="yes", browser_id=alice)
    vote_id = alice_vote[0]["id"]

    resp = _edit_vote(
        client, poll, qid, vote_id, name="Alice", choice="no", browser_id=alice
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()[0]["yes_no_choice"] == "no"


def test_roster_and_results_still_expose_aggregates():
    """The render-necessary cross-voter data is unaffected: the poll roster
    (names only) and the aggregate results remain available to anyone."""
    client = _client()
    creator = _bid()
    poll = _create_yes_no_poll(client, creator)
    qid = poll["questions"][0]["id"]
    _vote(client, poll, qid, name="Alice", choice="yes", browser_id=_bid())
    _vote(client, poll, qid, name="Bob", choice="no", browser_id=_bid())

    # Roster: names, decoupled from choices.
    agg = client.get(f"/api/polls/by-id/{poll['id']}").json()
    assert set(agg["voter_names"]) == {"Alice", "Bob"}

    # Results: aggregate counts, no per-voter pairing.
    results = client.get(f"/api/questions/{qid}/results").json()
    assert results["yes_count"] == 1
    assert results["no_count"] == 1
    assert results["total_votes"] == 2
