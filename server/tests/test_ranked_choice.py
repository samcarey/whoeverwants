"""Tests for ranked choice (IRV) vote counting algorithm.

Test scenarios ported from the JavaScript test suites in:
- tests/__tests__/ranked-choice/basic-scenarios.test.js
- tests/__tests__/ranked-choice/borda-count-tie-breaking.test.js
- tests/__tests__/ranked-choice/edge-cases.test.js
- tests/__tests__/voting-algorithms/irv-incomplete-ballots.test.js
"""

from algorithms.ranked_choice import RankedChoiceResult, RoundEntry, calculate_ranked_choice_winner


def _make_votes(rankings: list[list[str]]) -> list[dict]:
    """Helper to create vote dicts from ranking lists."""
    return [{"ranked_choices": r} for r in rankings]


def _assert_round(result: RankedChoiceResult, round_idx: int, expected: list[tuple]):
    """Assert round entries match expected (option_name, vote_count, is_eliminated)."""
    round_entries = result.rounds[round_idx]
    actual = [(e.option_name, e.vote_count, e.is_eliminated) for e in round_entries]
    assert actual == expected, f"Round {round_idx + 1}: {actual} != {expected}"


class TestImmediateWinners:
    def test_majority_in_first_round(self):
        votes = _make_votes([
            ["A", "B", "C"],
            ["A", "C", "B"],
            ["A", "B", "C"],
            ["B", "A", "C"],
            ["C", "A", "B"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "A"
        assert result.total_rounds == 1
        _assert_round(result, 0, [
            ("A", 3, False),
            ("B", 1, False),
            ("C", 1, False),
        ])

    def test_no_majority_triggers_elimination(self):
        votes = _make_votes([
            ["A", "B", "C"],
            ["A", "C", "B"],
            ["B", "A", "C"],
            ["C", "A", "B"],
            ["C", "B", "A"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "A"
        assert result.total_rounds == 2
        _assert_round(result, 0, [
            ("A", 2, False),
            ("C", 2, False),
            ("B", 1, True),
        ])
        _assert_round(result, 1, [
            ("A", 3, False),
            ("C", 2, False),
        ])


class TestSequentialElimination:
    def test_eliminate_one_by_one(self):
        votes = _make_votes([
            ["A", "B", "C", "D"],
            ["A", "C", "B", "D"],
            ["B", "A", "C", "D"],
            ["C", "B", "A", "D"],
            ["D", "A", "B", "C"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 1, True),
        ])
        _assert_round(result, 1, [
            ("A", 3, False),
            ("B", 1, False),
            ("C", 1, False),
        ])

    def test_complex_redistribution(self):
        votes = _make_votes([
            ["A", "D", "B", "C"],
            ["B", "D", "A", "C"],
            ["C", "D", "A", "B"],
            ["D", "A", "B", "C"],
            ["D", "B", "A", "C"],
            ["D", "C", "B", "A"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "D"
        _assert_round(result, 0, [
            ("D", 3, False),
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, True),
        ])
        _assert_round(result, 1, [
            ("D", 4, False),
            ("A", 1, False),
            ("B", 1, False),
        ])


class TestVoteTransfer:
    def test_transfer_to_second_choice(self):
        votes = _make_votes([
            ["A", "B", "C"],
            ["B", "C", "A"],
            ["C", "A", "B"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, True),
        ])
        _assert_round(result, 1, [
            ("A", 2, False),
            ("B", 1, False),
        ])

    def test_skip_eliminated_candidates(self):
        votes = _make_votes([
            ["A", "B", "C", "D"],
            ["C", "A", "B", "D"],
            ["D", "C", "A", "B"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "C"
        _assert_round(result, 0, [
            ("A", 1, False),
            ("C", 1, False),
            ("D", 1, False),
            ("B", 0, True),
        ])
        _assert_round(result, 1, [
            ("A", 1, False),
            ("C", 1, False),
            ("D", 1, True),
        ])
        _assert_round(result, 2, [
            ("C", 2, False),
            ("A", 1, False),
        ])


class TestBordaTieBreaking:
    def test_lowest_borda_eliminated(self):
        votes = _make_votes([
            ["A", "C", "D", "B"],
            ["B", "C", "A", "D"],
            ["C", "A", "B", "D"],
            ["D", "A", "C", "B"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "A"
        # Round 1: all tied at 1 vote. Borda: A=12, B=8, C=12, D=8. D eliminated (alpha last among lowest)
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 1, True),
        ])

    def test_borda_comeback_scenario(self):
        votes = _make_votes([
            ["A", "B", "C", "D", "E"],
            ["A", "C", "B", "D", "E"],
            ["B", "C", "A", "D", "E"],
            ["C", "B", "A", "D", "E"],
            ["D", "C", "B", "A", "E"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D", "E"])
        assert result.winner == "C"
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 1, False),
            ("E", 0, True),
        ])

    def test_incomplete_ballots_borda(self):
        votes = _make_votes([
            ["A", "B"],
            ["B", "C"],
            ["C", "A"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "A"
        # All tied at 1 vote, Borda scores also tied -> C eliminated (alpha last)
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, True),
        ])

    def test_zero_vote_candidates_borda(self):
        votes = _make_votes([
            ["A", "B", "C", "D", "E"],
            ["B", "C", "A", "D", "E"],
            ["C", "A", "B", "D", "E"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D", "E"])
        assert result.winner == "A"
        # D and E have 0 votes. E has lower Borda score -> eliminated
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 0, False),
            ("E", 0, True),
        ])

    def test_alphabetical_tiebreak_when_borda_tied(self):
        votes = _make_votes([
            ["A", "B", "C"],
            ["B", "A", "C"],
            ["C", "A", "B"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        # A: Borda 4+2=6(err, let me recalc). 3 candidates. A: 3+2=5? No.
        # With 3 total candidates: 1st=3pts, 2nd=2pts, 3rd=1pt
        # Vote 1 [A,B,C]: A=3, B=2, C=1
        # Vote 2 [B,A,C]: B=3, A=2, C=1
        # Vote 3 [C,A,B]: C=3, A=2, B=1
        # Borda: A=3+2+2=7, B=2+3+1=6, C=1+1+3=5 -> C eliminated (lowest Borda among tied)
        # But all are tied at 1 vote. C has lowest Borda (5), so C is eliminated.
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, True),
        ])
        # Verify Borda scores stored
        round_1 = result.rounds[0]
        c_entry = next(e for e in round_1 if e.option_name == "C")
        assert c_entry.borda_score == 5
        assert c_entry.tie_broken_by_borda is True

    def test_perfect_borda_tie_uses_alphabetical(self):
        votes = _make_votes([
            ["A", "B"],
            ["B", "A"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, True),
        ])


class TestEdgeCases:
    def test_no_votes(self):
        result = calculate_ranked_choice_winner([], ["A", "B", "C"])
        assert result.winner is None
        assert result.total_rounds == 0
        assert result.rounds == []

    def test_single_vote(self):
        votes = _make_votes([["A", "B", "C"]])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "A"
        assert result.total_rounds == 1
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 0, False),
            ("C", 0, False),
        ])

    def test_two_candidates_one_vote_each(self):
        votes = _make_votes([["A", "B"], ["B", "A"]])
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        assert result.winner == "A"

    def test_single_candidate_ranked(self):
        votes = _make_votes([["A"], ["B", "A"], ["C", "B", "A"]])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "B"
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, True),
        ])
        _assert_round(result, 1, [
            ("B", 2, False),
            ("A", 1, False),
        ])

    def test_all_abstain(self):
        votes = [
            {"ranked_choices": ["A", "B"], "is_abstain": True},
            {"ranked_choices": ["B", "A"], "is_abstain": True},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        assert result.winner is None
        assert result.total_rounds == 0

    def test_mixed_abstain_and_real(self):
        votes = [
            {"ranked_choices": ["A", "B", "C"]},
            {"ranked_choices": ["B", "A", "C"], "is_abstain": True},
            {"ranked_choices": ["C", "A", "B"]},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        # Only 2 non-abstain ballots: A=1, C=1. Tied, C eliminated (alpha last)
        assert result.winner == "A"

    def test_50_50_split(self):
        votes = _make_votes([
            ["A", "C", "B"],
            ["A", "B", "C"],
            ["B", "C", "A"],
            ["B", "A", "C"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 2, False),
            ("C", 0, True),
        ])

    def test_exhausted_ballots_reduce_threshold(self):
        """When ballots become exhausted, majority threshold decreases."""
        votes = _make_votes([
            ["A", "B"],
            ["A", "C"],
            ["B"],
            ["C"],
            ["D", "A"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "A"

    def test_many_candidates(self):
        votes = _make_votes([
            ["A", "B", "C", "D", "E", "F", "G"],
            ["A", "C", "B", "D", "E", "F", "G"],
            ["B", "A", "C", "D", "E", "F", "G"],
            ["C", "B", "A", "D", "E", "F", "G"],
        ])
        result = calculate_ranked_choice_winner(
            votes, ["A", "B", "C", "D", "E", "F", "G"]
        )
        assert result.winner == "A"
        # G eliminated first (lowest Borda among 0-vote candidates)
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 0, False),
            ("E", 0, False),
            ("F", 0, False),
            ("G", 0, True),
        ])

    def test_null_and_empty_choices_filtered(self):
        votes = [
            {"ranked_choices": ["A", "", "B"]},
            {"ranked_choices": None},
            {"ranked_choices": []},
            {"ranked_choices": ["B", "A"]},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        # Only 2 valid ballots: A=1, B=1
        assert result.winner == "A"

    def test_mixed_complete_and_incomplete_ballots(self):
        votes = _make_votes([
            ["A", "B"],
            ["A", "C", "D"],
            ["B", "A"],
            ["C"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 0, True),
        ])


class TestMultiRoundBorda:
    def test_six_candidates_systematic_elimination(self):
        votes = _make_votes([
            ["A", "B", "C", "D", "E", "F"],
            ["A", "C", "B", "D", "E", "F"],
            ["B", "A", "C", "D", "E", "F"],
            ["C", "A", "B", "D", "E", "F"],
            ["D", "A", "B", "C", "E", "F"],
            ["E", "A", "B", "C", "D", "F"],
        ])
        result = calculate_ranked_choice_winner(
            votes, ["A", "B", "C", "D", "E", "F"]
        )
        assert result.winner == "A"
        # F eliminated first (0 votes, lowest Borda)
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 1, False),
            ("E", 1, False),
            ("F", 0, True),
        ])


class TestDeterminism:
    def test_same_input_same_output(self):
        votes = _make_votes([
            ["A", "B", "C"],
            ["B", "C", "A"],
            ["C", "A", "B"],
        ])
        results = [
            calculate_ranked_choice_winner(votes, ["A", "B", "C"])
            for _ in range(5)
        ]
        assert all(r.winner == results[0].winner for r in results)
        assert all(r.total_rounds == results[0].total_rounds for r in results)


class TestStrategicVoting:
    def test_strategic_ranking(self):
        votes = _make_votes([
            ["A", "D", "C", "B"],
            ["A", "D", "C", "B"],
            ["B", "C", "D", "A"],
            ["C", "A", "B", "D"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C", "D"])
        assert result.winner == "A"
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 0, True),
        ])


class TestReverseOrder:
    def test_reverse_voting_patterns(self):
        votes = _make_votes([
            ["A", "B", "C"],
            ["C", "B", "A"],
            ["B", "A", "C"],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        # Borda: A=3+1+2=6, B=2+2+3=7, C=1+3+1=5. C eliminated (lowest Borda)
        assert result.winner == "B"
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, True),
        ])
        _assert_round(result, 1, [
            ("B", 2, False),
            ("A", 1, False),
        ])
