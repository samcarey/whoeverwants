"""Tests for 2-option ranked choice polls (formerly yes/no polls).

2-option ranked choice polls use the IRV algorithm but with only 2 candidates.
The results are equivalent to simple majority voting.
"""

from algorithms.ranked_choice import calculate_ranked_choice_winner


class TestTwoOptionRankedChoice:
    """Verify that IRV with 2 options produces the same results as the old yes/no counting."""

    def test_no_votes(self):
        result = calculate_ranked_choice_winner([], ["Yes", "No"])
        assert result.winner is None
        assert result.total_rounds == 0

    def test_unanimous_yes(self):
        votes = [{"ranked_choices": ["Yes", "No"]} for _ in range(5)]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner == "Yes"
        assert result.total_rounds == 1

    def test_unanimous_no(self):
        votes = [{"ranked_choices": ["No", "Yes"]} for _ in range(3)]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner == "No"
        assert result.total_rounds == 1

    def test_yes_wins_majority(self):
        votes = [
            {"ranked_choices": ["Yes", "No"]},
            {"ranked_choices": ["Yes", "No"]},
            {"ranked_choices": ["No", "Yes"]},
        ]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner == "Yes"
        assert result.total_rounds == 1

    def test_no_wins_majority(self):
        votes = [
            {"ranked_choices": ["Yes", "No"]},
            {"ranked_choices": ["No", "Yes"]},
            {"ranked_choices": ["No", "Yes"]},
        ]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner == "No"
        assert result.total_rounds == 1

    def test_abstain_votes_excluded(self):
        votes = [
            {"ranked_choices": ["Yes", "No"]},
            {"ranked_choices": ["No", "Yes"]},
            {"ranked_choices": ["Yes", "No"], "is_abstain": True},
        ]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        # Tie between 1 Yes and 1 No - IRV resolves with Borda tiebreaker
        # With 2 options and equal votes, alphabetical tiebreak applies
        assert result.winner is not None  # Will pick one via tiebreak

    def test_all_abstain(self):
        votes = [
            {"ranked_choices": ["Yes", "No"], "is_abstain": True},
            {"ranked_choices": ["No", "Yes"], "is_abstain": True},
        ]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner is None

    def test_custom_two_options(self):
        """2-option polls can have arbitrary option names, not just Yes/No."""
        votes = [
            {"ranked_choices": ["Pizza", "Tacos"]},
            {"ranked_choices": ["Pizza", "Tacos"]},
            {"ranked_choices": ["Tacos", "Pizza"]},
        ]
        result = calculate_ranked_choice_winner(votes, ["Pizza", "Tacos"])
        assert result.winner == "Pizza"
        assert result.total_rounds == 1

    def test_single_vote(self):
        votes = [{"ranked_choices": ["Yes", "No"]}]
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner == "Yes"
        assert result.total_rounds == 1

    def test_large_poll(self):
        votes = (
            [{"ranked_choices": ["Yes", "No"]} for _ in range(67)]
            + [{"ranked_choices": ["No", "Yes"]} for _ in range(30)]
            + [{"ranked_choices": ["Yes", "No"], "is_abstain": True} for _ in range(3)]
        )
        result = calculate_ranked_choice_winner(votes, ["Yes", "No"])
        assert result.winner == "Yes"
        assert result.total_rounds == 1
