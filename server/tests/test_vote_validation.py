"""Tests for vote structure validation."""

import pytest
from algorithms.vote_validation import VoteValidationError, validate_vote


class TestYesNoValidation:
    def test_valid_yes_vote(self):
        validate_vote("yes_no", "yes_no", yes_no_choice="yes")

    def test_valid_no_vote(self):
        validate_vote("yes_no", "yes_no", yes_no_choice="no")

    def test_valid_abstain(self):
        validate_vote("yes_no", "yes_no", is_abstain=True)

    def test_abstain_with_choice_ok(self):
        """Abstain overrides - choice is ignored."""
        validate_vote("yes_no", "yes_no", yes_no_choice="yes", is_abstain=True)

    def test_missing_choice(self):
        with pytest.raises(VoteValidationError, match="yes_no_choice is required"):
            validate_vote("yes_no", "yes_no")

    def test_invalid_choice(self):
        with pytest.raises(VoteValidationError, match="must be 'yes' or 'no'"):
            validate_vote("yes_no", "yes_no", yes_no_choice="maybe")

    def test_ranked_choices_forbidden(self):
        with pytest.raises(VoteValidationError, match="ranked_choices not allowed"):
            validate_vote("yes_no", "yes_no", yes_no_choice="yes", ranked_choices=["a"])

    def test_suggestions_forbidden(self):
        with pytest.raises(VoteValidationError, match="suggestions not allowed"):
            validate_vote("yes_no", "yes_no", yes_no_choice="yes", suggestions=["a"])

    def test_wrong_vote_type(self):
        with pytest.raises(VoteValidationError, match="does not match"):
            validate_vote("yes_no", "ranked_choice", yes_no_choice="yes")


class TestParticipationValidation:
    def test_valid_yes_with_yes_no_vote_type(self):
        validate_vote("participation", "yes_no", yes_no_choice="yes")

    def test_valid_yes_with_participation_vote_type(self):
        validate_vote("participation", "participation", yes_no_choice="yes")

    def test_valid_no_with_participation_vote_type(self):
        validate_vote("participation", "participation", yes_no_choice="no")

    def test_valid_no(self):
        validate_vote("participation", "yes_no", yes_no_choice="no")

    def test_valid_abstain(self):
        validate_vote("participation", "yes_no", is_abstain=True)

    def test_valid_abstain_with_participation_vote_type(self):
        validate_vote("participation", "participation", is_abstain=True)

    def test_wrong_vote_type(self):
        with pytest.raises(VoteValidationError, match="does not match"):
            validate_vote("participation", "ranked_choice")


class TestRankedChoiceValidation:
    def test_valid_rankings(self):
        validate_vote("ranked_choice", "ranked_choice", ranked_choices=["a", "b", "c"])

    def test_valid_abstain(self):
        validate_vote("ranked_choice", "ranked_choice", is_abstain=True)

    def test_missing_rankings(self):
        with pytest.raises(VoteValidationError, match="ranked_choices or suggestions is required"):
            validate_vote("ranked_choice", "ranked_choice")

    def test_empty_rankings(self):
        with pytest.raises(VoteValidationError, match="ranked_choices or suggestions is required"):
            validate_vote("ranked_choice", "ranked_choice", ranked_choices=[])

    def test_yes_no_choice_forbidden(self):
        with pytest.raises(VoteValidationError, match="yes_no_choice not allowed"):
            validate_vote("ranked_choice", "ranked_choice", yes_no_choice="yes", ranked_choices=["a"])

    def test_suggestions_forbidden_without_suggestion_phase(self):
        with pytest.raises(VoteValidationError, match="suggestions not allowed"):
            validate_vote("ranked_choice", "ranked_choice", ranked_choices=["a"], suggestions=["b"])

    def test_suggestions_allowed_with_suggestion_phase(self):
        """Suggestions are allowed when the poll has a suggestion phase."""
        validate_vote(
            "ranked_choice", "ranked_choice",
            suggestions=["a", "b"],
            has_suggestion_phase=True,
        )

    def test_suggestions_and_rankings_with_suggestion_phase(self):
        """Both suggestions and rankings can coexist during suggestion phase."""
        validate_vote(
            "ranked_choice", "ranked_choice",
            ranked_choices=["a", "b"],
            suggestions=["a", "b", "c"],
            has_suggestion_phase=True,
        )

    def test_suggestions_only_is_valid_with_suggestion_phase(self):
        """Suggestions without rankings is valid during suggestion phase."""
        validate_vote(
            "ranked_choice", "ranked_choice",
            suggestions=["x"],
            has_suggestion_phase=True,
        )

    def test_abstain_with_suggestion_phase(self):
        validate_vote(
            "ranked_choice", "ranked_choice",
            is_abstain=True,
            has_suggestion_phase=True,
        )


class TestUnknownPollType:
    def test_unknown_poll_type(self):
        with pytest.raises(VoteValidationError, match="Unknown poll type"):
            validate_vote("unknown_type", "unknown_type")
