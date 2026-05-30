"""Casual Decisions — friend groups making low-stakes choices.

The most common use case: a group of friends or coworkers making a simple
decision together. Focus: do results feel natural, and does the
*name-or-alias required* model (every voter is visible to the group)
produce reasonable dynamics?
"""


# ── Yes/No: Simple group question ─────────────────────────────────────────────


class TestFridayDrinks:
    """A coworker asks if people want to go for drinks after work."""

    def test_clear_majority_yes(self, api, result):
        """Friday drinks: 4 yes, 1 no, 1 abstain.

        SCENARIO: Marcus asks "Drinks after work Friday?" Four coworkers say
        yes, one says no, one abstains (acknowledging the poll without
        committing). Everyone supplies a name — the app no longer supports a
        hidden ballot, so the lone dissenter ("Quinn") is visible to the group.

        EXPECTATION: Clear yes wins. The abstainer shouldn't dilute the
        percentage away from a decisive read.
        """
        poll = api.create_poll("Drinks after work Friday?", "yes_no", creator_name="Marcus")

        for name in ["Aisha", "Jordan", "Devon", "Priya"]:
            api.vote(poll["id"], name, vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Quinn", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "Sam", vote_type="yes_no", is_abstain=True)

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Winner is yes", results["winner"] == "yes")
        result.assert_technical("Yes count is 4", results["yes_count"] == 4)
        result.assert_technical("No count is 1", results["no_count"] == 1)
        result.assert_technical("Abstain count is 1", results["abstain_count"] == 1)
        result.assert_technical("Yes percentage present", results["yes_percentage"] is not None)
        result.mark_social(
            "INSIGHT",
            "Clear majority respected. But note the shift from the original "
            "design: the lone 'no' (Quinn) is now a NAMED dissent visible to the "
            "whole group. The hidden-ballot comfort the app once advertised is "
            "gone — voters can only hide behind a chosen alias, not behind true "
            "anonymity. For low-stakes drinks this is fine; for anything "
            "sensitive it's a real behavior change (see test_identity_and_naming).",
        )

    def test_exact_tie(self, api, result):
        """Friday drinks: exactly split — 3 yes, 3 no.

        SCENARIO: The group is evenly divided.

        EXPECTATION: Result is "tie" — the system shouldn't arbitrarily pick a
        side. A forced "yes" when half don't want to go breeds resentment.
        """
        poll = api.create_poll("Drinks after work?", "yes_no", creator_name="Marcus")

        for name in ["Alice", "Bob", "Carol"]:
            api.vote(poll["id"], name, vote_type="yes_no", yes_no_choice="yes")
        for name in ["Dana", "Eli", "Faye"]:
            api.vote(poll["id"], name, vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Result is tie", results["winner"] == "tie")
        result.assert_technical("Equal counts", results["yes_count"] == results["no_count"] == 3)
        result.mark_social("FAIR", "Tie correctly reported — the group needs to discuss further.")

    def test_single_voter(self, api, result):
        """Friday drinks: only the organizer votes.

        SCENARIO: Marcus creates the poll and is the only one who votes yes.
        Everyone else ignores it.

        SOCIAL QUESTION: Is a 1-0 victory meaningful? Technically yes wins, but
        socially it means nobody else engaged.
        """
        poll = api.create_poll("Drinks after work?", "yes_no", creator_name="Marcus")
        api.vote(poll["id"], "Marcus", vote_type="yes_no", yes_no_choice="yes")

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Winner is yes", results["winner"] == "yes")
        result.assert_technical("Total votes is 1", results["total_votes"] == 1)
        result.mark_social(
            "AWKWARD",
            "Yes wins with 100%, but a one-voter poll means the group didn't "
            "engage. The app shows a 'Viewed (N)' roster now — so the creator "
            "CAN see how many people opened it without voting. Surfacing "
            "'1 voted of 6 who saw it' on the result would turn a hollow win "
            "into honest signal.",
        )

    def test_all_abstain(self, api, result):
        """Friday drinks: everyone abstains.

        SCENARIO: People see the poll but nobody commits — maybe waiting to see
        what others do first.

        EXPECTATION: No winner; the system handles it gracefully.
        """
        poll = api.create_poll("Drinks after work?", "yes_no", creator_name="Marcus")

        for name in ["Ana", "Ben", "Cory"]:
            api.vote(poll["id"], name, vote_type="yes_no", is_abstain=True)

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("No winner when all abstain", results["winner"] is None)
        result.assert_technical("Zero yes votes", results["yes_count"] == 0)
        result.assert_technical("Zero no votes", results["no_count"] == 0)
        result.assert_technical("Abstain count is 3", results["abstain_count"] == 3)
        result.mark_social(
            "INSIGHT",
            "All-abstain is a valid social signal: indecision. '0-0 with 3 "
            "abstentions' communicates 'nobody wanted to commit' more honestly "
            "than 'no winner'.",
        )


# ── Suggestion: Lunch spot brainstorm ─────────────────────────────────────────


class TestLunchBrainstorm:
    """A group brainstorming where to go for lunch (ranked_choice in its
    suggestion-collection phase)."""

    def test_convergent_suggestions(self, api, result):
        """Lunch brainstorm: multiple people suggest the same place.

        SCENARIO: A team of 5 decides where to eat. Several independently
        suggest the same places, showing organic consensus. The creator seeds
        one option ("Thai Palace").

        EXPECTATION: Popular suggestions bubble to the top by count.
        """
        poll = api.create_poll(
            "Where should we eat?", "suggestion", creator_name="Sam",
            options=["Thai Palace"],
        )

        api.vote(poll["id"], "Priya", vote_type="suggestion", suggestions=["Thai Palace", "Burger Barn"])
        api.vote(poll["id"], "Alex", vote_type="suggestion", suggestions=["Thai Palace", "Sushi Roll"])
        api.vote(poll["id"], "Kim", vote_type="suggestion", suggestions=["Burger Barn", "Taco Town"])
        api.vote(poll["id"], "Noor", vote_type="suggestion", suggestions=["Thai Palace"])
        api.vote(poll["id"], "Jordan", vote_type="suggestion", suggestions=["Sushi Roll", "Thai Palace"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        suggestions = {s["option"]: s["count"] for s in results["suggestion_counts"]}

        result.record("results", results)
        result.record("suggestion_map", suggestions)
        result.assert_technical("Thai Palace most popular", suggestions.get("Thai Palace", 0) >= 4)
        result.assert_technical("Burger Barn has 2", suggestions.get("Burger Barn", 0) == 2)
        result.assert_technical("Sushi Roll has 2", suggestions.get("Sushi Roll", 0) == 2)
        result.assert_technical("Taco Town has 1", suggestions.get("Taco Town", 0) == 1)
        result.assert_technical(
            "Sorted by count descending",
            results["suggestion_counts"][0]["count"] >= results["suggestion_counts"][-1]["count"],
        )
        result.mark_social(
            "FAIR",
            "Organic consensus around Thai Palace. The creator's seed option "
            "earned its lead — it was genuinely popular, not advantaged.",
        )

    def test_all_unique_suggestions(self, api, result):
        """Lunch brainstorm: everyone suggests something different.

        SCENARIO: Five people, five completely different ideas, no overlap.

        SOCIAL QUESTION: With all counts tied at 1, alphabetical ordering means
        'Arby's' sits at the top for no reason anyone prefers it. The brainstorm
        produced no signal — this is exactly when a follow-up ranked vote is
        needed to actually decide.
        """
        poll = api.create_poll("Where should we eat?", "suggestion", creator_name="Sam")

        for name, place in [("A", "Zaxby's"), ("B", "McDonald's"), ("C", "Arby's"),
                            ("D", "Wendy's"), ("E", "KFC")]:
            api.vote(poll["id"], name, vote_type="suggestion", suggestions=[place])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        counts = [s["count"] for s in results["suggestion_counts"]]
        names = [s["option"] for s in results["suggestion_counts"]]

        result.record("results", results)
        result.record("sort_order", names)
        result.assert_technical("All counts are 1", all(c == 1 for c in counts))
        result.assert_technical("Tiebreak is alphabetical", names == sorted(names))
        result.mark_social(
            "AWKWARD",
            "All-unique suggestions with alphabetical tiebreak means the top of "
            "the list is meaningless. The app's intended remedy is to convert "
            "these into a ranked-choice ballot (the suggestion phase IS a "
            "ranked_choice question — cutting off suggestions opens ranking on "
            "the collected options). The deadlock is resolvable in-place; see "
            "test_suggestion_collaboration.",
        )

    def test_abstainer_in_brainstorm(self, api, result):
        """Lunch brainstorm: one person abstains, signaling 'I'll go anywhere.'

        EXPECTATION: The abstainer doesn't dilute suggestion counts.
        """
        poll = api.create_poll("Where should we eat?", "suggestion", creator_name="Sam")

        api.vote(poll["id"], "Priya", vote_type="suggestion", suggestions=["Thai Palace"])
        api.vote(poll["id"], "Alex", vote_type="suggestion", suggestions=["Thai Palace"])
        api.vote(poll["id"], "Kim", vote_type="suggestion", suggestions=["Burger Barn"])
        api.vote(poll["id"], "Jordan", vote_type="suggestion", is_abstain=True)

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])
        suggestions = {s["option"]: s["count"] for s in results["suggestion_counts"]}

        result.record("results", results)
        result.assert_technical("Thai Palace has 2", suggestions.get("Thai Palace", 0) == 2)
        result.assert_technical("Burger Barn has 1", suggestions.get("Burger Barn", 0) == 1)
        result.mark_social(
            "FAIR",
            "Abstaining in a brainstorm is a valid 'I'm flexible' signal. The "
            "abstainer participates (and is counted as present) without steering "
            "the outcome.",
        )
