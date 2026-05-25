"""Cross-browser propagation of rich-option (suggestion) metadata.

When a voter picks a suggestion from search (a restaurant / location with
favicon, rating, coords, etc.), that metadata must land on
`questions.options_metadata` so OTHER voters' ballots render the rich
`OptionLabel` instead of plain text. Both the INSERT path (first submit) and
the EDIT path (adding another suggestion to an existing vote) must propagate
it — the edit path used to drop it entirely (`EditVoteRequest` had no
`options_metadata` field and `_edit_vote_on_question` never merged it), so a
search-picked suggestion added via an edit showed as plain text for everyone
but the submitter, and stayed plain text once finalized.

Requires a real Postgres via DATABASE_URL + DISABLE_RATE_LIMIT=1.
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


def _bid():
    return str(uuid.uuid4())


def _create_suggestion_poll(client, browser_id):
    """A ranked_choice poll mid suggestion-phase (prephase deadline in the
    future) so suggestions are accepted."""
    prephase = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    deadline = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    resp = client.post(
        "/api/polls",
        json={
            "creator_secret": f"secret-{uuid.uuid4().hex[:8]}",
            "creator_name": "Alice",
            "response_deadline": deadline,
            "prephase_deadline": prephase,
            "allow_pre_ranking": True,
            "questions": [
                {
                    "question_type": "ranked_choice",
                    "category": "restaurant",
                    "title": "Dinner spot?",
                    "options": [],
                    "suggestion_deadline_minutes": 1440,
                }
            ],
        },
        headers={"X-Browser-Id": browser_id},
    )
    assert resp.status_code == 201, resp.text
    poll = resp.json()
    return poll["id"], poll["group_short_id"], poll["questions"][0]["id"]


JOE = {
    "name": "Joe's Pizza",
    "rating": 4.5,
    "cuisine": "pizza",
    "imageUrl": "https://example.com/joe.ico",
}
SUSHI = {
    "name": "Sushi Place",
    "rating": 4.8,
    "cuisine": "sushi",
    "imageUrl": "https://example.com/sushi.ico",
}


def _submit(client, poll_id, voter_bid, item):
    return client.post(
        f"/api/polls/{poll_id}/votes",
        json={"voter_name": "Bob", "items": [item]},
        headers={"X-Browser-Id": voter_bid},
    )


def _metadata_for_viewer(client, poll_id, viewer_bid):
    resp = client.get(
        f"/api/polls/by-id/{poll_id}", headers={"X-Browser-Id": viewer_bid}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["questions"][0].get("options_metadata") or {}


class TestOptionsMetadataPropagation:
    def test_insert_propagates_metadata_cross_browser(self, client):
        creator = _bid()
        poll_id, _, qid = _create_suggestion_poll(client, creator)

        voter = _bid()
        resp = _submit(
            client,
            poll_id,
            voter,
            {
                "question_id": qid,
                "vote_type": "ranked_choice",
                "suggestions": ["Joe's Pizza"],
                "options_metadata": {"Joe's Pizza": JOE},
            },
        )
        assert resp.status_code == 201, resp.text

        # A different browser (never submitted) sees the rich metadata.
        viewer = _metadata_for_viewer(client, poll_id, _bid())
        assert viewer.get("Joe's Pizza") == JOE

    def test_edit_adding_suggestion_propagates_metadata(self, client):
        """Regression: an edit that adds a search-picked suggestion must merge
        its metadata into questions.options_metadata (was dropped entirely)."""
        creator = _bid()
        poll_id, _, qid = _create_suggestion_poll(client, creator)

        voter = _bid()
        first = _submit(
            client,
            poll_id,
            voter,
            {
                "question_id": qid,
                "vote_type": "ranked_choice",
                "suggestions": ["Joe's Pizza"],
                "options_metadata": {"Joe's Pizza": JOE},
            },
        )
        assert first.status_code == 201, first.text
        vote_id = first.json()[0]["id"]

        # Same voter edits to ADD a second search-picked suggestion.
        edit = _submit(
            client,
            poll_id,
            voter,
            {
                "question_id": qid,
                "vote_id": vote_id,
                "vote_type": "ranked_choice",
                "suggestions": ["Joe's Pizza", "Sushi Place"],
                "options_metadata": {"Sushi Place": SUSHI},
            },
        )
        assert edit.status_code == 201, edit.text

        viewer = _metadata_for_viewer(client, poll_id, _bid())
        assert viewer.get("Joe's Pizza") == JOE
        assert viewer.get("Sushi Place") == SUSHI

    def test_metadata_visible_in_bulk_group_read(self, client):
        creator = _bid()
        poll_id, group_short, qid = _create_suggestion_poll(client, creator)

        voter = _bid()
        _submit(
            client,
            poll_id,
            voter,
            {
                "question_id": qid,
                "vote_type": "ranked_choice",
                "suggestions": ["Joe's Pizza"],
                "options_metadata": {"Joe's Pizza": JOE},
            },
        )

        resp = client.get(
            f"/api/groups/by-route-id/{group_short}",
            headers={"X-Browser-Id": _bid()},
        )
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert rows, "group read returned no polls"
        meta = rows[0]["questions"][0].get("options_metadata") or {}
        assert meta.get("Joe's Pizza") == JOE
