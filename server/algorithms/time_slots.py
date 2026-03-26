"""Time slot optimization algorithm for participation polls with time windows.

Given a poll's day_time_windows, duration_window, and voters' availability,
finds the optimal time slot that:
1. Maximizes the number of participants
2. Maximizes the event duration (among ties)
3. Is as soon as possible (among ties)

All times are evaluated in 15-minute increments.
"""

from dataclasses import dataclass


SLOT_INCREMENT_MINUTES = 15


@dataclass
class CandidateSlot:
    date: str  # YYYY-MM-DD
    start_minutes: int  # minutes since midnight
    duration_minutes: int
    participant_vote_ids: list[str]
    participant_names: list[str]

    @property
    def end_minutes(self) -> int:
        return self.start_minutes + self.duration_minutes

    @property
    def participant_count(self) -> int:
        return len(self.participant_vote_ids)

    @property
    def duration_hours(self) -> float:
        return self.duration_minutes / 60.0

    @property
    def start_time_str(self) -> str:
        return _minutes_to_time(self.start_minutes)

    @property
    def end_time_str(self) -> str:
        return _minutes_to_time(self.end_minutes)


@dataclass
class TimeSlotRound:
    round_number: int
    slot_date: str
    slot_start_time: str
    slot_end_time: str
    duration_hours: float
    participant_count: int
    participant_vote_ids: list[str]
    participant_names: list[str]
    is_winner: bool


def _time_to_minutes(time_str: str) -> int:
    """Convert HH:MM to minutes since midnight."""
    parts = time_str.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def _minutes_to_time(minutes: int) -> str:
    """Convert minutes since midnight to HH:MM."""
    h = (minutes // 60) % 24
    m = minutes % 60
    return f"{h:02d}:{m:02d}"


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


def _voter_duration_ok(voter_duration: dict | None, duration_minutes: int) -> bool:
    """Check if the slot duration satisfies the voter's duration constraints."""
    if not voter_duration:
        return True
    duration_hours = duration_minutes / 60.0

    if voter_duration.get("minEnabled") and voter_duration.get("minValue") is not None:
        if duration_hours < voter_duration["minValue"]:
            return False
    if voter_duration.get("maxEnabled") and voter_duration.get("maxValue") is not None:
        if duration_hours > voter_duration["maxValue"]:
            return False
    return True


def _voter_participant_count_ok(vote: dict, count: int) -> bool:
    """Check if the participant count satisfies a voter's constraints."""
    min_p = vote.get("min_participants")
    max_p = vote.get("max_participants")
    if min_p is not None and count < min_p:
        return False
    if max_p is not None and count > max_p:
        return False
    return True


def calculate_time_slot_rounds(
    poll: dict,
    votes: list[dict],
) -> list[TimeSlotRound]:
    """Calculate optimal time slots for a participation poll.

    Args:
        poll: Poll row dict with day_time_windows, duration_window, min/max_participants
        votes: List of vote row dicts

    Returns:
        List of TimeSlotRound objects grouped into elimination rounds.
    """
    day_time_windows = poll.get("day_time_windows")
    if not day_time_windows:
        return []

    duration_window = poll.get("duration_window")

    # Determine duration range (in minutes)
    min_duration_min = SLOT_INCREMENT_MINUTES  # at least 15 minutes
    max_duration_min = 24 * 60  # 24 hours max

    if duration_window:
        if duration_window.get("minEnabled") and duration_window.get("minValue") is not None:
            min_duration_min = max(SLOT_INCREMENT_MINUTES, int(duration_window["minValue"] * 60))
        if duration_window.get("maxEnabled") and duration_window.get("maxValue") is not None:
            max_duration_min = int(duration_window["maxValue"] * 60)

    # Get yes voters (not abstaining)
    yes_voters = [
        v for v in votes
        if v.get("yes_no_choice") == "yes" and not v.get("is_abstain")
    ]

    if not yes_voters:
        return []

    # Generate all candidate time slots
    candidates: list[CandidateSlot] = []

    for dtw in day_time_windows:
        date = dtw["day"]
        windows = dtw.get("windows", [])

        if not windows:
            # No specific windows = consider full day (00:00 - 23:59)
            windows = [{"min": "00:00", "max": "23:59"}]

        for window in windows:
            w_start = _time_to_minutes(window["min"])
            w_end = _time_to_minutes(window["max"])
            eff_end = _window_effective_end(w_start, w_end)

            # For each possible duration
            dur = min_duration_min
            while dur <= max_duration_min:
                # For each possible start time within the window
                start = w_start
                while start + dur <= eff_end:
                    end = start + dur

                    # Find eligible voters for this slot
                    eligible_ids = []
                    eligible_names = []

                    for voter in yes_voters:
                        voter_windows = voter.get("voter_day_time_windows")
                        voter_duration = voter.get("voter_duration")

                        # If voter has no day_time_windows, they're available for all poll times
                        if voter_windows:
                            if not _voter_available_at(voter_windows, date, start, end):
                                continue
                        if not _voter_duration_ok(voter_duration, dur):
                            continue

                        eligible_ids.append(str(voter["id"]))
                        eligible_names.append(voter.get("voter_name") or "")

                    if eligible_ids:
                        # Filter by participant count constraints using greedy selection
                        selected_ids, selected_names = _greedy_select_participants(
                            eligible_ids, eligible_names, yes_voters, len(eligible_ids)
                        )
                        if selected_ids:
                            candidates.append(CandidateSlot(
                                date=date,
                                start_minutes=start,
                                duration_minutes=dur,
                                participant_vote_ids=selected_ids,
                                participant_names=selected_names,
                            ))

                    start += SLOT_INCREMENT_MINUTES
                dur += SLOT_INCREMENT_MINUTES

    if not candidates:
        return []

    # Sort candidates by: 1) most participants (desc), 2) longest duration (desc), 3) earliest date+time (asc)
    candidates.sort(key=lambda c: (
        -c.participant_count,
        -c.duration_minutes,
        c.date,
        c.start_minutes,
    ))

    # Deduplicate: keep the best variant for each unique (date, start, end) combo
    seen = set()
    unique_candidates = []
    for c in candidates:
        key = (c.date, c.start_minutes, c.end_minutes)
        if key not in seen:
            seen.add(key)
            unique_candidates.append(c)

    # Group into rounds by participant count
    rounds: list[TimeSlotRound] = []
    current_round = 1
    prev_count = None

    for i, c in enumerate(unique_candidates):
        if prev_count is not None and c.participant_count < prev_count:
            current_round += 1
        prev_count = c.participant_count

        rounds.append(TimeSlotRound(
            round_number=current_round,
            slot_date=c.date,
            slot_start_time=c.start_time_str,
            slot_end_time=c.end_time_str,
            duration_hours=c.duration_hours,
            participant_count=c.participant_count,
            participant_vote_ids=c.participant_vote_ids,
            participant_names=c.participant_names,
            is_winner=(i == 0),
        ))

    return rounds


def _greedy_select_participants(
    eligible_ids: list[str],
    eligible_names: list[str],
    all_yes_voters: list[dict],
    total_eligible: int,
) -> tuple[list[str], list[str]]:
    """Greedy selection of participants respecting individual min/max constraints.

    Uses the same priority as the participation algorithm:
    - No max constraint = highest priority
    - Higher max = higher priority
    - Lower min = higher priority
    """
    # Build voter lookup
    voter_lookup = {str(v["id"]): v for v in all_yes_voters}

    # Create tuples of (id, name, vote_data) for eligible voters
    eligible = []
    for vid, vname in zip(eligible_ids, eligible_names):
        vote = voter_lookup.get(vid)
        if vote:
            eligible.append((vid, vname, vote))

    # Sort by priority (same as participation algorithm)
    def priority_key(item):
        _, _, vote = item
        min_p = vote.get("min_participants") or 1
        max_p = vote.get("max_participants")
        # No max = highest priority (infinite flexibility)
        max_factor = 0 if max_p is None else 1
        max_val = max_p if max_p is not None else 999999
        return (max_factor, -max_val, min_p)

    eligible.sort(key=priority_key)

    selected_ids = []
    selected_names = []

    for vid, vname, vote in eligible:
        test_count = len(selected_ids) + 1

        # Check if this voter's constraints are satisfied at the new count
        if not _voter_participant_count_ok(vote, test_count):
            continue

        # Check if adding this voter violates any already-selected voter's constraints
        all_ok = True
        for sid in selected_ids:
            sv = voter_lookup.get(sid)
            if sv and not _voter_participant_count_ok(sv, test_count):
                all_ok = False
                break

        if all_ok:
            selected_ids.append(vid)
            selected_names.append(vname)

    return selected_ids, selected_names
