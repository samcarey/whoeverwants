"""Comments on Playlist EVENTS (migration 157): the poll-comments model,
keyed on the event's (day, LOWER(activity)) identity instead of a poll_id —
events are derived, so the thread anchors on the key itself.

Reuses services/comments.py wherever the logic is shape-agnostic:
`sanitize_comment_body` (trim + silent cap), `comment_is_mine` (account-aware
ownership over a row dict), and the reaction helpers via their whitelisted
`table` parameter. Only the key-scoped comment SQL lives here.

Access: the thread is CANDIDATES-ONLY — the same population that can see the
event at all (people whose own slot tags this activity on this day). A
non-candidate 404s, indistinguishable from not-found, mirroring the group
read contract poll comments follow.
"""

from __future__ import annotations

from services.slots import normalize_activity


def is_event_candidate(conn, *, user_id: str | None, day: str, key: str) -> bool:
    """Does the account's own slots make them a candidate of (day, key)?
    Mirrors the events engine's candidacy (a slot covering the day whose
    activities include the key, case-insensitive) without the full gather —
    windows/conditions don't matter for 'may they see the thread'."""
    if not user_id:
        return False
    row = conn.execute(
        """
        SELECT 1
          FROM slots s
          JOIN slot_activities sa ON sa.slot_id = s.id
         WHERE s.user_id = %(u)s::uuid
           AND LOWER(sa.activity) = %(k)s
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(s.day_time_windows) e
                  WHERE e->>'day' = %(d)s
               )
         LIMIT 1
        """,
        {"u": user_id, "k": key, "d": day},
    ).fetchone()
    return row is not None


def event_key(day: str, activity: str) -> tuple[str, str] | None:
    """(day, key) for an event ref, or None when the activity is unusable."""
    act = normalize_activity(activity)
    if not act or not day:
        return None
    return day, act.lower()


def create_event_comment(
    conn,
    *,
    day: str,
    activity: str,
    browser_id: str | None,
    user_id: str | None,
    name: str,
    body: str,
) -> dict:
    return conn.execute(
        """INSERT INTO slot_event_comments
               (day, activity, browser_id, user_id, commenter_name, body)
           VALUES (%(d)s::date, %(a)s, %(bid)s, %(uid)s, %(name)s, %(body)s)
           RETURNING *""",
        {
            "d": day,
            "a": activity,
            "bid": browser_id,
            "uid": user_id,
            "name": name,
            "body": body,
        },
    ).fetchone()


def list_event_comments(conn, *, day: str, key: str) -> list[dict]:
    """The key's comments, oldest first (chat order)."""
    return conn.execute(
        """SELECT * FROM slot_event_comments
            WHERE day = %(d)s::date AND LOWER(activity) = %(k)s
            ORDER BY created_at, id""",
        {"d": day, "k": key},
    ).fetchall()


def get_event_comment(conn, comment_id: str) -> dict | None:
    return conn.execute(
        "SELECT * FROM slot_event_comments WHERE id = %(id)s::uuid",
        {"id": comment_id},
    ).fetchone()


def update_event_comment(
    conn,
    comment_id: str,
    *,
    caller_bids: list[str],
    actor_user_id: str | None,
    body: str,
) -> dict | None:
    """Author-edit (stamps edited_at); ownership folded into the WHERE like
    the poll variant — None when not found / not owned."""
    return conn.execute(
        """UPDATE slot_event_comments
              SET body = %(body)s, edited_at = NOW()
            WHERE id = %(cid)s::uuid
              AND (
                    browser_id::text = ANY(%(bids)s)
                 OR (user_id IS NOT NULL AND user_id::text = %(uid)s)
              )
           RETURNING *""",
        {
            "cid": comment_id,
            "bids": caller_bids or [],
            "uid": actor_user_id or "",
            "body": body,
        },
    ).fetchone()


def delete_event_comment(
    conn,
    comment_id: str,
    *,
    caller_bids: list[str],
    actor_user_id: str | None,
) -> bool:
    row = conn.execute(
        """DELETE FROM slot_event_comments
            WHERE id = %(cid)s::uuid
              AND (
                    browser_id::text = ANY(%(bids)s)
                 OR (user_id IS NOT NULL AND user_id::text = %(uid)s)
              )
           RETURNING id""",
        {
            "cid": comment_id,
            "bids": caller_bids or [],
            "uid": actor_user_id or "",
        },
    ).fetchone()
    return row is not None
