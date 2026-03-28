"""Auto-close logic for participation polls.

Participation polls with a max_participants value should automatically close
when the number of "yes" votes reaches max_participants. This uses the raw
count of yes votes, not the priority-filtered count.
"""

from __future__ import annotations


def should_auto_close(
    category: str,
    is_closed: bool,
    max_participants: int | None,
    yes_vote_count: int,
) -> bool:
    """Check whether a participation poll should be auto-closed.

    Args:
        category: The poll's category (only "participation" triggers auto-close).
        is_closed: Whether the poll is already closed.
        max_participants: The poll's max_participants setting (None = no limit).
        yes_vote_count: Current number of "yes" votes on the poll.

    Returns:
        True if the poll should be closed due to reaching max capacity.
    """
    if category != "participation":
        return False
    if is_closed:
        return False
    if max_participants is None:
        return False
    return yes_vote_count >= max_participants
