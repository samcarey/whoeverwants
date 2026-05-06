"""Phase C.2 — write-only helpers for thread_members + poll_access.

These helpers are deliberately decoupled from the vote / create / access
endpoints they're triggered by:

  * Each helper opens its OWN database transaction (its own `get_db()` block).
    A failure here cannot roll back the action that triggered it, and a
    failure in the triggering action cannot roll back a successful membership
    write.
  * Failures are logged + swallowed. Phase C.2 is purely additive — no
    read path enforces these tables yet (Phase C.3 will), so a missed write
    today degrades silently into "user re-establishes membership the next
    time they vote" rather than blocking a vote on an audit-table issue.
  * Inserts are idempotent via `ON CONFLICT (...) DO NOTHING` on the
    composite PK. Re-voting / re-visiting a poll never overwrites the
    original `joined_at` / `granted_at` watermark — Phase C.3 visibility
    compares poll closure timestamps against that watermark, so preserving
    the original value is what gives "joined first → see the most" the
    correct semantics.

Callers should treat these as fire-and-forget. None of them return a value.
"""

from __future__ import annotations

import logging

from database import get_db

logger = logging.getLogger(__name__)


def join_thread(thread_id: str | None, browser_id: str | None) -> None:
    """Idempotently insert a `thread_members(thread_id, browser_id)` row in
    its own transaction. Skips silently when either id is missing."""
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
    """Resolve a poll_id → its thread_id and join. One-stop helper for the
    vote endpoint (which has a poll_id but not a thread_id) so callers don't
    re-implement the lookup. Runs in its own transaction; failures are
    logged + swallowed."""
    if not poll_id or not browser_id:
        return
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT thread_id FROM polls WHERE id = %(id)s",
                {"id": poll_id},
            ).fetchone()
            if not row or not row.get("thread_id"):
                return
            conn.execute(
                """
                INSERT INTO thread_members (thread_id, browser_id)
                VALUES (%(thread_id)s, %(browser_id)s)
                ON CONFLICT (thread_id, browser_id) DO NOTHING
                """,
                {"thread_id": str(row["thread_id"]), "browser_id": browser_id},
            )
    except Exception:
        logger.warning(
            "Phase C.2: thread_members insert failed (poll=%s, browser=%s)",
            poll_id,
            browser_id,
            exc_info=True,
        )


def grant_poll_access(poll_id: str | None, browser_id: str | None) -> None:
    """Idempotently insert a `poll_access(poll_id, browser_id)` row in its
    own transaction. Triggered when a user lands on a specific poll via a
    direct link (`/t/<thread>?p=<poll>` query param, or the legacy
    `/p/<id>` redirect resolution path)."""
    if not poll_id or not browser_id:
        return
    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO poll_access (poll_id, browser_id)
                VALUES (%(poll_id)s, %(browser_id)s)
                ON CONFLICT (poll_id, browser_id) DO NOTHING
                """,
                {"poll_id": poll_id, "browser_id": browser_id},
            )
    except Exception:
        logger.warning(
            "Phase C.2: poll_access insert failed (poll=%s, browser=%s)",
            poll_id,
            browser_id,
            exc_info=True,
        )
