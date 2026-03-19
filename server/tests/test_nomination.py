"""Tests for nomination vote counting algorithm."""

from algorithms.nomination import NominationCount, NominationResult, count_nomination_votes


class TestCountNominationVotes:
    def test_no_votes(self):
        result = count_nomination_votes([])
        assert result == NominationResult(
            nomination_counts=[],
            total_votes=0,
            abstain_count=0,
        )

    def test_single_vote_single_nomination(self):
        votes = [{"nominations": ["Alice"]}]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [NominationCount("Alice", 1)]
        assert result.total_votes == 1
        assert result.abstain_count == 0

    def test_single_vote_multiple_nominations(self):
        votes = [{"nominations": ["Alice", "Bob", "Charlie"]}]
        result = count_nomination_votes(votes)
        assert result.total_votes == 1
        assert len(result.nomination_counts) == 3
        # All have count 1, sorted alphabetically
        assert result.nomination_counts == [
            NominationCount("Alice", 1),
            NominationCount("Bob", 1),
            NominationCount("Charlie", 1),
        ]

    def test_multiple_votes_same_nomination(self):
        votes = [
            {"nominations": ["Alice"]},
            {"nominations": ["Alice"]},
            {"nominations": ["Alice"]},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [NominationCount("Alice", 3)]
        assert result.total_votes == 3

    def test_sorting_by_count_desc(self):
        votes = [
            {"nominations": ["Alice", "Bob"]},
            {"nominations": ["Alice", "Charlie"]},
            {"nominations": ["Alice"]},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [
            NominationCount("Alice", 3),
            NominationCount("Bob", 1),
            NominationCount("Charlie", 1),
        ]

    def test_alphabetical_tiebreak(self):
        votes = [
            {"nominations": ["Charlie", "Alice", "Bob"]},
        ]
        result = count_nomination_votes(votes)
        # All tied at 1, sorted alphabetically
        assert result.nomination_counts == [
            NominationCount("Alice", 1),
            NominationCount("Bob", 1),
            NominationCount("Charlie", 1),
        ]

    def test_abstain_votes_excluded_from_counts(self):
        votes = [
            {"nominations": ["Alice"], "is_abstain": False},
            {"nominations": ["Bob"], "is_abstain": True},
            {"nominations": None, "is_abstain": True},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [NominationCount("Alice", 1)]
        assert result.total_votes == 3
        assert result.abstain_count == 2

    def test_all_abstain(self):
        votes = [
            {"is_abstain": True},
            {"is_abstain": True},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == []
        assert result.total_votes == 2
        assert result.abstain_count == 2

    def test_null_nominations_skipped(self):
        votes = [
            {"nominations": None},
            {"nominations": ["Alice"]},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [NominationCount("Alice", 1)]
        assert result.total_votes == 2

    def test_empty_nominations_list_skipped(self):
        votes = [
            {"nominations": []},
            {"nominations": ["Alice"]},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [NominationCount("Alice", 1)]

    def test_empty_string_nominations_skipped(self):
        votes = [{"nominations": ["Alice", "", "Bob"]}]
        result = count_nomination_votes(votes)
        assert len(result.nomination_counts) == 2
        assert NominationCount("Alice", 1) in result.nomination_counts
        assert NominationCount("Bob", 1) in result.nomination_counts

    def test_is_abstain_defaults_false(self):
        """Votes without is_abstain field are treated as non-abstain."""
        votes = [{"nominations": ["Alice"]}]
        result = count_nomination_votes(votes)
        assert result.abstain_count == 0
        assert result.nomination_counts == [NominationCount("Alice", 1)]

    def test_poll_options_included_with_zero_votes(self):
        """Starting poll options appear in results even with 0 votes."""
        votes = [{"nominations": ["Alice"]}]
        result = count_nomination_votes(votes, poll_options=["Alice", "Bob", "Charlie"])
        assert result.nomination_counts == [
            NominationCount("Alice", 1),
            NominationCount("Bob", 0),
            NominationCount("Charlie", 0),
        ]

    def test_poll_options_no_votes(self):
        """Poll options with no votes at all."""
        result = count_nomination_votes([], poll_options=["Option A", "Option B"])
        assert result.nomination_counts == [
            NominationCount("Option A", 0),
            NominationCount("Option B", 0),
        ]

    def test_large_poll(self):
        votes = [
            {"nominations": ["Alice", "Bob"]}
            for _ in range(50)
        ] + [
            {"nominations": ["Charlie"]}
            for _ in range(30)
        ] + [
            {"is_abstain": True}
            for _ in range(5)
        ]
        result = count_nomination_votes(votes)
        assert result.total_votes == 85
        assert result.abstain_count == 5
        assert result.nomination_counts == [
            NominationCount("Alice", 50),
            NominationCount("Bob", 50),
            NominationCount("Charlie", 30),
        ]

    def test_non_list_nominations_skipped(self):
        """Non-list nominations value is safely skipped."""
        votes = [
            {"nominations": "not a list"},
            {"nominations": ["Alice"]},
        ]
        result = count_nomination_votes(votes)
        assert result.nomination_counts == [NominationCount("Alice", 1)]
