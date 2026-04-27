"""Vote structure validation for all question types.

Enforces that each vote contains exactly the fields required for its question type
and no fields belonging to other question types. Mirrors the database CHECK constraint
from migration 094.

Rules:
- yes_no: requires yes_no_choice ("yes" or "no"), forbids ranked_choices/suggestions
- ranked_choice: requires ranked_choices and/or suggestions (suggestions allowed
  for questions with a suggestion phase). Forbids yes_no_choice.
- All types: is_abstain=True relaxes the "required" field constraint
"""


class VoteValidationError(Exception):
    """Raised when a vote's structure doesn't match its question type."""
    pass


def validate_vote(
    question_type: str,
    vote_type: str,
    yes_no_choice: str | None = None,
    ranked_choices: list[str] | None = None,
    ranked_choice_tiers: list[list[str]] | None = None,
    suggestions: list[str] | None = None,
    is_abstain: bool = False,
    is_ranking_abstain: bool = False,
    has_suggestion_phase: bool = False,
) -> None:
    """Validate vote structure for a given question type.

    Args:
        has_suggestion_phase: If True, the ranked_choice question has a suggestion
            phase and suggestions are allowed in the vote.

    Raises VoteValidationError if the vote is invalid.
    """
    # vote_type must match question_type
    if vote_type != question_type:
        raise VoteValidationError(
            f"Vote type '{vote_type}' does not match question type '{question_type}'"
        )

    if question_type == "yes_no":
        if ranked_choice_tiers:
            raise VoteValidationError("ranked_choice_tiers not allowed for yes/no questions")
        _validate_yes_no_vote(yes_no_choice, ranked_choices, suggestions, is_abstain)
    elif question_type == "ranked_choice":
        _validate_ranked_choice_vote(
            yes_no_choice, ranked_choices, ranked_choice_tiers, suggestions,
            is_abstain, is_ranking_abstain, has_suggestion_phase,
        )
    elif question_type == "time":
        if ranked_choice_tiers:
            raise VoteValidationError("ranked_choice_tiers not allowed for time questions")
        _validate_time_vote(yes_no_choice, ranked_choices, suggestions, is_abstain)
    else:
        raise VoteValidationError(f"Unknown question type: {question_type}")


def _validate_yes_no_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    suggestions: list[str] | None,
    is_abstain: bool,
) -> None:
    # Forbid other question type fields
    if ranked_choices:
        raise VoteValidationError("ranked_choices not allowed for yes/no questions")
    if suggestions:
        raise VoteValidationError("suggestions not allowed for yes/no questions")

    if is_abstain:
        return  # No further validation needed

    if not yes_no_choice:
        raise VoteValidationError("yes_no_choice is required for yes/no questions")
    if yes_no_choice not in ("yes", "no"):
        raise VoteValidationError(
            f"yes_no_choice must be 'yes' or 'no', got '{yes_no_choice}'"
        )


def _validate_ranked_choice_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    ranked_choice_tiers: list[list[str]] | None,
    suggestions: list[str] | None,
    is_abstain: bool,
    is_ranking_abstain: bool = False,
    has_suggestion_phase: bool = False,
) -> None:
    if yes_no_choice:
        raise VoteValidationError("yes_no_choice not allowed for ranked choice questions")

    # Suggestions are only allowed on questions with a suggestion phase
    if suggestions and not has_suggestion_phase:
        raise VoteValidationError("suggestions not allowed for ranked choice questions without a suggestion phase")

    # is_ranking_abstain only makes sense for suggestion-phase questions
    if is_ranking_abstain and not has_suggestion_phase:
        raise VoteValidationError("is_ranking_abstain not allowed for ranked choice questions without a suggestion phase")

    # ranked_choice_tiers structural check: must be a list of non-empty lists
    # of strings when present.
    if ranked_choice_tiers is not None:
        if not isinstance(ranked_choice_tiers, list):
            raise VoteValidationError("ranked_choice_tiers must be a list of tiers")
        seen: set[str] = set()
        for tier in ranked_choice_tiers:
            if not isinstance(tier, list) or not tier:
                raise VoteValidationError("each tier in ranked_choice_tiers must be a non-empty list")
            for opt in tier:
                if not isinstance(opt, str) or not opt:
                    raise VoteValidationError("ranked_choice_tiers options must be non-empty strings")
                if opt in seen:
                    raise VoteValidationError(f"option '{opt}' appears in multiple tiers")
                seen.add(opt)

    if is_abstain:
        return

    # is_ranking_abstain with suggestions is valid (abstained from ranking only)
    if is_ranking_abstain:
        has_suggestions = suggestions and len(suggestions) > 0
        if not has_suggestions:
            raise VoteValidationError(
                "is_ranking_abstain requires suggestions (use is_abstain for full abstain)"
            )
        if ranked_choices or ranked_choice_tiers:
            raise VoteValidationError(
                "ranked_choices not allowed when is_ranking_abstain is true"
            )
        return

    # Must have at least one of ranked_choices or suggestions
    has_rankings = (ranked_choices and len(ranked_choices) > 0) or (
        ranked_choice_tiers and len(ranked_choice_tiers) > 0
    )
    has_suggestions = suggestions and len(suggestions) > 0

    if not has_rankings and not has_suggestions:
        raise VoteValidationError(
            "ranked_choices or suggestions is required for ranked choice questions"
        )


def _validate_time_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    suggestions: list[str] | None,
    is_abstain: bool,
) -> None:
    if yes_no_choice:
        raise VoteValidationError("yes_no_choice not allowed for time questions")
    if suggestions:
        raise VoteValidationError("suggestions not allowed for time questions")
    if is_abstain:
        return
    # Must provide voter_day_time_windows (checked in router) or ranked_choices
    # The DB constraint enforces the structure; here we just verify logical consistency.
    # ranked_choices may be present (preferences phase) or absent (availability-only submission)
