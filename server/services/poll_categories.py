"""Per-(browser, group, category) poll-creation history.

Backs the category bubble bar ordering on group pages. The bar is
ordered: (1) categories the user created polls for most recently in
the current group, (2) categories created most recently in general,
(3) remaining categories in a per-app-start random order (FE-side).
This module owns (1) + (2).

`record_poll_categories` is a decoupled fire-and-forget write — same
contract as `services.memberships`: it opens its OWN transaction, logs
+ swallows failures, and `ON CONFLICT DO UPDATE`s the `last_created_at`
watermark so re-creating the same category in a group just bumps
recency rather than erroring.

`load_category_recency` unions across every browser linked to a
signed-in user via `user_browsers`, mirroring
`services.groups.load_user_visibility` — so a user signed in on two
devices gets one consistent ordering.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from database import get_db

logger = logging.getLogger(__name__)


def record_poll_categories(
    browser_id: str | None,
    group_id: str | None,
    categories: list[str],
) -> None:
    """Record that `browser_id` created a poll in `group_id` covering each
    of `categories`. One upserted row per distinct category; bumps
    `last_created_at` to NOW() on conflict.

    No-op when browser_id / group_id is missing or no categories — the
    caller (create_poll) always has both post-commit, but the guard keeps
    a missing identity from raising on the create hot path.
    """
    if not browser_id or not group_id:
        return
    distinct = sorted({(c or "").strip() for c in categories if (c or "").strip()})
    if not distinct:
        return
    try:
        with get_db() as conn:
            for category in distinct:
                conn.execute(
                    """
                    INSERT INTO poll_category_history
                        (browser_id, group_id, category, last_created_at)
                    VALUES (%(bid)s::uuid, %(gid)s::uuid, %(cat)s, NOW())
                    ON CONFLICT (browser_id, group_id, category)
                    DO UPDATE SET last_created_at = NOW()
                    """,
                    {"bid": browser_id, "gid": group_id, "cat": category},
                )
    except Exception:
        logger.warning(
            "poll_category_history upsert failed (browser=%s, group=%s)",
            browser_id,
            group_id,
            exc_info=True,
        )


@dataclass
class CategoryRecency:
    """Two recency-ordered (most-recent-first) category lists for one caller.

    `group` is empty when no group_id was supplied (e.g. the empty `/g/`
    placeholder) or the user has created nothing in it yet.
    """

    group: list[str]
    general: list[str]


def _ordered_categories(rows) -> list[str]:
    """Rows are pre-ordered by recency DESC; collapse to category strings."""
    return [str(r["category"]) for r in rows]


def load_category_recency(
    conn,
    browser_id: str | None,
    *,
    user_id: str | None = None,
    group_id: str | None = None,
) -> CategoryRecency:
    """Recency-ordered categories for the caller, overall and (optionally)
    scoped to one group.

    When `user_id` is set, both queries union across every browser linked
    to the user via `user_browsers` (same expansion as
    `load_user_visibility`) so the ordering is consistent across the
    user's devices. `MAX(last_created_at)` per category collapses the
    per-browser rows.
    """
    if not browser_id and not user_id:
        return CategoryRecency(group=[], general=[])

    browser_filter = """
        (
            browser_id = %(bid)s::uuid
            OR (
                %(uid)s::uuid IS NOT NULL
                AND browser_id IN (
                    SELECT browser_id FROM user_browsers
                     WHERE user_id = %(uid)s::uuid
                )
            )
        )
    """

    general_rows = conn.execute(
        f"""
        SELECT category, MAX(last_created_at) AS recency
          FROM poll_category_history
         WHERE {browser_filter}
         GROUP BY category
         ORDER BY recency DESC
        """,
        {"bid": browser_id, "uid": user_id},
    ).fetchall()

    group_rows = []
    if group_id:
        group_rows = conn.execute(
            f"""
            SELECT category, MAX(last_created_at) AS recency
              FROM poll_category_history
             WHERE group_id = %(gid)s::uuid
               AND {browser_filter}
             GROUP BY category
             ORDER BY recency DESC
            """,
            {"bid": browser_id, "uid": user_id, "gid": group_id},
        ).fetchall()

    return CategoryRecency(
        group=_ordered_categories(group_rows),
        general=_ordered_categories(general_rows),
    )
