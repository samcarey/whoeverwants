"""Per-account contact list ("people you've encountered").

Backs the group "invite members" screen (`GET /api/groups/{id}/invitable-accounts`
+ `POST /api/groups/{id}/members`). We track ACCOUNTS, not names — a contact is
a `user_id`. The display name is resolved per-account at read time.

Two facts about each contact:
  * `last_seen_at` — PERSISTED. Bumped whenever the owner is observed sharing a
    group with the contact. Survives them leaving the shared group, so the
    invite screen can still list (and recency-sort) someone the owner was in
    groups with recently but shares none with now.
  * "current shared-group count" — NOT persisted. Computed live in
    `list_invitable_accounts`, since it changes as groups come and go.

`reconcile_contacts` is the maintenance primitive: a single idempotent upsert
of every account the owner currently shares a group with, bumping
`last_seen_at=NOW()`. It runs on the read paths the owner already hits (the
invite-screen candidates endpoint inline, and `POST /api/groups/mine` via a
decoupled background task) — that's what keeps the address book + recency
fresh WITHOUT wiring a contact write into every membership-establishing code
path (vote / visit / approve / redeem). Whatever the owner currently shares
gets captured the next time they load their home or open the invite screen.

Account-aware throughout: "the owner's memberships" unions every browser
linked to the owner's account (mirroring `services/groups.load_user_visibility`),
and a contact's memberships union every browser linked to the contact's account.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database import get_db

log = logging.getLogger(__name__)


def reconcile_contacts(conn, owner_user_id: str) -> None:
    """Upsert every account the owner currently shares a group with, bumping
    `last_seen_at=NOW()`. Idempotent single statement; a no-op when the owner
    has no group memberships (the inner SELECT yields no rows)."""
    conn.execute(
        """
        INSERT INTO user_contacts (owner_user_id, contact_user_id, last_seen_at)
        SELECT %(me)s::uuid, others.uid, NOW()
          FROM (
            SELECT DISTINCT theirs_ub.user_id AS uid
              FROM group_members mine
              JOIN group_members theirs ON theirs.group_id = mine.group_id
              JOIN user_browsers theirs_ub ON theirs_ub.browser_id = theirs.browser_id
             WHERE mine.browser_id IN (
                     SELECT browser_id FROM user_browsers WHERE user_id = %(me)s::uuid
                   )
               AND theirs_ub.user_id <> %(me)s::uuid
          ) others
        ON CONFLICT (owner_user_id, contact_user_id)
        DO UPDATE SET last_seen_at = NOW()
        """,
        {"me": owner_user_id},
    )


def reconcile_contacts_safe(owner_user_id: str | None) -> None:
    """Decoupled, best-effort `reconcile_contacts` for use as a BackgroundTask
    from a hot read path. Opens its own connection; logs + swallows any error
    so contact-maintenance can never break the request it rode in on."""
    if not owner_user_id:
        return
    try:
        with get_db() as conn:
            reconcile_contacts(conn, owner_user_id)
    except Exception:  # noqa: BLE001
        log.exception("reconcile_contacts_safe failed for %s", owner_user_id)


@dataclass
class InvitableAccount:
    """An account the owner can invite to a group: a contact who is NOT
    already a member of that group. `shared_group_count` is the number of
    OTHER groups the owner currently shares with them (drives the primary
    sort); `last_seen_at` is the recency watermark (drives the secondary
    sort for accounts with 0 current shared groups). `name` is the
    account's display_name (may be null for accounts that never set one)."""

    user_id: str
    name: str | None
    shared_group_count: int
    last_seen_at: datetime | None


def list_invitable_accounts(
    conn, owner_user_id: str, group_id: str
) -> list[InvitableAccount]:
    """The owner's contacts who aren't already members of `group_id`, sorted
    by current shared-group count (desc) then last_seen_at (desc) then name.

    So accounts the owner is in MORE groups with float to the top, followed
    by accounts in 0 current shared groups ordered by how recently they were
    last in a group together.
    """
    rows = conn.execute(
        """
        SELECT c.contact_user_id::text AS user_id,
               u.display_name           AS name,
               c.last_seen_at           AS last_seen_at,
               COALESCE(cur.cnt, 0)     AS shared_group_count
          FROM user_contacts c
          JOIN users u ON u.id = c.contact_user_id
          LEFT JOIN LATERAL (
            -- Count of groups BOTH currently belong to. The contact is
            -- excluded from THIS group by the NOT EXISTS below, so this
            -- naturally counts only the OTHER shared groups.
            SELECT COUNT(DISTINCT mine.group_id) AS cnt
              FROM group_members mine
              JOIN group_members theirs ON theirs.group_id = mine.group_id
             WHERE mine.browser_id IN (
                     SELECT browser_id FROM user_browsers WHERE user_id = %(me)s::uuid
                   )
               AND theirs.browser_id IN (
                     SELECT browser_id FROM user_browsers
                      WHERE user_id = c.contact_user_id
                   )
          ) cur ON TRUE
         WHERE c.owner_user_id = %(me)s::uuid
           AND c.contact_user_id <> %(me)s::uuid
           AND NOT EXISTS (
             SELECT 1 FROM group_members gm
              WHERE gm.group_id = %(gid)s::uuid
                AND gm.browser_id IN (
                      SELECT browser_id FROM user_browsers
                       WHERE user_id = c.contact_user_id
                    )
           )
         ORDER BY shared_group_count DESC,
                  c.last_seen_at DESC,
                  u.display_name ASC
        """,
        {"me": owner_user_id, "gid": group_id},
    ).fetchall()
    return [
        InvitableAccount(
            user_id=r["user_id"],
            name=r.get("name"),
            shared_group_count=int(r["shared_group_count"] or 0),
            last_seen_at=r.get("last_seen_at"),
        )
        for r in rows
    ]


def is_contact(conn, owner_user_id: str, contact_user_id: str) -> bool:
    """Whether `contact_user_id` is in the owner's address book. The
    add-members endpoint gates on this so a caller can only add accounts they
    have actually encountered — guessing an arbitrary user_id won't work."""
    row = conn.execute(
        """
        SELECT 1 FROM user_contacts
         WHERE owner_user_id = %(o)s::uuid
           AND contact_user_id = %(c)s::uuid
         LIMIT 1
        """,
        {"o": owner_user_id, "c": contact_user_id},
    ).fetchone()
    return row is not None


def add_member_for_user(conn, group_id: str, contact_user_id: str) -> bool:
    """Add an account to a group. Returns True iff a NEW membership was
    established (so the caller knows whether to fire a notification).

    Keyed on the account's earliest-linked browser_id — same pattern as
    `join_requests.decide_request`. `load_user_visibility` expands one row to
    every device the account is signed in on, so a single row suffices.

    Returns False when the account is ALREADY a member via any of their
    browsers (no row written, no notification) or has no linked browser to
    key the row on (shouldn't happen for a real account)."""
    already = conn.execute(
        """
        SELECT 1 FROM group_members
         WHERE group_id = %(g)s::uuid
           AND browser_id IN (
                 SELECT browser_id FROM user_browsers WHERE user_id = %(u)s::uuid
               )
         LIMIT 1
        """,
        {"g": group_id, "u": contact_user_id},
    ).fetchone()
    if already:
        return False
    bid_row = conn.execute(
        """
        SELECT browser_id FROM user_browsers
         WHERE user_id = %(u)s::uuid
         ORDER BY linked_at ASC
         LIMIT 1
        """,
        {"u": contact_user_id},
    ).fetchone()
    if not bid_row:
        return False
    conn.execute(
        """
        INSERT INTO group_members (group_id, browser_id)
        VALUES (%(g)s::uuid, %(b)s::uuid)
        ON CONFLICT (group_id, browser_id) DO NOTHING
        """,
        {"g": group_id, "b": str(bid_row["browser_id"])},
    )
    return True
