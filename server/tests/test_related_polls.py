"""Tests for related questions discovery algorithm.

Phase B.2: discovery groups by `polls.thread_id`. A `QuestionRelation` carries
the question's `thread_id` (its poll wrapper's thread). The chain-walking
that the algorithm used to do in Python now lives in SQL — the caller fetches
every question whose poll shares a thread with any input, and the algorithm
just dedupes.
"""

import pytest

from algorithms.related_polls import QuestionRelation, get_all_related_question_ids


def _q(id: str, *, thread_id: str | None = None) -> QuestionRelation:
    """Build a QuestionRelation. By default each question is in its own
    single-question thread (thread_id mirrors id) — the trivial case.
    Pass `thread_id=...` to put multiple questions in one thread.
    """
    return QuestionRelation(
        id=id,
        thread_id=thread_id or id,
    )


class TestGetAllRelatedQuestionIds:
    """Tests for thread-grouped question discovery."""

    def test_empty_input(self):
        assert get_all_related_question_ids([], []) == []

    def test_single_question_no_relations(self):
        questions = [_q("a")]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a"}

    def test_two_questions_in_one_thread(self):
        """Two questions sharing a thread should both be returned, regardless
        of which one is the input (membership is symmetric)."""
        questions = [_q("a", thread_id="t1"), _q("b", thread_id="t1")]
        assert set(get_all_related_question_ids(["a"], questions)) == {"a", "b"}
        assert set(get_all_related_question_ids(["b"], questions)) == {"a", "b"}

    def test_long_thread(self):
        """All questions in one thread are discovered together."""
        questions = [
            _q("a", thread_id="t1"),
            _q("b", thread_id="t1"),
            _q("c", thread_id="t1"),
            _q("d", thread_id="t1"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b", "c", "d"}

    def test_multiple_input_questions_unrelated_threads(self):
        """Two unrelated threads, querying from both."""
        questions = [
            _q("a", thread_id="t1"),
            _q("b", thread_id="t1"),
            _q("x", thread_id="t2"),
            _q("y", thread_id="t2"),
        ]
        result = get_all_related_question_ids(["a", "x"], questions)
        assert set(result) == {"a", "b", "x", "y"}

    def test_input_question_not_in_all_questions(self):
        """Input ID missing from `all_questions` is still returned as-is."""
        questions = [_q("a")]
        result = get_all_related_question_ids(["z"], questions)
        assert set(result) == {"z"}

    def test_disconnected_thread_not_included(self):
        questions = [
            _q("a", thread_id="t1"),
            _q("b", thread_id="t1"),
            _q("unrelated", thread_id="t2"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b"}
        assert "unrelated" not in result

    def test_duplicate_input_ids(self):
        questions = [_q("a", thread_id="t1"), _q("b", thread_id="t1")]
        result = get_all_related_question_ids(["a", "a"], questions)
        assert set(result) == {"a", "b"}
        assert len(result) == len(set(result))  # no duplicates in output

    def test_empty_all_questions(self):
        result = get_all_related_question_ids(["a"], [])
        assert set(result) == {"a"}

    def test_mixed_threaded_and_unthreaded(self):
        """An input with a thread_id discovers its thread mates; an input
        without one still appears in the output as a no-op pass-through.
        Post-migration 100, `thread_id` is NOT NULL — this test guards the
        algorithm against a transient deploy state where a stale/unbackfilled
        row sneaks through."""
        questions = [
            _q("a", thread_id="t1"),
            _q("b", thread_id="t1"),
            QuestionRelation(id="c", thread_id=None),
        ]
        result = get_all_related_question_ids(["a", "c"], questions)
        assert set(result) == {"a", "b", "c"}
