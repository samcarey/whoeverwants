"""Time Coordination — the two-phase "when can everyone meet?" flow.

A time question is the app's scheduling primitive (a Doodle/when2meet
replacement). It runs in up to two phases:

  Phase 1 (availability): voters declare which windows they can make. The
  poll's `options` stay null while this is open.
  Phase 2 (preferences): at the availability cutoff the server finalizes the
  candidate slots (filtered by `min_availability_percent`), then voters
  like/dislike specific slots. The winner is the slot with the fewest
  dislikes, then most likes, then earliest.

A creator can also skip Phase 1 ("Ask for Availability before Voting" off):
slots are finalized from the creator's own windows at create time and the
poll opens straight into preferences.
"""

DAY = "2026-06-05"  # a near-future Friday


class TestTwoPhaseScheduling:
    """The full availability → cutoff → preferences → winner lifecycle."""

    def test_availability_then_preferences(self, api, result):
        """Five people coordinate a 1-hour meeting Friday morning.

        SCENARIO: The organizer opens a 09:00-12:00 window. Everyone submits
        the hours they can make (Phase 1). The organizer cuts off availability;
        the server finalizes the candidate hour-slots. Then everyone marks the
        slots they like or can't do (Phase 2). The slot everyone likes wins.

        EXPECTATION: options are null during Phase 1; finalized after cutoff;
        the unanimously-liked slot wins.
        """
        poll = api.create_poll(
            "When can we meet Friday?", "time", creator_name="Planner",
            prephase_deadline_minutes=120,
            day_time_windows=[{"day": DAY, "windows": [{"min": "09:00", "max": "12:00"}]}],
            duration_window={"minEnabled": True, "minValue": 1, "maxEnabled": True, "maxValue": 1},
            min_availability_percent=50,
            suggestion_deadline_minutes=120,  # signals "this question has an availability phase"
        )

        result.assert_technical("Phase 1: options are null (availability open)",
                                poll["questions"][0].get("options") is None)

        api.submit_availability(poll["id"], "Ana", DAY, [{"min": "09:00", "max": "12:00"}])
        api.submit_availability(poll["id"], "Ben", DAY, [{"min": "09:00", "max": "12:00"}])
        api.submit_availability(poll["id"], "Cas", DAY, [{"min": "10:00", "max": "12:00"}])
        api.submit_availability(poll["id"], "Dee", DAY, [{"min": "09:00", "max": "11:00"}])
        api.submit_availability(poll["id"], "Eli", DAY, [{"min": "09:00", "max": "12:00"}])

        api.cutoff_availability(poll["id"])
        finalized = api.get_results(poll["id"])
        slots = finalized.get("options") or []
        target = f"{DAY} 10:00-11:00"

        result.record("finalized_slot_count", len(slots))
        result.record("availability_counts", finalized.get("availability_counts"))
        result.assert_technical("Phase 2: slots finalized after cutoff", len(slots) > 0)
        result.assert_technical("Common 10-11 slot survived", target in slots)

        for name in ["Ana", "Ben", "Cas", "Dee", "Eli"]:
            api.submit_preferences(poll["id"], name, liked=[target])

        api.close_poll(poll["id"])
        res = api.get_results(poll["id"])

        result.record("winner", res.get("winner"))
        result.assert_technical("Winner is the unanimously-liked slot", res.get("winner") == target)
        result.mark_social(
            "FAIR",
            "The two-phase flow is genuinely useful — it does what when2meet does "
            "but inside the same group hub. The friction worth watching: it's "
            "TWO rounds of engagement (submit availability, come back to mark "
            "preferences). In practice many groups will only complete round one. "
            "RECOMMENDATION: for small groups, a result that's already decisive "
            "after availability (one slot everyone can make) could auto-surface "
            "without forcing the preference round.",
        )

    def test_min_availability_filters_unpopular_slots(self, api, result):
        """A strict availability threshold keeps only slots most can attend.

        SCENARIO: With `min_availability_percent=100`, only slots that the
        maximum number of available voters can attend survive the cutoff. A
        slot just one person can make is dropped.

        EXPECTATION: every finalized slot has the maximum availability count;
        the all-can-attend slot is in, the few-can-attend slot is out.
        """
        poll = api.create_poll(
            "Best hour for the standup?", "time", creator_name="Planner",
            prephase_deadline_minutes=120,
            day_time_windows=[{"day": DAY, "windows": [{"min": "09:00", "max": "12:00"}]}],
            duration_window={"minEnabled": True, "minValue": 1, "maxEnabled": True, "maxValue": 1},
            min_availability_percent=100,
            suggestion_deadline_minutes=120,
        )

        # Ana, Ben available all morning; Cas only 10:00-11:00.
        api.submit_availability(poll["id"], "Ana", DAY, [{"min": "09:00", "max": "12:00"}])
        api.submit_availability(poll["id"], "Ben", DAY, [{"min": "09:00", "max": "12:00"}])
        api.submit_availability(poll["id"], "Cas", DAY, [{"min": "10:00", "max": "11:00"}])

        api.cutoff_availability(poll["id"])
        res = api.get_results(poll["id"])
        slots = res.get("options") or []
        counts = res.get("availability_counts") or {}
        max_avail = res.get("max_availability")

        result.record("finalized_slots", slots)
        result.record("max_availability", max_avail)
        all_at_max = all(counts.get(s) == max_avail for s in slots)
        result.assert_technical("Slots remain after a strict filter", len(slots) > 0)
        result.assert_technical("Every surviving slot has max availability", all_at_max)
        result.assert_technical("The all-can-attend 10-11 slot survived", f"{DAY} 10:00-11:00" in slots)
        result.assert_technical("A morning slot Cas can't make was dropped", f"{DAY} 09:00-10:00" not in slots)
        result.mark_social(
            "INSIGHT",
            "min_availability is the knob that decides 'everyone must be able to "
            "come' vs 'pick the best we can get.' At 100% it can wipe out every "
            "slot if no single time works for everyone — leaving an empty "
            "ballot. RECOMMENDATION: when a strict threshold finalizes to zero "
            "slots, fall back to the best-attended slot(s) with a clear 'no time "
            "worked for everyone; here's the closest' message rather than an "
            "empty result.",
        )


class TestNoAvailabilityPhase:
    """'Ask for Availability before Voting' OFF — open straight to preferences."""

    def test_opens_straight_to_preferences(self, api, result):
        """The creator proposes fixed time options; voters react immediately.

        SCENARIO: The organizer already knows the candidate times and doesn't
        want a separate availability round. They create the time poll without
        an availability phase, so the slots are finalized from their own
        windows at creation and voters can like/dislike right away.

        EXPECTATION: options are populated at create (no Phase 1); preferences
        decide the winner.
        """
        poll = api.create_poll(
            "Pick a slot for the demo", "time", creator_name="Planner",
            day_time_windows=[{"day": DAY, "windows": [{"min": "14:00", "max": "16:00"}]}],
            duration_window={"minEnabled": True, "minValue": 1, "maxEnabled": True, "maxValue": 1},
            min_availability_percent=50,
            # no suggestion_deadline_minutes -> no availability phase
        )

        slots = poll["questions"][0].get("options")
        result.record("options_at_create", slots)
        result.assert_technical("Slots finalized at create (no availability phase)",
                                slots is not None and len(slots) > 0)

        target = f"{DAY} 14:00-15:00"
        api.submit_preferences(poll["id"], "Ana", liked=[target])
        api.submit_preferences(poll["id"], "Ben", liked=[target])
        api.submit_preferences(poll["id"], "Cas", liked=[target], disliked=[f"{DAY} 15:00-16:00"])

        api.close_poll(poll["id"])
        res = api.get_results(poll["id"])

        result.record("winner", res.get("winner"))
        result.assert_technical("Winner is the liked slot", res.get("winner") == target)
        result.mark_social(
            "FAIR",
            "Skipping the availability round is the right default when the "
            "organizer already has candidate times — it collapses scheduling to "
            "one quick round of taps. Good that the app offers both modes; the "
            "two-phase flow is for open-ended 'when is everyone free?', this one "
            "for 'which of these three times works?'.",
        )
