"""Tests for yes/no vote counting algorithm."""

from algorithms.yes_no import YesNoResult, count_yes_no_votes


class TestCountYesNoVotes:
    def test_no_votes(self):
        result = count_yes_no_votes([])
        assert result == YesNoResult(
            yes_count=0,
            no_count=0,
            abstain_count=0,
            total_votes=0,
            yes_percentage=None,
            no_percentage=None,
            winner=None,
        )

    def test_unanimous_yes(self):
        votes = [{"yes_no_choice": "yes"} for _ in range(5)]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 5
        assert result.no_count == 0
        assert result.total_votes == 5
        assert result.yes_percentage == 100
        assert result.no_percentage == 0
        assert result.winner == "yes"

    def test_unanimous_no(self):
        votes = [{"yes_no_choice": "no"} for _ in range(3)]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 0
        assert result.no_count == 3
        assert result.total_votes == 3
        assert result.yes_percentage == 0
        assert result.no_percentage == 100
        assert result.winner == "no"

    def test_exact_tie(self):
        votes = [
            {"yes_no_choice": "yes"},
            {"yes_no_choice": "no"},
        ]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 1
        assert result.no_count == 1
        assert result.total_votes == 2
        assert result.yes_percentage == 50
        assert result.no_percentage == 50
        assert result.winner == "tie"

    def test_yes_wins_majority(self):
        votes = [
            {"yes_no_choice": "yes"},
            {"yes_no_choice": "yes"},
            {"yes_no_choice": "no"},
        ]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 2
        assert result.no_count == 1
        assert result.total_votes == 3
        assert result.yes_percentage == 67
        assert result.no_percentage == 33
        assert result.winner == "yes"

    def test_abstain_votes_counted_in_total(self):
        votes = [
            {"yes_no_choice": "yes"},
            {"yes_no_choice": "no"},
            {"yes_no_choice": "yes", "is_abstain": True},
        ]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 1
        assert result.no_count == 1
        assert result.abstain_count == 1
        assert result.total_votes == 3
        assert result.winner == "tie"

    def test_all_abstain(self):
        votes = [
            {"yes_no_choice": "yes", "is_abstain": True},
            {"yes_no_choice": "no", "is_abstain": True},
        ]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 0
        assert result.no_count == 0
        assert result.abstain_count == 2
        assert result.total_votes == 2
        assert result.yes_percentage == 0
        assert result.no_percentage == 0
        assert result.winner is None

    def test_abstain_affects_percentages(self):
        """Abstain votes are in the denominator, lowering yes/no percentages."""
        votes = [
            {"yes_no_choice": "yes"},
            {"yes_no_choice": "yes", "is_abstain": True},
        ]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 1
        assert result.abstain_count == 1
        assert result.total_votes == 2
        # 1 yes out of 2 total = 50%, not 100%
        assert result.yes_percentage == 50

    def test_is_abstain_defaults_false(self):
        """Votes without is_abstain field are treated as non-abstain."""
        votes = [{"yes_no_choice": "yes"}]
        result = count_yes_no_votes(votes)
        assert result.yes_count == 1
        assert result.abstain_count == 0

    def test_single_yes_vote(self):
        result = count_yes_no_votes([{"yes_no_choice": "yes"}])
        assert result.yes_count == 1
        assert result.total_votes == 1
        assert result.yes_percentage == 100
        assert result.no_percentage == 0
        assert result.winner == "yes"

    def test_large_poll(self):
        votes = (
            [{"yes_no_choice": "yes"} for _ in range(67)]
            + [{"yes_no_choice": "no"} for _ in range(30)]
            + [{"yes_no_choice": "yes", "is_abstain": True} for _ in range(3)]
        )
        result = count_yes_no_votes(votes)
        assert result.yes_count == 67
        assert result.no_count == 30
        assert result.abstain_count == 3
        assert result.total_votes == 100
        assert result.yes_percentage == 67
        assert result.no_percentage == 30
        assert result.winner == "yes"

    def test_rounding_percentages(self):
        """Percentages round to nearest integer (matching SQL ROUND behavior)."""
        # 1/3 = 33.33... -> 33, 2/3 = 66.66... -> 67
        votes = [
            {"yes_no_choice": "yes"},
            {"yes_no_choice": "no"},
            {"yes_no_choice": "no"},
        ]
        result = count_yes_no_votes(votes)
        assert result.yes_percentage == 33
        assert result.no_percentage == 67
