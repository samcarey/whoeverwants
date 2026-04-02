"""Suggestion poll vote counting algorithm.

Counts how many votes each suggestion received across all non-abstaining voters.
Each voter submits a list of suggestion strings; this aggregates across all voters
and returns sorted results (descending by count, then alphabetical).
"""

from dataclasses import dataclass


@dataclass
class SuggestionCount:
    option: str
    count: int


@dataclass
class SuggestionResult:
    suggestion_counts: list[SuggestionCount]
    total_votes: int
    abstain_count: int


def count_suggestion_votes(
    votes: list[dict],
    poll_options: list[str] | None = None,
) -> SuggestionResult:
    """Count suggestion votes and return aggregated results.

    Args:
        votes: List of vote dicts, each with:
            - suggestions: list[str] | None
            - is_abstain: bool (optional, defaults to False)
        poll_options: Optional list of starting options from the poll.
            These are included in results even if they received 0 votes.

    Returns:
        SuggestionResult with suggestion counts sorted by count desc, then alphabetical.
    """
    counts: dict[str, int] = {}
    abstain_count = 0
    total_votes = 0

    # Initialize poll options with 0 votes
    if poll_options:
        for option in poll_options:
            if option:
                counts[option] = 0

    for vote in votes:
        total_votes += 1

        if vote.get("is_abstain", False):
            abstain_count += 1
            continue

        suggestions = vote.get("suggestions")
        if not suggestions or not isinstance(suggestions, list):
            continue

        for sug in suggestions:
            if isinstance(sug, str) and sug:
                counts[sug] = counts.get(sug, 0) + 1

    # Sort by count descending, then alphabetically
    sorted_counts = sorted(
        counts.items(),
        key=lambda x: (-x[1], x[0]),
    )

    return SuggestionResult(
        suggestion_counts=[
            SuggestionCount(option=option, count=count)
            for option, count in sorted_counts
        ],
        total_votes=total_votes,
        abstain_count=abstain_count,
    )
