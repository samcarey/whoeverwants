"""Tests for related questions discovery algorithm.

Phase B.2: discovery groups by `polls.group_id`. A `QuestionRelation` carries
the question's `group_id` (its poll wrapper's group). The chain-walking
that the algorithm used to do in Python now lives in SQL — the caller fetches
every question whose poll shares a group with any input, and the algorithm
just dedupes.
"""

import pytest

from algorithms.related_polls import QuestionRelation, get_all_related_question_ids


def _q(id: str, *, group_id: str | None = None) -> QuestionRelation:
    """Build a QuestionRelation. By default each question is in its own
    single-question group (group_id mirrors id) — the trivial case.
    Pass `group_id=...` to put multiple questions in one group.
    """
    return QuestionRelation(
        id=id,
        group_id=group_id or id,
    )


class TestGetAllRelatedQuestionIds:
    """Tests for group-grouped question discovery."""

    def test_empty_input(self):
        assert get_all_related_question_ids([], []) == []

    def test_single_question_no_relations(self):
        questions = [_q("a")]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a"}

    def test_two_questions_in_one_group(self):
        """Two questions sharing a group should both be returned, regardless
        of which one is the input (membership is symmetric)."""
        questions = [_q("a", group_id="t1"), _q("b", group_id="t1")]
        assert set(get_all_related_question_ids(["a"], questions)) == {"a", "b"}
        assert set(get_all_related_question_ids(["b"], questions)) == {"a", "b"}

    def test_long_group(self):
        """All questions in one group are discovered together."""
        questions = [
            _q("a", group_id="t1"),
            _q("b", group_id="t1"),
            _q("c", group_id="t1"),
            _q("d", group_id="t1"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b", "c", "d"}

    def test_multiple_input_questions_unrelated_groups(self):
        """Two unrelated groups, querying from both."""
        questions = [
            _q("a", group_id="t1"),
            _q("b", group_id="t1"),
            _q("x", group_id="t2"),
            _q("y", group_id="t2"),
        ]
        result = get_all_related_question_ids(["a", "x"], questions)
        assert set(result) == {"a", "b", "x", "y"}

    def test_input_question_not_in_all_questions(self):
        """Input ID missing from `all_questions` is still returned as-is."""
        questions = [_q("a")]
        result = get_all_related_question_ids(["z"], questions)
        assert set(result) == {"z"}

    def test_disconnected_group_not_included(self):
        questions = [
            _q("a", group_id="t1"),
            _q("b", group_id="t1"),
            _q("unrelated", group_id="t2"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b"}
        assert "unrelated" not in result

    def test_duplicate_input_ids(self):
        questions = [_q("a", group_id="t1"), _q("b", group_id="t1")]
        result = get_all_related_question_ids(["a", "a"], questions)
        assert set(result) == {"a", "b"}
        assert len(result) == len(set(result))  # no duplicates in output

    def test_empty_all_questions(self):
        result = get_all_related_question_ids(["a"], [])
        assert set(result) == {"a"}

    def test_mixed_grouped_and_ungrouped(self):
        """An input with a group_id discovers its group mates; an input
        without one still appears in the output as a no-op pass-through.
        Post-migration 100, `group_id` is NOT NULL — this test guards the
        algorithm against a transient deploy state where a stale/unbackfilled
        row sneaks through."""
        questions = [
            _q("a", group_id="t1"),
            _q("b", group_id="t1"),
            QuestionRelation(id="c", group_id=None),
        ]
        result = get_all_related_question_ids(["a", "c"], questions)
        assert set(result) == {"a", "b", "c"}
