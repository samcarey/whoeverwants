"""Yes/No poll vote counting algorithm.

Counts yes, no, and abstain votes for a poll. Calculates percentages
and determines the winner. Abstain votes count toward total_votes but
not toward yes/no counts or winner determination.

Reference: database/migrations/005_create_poll_results_view_up.sql
           database/migrations/009_update_poll_results_view_up.sql
"""

from dataclasses import dataclass


@dataclass
class YesNoResult:
    yes_count: int
    no_count: int
    abstain_count: int
    total_votes: int
    yes_percentage: int | None  # Rounded to nearest integer, None if no votes
    no_percentage: int | None
    winner: str | None  # "yes", "no", or "tie"; None if no votes


def count_yes_no_votes(votes: list[dict]) -> YesNoResult:
    """Count yes/no/abstain votes and compute results.

    Args:
        votes: List of vote dicts, each with:
            - yes_no_choice: "yes" or "no"
            - is_abstain: bool (optional, defaults to False)

    Returns:
        YesNoResult with counts, percentages, and winner.
    """
    yes_count = 0
    no_count = 0
    abstain_count = 0

    for vote in votes:
        if vote.get("is_abstain", False):
            abstain_count += 1
            continue
        choice = vote.get("yes_no_choice")
        if choice == "yes":
            yes_count += 1
        elif choice == "no":
            no_count += 1

    total_votes = yes_count + no_count + abstain_count

    if total_votes == 0:
        return YesNoResult(
            yes_count=0,
            no_count=0,
            abstain_count=0,
            total_votes=0,
            yes_percentage=None,
            no_percentage=None,
            winner=None,
        )

    yes_percentage = round((yes_count / total_votes) * 100)
    no_percentage = round((no_count / total_votes) * 100)

    if yes_count > no_count:
        winner = "yes"
    elif no_count > yes_count:
        winner = "no"
    else:
        winner = "tie"

    return YesNoResult(
        yes_count=yes_count,
        no_count=no_count,
        abstain_count=abstain_count,
        total_votes=total_votes,
        yes_percentage=yes_percentage,
        no_percentage=no_percentage,
        winner=winner,
    )
