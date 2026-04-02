"""Tests for suggestion vote counting algorithm."""

from algorithms.suggestion import SuggestionCount, SuggestionResult, count_suggestion_votes


class TestCountSuggestionVotes:
    def test_no_votes(self):
        result = count_suggestion_votes([])
        assert result == SuggestionResult(
            suggestion_counts=[],
            total_votes=0,
            abstain_count=0,
        )

    def test_single_vote_single_suggestion(self):
        votes = [{"suggestions": ["Alice"]}]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [SuggestionCount("Alice", 1)]
        assert result.total_votes == 1
        assert result.abstain_count == 0

    def test_single_vote_multiple_suggestions(self):
        votes = [{"suggestions": ["Alice", "Bob", "Charlie"]}]
        result = count_suggestion_votes(votes)
        assert result.total_votes == 1
        assert len(result.suggestion_counts) == 3
        # All have count 1, sorted alphabetically
        assert result.suggestion_counts == [
            SuggestionCount("Alice", 1),
            SuggestionCount("Bob", 1),
            SuggestionCount("Charlie", 1),
        ]

    def test_multiple_votes_same_suggestion(self):
        votes = [
            {"suggestions": ["Alice"]},
            {"suggestions": ["Alice"]},
            {"suggestions": ["Alice"]},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [SuggestionCount("Alice", 3)]
        assert result.total_votes == 3

    def test_sorting_by_count_desc(self):
        votes = [
            {"suggestions": ["Alice", "Bob"]},
            {"suggestions": ["Alice", "Charlie"]},
            {"suggestions": ["Alice"]},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [
            SuggestionCount("Alice", 3),
            SuggestionCount("Bob", 1),
            SuggestionCount("Charlie", 1),
        ]

    def test_alphabetical_tiebreak(self):
        votes = [
            {"suggestions": ["Charlie", "Alice", "Bob"]},
        ]
        result = count_suggestion_votes(votes)
        # All tied at 1, sorted alphabetically
        assert result.suggestion_counts == [
            SuggestionCount("Alice", 1),
            SuggestionCount("Bob", 1),
            SuggestionCount("Charlie", 1),
        ]

    def test_abstain_votes_excluded_from_counts(self):
        votes = [
            {"suggestions": ["Alice"], "is_abstain": False},
            {"suggestions": ["Bob"], "is_abstain": True},
            {"suggestions": None, "is_abstain": True},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [SuggestionCount("Alice", 1)]
        assert result.total_votes == 3
        assert result.abstain_count == 2

    def test_all_abstain(self):
        votes = [
            {"is_abstain": True},
            {"is_abstain": True},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == []
        assert result.total_votes == 2
        assert result.abstain_count == 2

    def test_null_suggestions_skipped(self):
        votes = [
            {"suggestions": None},
            {"suggestions": ["Alice"]},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [SuggestionCount("Alice", 1)]
        assert result.total_votes == 2

    def test_empty_suggestions_list_skipped(self):
        votes = [
            {"suggestions": []},
            {"suggestions": ["Alice"]},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [SuggestionCount("Alice", 1)]

    def test_empty_string_suggestions_skipped(self):
        votes = [{"suggestions": ["Alice", "", "Bob"]}]
        result = count_suggestion_votes(votes)
        assert len(result.suggestion_counts) == 2
        assert SuggestionCount("Alice", 1) in result.suggestion_counts
        assert SuggestionCount("Bob", 1) in result.suggestion_counts

    def test_is_abstain_defaults_false(self):
        """Votes without is_abstain field are treated as non-abstain."""
        votes = [{"suggestions": ["Alice"]}]
        result = count_suggestion_votes(votes)
        assert result.abstain_count == 0
        assert result.suggestion_counts == [SuggestionCount("Alice", 1)]

    def test_poll_options_included_with_zero_votes(self):
        """Starting poll options appear in results even with 0 votes."""
        votes = [{"suggestions": ["Alice"]}]
        result = count_suggestion_votes(votes, poll_options=["Alice", "Bob", "Charlie"])
        assert result.suggestion_counts == [
            SuggestionCount("Alice", 1),
            SuggestionCount("Bob", 0),
            SuggestionCount("Charlie", 0),
        ]

    def test_poll_options_no_votes(self):
        """Poll options with no votes at all."""
        result = count_suggestion_votes([], poll_options=["Option A", "Option B"])
        assert result.suggestion_counts == [
            SuggestionCount("Option A", 0),
            SuggestionCount("Option B", 0),
        ]

    def test_large_poll(self):
        votes = [
            {"suggestions": ["Alice", "Bob"]}
            for _ in range(50)
        ] + [
            {"suggestions": ["Charlie"]}
            for _ in range(30)
        ] + [
            {"is_abstain": True}
            for _ in range(5)
        ]
        result = count_suggestion_votes(votes)
        assert result.total_votes == 85
        assert result.abstain_count == 5
        assert result.suggestion_counts == [
            SuggestionCount("Alice", 50),
            SuggestionCount("Bob", 50),
            SuggestionCount("Charlie", 30),
        ]

    def test_non_list_suggestions_skipped(self):
        """Non-list suggestions value is safely skipped."""
        votes = [
            {"suggestions": "not a list"},
            {"suggestions": ["Alice"]},
        ]
        result = count_suggestion_votes(votes)
        assert result.suggestion_counts == [SuggestionCount("Alice", 1)]
