"""Tests for time-question algorithm helpers."""

from algorithms.time_question import (
    compute_slot_availability,
    filter_slots_by_min_availability,
    filter_slots_by_min_participants,
    filter_slots_by_exclusion_tolerance,
    _effective_attendance,
    _voter_threshold,
)


class TestFilterSlotsByExclusionTolerance:
    """"Attendance Leeway": keep slots within `tolerance` attendees of the
    best-attended slot (max - count <= tolerance). Default 0 → only the best."""

    def test_zero_keeps_only_best_attended(self):
        slots = ["a", "b", "c"]
        counts = {"a": 4, "b": 3, "c": 2}
        assert filter_slots_by_exclusion_tolerance(slots, counts, 0) == ["a"]

    def test_zero_keeps_all_tied_best(self):
        slots = ["a", "b", "c"]
        counts = {"a": 4, "b": 4, "c": 2}
        assert filter_slots_by_exclusion_tolerance(slots, counts, 0) == ["a", "b"]

    def test_tolerance_widens_field(self):
        slots = ["a", "b", "c"]
        counts = {"a": 4, "b": 3, "c": 1}
        # within 1 of the max (4) → keep a (0 below) and b (1 below), drop c (3 below).
        assert filter_slots_by_exclusion_tolerance(slots, counts, 1) == ["a", "b"]

    def test_large_tolerance_keeps_everything(self):
        slots = ["a", "b", "c"]
        counts = {"a": 4, "b": 3, "c": 1}
        assert filter_slots_by_exclusion_tolerance(slots, counts, 99) == ["a", "b", "c"]

    def test_negative_tolerance_clamped_to_zero(self):
        slots = ["a", "b"]
        counts = {"a": 3, "b": 2}
        assert filter_slots_by_exclusion_tolerance(slots, counts, -5) == ["a"]

    def test_best_slot_always_survives(self):
        # Even with tolerance 0 and a single slot, it's the best → kept.
        assert filter_slots_by_exclusion_tolerance(["a"], {"a": 1}, 0) == ["a"]

    def test_empty_slots_returns_empty(self):
        assert filter_slots_by_exclusion_tolerance([], {}, 0) == []


class TestFilterSlotsByMinParticipants:
    """The "Minimum Participants" gate keeps only slots that at least N people
    can attend (absolute headcount, not relative to the best slot). An empty
    result means no time cleared the bar → the caller cancels the event."""

    def test_keeps_slots_at_or_above_threshold(self):
        slots = ["a", "b", "c"]
        counts = {"a": 3, "b": 2, "c": 1}
        assert filter_slots_by_min_participants(slots, counts, 2) == ["a", "b"]

    def test_no_slot_clears_bar_returns_empty(self):
        # No slot reaches 4 → empty → event's off.
        slots = ["a", "b"]
        counts = {"a": 3, "b": 1}
        assert filter_slots_by_min_participants(slots, counts, 4) == []

    def test_default_two_excludes_single_person_slots(self):
        slots = ["a", "b"]
        counts = {"a": 2, "b": 1}
        assert filter_slots_by_min_participants(slots, counts, 2) == ["a"]

    def test_missing_count_treated_as_zero(self):
        assert filter_slots_by_min_participants(["a"], {}, 2) == []


class TestFilterSlotsByMinAvailability:
    """The filter keeps slots with count >= max_slot_availability * pct/100.

    Semantic: 95 means "slots within 5% of the best slot pass".
    """

    def test_empty_slots_returns_empty(self):
        assert filter_slots_by_min_availability([], {}, 95) == []

    def test_single_slot_always_passes(self):
        assert filter_slots_by_min_availability(
            ["2026-04-18 10:00-11:00"],
            {"2026-04-18 10:00-11:00": 3},
            95,
        ) == ["2026-04-18 10:00-11:00"]

    def test_95_percent_excludes_slot_with_less_than_95_percent_of_max(self):
        slots = ["a", "b", "c"]
        counts = {"a": 100, "b": 95, "c": 90}
        # max=100, threshold=95, min_acceptable=95. "c" (90) fails.
        assert filter_slots_by_min_availability(slots, counts, 95) == ["a", "b"]

    def test_80_percent_baseline_on_top_slot_not_total_respondents(self):
        # 150 respondents total but the most-available slot only has 100.
        # With min_availability_percent=80, threshold is 100*0.80=80, not 150*0.80=120.
        slots = ["a", "b", "c", "d"]
        counts = {"a": 100, "b": 85, "c": 80, "d": 70}
        assert filter_slots_by_min_availability(slots, counts, 80) == ["a", "b", "c"]

    def test_100_percent_keeps_only_max_slots(self):
        slots = ["a", "b", "c"]
        counts = {"a": 50, "b": 50, "c": 49}
        assert filter_slots_by_min_availability(slots, counts, 100) == ["a", "b"]

    def test_low_threshold_keeps_all_slots(self):
        slots = ["a", "b", "c"]
        counts = {"a": 100, "b": 5, "c": 1}
        # min_availability_percent=1 → threshold = 100 * 0.01 = 1.
        assert filter_slots_by_min_availability(slots, counts, 1) == ["a", "b", "c"]

    def test_zero_availability_everywhere_keeps_all(self):
        # When nobody has submitted availability, max_avail is 0, so threshold
        # is 0 and every slot satisfies >= 0.
        slots = ["a", "b"]
        counts = {"a": 0, "b": 0}
        assert filter_slots_by_min_availability(slots, counts, 95) == ["a", "b"]


class TestComputeSlotAvailability:
    def test_counts_voters_available_for_each_slot(self):
        slots = ["2026-04-18 10:00-11:00", "2026-04-18 14:00-15:00"]
        votes = [
            {"voter_day_time_windows": [
                {"day": "2026-04-18", "windows": [{"min": "09:00", "max": "17:00"}]},
            ]},
            {"voter_day_time_windows": [
                {"day": "2026-04-18", "windows": [{"min": "09:00", "max": "12:00"}]},
            ]},
            {"voter_day_time_windows": None},  # no availability, ignored
        ]
        counts = compute_slot_availability(slots, votes)
        assert counts["2026-04-18 10:00-11:00"] == 2
        assert counts["2026-04-18 14:00-15:00"] == 1


class TestEffectiveAttendance:
    """Per-voter conditional attendance: a voter only counts toward a slot if the
    number of attendees meets their personal `voter_min_participants`. The fixed
    point is resolved by greedy removal — _effective_attendance returns the
    stable headcount."""

    def _brute(self, thresholds):
        cur = list(thresholds)
        while True:
            c = len(cur)
            nxt = [t for t in cur if t <= c]
            if len(nxt) == c:
                return c
            cur = nxt

    def test_all_default_thresholds_equal_raw_count(self):
        # No per-voter constraint (threshold 1) → effective == raw.
        assert _effective_attendance([1, 1, 1]) == 3

    def test_empty(self):
        assert _effective_attendance([]) == 0

    def test_high_thresholds_can_zero_out_a_slot(self):
        # Everyone wants >= 4 but only 3 are available → nobody attends.
        assert _effective_attendance([4, 4, 4]) == 0

    def test_partial_cascade(self):
        # One flexible voter (1) survives; two who demand 4 drop out.
        assert _effective_attendance([1, 4, 4]) == 1

    def test_stable_subset(self):
        # The two threshold-2 voters are mutually satisfying; the 5 drops.
        assert _effective_attendance([2, 2, 5]) == 2

    def test_matches_greedy_removal_reference(self):
        import random
        for _ in range(2000):
            n = random.randint(0, 8)
            thresholds = [random.randint(1, 10) for _ in range(n)]
            assert _effective_attendance(thresholds) == self._brute(thresholds)

    def test_voter_threshold_defaults_to_one(self):
        assert _voter_threshold({}) == 1
        assert _voter_threshold({"voter_min_participants": None}) == 1
        assert _voter_threshold({"voter_min_participants": 0}) == 1  # clamped >= 1
        assert _voter_threshold({"voter_min_participants": 3}) == 3


class TestConditionalAttendanceSlotAvailability:
    """compute_slot_availability returns EFFECTIVE counts once voters attach a
    personal `voter_min_participants` threshold."""

    def _avail(self, mins, maxs="17:00", min_participants=None):
        v = {"voter_day_time_windows": [
            {"day": "2026-04-18", "windows": [{"min": mins, "max": maxs}]},
        ]}
        if min_participants is not None:
            v["voter_min_participants"] = min_participants
        return v

    def test_voter_demanding_more_than_available_drops_out(self):
        slots = ["2026-04-18 10:00-11:00"]
        votes = [
            self._avail("09:00"),
            self._avail("09:00", min_participants=3),  # wants 3, only 2 here → drops
        ]
        # The threshold-3 voter can't be satisfied (max 2 available), so they
        # leave, and the remaining single voter (default threshold 1) attends.
        assert compute_slot_availability(slots, votes)["2026-04-18 10:00-11:00"] == 1

    def test_mutually_satisfied_thresholds_all_count(self):
        slots = ["2026-04-18 10:00-11:00"]
        votes = [
            self._avail("09:00", min_participants=3),
            self._avail("09:00", min_participants=3),
            self._avail("09:00", min_participants=3),
        ]
        # Exactly 3 available, all demanding 3 → all satisfied.
        assert compute_slot_availability(slots, votes)["2026-04-18 10:00-11:00"] == 3

    def test_per_slot_independent(self):
        # The threshold-2 voter is only free in the morning; the afternoon slot
        # has a single flexible voter, so the threshold-2 voter's constraint
        # doesn't apply there.
        slots = ["2026-04-18 10:00-11:00", "2026-04-18 14:00-15:00"]
        votes = [
            self._avail("09:00", "17:00"),                       # all day, default
            self._avail("09:00", "12:00", min_participants=2),   # morning only, wants 2
        ]
        counts = compute_slot_availability(slots, votes)
        assert counts["2026-04-18 10:00-11:00"] == 2  # both, both satisfied
        assert counts["2026-04-18 14:00-15:00"] == 1  # only the flexible voter
