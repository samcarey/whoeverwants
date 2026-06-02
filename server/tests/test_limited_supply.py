"""Tests for the limited-supply question type (algorithm + vote validation)."""

import pytest

from algorithms.limited_supply import calculate_limited_supply_result
from algorithms.vote_validation import validate_vote, VoteValidationError


def _claim(name, t, abstain=False):
    return {"voter_name": name, "created_at": t, "is_abstain": abstain}


class TestLimitedSupplyAlgorithm:
    def test_first_come_first_served(self):
        votes = [
            _claim("Ann", "2026-01-01T10:00:00"),
            _claim("Bob", "2026-01-01T10:01:00"),
            _claim("Dan", "2026-01-01T10:03:00"),
        ]
        r = calculate_limited_supply_result(votes, supply_count=2)
        assert r.claim_count == 3
        assert r.secured_count == 2
        assert r.waitlist_count == 1
        assert r.is_full is True
        assert [c.name for c in r.claims] == ["Ann", "Bob", "Dan"]
        assert [c.secured for c in r.claims] == [True, True, False]
        assert [c.position for c in r.claims] == [1, 2, 3]

    def test_declines_do_not_take_a_slot(self):
        votes = [
            _claim("Ann", "2026-01-01T10:00:00"),
            _claim("Cara", "2026-01-01T10:01:00", abstain=True),  # decline
            _claim("Dan", "2026-01-01T10:02:00"),
        ]
        r = calculate_limited_supply_result(votes, supply_count=2)
        assert r.claim_count == 2
        assert r.secured_count == 2
        assert r.waitlist_count == 0
        assert r.is_full is True
        assert [c.name for c in r.claims] == ["Ann", "Dan"]

    def test_out_of_order_timestamps_sort_by_claim_time(self):
        votes = [
            _claim("Late", "2026-01-01T12:00:00"),
            _claim("Early", "2026-01-01T09:00:00"),
        ]
        r = calculate_limited_supply_result(votes, supply_count=1)
        # Earliest claim wins the single slot regardless of input order.
        assert r.claims[0].name == "Early"
        assert r.claims[0].secured is True
        assert r.claims[1].name == "Late"
        assert r.claims[1].secured is False

    def test_spots_left_when_undersubscribed(self):
        votes = [_claim("Ann", "2026-01-01T10:00:00")]
        r = calculate_limited_supply_result(votes, supply_count=4)
        assert r.secured_count == 1
        assert r.waitlist_count == 0
        assert r.is_full is False

    def test_no_votes(self):
        r = calculate_limited_supply_result([], supply_count=3)
        assert r.claim_count == 0
        assert r.secured_count == 0
        assert r.is_full is False
        assert r.claims == []


class TestLimitedSupplyVoteValidation:
    def test_claim_is_valid(self):
        validate_vote(question_type="limited_supply", vote_type="limited_supply", is_abstain=False)

    def test_decline_is_valid(self):
        validate_vote(question_type="limited_supply", vote_type="limited_supply", is_abstain=True)

    def test_rejects_payload_fields(self):
        with pytest.raises(VoteValidationError):
            validate_vote(question_type="limited_supply", vote_type="limited_supply", yes_no_choice="yes")
        with pytest.raises(VoteValidationError):
            validate_vote(question_type="limited_supply", vote_type="limited_supply", ranked_choices=["A"])

    def test_vote_type_must_match(self):
        with pytest.raises(VoteValidationError):
            validate_vote(question_type="limited_supply", vote_type="yes_no", is_abstain=False)
