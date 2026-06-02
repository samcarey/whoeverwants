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
    set. Polls with no row across any of the caller's browsers are ABSENT from
    the returned dict — the caller treats absent as 'new' (default-follow).

    "Effective" across linked browsers is recency-based: the row with the
    greatest `updated_at` wins, so the last ✕/+ the user tapped on any device
    is authoritative."""
    if not poll_ids or not browser_ids:
        return {}
    rows = conn.execute(
        """
        SELECT DISTINCT ON (poll_id)
               poll_id::text AS pid, state
          FROM poll_follow_state
         WHERE poll_id = ANY(%(pids)s::uuid[])
           AND browser_id = ANY(%(bids)s::uuid[])
         ORDER BY poll_id, updated_at DESC
        """,
        {"pids": poll_ids, "bids": browser_ids},
    ).fetchall()
    return {r["pid"]: r["state"] for r in rows}


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
