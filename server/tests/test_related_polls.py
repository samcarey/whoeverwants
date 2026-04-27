"""Tests for related polls discovery algorithm.

Phase 3.5: discovery walks multipoll-level chains. A `PollRelation` carries the
poll's `multipoll_id` and `multipoll_follow_up_to` (its wrapper's follow_up
chain pointer). `_p()` wraps each test poll in its own 1-sub-poll multipoll by
default so the chain semantics mirror production after the Phase 4 backfill.
"""

import pytest

from algorithms.related_polls import PollRelation, get_all_related_poll_ids


def _p(
    id: str,
    *,
    multipoll_id: str | None = None,
    follow_up_to: str | None = None,
) -> PollRelation:
    """Build a PollRelation. By default each poll lives in its own 1-sub-poll
    multipoll whose id mirrors the poll id (so single-poll thread semantics are
    expressed without test scaffolding noise). Pass `multipoll_id=...` to put
    multiple polls in one wrapper. `follow_up_to` is a multipoll_id (the
    wrapper's parent multipoll), matching `multipolls.follow_up_to` semantics.
    """
    return PollRelation(
        id=id,
        multipoll_id=multipoll_id or id,
        multipoll_follow_up_to=follow_up_to,
    )


class TestGetAllRelatedPollIds:
    """Tests for bidirectional poll relationship traversal at the multipoll level."""

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

    def test_empty_all_polls(self):
        result = get_all_related_poll_ids(["a"], [])
        assert set(result) == {"a"}

    # --- Multipoll-level semantics ---

    def test_multipoll_siblings_grouped(self):
        """Two sub-polls in one wrapper are always discovered together."""
        polls = [
            _p("a", multipoll_id="m1"),
            _p("b", multipoll_id="m1"),
        ]
        result = get_all_related_poll_ids(["a"], polls)
        assert set(result) == {"a", "b"}

    def test_followup_pulls_all_siblings_of_parent(self):
        """A follow-up multipoll discovers every sibling sub-poll of its parent."""
        polls = [
            _p("a1", multipoll_id="m1"),
            _p("a2", multipoll_id="m1"),
            _p("b1", multipoll_id="m2", follow_up_to="m1"),
        ]
        result = get_all_related_poll_ids(["b1"], polls)
        assert set(result) == {"a1", "a2", "b1"}

    def test_followup_pulls_all_siblings_of_child(self):
        """Starting from a parent sub-poll discovers every sibling of the child."""
        polls = [
            _p("a1", multipoll_id="m1"),
            _p("b1", multipoll_id="m2", follow_up_to="m1"),
            _p("b2", multipoll_id="m2"),
        ]
        result = get_all_related_poll_ids(["a1"], polls)
        assert set(result) == {"a1", "b1", "b2"}

    def test_chain_of_multi_subpoll_wrappers(self):
        """m1 -> m2 -> m3 with multiple sub-polls in each: all discovered from any input."""
        polls = [
            _p("a1", multipoll_id="m1"),
            _p("a2", multipoll_id="m1"),
            _p("b1", multipoll_id="m2", follow_up_to="m1"),
            _p("b2", multipoll_id="m2"),
            _p("c1", multipoll_id="m3", follow_up_to="m2"),
        ]
        result = get_all_related_poll_ids(["b2"], polls)
        assert set(result) == {"a1", "a2", "b1", "b2", "c1"}
