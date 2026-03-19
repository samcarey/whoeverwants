"""Nomination poll vote counting algorithm.

Counts how many votes each nomination received across all non-abstaining voters.
Each voter submits a list of nomination strings; this aggregates across all voters
and returns sorted results (descending by count, then alphabetical).

Reference: lib/supabase.ts getNominationVoteCounts()
"""

from dataclasses import dataclass


@dataclass
class NominationCount:
    option: str
    count: int


@dataclass
class NominationResult:
    nomination_counts: list[NominationCount]
    total_votes: int
    abstain_count: int


def count_nomination_votes(
    votes: list[dict],
    poll_options: list[str] | None = None,
) -> NominationResult:
    """Count nomination votes and return aggregated results.

    Args:
        votes: List of vote dicts, each with:
            - nominations: list[str] | None
            - is_abstain: bool (optional, defaults to False)
        poll_options: Optional list of starting options from the poll.
            These are included in results even if they received 0 votes.

    Returns:
        NominationResult with nomination counts sorted by count desc, then alphabetical.
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

        nominations = vote.get("nominations")
        if not nominations or not isinstance(nominations, list):
            continue

        for nom in nominations:
            if isinstance(nom, str) and nom:
                counts[nom] = counts.get(nom, 0) + 1

    # Sort by count descending, then alphabetically
    sorted_counts = sorted(
        counts.items(),
        key=lambda x: (-x[1], x[0]),
    )

    return NominationResult(
        nomination_counts=[
            NominationCount(option=option, count=count)
            for option, count in sorted_counts
        ],
        total_votes=total_votes,
        abstain_count=abstain_count,
    )
