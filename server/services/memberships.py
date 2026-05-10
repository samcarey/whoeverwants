"""Fire-and-forget group_members writes for vote/create paths.

These helpers are for vote/create paths where the action's own transaction
must NOT be coupled to the audit write:

  * Each helper opens its OWN `get_db()` transaction. A failure here cannot
    roll back the triggering action, and vice versa.
  * Failures are logged + swallowed — a missed write degrades into "user
    re-establishes membership next vote".
  * `ON CONFLICT DO NOTHING` on the composite PK preserves the original
    `joined_at` watermark across re-votes — visibility compares poll
    closure timestamps against that watermark.

The group-membership inline grant (read endpoint auto-join) lives in
`services.groups.grant_group_membership_inline` instead — it shares the
caller's read transaction so the visibility filter sees the new row in
the same query.
"""

from __future__ import annotations

import logging

from database import get_db

logger = logging.getLogger(__name__)


def join_group(group_id: str | None, browser_id: str | None) -> None:
    """Insert a `group_members(group_id, browser_id)` row."""
    if not group_id or not browser_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO group_members (group_id, browser_id)
                VALUES (%(group_id)s, %(browser_id)s)
                ON CONFLICT (group_id, browser_id) DO NOTHING
                """,
                {"group_id": group_id, "browser_id": browser_id},
            )
    except Exception:
        logger.warning(
            "Phase C.2: group_members insert failed (group=%s, browser=%s)",
            group_id,
            browser_id,
            exc_info=True,
        )


def join_group_for_poll(poll_id: str | None, browser_id: str | None) -> None:
    """Join the group that owns this poll. INSERT ... SELECT fuses the
    poll → group_id lookup with the group_members write so the vote
    hot path pays one round-trip instead of two."""
    if not poll_id or not browser_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO group_members (group_id, browser_id)
                SELECT group_id, %(browser_id)s FROM polls
                 WHERE id = %(poll_id)s AND group_id IS NOT NULL
                ON CONFLICT (group_id, browser_id) DO NOTHING
                """,
                {"poll_id": poll_id, "browser_id": browser_id},
            )
    except Exception:
        logger.warning(
            "Phase C.2: group_members insert failed (poll=%s, browser=%s)",
            poll_id,
            browser_id,
            exc_info=True,
        )


def leave_group(conn, group_id: str | None, browser_id: str | None) -> None:
    """Delete the caller's `group_members` row. Counterpart to
    `join_group` — used by the explicit "leave group" endpoint.

    Unlike the join helpers, this runs on the caller's connection (the
    leave endpoint already holds one to do route_id resolution, so reusing
    it saves a round-trip). No-op when either id is missing; the DELETE
    silently affects 0 rows when no membership row exists, which is the
    intended idempotent semantics."""
    if not group_id or not browser_id:
        return
    conn.execute(
        "DELETE FROM group_members "
        "WHERE group_id = %(group_id)s::uuid AND browser_id = %(browser_id)s",
        {"group_id": group_id, "browser_id": browser_id},
    )


