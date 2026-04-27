"""Shared time/slot helpers used by the time-poll algorithm.

The participation-poll-specific scheduler that previously lived here was
removed in migration 094 (participation polls are gone). Only the small
helpers consumed by `algorithms.time_poll` remain.
"""


SLOT_INCREMENT_MINUTES = 15


def _time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    parts = time_str.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def _window_effective_end(w_start: int, w_end: int) -> int:
    """Return effective end minutes, adding 24h if the window crosses midnight.

    Equal start/end means a full 24-hour window.
    """
    if w_end <= w_start:
        return w_end + 24 * 60
    return w_end


def _voter_available_at(voter_windows: list[dict], date: str,
                        start_min: int, end_min: int) -> bool:
    """Check if a voter's day_time_windows cover the given slot.

    Handles cross-midnight windows (e.g., 22:00-02:00) where end < start.
    For cross-midnight windows on the given date, the slot's start/end are
    compared against the effective range [w_start, w_end+24h).
    """
    for dtw in voter_windows:
        if dtw["day"] != date:
            continue
        windows = dtw.get("windows", [])
        if not windows:
            # Day selected but no specific windows = available all day
            return True
        for w in windows:
            w_start = _time_to_minutes(w["min"])
            w_end = _time_to_minutes(w["max"])
            eff_end = _window_effective_end(w_start, w_end)
            if start_min >= w_start and end_min <= eff_end:
                return True
    return False
