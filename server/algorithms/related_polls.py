"""Discover all related poll IDs via the multipoll-level follow_up chain.

Phase 3.5: thread chains live at the multipoll level. Two polls are related
when their multipolls form a follow_up chain (in either direction) or when
they share a multipoll wrapper (sibling sub-polls).

The original SQL discovery walked `polls.follow_up_to` per-row. Forks were
removed in migration 095; sibling-sub-poll grouping was added when the
multipoll system shipped.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PollRelation:
    """A poll's relationship fields used by the discovery algorithm.

    `multipoll_id` groups sibling sub-polls. `multipoll_follow_up_to` is the
    poll's wrapper's follow_up chain pointer (a multipoll_id, or None for
    thread roots).
    """

    id: str
    multipoll_id: str | None = None
    multipoll_follow_up_to: str | None = None


def get_all_related_poll_ids(
    input_poll_ids: list[str],
    all_polls: list[PollRelation],
    max_depth: int = 10,
) -> list[str]:
    """Find all poll IDs related to the input set via multipoll-level
    follow_up chains and multipoll-sibling grouping.

    Searches bidirectionally at the multipoll level:
    - Descendants: multipolls whose `follow_up_to` points to a known multipoll
    - Ancestors: a known multipoll's `follow_up_to` target
    - Siblings: every sub-poll of a visited multipoll

    Args:
        input_poll_ids: Starting set of poll IDs.
        all_polls: All polls with their multipoll-level relationship fields.
        max_depth: Maximum traversal iterations (prevents infinite loops).

    Returns:
        Deduplicated list of all related poll IDs (includes input IDs).
    """
    if not input_poll_ids or not all_polls:
        return list(set(input_poll_ids)) if input_poll_ids else []

    poll_by_id: dict[str, PollRelation] = {p.id: p for p in all_polls}

    # multipoll_id -> [poll_id, ...] (every sub-poll of a wrapper).
    polls_by_multipoll: dict[str, list[str]] = {}
    # parent_multipoll_id -> [child_multipoll_id, ...] from mp.follow_up_to.
    children_by_parent_multipoll: dict[str, list[str]] = {}
    # multipoll_id -> parent_multipoll_id (mp.follow_up_to). Sub-polls of one
    # wrapper share the same value; recorded once.
    parent_of_multipoll: dict[str, str | None] = {}

    for p in all_polls:
        if not p.multipoll_id:
            continue
        polls_by_multipoll.setdefault(p.multipoll_id, []).append(p.id)
        if p.multipoll_id not in parent_of_multipoll:
            parent_of_multipoll[p.multipoll_id] = p.multipoll_follow_up_to
        if p.multipoll_follow_up_to:
            children_by_parent_multipoll.setdefault(p.multipoll_follow_up_to, []).append(
                p.multipoll_id
            )

    # Dedupe child multipoll lists (one entry per child multipoll, not per
    # sibling sub-poll of that child).
    for parent_id, children in children_by_parent_multipoll.items():
        children_by_parent_multipoll[parent_id] = list(dict.fromkeys(children))

    discovered: set[str] = set(input_poll_ids)
    discovered_multipolls: set[str] = {
        poll_by_id[pid].multipoll_id
        for pid in input_poll_ids
        if pid in poll_by_id and poll_by_id[pid].multipoll_id
    }
    multipoll_frontier: set[str] = set(discovered_multipolls)

    for _ in range(max_depth):
        new_multipolls: set[str] = set()
        for mid in multipoll_frontier:
            # Descendants: child multipolls whose follow_up_to == mid.
            for child_id in children_by_parent_multipoll.get(mid, []):
                if child_id not in discovered_multipolls:
                    new_multipolls.add(child_id)
            # Ancestor: this multipoll's follow_up_to target.
            parent_id = parent_of_multipoll.get(mid)
            if parent_id and parent_id not in discovered_multipolls:
                new_multipolls.add(parent_id)
        if not new_multipolls:
            break
        discovered_multipolls |= new_multipolls
        multipoll_frontier = new_multipolls

    # Expand each discovered multipoll to its sub-polls.
    for mid in discovered_multipolls:
        for pid in polls_by_multipoll.get(mid, []):
            discovered.add(pid)

    return list(discovered)
