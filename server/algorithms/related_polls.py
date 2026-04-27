"""Discover all related question IDs via the poll-level follow_up chain.

Phase 3.5: thread chains live at the poll level. Two questions are related
when their polls form a follow_up chain (in either direction) or when
they share a poll wrapper (sibling questions).

The original SQL discovery walked `questions.follow_up_to` per-row. Forks were
removed in migration 095; sibling-question grouping was added when the
poll system shipped.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class QuestionRelation:
    """A question's relationship fields used by the discovery algorithm.

    `poll_id` groups sibling questions. `poll_follow_up_to` is the
    question's wrapper's follow_up chain pointer (a poll_id, or None for
    thread roots).
    """

    id: str
    poll_id: str | None = None
    poll_follow_up_to: str | None = None


def get_all_related_question_ids(
    input_question_ids: list[str],
    all_questions: list[QuestionRelation],
    max_depth: int = 10,
) -> list[str]:
    """Find all question IDs related to the input set via poll-level
    follow_up chains and poll-sibling grouping.

    Searches bidirectionally at the poll level:
    - Descendants: polls whose `follow_up_to` points to a known poll
    - Ancestors: a known poll's `follow_up_to` target
    - Siblings: every question of a visited poll

    Args:
        input_question_ids: Starting set of question IDs.
        all_questions: All questions with their poll-level relationship fields.
        max_depth: Maximum traversal iterations (prevents infinite loops).

    Returns:
        Deduplicated list of all related question IDs (includes input IDs).
    """
    if not input_question_ids or not all_questions:
        return list(set(input_question_ids)) if input_question_ids else []

    question_by_id: dict[str, QuestionRelation] = {p.id: p for p in all_questions}

    # poll_id -> [question_id, ...] (every question of a wrapper).
    questions_by_poll: dict[str, list[str]] = {}
    # parent_poll_id -> [child_poll_id, ...] from mp.follow_up_to.
    children_by_parent_poll: dict[str, list[str]] = {}
    # poll_id -> parent_poll_id (mp.follow_up_to). Sub-questions of one
    # wrapper share the same value; recorded once.
    parent_of_poll: dict[str, str | None] = {}

    for p in all_questions:
        if not p.poll_id:
            continue
        questions_by_poll.setdefault(p.poll_id, []).append(p.id)
        if p.poll_id not in parent_of_poll:
            parent_of_poll[p.poll_id] = p.poll_follow_up_to
        if p.poll_follow_up_to:
            children_by_parent_poll.setdefault(p.poll_follow_up_to, []).append(
                p.poll_id
            )

    # Dedupe child poll lists (one entry per child poll, not per
    # sibling question of that child).
    for parent_id, children in children_by_parent_poll.items():
        children_by_parent_poll[parent_id] = list(dict.fromkeys(children))

    discovered: set[str] = set(input_question_ids)
    discovered_polls: set[str] = {
        question_by_id[pid].poll_id
        for pid in input_question_ids
        if pid in question_by_id and question_by_id[pid].poll_id
    }
    poll_frontier: set[str] = set(discovered_polls)

    for _ in range(max_depth):
        new_polls: set[str] = set()
        for mid in poll_frontier:
            # Descendants: child polls whose follow_up_to == mid.
            for child_id in children_by_parent_poll.get(mid, []):
                if child_id not in discovered_polls:
                    new_polls.add(child_id)
            # Ancestor: this poll's follow_up_to target.
            parent_id = parent_of_poll.get(mid)
            if parent_id and parent_id not in discovered_polls:
                new_polls.add(parent_id)
        if not new_polls:
            break
        discovered_polls |= new_polls
        poll_frontier = new_polls

    # Expand each discovered poll to its questions.
    for mid in discovered_polls:
        for pid in questions_by_poll.get(mid, []):
            discovered.add(pid)

    return list(discovered)
