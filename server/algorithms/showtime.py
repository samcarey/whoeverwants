"""Showtime winner algorithm.

A showtime poll's options are concrete movie showtimes; voters mark each
want / neutral / can't-attend (stored in `votes.liked_slots` / `disliked_slots`,
exactly like a `time` poll's preference phase). The winner rule is identical to
the time-preference winner — *fewest dislikes → most likes → earliest* — which
**is** *max attendance → max likes → earliest*, because attendance-max ≡
dislike-min (a non-red voter attends). So we reuse `_pick_winner_from_reactions`
verbatim; plus-one weighting flows through `vote_weight` for free.
"""

from __future__ import annotations

from algorithms.time_question import _pick_winner_from_reactions
from algorithms.weights import vote_weight


def calculate_showtime_results(options: list[str], votes: list[dict]) -> dict:
    """Return ``{winner, like_counts, dislike_counts, attendance_counts}``.

    ``attendance_counts[opt]`` = total preference-respondent weight minus the
    weight that marked the option can't-attend — i.e. how many people (incl.
    plus-ones) could attend that showtime.
    """
    winner, like_counts, dislike_counts = _pick_winner_from_reactions(options, votes)

    # Total weight of everyone who expressed a preference (any like/dislike set,
    # incl. an all-neutral submission which sends empty lists, not None).
    total = sum(
        vote_weight(v)
        for v in votes
        if v.get("liked_slots") is not None or v.get("disliked_slots") is not None
    )

    attendance_counts = {
        opt: total - dislike_counts.get(opt, 0) for opt in options
    }

    return {
        "winner": winner,
        "like_counts": like_counts,
        "dislike_counts": dislike_counts,
        "attendance_counts": attendance_counts,
    }
