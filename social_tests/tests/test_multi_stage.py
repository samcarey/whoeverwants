"""Multi-Stage Workflows — groups as the unit of an ongoing decision.

The old model chained polls via `follow_up_to` and supported forks; both are
gone. Now related polls share a **group_id** (a flat list, sorted by
creation). A follow-up is simply "another poll added to the same group." This
models how a real group's decision-making accretes: brainstorm, then decide;
tie, then add context and revote; one event spawns several questions over
days.
"""


class TestSuggestionThenRank:
    """The classic 'brainstorm, then vote' pattern — two polls in one group."""

    def test_diverge_then_converge_in_one_group(self, api, result):
        """Phase 1 collect suggestions, Phase 2 rank the top ones — same group.

        SCENARIO: A team names their project. Poll 1 (suggestion phase)
        collects ideas. The organizer reads the top suggestions and creates
        Poll 2 (ranked choice) on the shortlist, attached to the SAME group so
        the two phases live together in the group's history.

        EXPECTATION: Both polls share one group_id; the group view returns
        both; ranked choice produces a winner from the shortlist.
        """
        suggest = api.create_poll("Suggest names for our project!", "suggestion", creator_name="PM Pat")

        api.vote(suggest["id"], "Alice", vote_type="suggestion", suggestions=["Moonshot", "Catalyst"])
        api.vote(suggest["id"], "Bob", vote_type="suggestion", suggestions=["Catalyst", "Zenith"])
        api.vote(suggest["id"], "Carol", vote_type="suggestion", suggestions=["Moonshot", "Nova"])
        api.vote(suggest["id"], "Dave", vote_type="suggestion", suggestions=["Catalyst", "Moonshot"])
        api.vote(suggest["id"], "Erin", vote_type="suggestion", suggestions=["Zenith", "Moonshot"])

        api.close_poll(suggest["id"])
        suggest_results = api.get_results(suggest["id"])
        top = [s["option"] for s in suggest_results["suggestion_counts"] if s["count"] >= 2]

        # Phase 2: ranked choice on the shortlist, in the SAME group.
        rank = api.create_poll(
            "Vote on the project name!", "ranked_choice", creator_name="PM Pat",
            options=top, group_id=suggest["group_id"],
        )

        api.vote(rank["id"], "Alice", vote_type="ranked_choice", ranked_choices=["Moonshot", "Catalyst", "Zenith"])
        api.vote(rank["id"], "Bob", vote_type="ranked_choice", ranked_choices=["Catalyst", "Zenith", "Moonshot"])
        api.vote(rank["id"], "Carol", vote_type="ranked_choice", ranked_choices=["Moonshot", "Catalyst", "Zenith"])
        api.vote(rank["id"], "Dave", vote_type="ranked_choice", ranked_choices=["Catalyst", "Moonshot", "Zenith"])
        api.vote(rank["id"], "Erin", vote_type="ranked_choice", ranked_choices=["Moonshot", "Zenith", "Catalyst"])

        api.close_poll(rank["id"])
        rank_results = api.get_results(rank["id"])

        group_polls = api.get_group(suggest["group_short_id"])
        group_poll_ids = {p["id"] for p in group_polls}

        result.record("top_suggestions", top)
        result.record("rank_results", rank_results)
        result.record("group_size", len(group_polls))
        result.assert_technical("Top suggestions carried forward", "Moonshot" in top and "Catalyst" in top)
        result.assert_technical("Both polls share one group", rank["group_id"] == suggest["group_id"])
        result.assert_technical("Group view returns both polls", {suggest["id"], rank["id"]} <= group_poll_ids)
        result.assert_technical("Ranked choice produced a winner", rank_results["ranked_choice_winner"] is not None)
        result.mark_social(
            "FAIR",
            f"Diverge (suggest) then converge (rank), both preserved in one "
            f"group → '{rank_results['ranked_choice_winner']}'. This is the "
            "manual two-step. The app ALSO offers it in a single poll: a "
            "ranked-choice question with a suggestion-collection phase that "
            "auto-opens ranking at cutoff (see test_suggestion_collaboration) — "
            "fewer taps, one shareable link.",
        )


class TestFollowUps:
    """Adding a follow-up poll to an existing group."""

    def test_follow_up_after_tie(self, api, result):
        """A tie leads to a follow-up poll with more context, same group.

        SCENARIO: A yes/no poll ties 3-3. The organizer adds a second poll to
        the same group with budget context. Some people change their minds.

        EXPECTATION: Both polls live in one group; the follow-up resolves.
        """
        first = api.create_poll("Team offsite this quarter?", "yes_no", creator_name="Org")

        for name in ["A", "B", "C"]:
            api.vote(first["id"], name, vote_type="yes_no", yes_no_choice="yes")
        for name in ["D", "E", "F"]:
            api.vote(first["id"], name, vote_type="yes_no", yes_no_choice="no")

        api.close_poll(first["id"])
        first_results = api.get_results(first["id"])

        second = api.create_poll(
            "Offsite: $500/person, 2 days. Still in?", "yes_no", creator_name="Org",
            group_id=first["group_id"],
            details="Previous vote tied 3-3. Adding budget context to decide.",
        )

        for name in ["A", "B", "C", "D"]:  # C and D swayed by the budget context
            api.vote(second["id"], name, vote_type="yes_no", yes_no_choice="yes")
        for name in ["E", "F"]:
            api.vote(second["id"], name, vote_type="yes_no", yes_no_choice="no")

        api.close_poll(second["id"])
        second_results = api.get_results(second["id"])
        group_polls = api.get_group(first["group_short_id"])

        result.record("first_results", first_results)
        result.record("second_results", second_results)
        result.assert_technical("First poll tied", first_results["winner"] == "tie")
        result.assert_technical("Follow-up resolved", second_results["winner"] in ("yes", "no"))
        result.assert_technical("Follow-up in same group", second["group_id"] == first["group_id"])
        result.assert_technical("Group holds both polls", len(group_polls) >= 2)
        result.mark_social(
            "FAIR",
            "Following a tie with more context is natural group behavior. The "
            "group preserves the history ('we tied, added budget info, "
            f"revoted'). Result: {second_results['winner']} "
            f"({second_results['yes_count']}-{second_results['no_count']}). The "
            "decision narrative stays in one shareable place.",
        )

    def test_group_as_ongoing_conversation(self, api, result):
        """A friend group accumulates several decisions in one group over time.

        SCENARIO: One friend group uses a single group as their hub: where to
        eat, what to watch, whether to make it a sleepover. Three polls, all in
        the same group.

        EXPECTATION: The group view returns all three; each is independently
        resolvable. The group is the durable 'place' the friends return to.
        """
        eat = api.create_poll("Dinner this Friday?", "suggestion", creator_name="Riley")
        api.vote(eat["id"], "Riley", vote_type="suggestion", suggestions=["Pho House", "Taqueria"])
        api.vote(eat["id"], "Sky", vote_type="suggestion", suggestions=["Pho House"])

        gid = eat["group_id"]
        watch = api.create_poll(
            "What to watch after?", "ranked_choice", creator_name="Riley",
            options=["Comedy", "Thriller", "Documentary"], group_id=gid,
        )
        api.vote(watch["id"], "Riley", vote_type="ranked_choice", ranked_choices=["Comedy", "Thriller", "Documentary"])
        api.vote(watch["id"], "Sky", vote_type="ranked_choice", ranked_choices=["Thriller", "Comedy", "Documentary"])

        sleepover = api.create_poll("Make it a sleepover?", "yes_no", creator_name="Riley", group_id=gid)
        api.vote(sleepover["id"], "Riley", vote_type="yes_no", yes_no_choice="yes")
        api.vote(sleepover["id"], "Sky", vote_type="yes_no", yes_no_choice="yes")

        group_polls = api.get_group(eat["group_short_id"])
        ids = {p["id"] for p in group_polls}

        result.record("group_size", len(group_polls))
        result.assert_technical("All three polls share the group",
                                watch["group_id"] == gid and sleepover["group_id"] == gid)
        result.assert_technical("Group view returns all three",
                                {eat["id"], watch["id"], sleepover["id"]} <= ids)
        result.mark_social(
            "INSIGHT",
            "A group as a persistent hub for a friend circle's many small "
            "decisions is one of the strongest real-life uses of this app — it "
            "competes with the endless 'so where are we eating??' group chat. "
            "Worth leaning into: a group title/avatar, notifications on new "
            "polls, and an at-a-glance 'what's still open' view make the group "
            "feel like a lightweight shared space, not a one-off poll.",
        )
