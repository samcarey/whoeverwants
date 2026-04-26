"""Discover all related polls via follow-up and fork chains.

Given a set of poll IDs, recursively traverses follow_up_to and fork_of
relationships in both directions (ancestors and descendants) to find all
connected polls.

Reference: database/migrations/017_create_poll_discovery_function_up.sql
(original SQL only searched descendants via follow_up_to; this Python version
is bidirectional and also follows fork_of).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PollRelation:
    """A poll's relationship fields."""
    id: str
    follow_up_to: str | None
    fork_of: str | None
    # Phase 2.5: multipoll wrapper this poll belongs to. Sibling sub-polls
    # (sharing the same multipoll_id) are treated as related so visiting any
    # one of them grants access to the whole group.
    multipoll_id: str | None = None


def get_all_related_poll_ids(
    input_poll_ids: list[str],
    all_polls: list[PollRelation],
    max_depth: int = 10,
) -> list[str]:
    """Find all poll IDs related to the input set via follow-up/fork chains
    and multipoll-sibling grouping.

    Searches bidirectionally:
    - Descendants: polls whose follow_up_to or fork_of points to a known poll
    - Ancestors: polls that a known poll's follow_up_to or fork_of points to
    - Multipoll siblings: polls sharing a multipoll_id with a known poll

    Args:
        input_poll_ids: Starting set of poll IDs.
        all_polls: All polls with their relationship fields.
        max_depth: Maximum traversal iterations (prevents infinite loops).

    Returns:
        Deduplicated list of all related poll IDs (includes input IDs).
    """
    if not input_poll_ids or not all_polls:
        return list(set(input_poll_ids)) if input_poll_ids else []

    # Build lookup structures
    poll_by_id: dict[str, PollRelation] = {p.id: p for p in all_polls}
    # Children: poll_id -> list of polls that reference it
    children_by_parent: dict[str, list[str]] = {}
    for p in all_polls:
        if p.follow_up_to:
            children_by_parent.setdefault(p.follow_up_to, []).append(p.id)
        if p.fork_of:
            children_by_parent.setdefault(p.fork_of, []).append(p.id)
    # Multipoll siblings: multipoll_id -> list of poll ids
    siblings_by_multipoll: dict[str, list[str]] = {}
    for p in all_polls:
        if p.multipoll_id:
            siblings_by_multipoll.setdefault(p.multipoll_id, []).append(p.id)

    discovered: set[str] = set(input_poll_ids)
    frontier: set[str] = set(input_poll_ids)

    for _ in range(max_depth):
        new_ids: set[str] = set()

        for pid in frontier:
            # Descendants: polls that follow_up_to or fork_of this poll
            for child_id in children_by_parent.get(pid, []):
                if child_id not in discovered:
                    new_ids.add(child_id)

            # Ancestors: this poll's follow_up_to / fork_of targets
            poll = poll_by_id.get(pid)
            if poll:
                if poll.follow_up_to and poll.follow_up_to not in discovered:
                    new_ids.add(poll.follow_up_to)
                if poll.fork_of and poll.fork_of not in discovered:
                    new_ids.add(poll.fork_of)
                # Multipoll siblings
                if poll.multipoll_id:
                    for sib_id in siblings_by_multipoll.get(poll.multipoll_id, []):
                        if sib_id not in discovered:
                            new_ids.add(sib_id)

        if not new_ids:
            break

        discovered |= new_ids
        frontier = new_ids

    return list(discovered)
