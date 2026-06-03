"""Locks the comparison harness's claims so the prototype can't silently rot.

Run from this directory with the repo's plain interpreter (the algorithm import
is pure-stdlib, no venv needed):

    cd prototypes/aggregation && python3 -m pytest test_compare.py
"""

from __future__ import annotations

from methods import borda_winner, condorcet_winner, irv_winner
from scenarios import SCENARIOS


def _by_key(key: str):
    return next(s for s in SCENARIOS if s.key == key)


def test_consensus_favorite_all_agree():
    s = _by_key("consensus_favorite")
    assert irv_winner(s.rankings, s.options) == "Dune"
    assert borda_winner(s.rankings, s.options) == "Dune"
    assert condorcet_winner(s.rankings, s.options).winner == "Dune"


def test_marquee_condorcet_divergence():
    """The documented case (testing_strategy.md #7): IRV vs the compromise."""
    s = _by_key("condorcet_compromise")
    assert irv_winner(s.rankings, s.options) == "Romantic Comedy"
    cw = condorcet_winner(s.rankings, s.options)
    assert cw.winner == "Dramedy"
    assert cw.is_true_condorcet  # Dramedy beats both rivals head-to-head
    assert borda_winner(s.rankings, s.options) == "Dramedy"


def test_restaurant_least_objectionable_divergence():
    s = _by_key("restaurant_least_objectionable")
    assert irv_winner(s.rankings, s.options) == "Sushi Bar"
    assert borda_winner(s.rankings, s.options) == "Thai Place"
    assert condorcet_winner(s.rankings, s.options).winner == "Thai Place"


def test_irv_already_fixes_vote_splitting():
    """Spoiler scenario: IRV consolidates sci-fi; consensus methods agree."""
    s = _by_key("spoiler_split")
    assert irv_winner(s.rankings, s.options) == "Interstellar"
    assert borda_winner(s.rankings, s.options) == "Interstellar"
    assert condorcet_winner(s.rankings, s.options).winner == "Interstellar"


def test_exactly_two_scenarios_diverge():
    """The whole decision rides on these two; everything else is method-agnostic."""
    diverged = []
    for s in SCENARIOS:
        winners = {
            irv_winner(s.rankings, s.options),
            borda_winner(s.rankings, s.options),
            condorcet_winner(s.rankings, s.options).winner,
        }
        if len(winners) > 1:
            diverged.append(s.key)
    assert set(diverged) == {"condorcet_compromise", "restaurant_least_objectionable"}


def test_borda_and_condorcet_agree_wherever_irv_diverges():
    """A key simplifier: 'consensus' is unambiguous in our scenarios — Borda
    and Condorcet never disagree with each other, so the owner doesn't have to
    choose between them, only between 'favorite' and 'consensus'."""
    for s in SCENARIOS:
        b = borda_winner(s.rankings, s.options)
        c = condorcet_winner(s.rankings, s.options).winner
        assert b == c, f"{s.key}: Borda={b} Condorcet={c}"
