"""Vote-edit ownership: POST /api/polls/{id}/votes (edit path) may only touch a
vote the caller owns.

Belt-and-suspenders for the ballot-privacy follow-up documented in CLAUDE.md →
Auth & Access Model. `_edit_vote_on_question` edits by `vote_id`; vote UUIDs
are no longer discoverable cross-voter (GET /votes is scoped), but a crafted
request that guessed/knew another voter's `vote_id` could previously overwrite
their ballot. The edit now gates on the caller's browser set (their browser +
every browser on their account) and treats a vote owned by someone else as "not
found". Legacy votes (NULL `browser_id`, pre-migration-120) stay editable.
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


def _vote(client, poll, question_id, *, name, choice, browser_id, vote_id=None):
    item = {
        "question_id": question_id,
        "vote_type": "yes_no",
        "yes_no_choice": choice,
    }
    if vote_id:
        item["vote_id"] = vote_id
    return client.post(
        f"/api/polls/{poll['id']}/votes",
        json={"voter_name": name, "items": [item]},
        headers={"X-Browser-Id": browser_id},
    )


def test_owner_can_edit_own_vote():
    client = _client()
    poll = _create_yes_no_poll(client, _bid())
    qid = poll["questions"][0]["id"]

    alice = _bid()
    cast = _vote(client, poll, qid, name="Alice", choice="yes", browser_id=alice)
    assert cast.status_code == 201, cast.text
    vote_id = cast.json()[0]["id"]

    edited = _vote(
        client, poll, qid, name="Alice", choice="no", browser_id=alice, vote_id=vote_id
    )
    assert edited.status_code == 201, edited.text
    assert edited.json()[0]["yes_no_choice"] == "no"


def test_stranger_cannot_edit_anothers_vote():
    """Bob, knowing Alice's vote_id, cannot overwrite her ballot — the edit is
    treated as 'Vote not found', and her vote is left intact."""
    client = _client()
    poll = _create_yes_no_poll(client, _bid())
    qid = poll["questions"][0]["id"]

    alice = _bid()
    bob = _bid()
    cast = _vote(client, poll, qid, name="Alice", choice="yes", browser_id=alice)
    alice_vote_id = cast.json()[0]["id"]
    _vote(client, poll, qid, name="Bob", choice="no", browser_id=bob)

    # Bob attempts to flip Alice's vote to "no" using her vote_id.
    attempt = _vote(
        client,
        poll,
        qid,
        name="Bob",
        choice="no",
        browser_id=bob,
        vote_id=alice_vote_id,
    )
    assert attempt.status_code == 404, attempt.text

    # Alice's own vote is unchanged.
    alice_votes = client.get(
        f"/api/questions/{qid}/votes", headers={"X-Browser-Id": alice}
    ).json()
    assert len(alice_votes) == 1
    assert alice_votes[0]["id"] == alice_vote_id
    assert alice_votes[0]["yes_no_choice"] == "yes"
