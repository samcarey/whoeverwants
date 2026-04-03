"""Edge Cases & Social Dynamics — adversarial inputs, anonymity, and pressure.

These tests probe the boundaries: what happens when people game the
system, when everyone is anonymous, when votes change, or when the
social dynamics are unusual.
"""


class TestAnonymityDynamics:
    """How anonymity affects the social dynamics of voting."""

    def test_all_anonymous_yes_no(self, api, creator_secret, result):
        """Fully anonymous vote: nobody attaches their name.

        SCENARIO: A group uses the poll for a sensitive decision.
        All 8 voters are anonymous. The creator didn't name themselves either.

        EXPECTATION: Results should be purely numerical. No way to trace
        who voted what. This is the privacy promise of the app.
        """
        poll = api.create_poll("Should we file a complaint?", "yes_no", creator_secret)

        for _ in range(5):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="yes")
        for _ in range(3):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])
        votes = api.get_votes(poll["id"])

        all_anon = all(v["voter_name"] is None for v in votes)
        no_creator_name = results.get("creator_name") is None

        result.record("results", results)
        result.assert_technical("Yes wins (5-3)", results["winner"] == "yes")
        result.assert_technical("All voters anonymous", all_anon)
        result.mark_social(
            "FAIR",
            "Full anonymity maintained. The app provides a safe space for "
            "group decisions on sensitive topics where individuals might face "
            "pressure for their vote.",
        )

    def test_mixed_named_and_anonymous(self, api, creator_secret, result):
        """Mixed poll: some named, some anonymous.

        SCENARIO: In a friend group, some people proudly attach their name
        to their vote, others prefer anonymity. Does the mix work?

        SOCIAL QUESTION: Can you tell which anonymous votes belong to which
        people by process of elimination? (If 5 people in a group and 3
        named voters, the 2 anonymous ones are identifiable.)
        """
        poll = api.create_poll("Pizza or sushi?", "yes_no", creator_secret)

        api.vote(poll["id"], voter_name="Alice", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Bob", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], vote_type="yes_no", yes_no_choice="no")  # Anonymous
        api.vote(poll["id"], voter_name="Dave", vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"], creator_secret)
        votes = api.get_votes(poll["id"])

        named = [v for v in votes if v["voter_name"]]
        anon = [v for v in votes if not v["voter_name"]]

        result.record("named_count", len(named))
        result.record("anonymous_count", len(anon))
        result.assert_technical("3 named voters", len(named) == 3)
        result.assert_technical("1 anonymous voter", len(anon) == 1)
        result.mark_social(
            "INSIGHT",
            "In a known group of 4, the 1 anonymous voter is trivially identifiable "
            "(it's whoever isn't Alice, Bob, or Dave). The app can't prevent social "
            "deduction in small groups — this is a fundamental limitation of anonymous "
            "voting when the voter pool is known. Consider noting this in UX.",
        )


class TestVoteEditing:
    """What happens when people change their minds."""

    def test_change_vote_flips_result(self, api, creator_secret, result):
        """Vote change: a voter switches sides and flips the outcome.

        SCENARIO: 3-2 in favor of yes. One yes-voter changes to no,
        making it 2-3. The swing voter changed the entire outcome.

        EXPECTATION: Results reflect the final state, not vote history.
        """
        poll = api.create_poll("Go hiking this weekend?", "yes_no", creator_secret)

        v1 = api.vote(poll["id"], voter_name="Swing Voter", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="B", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="C", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="D", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], voter_name="E", vote_type="yes_no", yes_no_choice="no")

        # Check results before the switch
        results_before = api.get_results(poll["id"])
        assert results_before["winner"] == "yes"

        # Swing voter changes their mind
        api.edit_vote(poll["id"], v1["id"], yes_no_choice="no")

        results_after = api.get_results(poll["id"])

        result.record("before", results_before)
        result.record("after", results_after)
        result.assert_technical("Result flipped to no", results_after["winner"] == "no")
        result.assert_technical("No count is now 3", results_after["no_count"] == 3)
        result.assert_technical("Yes count is now 2", results_after["yes_count"] == 2)
        result.mark_social(
            "FAIR",
            "Vote editing is transparent — the result reflects current preferences, "
            "not historical ones. This is correct for decision-making (you want the "
            "group's final answer), though it means early results are unreliable.",
        )

    def test_edit_ranked_choice(self, api, creator_secret, result):
        """Ranked choice edit: voter reorders their preferences.

        SCENARIO: A voter initially ranks A > B > C, then changes to C > A > B.
        This tests that the ranking replacement is clean.
        """
        poll = api.create_poll(
            "Favorite?", "ranked_choice", creator_secret,
            options=["A", "B", "C"],
        )

        v1 = api.vote(poll["id"], voter_name="Fickle Fred", vote_type="ranked_choice",
                       ranked_choices=["A", "B", "C"])
        api.vote(poll["id"], voter_name="Steady Sue", vote_type="ranked_choice",
                 ranked_choices=["C", "A", "B"])
        api.vote(poll["id"], voter_name="Calm Cal", vote_type="ranked_choice",
                 ranked_choices=["C", "B", "A"])

        # Fred changes mind
        api.edit_vote(poll["id"], v1["id"], ranked_choices=["C", "A", "B"])

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("C wins after edit", results["ranked_choice_winner"] == "C")
        result.mark_social(
            "FAIR",
            "Vote editing in ranked choice works cleanly. The edited ballot "
            "is treated the same as any other ballot — no trace of the original ranking.",
        )


class TestCreatorPower:
    """Testing the power dynamics of poll creation and management."""

    def test_creator_closes_losing_poll(self, api, creator_secret, result):
        """Creator closes a poll they're losing.

        SCENARIO: The creator votes yes on their own poll, but the group
        votes no. The creator then closes the poll. The result should
        still reflect the group's decision, not the creator's preference.

        EXPECTATION: Closing a poll doesn't change the outcome.
        """
        poll = api.create_poll("My idea is great, right?", "yes_no", creator_secret,
                               creator_name="Ego Ed")

        api.vote(poll["id"], voter_name="Ego Ed", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Honest A", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], voter_name="Honest B", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], voter_name="Honest C", vote_type="yes_no", yes_no_choice="no")

        # Creator closes the poll — result should still be "no"
        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("No wins (1-3)", results["winner"] == "no")
        result.assert_technical("Result is honest despite creator loss", results["no_count"] == 3)
        result.mark_social(
            "FAIR",
            "The creator can close the poll but can't change the outcome. "
            "This is an important integrity guarantee — poll creators have "
            "administrative power (close/reopen) but not voting power beyond their single vote.",
        )

    def test_creator_reopens_and_more_votes(self, api, creator_secret, result):
        """Creator reopens a closed poll to collect more votes.

        SCENARIO: Poll is closed at 2-2 tie. Creator reopens it.
        One more person votes and breaks the tie.

        EXPECTATION: Reopening is legitimate when the creator wants more input.
        """
        poll = api.create_poll("Team lunch spot?", "yes_no", creator_secret)

        api.vote(poll["id"], voter_name="A", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="B", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="C", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], voter_name="D", vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"], creator_secret)
        results_tied = api.get_results(poll["id"])

        # Reopen to get more votes
        api.reopen_poll(poll["id"], creator_secret)

        # Tiebreaker vote arrives
        api.vote(poll["id"], voter_name="Late Lana", vote_type="yes_no", yes_no_choice="yes")
        api.close_poll(poll["id"], creator_secret)
        results_final = api.get_results(poll["id"])

        result.record("tied_results", results_tied)
        result.record("final_results", results_final)
        result.assert_technical("Initially tied", results_tied["winner"] == "tie")
        result.assert_technical("Yes wins after reopen", results_final["winner"] == "yes")
        result.mark_social(
            "FAIR",
            "Reopening a tied poll to collect a tiebreaker vote is a legitimate "
            "use of creator power. The system supports this workflow cleanly.",
        )


class TestLargeGroup:
    """Stress-testing with larger groups."""

    def test_twenty_voter_yes_no(self, api, creator_secret, result):
        """Large group: 20 voters on a yes/no question.

        SCENARIO: A class of 20 students votes on whether to have a study
        session. 12 yes (mix of named/anonymous), 6 no, 2 abstain.

        EXPECTATION: Percentages and counts are correct at scale.
        """
        poll = api.create_poll("Study session before the exam?", "yes_no", creator_secret)

        # 12 yes voters (half named, half anonymous)
        for i in range(6):
            api.vote(poll["id"], voter_name=f"Student {i+1}", vote_type="yes_no", yes_no_choice="yes")
        for _ in range(6):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="yes")

        # 6 no voters (all anonymous)
        for _ in range(6):
            api.vote(poll["id"], vote_type="yes_no", yes_no_choice="no")

        # 2 abstainers
        api.vote(poll["id"], voter_name="Unsure Uma", vote_type="yes_no", is_abstain=True)
        api.vote(poll["id"], vote_type="yes_no", is_abstain=True)

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Yes wins", results["winner"] == "yes")
        result.assert_technical("12 yes votes", results["yes_count"] == 12)
        result.assert_technical("6 no votes", results["no_count"] == 6)
        result.assert_technical("2 abstentions", results["abstain_count"] == 2)
        result.assert_technical("20 total votes", results["total_votes"] == 20)
        result.assert_technical("60% yes", results["yes_percentage"] == 60)
        result.mark_social("FAIR", "Scales cleanly. Mix of named/anonymous voters works at 20-person scale.")

    def test_ten_option_ranked_choice(self, api, creator_secret, result):
        """Large ranked choice: 10 options, 8 voters.

        SCENARIO: A group has too many ideas. 10 restaurant options,
        8 voters with varied preferences. Tests IRV at higher option counts.
        """
        options = [
            "Italian", "Thai", "Mexican", "Indian", "Chinese",
            "Japanese", "Korean", "Ethiopian", "Greek", "American",
        ]
        poll = api.create_poll(
            "Restaurant for team dinner?", "ranked_choice", creator_secret,
            options=options,
        )

        # Diverse preferences
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
            api.vote(poll["id"], voter_name=f"Voter {i+1}", vote_type="ranked_choice",
                     ranked_choices=ranking)

        api.close_poll(poll["id"], creator_secret)
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
            f"With 10 options and 8 voters, IRV took {max_round} rounds to find "
            f"winner: {results['ranked_choice_winner']}. Italian and Thai appear "
            "frequently across ballots — the winner likely has broad second/third "
            "choice support, which is the whole point of ranked choice.",
        )
