"""Friends system: mutual friendships (request → accept), block lists,
private contact groups, and the shareable per-user friend_code.

Model notes:
  * A FRIENDSHIP is an accepted `friend_requests` row (either direction).
    Unfriending deletes the row; a partial unique index enforces one
    accepted row per unordered pair.
  * BLOCKS are directed rows but are read symmetrically everywhere —
    either direction partitions the pair for matching AND hides the pair
    from each other's suggestion surfaces. Blocking dissolves any
    friendship/pending requests and contact-group memberships between the
    two, in both directions.
  * CONTACT GROUPS are private labels over the owner's friends. Only the
    owner reads them; membership references friends by user_id and is
    pruned when a friendship dissolves (unfriend/block).
  * The matching integration lives in `load_blocks` (symmetric closure over
    a candidate uid set) — consumed by services/slot_events.py's `_allows`
    gate so two blocked users never land in the same suggested event, while
    each still gets events without the other (the per-viewer fresh-card
    search only ever enumerates subsets containing the viewer).
"""

from __future__ import annotations

import secrets

from psycopg import errors as pg_errors


# ---------------------------------------------------------------------------
# Friend code (the /f/<code> profile link)
# ---------------------------------------------------------------------------

def ensure_friend_code(conn, user_id: str) -> str:
    """The user's stable public profile-link code, minted on first need."""
    row = conn.execute(
        "SELECT friend_code FROM users WHERE id = %(u)s::uuid", {"u": user_id}
    ).fetchone()
    if row and row["friend_code"]:
        return str(row["friend_code"])
    for _ in range(5):
        code = secrets.token_urlsafe(9)
        try:
            updated = conn.execute(
                """
                UPDATE users SET friend_code = %(c)s
                 WHERE id = %(u)s::uuid AND friend_code IS NULL
                RETURNING friend_code
                """,
                {"c": code, "u": user_id},
            ).fetchone()
        except pg_errors.UniqueViolation:
            conn.rollback()
            continue
        if updated:
            return str(updated["friend_code"])
        # Lost a race to another request that minted first — read theirs.
        row = conn.execute(
            "SELECT friend_code FROM users WHERE id = %(u)s::uuid", {"u": user_id}
        ).fetchone()
        if row and row["friend_code"]:
            return str(row["friend_code"])
    raise RuntimeError("could not mint friend code")


def user_id_for_code(conn, code: str) -> str | None:
    row = conn.execute(
        "SELECT id::text AS id FROM users WHERE friend_code = %(c)s", {"c": code}
    ).fetchone()
    return row["id"] if row else None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def friend_rows(conn, user_id: str) -> list[dict]:
    """Accepted friends: [{user_id, name, image_updated_at}], name may be
    None (nameless account renders as "Someone")."""
    rows = conn.execute(
        """
        SELECT CASE WHEN fr.from_user_id = %(u)s::uuid
                    THEN fr.to_user_id ELSE fr.from_user_id END::text AS user_id,
               u.display_name AS name,
               up.image_updated_at,
               fr.responded_at
          FROM friend_requests fr
          JOIN users u ON u.id = CASE WHEN fr.from_user_id = %(u)s::uuid
                                      THEN fr.to_user_id ELSE fr.from_user_id END
          LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE fr.status = 'accepted'
           AND (fr.from_user_id = %(u)s::uuid OR fr.to_user_id = %(u)s::uuid)
         ORDER BY u.display_name ASC NULLS LAST
        """,
        {"u": user_id},
    ).fetchall()
    return [
        {
            "user_id": r["user_id"],
            "name": r.get("name"),
            "image_updated_at": r.get("image_updated_at"),
        }
        for r in rows
    ]


def friend_names(conn, user_id: str) -> dict[str, str]:
    """{user_id: display_name} for NAMED accepted friends — the who-with
    people pool (mirrors slots._contact_names' named-only contract)."""
    return {
        r["user_id"]: r["name"]
        for r in friend_rows(conn, user_id)
        if r["name"] and str(r["name"]).strip()
    }


def are_friends(conn, a: str, b: str) -> bool:
    row = conn.execute(
        """
        SELECT 1 FROM friend_requests
         WHERE status = 'accepted'
           AND ((from_user_id = %(a)s::uuid AND to_user_id = %(b)s::uuid)
             OR (from_user_id = %(b)s::uuid AND to_user_id = %(a)s::uuid))
         LIMIT 1
        """,
        {"a": a, "b": b},
    ).fetchone()
    return row is not None


def is_blocked_either(conn, a: str, b: str) -> bool:
    row = conn.execute(
        """
        SELECT 1 FROM user_blocks
         WHERE (blocker_user_id = %(a)s::uuid AND blocked_user_id = %(b)s::uuid)
            OR (blocker_user_id = %(b)s::uuid AND blocked_user_id = %(a)s::uuid)
         LIMIT 1
        """,
        {"a": a, "b": b},
    ).fetchone()
    return row is not None


def blocked_user_ids(conn, user_id: str) -> set[str]:
    """Everyone blocked w.r.t. `user_id`, either direction."""
    rows = conn.execute(
        """
        SELECT CASE WHEN blocker_user_id = %(u)s::uuid
                    THEN blocked_user_id ELSE blocker_user_id END::text AS uid
          FROM user_blocks
         WHERE blocker_user_id = %(u)s::uuid OR blocked_user_id = %(u)s::uuid
        """,
        {"u": user_id},
    ).fetchall()
    return {r["uid"] for r in rows}


def load_blocks(conn, user_ids: set[str] | list[str]) -> dict[str, set[str]]:
    """Symmetric block closure restricted to `user_ids` — the matching
    engine's map ({uid: {uids it must never share an event with}}). Empty
    dict when no blocks touch the set."""
    ids = [str(u) for u in user_ids]
    if not ids:
        return {}
    rows = conn.execute(
        """
        SELECT blocker_user_id::text AS a, blocked_user_id::text AS b
          FROM user_blocks
         WHERE blocker_user_id = ANY(%(ids)s::uuid[])
           AND blocked_user_id = ANY(%(ids)s::uuid[])
        """,
        {"ids": ids},
    ).fetchall()
    blocks: dict[str, set[str]] = {}
    for r in rows:
        blocks.setdefault(r["a"], set()).add(r["b"])
        blocks.setdefault(r["b"], set()).add(r["a"])
    return blocks


def pending_requests(conn, user_id: str) -> tuple[list[dict], list[dict]]:
    """(incoming, outgoing) pending requests, each
    [{id, user_id, name, image_updated_at, created_at}]."""
    rows = conn.execute(
        """
        SELECT fr.id::text AS id,
               fr.from_user_id::text AS from_id,
               fr.to_user_id::text AS to_id,
               fr.created_at,
               fu.display_name AS from_name,
               tu.display_name AS to_name,
               fup.image_updated_at AS from_image,
               tup.image_updated_at AS to_image
          FROM friend_requests fr
          JOIN users fu ON fu.id = fr.from_user_id
          JOIN users tu ON tu.id = fr.to_user_id
          LEFT JOIN user_profiles fup ON fup.user_id = fr.from_user_id
          LEFT JOIN user_profiles tup ON tup.user_id = fr.to_user_id
         WHERE fr.status = 'pending'
           AND (fr.from_user_id = %(u)s::uuid OR fr.to_user_id = %(u)s::uuid)
         ORDER BY fr.created_at ASC
        """,
        {"u": user_id},
    ).fetchall()
    incoming, outgoing = [], []
    for r in rows:
        if r["to_id"] == user_id:
            incoming.append(
                {
                    "id": r["id"],
                    "user_id": r["from_id"],
                    "name": r.get("from_name"),
                    "image_updated_at": r.get("from_image"),
                    "created_at": r["created_at"],
                }
            )
        else:
            outgoing.append(
                {
                    "id": r["id"],
                    "user_id": r["to_id"],
                    "name": r.get("to_name"),
                    "image_updated_at": r.get("to_image"),
                    "created_at": r["created_at"],
                }
            )
    return incoming, outgoing


def blocked_rows(conn, user_id: str) -> list[dict]:
    """People THIS user blocked (their manageable block list — being blocked
    by others is never surfaced)."""
    rows = conn.execute(
        """
        SELECT ub.blocked_user_id::text AS user_id, u.display_name AS name
          FROM user_blocks ub
          JOIN users u ON u.id = ub.blocked_user_id
         WHERE ub.blocker_user_id = %(u)s::uuid
         ORDER BY u.display_name ASC NULLS LAST
        """,
        {"u": user_id},
    ).fetchall()
    return [{"user_id": r["user_id"], "name": r.get("name")} for r in rows]


# ---------------------------------------------------------------------------
# Friend-request suggestions (people you've been in suggested events with)
# ---------------------------------------------------------------------------

def reconcile_event_contacts(conn, owner_user_id: str) -> None:
    """Upsert into user_contacts every account whose slots share a (day,
    activity) event key with the owner's — i.e. people who have been in
    suggested events together. Same idempotent shape as
    contacts.reconcile_contacts (which covers shared poll groups); together
    they feed the friend-request suggestion pool."""
    conn.execute(
        """
        INSERT INTO user_contacts (owner_user_id, contact_user_id, last_seen_at)
        SELECT %(me)s::uuid, others.uid, NOW()
          FROM (
            SELECT DISTINCT s2.user_id AS uid
              FROM slots s1
              JOIN slot_activities a1 ON a1.slot_id = s1.id
              JOIN slot_activities a2 ON LOWER(a2.activity) = LOWER(a1.activity)
              JOIN slots s2 ON s2.id = a2.slot_id
             WHERE s1.user_id = %(me)s::uuid
               AND s2.user_id <> %(me)s::uuid
               AND EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements(s1.day_time_windows) d1,
                        jsonb_array_elements(s2.day_time_windows) d2
                  WHERE d1->>'day' = d2->>'day'
               )
          ) others
        ON CONFLICT (owner_user_id, contact_user_id)
        DO UPDATE SET last_seen_at = NOW()
        """,
        {"me": owner_user_id},
    )


def friend_suggestions(conn, user_id: str) -> list[dict]:
    """Named accounts from the owner's address book (shared groups + shared
    suggested events) who aren't already friends / pending / blocked."""
    rows = conn.execute(
        """
        SELECT c.contact_user_id::text AS user_id,
               u.display_name AS name,
               up.image_updated_at
          FROM user_contacts c
          JOIN users u ON u.id = c.contact_user_id
          LEFT JOIN user_profiles up ON up.user_id = c.contact_user_id
         WHERE c.owner_user_id = %(u)s::uuid
           AND c.contact_user_id <> %(u)s::uuid
           AND u.display_name IS NOT NULL AND btrim(u.display_name) <> ''
           AND NOT EXISTS (
             SELECT 1 FROM friend_requests fr
              WHERE fr.status IN ('pending', 'accepted')
                AND ((fr.from_user_id = %(u)s::uuid AND fr.to_user_id = c.contact_user_id)
                  OR (fr.from_user_id = c.contact_user_id AND fr.to_user_id = %(u)s::uuid))
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_blocks ub
              WHERE (ub.blocker_user_id = %(u)s::uuid AND ub.blocked_user_id = c.contact_user_id)
                 OR (ub.blocker_user_id = c.contact_user_id AND ub.blocked_user_id = %(u)s::uuid)
           )
         ORDER BY c.last_seen_at DESC, u.display_name ASC
         LIMIT 30
        """,
        {"u": user_id},
    ).fetchall()
    return [
        {
            "user_id": r["user_id"],
            "name": r.get("name"),
            "image_updated_at": r.get("image_updated_at"),
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def send_friend_request(conn, from_user: str, to_user: str) -> str:
    """Returns 'friends' | 'requested' | 'self'. Blocked pairs report
    'requested' WITHOUT creating anything (a block must not be detectable
    by the blocked party). A pending request in the opposite direction is
    auto-accepted — both people asked, so they're friends."""
    if from_user == to_user:
        return "self"
    if is_blocked_either(conn, from_user, to_user):
        return "requested"
    if are_friends(conn, from_user, to_user):
        return "friends"
    # Reverse pending → mutual intent → accept it.
    reverse = conn.execute(
        """
        UPDATE friend_requests
           SET status = 'accepted', responded_at = NOW()
         WHERE from_user_id = %(b)s::uuid AND to_user_id = %(a)s::uuid
           AND status = 'pending'
        RETURNING id
        """,
        {"a": from_user, "b": to_user},
    ).fetchone()
    if reverse:
        return "friends"
    conn.execute(
        """
        INSERT INTO friend_requests (from_user_id, to_user_id)
        VALUES (%(a)s::uuid, %(b)s::uuid)
        ON CONFLICT (from_user_id, to_user_id) WHERE status = 'pending'
        DO NOTHING
        """,
        {"a": from_user, "b": to_user},
    )
    return "requested"


def respond_to_request(conn, user_id: str, request_id: str, accept: bool) -> dict | None:
    """Accept/reject a pending request addressed to `user_id`. Returns the
    request row ({from_user_id}) on transition, None when it doesn't exist /
    isn't theirs / was already decided."""
    if accept:
        row = conn.execute(
            """
            UPDATE friend_requests
               SET status = 'accepted', responded_at = NOW()
             WHERE id = %(id)s::uuid AND to_user_id = %(u)s::uuid
               AND status = 'pending'
               AND NOT EXISTS (
                 SELECT 1 FROM friend_requests f2
                  WHERE f2.status = 'accepted'
                    AND LEAST(f2.from_user_id, f2.to_user_id)
                        = LEAST(friend_requests.from_user_id, friend_requests.to_user_id)
                    AND GREATEST(f2.from_user_id, f2.to_user_id)
                        = GREATEST(friend_requests.from_user_id, friend_requests.to_user_id)
               )
            RETURNING from_user_id::text AS from_user_id
            """,
            {"id": request_id, "u": user_id},
        ).fetchone()
    else:
        row = conn.execute(
            """
            UPDATE friend_requests
               SET status = 'rejected', responded_at = NOW()
             WHERE id = %(id)s::uuid AND to_user_id = %(u)s::uuid
               AND status = 'pending'
            RETURNING from_user_id::text AS from_user_id
            """,
            {"id": request_id, "u": user_id},
        ).fetchone()
    return dict(row) if row else None


def _prune_pair_associations(conn, a: str, b: str) -> None:
    """Drop friendship rows + contact-group memberships between a pair —
    shared teardown for unfriend and block."""
    conn.execute(
        """
        DELETE FROM friend_requests
         WHERE (from_user_id = %(a)s::uuid AND to_user_id = %(b)s::uuid)
            OR (from_user_id = %(b)s::uuid AND to_user_id = %(a)s::uuid)
        """,
        {"a": a, "b": b},
    )
    conn.execute(
        """
        DELETE FROM contact_group_members m
         USING contact_groups g
         WHERE m.group_id = g.id
           AND ((g.owner_user_id = %(a)s::uuid AND m.member_user_id = %(b)s::uuid)
             OR (g.owner_user_id = %(b)s::uuid AND m.member_user_id = %(a)s::uuid))
        """,
        {"a": a, "b": b},
    )


def unfriend(conn, user_id: str, other: str) -> None:
    _prune_pair_associations(conn, user_id, other)


def block_user(conn, user_id: str, target: str) -> None:
    """Block `target`: sever any friendship/pending requests + group
    memberships both ways, then record the block. Idempotent."""
    if user_id == target:
        return
    _prune_pair_associations(conn, user_id, target)
    conn.execute(
        """
        INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
        VALUES (%(a)s::uuid, %(b)s::uuid)
        ON CONFLICT DO NOTHING
        """,
        {"a": user_id, "b": target},
    )


def unblock_user(conn, user_id: str, target: str) -> None:
    conn.execute(
        """
        DELETE FROM user_blocks
         WHERE blocker_user_id = %(a)s::uuid AND blocked_user_id = %(b)s::uuid
        """,
        {"a": user_id, "b": target},
    )


# ---------------------------------------------------------------------------
# Contact groups (private labels over friends)
# ---------------------------------------------------------------------------

def contact_group_names(conn, user_id: str) -> dict[str, str]:
    """{group_id: name} for the owner's contact groups — the who-with
    groups pool."""
    rows = conn.execute(
        """
        SELECT id::text AS id, name FROM contact_groups
         WHERE owner_user_id = %(u)s::uuid
        """,
        {"u": user_id},
    ).fetchall()
    return {r["id"]: r["name"] for r in rows}


def list_contact_groups(conn, user_id: str) -> list[dict]:
    groups = conn.execute(
        """
        SELECT id::text AS id, name, created_at FROM contact_groups
         WHERE owner_user_id = %(u)s::uuid
         ORDER BY LOWER(name) ASC
        """,
        {"u": user_id},
    ).fetchall()
    if not groups:
        return []
    gids = [g["id"] for g in groups]
    members = conn.execute(
        """
        SELECT m.group_id::text AS group_id,
               m.member_user_id::text AS user_id,
               u.display_name AS name
          FROM contact_group_members m
          JOIN users u ON u.id = m.member_user_id
         WHERE m.group_id = ANY(%(gids)s::uuid[])
         ORDER BY u.display_name ASC NULLS LAST
        """,
        {"gids": gids},
    ).fetchall()
    children = conn.execute(
        """
        SELECT c.group_id::text AS group_id,
               c.child_group_id::text AS child_id,
               g.name
          FROM contact_group_children c
          JOIN contact_groups g ON g.id = c.child_group_id
         WHERE c.group_id = ANY(%(gids)s::uuid[])
         ORDER BY LOWER(g.name) ASC
        """,
        {"gids": gids},
    ).fetchall()
    by_group: dict[str, list[dict]] = {}
    for m in members:
        by_group.setdefault(m["group_id"], []).append(
            {"user_id": m["user_id"], "name": m.get("name")}
        )
    children_by_group: dict[str, list[dict]] = {}
    for c in children:
        children_by_group.setdefault(c["group_id"], []).append(
            {"id": c["child_id"], "name": c["name"]}
        )
    return [
        {
            "id": g["id"],
            "name": g["name"],
            "members": by_group.get(g["id"], []),
            "child_groups": children_by_group.get(g["id"], []),
        }
        for g in groups
    ]


def create_contact_group(conn, user_id: str, name: str) -> str | None:
    """Returns the new group id, or None on a duplicate name. Uses ON
    CONFLICT (not exception handling) so a duplicate can't poison the
    request's transaction."""
    row = conn.execute(
        """
        INSERT INTO contact_groups (owner_user_id, name)
        VALUES (%(u)s::uuid, %(n)s)
        ON CONFLICT (owner_user_id, LOWER(name)) DO NOTHING
        RETURNING id::text AS id
        """,
        {"u": user_id, "n": name},
    ).fetchone()
    return row["id"] if row else None


def group_descendant_ids(conn, group_id: str) -> set[str]:
    """Every group reachable DOWN the nesting tree from `group_id`
    (excluding itself). UNION (not UNION ALL) so a legacy cycle can't
    loop the recursion."""
    rows = conn.execute(
        """
        WITH RECURSIVE d AS (
            SELECT child_group_id FROM contact_group_children
             WHERE group_id = %(g)s::uuid
            UNION
            SELECT c.child_group_id FROM d
              JOIN contact_group_children c ON c.group_id = d.child_group_id
        )
        SELECT child_group_id::text AS id FROM d
        """,
        {"g": group_id},
    ).fetchall()
    return {r["id"] for r in rows}


def update_contact_group(
    conn,
    user_id: str,
    group_id: str,
    *,
    name: str | None = None,
    member_ids: list[str] | None = None,
    child_group_ids: list[str] | None = None,
) -> bool:
    """Rename and/or replace membership (people and/or nested groups).
    Members are silently filtered to the owner's accepted friends; child
    groups to the owner's OWN groups, excluding itself and anything that
    would create a cycle (a candidate child whose descendants include this
    group). Returns False when the group isn't theirs."""
    owned = conn.execute(
        """
        SELECT 1 FROM contact_groups
         WHERE id = %(g)s::uuid AND owner_user_id = %(u)s::uuid
        """,
        {"g": group_id, "u": user_id},
    ).fetchone()
    if not owned:
        return False
    if name is not None:
        renamed = conn.execute(
            """
            UPDATE contact_groups SET name = %(n)s
             WHERE id = %(g)s::uuid
               AND NOT EXISTS (
                 SELECT 1 FROM contact_groups g2
                  WHERE g2.owner_user_id = %(u)s::uuid
                    AND LOWER(g2.name) = LOWER(%(n)s)
                    AND g2.id <> %(g)s::uuid
               )
            RETURNING id
            """,
            {"n": name, "g": group_id, "u": user_id},
        ).fetchone()
        if not renamed:
            return False
    if member_ids is not None:
        allowed = {
            r["user_id"]
            for r in friend_rows(conn, user_id)
        }
        keep = [m for m in dict.fromkeys(member_ids) if m in allowed]
        conn.execute(
            "DELETE FROM contact_group_members WHERE group_id = %(g)s::uuid",
            {"g": group_id},
        )
        for uid in keep:
            conn.execute(
                """
                INSERT INTO contact_group_members (group_id, member_user_id)
                VALUES (%(g)s::uuid, %(m)s::uuid)
                ON CONFLICT DO NOTHING
                """,
                {"g": group_id, "m": uid},
            )
    if child_group_ids is not None:
        own = set(contact_group_names(conn, user_id))
        keep_children = []
        for cid in dict.fromkeys(child_group_ids):
            if cid == group_id or cid not in own:
                continue
            # No cycles: adding X under G is illegal when G is reachable
            # from X (X's descendant closure contains G).
            if group_id in group_descendant_ids(conn, cid):
                continue
            keep_children.append(cid)
        conn.execute(
            "DELETE FROM contact_group_children WHERE group_id = %(g)s::uuid",
            {"g": group_id},
        )
        for cid in keep_children:
            conn.execute(
                """
                INSERT INTO contact_group_children (group_id, child_group_id)
                VALUES (%(g)s::uuid, %(c)s::uuid)
                ON CONFLICT DO NOTHING
                """,
                {"g": group_id, "c": cid},
            )
    return True


def delete_contact_group(conn, user_id: str, group_id: str) -> bool:
    row = conn.execute(
        """
        DELETE FROM contact_groups
         WHERE id = %(g)s::uuid AND owner_user_id = %(u)s::uuid
        RETURNING id
        """,
        {"g": group_id, "u": user_id},
    ).fetchone()
    return row is not None


def contact_group_memberships(conn, group_ids: set[str] | list[str]) -> dict[str, set[str]]:
    """{contact_group_id: {member user_ids}} for the given ids — merged into
    slot_events' membership map so who-with contact-group refs resolve in
    matching. TRANSITIVE over nesting: a group's people include everyone in
    its child groups, recursively (UNION dedupes + makes a legacy cycle
    harmless)."""
    gids = [str(g) for g in group_ids]
    if not gids:
        return {}
    rows = conn.execute(
        """
        WITH RECURSIVE tree AS (
            SELECT id AS root_id, id AS node_id FROM contact_groups
             WHERE id = ANY(%(gids)s::uuid[])
            UNION
            SELECT t.root_id, c.child_group_id FROM tree t
              JOIN contact_group_children c ON c.group_id = t.node_id
        )
        SELECT t.root_id::text AS gid, m.member_user_id::text AS uid
          FROM tree t
          JOIN contact_group_members m ON m.group_id = t.node_id
        """,
        {"gids": gids},
    ).fetchall()
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(r["gid"], set()).add(r["uid"])
    return out


# ---------------------------------------------------------------------------
# Profile (the /f/<code> page)
# ---------------------------------------------------------------------------

def profile_for_code(conn, code: str, viewer_user_id: str | None) -> dict | None:
    """The link owner's public card + the viewer's relationship to them.
    None when the code doesn't resolve OR the owner blocked the viewer
    (indistinguishable from a dead link, by design)."""
    row = conn.execute(
        """
        SELECT u.id::text AS user_id, u.display_name AS name, u.created_at,
               up.image_updated_at
          FROM users u
          LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE u.friend_code = %(c)s
        """,
        {"c": code},
    ).fetchone()
    if not row:
        return None
    owner = row["user_id"]
    relationship = "none"
    if viewer_user_id:
        if viewer_user_id == owner:
            relationship = "self"
        else:
            blocked_by_owner = conn.execute(
                """
                SELECT 1 FROM user_blocks
                 WHERE blocker_user_id = %(o)s::uuid AND blocked_user_id = %(v)s::uuid
                """,
                {"o": owner, "v": viewer_user_id},
            ).fetchone()
            if blocked_by_owner:
                return None
            viewer_blocked = conn.execute(
                """
                SELECT 1 FROM user_blocks
                 WHERE blocker_user_id = %(v)s::uuid AND blocked_user_id = %(o)s::uuid
                """,
                {"o": owner, "v": viewer_user_id},
            ).fetchone()
            if viewer_blocked:
                relationship = "blocked"
            elif are_friends(conn, viewer_user_id, owner):
                relationship = "friends"
            else:
                pend = conn.execute(
                    """
                    SELECT from_user_id::text AS from_id FROM friend_requests
                     WHERE status = 'pending'
                       AND ((from_user_id = %(v)s::uuid AND to_user_id = %(o)s::uuid)
                         OR (from_user_id = %(o)s::uuid AND to_user_id = %(v)s::uuid))
                     LIMIT 1
                    """,
                    {"o": owner, "v": viewer_user_id},
                ).fetchone()
                if pend:
                    relationship = "outgoing" if pend["from_id"] == viewer_user_id else "incoming"
    return {
        "user_id": owner,
        "name": row.get("name"),
        "created_at": row["created_at"],
        "image_updated_at": row.get("image_updated_at"),
        "relationship": relationship,
    }
