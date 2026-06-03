"""Alternative ranked-ballot aggregation methods, for COMPARISON ONLY.

This is a prototype harness for the "Layer 2" exploration in CLAUDE.md
(reconsider the ranked-choice headline aggregation). It does NOT touch the
production winner — `server/algorithms/ranked_choice.py` is still the only
thing the app uses. Here we re-run the SAME ballots through several methods
side-by-side so the owner can compare outcomes on real scenarios before
deciding whether to change (or offer a choice of) the headline method.

Methods compared:
  - IRV            : Instant-Runoff (current production headline) — "favorite".
  - Borda          : positional scoring (full ballot) — "broad acceptance".
  - Condorcet      : the option that beats every other head-to-head, when one
                     exists; otherwise completed by minimax (smallest worst
                     pairwise defeat) — "least objectionable".

All three consume the same tiered-ballot shape and reuse the production
`_calculate_borda_scores` so the Borda numbers match what already rides every
result (`borda_scores`).
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

# Reuse the real production algorithm + Borda implementation.
_SERVER = Path(__file__).resolve().parents[2] / "server"
if str(_SERVER) not in sys.path:
    sys.path.insert(0, str(_SERVER))

from algorithms.ranked_choice import (  # noqa: E402
    _calculate_borda_scores,
    calculate_ranked_choice_winner,
)

Ballot = list[list[str]]  # tiered ballot, e.g. [["A"], ["B", "C"], ["D"]]


def ballots_from_rankings(rankings: list[list[str]]) -> list[Ballot]:
    """Each flat ranking -> a tiered ballot of singletons (no equal ranks)."""
    return [[[opt] for opt in r] for r in rankings]


def _position_map(ballot: Ballot) -> dict[str, int]:
    """option -> 0-indexed tier position for every RANKED option on a ballot."""
    pos: dict[str, int] = {}
    idx = 0
    for tier in ballot:
        for opt in tier:
            pos[opt] = idx
        idx += len(tier)
    return pos


# --------------------------------------------------------------------------- #
# IRV (current production headline)
# --------------------------------------------------------------------------- #
def irv_winner(rankings: list[list[str]], options: list[str]) -> str | None:
    votes = [{"ranked_choices": r} for r in rankings]
    return calculate_ranked_choice_winner(votes, options).winner


# --------------------------------------------------------------------------- #
# Borda (broad-acceptance scoring)
# --------------------------------------------------------------------------- #
def borda_scores(rankings: list[list[str]], options: list[str]) -> dict[str, int]:
    ballots = ballots_from_rankings(rankings)
    return _calculate_borda_scores(ballots, options, len(options))


def borda_winner(rankings: list[list[str]], options: list[str]) -> str | None:
    scores = borda_scores(rankings, options)
    if not scores:
        return None
    best = max(scores.values())
    # Alphabetical tiebreak, mirroring the IRV elimination tiebreak convention.
    return sorted(o for o in options if scores[o] == best)[0]


# --------------------------------------------------------------------------- #
# Condorcet (least-objectionable) with minimax completion
# --------------------------------------------------------------------------- #
@dataclass
class CondorcetResult:
    winner: str | None
    is_true_condorcet: bool  # True == an option beat ALL others head-to-head
    # pairwise[a][b] = # ballots ranking a strictly above b
    pairwise: dict[str, dict[str, int]]


def _pairwise(rankings: list[list[str]], options: list[str]) -> dict[str, dict[str, int]]:
    ballots = ballots_from_rankings(rankings)
    table = {a: {b: 0 for b in options if b != a} for a in options}
    for ballot in ballots:
        pos = _position_map(ballot)
        for a in options:
            for b in options:
                if a == b:
                    continue
                pa = pos.get(a)
                pb = pos.get(b)
                # a beats b on this ballot if a is ranked higher, or a is ranked
                # and b is not. Both-unranked or same-tier => no preference.
                if pa is not None and (pb is None or pa < pb):
                    table[a][b] += 1
    return table


def condorcet_winner(rankings: list[list[str]], options: list[str]) -> CondorcetResult:
    table = _pairwise(rankings, options)

    # A true Condorcet winner strictly beats every other option head-to-head.
    for a in options:
        if all(table[a][b] > table[b][a] for b in options if b != a):
            return CondorcetResult(a, True, table)

    # No Condorcet winner -> minimax: pick the option whose WORST pairwise
    # defeat (largest margin by which some other option beats it) is smallest.
    def worst_defeat(a: str) -> int:
        return max((table[b][a] - table[a][b] for b in options if b != a), default=0)

    ranked = sorted(options, key=lambda a: (worst_defeat(a), a))
    return CondorcetResult(ranked[0], False, table)
