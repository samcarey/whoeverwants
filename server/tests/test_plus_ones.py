"""Tests for the "plus one/more" feature: one person submits a ballot on behalf
of additional people. The ballot weighs 1 + len(plus_one_names) in results, and
named plus-ones surface in the roster (unnamed → anonymous count)."""

import uuid

from tests.conftest import create_poll, yes_no_question
from tests.test_invite_members import (
    _add_member_direct,
    _bearer_headers,
    _create_group,
    _sign_in,
)


def _time_question(**overrides) -> dict:
    q = {
        "question_type": "time",
        "day_time_windows": [
            {"day": "2099-01-01", "windows": [{"min": "09:00", "max": "17:00"}]}
        ],
        "duration_window": {"minValue": 1, "maxValue": 1, "minEnabled": True, "maxEnabled": True},
    }
    q.update(overrides)
    return q


def _vote(client, poll, voter_name, *, plus_one_names=None, choice="yes", browser_id=None):
    body = {
        "voter_name": voter_name,
        "items": [
            {
                "question_id": poll["questions"][0]["id"],
                "vote_type": "yes_no",
                "yes_no_choice": choice,
            }
        ],
    }
    if plus_one_names is not None:
        body["plus_one_names"] = plus_one_names
    headers = {"X-Browser-Id": browser_id} if browser_id else {}
    return client.post(f"/api/polls/{poll['id']}/votes", json=body, headers=headers)


def _results(client, poll):
    qid = poll["questions"][0]["id"]
    return client.get(f"/api/questions/{qid}/results").json()


class TestAllowPlusOnesDefault:
    def test_yes_no_poll_defaults_off(self, client, creator_secret):
        poll = create_poll(client, creator_secret, questions=[yes_no_question()])
        assert poll["allow_plus_ones"] is False

    def test_time_poll_defaults_on(self, client, creator_secret):
        poll = create_poll(client, creator_secret, questions=[_time_question()])
        assert poll["allow_plus_ones"] is True

    def test_explicit_override_on_for_yes_no(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        assert poll["allow_plus_ones"] is True

    def test_explicit_override_off_for_time(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[_time_question()], allow_plus_ones=False
        )
        assert poll["allow_plus_ones"] is False


class TestPlusOneWeighting:
    def test_yes_no_ballot_counts_for_submitter_plus_extras(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        # One submission, two plus-ones → 3 yes votes.
        resp = _vote(client, poll, "Alice", plus_one_names=["Bob", "Carol"], choice="yes")
        assert resp.status_code == 201, resp.text
        results = _results(client, poll)
        assert results["yes_count"] == 3
        assert results["total_votes"] == 3

    def test_unnamed_plus_ones_still_count(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        # Submitter + 2 unnamed plus-ones, all "no".
        _vote(client, poll, "Alice", plus_one_names=["", ""], choice="no")
        results = _results(client, poll)
        assert results["no_count"] == 3

    def test_disallowed_poll_ignores_plus_ones(self, client, creator_secret):
        # allow_plus_ones off → a crafted plus_one_names must NOT inflate tallies.
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=False
        )
        _vote(client, poll, "Alice", plus_one_names=["Bob", "Carol"], choice="yes")
        results = _results(client, poll)
        assert results["yes_count"] == 1


class TestPlusOneRoster:
    def test_named_plus_ones_appear_in_roster(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        _vote(client, poll, "Alice", plus_one_names=["Bob", "Carol"], choice="yes")
        fresh = client.get(f"/api/polls/by-id/{poll['id']}").json()
        assert sorted(fresh["voter_names"]) == ["Alice", "Bob", "Carol"]
        # viewed_total counts the represented people too (turnout stays
        # consistent: voted <= viewed).
        assert fresh["viewed_total"] >= 3

    def test_duplicate_plus_one_name_expands(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        # Alice answering for herself + two people both named "Sam".
        _vote(client, poll, "Alice", plus_one_names=["Sam", "Sam"], choice="yes")
        fresh = client.get(f"/api/polls/by-id/{poll['id']}").json()
        assert fresh["voter_name_counts"].get("Sam") == 2

    def test_unnamed_plus_ones_go_to_anonymous_count(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        _vote(client, poll, "Alice", plus_one_names=["", ""], choice="yes")
        fresh = client.get(f"/api/polls/by-id/{poll['id']}").json()
        assert fresh["voter_names"] == ["Alice"]
        assert fresh["anonymous_count"] == 2


class TestPlusOneEdit:
    def test_edit_updates_plus_one_count(self, client, creator_secret):
        poll = create_poll(
            client, creator_secret, questions=[yes_no_question()], allow_plus_ones=True
        )
        bid = str(uuid.uuid4())
        resp = _vote(client, poll, "Alice", plus_one_names=["Bob"], choice="yes", browser_id=bid)
        vote_id = resp.json()[0]["id"]
        assert _results(client, poll)["yes_count"] == 2

        # Re-submit (edit) with no plus-ones → back to weight 1.
        edit = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "plus_one_names": [],
                "items": [
                    {
                        "question_id": poll["questions"][0]["id"],
                        "vote_id": vote_id,
                        "vote_type": "yes_no",
                        "yes_no_choice": "yes",
                    }
                ],
            },
            headers={"X-Browser-Id": bid},
        )
        assert edit.status_code == 201, edit.text
        assert _results(client, poll)["yes_count"] == 1


def _create_poll_in_group(client, browser_id, token, group_id, **q):
    body = {
        "creator_name": "Alice",
        "group_id": group_id,
        "allow_plus_ones": True,
        "questions": [{"question_type": "yes_no", "category": "yes_no", **q}],
    }
    resp = client.post("/api/polls", json=body, headers=_bearer_headers(browser_id, token))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _make_contacts(client):
    """Two signed-in accounts (Alice, Bob) sharing a group, so Bob is in
    Alice's contacts. Returns (a_browser, a_token, a_uid, b_browser, b_token,
    b_uid, group)."""
    a_b, b_b = str(uuid.uuid4()), str(uuid.uuid4())
    tok_a, a_uid = _sign_in(client, a_b, name="Alice")
    tok_b, b_uid = _sign_in(client, b_b, name="Bob")
    group = _create_group(client, a_b, tok_a)
    _add_member_direct(group["id"], a_b)
    _add_member_direct(group["id"], b_b)
    return a_b, tok_a, a_uid, b_b, tok_b, b_uid, group


def _reconcile_contacts(client, browser_id, token, poll_id):
    """Hit the candidate endpoint (real poll id) so its inline
    reconcile_contacts records the caller's shared-group people as contacts —
    a prerequisite for seeding plus-one votes for them."""
    client.get(
        f"/api/polls/{poll_id}/plus-one-candidates",
        headers=_bearer_headers(browser_id, token),
    )


def _poll_results(client, poll):
    qid = poll["questions"][0]["id"]
    return client.get(f"/api/questions/{qid}/results").json()


class TestPlusOneSeededVotes:
    def test_seeds_an_editable_vote_for_a_looked_up_contact(self, client):
        a_b, tok_a, a_uid, b_b, tok_b, b_uid, group = _make_contacts(client)
        poll = _create_poll_in_group(client, a_b, tok_a, group["id"])
        qid = poll["questions"][0]["id"]
        _reconcile_contacts(client, a_b, tok_a, poll["id"])
        # Alice votes yes FOR Bob (a looked-up contact).
        resp = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "plus_one_user_ids": [b_uid],
                "items": [{"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}],
            },
            headers=_bearer_headers(a_b, tok_a),
        )
        assert resp.status_code == 201, resp.text
        # Bob got his own seeded yes vote → 2 yes; his name is in the roster.
        assert _poll_results(client, poll)["yes_count"] == 2
        fresh = client.get(f"/api/polls/by-id/{poll['id']}").json()
        assert "Bob" in fresh["voter_names"]

        # Candidate list now flags Bob as responded (can't vote for him again).
        cands = client.get(
            f"/api/polls/{poll['id']}/plus-one-candidates",
            headers=_bearer_headers(a_b, tok_a),
        ).json()
        bob = next((c for c in cands if c["user_id"] == b_uid), None)
        assert bob and bob["responded"] is True

        # Bob can change his response: he sees his seeded vote and edits it.
        bob_votes = client.get(
            f"/api/questions/{qid}/votes", headers=_bearer_headers(b_b, tok_b)
        ).json()
        assert len(bob_votes) == 1
        vote_id = bob_votes[0]["id"]
        edit = client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Bob",
                "items": [{"question_id": qid, "vote_id": vote_id, "vote_type": "yes_no", "yes_no_choice": "no"}],
            },
            headers=_bearer_headers(b_b, tok_b),
        )
        assert edit.status_code == 201, edit.text
        res = _poll_results(client, poll)
        assert res["yes_count"] == 1 and res["no_count"] == 1  # no double-count

    def test_cannot_seed_a_non_contact(self, client):
        a_b, tok_a, a_uid, b_b, tok_b, b_uid, group = _make_contacts(client)
        poll = _create_poll_in_group(client, a_b, tok_a, group["id"])
        qid = poll["questions"][0]["id"]
        _reconcile_contacts(client, a_b, tok_a, poll["id"])
        stranger = str(uuid.uuid4())  # not in Alice's contacts
        client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "plus_one_user_ids": [stranger],
                "items": [{"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}],
            },
            headers=_bearer_headers(a_b, tok_a),
        )
        assert _poll_results(client, poll)["yes_count"] == 1  # no seed

    def test_skips_already_responded_account(self, client):
        a_b, tok_a, a_uid, b_b, tok_b, b_uid, group = _make_contacts(client)
        poll = _create_poll_in_group(client, a_b, tok_a, group["id"])
        qid = poll["questions"][0]["id"]
        _reconcile_contacts(client, a_b, tok_a, poll["id"])
        # Bob votes for himself first.
        client.post(
            f"/api/polls/{poll['id']}/votes",
            json={"voter_name": "Bob", "items": [{"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "no"}]},
            headers=_bearer_headers(b_b, tok_b),
        )
        # Alice tries to vote yes for Bob → skipped (his own 'no' stands).
        client.post(
            f"/api/polls/{poll['id']}/votes",
            json={
                "voter_name": "Alice",
                "plus_one_user_ids": [b_uid],
                "items": [{"question_id": qid, "vote_type": "yes_no", "yes_no_choice": "yes"}],
            },
            headers=_bearer_headers(a_b, tok_a),
        )
        res = _poll_results(client, poll)
        assert res["yes_count"] == 1 and res["no_count"] == 1  # Bob not re-seeded
