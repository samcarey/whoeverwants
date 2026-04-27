"""Tests for related questions discovery algorithm.

Phase 3.5: discovery walks poll-level chains. A `QuestionRelation` carries the
question's `poll_id` and `poll_follow_up_to` (its wrapper's follow_up
chain pointer). `_p()` wraps each test question in its own 1-question poll by
default so the chain semantics mirror production after the Phase 4 backfill.
"""

import pytest

from algorithms.related_questions import QuestionRelation, get_all_related_question_ids


def _p(
    id: str,
    *,
    poll_id: str | None = None,
    follow_up_to: str | None = None,
) -> QuestionRelation:
    """Build a QuestionRelation. By default each question lives in its own 1-question
    poll whose id mirrors the question id (so single-question thread semantics are
    expressed without test scaffolding noise). Pass `poll_id=...` to put
    multiple questions in one wrapper. `follow_up_to` is a poll_id (the
    wrapper's parent poll), matching `polls.follow_up_to` semantics.
    """
    return QuestionRelation(
        id=id,
        poll_id=poll_id or id,
        poll_follow_up_to=follow_up_to,
    )


class TestGetAllRelatedQuestionIds:
    """Tests for bidirectional question relationship traversal at the poll level."""

    def test_empty_input(self):
        assert get_all_related_question_ids([], []) == []

    def test_single_question_no_relations(self):
        questions = [_p("a")]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a"}

    def test_single_follow_up_descendant(self):
        questions = [_p("a"), _p("b", follow_up_to="a")]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b"}

    def test_single_follow_up_ancestor(self):
        """Starting from a follow-up should discover parent."""
        questions = [_p("a"), _p("b", follow_up_to="a")]
        result = get_all_related_question_ids(["b"], questions)
        assert set(result) == {"a", "b"}

    def test_chain_of_follow_ups(self):
        """a -> b -> c -> d: starting from any should find all."""
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="b"),
            _p("d", follow_up_to="c"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b", "c", "d"}

    def test_chain_from_middle(self):
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="b"),
        ]
        result = get_all_related_question_ids(["b"], questions)
        assert set(result) == {"a", "b", "c"}

    def test_branching_tree(self):
        """a -> b, a -> c, b -> d"""
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="a"),
            _p("d", follow_up_to="b"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b", "c", "d"}

    def test_branching_tree_from_leaf(self):
        """Starting from d should find entire tree."""
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="a"),
            _p("d", follow_up_to="b"),
        ]
        result = get_all_related_question_ids(["d"], questions)
        assert set(result) == {"a", "b", "c", "d"}

    def test_multiple_input_questions(self):
        """Two unrelated trees, querying from both roots."""
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("x"),
            _p("y", follow_up_to="x"),
        ]
        result = get_all_related_question_ids(["a", "x"], questions)
        assert set(result) == {"a", "b", "x", "y"}

    def test_input_question_not_in_all_questions(self):
        """Input question ID not in the all_questions list — still returned."""
        questions = [_p("a")]
        result = get_all_related_question_ids(["z"], questions)
        assert set(result) == {"z"}

    def test_disconnected_questions_not_included(self):
        """Questions not related to input should not appear."""
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("unrelated"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b"}
        assert "unrelated" not in result

    def test_max_depth_limits_traversal(self):
        """With max_depth=2, should only traverse 2 levels."""
        questions = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="b"),
            _p("d", follow_up_to="c"),  # depth 3 from a
        ]
        result = get_all_related_question_ids(["a"], questions, max_depth=2)
        assert set(result) == {"a", "b", "c"}
        assert "d" not in result

    def test_duplicate_input_ids(self):
        questions = [_p("a"), _p("b", follow_up_to="a")]
        result = get_all_related_question_ids(["a", "a"], questions)
        assert set(result) == {"a", "b"}
        # No duplicates in output
        assert len(result) == len(set(result))

    def test_empty_all_questions(self):
        result = get_all_related_question_ids(["a"], [])
        assert set(result) == {"a"}

    # --- Poll-level semantics ---

    def test_poll_siblings_grouped(self):
        """Two questions in one wrapper are always discovered together."""
        questions = [
            _p("a", poll_id="m1"),
            _p("b", poll_id="m1"),
        ]
        result = get_all_related_question_ids(["a"], questions)
        assert set(result) == {"a", "b"}

    def test_followup_pulls_all_siblings_of_parent(self):
        """A follow-up poll discovers every sibling question of its parent."""
        questions = [
            _p("a1", poll_id="m1"),
            _p("a2", poll_id="m1"),
            _p("b1", poll_id="m2", follow_up_to="m1"),
        ]
        result = get_all_related_question_ids(["b1"], questions)
        assert set(result) == {"a1", "a2", "b1"}

    def test_followup_pulls_all_siblings_of_child(self):
        """Starting from a parent question discovers every sibling of the child."""
        questions = [
            _p("a1", poll_id="m1"),
            _p("b1", poll_id="m2", follow_up_to="m1"),
            _p("b2", poll_id="m2"),
        ]
        result = get_all_related_question_ids(["a1"], questions)
        assert set(result) == {"a1", "b1", "b2"}

    def test_chain_of_multi_question_wrappers(self):
        """m1 -> m2 -> m3 with multiple questions in each: all discovered from any input."""
        questions = [
            _p("a1", poll_id="m1"),
            _p("a2", poll_id="m1"),
            _p("b1", poll_id="m2", follow_up_to="m1"),
            _p("b2", poll_id="m2"),
            _p("c1", poll_id="m3", follow_up_to="m2"),
        ]
        result = get_all_related_question_ids(["b2"], questions)
        assert set(result) == {"a1", "a2", "b1", "b2", "c1"}
