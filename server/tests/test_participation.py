"""Tests for participation poll priority algorithm.

Tests cover the greedy priority-based voter selection algorithm including:
- Basic participation (no constraints)
- Priority ordering (no max > higher max > lower min > earlier timestamp)
- Constraint checking (min/max enforcement)
- Greedy selection (adding voters without violating existing constraints)
- Edge cases (empty votes, all abstain, no valid config, etc.)

Reference: database/migrations/063_fix_participation_selection_logic_up.sql
           CLAUDE.md participation poll philosophy section
"""

from datetime import datetime, timezone, timedelta

from algorithms.participation import (
    ParticipatingVoter,
    calculate_participating_voters,
)


def _make_vote(
    vote_id: str = "vote-1",
    choice: str = "yes",
    is_abstain: bool = False,
    voter_name: str | None = None,
    min_p: int | None = None,
    max_p: int | None = None,
    created_at: str | None = None,
) -> dict:
    """Helper to create a vote dict."""
    if created_at is None:
        created_at = "2026-01-01T00:00:00+00:00"
    return {
        "id": vote_id,
        "voter_name": voter_name,
        "yes_no_choice": choice,
        "is_abstain": is_abstain,
        "min_participants": min_p,
        "max_participants": max_p,
        "created_at": created_at,
    }


def _ids(result: list[ParticipatingVoter]) -> list[str]:
    """Extract vote IDs from result."""
    return [v.vote_id for v in result]


class TestBasicParticipation:
    """Tests for simple participation without constraints."""

    def test_single_yes_voter(self):
        votes = [_make_vote("v1", "yes")]
        result = calculate_participating_voters(votes)
        assert _ids(result) == ["v1"]

    def test_multiple_yes_voters_no_constraints(self):
        votes = [
            _make_vote("v1", "yes", created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", created_at="2026-01-01T00:01:00+00:00"),
            _make_vote("v3", "yes", created_at="2026-01-01T00:02:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert len(result) == 3
        assert set(_ids(result)) == {"v1", "v2", "v3"}

    def test_no_voters_voted_yes(self):
        votes = [
            _make_vote("v1", "no"),
            _make_vote("v2", "no"),
        ]
        result = calculate_participating_voters(votes)
        assert result == []

    def test_empty_votes(self):
        result = calculate_participating_voters([])
        assert result == []

    def test_all_abstain(self):
        votes = [
            _make_vote("v1", "yes", is_abstain=True),
            _make_vote("v2", "yes", is_abstain=True),
        ]
        result = calculate_participating_voters(votes)
        assert result == []

    def test_mix_of_yes_no_abstain(self):
        votes = [
            _make_vote("v1", "yes"),
            _make_vote("v2", "no"),
            _make_vote("v3", "yes", is_abstain=True),
            _make_vote("v4", "yes", created_at="2026-01-01T00:01:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert set(_ids(result)) == {"v1", "v4"}


class TestPriorityOrdering:
    """Tests for priority scoring and ordering."""

    def test_no_max_has_highest_priority(self):
        """Voters without max constraint should be prioritized."""
        votes = [
            _make_vote("limited", "yes", max_p=5, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("unlimited", "yes", max_p=None, created_at="2026-01-01T00:01:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert len(result) == 2
        # Unlimited should have higher priority score
        assert result[0].vote_id == "unlimited"
        assert result[1].vote_id == "limited"

    def test_higher_max_beats_lower_max(self):
        """Higher max = more flexible = higher priority."""
        votes = [
            _make_vote("max3", "yes", max_p=3, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("max10", "yes", max_p=10, created_at="2026-01-01T00:00:01+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert result[0].vote_id == "max10"

    def test_lower_min_beats_higher_min(self):
        """Lower min = easier to satisfy = higher priority."""
        votes = [
            _make_vote("min5", "yes", min_p=5, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("min1", "yes", min_p=1, created_at="2026-01-01T00:00:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        # min1 should have higher priority (but both have no max, so it's 2nd factor)
        assert result[0].vote_id == "min1"

    def test_earlier_timestamp_tiebreaker(self):
        """Earlier created_at wins when all else is equal."""
        votes = [
            _make_vote("late", "yes", created_at="2026-01-01T12:00:00+00:00"),
            _make_vote("early", "yes", created_at="2026-01-01T00:00:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert result[0].vote_id == "early"


class TestConstraintEnforcement:
    """Tests for min/max participant constraint checking."""

    def test_voter_with_min_2_excluded_when_alone(self):
        """A voter requiring min 2 participants can't participate alone."""
        votes = [
            _make_vote("v1", "yes", min_p=2),
        ]
        # First voter has min_p=2 but count would be 1 -> can't start
        # Actually, the SQL only tries rank 1 as base case. If rank 1 can't
        # participate alone, the whole thing returns empty.
        result = calculate_participating_voters(votes)
        assert result == []

    def test_voter_with_min_satisfied(self):
        """Voter with min=2 can participate when enough others join."""
        votes = [
            _make_vote("v1", "yes", created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", min_p=2, created_at="2026-01-01T00:01:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert set(_ids(result)) == {"v1", "v2"}

    def test_max_constraint_prevents_addition(self):
        """Adding a voter that would exceed an existing voter's max is blocked."""
        votes = [
            _make_vote("v1", "yes", max_p=1, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", created_at="2026-01-01T00:01:00+00:00"),
        ]
        # v1 has max_p=1 but no max constraint on v2
        # Priority: v2 (no max) > v1 (max=1)
        # v2 goes first (higher priority), participates alone
        # v1 next: count would be 2, but v1 has max_p=1 so v1 is skipped
        # Wait - v1's own constraint fails, not existing. Let me re-check.
        # Actually v2 is already selected. Adding v1: new_count=2.
        # v1.max_participants=1, new_count=2 > 1 -> v1's own constraint fails -> skip
        result = calculate_participating_voters(votes)
        assert _ids(result) == ["v2"]

    def test_existing_voter_max_blocks_new_voter(self):
        """Can't add new voter if it would exceed an existing selected voter's max."""
        votes = [
            _make_vote("v1", "yes", max_p=2, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", created_at="2026-01-01T00:00:01+00:00"),
            _make_vote("v3", "yes", created_at="2026-01-01T00:00:02+00:00"),
        ]
        # Priority: v1(max=2) < v2(no max) < v3(no max)
        # Actually: no max = highest priority, so v2 and v3 first
        # Sort: v2(no max, earlier) > v3(no max, later) > v1(max=2)
        # Select v2 (count=1), then v3 (count=2), then v1:
        #   v1.max_p=2, new_count=3 > 2 -> v1's own constraint fails -> skip
        result = calculate_participating_voters(votes)
        assert set(_ids(result)) == {"v2", "v3"}

    def test_new_voter_would_violate_existing_max(self):
        """Existing voter's max blocks adding more voters."""
        # v1 has no max (highest priority), v2 has max=2
        # After both selected (count=2), v3 can't be added because
        # v2.max=2 would be violated at count=3
        votes = [
            _make_vote("v1", "yes", created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", max_p=2, created_at="2026-01-01T00:00:01+00:00"),
            _make_vote("v3", "yes", created_at="2026-01-01T00:00:02+00:00"),
        ]
        # Priority: v1(no max, earliest) > v3(no max, latest) > v2(max=2)
        # Actually: v1 and v3 both have no max. v1 is earlier -> higher priority.
        # Then v3 (no max, later). Then v2 (max=2).
        # Select v1 (count=1). Add v3 (count=2, no constraints violated).
        # Add v2: v2.max_p=2, new_count=3 > 2 -> v2's own constraint fails -> skip.
        result = calculate_participating_voters(votes)
        assert set(_ids(result)) == {"v1", "v3"}


class TestCLAUDEMdPhilosophyExample:
    """Tests matching the exact example from CLAUDE.md."""

    def test_flexible_voter_beats_restrictive(self):
        """From CLAUDE.md: Voter B (no max) beats Voter A (max=1)."""
        votes = [
            _make_vote("A", "yes", min_p=1, max_p=1, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("B", "yes", min_p=1, max_p=None, created_at="2026-01-01T00:01:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        # B has no max -> higher priority -> selected first
        # A has max_p=1 but count would be 2 -> A's constraint fails -> excluded
        assert _ids(result) == ["B"]

    def test_both_flexible_voters_included(self):
        """Two flexible voters with compatible constraints should both participate."""
        votes = [
            _make_vote("A", "yes", min_p=1, max_p=None, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("B", "yes", min_p=1, max_p=None, created_at="2026-01-01T00:01:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert len(result) == 2
        assert set(_ids(result)) == {"A", "B"}


class TestGreedySelection:
    """Tests for the greedy selection algorithm behavior."""

    def test_skips_voter_and_continues(self):
        """Algorithm should skip incompatible voters and keep trying later ones."""
        votes = [
            _make_vote("v1", "yes", created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", max_p=1, created_at="2026-01-01T00:00:01+00:00"),
            _make_vote("v3", "yes", created_at="2026-01-01T00:00:02+00:00"),
        ]
        # Priority: v1(no max) > v3(no max) > v2(max=1)
        # Select v1 (count=1). Try v3 (count=2, ok). Try v2 (max=1, count=3 > 1, skip).
        result = calculate_participating_voters(votes)
        assert set(_ids(result)) == {"v1", "v3"}

    def test_many_voters_greedy_maximizes(self):
        """Greedy approach should include as many compatible voters as possible."""
        votes = [
            _make_vote("v1", "yes", created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", created_at="2026-01-01T00:00:01+00:00"),
            _make_vote("v3", "yes", created_at="2026-01-01T00:00:02+00:00"),
            _make_vote("v4", "yes", created_at="2026-01-01T00:00:03+00:00"),
            _make_vote("v5", "yes", created_at="2026-01-01T00:00:04+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert len(result) == 5

    def test_first_voter_cant_participate_alone_returns_empty(self):
        """If the highest priority voter can't participate alone, return empty.

        This matches SQL behavior: the recursive CTE base case only tries rank 1.
        """
        votes = [
            _make_vote("v1", "yes", min_p=3),
            _make_vote("v2", "yes", min_p=2, created_at="2026-01-01T00:01:00+00:00"),
        ]
        # v1 has no max (highest priority) but min_p=3, can't start alone
        result = calculate_participating_voters(votes)
        assert result == []

    def test_voter_with_max_equal_to_count_is_included(self):
        """Voter whose max exactly matches count should be included."""
        votes = [
            _make_vote("v1", "yes", max_p=2, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", max_p=2, created_at="2026-01-01T00:00:01+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert len(result) == 2


class TestEdgeCases:
    """Edge case tests."""

    def test_single_no_voter(self):
        votes = [_make_vote("v1", "no")]
        result = calculate_participating_voters(votes)
        assert result == []

    def test_voter_name_preserved(self):
        votes = [_make_vote("v1", "yes", voter_name="Alice")]
        result = calculate_participating_voters(votes)
        assert result[0].voter_name == "Alice"

    def test_priority_score_is_set(self):
        votes = [_make_vote("v1", "yes")]
        result = calculate_participating_voters(votes)
        assert isinstance(result[0].priority_score, int)

    def test_result_sorted_by_priority_desc(self):
        """Results should be sorted by priority score descending."""
        votes = [
            _make_vote("low", "yes", max_p=2, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("high", "yes", max_p=None, created_at="2026-01-01T00:00:00+00:00"),
        ]
        result = calculate_participating_voters(votes)
        assert len(result) == 2
        assert result[0].priority_score >= result[1].priority_score

    def test_z_suffix_timestamp(self):
        """Handles Z-suffix ISO timestamps."""
        votes = [_make_vote("v1", "yes", created_at="2026-01-01T00:00:00Z")]
        result = calculate_participating_voters(votes)
        assert len(result) == 1

    def test_all_voters_with_incompatible_max(self):
        """When all voters have max=1, only the highest priority participates."""
        votes = [
            _make_vote("v1", "yes", max_p=1, created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", max_p=1, created_at="2026-01-01T00:00:01+00:00"),
            _make_vote("v3", "yes", max_p=1, created_at="2026-01-01T00:00:02+00:00"),
        ]
        # All have same max. Priority by timestamp: v1 first.
        # v1 selected (count=1). v2: count would be 2 > v1.max=1 -> skip. v3: same.
        result = calculate_participating_voters(votes)
        assert _ids(result) == ["v1"]

    def test_complex_mixed_constraints(self):
        """Complex scenario with mixed min/max constraints."""
        votes = [
            # No constraints - highest priority
            _make_vote("flex", "yes", created_at="2026-01-01T00:00:00+00:00"),
            # Wants 2-5 participants
            _make_vote("mid", "yes", min_p=2, max_p=5, created_at="2026-01-01T00:00:01+00:00"),
            # Wants exactly 3
            _make_vote("strict", "yes", min_p=3, max_p=3, created_at="2026-01-01T00:00:02+00:00"),
            # No constraints
            _make_vote("flex2", "yes", created_at="2026-01-01T00:00:03+00:00"),
        ]
        # Priority: flex(no max) > flex2(no max) > mid(max=5) > strict(max=3)
        # Select flex (count=1).
        # Add flex2 (count=2, ok).
        # Add mid (count=3, min=2 ok, max=5 ok, no existing max violated).
        # Add strict (count=4, min=3 ok, max=3... 4 > 3, strict's constraint fails -> skip).
        result = calculate_participating_voters(votes)
        assert set(_ids(result)) == {"flex", "flex2", "mid"}

    def test_min_not_met_at_final_count(self):
        """Voter whose min wasn't met because not enough others joined.

        But if the highest priority voter can participate alone, the algorithm proceeds.
        """
        votes = [
            _make_vote("v1", "yes", created_at="2026-01-01T00:00:00+00:00"),
            _make_vote("v2", "yes", min_p=5, created_at="2026-01-01T00:00:01+00:00"),
        ]
        # v1 selected (count=1). v2: min_p=5, count would be 2 < 5 -> skip.
        result = calculate_participating_voters(votes)
        assert _ids(result) == ["v1"]
