"""Per-poll follow/ignore state (Gap 1, migration 134).

A viewer "follows" every poll by default (no row = 'new'). Tapping the red ✕
on a To Do/New row writes 'old' (ignore); tapping the green + on an Old row
writes 'new' (re-follow). This is the per-viewer "I'm ignoring this" archive —
NOT an open/closed split, and orthogonal to group membership.

Account-aware on reads: a poll's effective state for a caller is the
most-recently-updated row across every browser linked to their account (mirrors
`caller_browser_ids` / `load_user_visibility`), so ✕ on device A syncs to the
same account on device B. No row anywhere = 'new' (default-follow).

'old' polls are excluded from that viewer's badge count and from the
poll-closed / phase-transition / outcome push notifications.
"""

from __future__ import annotations

VALID_STATES = ("new", "old")


def effective_follow_states(
    conn, poll_ids: list[str], *, browser_ids: list[str]
) -> dict[str, str]:
    """poll_id (str) → effective state ('new' | 'old') for the caller's browser
    set. Polls with no signal at all (no follow row across the caller's browsers
    AND not auto-aged) are ABSENT — the caller treats absent as 'new'.

    Two inputs combine, recency wins:
      * the caller's most-recently-updated follow row across their linked
        browsers (the last ✕/+ they tapped on any device), and
      * the poll's `auto_aged_at` (migration 142): the instant a finished poll
        was auto-filed into Old for EVERYONE (decided time fully past, event
        cancelled, no winner, or simply closed for non-time polls).

    An auto-aged poll reads 'old' for every viewer UNLESS that viewer has a
    follow row newer than `auto_aged_at` — i.e. they tapped + to re-add it
    AFTER it aged. So aging overrides any pre-aging ✕/+ once (for everyone), and
    a post-aging + brings it back to Relevant and sticks. Notification / badge
    suppression is deliberately NOT affected — that keys on EXPLICIT ✕ via
    `old_poll_ids_for_browsers`, so a poll-closed push still reaches everyone who
    didn't explicitly ignore the poll."""
    if not poll_ids:
        return {}
    rows = (
        conn.execute(
            """
            SELECT DISTINCT ON (poll_id)
                   poll_id::text AS pid, state, updated_at
              FROM poll_follow_state
             WHERE poll_id = ANY(%(pids)s::uuid[])
               AND browser_id = ANY(%(bids)s::uuid[])
             ORDER BY poll_id, updated_at DESC
            """,
            {"pids": poll_ids, "bids": browser_ids},
        ).fetchall()
        if browser_ids
        else []
    )
    follow = {r["pid"]: (r["state"], r["updated_at"]) for r in rows}

    aged_rows = conn.execute(
        """
        SELECT id::text AS pid, auto_aged_at
          FROM polls
         WHERE id = ANY(%(pids)s::uuid[])
           AND auto_aged_at IS NOT NULL
        """,
        {"pids": poll_ids},
    ).fetchall()
    aged = {r["pid"]: r["auto_aged_at"] for r in aged_rows}

    result: dict[str, str] = {}
    for pid in {*follow, *aged}:
        fr = follow.get(pid)
        aged_at = aged.get(pid)
        if fr is not None and (aged_at is None or fr[1] >= aged_at):
            result[pid] = fr[0]
        elif aged_at is not None:
            result[pid] = "old"
    return result


def old_poll_ids_for_browsers(conn, browser_ids: list[str]) -> set[str]:
    """The set of poll_ids the caller's browser set has effectively IGNORED
    (most-recent row across the set is 'old'). Used by the notification fan-out
    + badge count to skip a viewer's Old polls. Empty when no rows / no
    browsers."""
    if not browser_ids:
        return set()
    rows = conn.execute(
        """
        SELECT pid FROM (
            SELECT DISTINCT ON (poll_id)
                   poll_id::text AS pid, state
              FROM poll_follow_state
             WHERE browser_id = ANY(%(bids)s::uuid[])
             ORDER BY poll_id, updated_at DESC
        ) latest
         WHERE state = 'old'
        """,
        {"bids": browser_ids},
    ).fetchall()
    return {r["pid"] for r in rows}


def set_follow_state(conn, poll_id: str, browser_id: str, state: str) -> None:
    """Upsert this browser's follow state for a poll. ✕ → 'old', + → 'new'.
    Bumps `updated_at` to `clock_timestamp()` (NOT `NOW()`, which is constant
    within a transaction) so the recency tiebreak across linked browsers is
    robust even for writes that land in the same transaction. Raises
    ValueError on an invalid state."""
    if state not in VALID_STATES:
        raise ValueError(f"invalid follow state: {state!r}")
    conn.execute(
        """
        INSERT INTO poll_follow_state (poll_id, browser_id, state, updated_at)
        VALUES (%(pid)s::uuid, %(bid)s::uuid, %(state)s, clock_timestamp())
        ON CONFLICT (poll_id, browser_id)
        DO UPDATE SET state = EXCLUDED.state, updated_at = clock_timestamp()
        """,
        {"pid": poll_id, "bid": browser_id, "state": state},
    )
