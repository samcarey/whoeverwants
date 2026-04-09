"""Ranked choice (IRV) vote counting algorithm.

Implements Instant Runoff Voting with Borda count tiebreaker.
Eliminates last-place candidate each round until one achieves majority.
Exhausted ballots (no remaining non-eliminated candidates) are excluded
from the majority threshold calculation.

Reference: database/migrations/046_fix_majority_calculation_for_exhausted_ballots_up.sql
"""

from dataclasses import dataclass, field


@dataclass
class RoundEntry:
    option_name: str
    vote_count: int
    is_eliminated: bool
    borda_score: int | None = None
    tie_broken_by_borda: bool = False


@dataclass
class RankedChoiceResult:
    winner: str | None
    total_rounds: int
    rounds: list[list[RoundEntry]] = field(default_factory=list)


def calculate_ranked_choice_winner(
    votes: list[dict],
    options: list[str],
) -> RankedChoiceResult:
    """Run IRV algorithm on ranked choice votes.

    Args:
        votes: List of vote dicts, each with:
            - ranked_choices: list[str] ordered by preference
            - is_abstain: bool (optional)
        options: List of all candidate names from the poll.

    Returns:
        RankedChoiceResult with winner, round count, and per-round data.
    """
    # Filter to valid, non-abstain ballots
    ballots: list[list[str]] = []
    for vote in votes:
        if vote.get("is_abstain", False) or vote.get("is_ranking_abstain", False):
            continue
        choices = vote.get("ranked_choices")
        if not choices or not isinstance(choices, list):
            continue
        # Filter out empty strings and None
        cleaned = [c for c in choices if c]
        if cleaned:
            ballots.append(cleaned)

    if not ballots:
        return RankedChoiceResult(winner=None, total_rounds=0)

    total_candidates = len(options)
    eliminated: set[str] = set()
    rounds: list[list[RoundEntry]] = []
    max_rounds = 50

    for round_num in range(1, max_rounds + 1):
        active_options = [o for o in options if o not in eliminated]

        # Find each ballot's top non-eliminated choice
        top_choices: list[str] = []
        for ballot in ballots:
            for choice in ballot:
                if choice not in eliminated:
                    top_choices.append(choice)
                    break
            # If no non-eliminated choice found, ballot is exhausted

        active_ballots = len(top_choices)
        if active_ballots == 0:
            break

        # Count first-place votes for each active option
        vote_counts: dict[str, int] = {o: 0 for o in active_options}
        for choice in top_choices:
            if choice in vote_counts:
                vote_counts[choice] += 1

        # Check for winner: majority of active ballots
        majority_threshold = (active_ballots // 2) + 1

        # Sort by vote count desc, then alphabetically for determinism
        sorted_options = sorted(
            active_options, key=lambda o: (-vote_counts[o], o)
        )
        max_votes = vote_counts[sorted_options[0]]
        winning_option = sorted_options[0]

        remaining_options = len(active_options)

        # Build round entries (not yet marking eliminations)
        round_entries = [
            RoundEntry(
                option_name=o,
                vote_count=vote_counts[o],
                is_eliminated=False,
            )
            for o in sorted_options
        ]

        # Check win conditions
        if max_votes >= majority_threshold or remaining_options <= 1:
            rounds.append(round_entries)
            return RankedChoiceResult(
                winner=winning_option,
                total_rounds=round_num,
                rounds=rounds,
            )

        # Find minimum vote count
        min_votes = min(vote_counts[o] for o in active_options)

        # Get candidates tied for last place
        tied_candidates = [
            o for o in active_options if vote_counts[o] == min_votes
        ]

        if len(tied_candidates) == 1:
            to_eliminate = tied_candidates[0]
            # Mark elimination in round entries
            for entry in round_entries:
                if entry.option_name == to_eliminate:
                    entry.is_eliminated = True
            eliminated.add(to_eliminate)
        else:
            # Borda count tiebreaker
            borda_scores = _calculate_borda_scores(
                ballots, tied_candidates, total_candidates
            )

            # Find minimum Borda score
            min_borda = min(borda_scores.values())
            lowest_borda = [
                c for c in tied_candidates if borda_scores[c] == min_borda
            ]

            # Alphabetical tiebreaker: eliminate the last one alphabetically
            to_eliminate = sorted(lowest_borda)[-1]

            # Store Borda scores and mark elimination
            for entry in round_entries:
                if entry.option_name in tied_candidates:
                    entry.borda_score = borda_scores.get(entry.option_name, 0)
                    entry.tie_broken_by_borda = True
                if entry.option_name == to_eliminate:
                    entry.is_eliminated = True

            eliminated.add(to_eliminate)

        rounds.append(round_entries)

    # Safety: should not reach here normally
    return RankedChoiceResult(
        winner=winning_option if active_ballots > 0 else None,
        total_rounds=len(rounds),
        rounds=rounds,
    )


def _calculate_borda_scores(
    ballots: list[list[str]],
    candidates: list[str],
    total_candidates: int,
) -> dict[str, int]:
    """Calculate Borda count scores for a subset of candidates.

    For n total candidates: 1st choice = n points, 2nd = n-1, ..., nth = 1.
    Unranked candidates get 0 points.
    """
    scores: dict[str, int] = {c: 0 for c in candidates}
    candidate_set = set(candidates)

    for ballot in ballots:
        for rank, choice in enumerate(ballot):
            if choice in candidate_set:
                # Borda points: total_candidates - rank (0-indexed)
                scores[choice] += total_candidates - rank

    return scores
