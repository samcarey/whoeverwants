"""Tests for related polls discovery algorithm."""

import pytest

from algorithms.related_polls import PollRelation, get_all_related_poll_ids


def _p(id: str, follow_up_to: str | None = None, fork_of: str | None = None) -> PollRelation:
    return PollRelation(id=id, follow_up_to=follow_up_to, fork_of=fork_of)


class TestGetAllRelatedPollIds:
    """Tests for bidirectional poll relationship traversal."""

    def test_empty_input(self):
        assert get_all_related_poll_ids([], []) == []

    def test_single_poll_no_relations(self):
        polls = [_p("a")]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a"}

    def test_single_follow_up_descendant(self):
        polls = [_p("a"), _p("b", follow_up_to="a")]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b"}

    def test_single_follow_up_ancestor(self):
        """Starting from a follow-up should discover parent."""
        polls = [_p("a"), _p("b", follow_up_to="a")]
        result = get_all_related_poll_ids(["b"], polls)
        assert set(result) == {"a", "b"}

    def test_chain_of_follow_ups(self):
        """a -> b -> c -> d: starting from any should find all."""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="b"),
            _p("d", follow_up_to="c"),
        ]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b", "c", "d"}

    def test_chain_from_middle(self):
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="b"),
        ]
        result = get_all_related_poll_ids(["b"], polls)
        assert set(result) == {"a", "b", "c"}

    def test_fork_descendant(self):
        polls = [_p("a"), _p("b", fork_of="a")]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b"}

    def test_fork_ancestor(self):
        polls = [_p("a"), _p("b", fork_of="a")]
        result = get_all_related_poll_ids(["b"], polls)
        assert set(result) == {"a", "b"}

    def test_mixed_follow_up_and_fork(self):
        """a has follow-up b and fork c."""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", fork_of="a"),
        ]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b", "c"}

    def test_branching_tree(self):
        """a -> b, a -> c, b -> d"""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="a"),
            _p("d", follow_up_to="b"),
        ]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b", "c", "d"}

    def test_branching_tree_from_leaf(self):
        """Starting from d should find entire tree."""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="a"),
            _p("d", follow_up_to="b"),
        ]
        result = get_all_related_poll_ids(["d"], polls)
        assert set(result) == {"a", "b", "c", "d"}

    def test_multiple_input_polls(self):
        """Two unrelated trees, querying from both roots."""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("x"),
            _p("y", follow_up_to="x"),
        ]
        result = get_all_related_poll_ids(["a", "x"], polls)
        assert set(result) == {"a", "b", "x", "y"}

    def test_input_poll_not_in_all_polls(self):
        """Input poll ID not in the all_polls list — still returned."""
        polls = [_p("a")]
        result = get_all_related_poll_ids(["z"], polls)
        assert set(result) == {"z"}

    def test_disconnected_polls_not_included(self):
        """Polls not related to input should not appear."""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("unrelated"),
        ]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b"}
        assert "unrelated" not in result

    def test_max_depth_limits_traversal(self):
        """With max_depth=2, should only traverse 2 levels."""
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", follow_up_to="b"),
            _p("d", follow_up_to="c"),  # depth 3 from a
        ]
        result = get_all_related_poll_ids(["a"], polls, max_depth=2)
        assert set(result) == {"a", "b", "c"}
        assert "d" not in result

    def test_duplicate_input_ids(self):
        polls = [_p("a"), _p("b", follow_up_to="a")]
        result = get_all_related_poll_ids(["a", "a"], polls)
        assert set(result) == {"a", "b"}
        # No duplicates in output
        assert len(result) == len(set(result))

    def test_complex_graph(self):
        """
        a -> b -> d
        a forked to c -> e
        """
        polls = [
            _p("a"),
            _p("b", follow_up_to="a"),
            _p("c", fork_of="a"),
            _p("d", follow_up_to="b"),
            _p("e", follow_up_to="c"),
        ]
        result = get_all_related_poll_ids(["d"], polls)
        assert set(result) == {"a", "b", "c", "d", "e"}

    def test_empty_all_polls(self):
        result = get_all_related_poll_ids(["a"], [])
        assert set(result) == {"a"}
