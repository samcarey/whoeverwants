"""Poll comments (migration 146): a flat, poll-level discussion thread.

Single home for the three operations (create / list / delete) so the router
stays thin. All functions run on the CALLER's connection — the router owns
the transaction, matching the services/questions.py convention.

Identity model mirrors votes: rows are written with the poster's browser_id +
resolved account user_id; ownership READS are account-aware (a comment posted
on device A is "mine" — and deletable — from device B of the same account, via
the `caller_browser_ids` union OR a direct user_id match).

Body policy mirrors join-request messages (`MESSAGE_MAX_CHARS` in
services/join_requests.py): trim + SILENT truncation to the cap for raw-API
callers — the column is unbounded TEXT, so this is the only guard. Empty
after trim is the caller's 400 to raise.
"""

from __future__ import annotations

COMMENT_MAX_CHARS = 2000


def sanitize_comment_body(body: str | None) -> str | None:
    """Trimmed, capped comment body — None when nothing usable remains."""
    cleaned = (body or "").strip()[:COMMENT_MAX_CHARS].rstrip()
    return cleaned or None


def create_comment(
    conn,
    poll_id: str,
    *,
    browser_id: str | None,
    user_id: str | None,
    name: str,
    body: str,
) -> dict:
    """Insert a comment and return its row."""
    return conn.execute(
        """INSERT INTO poll_comments (poll_id, browser_id, user_id, commenter_name, body)
           VALUES (%(pid)s, %(bid)s, %(uid)s, %(name)s, %(body)s)
           RETURNING *""",
        {
            "pid": poll_id,
            "bid": browser_id,
            "uid": user_id,
            "name": name,
            "body": body,
        },
    ).fetchone()


def list_comments(conn, poll_id: str) -> list[dict]:
    """All of a poll's comments, oldest first (chat order — newest nearest
    the composer at the bottom)."""
    return conn.execute(
        """SELECT * FROM poll_comments
            WHERE poll_id = %(pid)s
            ORDER BY created_at, id""",
        {"pid": poll_id},
    ).fetchall()


def comment_is_mine(
    row: dict, *, caller_bids: list[str], actor_user_id: str | None
) -> bool:
    """Account-aware ownership: the row's browser is one of the caller's
    linked browsers, OR the row's account IS the caller's account."""
    row_bid = str(row["browser_id"]) if row.get("browser_id") else None
    row_uid = str(row["user_id"]) if row.get("user_id") else None
    if row_bid and row_bid in caller_bids:
        return True
    return bool(row_uid and actor_user_id and row_uid == actor_user_id)


def delete_comment(
    conn,
    poll_id: str,
    comment_id: str,
    *,
    caller_bids: list[str],
    actor_user_id: str | None,
) -> bool:
    """Delete the caller's own comment. Ownership folded into the WHERE so
    the check + delete are atomic; returns False when the comment doesn't
    exist, belongs to another poll, or isn't the caller's."""
    row = conn.execute(
        """DELETE FROM poll_comments
            WHERE id = %(cid)s
              AND poll_id = %(pid)s
              AND (
                    browser_id::text = ANY(%(bids)s)
                 OR (user_id IS NOT NULL AND user_id::text = %(uid)s)
              )
           RETURNING id""",
        {
            "cid": comment_id,
            "pid": poll_id,
            "bids": caller_bids or [],
            "uid": actor_user_id or "",
        },
    ).fetchone()
    return row is not None
