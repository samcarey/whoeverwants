"""Tests for time-question algorithm helpers."""

from algorithms.time_question import (
    compute_slot_availability,
    filter_slots_by_min_availability,
)


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
