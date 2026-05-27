"""Initial creator suggestions ("Collect Suggestions before Vote" + typed options).

When the create-poll form's "Collect Suggestions before Vote" toggle is on AND
the creator typed some options, the FE sends them as `initial_suggestions` on a
ranked_choice question (with `options` left unset). The poll opens collecting
suggestions, but the creator's picks are submitted immediately as their own
suggestion-phase vote — so the poll starts seeded with those options instead of
empty. See server/routers/polls.py: create_poll.
"""

import uuid

from tests.conftest import create_poll, cutoff_poll


def _bid():
    return str(uuid.uuid4())


def _suggestion_question(initial=None, **overrides):
    q = {
        "question_type": "ranked_choice",
        "category": "restaurant",
        "suggestion_deadline_minutes": 120,
    }
    if initial is not None:
        q["initial_suggestions"] = initial
    q.update(overrides)
    return q


def _create_suggestion_poll(client, initial=None, *, prephase=True, browser_id=None):
    bid = browser_id or _bid()
    kwargs = {
        "creator_name": "Alice",
        "questions": [_suggestion_question(initial)],
    }
    if prephase:
        kwargs["prephase_deadline_minutes"] = 120
    return create_poll(client, browser_id=bid, **kwargs)


def _question_votes(client, question_id):
    resp = client.get(f"/api/questions/{question_id}/votes")
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestInitialSuggestions:
    def test_recorded_as_creator_suggestion_vote(self, client):
        poll = _create_suggestion_poll(client, initial=["Tacos", "Pizza"])
        question = poll["questions"][0]

        # Poll opens in suggestion-collection mode — no fixed options yet.
        assert question["options"] in (None, [])
        assert poll["prephase_deadline"] is not None

        votes = _question_votes(client, question["id"])
        assert len(votes) == 1
        vote = votes[0]
        assert vote["suggestions"] == ["Tacos", "Pizza"]
        assert vote["is_ranking_abstain"] is True
        assert vote["is_abstain"] is False
        assert vote["voter_name"] == "Alice"

        # The create response maps the question to the creator's vote id so the
        # creating browser can recognize (and edit) its own seeded vote.
        assert poll["initial_suggestion_vote_ids"] == {question["id"]: vote["id"]}

    def test_no_initial_suggestions_creates_no_vote(self, client):
        poll = _create_suggestion_poll(client, initial=None)
        question = poll["questions"][0]
        assert _question_votes(client, question["id"]) == []
        assert poll.get("initial_suggestion_vote_ids") in (None, {})

    def test_empty_initial_suggestions_creates_no_vote(self, client):
        poll = _create_suggestion_poll(client, initial=[])
        question = poll["questions"][0]
        assert _question_votes(client, question["id"]) == []

    def test_initial_suggestions_appear_in_results(self, client):
        poll = _create_suggestion_poll(client, initial=["Tacos", "Pizza"])
        question = poll["questions"][0]
        resp = client.get(f"/api/questions/{question['id']}/results")
        assert resp.status_code == 200, resp.text
        counts = {c["option"]: c["count"] for c in (resp.json()["suggestion_counts"] or [])}
        assert counts.get("Tacos") == 1
        assert counts.get("Pizza") == 1

    def test_initial_suggestions_finalize_into_options(self, client):
        bid = _bid()
        poll = _create_suggestion_poll(client, initial=["Tacos", "Pizza"], browser_id=bid)
        resp = cutoff_poll(client, poll, kind="suggestions")
        assert resp.status_code == 200, resp.text
        question = client.get(f"/api/questions/{poll['questions'][0]['id']}").json()
        assert set(question["options"] or []) == {"Tacos", "Pizza"}

    def test_other_voters_add_to_initial_suggestions(self, client):
        bid = _bid()
        poll = _create_suggestion_poll(client, initial=["Tacos"], browser_id=bid)
        question_id = poll["questions"][0]["id"]
        # A second voter adds their own suggestion.
        resp = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [
                    {
                        "question_id": question_id,
                        "vote_type": "ranked_choice",
                        "suggestions": ["Sushi"],
                        "is_ranking_abstain": True,
                    }
                ],
            },
            headers={"X-Browser-Id": _bid()},
        )
        assert resp.status_code == 201, resp.text
        cutoff_poll(client, poll, kind="suggestions")
        question = client.get(f"/api/questions/{question_id}").json()
        assert set(question["options"] or []) == {"Tacos", "Sushi"}

    def test_initial_suggestions_dropped_without_prephase(self, client):
        # Defensive: no poll-level prephase means the question has no suggestion
        # phase, so the creator vote would be invalid. The create still succeeds;
        # the initial suggestions are simply not submitted.
        poll = _create_suggestion_poll(client, initial=["Tacos"], prephase=False)
        assert poll["prephase_deadline"] is None
        assert _question_votes(client, poll["questions"][0]["id"]) == []
