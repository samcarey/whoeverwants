"""Time poll algorithm.

Two-phase scheduling poll:
1. Availability phase: voters enter day/time windows (stored in voter_day_time_windows)
2. Preferences phase: voters react to generated slots with liked_slots / disliked_slots

Slots are generated from the poll creator's day_time_windows + duration_window.
Resolution: fewest-dislikes → most-likes → earliest chronologically.

Slot key format: "YYYY-MM-DD HH:MM-HH:MM"
  e.g. "2026-04-15 09:00-10:00" or "2026-04-15 23:00-01:00" (cross-midnight)
"""

import json

from algorithms.time_slots import (
    SLOT_INCREMENT_MINUTES,
    _time_to_minutes,
    _voter_available_at,
    _window_effective_end,
)


def _minutes_to_time(minutes: int) -> str:
    h = (minutes // 60) % 24
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


def parse_slot_key(slot_str: str) -> tuple[str, int, int]:
    """Parse "YYYY-MM-DD HH:MM-HH:MM" → (date, start_minutes, end_minutes).

    For cross-midnight slots end_minutes < start_minutes.
    """
    date, time_range = slot_str.split(" ")
    start_str, end_str = time_range.split("-")
    return date, _time_to_minutes(start_str), _time_to_minutes(end_str)


def generate_time_poll_slots(poll: dict, votes: list[dict]) -> list[str]:
    """Generate all candidate time slot strings for a time poll.

    Generates slots from the creator's day_time_windows + duration_window at
    15-minute increments. Only includes slots where at least one availability
    voter is present (if any voters have submitted availability; otherwise
    includes all possible slots).

    Returns list of slot key strings sorted by:
      1. Largest duration (desc)
      2. Earliest date + start time (asc)
    """
    day_time_windows = poll.get("day_time_windows") or []
    if isinstance(day_time_windows, str):
        day_time_windows = json.loads(day_time_windows)
    if not day_time_windows:
        return []

    duration_window = poll.get("duration_window")
    if isinstance(duration_window, str):
        duration_window = json.loads(duration_window)

    # Determine duration range (in minutes)
    min_dur = SLOT_INCREMENT_MINUTES
    max_dur = 24 * 60

    if duration_window:
        if duration_window.get("minEnabled") and duration_window.get("minValue") is not None:
            min_dur = max(SLOT_INCREMENT_MINUTES, int(duration_window["minValue"] * 60))
        if duration_window.get("maxEnabled") and duration_window.get("maxValue") is not None:
            max_dur = int(duration_window["maxValue"] * 60)

    avail_votes = [v for v in votes if v.get("voter_day_time_windows")]

    seen: set[tuple] = set()
    slots: list[tuple[str, int, int, int]] = []  # (date, start_min, end_min_normalized, dur_min)

    for dtw in day_time_windows:
        date = dtw["day"]
        windows = dtw.get("windows") or []
        if not windows:
            windows = [{"min": "00:00", "max": "23:59"}]

        for window in windows:
            w_start = _time_to_minutes(window["min"])
            w_end = _time_to_minutes(window["max"])
            eff_end = _window_effective_end(w_start, w_end)

            dur = min_dur
            while dur <= max_dur:
                start = w_start
                while start + dur <= eff_end:
                    end_abs = start + dur  # may exceed 1440 for cross-midnight
                    end_norm = end_abs % 1440

                    key = (date, start, end_norm, dur)
                    if key not in seen:
                        # Check if at least one voter is available (skip if none have submitted)
                        if avail_votes:
                            available = any(
                                _voter_available_at(
                                    v["voter_day_time_windows"], date, start, end_abs
                                )
                                for v in avail_votes
                            )
                            if not available:
                                start += SLOT_INCREMENT_MINUTES
                                continue

                        seen.add(key)
                        slots.append((date, start, end_norm, dur))

                    start += SLOT_INCREMENT_MINUTES
                dur += SLOT_INCREMENT_MINUTES

    # Sort: largest duration desc, then earliest date+start asc
    slots.sort(key=lambda s: (-s[3], s[0], s[1]))

    return [
        f"{date} {_minutes_to_time(start)}-{_minutes_to_time(end)}"
        for date, start, end, _ in slots
    ]


def _keep_longest_per_start_time(slots: list[str]) -> list[str]:
    """For each (date, start_time), keep only the slot with the longest duration.

    When the poll allows a duration range (e.g. 30 min – 2 h), multiple slots
    share the same start time but differ in end time.  Voters only need to react
    to one representative per start time: the longest available option.

    The original sort order (longest duration first, then earliest start) is
    preserved in the returned list.
    """
    best: dict[tuple[str, int], tuple[str, int]] = {}  # (date, start_min) → (slot_str, duration)

    for slot_str in slots:
        date, start_min, end_min = parse_slot_key(slot_str)
        dur = end_min - start_min
        if dur <= 0:
            dur += 24 * 60  # cross-midnight

        key = (date, start_min)
        if key not in best or dur > best[key][1]:
            best[key] = (slot_str, dur)

    best_set = {slot_str for slot_str, _ in best.values()}
    return [s for s in slots if s in best_set]


def filter_slots_by_min_availability(
    slots: list[str],
    availability_counts: dict[str, int],
    min_availability_percent: int,
) -> list[str]:
    """Keep slots whose availability is at least `min_availability_percent`% of the
    most-available slot's count.

    Basing the filter on the most-available slot (not total respondents) keeps
    the poll robust when many voters say they're unavailable.
    """
    max_avail = max(availability_counts.values(), default=0)
    min_acceptable = max_avail * (min_availability_percent / 100.0)
    return [s for s in slots if availability_counts.get(s, 0) >= min_acceptable]


def compute_slot_availability(options: list[str], votes: list[dict]) -> dict[str, int]:
    """Count how many availability voters cover each time slot.

    Returns dict mapping slot_key → voter count.
    """
    avail_votes = [v for v in votes if v.get("voter_day_time_windows")]
    counts: dict[str, int] = {}

    for slot_str in options:
        date, start_min, end_min = parse_slot_key(slot_str)
        # Reconstruct absolute end for cross-midnight slots
        eff_end = end_min if end_min > start_min else end_min + 24 * 60
        count = sum(
            1
            for v in avail_votes
            if _voter_available_at(v["voter_day_time_windows"], date, start_min, eff_end)
        )
        counts[slot_str] = count

    return counts


def _pick_winner_from_reactions(options: list[str], votes: list[dict]) -> tuple[str | None, dict[str, int], dict[str, int]]:
    """Pick the winning slot from like/dislike reactions.

    Algorithm:
    1. Fewest dislikes across all preference voters.
    2. Most likes among those.
    3. Earliest chronologically to break ties.

    Returns (winner, like_counts, dislike_counts).
    """
    pref_votes = [
        v for v in votes
        if v.get("liked_slots") is not None or v.get("disliked_slots") is not None
    ]

    like_counts: dict[str, int] = {s: 0 for s in options}
    dislike_counts: dict[str, int] = {s: 0 for s in options}

    for v in pref_votes:
        for s in (v.get("liked_slots") or []):
            if s in like_counts:
                like_counts[s] += 1
        for s in (v.get("disliked_slots") or []):
            if s in dislike_counts:
                dislike_counts[s] += 1

    if not options:
        return None, like_counts, dislike_counts

    # Step 1: fewest dislikes
    min_dislikes = min(dislike_counts[s] for s in options)
    candidates = [s for s in options if dislike_counts[s] == min_dislikes]

    # Step 2: most likes
    max_likes = max(like_counts[s] for s in candidates)
    candidates = [s for s in candidates if like_counts[s] == max_likes]

    # Step 3: earliest chronologically
    candidates.sort(key=lambda s: parse_slot_key(s)[:2])  # (date, start_min)
    winner = candidates[0] if candidates else None

    return winner, like_counts, dislike_counts


def calculate_time_poll_results(poll: dict, votes: list[dict]) -> dict:
    """Calculate results for a time poll.

    poll.options already contains only the filtered, deduped slots (set at finalization).

    Returns dict with:
        availability_counts: {slot_key: count}
        max_availability: int
        winner: slot_key | None
        like_counts: {slot_key: count}
        dislike_counts: {slot_key: count}
    """
    raw_options = poll.get("options")
    if raw_options is None:
        return {
            "availability_counts": {},
            "max_availability": 0,
            "winner": None,
            "like_counts": {},
            "dislike_counts": {},
        }

    options: list[str] = json.loads(raw_options) if isinstance(raw_options, str) else raw_options
    if not options:
        return {
            "availability_counts": {},
            "max_availability": 0,
            "winner": None,
            "like_counts": {},
            "dislike_counts": {},
        }

    availability_counts = compute_slot_availability(options, votes)
    max_avail = max(availability_counts.values(), default=0)

    winner, like_counts, dislike_counts = _pick_winner_from_reactions(options, votes)

    return {
        "availability_counts": availability_counts,
        "max_availability": max_avail,
        "winner": winner,
        "like_counts": like_counts,
        "dislike_counts": dislike_counts,
    }
