"""Ranked Preferences — groups with diverse, ordered preferences.

These tests exercise the Instant Runoff Voting (IRV) algorithm with
realistic social scenarios. The focus is on whether the winner feels
"right" to the group, especially in contested races where no option
has a first-choice majority.
"""


class TestMovieNight:
    """A friend group picking a movie to watch together."""

    def test_clear_favorite(self, api, creator_secret, result):
        """Movie night: one film is everyone's top or second pick.

        SCENARIO: Five friends rank movies. "Dune" is everyone's first or
        second choice, even though first-place votes are split.

        EXPECTATION: Dune should win. IRV should surface the consensus
        pick even when first-choice votes are fragmented.
        """
        poll = api.create_poll(
            "What movie should we watch?", "ranked_choice", creator_secret,
            creator_name="Sam",
            options=["Dune", "Barbie", "Oppenheimer", "Spider-Verse"],
        )

        # Dune is universally liked — always first or second
        api.vote(poll["id"], voter_name="Elena", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Barbie", "Oppenheimer", "Spider-Verse"])
        api.vote(poll["id"], voter_name="Marcus", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Oppenheimer", "Spider-Verse", "Barbie"])
        api.vote(poll["id"], voter_name="Priya", vote_type="ranked_choice",
                 ranked_choices=["Barbie", "Dune", "Spider-Verse", "Oppenheimer"])
        api.vote(poll["id"], voter_name="Jordan", vote_type="ranked_choice",
                 ranked_choices=["Oppenheimer", "Dune", "Barbie", "Spider-Verse"])
        api.vote(poll["id"], vote_type="ranked_choice",
                 ranked_choices=["Dune", "Spider-Verse", "Oppenheimer", "Barbie"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.record("rounds", results.get("ranked_choice_rounds", []))
        result.assert_technical("Dune wins", results["ranked_choice_winner"] == "Dune")
        result.mark_social(
            "FAIR",
            "Dune is the consensus pick — universally liked even if not everyone's #1. "
            "IRV correctly identifies the 'least objectionable' choice.",
        )

    def test_condorcet_scenario(self, api, creator_secret, result):
        """Movie night: the group is polarized but there's a compromise option.

        SCENARIO: Half the group loves action, half loves comedy.
        A dramedy (mix) is everyone's second choice. In a simple
        plurality vote, the dramedy would lose. Does IRV find it?

        This is the classic case where ranked choice voting should
        outperform simple majority.
        """
        poll = api.create_poll(
            "Movie genre tonight?", "ranked_choice", creator_secret,
            options=["Action Blockbuster", "Romantic Comedy", "Dramedy"],
        )

        # Action fans (3 voters) — strongly prefer action, dramedy acceptable
        for name in ["Alex", "Blake", "Casey"]:
            api.vote(poll["id"], voter_name=name, vote_type="ranked_choice",
                     ranked_choices=["Action Blockbuster", "Dramedy", "Romantic Comedy"])

        # Comedy fans (3 voters) — strongly prefer comedy, dramedy acceptable
        for name in ["Dana", "Ellis", "Finley"]:
            api.vote(poll["id"], voter_name=name, vote_type="ranked_choice",
                     ranked_choices=["Romantic Comedy", "Dramedy", "Action Blockbuster"])

        # One swing voter prefers dramedy
        api.vote(poll["id"], voter_name="Gray", vote_type="ranked_choice",
                 ranked_choices=["Dramedy", "Romantic Comedy", "Action Blockbuster"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.record("winner", results["ranked_choice_winner"])

        # Dramedy might or might not win depending on elimination order
        winner = results["ranked_choice_winner"]
        result.assert_technical("A winner was determined", winner is not None)

        if winner == "Dramedy":
            result.mark_social(
                "FAIR",
                "Dramedy wins as the compromise — everyone's acceptable choice. "
                "This is IRV at its best: finding the option with broadest support.",
            )
        else:
            result.mark_social(
                "INSIGHT",
                f"IRV picked '{winner}' instead of the compromise 'Dramedy'. "
                "This can happen when the compromise is eliminated first (having "
                "fewest first-place votes). This is a known limitation of IRV — "
                "it doesn't always find the Condorcet winner.",
            )

    def test_spoiler_effect(self, api, creator_secret, result):
        """Movie night: a niche option splits the vote of similar options.

        SCENARIO: Two sci-fi films and one comedy. Sci-fi fans split
        between the two sci-fi options, potentially letting comedy win
        even though sci-fi is more popular overall.

        Does IRV handle vote-splitting better than plurality?
        """
        poll = api.create_poll(
            "Movie pick?", "ranked_choice", creator_secret,
            options=["Dune", "Interstellar", "Mean Girls"],
        )

        # Sci-fi fans split between Dune and Interstellar
        api.vote(poll["id"], voter_name="A", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Interstellar", "Mean Girls"])
        api.vote(poll["id"], voter_name="B", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Interstellar", "Mean Girls"])
        api.vote(poll["id"], voter_name="C", vote_type="ranked_choice",
                 ranked_choices=["Interstellar", "Dune", "Mean Girls"])
        api.vote(poll["id"], voter_name="D", vote_type="ranked_choice",
                 ranked_choices=["Interstellar", "Dune", "Mean Girls"])

        # Comedy fans united behind Mean Girls
        api.vote(poll["id"], voter_name="E", vote_type="ranked_choice",
                 ranked_choices=["Mean Girls", "Interstellar", "Dune"])
        api.vote(poll["id"], voter_name="F", vote_type="ranked_choice",
                 ranked_choices=["Mean Girls", "Dune", "Interstellar"])
        api.vote(poll["id"], voter_name="G", vote_type="ranked_choice",
                 ranked_choices=["Mean Girls", "Interstellar", "Dune"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        winner = results["ranked_choice_winner"]
        result.record("results", results)
        result.record("winner", winner)

        # In plurality, Mean Girls would win (3 vs 2 vs 2). IRV should rescue sci-fi.
        is_scifi = winner in ("Dune", "Interstellar")
        result.assert_technical("A winner exists", winner is not None)
        result.assert_technical(
            "Sci-fi wins (IRV resolves vote splitting)", is_scifi,
            f"Winner was {winner}"
        )
        result.mark_social(
            "FAIR" if is_scifi else "AWKWARD",
            "IRV correctly consolidates the sci-fi vote after eliminating "
            "the weaker sci-fi option. In simple plurality, Mean Girls would "
            "have won despite 4/7 voters preferring sci-fi." if is_scifi else
            f"Surprising result: {winner} won despite sci-fi being more popular overall.",
        )

    def test_partial_rankings(self, api, creator_secret, result):
        """Movie night: some people only rank their top picks.

        SCENARIO: Not everyone ranks all options. Some people only care
        about their top 1-2 choices and don't bother ranking the rest.

        EXPECTATION: Partial ballots should still count. Exhausted ballots
        (all ranked options eliminated) are handled gracefully.
        """
        poll = api.create_poll(
            "Movie?", "ranked_choice", creator_secret,
            options=["A", "B", "C", "D"],
        )

        # Full rankers
        api.vote(poll["id"], voter_name="V1", vote_type="ranked_choice",
                 ranked_choices=["A", "B", "C", "D"])
        api.vote(poll["id"], voter_name="V2", vote_type="ranked_choice",
                 ranked_choices=["B", "A", "D", "C"])

        # Partial rankers — only rank 1-2 options
        api.vote(poll["id"], voter_name="V3", vote_type="ranked_choice",
                 ranked_choices=["C"])
        api.vote(poll["id"], voter_name="V4", vote_type="ranked_choice",
                 ranked_choices=["C", "D"])
        api.vote(poll["id"], voter_name="V5", vote_type="ranked_choice",
                 ranked_choices=["D"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Winner determined", results["ranked_choice_winner"] is not None)
        result.mark_social(
            "FAIR",
            "Partial rankings are a natural expression of preference: 'I only "
            "care about these options.' The system should respect this rather "
            "than forcing voters to rank options they're indifferent about.",
        )

    def test_unanimity(self, api, creator_secret, result):
        """Movie night: everyone agrees on the same first choice.

        SCENARIO: Rare but it happens — everyone wants the same thing.
        Should resolve in round 1 with no eliminations.
        """
        poll = api.create_poll(
            "Movie?", "ranked_choice", creator_secret,
            options=["The Matrix", "Star Wars", "Titanic"],
        )

        for name in ["A", "B", "C", "D", "E"]:
            api.vote(poll["id"], voter_name=name, vote_type="ranked_choice",
                     ranked_choices=["The Matrix", "Star Wars", "Titanic"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        rounds = results.get("ranked_choice_rounds", [])
        max_round = max((r["round_number"] for r in rounds), default=0)

        result.record("results", results)
        result.assert_technical("The Matrix wins", results["ranked_choice_winner"] == "The Matrix")
        result.assert_technical("Decided in round 1", max_round == 1)
        result.mark_social("FAIR", "Unanimous agreement resolved instantly. No wasted rounds.")


class TestTeamRetreat:
    """A team picking a retreat destination with varied preferences."""

    def test_borda_tiebreaker(self, api, creator_secret, result):
        """Team retreat: three-way tie in first-place votes, broken by Borda.

        SCENARIO: 9 team members, 3 destinations. Each destination has
        exactly 3 first-place votes. The Borda count (positional scoring)
        breaks the tie by considering all ranking positions.

        EXPECTATION: The destination with the best overall rankings wins,
        not just the one with the most first-place votes.
        """
        poll = api.create_poll(
            "Team retreat destination?", "ranked_choice", creator_secret,
            options=["Lake House", "Mountain Lodge", "Beach Resort"],
        )

        # 3 voters: Lake > Mountain > Beach
        for i in range(3):
            api.vote(poll["id"], voter_name=f"L{i}", vote_type="ranked_choice",
                     ranked_choices=["Lake House", "Mountain Lodge", "Beach Resort"])

        # 3 voters: Mountain > Lake > Beach (Mountain has better 2nd-place support)
        for i in range(3):
            api.vote(poll["id"], voter_name=f"M{i}", vote_type="ranked_choice",
                     ranked_choices=["Mountain Lodge", "Lake House", "Beach Resort"])

        # 3 voters: Beach > Mountain > Lake
        for i in range(3):
            api.vote(poll["id"], voter_name=f"B{i}", vote_type="ranked_choice",
                     ranked_choices=["Beach Resort", "Mountain Lodge", "Lake House"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        winner = results["ranked_choice_winner"]
        rounds = results.get("ranked_choice_rounds", [])
        used_borda = any(r.get("tie_broken_by_borda") for r in rounds)

        result.record("results", results)
        result.record("winner", winner)
        result.record("used_borda", used_borda)
        result.assert_technical("Winner determined", winner is not None)

        # Mountain Lodge should win: it's 1st for 3, 2nd for 6 (best overall)
        result.assert_technical(
            "Mountain Lodge wins (best overall ranking)",
            winner == "Mountain Lodge",
            f"Actual winner: {winner}",
        )
        result.mark_social(
            "FAIR" if winner == "Mountain Lodge" else "AWKWARD",
            "Mountain Lodge is ranked 1st or 2nd by everyone — the Borda "
            "tiebreaker correctly identifies it as the most broadly acceptable choice."
            if winner == "Mountain Lodge" else
            f"Unexpected winner '{winner}' despite Mountain Lodge having the broadest support.",
        )
