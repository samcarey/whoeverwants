"""Discover all related question IDs by grouping on `group_id`.

Phase B.2: group membership is materialized as `polls.group_id`. Two
questions are related when their polls share a `group_id`. The previous
algorithm walked `polls.follow_up_to` chains in Python; that's now a single
SQL `WHERE group_id IN (...)` lookup, and this module just dedupes the
result.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class QuestionRelation:
    """A question's group membership.

    `group_id` is `polls.group_id` of the question's poll wrapper. Phase B.1
    backfilled this for every existing poll and Phase B.2 tightens the column
    to NOT NULL, so in practice it should always be set; we still tolerate
    None on input rows so the caller doesn't have to filter.
    """

    id: str
    group_id: str | None = None


def get_all_related_question_ids(
    input_question_ids: list[str],
    all_questions: list[QuestionRelation],
) -> list[str]:
    """Find every question sharing a group with any input question.

    Args:
        input_question_ids: Starting set of question IDs.
        all_questions: Questions in the candidate pool, each with its
            `group_id`. Typically every question whose `group_id` matches
            an input's `group_id`, fetched in one SQL hop by the caller.

    Returns:
        Deduplicated list of related question IDs (includes inputs even
        when they're missing from `all_questions`).
    """
    if not input_question_ids:
        return []

    input_set = set(input_question_ids)
    input_groups = {
        q.group_id for q in all_questions if q.id in input_set and q.group_id
    }

    related = set(input_question_ids)
    if input_groups:
        related.update(q.id for q in all_questions if q.group_id in input_groups)
    return list(related)
