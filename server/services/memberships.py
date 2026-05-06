"""Phase C.2 — fire-and-forget thread_members writes for vote/create paths.

The poll_access write (direct-link grant) is inline in the
`grant_poll_access_endpoint` handler so a missing poll can surface as 404 via
the FK violation. The helpers here are for the vote/create paths where the
action's own transaction must NOT be coupled to the audit write:

  * Each helper opens its OWN `get_db()` transaction. A failure here cannot
    roll back the triggering action, and vice versa.
  * Failures are logged + swallowed — Phase C.2 doesn't enforce reads, so a
    missed write degrades into "user re-establishes membership next vote".
  * `ON CONFLICT DO NOTHING` on the composite PK preserves the original
    `joined_at` watermark across re-votes — Phase C.3 visibility compares
    poll closure timestamps against that watermark.
"""

from __future__ import annotations

import logging

from database import get_db

logger = logging.getLogger(__name__)


def join_thread(thread_id: str | None, browser_id: str | None) -> None:
    """Insert a `thread_members(thread_id, browser_id)` row."""
    if not thread_id or not browser_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO thread_members (thread_id, browser_id)
                VALUES (%(thread_id)s, %(browser_id)s)
                ON CONFLICT (thread_id, browser_id) DO NOTHING
                """,
                {"thread_id": thread_id, "browser_id": browser_id},
            )
    except Exception:
        logger.warning(
            "Phase C.2: thread_members insert failed (thread=%s, browser=%s)",
            thread_id,
            browser_id,
            exc_info=True,
        )


def join_thread_for_poll(poll_id: str | None, browser_id: str | None) -> None:
    """Join the thread that owns this poll. INSERT ... SELECT fuses the
    poll → thread_id lookup with the thread_members write so the vote
    hot path pays one round-trip instead of two."""
    if not poll_id or not browser_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO thread_members (thread_id, browser_id)
                SELECT thread_id, %(browser_id)s FROM polls
                 WHERE id = %(poll_id)s AND thread_id IS NOT NULL
                ON CONFLICT (thread_id, browser_id) DO NOTHING
                """,
                {"poll_id": poll_id, "browser_id": browser_id},
            )
    except Exception:
        logger.warning(
            "Phase C.2: thread_members insert failed (poll=%s, browser=%s)",
            poll_id,
            browser_id,
            exc_info=True,
        )


