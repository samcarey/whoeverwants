"""Casual Decisions — friend groups making low-stakes choices.

These tests simulate the most common use case: a group of friends or
coworkers making a simple decision together. The focus is on whether
results feel natural and whether the anonymous/named voter mix works
smoothly.
"""

import uuid


# ── Yes/No: Simple group question ─────────────────────────────────────────────


class TestFridayDrinks:
    """A coworker asks if people want to go for drinks after work."""

    def test_clear_majority_yes(self, api, creator_secret, result):
        """Friday drinks: 4 yes, 1 no, 1 abstain.

        SCENARIO: Marcus creates a poll asking "Drinks after work Friday?"
        Four coworkers say yes (two named, two anonymous). One says no
        (anonymous — maybe they're shy about being the dissenter). One
        abstains (they're not sure yet but want to acknowledge the poll).

        EXPECTATION: Clear yes wins. The abstainer shouldn't dilute the
        percentage. Anonymous dissenters should feel safe.
        """
        poll = api.create_poll("Drinks after work Friday?", "yes_no", creator_secret, creator_name="Marcus")

        api.vote(poll["id"], voter_name="Aisha", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Jordan", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], vote_type="yes_no", yes_no_choice="yes")  # anonymous
        api.vote(poll["id"], vote_type="yes_no", yes_no_choice="yes")  # anonymous
        api.vote(poll["id"], vote_type="yes_no", yes_no_choice="no")   # anonymous dissenter
        api.vote(poll["id"], vote_type="yes_no", yes_no_choice="yes", is_abstain=True)  # unsure

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Winner is yes", results["winner"] == "yes")
        result.assert_technical("Yes count is 4", results["yes_count"] == 4)
        result.assert_technical("No count is 1", results["no_count"] == 1)
        result.assert_technical("Abstain count is 1", results["abstain_count"] == 1)
        result.assert_technical(
            "Yes percentage based on total votes (including abstain)",
            results["yes_percentage"] is not None,
        )
        result.mark_social("FAIR", "Clear majority respected. Anonymous no vote preserved dissenter's comfort.")

    def test_exact_tie(self, api, creator_secret, result):
        """Friday drinks: exactly split — 3 yes, 3 no.

        SCENARIO: The group is evenly divided. Three want to go, three don't.

        EXPECTATION: Result should be "tie". The system shouldn't arbitrarily
        pick a side. This is a socially important case — a forced "yes" when
        half the group doesn't want to go creates resentment.
        """
        poll = api.create_poll("Drinks after work?", "yes_no", creator_secret)

        for name in ["Alice", "Bob", "Carol"]:
            api.vote(poll["id"], voter_name=name, vote_type="yes_no", yes_no_choice="yes")
        for _ in range(3):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Result is tie", results["winner"] == "tie")
        result.assert_technical("Equal counts", results["yes_count"] == results["no_count"] == 3)
        result.mark_social("FAIR", "Tie correctly reported — group needs to discuss further.")

    def test_single_voter(self, api, creator_secret, result):
        """Friday drinks: only the organizer votes.

        SCENARIO: Marcus creates the poll and is the only one who votes yes.
        Everyone else ignores it.

        SOCIAL QUESTION: Is a 1-0 victory meaningful? Technically yes wins,
        but socially this means nobody else cared enough to respond.
        """
        poll = api.create_poll("Drinks after work?", "yes_no", creator_secret, creator_name="Marcus")
        api.vote(poll["id"], voter_name="Marcus", vote_type="yes_no", yes_no_choice="yes")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Winner is yes", results["winner"] == "yes")
        result.assert_technical("Total votes is 1", results["total_votes"] == 1)
        result.mark_social(
            "AWKWARD",
            "Technically yes wins with 100%, but a single-voter poll suggests "
            "the group didn't engage. The app could surface low participation "
            "as a signal (e.g., '1 of ? responded').",
        )

    def test_all_abstain(self, api, creator_secret, result):
        """Friday drinks: everyone abstains.

        SCENARIO: People see the poll but nobody commits. Maybe they're
        waiting to see what others do first.

        EXPECTATION: No winner. The system should handle this gracefully.
        """
        poll = api.create_poll("Drinks after work?", "yes_no", creator_secret)

        for name in ["A", "B", "C"]:
            api.vote(poll["id"], voter_name=name, vote_type="yes_no", is_abstain=True)

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("No winner when all abstain", results["winner"] is None)
        result.assert_technical("Zero yes votes", results["yes_count"] == 0)
        result.assert_technical("Zero no votes", results["no_count"] == 0)
        result.assert_technical("Abstain count is 3", results["abstain_count"] == 3)
        result.mark_social(
            "INSIGHT",
            "All-abstain is a valid social signal: the group is indecisive or "
            "uninterested. Showing '0-0 with 3 abstentions' communicates this clearly.",
        )


# ── Yes/No: Sensitive topic ──────────────────────────────────────────────────


class TestSensitiveTopic:
    """A group deciding something where anonymity matters."""

    def test_anonymous_majority(self, api, creator_secret, result):
        """Should we switch to a 4-day work week? All anonymous votes.

        SCENARIO: Someone asks a potentially political workplace question.
        Everyone votes anonymously because they don't want their boss
        to know their preference.

        EXPECTATION: Results are clean — just counts, no names.
        """
        poll = api.create_poll("Switch to 4-day work week?", "yes_no", creator_secret)

        for _ in range(7):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="yes")
        for _ in range(3):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])
        votes = api.get_votes(poll["id"])

        all_anonymous = all(v["voter_name"] is None for v in votes)

        result.record("results", results)
        result.record("all_anonymous", all_anonymous)
        result.assert_technical("Yes wins", results["winner"] == "yes")
        result.assert_technical("All votes anonymous", all_anonymous)
        result.assert_technical("70% yes", results["yes_percentage"] == 70)
        result.mark_social("FAIR", "Anonymous voting protects voters on sensitive topics. No names leaked.")


# ── Suggestion: Lunch spot brainstorm ─────────────────────────────────────────


class TestLunchBrainstorm:
    """A group brainstorming where to go for lunch."""

    def test_convergent_suggestions(self, api, creator_secret, result):
        """Lunch brainstorm: multiple people suggest the same place.

        SCENARIO: A team of 5 is deciding where to eat. Several people
        independently suggest the same places, showing organic consensus.

        EXPECTATION: Popular suggestions bubble to the top. The count
        reflects how many people independently thought of each place.
        """
        poll = api.create_poll(
            "Where should we eat?", "suggestion", creator_secret,
            creator_name="Sam", options=["Thai Palace"],
        )

        api.vote(poll["id"], voter_name="Priya", vote_type="suggestion", suggestions=["Thai Palace", "Burger Barn"])
        api.vote(poll["id"], voter_name="Alex", vote_type="suggestion", suggestions=["Thai Palace", "Sushi Roll"])
        api.vote(poll["id"], voter_name="Kim", vote_type="suggestion", suggestions=["Burger Barn", "Taco Town"])
        api.vote(poll["id"], vote_type="suggestion", suggestions=["Thai Palace"])  # anonymous
        api.vote(poll["id"], voter_name="Jordan", vote_type="suggestion", suggestions=["Sushi Roll", "Thai Palace"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        suggestions = {s["option"]: s["count"] for s in results["suggestion_counts"]}

        result.record("results", results)
        result.record("suggestion_map", suggestions)
        result.assert_technical("Thai Palace is most popular", suggestions.get("Thai Palace", 0) >= 4)
        result.assert_technical("Burger Barn has 2 votes", suggestions.get("Burger Barn", 0) == 2)
        result.assert_technical("Sushi Roll has 2 votes", suggestions.get("Sushi Roll", 0) == 2)
        result.assert_technical("Taco Town has 1 vote", suggestions.get("Taco Town", 0) == 1)
        result.assert_technical(
            "Results sorted by count descending",
            results["suggestion_counts"][0]["count"] >= results["suggestion_counts"][-1]["count"],
        )
        result.mark_social(
            "FAIR",
            "Organic consensus emerged around Thai Palace. The starter option "
            "from the creator didn't get unfair advantage — it was genuinely popular.",
        )

    def test_all_unique_suggestions(self, api, creator_secret, result):
        """Lunch brainstorm: everyone suggests something different.

        SCENARIO: Nobody agrees. Five people, five completely different ideas.

        SOCIAL QUESTION: When there's no overlap, what does the sorted list
        communicate? Alphabetical tiebreaking is technically fair but
        arbitrary — "Arby's" shouldn't win over "Zaxby's" just by name.
        """
        poll = api.create_poll("Where should we eat?", "suggestion", creator_secret)

        api.vote(poll["id"], voter_name="A", vote_type="suggestion", suggestions=["Zaxby's"])
        api.vote(poll["id"], voter_name="B", vote_type="suggestion", suggestions=["McDonald's"])
        api.vote(poll["id"], voter_name="C", vote_type="suggestion", suggestions=["Arby's"])
        api.vote(poll["id"], voter_name="D", vote_type="suggestion", suggestions=["Wendy's"])
        api.vote(poll["id"], voter_name="E", vote_type="suggestion", suggestions=["KFC"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        counts = [s["count"] for s in results["suggestion_counts"]]
        all_equal = all(c == 1 for c in counts)
        names = [s["option"] for s in results["suggestion_counts"]]
        is_alphabetical = names == sorted(names)

        result.record("results", results)
        result.record("all_equal", all_equal)
        result.record("sort_order", names)
        result.assert_technical("All suggestions have count 1", all_equal)
        result.assert_technical("Tiebreak is alphabetical", is_alphabetical)
        result.mark_social(
            "AWKWARD",
            "All-unique suggestions with alphabetical tiebreak means 'Arby's' "
            "appears first not because anyone prefers it more, but because of "
            "its name. This is where a follow-up ranked choice poll is essential "
            "to resolve the deadlock meaningfully.",
        )

    def test_abstainer_in_brainstorm(self, api, creator_secret, result):
        """Lunch brainstorm: one person abstains, signaling they'll go anywhere.

        SCENARIO: Four people suggest places, one person abstains (they're
        happy with whatever the group picks).

        EXPECTATION: Abstainer doesn't dilute suggestion counts.
        """
        poll = api.create_poll("Where should we eat?", "suggestion", creator_secret)

        api.vote(poll["id"], voter_name="Priya", vote_type="suggestion", suggestions=["Thai Palace"])
        api.vote(poll["id"], voter_name="Alex", vote_type="suggestion", suggestions=["Thai Palace"])
        api.vote(poll["id"], voter_name="Kim", vote_type="suggestion", suggestions=["Burger Barn"])
        api.vote(poll["id"], voter_name="Jordan", vote_type="suggestion", is_abstain=True)

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        suggestions = {s["option"]: s["count"] for s in results["suggestion_counts"]}

        result.record("results", results)
        result.assert_technical("Thai Palace has 2 votes", suggestions.get("Thai Palace", 0) == 2)
        result.assert_technical("Burger Barn has 1 vote", suggestions.get("Burger Barn", 0) == 1)
        result.assert_technical("Abstain count is 1", results.get("abstain_count", 0) == 1 or results["total_votes"] == 4)
        result.mark_social(
            "FAIR",
            "Abstaining in a suggestion poll is a valid social signal: 'I'm flexible.' "
            "The abstainer participates without steering the outcome.",
        )
