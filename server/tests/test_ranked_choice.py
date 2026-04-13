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


def _make_tiered_votes(tier_lists: list[list[list[str]]]) -> list[dict]:
    """Helper to create vote dicts from tiered ballots."""
    return [{"ranked_choice_tiers": t} for t in tier_lists]


class TestEqualRankings:
    """Tests for the 'duplicate vote' method of handling equal rankings.

    When a ballot's highest-ranked active tier contains multiple options,
    each option in that tier receives a full vote from that ballot.
    """

    def test_simple_tie_at_top_gives_both_full_votes(self):
        # A single ballot with A and B tied at top gives both a full vote.
        # C gets 0. With 1 ballot total, majority threshold = 1.
        # But A and B both have 1 vote (no unique leader), so IRV continues.
        # C eliminated first, then Borda breaks A-B tie alphabetically.
        votes = _make_tiered_votes([
            [["A", "B"], ["C"]],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        # Round 1: A=1, B=1, C=0. No unique leader. Eliminate C (last place).
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 0, True),
        ])
        # Round 2: A=1, B=1 still tied. Borda tied (both rank 0). Alphabetical
        # eliminates B (last alphabetically).
        # Round 3: only A remains -> winner.
        assert result.winner == "A"

    def test_tie_vote_duplication_across_multiple_ballots(self):
        # 3 ballots, each with A=B tied at top, C third.
        # Round 1: A=3, B=3, C=0 (duplicate votes). No unique leader.
        # Eliminate C, then Borda/alpha breaks A-B tie.
        votes = _make_tiered_votes([
            [["A", "B"], ["C"]],
            [["A", "B"], ["C"]],
            [["A", "B"], ["C"]],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        _assert_round(result, 0, [
            ("A", 3, False),
            ("B", 3, False),
            ("C", 0, True),
        ])
        assert result.winner == "A"

    def test_tie_loses_when_another_candidate_has_strict_majority(self):
        # 5 ballots: 3 put (A,B) tied at top, 2 put C alone at top.
        # Round 1: A=3, B=3, C=2. A and B are both leaders at 3.
        # Threshold = 3 (majority of 5). A&B both exceed it but no unique leader.
        # Eliminate C (lowest). Then A=3, B=3. Borda/alpha picks winner.
        votes = _make_tiered_votes([
            [["A", "B"]],
            [["A", "B"]],
            [["A", "B"]],
            [["C"]],
            [["C"]],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        _assert_round(result, 0, [
            ("A", 3, False),
            ("B", 3, False),
            ("C", 2, True),
        ])
        # After C elimination: A=3, B=3 (still duplicated from (A,B) ballots).
        # Borda tied, alpha eliminates B. Then A wins alone.
        assert result.winner == "A"

    def test_eliminating_one_tied_option_does_not_transfer_to_partner(self):
        # Key insight: eliminating one member of a tied tier does NOT
        # transfer votes to the partner (partner already had the vote).
        # Ballot: (A,B), then C. If A eliminated, B stays with its existing vote.
        votes = _make_tiered_votes([
            [["A", "B"], ["C"]],
            [["A", "B"], ["C"]],
            [["C"], ["A"], ["B"]],
            [["C"], ["A"], ["B"]],
            [["C"], ["A"], ["B"]],
        ])
        # Round 1: A=2, B=2, C=3. C leads with 3/5, threshold=3, UNIQUE leader.
        # C wins immediately.
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        assert result.winner == "C"
        _assert_round(result, 0, [
            ("C", 3, False),
            ("A", 2, False),
            ("B", 2, False),
        ])
        assert result.total_rounds == 1

    def test_strict_majority_with_unique_leader_wins_immediately(self):
        # Voter 1: A tied with B. Voters 2-5: A first.
        # Round 1: A=5, B=1. A has 5/5 = unique majority. Winner A.
        votes = _make_tiered_votes([
            [["A", "B"]],
            [["A"], ["B"]],
            [["A"], ["B"]],
            [["A"], ["B"]],
            [["A"], ["B"]],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        assert result.winner == "A"
        assert result.total_rounds == 1
        _assert_round(result, 0, [
            ("A", 5, False),
            ("B", 1, False),
        ])

    def test_three_way_tie_at_top(self):
        # One ballot with A=B=C all tied. All three get 1 vote from it.
        # Another ballot with D alone. Total: A=1, B=1, C=1, D=1.
        votes = _make_tiered_votes([
            [["A", "B", "C"]],
            [["D"]],
        ])
        result = calculate_ranked_choice_winner(
            votes, ["A", "B", "C", "D"]
        )
        # All tied at 1 vote. Borda:
        # Ballot 1: A,B,C at tier 0 (rank 0) -> 4-0=4 each, D unranked -> 0
        # Ballot 2: D at tier 0 -> 4, others 0
        # Candidate totals: A=4, B=4, C=4, D=4. All tied.
        # Alphabetically last (D) is eliminated first.
        _assert_round(result, 0, [
            ("A", 1, False),
            ("B", 1, False),
            ("C", 1, False),
            ("D", 1, True),
        ])

    def test_tier_drops_to_next_when_all_members_eliminated(self):
        # Ballot: (A,B), (C,D). After A and B both eliminated, C and D
        # should each get 1 vote from this ballot.
        votes = _make_tiered_votes([
            [["A", "B"], ["C", "D"]],
            [["A"], ["B"], ["C"], ["D"]],  # prefers A
            [["B"], ["A"], ["C"], ["D"]],  # prefers B
        ])
        result = calculate_ranked_choice_winner(
            votes, ["A", "B", "C", "D"]
        )
        # Round 1: A=2 (ballot 1 tier 0 + ballot 2), B=2 (ballot 1 tier 0 + ballot 3),
        # C=0, D=0. Eliminate D (last alpha among 0-vote).
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 2, False),
            ("C", 0, False),
            ("D", 0, True),
        ])

    def test_mixed_tiered_and_flat_ballots(self):
        # Mixing flat ranked_choices and tiered ranked_choice_tiers in the
        # same election. Flat ballots are treated as singleton tiers.
        votes = [
            {"ranked_choices": ["A", "B", "C"]},
            {"ranked_choices": ["B", "A", "C"]},
            {"ranked_choice_tiers": [["A", "B"], ["C"]]},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        # Round 1: A=2 (v1 + v3), B=2 (v2 + v3), C=0. Eliminate C (alpha last).
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 2, False),
            ("C", 0, True),
        ])

    def test_all_equal_ballot_exhausts_after_eliminations(self):
        # A ballot with everything tied at one level supplies a vote to every
        # active candidate in every round until it's exhausted. Verify the
        # algorithm terminates and counts correctly.
        votes = _make_tiered_votes([
            [["A", "B", "C"]],
            [["A"]],
            [["B"]],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B", "C"])
        # Round 1: A=2, B=2, C=1. Eliminate C (lowest).
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 2, False),
            ("C", 1, True),
        ])
        # Round 2: tier 0 of ballot 1 still contains A and B (both active),
        # so A=2, B=2. Still tied. Borda tiebreaker, alpha eliminates B.
        _assert_round(result, 1, [
            ("A", 2, False),
            ("B", 2, True),
        ])
        assert result.winner == "A"

    def test_tied_ranking_abstain_excluded(self):
        votes = [
            {"ranked_choice_tiers": [["A", "B"]], "is_abstain": True},
            {"ranked_choice_tiers": [["A"]]},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        assert result.winner == "A"

    def test_empty_tiers_filtered(self):
        votes = [
            {"ranked_choice_tiers": [[], ["A"], ["", "B"]]},
            {"ranked_choice_tiers": [["A"]]},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        # Ballot 1 cleans to [["A"], ["B"]] -> prefers A. Ballot 2 -> A.
        # A=2, B=0. A wins.
        assert result.winner == "A"

    def test_malformed_tiers_returns_no_winner(self):
        votes = [
            {"ranked_choice_tiers": "not a list"},
            {"ranked_choice_tiers": [[], []]},
        ]
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        assert result.winner is None
        assert result.total_rounds == 0

    def test_tiered_ballot_with_later_tier_tie(self):
        # Ballot with distinct first choice but tied second tier. The tie at
        # the second tier only matters if the first-choice option is eliminated.
        votes = _make_tiered_votes([
            [["A"], ["B", "C"], ["D"]],
            [["A"], ["B", "C"], ["D"]],
            [["D"]],
            [["D"]],
        ])
        result = calculate_ranked_choice_winner(
            votes, ["A", "B", "C", "D"]
        )
        # Round 1: A=2, D=2, B=0, C=0. No winner (A, D tied, threshold=3).
        # Min=0 (B, C). Borda tiebreak across {B, C}:
        #   Ballot 1 (4 cands): B at rank 1 -> 3, C at rank 1 -> 3
        #   Ballot 2: same. Totals: B=6, C=6. Tied, alpha -> C eliminated.
        _assert_round(result, 0, [
            ("A", 2, False),
            ("D", 2, False),
            ("B", 0, False),
            ("C", 0, True),
        ])

    def test_duplicate_method_documentation(self):
        # Documentation-as-test: 2 voters, A=B tied.
        # Vote counts: A=2, B=2 (duplicated), total vote tally = 4 > ballots = 2.
        # This is intentional: the duplicate-vote method means both tied options
        # receive full credit from each voter.
        votes = _make_tiered_votes([
            [["A", "B"]],
            [["A", "B"]],
        ])
        result = calculate_ranked_choice_winner(votes, ["A", "B"])
        # A=2, B=2 - tied at max. No unique leader.
        _assert_round(result, 0, [
            ("A", 2, False),
            ("B", 2, True),  # B eliminated alphabetically after Borda tie
        ])
        assert result.winner == "A"


class TestBordaWithTiers:
    """Borda count with tiered ballots uses standard competition ranking."""

    def test_standard_competition_ranking(self):
        # Ballot 1: [A], [B, C], [D] — ranks are 0, 1, 1, 3 (not 0, 1, 1, 2).
        #   With 7 total candidates: A=7, B=6, C=6, D=4 (= 7 - 3).
        # Ballots 2-4: E, F, G (all singleton, to spread votes so none reaches
        # majority and B/C/D get pushed into Borda tiebreak).
        votes = _make_tiered_votes([
            [["A"], ["B", "C"], ["D"]],
            [["E"]],
            [["F"]],
            [["G"]],
        ])
        result = calculate_ranked_choice_winner(
            votes, ["A", "B", "C", "D", "E", "F", "G"]
        )
        # Round 1: A=1, E=1, F=1, G=1, B=C=D=0.
        # Threshold=3 (4//2+1). Max=1 < 3. Eliminate: min=0, tied {B,C,D}.
        # Borda across tied {B,C,D} from ballot 1 only (no other ballot ranks them):
        #   B=6, C=6, D=4. Min = 4 -> D eliminated.
        round_0 = result.rounds[0]
        d_entry = next(e for e in round_0 if e.option_name == "D")
        assert d_entry.is_eliminated is True
        assert d_entry.borda_score == 4
        assert d_entry.tie_broken_by_borda is True
        b_entry = next(e for e in round_0 if e.option_name == "B")
        assert b_entry.borda_score == 6
        assert b_entry.tie_broken_by_borda is True
        c_entry = next(e for e in round_0 if e.option_name == "C")
        assert c_entry.borda_score == 6
        assert c_entry.tie_broken_by_borda is True
