"""Participation poll priority algorithm.

Determines which voters will participate when voters have conditional
constraints (min/max participant requirements). Uses a greedy selection
algorithm that prioritizes voters with fewer constraints to maximize
future participation opportunities.

Priority ranking (highest to lowest):
1. No max constraint (unlimited flexibility)
2. Higher max value (more room for others)
3. Lower min value (easier to satisfy)
4. Earlier timestamp (first-come-first-served tiebreaker)

Reference: database/migrations/063_fix_participation_selection_logic_up.sql
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class ParticipatingVoter:
    vote_id: str
    voter_name: str | None
    min_participants: int | None
    max_participants: int | None
    priority_score: int


def calculate_participating_voters(votes: list[dict]) -> list[ParticipatingVoter]:
    """Determine which voters will participate using greedy priority selection.

    Args:
        votes: List of vote dicts, each with:
            - id: str (vote ID)
            - voter_name: str | None
            - yes_no_choice: "yes" or "no"
            - is_abstain: bool (optional)
            - min_participants: int | None (voter's min constraint)
            - max_participants: int | None (voter's max constraint)
            - created_at: str | datetime (ISO timestamp)

    Returns:
        List of ParticipatingVoter for voters selected to participate,
        sorted by priority score descending.
    """
    # Step 1: Filter to yes voters who aren't abstaining
    yes_voters = []
    for vote in votes:
        if vote.get("is_abstain", False):
            continue
        if vote.get("yes_no_choice") != "yes":
            continue
        yes_voters.append(vote)

    if not yes_voters:
        return []

    # Step 2: Sort by priority (most flexible first)
    prioritized = _prioritize_voters(yes_voters)

    if not prioritized:
        return []

    # Step 3: Greedy selection
    selected = _greedy_select(prioritized)

    # Step 4: Return selected voters sorted by priority score desc
    return sorted(selected, key=lambda v: v.priority_score, reverse=True)


def _parse_created_at(vote: dict) -> float:
    """Extract epoch seconds from created_at field."""
    created_at = vote.get("created_at")
    if created_at is None:
        return 0.0
    if isinstance(created_at, datetime):
        return created_at.timestamp()
    if isinstance(created_at, str):
        # Handle ISO format timestamps
        # Strip timezone suffix for fromisoformat compatibility
        s = created_at
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(s).timestamp()
        except ValueError:
            return 0.0
    return 0.0


def _calculate_priority_score(vote: dict) -> int:
    """Calculate priority score matching the SQL implementation.

    Higher score = higher priority.
    Formula: max_factor * 1_000_000 - min_factor * 1_000 - epoch_seconds
    """
    max_p = vote.get("max_participants")
    min_p = vote.get("min_participants")
    epoch = int(_parse_created_at(vote))

    if max_p is None:
        max_factor = 1_000_000
    else:
        max_factor = int(max_p)

    min_factor = int(min_p) if min_p is not None else 0

    return max_factor * 1_000_000 - min_factor * 1_000 - epoch


@dataclass
class _PrioritizedVoter:
    vote_id: str
    voter_name: str | None
    min_participants: int | None
    max_participants: int | None
    priority_score: int
    priority_rank: int  # 1-based


def _prioritize_voters(yes_voters: list[dict]) -> list[_PrioritizedVoter]:
    """Sort voters by priority and assign ranks."""
    # Sort: no max first (desc), then lower min (asc), then earlier time (asc)
    def sort_key(vote: dict):
        max_p = vote.get("max_participants")
        min_p = vote.get("min_participants")
        max_sort = 1_000_000 if max_p is None else int(max_p)
        min_sort = int(min_p) if min_p is not None else 0
        epoch = _parse_created_at(vote)
        return (-max_sort, min_sort, epoch)

    sorted_voters = sorted(yes_voters, key=sort_key)

    result = []
    for rank, vote in enumerate(sorted_voters, start=1):
        result.append(_PrioritizedVoter(
            vote_id=str(vote["id"]),
            voter_name=vote.get("voter_name"),
            min_participants=vote.get("min_participants"),
            max_participants=vote.get("max_participants"),
            priority_score=_calculate_priority_score(vote),
            priority_rank=rank,
        ))
    return result


def _greedy_select(prioritized: list[_PrioritizedVoter]) -> list[ParticipatingVoter]:
    """Greedy selection: add voters one at a time in priority order.

    For each voter (in priority order), include them if:
    1. Their min constraint is satisfied at the new participant count
    2. Their max constraint is satisfied at the new participant count
    3. No already-selected voter's max constraint would be violated
    """
    # Try starting with the highest priority voter
    first = prioritized[0]
    can_start = (
        (first.min_participants is None or 1 >= first.min_participants)
        and (first.max_participants is None or 1 <= first.max_participants)
    )

    if not can_start:
        # If highest priority voter can't participate alone,
        # try each subsequent voter as a potential starter
        # (matches SQL behavior: base case requires rank 1)
        # Actually the SQL only tries rank 1. If rank 1 can't start alone,
        # the recursive CTE returns no rows -> empty result.
        return []

    selected: list[_PrioritizedVoter] = [first]
    participant_count = 1

    # Try to add remaining voters in priority order
    for voter in prioritized[1:]:
        new_count = participant_count + 1

        # Check this voter's constraints at new count
        if voter.min_participants is not None and new_count < voter.min_participants:
            continue
        if voter.max_participants is not None and new_count > voter.max_participants:
            continue

        # Check all already-selected voters' max constraints
        violates_existing = False
        for existing in selected:
            if existing.max_participants is not None and new_count > existing.max_participants:
                violates_existing = True
                break

        if violates_existing:
            continue

        selected.append(voter)
        participant_count = new_count

    # Check min constraints for all selected voters at final count
    # Voters whose min isn't met at the final count should be excluded
    # But the greedy approach already ensures constraints at time of addition.
    # However, a voter added when count was 3 with min=3 is fine,
    # but the final count might stay at 3 so still OK.
    # The SQL doesn't do a post-check either.

    return [
        ParticipatingVoter(
            vote_id=v.vote_id,
            voter_name=v.voter_name,
            min_participants=v.min_participants,
            max_participants=v.max_participants,
            priority_score=v.priority_score,
        )
        for v in selected
    ]
