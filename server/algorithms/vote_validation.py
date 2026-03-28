"""Vote structure validation for all poll categories.

Enforces that each vote contains exactly the fields required for its category
and no fields belonging to other categories. Mirrors the database CHECK constraint
from migration 053.

Rules:
- yes_no: requires yes_no_choice ("yes" or "no"), forbids ranked_choices/nominations
- participation: same structure as yes_no (yes_no_choice required)
- ranked_choice: requires non-empty ranked_choices array, forbids yes_no_choice/nominations
- nomination: requires non-empty nominations array, forbids yes_no_choice/ranked_choices
- All types: is_abstain=True relaxes the "required" field constraint
"""


class VoteValidationError(Exception):
    """Raised when a vote's structure doesn't match its category."""
    pass


def validate_vote(
    category: str,
    vote_type: str,
    yes_no_choice: str | None = None,
    ranked_choices: list[str] | None = None,
    nominations: list[str] | None = None,
    is_abstain: bool = False,
) -> None:
    """Validate vote structure for a given category.

    Raises VoteValidationError if the vote is invalid.
    """
    # vote_type must match category
    if vote_type != category:
        # participation polls accept both 'participation' and 'yes_no' vote types
        if not (category == "participation" and vote_type in ("yes_no", "participation")):
            raise VoteValidationError(
                f"Vote type '{vote_type}' does not match category '{category}'"
            )

    if category == "yes_no" or category == "participation":
        _validate_yes_no_vote(yes_no_choice, ranked_choices, nominations, is_abstain)
    elif category == "ranked_choice":
        _validate_ranked_choice_vote(yes_no_choice, ranked_choices, nominations, is_abstain)
    elif category == "nomination":
        _validate_nomination_vote(yes_no_choice, ranked_choices, nominations, is_abstain)
    else:
        raise VoteValidationError(f"Unknown category: {category}")


def _validate_yes_no_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    nominations: list[str] | None,
    is_abstain: bool,
) -> None:
    # Forbid other poll category fields
    if ranked_choices:
        raise VoteValidationError("ranked_choices not allowed for yes/no polls")
    if nominations:
        raise VoteValidationError("nominations not allowed for yes/no polls")

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
    nominations: list[str] | None,
    is_abstain: bool,
) -> None:
    if yes_no_choice:
        raise VoteValidationError("yes_no_choice not allowed for ranked choice polls")
    if nominations:
        raise VoteValidationError("nominations not allowed for ranked choice polls")

    if is_abstain:
        return

    if not ranked_choices or len(ranked_choices) == 0:
        raise VoteValidationError(
            "ranked_choices is required and must be non-empty for ranked choice polls"
        )


def _validate_nomination_vote(
    yes_no_choice: str | None,
    ranked_choices: list[str] | None,
    nominations: list[str] | None,
    is_abstain: bool,
) -> None:
    if yes_no_choice:
        raise VoteValidationError("yes_no_choice not allowed for nomination polls")
    if ranked_choices:
        raise VoteValidationError("ranked_choices not allowed for nomination polls")

    if is_abstain:
        return

    if not nominations or len(nominations) == 0:
        raise VoteValidationError(
            "nominations is required and must be non-empty for nomination polls"
        )
