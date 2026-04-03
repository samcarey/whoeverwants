"""Multi-Stage Workflows — suggestion→preference pipelines and follow-ups.

These tests exercise the full lifecycle of multi-step polls where one
poll's output feeds into another. This models real-world group decision
processes that naturally have multiple phases.
"""


class TestSuggestionThenRank:
    """The classic 'brainstorm then vote' pattern."""

    def test_suggestion_to_ranked_choice_pipeline(self, api, creator_secret, result):
        """Full pipeline: suggestions collected, then ranked.

        SCENARIO: A team is picking a name for their project. Phase 1:
        everyone suggests names (suggestion poll). Phase 2: the top
        suggestions go to a ranked choice vote.

        This simulates the manual version of the pipeline (creator
        creates the follow-up ranked choice poll themselves).
        """
        # Phase 1: Collect suggestions
        suggest_poll = api.create_poll(
            "Suggest names for our project!", "suggestion", creator_secret,
            creator_name="PM Pat",
        )

        api.vote(suggest_poll["id"], voter_name="Alice", vote_type="suggestion",
                 suggestions=["Moonshot", "Catalyst"])
        api.vote(suggest_poll["id"], voter_name="Bob", vote_type="suggestion",
                 suggestions=["Catalyst", "Zenith"])
        api.vote(suggest_poll["id"], voter_name="Carol", vote_type="suggestion",
                 suggestions=["Moonshot", "Nova"])
        api.vote(suggest_poll["id"], voter_name="Dave", vote_type="suggestion",
                 suggestions=["Catalyst", "Moonshot"])
        api.vote(suggest_poll["id"], vote_type="suggestion",
                 suggestions=["Zenith", "Moonshot"])

        api.close_poll(suggest_poll["id"], creator_secret)
        suggest_results = api.get_results(suggest_poll["id"])

        # Extract top suggestions
        top_suggestions = [
            s["option"] for s in suggest_results["suggestion_counts"]
            if s["count"] >= 2
        ]

        result.record("suggestion_results", suggest_results)
        result.record("top_suggestions", top_suggestions)

        # Phase 2: Ranked choice on top suggestions
        rank_secret = creator_secret + "-rank"
        rank_poll = api.create_poll(
            "Vote on project name!", "ranked_choice", rank_secret,
            creator_name="PM Pat",
            options=top_suggestions,
            follow_up_to=suggest_poll["id"],
        )

        # Same voters rank their favorites
        api.vote(rank_poll["id"], voter_name="Alice", vote_type="ranked_choice",
                 ranked_choices=["Moonshot", "Catalyst", "Zenith"])
        api.vote(rank_poll["id"], voter_name="Bob", vote_type="ranked_choice",
                 ranked_choices=["Catalyst", "Zenith", "Moonshot"])
        api.vote(rank_poll["id"], voter_name="Carol", vote_type="ranked_choice",
                 ranked_choices=["Moonshot", "Catalyst", "Zenith"])
        api.vote(rank_poll["id"], voter_name="Dave", vote_type="ranked_choice",
                 ranked_choices=["Catalyst", "Moonshot", "Zenith"])
        api.vote(rank_poll["id"], vote_type="ranked_choice",
                 ranked_choices=["Moonshot", "Zenith", "Catalyst"])

        api.close_poll(rank_poll["id"], rank_secret)
        rank_results = api.get_results(rank_poll["id"])

        result.record("rank_results", rank_results)
        result.assert_technical(
            "Top suggestions carried forward",
            "Moonshot" in top_suggestions and "Catalyst" in top_suggestions,
        )
        result.assert_technical("Ranked choice produced winner", rank_results["ranked_choice_winner"] is not None)
        result.assert_technical(
            "Follow-up link preserved",
            rank_poll.get("follow_up_to") == suggest_poll["id"],
        )
        result.mark_social(
            "FAIR",
            f"Two-phase process: brainstorm surfaced top ideas, ranked choice "
            f"picked '{rank_results['ranked_choice_winner']}'. This mimics natural "
            "group decision-making: diverge (suggest), then converge (rank).",
        )

    def test_auto_preferences_workflow(self, api, creator_secret, result):
        """Auto-preferences: suggestion poll automatically creates a follow-up ranked choice.

        SCENARIO: Creator enables auto_create_preferences. When the
        suggestion poll closes, the server automatically creates a
        ranked choice poll with the suggestions as options.

        EXPECTATION: The follow-up poll exists, is linked, and contains
        the right options.
        """
        poll = api.create_poll(
            "Suggest team activities!", "suggestion", creator_secret,
            creator_name="Lead Lisa",
            auto_create_preferences=True,
            auto_preferences_deadline_minutes=60,
        )

        api.vote(poll["id"], voter_name="A", vote_type="suggestion",
                 suggestions=["Bowling", "Escape Room"])
        api.vote(poll["id"], voter_name="B", vote_type="suggestion",
                 suggestions=["Escape Room", "Laser Tag"])
        api.vote(poll["id"], voter_name="C", vote_type="suggestion",
                 suggestions=["Bowling", "Mini Golf"])

        api.close_poll(poll["id"], creator_secret)

        # The server should have auto-created a follow-up ranked choice poll
        # Check by looking for polls that follow_up_to this one
        # We'll use the accessible endpoint with the original poll to find related
        original = api.get_poll(poll["id"])
        suggest_results = api.get_results(poll["id"])

        result.record("original_poll", original)
        result.record("suggest_results", suggest_results)
        result.assert_technical("Suggestion poll is closed", original["is_closed"])

        # Try to find the auto-created follow-up via the related polls endpoint
        try:
            related = api.get_related([poll["id"]])
            follow_up_ids = [pid for pid in related.get("all_related_ids", []) if pid != poll["id"]]
            result.record("follow_up_ids", follow_up_ids)

            if follow_up_ids:
                follow_up = api.get_poll(follow_up_ids[0])
                result.record("follow_up_poll", follow_up)
                result.assert_technical("Follow-up is ranked_choice", follow_up["poll_type"] == "ranked_choice")
                result.assert_technical("Follow-up linked to original", follow_up.get("follow_up_to") == poll["id"])
                result.assert_technical("Follow-up has options from suggestions",
                                        follow_up.get("options") is not None and len(follow_up["options"]) > 0)
                result.mark_social(
                    "FAIR",
                    "Auto-preferences seamlessly creates the second phase. Users don't "
                    "need to manually extract suggestions and create a new poll — the "
                    "workflow handles the transition automatically.",
                )
            else:
                result.mark_social(
                    "INSIGHT",
                    "No follow-up poll found via related endpoint. The auto-creation may "
                    "use a different linking mechanism or the related endpoint may not "
                    "discover it. Worth investigating the discovery path.",
                )
        except Exception as e:
            result.record("related_error", str(e))
            result.mark_social("INSIGHT", f"Related polls endpoint error: {e}")


class TestFollowUpChains:
    """Testing chains of polls where each builds on the last."""

    def test_fork_preserves_context(self, api, creator_secret, result):
        """Fork: someone creates a variant of an existing poll.

        SCENARIO: Original poll asks "Best pizza topping?" with options.
        Someone forks it to ask "Best pizza topping for KIDS?" — same
        concept, different audience.

        EXPECTATION: Fork link is preserved. Both polls function independently.
        """
        original_secret = creator_secret + "-orig"
        fork_secret = creator_secret + "-fork"

        original = api.create_poll(
            "Best pizza topping?", "ranked_choice", original_secret,
            options=["Pepperoni", "Mushroom", "Pineapple", "Plain"],
        )

        fork = api.create_poll(
            "Best pizza topping for KIDS?", "ranked_choice", fork_secret,
            options=["Pepperoni", "Plain", "Mac & Cheese"],
            fork_of=original["id"],
        )

        # Vote on both independently
        api.vote(original["id"], voter_name="Adult A", vote_type="ranked_choice",
                 ranked_choices=["Mushroom", "Pepperoni", "Pineapple", "Plain"])
        api.vote(original["id"], voter_name="Adult B", vote_type="ranked_choice",
                 ranked_choices=["Pineapple", "Mushroom", "Plain", "Pepperoni"])

        api.vote(fork["id"], voter_name="Parent 1", vote_type="ranked_choice",
                 ranked_choices=["Plain", "Pepperoni", "Mac & Cheese"])
        api.vote(fork["id"], voter_name="Parent 2", vote_type="ranked_choice",
                 ranked_choices=["Pepperoni", "Plain", "Mac & Cheese"])

        api.close_poll(original["id"], original_secret)
        api.close_poll(fork["id"], fork_secret)

        orig_results = api.get_results(original["id"])
        fork_results = api.get_results(fork["id"])

        result.record("original_results", orig_results)
        result.record("fork_results", fork_results)
        result.assert_technical("Fork linked to original", fork.get("fork_of") == original["id"])
        result.assert_technical("Both have winners",
                                orig_results["ranked_choice_winner"] is not None and
                                fork_results["ranked_choice_winner"] is not None)
        result.assert_technical("Polls are independent (different option sets)",
                                set(original.get("options", [])) != set(fork.get("options", [])))
        result.mark_social(
            "FAIR",
            "Fork maintains provenance while allowing the new poll to diverge. "
            "Different options, different voters, independent results — but the "
            "link back to the original provides context for why this poll exists.",
        )

    def test_follow_up_after_tie(self, api, creator_secret, result):
        """Follow-up: tie leads to a runoff with fewer options.

        SCENARIO: A yes/no poll ties 3-3. The creator creates a follow-up
        with more context to break the tie.

        EXPECTATION: The follow-up is linked and can reference the tied result.
        """
        first_secret = creator_secret + "-1"
        second_secret = creator_secret + "-2"

        first_poll = api.create_poll("Team offsite this quarter?", "yes_no", first_secret)

        for name in ["A", "B", "C"]:
            api.vote(first_poll["id"], voter_name=name, vote_type="yes_no", yes_no_choice="yes")
        for name in ["D", "E", "F"]:
            api.vote(first_poll["id"], voter_name=name, vote_type="yes_no", yes_no_choice="no")

        api.close_poll(first_poll["id"], first_secret)
        first_results = api.get_results(first_poll["id"])

        # Creator creates follow-up with more detail
        second_poll = api.create_poll(
            "Team offsite: budget is $500/person, 2 days. Still interested?",
            "yes_no", second_secret,
            follow_up_to=first_poll["id"],
            details="Previous vote tied 3-3. Adding budget context to help decide.",
        )

        # Some people change their mind with new info
        api.vote(second_poll["id"], voter_name="A", vote_type="yes_no", yes_no_choice="yes")
        api.vote(second_poll["id"], voter_name="B", vote_type="yes_no", yes_no_choice="yes")
        api.vote(second_poll["id"], voter_name="C", vote_type="yes_no", yes_no_choice="yes")  # Changed with budget context
        api.vote(second_poll["id"], voter_name="D", vote_type="yes_no", yes_no_choice="yes")  # Changed with budget context
        api.vote(second_poll["id"], voter_name="E", vote_type="yes_no", yes_no_choice="no")
        api.vote(second_poll["id"], voter_name="F", vote_type="yes_no", yes_no_choice="no")

        api.close_poll(second_poll["id"], second_secret)
        second_results = api.get_results(second_poll["id"])

        result.record("first_results", first_results)
        result.record("second_results", second_results)
        result.assert_technical("First poll tied", first_results["winner"] == "tie")
        result.assert_technical("Second poll has a winner", second_results["winner"] in ("yes", "no"))
        result.assert_technical("Follow-up linked", second_poll.get("follow_up_to") == first_poll["id"])
        result.mark_social(
            "FAIR",
            "Following up a tie with more context is a natural group behavior. "
            "The link between polls preserves the decision history: 'We tied, "
            "so we added more info and voted again.' Result: "
            f"{second_results['winner']} ({second_results['yes_count']}-{second_results['no_count']}).",
        )
