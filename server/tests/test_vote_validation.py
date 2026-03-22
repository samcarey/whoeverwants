"""Tests for vote structure validation."""

import pytest
from algorithms.vote_validation import VoteValidationError, validate_vote


class TestParticipationValidation:
    def test_valid_yes_with_participation_vote_type(self):
        validate_vote("participation", "participation", yes_no_choice="yes")

    def test_valid_no_with_participation_vote_type(self):
        validate_vote("participation", "participation", yes_no_choice="no")

    def test_valid_abstain_with_participation_vote_type(self):
        validate_vote("participation", "participation", is_abstain=True)

    def test_missing_choice(self):
        with pytest.raises(VoteValidationError, match="yes_no_choice is required"):
            validate_vote("participation", "participation")

    def test_invalid_choice(self):
        with pytest.raises(VoteValidationError, match="must be 'yes' or 'no'"):
            validate_vote("participation", "participation", yes_no_choice="maybe")

    def test_ranked_choices_forbidden(self):
        with pytest.raises(VoteValidationError, match="ranked_choices not allowed"):
            validate_vote("participation", "participation", yes_no_choice="yes", ranked_choices=["a"])

    def test_nominations_forbidden(self):
        with pytest.raises(VoteValidationError, match="nominations not allowed"):
            validate_vote("participation", "participation", yes_no_choice="yes", nominations=["a"])

    def test_wrong_vote_type(self):
        with pytest.raises(VoteValidationError, match="does not match"):
            validate_vote("participation", "nomination")

    def test_yes_no_vote_type_accepted(self):
        """Participation polls still accept yes_no vote type for backward compat."""
        validate_vote("participation", "yes_no", yes_no_choice="yes")


class TestRankedChoiceValidation:
    def test_valid_rankings(self):
        validate_vote("ranked_choice", "ranked_choice", ranked_choices=["a", "b", "c"])

    def test_valid_two_option_rankings(self):
        validate_vote("ranked_choice", "ranked_choice", ranked_choices=["Yes", "No"])

    def test_valid_abstain(self):
        validate_vote("ranked_choice", "ranked_choice", is_abstain=True)

    def test_missing_rankings(self):
        with pytest.raises(VoteValidationError, match="ranked_choices is required"):
            validate_vote("ranked_choice", "ranked_choice")

    def test_empty_rankings(self):
        with pytest.raises(VoteValidationError, match="ranked_choices is required"):
            validate_vote("ranked_choice", "ranked_choice", ranked_choices=[])

    def test_yes_no_choice_forbidden(self):
        with pytest.raises(VoteValidationError, match="yes_no_choice not allowed"):
            validate_vote("ranked_choice", "ranked_choice", yes_no_choice="yes", ranked_choices=["a"])

    def test_nominations_forbidden(self):
        with pytest.raises(VoteValidationError, match="nominations not allowed"):
            validate_vote("ranked_choice", "ranked_choice", ranked_choices=["a"], nominations=["b"])


class TestNominationValidation:
    def test_valid_nominations(self):
        validate_vote("nomination", "nomination", nominations=["Alice", "Bob"])

    def test_valid_single_nomination(self):
        validate_vote("nomination", "nomination", nominations=["Alice"])

    def test_valid_abstain(self):
        validate_vote("nomination", "nomination", is_abstain=True)

    def test_missing_nominations(self):
        with pytest.raises(VoteValidationError, match="nominations is required"):
            validate_vote("nomination", "nomination")

    def test_empty_nominations(self):
        with pytest.raises(VoteValidationError, match="nominations is required"):
            validate_vote("nomination", "nomination", nominations=[])

    def test_yes_no_choice_forbidden(self):
        with pytest.raises(VoteValidationError, match="yes_no_choice not allowed"):
            validate_vote("nomination", "nomination", yes_no_choice="yes", nominations=["a"])

    def test_ranked_choices_forbidden(self):
        with pytest.raises(VoteValidationError, match="ranked_choices not allowed"):
            validate_vote("nomination", "nomination", ranked_choices=["a"], nominations=["b"])

    def test_wrong_vote_type(self):
        with pytest.raises(VoteValidationError, match="does not match"):
            validate_vote("nomination", "ranked_choice", nominations=["a"])


class TestUnknownPollType:
    def test_unknown_poll_type(self):
        with pytest.raises(VoteValidationError, match="Unknown poll type"):
            validate_vote("unknown_type", "unknown_type")

    def test_yes_no_is_unknown(self):
        """yes_no is no longer a valid poll type."""
        with pytest.raises(VoteValidationError, match="Unknown poll type"):
            validate_vote("yes_no", "yes_no", yes_no_choice="yes")
