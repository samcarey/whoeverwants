"""User profile card for the long-press → profile modal.

`get_profile_card` returns another user's display name, avatar timestamp,
account age (`created_at`), and the groups the CALLER shares with them
(computed per-caller). Account-aware: the caller's visible memberships come
from `load_user_visibility` (unions every browser linked to their account);
the target's memberships union every browser linked to theirs — mirroring
`services/contacts.py`. The group/poll member ROSTERS live in
`services/groups.py` (`load_group_members` / `load_poll_voters`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from services.groups import group_display_name, load_user_visibility


@dataclass
class SharedGroup:
    route_id: str
    name: str | None


@dataclass
class ProfileCard:
    user_id: str
    name: str | None
    image_updated_at: datetime | None
    created_at: datetime
    shared_groups: list[SharedGroup]


def get_profile_card(
    conn,
    target_user_id: str,
    *,
    caller_browser_id: str | None,
    caller_user_id: str | None,
) -> ProfileCard | None:
    """The profile card for `target_user_id` from the CALLER's perspective.

    Returns None when the target account doesn't exist. Name + image are
    account-level (already broadly exposed — the image endpoint is public, the
    name surfaces in invitable-accounts / the members roster to any member).
    `shared_groups` is the intersection of the caller's visible memberships and
    the target's memberships, so it never reveals a group the caller can't see.
    """
    urow = conn.execute(
        "SELECT display_name, created_at FROM users WHERE id = %(id)s::uuid",
        {"id": target_user_id},
    ).fetchone()
    if not urow:
        return None
    prow = conn.execute(
        "SELECT image_updated_at FROM user_profiles WHERE user_id = %(id)s::uuid",
        {"id": target_user_id},
    ).fetchone()
    image_updated_at = prow.get("image_updated_at") if prow else None

    # Caller's visible group set (account-aware union of their browsers).
    vis = load_user_visibility(conn, caller_browser_id, user_id=caller_user_id)
    caller_gids = list(vis.joined_by_group.keys())
    shared: list[SharedGroup] = []
    if caller_gids:
        grows = conn.execute(
            """
            SELECT g.id::text AS id, g.short_id AS short_id, g.title AS title
              FROM groups g
             WHERE g.id = ANY(%(gids)s::uuid[])
               AND EXISTS (
                 SELECT 1 FROM group_members gm
                  WHERE gm.group_id = g.id
                    AND gm.browser_id IN (
                          SELECT browser_id FROM user_browsers
                           WHERE user_id = %(target)s::uuid
                        )
               )
             ORDER BY g.created_at DESC
            """,
            {"gids": caller_gids, "target": target_user_id},
        ).fetchall()
        for g in grows:
            route_id = g.get("short_id") or g["id"]
            name = group_display_name(conn, g["id"], override=g.get("title"))
            shared.append(SharedGroup(route_id=route_id, name=name))

    return ProfileCard(
        user_id=target_user_id,
        name=urow.get("display_name"),
        image_updated_at=image_updated_at,
        created_at=urow["created_at"],
        shared_groups=shared,
    )
