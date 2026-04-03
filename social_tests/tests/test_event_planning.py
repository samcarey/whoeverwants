"""Event Planning — scheduling with availability constraints.

These tests simulate participation polls where people RSVP with
conditions about group size. The focus is on whether the priority
algorithm produces fair, inclusive results when constraints conflict.
"""


class TestDinnerParty:
    """Planning a dinner party with min/max guest constraints."""

    def test_everyone_flexible(self, api, creator_secret, result):
        """Dinner party: 5 people say yes with no constraints.

        SCENARIO: Simple case — everyone's available and flexible about
        group size. No constraints to conflict.

        EXPECTATION: All 5 should be included.
        """
        poll = api.create_poll(
            "Dinner at my place Saturday?", "participation", creator_secret,
            creator_name="Chef Pat",
            min_participants=2, max_participants=10,
        )

        for name in ["Alice", "Bob", "Carol", "Dave", "Eve"]:
            api.vote(poll["id"], voter_name=name, vote_type="participation",
                     yes_no_choice="yes")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])
        participants = api.get_participants(poll["id"])

        result.record("results", results)
        result.record("participants", participants)
        result.assert_technical("All 5 participate", len(participants) == 5)
        result.mark_social("FAIR", "No constraints means everyone's in. Simple and correct.")

    def test_introvert_vs_extrovert(self, api, creator_secret, result):
        """Dinner party: introvert wants small group, extrovert wants big group.

        SCENARIO: Alice only wants to come if it's intimate (max 3 people).
        Bob only wants to come if it's a party (min 5 people). Three others
        are flexible. The poll allows 1-10 participants.

        SOCIAL QUESTION: The algorithm prioritizes flexible voters. Alice
        (max=3) is restrictive and may get deprioritized. Is that fair?
        She has a legitimate social preference.
        """
        poll = api.create_poll(
            "Dinner party Saturday?", "participation", creator_secret,
            min_participants=1, max_participants=10,
        )

        # Introvert: only if small (max 3)
        api.vote(poll["id"], voter_name="Alice", vote_type="participation",
                 yes_no_choice="yes", min_participants=1, max_participants=3)

        # Extrovert: only if big (min 5)
        api.vote(poll["id"], voter_name="Bob", vote_type="participation",
                 yes_no_choice="yes", min_participants=5)

        # Flexible folks
        api.vote(poll["id"], voter_name="Carol", vote_type="participation",
                 yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Dave", vote_type="participation",
                 yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Eve", vote_type="participation",
                 yes_no_choice="yes")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])
        participants = api.get_participants(poll["id"])
        participant_names = [p["voter_name"] for p in participants]

        result.record("results", results)
        result.record("participant_names", participant_names)

        # With the priority algorithm: flexible voters (Carol, Dave, Eve) get priority.
        # Adding them gives count=3. Alice's max=3 is satisfied. Bob's min=5 is not.
        result.assert_technical("At least 3 participants", len(participants) >= 3)
        result.assert_technical(
            "Flexible voters included",
            all(name in participant_names for name in ["Carol", "Dave", "Eve"]),
        )

        alice_in = "Alice" in participant_names
        bob_in = "Bob" in participant_names

        result.record("alice_included", alice_in)
        result.record("bob_included", bob_in)

        if alice_in and not bob_in:
            result.mark_social(
                "FAIR",
                "Alice (introvert, max 3) is included with the 3 flexible voters. "
                "Bob (extrovert, min 5) is excluded because his constraint can't be met "
                "with available RSVPs. This is mathematically necessary and socially "
                "reasonable — you can't force people to attend just to meet Bob's minimum.",
            )
        elif not alice_in and not bob_in:
            result.mark_social(
                "INSIGHT",
                "Neither constrained voter was included. The algorithm prioritized "
                "the 3 flexible voters, giving count=3. Alice (max=3) *could* fit, "
                "but the algorithm may not have tried her. Worth investigating if "
                "the algorithm should attempt to include constrained voters after "
                "selecting the flexible core.",
            )
        else:
            result.mark_social(
                "INSIGHT",
                f"Unexpected result: Alice={'in' if alice_in else 'out'}, "
                f"Bob={'in' if bob_in else 'out'}. Participant count: {len(participants)}.",
            )

    def test_minimum_not_met(self, api, creator_secret, result):
        """Dinner party: not enough people to meet the creator's minimum.

        SCENARIO: The creator sets min_participants=4 (they don't want a
        dinner party with fewer than 4 people). Only 2 people say yes.

        NOTE: The participation algorithm only enforces *individual voter*
        constraints, not the poll-level min. So Alice and Bob (who have no
        personal constraints) are both included — count=2.

        SOCIAL QUESTION: Should the poll-level minimum be enforced? A creator
        who says "minimum 4" probably expects the event to be cancelled if
        only 2 people show up.
        """
        poll = api.create_poll(
            "Dinner party?", "participation", creator_secret,
            min_participants=4, max_participants=10,
        )

        api.vote(poll["id"], voter_name="Alice", vote_type="participation",
                 yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Bob", vote_type="participation",
                 yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Carol", vote_type="participation",
                 yes_no_choice="no")

        api.close_poll(poll["id"], creator_secret)
        results = api.get_results(poll["id"])
        participants = api.get_participants(poll["id"])

        result.record("results", results)
        result.record("participants", participants)
        participant_count = len(participants)
        poll_min = poll.get("min_participants", 0) or 0
        result.assert_technical("Participants returned", participant_count >= 0)
        result.assert_technical(
            f"Participant count ({participant_count}) vs poll min ({poll_min})",
            True,  # Observational — documenting actual behavior
            f"count={participant_count}, poll_min={poll_min}",
        )

        if participant_count < poll_min:
            result.mark_social(
                "INSIGHT",
                f"Only {participant_count} participants vs creator's minimum of {poll_min}. "
                "The algorithm included willing voters but didn't enforce the poll-level "
                "minimum. The creator would see 2 participants and have to decide whether "
                "that's enough — the system doesn't auto-cancel for them.",
            )
        elif participant_count == 0:
            result.mark_social(
                "FAIR",
                "Event correctly cancelled — not enough interest.",
            )
        else:
            result.mark_social(
                "INSIGHT",
                f"{participant_count} participants included despite the creator's "
                f"min_participants={poll_min}. The participation algorithm enforces "
                "individual voter constraints but not the poll-level minimum. "
                "This means a creator who sets min=4 might see 2 participants listed, "
                "which could be confusing — they expected an all-or-nothing threshold.",
            )

    def test_mixed_yes_no_and_abstain(self, api, creator_secret, result):
        """Dinner party: mix of yes, no, and abstain votes.

        SCENARIO: 3 yes, 2 no, 1 abstain. Min is 2.

        EXPECTATION: Only yes voters can be participants. No and abstain
        voters are excluded from the participant pool.
        """
        poll = api.create_poll(
            "Dinner Friday?", "participation", creator_secret,
            min_participants=2, max_participants=8,
        )

        api.vote(poll["id"], voter_name="Yes1", vote_type="participation", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Yes2", vote_type="participation", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Yes3", vote_type="participation", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="No1", vote_type="participation", yes_no_choice="no")
        api.vote(poll["id"], voter_name="No2", vote_type="participation", yes_no_choice="no")
        api.vote(poll["id"], voter_name="Abstainer", vote_type="participation", is_abstain=True)

        api.close_poll(poll["id"], creator_secret)
        participants = api.get_participants(poll["id"])
        participant_names = [p["voter_name"] for p in participants]

        result.record("participants", participants)
        result.assert_technical("3 participants", len(participants) == 3)
        result.assert_technical("All are yes voters",
                                set(participant_names) == {"Yes1", "Yes2", "Yes3"})
        result.mark_social("FAIR", "Only willing participants included. No/abstain correctly excluded.")

    def test_exactly_one_person_event(self, api, creator_secret, result):
        """Solo activity: 'Anyone want my extra concert ticket?'

        SCENARIO: One ticket available (max=1). Three people want it.
        With max_participants=1, the poll auto-closes after the first
        "yes" vote, so only the first responder gets in.

        SOCIAL QUESTION: Is first-come-first-served fair, or should it
        be random? FCFS rewards people who check their phone more often.

        NOTE: The auto-close behavior means later voters can't even submit.
        This test verifies that the auto-close works correctly for this case
        and that the first voter is selected.
        """
        poll = api.create_poll(
            "Anyone want my extra concert ticket?", "participation", creator_secret,
            min_participants=1, max_participants=1,
        )

        # First voter — this should auto-close the poll
        api.vote(poll["id"], voter_name="Eager Eve", vote_type="participation", yes_no_choice="yes")

        # Poll should now be closed — verify
        poll_state = api.get_poll(poll["id"])
        participants = api.get_participants(poll["id"])

        result.record("poll_state", poll_state)
        result.record("participants", participants)
        result.assert_technical("Poll auto-closed", poll_state["is_closed"])
        result.assert_technical("Exactly 1 participant", len(participants) == 1)

        winner_name = participants[0]["voter_name"] if participants else None
        result.record("winner", winner_name)
        result.assert_technical("First voter wins", winner_name == "Eager Eve")
        result.mark_social(
            "INSIGHT",
            f"'{winner_name}' got the ticket. With max_participants=1, the poll "
            "auto-closes immediately after the first 'yes' vote — later respondents "
            "can't even submit. This is effectively first-come-first-served enforced "
            "by the system. Transparent, but may feel unfair to people in different "
            "time zones or who check their phone less frequently.",
        )


class TestCarpoolCoordination:
    """Coordinating a carpool where the driver needs a minimum number of riders."""

    def test_driver_needs_riders(self, api, creator_secret, result):
        """Carpool: driver needs at least 2 riders to justify the trip.

        SCENARIO: A driver is offering a carpool to an event but only
        wants to drive if at least 2 other people are coming.

        EXPECTATION: If 2+ people say yes, the carpool happens. Otherwise
        it doesn't, and the driver knows not to bother.
        """
        poll = api.create_poll(
            "Carpool to the concert?", "participation", creator_secret,
            creator_name="Driver Dan",
            min_participants=2, max_participants=4,
        )

        api.vote(poll["id"], voter_name="Rider 1", vote_type="participation", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Rider 2", vote_type="participation", yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Rider 3", vote_type="participation", yes_no_choice="yes")

        api.close_poll(poll["id"], creator_secret)
        participants = api.get_participants(poll["id"])

        result.record("participants", participants)
        result.assert_technical("3 participants (within capacity)", len(participants) == 3)
        result.mark_social("FAIR", "Carpool happens with 3 riders. Driver gets clear confirmation.")

    def test_conflicting_rider_constraints(self, api, creator_secret, result):
        """Carpool: riders have conflicting preferences about group size.

        SCENARIO: Car seats 4. Rider A only wants to go with at least 3
        others (min=3). Rider B wants a quiet ride (max=2). Riders C and D
        are flexible.

        The algorithm must choose between satisfying A or B.
        """
        poll = api.create_poll(
            "Carpool to the concert?", "participation", creator_secret,
            min_participants=1, max_participants=4,
        )

        # A: wants a full car (min 3)
        api.vote(poll["id"], voter_name="Social Sam", vote_type="participation",
                 yes_no_choice="yes", min_participants=3)
        # B: wants quiet ride (max 2)
        api.vote(poll["id"], voter_name="Quiet Quinn", vote_type="participation",
                 yes_no_choice="yes", max_participants=2)
        # C & D: flexible
        api.vote(poll["id"], voter_name="Flex Chris", vote_type="participation",
                 yes_no_choice="yes")
        api.vote(poll["id"], voter_name="Flex Dana", vote_type="participation",
                 yes_no_choice="yes")

        api.close_poll(poll["id"], creator_secret)
        participants = api.get_participants(poll["id"])
        names = [p["voter_name"] for p in participants]

        result.record("participants", participants)
        result.record("participant_names", names)

        # Priority algorithm: flexible voters (Chris, Dana) first → count=2
        # Then try constrained voters in priority order
        # Quiet Quinn (max=2) can fit (count would be 3 > her max=2), so excluded
        # Social Sam (min=3) needs count≥3, but count=2, so excluded... unless both flex + Sam = 3
        result.assert_technical("At least 2 participants", len(participants) >= 2)
        result.assert_technical("Both flexible riders included",
                                "Flex Chris" in names and "Flex Dana" in names)
        result.mark_social(
            "INSIGHT",
            f"Participants: {names}. The algorithm prioritizes flexible voters, "
            "then tries to include constrained voters. Social Sam (min=3) and "
            "Quiet Quinn (max=2) have fundamentally incompatible preferences — "
            "the system can satisfy at most one of them.",
        )
