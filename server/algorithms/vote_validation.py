"""Vote structure validation for all poll types.

Enforces that each vote contains exactly the fields required for its poll type
and no fields belonging to other poll types. Mirrors the database CHECK constraint
from migration 084.

Rules:
- yes_no: requires yes_no_choice ("yes" or "no"), forbids ranked_choices/suggestions
- participation: same structure as yes_no (yes_no_choice required)
- ranked_choice: requires ranked_choices and/or suggestions (suggestions allowed
  for polls with a suggestion phase). Forbids yes_no_choice.
- All types: is_abstain=True relaxes the "required" field constraint
"""


class VoteValidationError(Exception):
    """Raised when a vote's structure doesn't match its poll type."""
    pass


def validate_vote(
    poll_type: str,
    vote_type: str,
    yes_no_choice: str | None = None,
    ranked_choices: list[str] | None = None,
    suggestions: list[str] | None = None,
    is_abstain: bool = False,
    has_suggestion_phase: bool = False,
) -> None:
    """Validate vote structure for a given poll type.

    Args:
        has_suggestion_phase: If True, the ranked_choice poll has a suggestion
            phase and suggestions are allowed in the vote.

    Raises VoteValidationError if the vote is invalid.
    """
    # vote_type must match poll_type
    if vote_type != poll_type:
        # participation polls accept both 'participation' and 'yes_no' vote types
        if not (poll_type == "participation" and vote_type in ("yes_no", "participation")):
            raise VoteValidationError(
                f"Vote type '{vote_type}' does not match poll type '{poll_type}'"
            )

    if poll_type == "yes_no" or poll_type == "participation":
        _validate_yes_no_vote(yes_no_choice, ranked_choices, suggestions, is_abstain)
    elif poll_type == "ranked_choice":
        _validate_ranked_choice_vote(
            yes_no_choice, ranked_choices, suggestions, is_abstain,
            has_suggestion_phase,
        )
    else:
        raise VoteValidationError(f"Unknown poll type: {poll_type}")


def _validate_yes_no_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    suggestions: list[str] | None,
    is_abstain: bool,
) -> None:
    # Forbid other poll type fields
    if ranked_choices:
        raise VoteValidationError("ranked_choices not allowed for yes/no polls")
    if suggestions:
        raise VoteValidationError("suggestions not allowed for yes/no polls")

    if is_abstain:
        return  # No further validation needed

    if not yes_no_choice:
        raise VoteValidationError("yes_no_choice is required for yes/no polls")
    if yes_no_choice not in ("yes", "no"):
        raise VoteValidationError(
            f"yes_no_choice must be 'yes' or 'no', got '{yes_no_choice}'"
        )


def _validate_ranked_choice_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    suggestions: list[str] | None,
    is_abstain: bool,
    has_suggestion_phase: bool = False,
) -> None:
    if yes_no_choice:
        raise VoteValidationError("yes_no_choice not allowed for ranked choice polls")

    # Suggestions are only allowed on polls with a suggestion phase
    if suggestions and not has_suggestion_phase:
        raise VoteValidationError("suggestions not allowed for ranked choice polls without a suggestion phase")

    if is_abstain:
        return

    # Must have at least one of ranked_choices or suggestions
    has_rankings = ranked_choices and len(ranked_choices) > 0
    has_suggestions = suggestions and len(suggestions) > 0

    if not has_rankings and not has_suggestions:
        raise VoteValidationError(
            "ranked_choices or suggestions is required for ranked choice polls"
        )
