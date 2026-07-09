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

from services.validation import truncate_text

COMMENT_MAX_CHARS = 2000


def sanitize_comment_body(body: str | None) -> str | None:
    """Trimmed, capped comment body — None when nothing usable remains."""
    return truncate_text(body, COMMENT_MAX_CHARS)


def create_comment(
    conn,
    poll_id: str,
    *,
    browser_id: str | None,
    user_id: str | None,
    name: str,
    body: str,
    mentions: list[dict] | None = None,
) -> dict:
    """Insert a comment (with its resolved @mentions, see `resolve_mentions`)
    and return its row."""
    import json

    return conn.execute(
        """INSERT INTO poll_comments (poll_id, browser_id, user_id, commenter_name, body, mentions)
           VALUES (%(pid)s, %(bid)s, %(uid)s, %(name)s, %(body)s, %(mentions)s::jsonb)
           RETURNING *""",
        {
            "pid": poll_id,
            "bid": browser_id,
            "uid": user_id,
            "name": name,
            "body": body,
            "mentions": json.dumps(mentions) if mentions else None,
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


def update_comment(
    conn,
    poll_id: str,
    comment_id: str,
    *,
    caller_bids: list[str],
    actor_user_id: str | None,
    body: str,
) -> dict | None:
    """Author-edit a comment's body (stamps `edited_at`; mentions are
    preserved as stored — rendering only highlights names still present in
    the new text). Ownership folded into the WHERE like `delete_comment`;
    returns the updated row, or None when not found / not owned."""
    return conn.execute(
        """UPDATE poll_comments
              SET body = %(body)s, edited_at = NOW()
            WHERE id = %(cid)s
              AND poll_id = %(pid)s
              AND (
                    browser_id::text = ANY(%(bids)s)
                 OR (user_id IS NOT NULL AND user_id::text = %(uid)s)
              )
           RETURNING *""",
        {
            "cid": comment_id,
            "pid": poll_id,
            "bids": caller_bids or [],
            "uid": actor_user_id or "",
            "body": body,
        },
    ).fetchone()


MAX_MENTIONS = 20


def resolve_mentions(
    conn, group_id: str | None, mentioned_user_ids: list[str] | None
) -> list[dict]:
    """Validate the FE's @-autocomplete picks into stored mention objects:
    uuid-shaped, deduped, capped at MAX_MENTIONS, and each a MEMBER of the
    poll's group (account-aware) with a display name. Non-members / unknown
    ids are silently dropped (the FE list comes from the roster, so a miss
    is stale state, not an error)."""
    # Local import mirrors caller_browser_ids' cycle-avoidance convention.
    from services.groups import _is_uuid_like, is_caller_member_of_group

    if not group_id or not mentioned_user_ids:
        return []
    mentions: list[dict] = []
    seen: set[str] = set()
    for uid in mentioned_user_ids:
        if len(mentions) >= MAX_MENTIONS:
            break
        if not _is_uuid_like(uid) or uid in seen:
            continue
        seen.add(uid)
        if not is_caller_member_of_group(
            conn, group_id, browser_id=None, user_id=uid
        ):
            continue
        row = conn.execute(
            "SELECT display_name FROM users WHERE id = %(id)s", {"id": uid}
        ).fetchone()
        name = (row or {}).get("display_name")
        if not name:
            continue
        mentions.append({"user_id": uid, "name": name})
    return mentions


def toggle_reaction(
    conn,
    comment_id: str,
    *,
    browser_id: str,
    user_id: str | None,
    caller_bids: list[str],
    emoji: str,
) -> bool:
    """Toggle the caller's reaction: removes the ACCOUNT's existing rows for
    this (comment, emoji) — any linked browser, so toggling off works cross-
    device — else inserts one row keyed on the current browser (the votes
    convention: browser-keyed writes, account-aware reads). Returns True when
    the reaction was added, False when removed."""
    removed = conn.execute(
        """DELETE FROM poll_comment_reactions
            WHERE comment_id = %(cid)s
              AND emoji = %(emoji)s
              AND (
                    browser_id::text = ANY(%(bids)s)
                 OR (user_id IS NOT NULL AND user_id::text = %(uid)s)
              )
           RETURNING 1""",
        {
            "cid": comment_id,
            "emoji": emoji,
            "bids": caller_bids or [],
            "uid": user_id or "",
        },
    ).fetchall()
    if removed:
        return False
    conn.execute(
        """INSERT INTO poll_comment_reactions (comment_id, browser_id, user_id, emoji)
           VALUES (%(cid)s, %(bid)s, %(uid)s, %(emoji)s)
           ON CONFLICT (comment_id, browser_id, emoji) DO NOTHING""",
        {"cid": comment_id, "bid": browser_id, "uid": user_id, "emoji": emoji},
    )
    return True


def reactions_for_comments(
    conn,
    comment_ids: list[str],
    *,
    caller_bids: list[str],
    actor_user_id: str | None,
) -> dict[str, list[dict]]:
    """Per-comment reaction summaries: {comment_id: [{emoji, count, mine}]},
    emojis in first-reacted order. `count` collapses an account's rows across
    linked browsers (COALESCE(user_id, browser_id), the viewed_total pattern);
    `mine` matches the caller's browsers OR account."""
    if not comment_ids:
        return {}
    rows = conn.execute(
        """SELECT comment_id, emoji, browser_id::text AS browser_id,
                  user_id::text AS user_id, created_at
             FROM poll_comment_reactions
            WHERE comment_id = ANY(%(ids)s::uuid[])
            ORDER BY created_at, emoji""",
        {"ids": comment_ids},
    ).fetchall()
    bid_set = set(caller_bids or [])
    # (comment_id, emoji) -> {people set, mine}
    summary: dict[str, dict[str, dict]] = {}
    for r in rows:
        cid = str(r["comment_id"])
        per_emoji = summary.setdefault(cid, {})
        entry = per_emoji.setdefault(r["emoji"], {"people": set(), "mine": False})
        entry["people"].add(r["user_id"] or r["browser_id"])
        if r["browser_id"] in bid_set or (
            r["user_id"] and actor_user_id and r["user_id"] == actor_user_id
        ):
            entry["mine"] = True
    return {
        cid: [
            {"emoji": emoji, "count": len(e["people"]), "mine": e["mine"]}
            for emoji, e in per_emoji.items()
        ]
        for cid, per_emoji in summary.items()
    }
