"""Ranked Preferences — groups with diverse, ordered preferences.

Exercises the Instant Runoff Voting (IRV) algorithm with Borda tiebreak in
realistic social scenarios. Focus: does the winner feel "right" to the
group, especially when no option has a first-choice majority?
"""


class TestMovieNight:
    """A friend group picking a movie to watch together."""

    def test_clear_favorite(self, api, result):
        """Movie night: one film is everyone's top or second pick.

        SCENARIO: Five friends rank movies. "Dune" is everyone's first or
        second choice, even though first-place votes are split.

        EXPECTATION: Dune wins. IRV surfaces the consensus pick even when
        first-choice votes are fragmented.
        """
        poll = api.create_poll(
            "What movie should we watch?", "ranked_choice", creator_name="Sam",
            options=["Dune", "Barbie", "Oppenheimer", "Spider-Verse"],
        )

        api.vote(poll["id"], "Elena", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Barbie", "Oppenheimer", "Spider-Verse"])
        api.vote(poll["id"], "Marcus", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Oppenheimer", "Spider-Verse", "Barbie"])
        api.vote(poll["id"], "Priya", vote_type="ranked_choice",
                 ranked_choices=["Barbie", "Dune", "Spider-Verse", "Oppenheimer"])
        api.vote(poll["id"], "Jordan", vote_type="ranked_choice",
                 ranked_choices=["Oppenheimer", "Dune", "Barbie", "Spider-Verse"])
        api.vote(poll["id"], "Nia", vote_type="ranked_choice",
                 ranked_choices=["Dune", "Spider-Verse", "Oppenheimer", "Barbie"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.record("rounds", results.get("ranked_choice_rounds", []))
        result.assert_technical("Dune wins", results["ranked_choice_winner"] == "Dune")
        result.mark_social(
            "FAIR",
            "Dune is the consensus pick — universally liked even if not "
            "everyone's #1. IRV correctly identifies the least-objectionable "
            "choice.",
        )

    def test_condorcet_scenario(self, api, result):
        """Movie night: polarized group with a compromise option.

        SCENARIO: Half love action, half love comedy. A dramedy is everyone's
        second choice. In plurality the dramedy loses. Does IRV find it?
        """
        poll = api.create_poll(
            "Movie genre tonight?", "ranked_choice", creator_name="Host",
            options=["Action Blockbuster", "Romantic Comedy", "Dramedy"],
        )

        for name in ["Alex", "Blake", "Casey"]:
            api.vote(poll["id"], name, vote_type="ranked_choice",
                     ranked_choices=["Action Blockbuster", "Dramedy", "Romantic Comedy"])
        for name in ["Dana", "Ellis", "Finley"]:
            api.vote(poll["id"], name, vote_type="ranked_choice",
                     ranked_choices=["Romantic Comedy", "Dramedy", "Action Blockbuster"])
        api.vote(poll["id"], "Gray", vote_type="ranked_choice",
                 ranked_choices=["Dramedy", "Romantic Comedy", "Action Blockbuster"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        winner = results["ranked_choice_winner"]

        result.record("results", results)
        result.record("winner", winner)
        result.assert_technical("A winner was determined", winner is not None)

        if winner == "Dramedy":
            result.mark_social(
                "FAIR",
                "Dramedy wins as the compromise — everyone's acceptable choice. "
                "IRV at its best.",
            )
        else:
            result.mark_social(
                "INSIGHT",
                f"IRV picked '{winner}' instead of the compromise 'Dramedy', "
                "which was eliminated first for having the fewest first-place "
                "votes. A known IRV limitation: it doesn't always find the "
                "Condorcet winner. For a group that wanted the 'everyone's "
                "okay with it' option, this can feel wrong — worth a UX note "
                "explaining why the compromise lost.",
            )

    def test_spoiler_effect(self, api, result):
        """Movie night: a niche option splits the vote of similar options.

        SCENARIO: Two sci-fi films and one comedy. Sci-fi fans split between
        the two, potentially letting comedy win despite sci-fi being more
        popular overall. Does IRV handle vote-splitting better than plurality?
        """
        poll = api.create_poll(
            "Movie pick?", "ranked_choice", creator_name="Host",
            options=["Dune", "Interstellar", "Mean Girls"],
        )

        api.vote(poll["id"], "Ada", vote_type="ranked_choice", ranked_choices=["Dune", "Interstellar", "Mean Girls"])
        api.vote(poll["id"], "Ben", vote_type="ranked_choice", ranked_choices=["Dune", "Interstellar", "Mean Girls"])
        api.vote(poll["id"], "Cy", vote_type="ranked_choice", ranked_choices=["Interstellar", "Dune", "Mean Girls"])
        api.vote(poll["id"], "Di", vote_type="ranked_choice", ranked_choices=["Interstellar", "Dune", "Mean Girls"])
        api.vote(poll["id"], "Ed", vote_type="ranked_choice", ranked_choices=["Mean Girls", "Interstellar", "Dune"])
        api.vote(poll["id"], "Fi", vote_type="ranked_choice", ranked_choices=["Mean Girls", "Dune", "Interstellar"])
        api.vote(poll["id"], "Gi", vote_type="ranked_choice", ranked_choices=["Mean Girls", "Interstellar", "Dune"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        winner = results["ranked_choice_winner"]
        is_scifi = winner in ("Dune", "Interstellar")

        result.record("results", results)
        result.record("winner", winner)
        result.assert_technical("A winner exists", winner is not None)
        result.assert_technical("Sci-fi wins (IRV resolves vote splitting)", is_scifi, f"Winner was {winner}")
        result.mark_social(
            "FAIR" if is_scifi else "AWKWARD",
            "IRV consolidates the sci-fi vote after eliminating the weaker "
            "sci-fi option. In plurality, Mean Girls would have won despite "
            "4/7 preferring sci-fi." if is_scifi else
            f"Surprising: {winner} won despite sci-fi being more popular overall.",
        )

    def test_partial_rankings(self, api, result):
        """Movie night: some people only rank their top picks.

        EXPECTATION: Partial ballots still count; exhausted ballots (all ranked
        options eliminated) are handled gracefully.
        """
        poll = api.create_poll(
            "Movie?", "ranked_choice", creator_name="Host", options=["A", "B", "C", "D"],
        )

        api.vote(poll["id"], "V1", vote_type="ranked_choice", ranked_choices=["A", "B", "C", "D"])
        api.vote(poll["id"], "V2", vote_type="ranked_choice", ranked_choices=["B", "A", "D", "C"])
        api.vote(poll["id"], "V3", vote_type="ranked_choice", ranked_choices=["C"])
        api.vote(poll["id"], "V4", vote_type="ranked_choice", ranked_choices=["C", "D"])
        api.vote(poll["id"], "V5", vote_type="ranked_choice", ranked_choices=["D"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Winner determined", results["ranked_choice_winner"] is not None)
        result.mark_social(
            "FAIR",
            "Partial rankings express 'I only care about these options.' The "
            "system respects this rather than forcing voters to rank "
            "indifferent options.",
        )

    def test_unanimity(self, api, result):
        """Movie night: everyone agrees on the same first choice.

        SCENARIO: Rare but it happens. Should resolve in round 1.
        """
        poll = api.create_poll(
            "Movie?", "ranked_choice", creator_name="Host",
            options=["The Matrix", "Star Wars", "Titanic"],
        )

        for name in ["A", "B", "C", "D", "E"]:
            api.vote(poll["id"], name, vote_type="ranked_choice",
                     ranked_choices=["The Matrix", "Star Wars", "Titanic"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        rounds = results.get("ranked_choice_rounds", [])
        max_round = max((r["round_number"] for r in rounds), default=0)

        result.record("results", results)
        result.assert_technical("The Matrix wins", results["ranked_choice_winner"] == "The Matrix")
        result.assert_technical("Decided in round 1", max_round == 1)
        result.mark_social("FAIR", "Unanimous agreement resolved instantly. No wasted rounds.")


class TestTeamRetreat:
    """A team picking a retreat destination with varied preferences."""

    def test_borda_tiebreaker(self, api, result):
        """Team retreat: three-way tie in first-place votes, broken by Borda.

        SCENARIO: 9 members, 3 destinations, each with exactly 3 first-place
        votes. The Borda count (positional scoring) breaks the tie.

        EXPECTATION: The destination with the best overall rankings wins, not
        just the one with the most first-place votes.
        """
        poll = api.create_poll(
            "Team retreat destination?", "ranked_choice", creator_name="Lead",
            options=["Lake House", "Mountain Lodge", "Beach Resort"],
        )

        for i in range(3):
            api.vote(poll["id"], f"Lakeperson{i}", vote_type="ranked_choice",
                     ranked_choices=["Lake House", "Mountain Lodge", "Beach Resort"])
        for i in range(3):
            api.vote(poll["id"], f"Mountaineer{i}", vote_type="ranked_choice",
                     ranked_choices=["Mountain Lodge", "Lake House", "Beach Resort"])
        for i in range(3):
            api.vote(poll["id"], f"Beachgoer{i}", vote_type="ranked_choice",
                     ranked_choices=["Beach Resort", "Mountain Lodge", "Lake House"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        winner = results["ranked_choice_winner"]
        rounds = results.get("ranked_choice_rounds", [])
        used_borda = any(r.get("tie_broken_by_borda") for r in rounds)

        result.record("results", results)
        result.record("winner", winner)
        result.record("used_borda", used_borda)
        result.assert_technical("Winner determined", winner is not None)
        result.assert_technical(
            "Mountain Lodge wins (best overall ranking)",
            winner == "Mountain Lodge", f"Actual winner: {winner}",
        )
        result.mark_social(
            "FAIR" if winner == "Mountain Lodge" else "AWKWARD",
            "Mountain Lodge is ranked 1st or 2nd by everyone — the Borda "
            "tiebreaker correctly identifies the most broadly acceptable choice."
            if winner == "Mountain Lodge" else
            f"Unexpected winner '{winner}' despite Mountain Lodge's broad support.",
        )

    def test_ten_option_ranked_choice(self, api, result):
        """Large ranked choice: 10 cuisines, 8 voters.

        SCENARIO: A group has too many ideas. Tests IRV at higher option counts.
        """
        options = ["Italian", "Thai", "Mexican", "Indian", "Chinese",
                   "Japanese", "Korean", "Ethiopian", "Greek", "American"]
        poll = api.create_poll(
            "Restaurant for team dinner?", "ranked_choice", creator_name="Lead",
            options=options,
        )

        rankings = [
            ["Italian", "Thai", "Mexican", "Indian", "Chinese"],
            ["Thai", "Japanese", "Korean", "Italian", "Ethiopian"],
            ["Mexican", "Italian", "American", "Thai", "Greek"],
            ["Indian", "Thai", "Italian", "Ethiopian", "Korean"],
            ["Thai", "Italian", "Japanese", "Chinese", "Greek"],
            ["Korean", "Japanese", "Thai", "Italian", "Chinese"],
            ["Ethiopian", "Indian", "Thai", "Italian", "Greek"],
            ["American", "Mexican", "Italian", "Thai", "Chinese"],
        ]
        for i, ranking in enumerate(rankings):
            api.vote(poll["id"], f"Diner{i+1}", vote_type="ranked_choice", ranked_choices=ranking)

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        rounds = results.get("ranked_choice_rounds", [])
        max_round = max((r["round_number"] for r in rounds), default=0)

        result.record("results", results)
        result.record("winner", results["ranked_choice_winner"])
        result.record("num_rounds", max_round)
        result.assert_technical("Winner determined", results["ranked_choice_winner"] is not None)
        result.assert_technical("Multiple elimination rounds", max_round >= 2)
        result.mark_social(
            "INSIGHT",
            f"With 10 options and 8 voters, IRV took {max_round} rounds to pick "
            f"'{results['ranked_choice_winner']}'. The winner has broad "
            "second/third-choice support — the whole point of ranked choice. "
            "But 10 drag-to-rank options on a phone is a lot of friction; this "
            "is where collecting suggestions first (then ranking a shortlist) "
            "keeps the ballot manageable.",
        )
