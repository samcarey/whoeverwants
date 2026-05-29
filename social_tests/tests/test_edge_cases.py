"""Edge Cases & Social Dynamics — vote changes, creator power, scale, authz.

Probes the boundaries: people changing their minds, creators managing their
polls, large groups, and the identity-based authorization that replaced the
old shared `creator_secret`.
"""


class TestVoteEditing:
    """What happens when people change their minds."""

    def test_change_vote_flips_result(self, api, result):
        """Vote change: a voter switches sides and flips the outcome.

        SCENARIO: 3-2 for yes. One yes-voter changes to no, making it 2-3.

        EXPECTATION: Results reflect the final state, not vote history.
        """
        poll = api.create_poll("Go hiking this weekend?", "yes_no", creator_name="Org")

        v1 = api.vote(poll["id"], "Swing Voter", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Bea", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Cal", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Dot", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "Eli", vote_type="yes_no", yes_no_choice="no")

        results_before = api.get_results(poll["id"])
        api.edit_vote(poll["id"], v1["id"], "Swing Voter", vote_type="yes_no", yes_no_choice="no")
        results_after = api.get_results(poll["id"])

        result.record("before", results_before)
        result.record("after", results_after)
        result.assert_technical("Was yes before", results_before["winner"] == "yes")
        result.assert_technical("Flipped to no", results_after["winner"] == "no")
        result.assert_technical("No count is now 3", results_after["no_count"] == 3)
        result.assert_technical("Yes count is now 2", results_after["yes_count"] == 2)
        result.mark_social(
            "FAIR",
            "Vote editing is transparent — the result reflects current "
            "preferences, not historical ones. Correct for decision-making, "
            "though it means early/preliminary results are provisional.",
        )

    def test_edit_ranked_choice(self, api, result):
        """Ranked choice edit: voter reorders their preferences.

        SCENARIO: A voter initially ranks A > B > C, then changes to C > A > B.
        Tests clean ranking replacement.
        """
        poll = api.create_poll("Favorite?", "ranked_choice", creator_name="Org", options=["A", "B", "C"])

        v1 = api.vote(poll["id"], "Fickle Fred", vote_type="ranked_choice", ranked_choices=["A", "B", "C"])
        api.vote(poll["id"], "Steady Sue", vote_type="ranked_choice", ranked_choices=["C", "A", "B"])
        api.vote(poll["id"], "Calm Cal", vote_type="ranked_choice", ranked_choices=["C", "B", "A"])

        api.edit_vote(poll["id"], v1["id"], "Fickle Fred", vote_type="ranked_choice", ranked_choices=["C", "A", "B"])

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("C wins after edit", results["ranked_choice_winner"] == "C")
        result.mark_social(
            "FAIR",
            "Ranked-choice editing is clean — the edited ballot is treated like "
            "any other, with no trace of the original ranking.",
        )


class TestCreatorPower:
    """Power dynamics of poll creation and management."""

    def test_creator_closes_losing_poll(self, api, result):
        """Creator closes a poll they're losing.

        SCENARIO: The creator votes yes on their own idea, but the group votes
        no. The creator closes the poll. The outcome still reflects the group.

        EXPECTATION: Closing doesn't change the result.
        """
        poll = api.create_poll("My idea is great, right?", "yes_no", creator_name="Ego Ed")

        api.vote(poll["id"], "Ego Ed", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "Honest A", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "Honest B", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "Honest C", vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("No wins (1-3)", results["winner"] == "no")
        result.assert_technical("No count is 3", results["no_count"] == 3)
        result.mark_social(
            "FAIR",
            "The creator has administrative power (close/reopen) but only one "
            "vote. Closing can't rewrite the outcome — an important integrity "
            "guarantee.",
        )

    def test_creator_reopens_to_break_tie(self, api, result):
        """Creator reopens a tied poll to collect a tiebreaker vote.

        SCENARIO: Poll is 2-2. Creator reopens, one more person votes yes.

        EXPECTATION: Reopening to gather more input is a legitimate workflow.
        """
        poll = api.create_poll("Team lunch this Friday?", "yes_no", creator_name="Org")

        api.vote(poll["id"], "A", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "B", vote_type="yes_no", yes_no_choice="yes")
        api.vote(poll["id"], "C", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "D", vote_type="yes_no", yes_no_choice="no")

        api.close_poll(poll["id"])
        tied = api.get_results(poll["id"])

        api.reopen_poll(poll["id"])
        api.vote(poll["id"], "Late Lana", vote_type="yes_no", yes_no_choice="yes")
        api.close_poll(poll["id"])
        final = api.get_results(poll["id"])

        result.record("tied_results", tied)
        result.record("final_results", final)
        result.assert_technical("Initially tied", tied["winner"] == "tie")
        result.assert_technical("Yes wins after reopen", final["winner"] == "yes")
        result.mark_social(
            "FAIR",
            "Reopening a tied poll for a tiebreaker is a clean, legitimate use "
            "of creator power. The decision history (tie → reopened → resolved) "
            "stays visible.",
        )


class TestAuthorization:
    """Identity-based authorization replaced the old shared creator_secret.

    The creator of a poll is the account resolved from the request — either a
    signed-in user or a lightweight account auto-minted for an anonymous
    creator and bound to their device. Only that identity can administer the
    poll."""

    def test_stranger_cannot_close_or_reopen(self, api, result):
        """A different device cannot close, reopen, or cut off someone's poll.

        SCENARIO: The organizer creates a poll. A stranger (different device)
        tries to close it, then reopen it.

        EXPECTATION: Both attempts are rejected (403). Administrative control
        is bound to the creator's identity, not a shareable secret.
        """
        poll = api.create_poll("Whose call is it?", "yes_no", creator_name="Owner")
        api.vote(poll["id"], "Owner", vote_type="yes_no", yes_no_choice="yes")

        stranger = api.stranger()
        close_resp = stranger.close_poll(poll["id"], expect=403)
        reopen_resp = stranger.reopen_poll(poll["id"], expect=403)

        result.record("close_status", close_resp.status_code)
        result.record("reopen_status", reopen_resp.status_code)
        result.assert_technical("Stranger close rejected (403)", close_resp.status_code == 403)
        result.assert_technical("Stranger reopen rejected (403)", reopen_resp.status_code == 403)
        result.mark_social(
            "INSIGHT",
            "Replacing the shared secret with device-bound identity closes a "
            "real loophole (anyone who saw the old secret in a URL could "
            "administer the poll). The trade-off: an anonymous creator who "
            "loses their device/browser loses admin control forever — there's "
            "no recovery without a real account. The app nudges signed-in "
            "creators to add a durable sign-in method for exactly this reason.",
        )


class TestLargeGroup:
    """Stress-testing with larger groups."""

    def test_twenty_voter_yes_no(self, api, result):
        """Large group: 20 named voters on a yes/no question.

        SCENARIO: A class of 20 votes on a study session. 12 yes, 6 no, 2
        abstain.

        EXPECTATION: Percentages and counts are correct at scale.
        """
        poll = api.create_poll("Study session before the exam?", "yes_no", creator_name="TA")

        for i in range(12):
            api.vote(poll["id"], f"Student {i+1}", vote_type="yes_no", yes_no_choice="yes")
        for i in range(6):
            api.vote(poll["id"], f"Student {i+13}", vote_type="yes_no", yes_no_choice="no")
        api.vote(poll["id"], "Unsure Uma", vote_type="yes_no", is_abstain=True)
        api.vote(poll["id"], "Maybe Max", vote_type="yes_no", is_abstain=True)

        api.close_poll(poll["id"])
        results = api.get_results(poll["id"])

        result.record("results", results)
        result.assert_technical("Yes wins", results["winner"] == "yes")
        result.assert_technical("12 yes", results["yes_count"] == 12)
        result.assert_technical("6 no", results["no_count"] == 6)
        result.assert_technical("2 abstain", results["abstain_count"] == 2)
        result.assert_technical("20 total", results["total_votes"] == 20)
        result.assert_technical("60% yes", results["yes_percentage"] == 60)
        result.mark_social("FAIR", "Scales cleanly to a 20-person named roster.")
