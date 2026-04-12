"""Ranked choice (IRV) vote counting algorithm with equal-ranking support.

Implements Instant Runoff Voting with Borda count tiebreaker. Supports tied
rankings via tiered ballots: each ballot is a list of tiers, where each tier
is a list of options ranked equally.

Vote tallying uses the "duplicate vote" method for ties: when a ballot's
highest-ranked active tier contains multiple options, *each* option in that
tier receives a full vote from that ballot. This means the total vote count in
a round may exceed the number of active ballots.

Eliminates last-place candidate each round until one achieves a strict
majority as the unique leader, or only one candidate remains. Exhausted
ballots (no remaining non-eliminated candidates) are excluded from the
majority threshold calculation.

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


def _normalize_ballot(vote: dict) -> list[list[str]] | None:
    """Extract a tiered ballot from a vote dict.

    Prefers ``ranked_choice_tiers`` when present; otherwise falls back to
    ``ranked_choices`` (each option as its own singleton tier).

    Returns None if the vote has no usable data.
    """
    tiers_raw = vote.get("ranked_choice_tiers")
    if tiers_raw is not None:
        if not isinstance(tiers_raw, list):
            return None
        cleaned_tiers: list[list[str]] = []
        for tier in tiers_raw:
            if not isinstance(tier, list):
                continue
            cleaned_tier = [c for c in tier if isinstance(c, str) and c]
            if cleaned_tier:
                cleaned_tiers.append(cleaned_tier)
        return cleaned_tiers or None

    choices = vote.get("ranked_choices")
    if not choices or not isinstance(choices, list):
        return None
    cleaned = [c for c in choices if isinstance(c, str) and c]
    if not cleaned:
        return None
    return [[c] for c in cleaned]


def calculate_ranked_choice_winner(
    votes: list[dict],
    options: list[str],
) -> RankedChoiceResult:
    """Run IRV algorithm on ranked choice votes with tied-rank support.

    Args:
        votes: List of vote dicts, each with either:
            - ranked_choice_tiers: list[list[str]] — tiered ballot (preferred)
            - ranked_choices: list[str] — flat ballot (legacy)
          plus optional ``is_abstain`` / ``is_ranking_abstain`` flags.
        options: List of all candidate names from the poll.

    Returns:
        RankedChoiceResult with winner, round count, and per-round data.
    """
    # Filter to valid, non-abstain ballots
    ballots: list[list[list[str]]] = []
    for vote in votes:
        if vote.get("is_abstain", False) or vote.get("is_ranking_abstain", False):
            continue
        normalized = _normalize_ballot(vote)
        if normalized is None:
            continue
        ballots.append(normalized)

    if not ballots:
        return RankedChoiceResult(winner=None, total_rounds=0)

    total_candidates = len(options)
    eliminated: set[str] = set()
    rounds: list[list[RoundEntry]] = []
    max_rounds = 50
    last_winner: str | None = None

    for round_num in range(1, max_rounds + 1):
        active_options = [o for o in options if o not in eliminated]
        remaining_options = len(active_options)

        # Tally votes: each ballot contributes to every active option in its
        # highest-ranked tier that contains at least one non-eliminated option.
        vote_counts: dict[str, int] = {o: 0 for o in active_options}
        active_ballot_count = 0  # ballots that still have at least one active option
        for ballot in ballots:
            for tier in ballot:
                active_in_tier = [o for o in tier if o not in eliminated]
                if active_in_tier:
                    active_ballot_count += 1
                    for opt in active_in_tier:
                        vote_counts[opt] += 1
                    break

        if active_ballot_count == 0:
            break

        # Sort by vote count desc, then alphabetically for determinism
        sorted_options = sorted(
            active_options, key=lambda o: (-vote_counts[o], o)
        )
        max_votes = vote_counts[sorted_options[0]]
        leader_count = sum(1 for o in active_options if vote_counts[o] == max_votes)
        majority_threshold = (active_ballot_count // 2) + 1

        round_entries = [
            RoundEntry(
                option_name=o,
                vote_count=vote_counts[o],
                is_eliminated=False,
            )
            for o in sorted_options
        ]

        # Win condition: either only one candidate remains, OR
        # the leader has a strict majority AND is the unique top.
        # (If multiple candidates tie at the top with duplicate-vote majorities,
        #  we continue IRV to break the tie between them.)
        if remaining_options <= 1 or (
            max_votes >= majority_threshold and leader_count == 1
        ):
            winning_option = sorted_options[0]
            rounds.append(round_entries)
            return RankedChoiceResult(
                winner=winning_option,
                total_rounds=round_num,
                rounds=rounds,
            )
        last_winner = sorted_options[0]

        # Find minimum vote count
        min_votes = min(vote_counts[o] for o in active_options)
        tied_candidates = [
            o for o in active_options if vote_counts[o] == min_votes
        ]

        if len(tied_candidates) == 1:
            to_eliminate = tied_candidates[0]
            for entry in round_entries:
                if entry.option_name == to_eliminate:
                    entry.is_eliminated = True
            eliminated.add(to_eliminate)
        else:
            # Borda count tiebreaker across tied last-place candidates
            borda_scores = _calculate_borda_scores(
                ballots, tied_candidates, total_candidates
            )
            min_borda = min(borda_scores.values())
            lowest_borda = [
                c for c in tied_candidates if borda_scores[c] == min_borda
            ]
            # Alphabetical tiebreaker: eliminate the last one alphabetically
            to_eliminate = sorted(lowest_borda)[-1]

            for entry in round_entries:
                if entry.option_name in tied_candidates:
                    entry.borda_score = borda_scores.get(entry.option_name, 0)
                    entry.tie_broken_by_borda = True
                if entry.option_name == to_eliminate:
                    entry.is_eliminated = True

            eliminated.add(to_eliminate)

        rounds.append(round_entries)

    # Safety: exited via max_rounds (shouldn't happen for well-formed inputs)
    return RankedChoiceResult(
        winner=last_winner,
        total_rounds=len(rounds),
        rounds=rounds,
    )


def _calculate_borda_scores(
    ballots: list[list[list[str]]],
    candidates: list[str],
    total_candidates: int,
) -> dict[str, int]:
    """Calculate Borda count scores for a subset of candidates.

    Uses standard competition ranking (1-2-2-4) for ties: a tier of size k at
    position p consumes positions p..p+k-1 before the next tier starts.

    For n total candidates: rank 0 = n points, rank 1 = n-1 points, ... rank
    n-1 = 1 point. Unranked candidates get 0 points.
    """
    scores: dict[str, int] = {c: 0 for c in candidates}
    candidate_set = set(candidates)

    for ballot in ballots:
        position = 0  # 0-indexed standard-competition rank for this tier
        for tier in ballot:
            for choice in tier:
                if choice in candidate_set:
                    scores[choice] += total_candidates - position
            position += len(tier)

    return scores
