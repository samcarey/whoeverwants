"""Phase F (group join requests) — server-side helpers.

Three operations:
  * `create_join_request(conn, group_id, requester_user_id, message)`
    inserts a `pending` row. Idempotent via the partial unique index on
    (group_id, requester_user_id) WHERE status='pending' — second call
    while pending returns the existing row instead of failing.
  * `list_pending_requests(conn, group_id)` reads pending rows with the
    requester's email joined in (the only durable identifier we have
    today; users without an email — passkey-only — surface as null).
  * `decide_request(conn, request_id, decision, deciding_user_id)`
    walks 'pending' → 'approved' | 'denied' AND (on approve) writes a
    `group_members` row keyed on one of the requester's `user_browsers`
    rows. Same load-bearing pattern as the membership-write helpers in
    `services/memberships.py`: ON CONFLICT DO NOTHING so an existing
    membership row keeps its original joined_at watermark.

The membership write picks the requester's earliest-linked browser_id
deterministically. Per `services/groups.py: load_user_visibility`,
`is_caller_member_of_group` expands membership across every browser
linked to a user_id, so ONE row is enough — every device the user is
signed in on will see the group immediately.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from services.groups import backdate_membership_for_user
from services.validation import truncate_text

logger = logging.getLogger(__name__)

# Cap on the requester's optional message. The FE textarea enforces the
# same limit (`JOIN_REQUEST_MESSAGE_MAX` in components/GroupLoadState.tsx
# — keep in lockstep); raw-API callers get silently truncated rather
# than 400'd, matching the `_sanitize_plus_one_names` trim-and-bound
# convention. The column is unbounded TEXT, so this is the only guard
# against megabyte messages rendered verbatim on the admins' /info page.
MESSAGE_MAX_CHARS = 500


@dataclass
class JoinRequestSummary:
    """Creator-facing view of a pending request. `requester_email` is
    null for passkey-only users — Phase D registration permits accounts
    with no email at all. UI falls back to a "Passkey user" placeholder
    in that case.

    `requester_name` is the requester's account `display_name` (a name
    is required to request access, so it's populated for real requests).
    `requester_image_updated_at` is the cache-buster for the requester's
    profile image (NULL when they have no uploaded photo) — the FE builds
    the public `/by-user-id/<id>/image?v=<ts>` URL from it +
    `requester_user_id`."""

    id: str
    group_id: str
    requester_user_id: str
    requester_email: str | None
    requester_name: str | None
    requester_image_updated_at: datetime | None
    message: str | None
    requested_at: datetime


def create_join_request(
    conn,
    group_id: str,
    requester_user_id: str,
    message: str | None,
) -> JoinRequestSummary:
    """Insert a pending join request OR return the existing pending row.

    Idempotent: the partial unique index forbids two pending rows for
    the same (group, requester), so a repeated request just resolves to
    the original. The original's `message` is NOT overwritten on the
    second call — the creator has already been notified once and we
    don't want a re-fire on every "polite re-request" tap. Phase I can
    add an explicit "edit my message" action if anyone asks.
    """
    msg = truncate_text(message, MESSAGE_MAX_CHARS)
    # Attempt INSERT; on conflict, SELECT the existing row. Two-step is
    # the cleanest way to express "first writer wins, everyone else
    # reads" in postgres without a RAISE-and-recover dance.
    row = conn.execute(
        """
        INSERT INTO group_join_requests (group_id, requester_user_id, message)
        VALUES (%(gid)s::uuid, %(uid)s::uuid, %(msg)s)
        ON CONFLICT (group_id, requester_user_id)
            WHERE status = 'pending'
            DO NOTHING
        RETURNING id, group_id, requester_user_id, message, requested_at
        """,
        {"gid": group_id, "uid": requester_user_id, "msg": msg},
    ).fetchone()
    if row is None:
        row = conn.execute(
            """
            SELECT id, group_id, requester_user_id, message, requested_at
              FROM group_join_requests
             WHERE group_id = %(gid)s::uuid
               AND requester_user_id = %(uid)s::uuid
               AND status = 'pending'
             LIMIT 1
            """,
            {"gid": group_id, "uid": requester_user_id},
        ).fetchone()
    return JoinRequestSummary(
        id=str(row["id"]),
        group_id=str(row["group_id"]),
        requester_user_id=str(row["requester_user_id"]),
        requester_email=None,
        requester_name=None,
        requester_image_updated_at=None,
        message=row.get("message"),
        requested_at=row["requested_at"],
    )


def is_member_or_creator(
    conn,
    group_id: str,
    user_id: str,
) -> bool:
    """Short-circuit for the request endpoint: if the caller is already
    visible into the group via membership OR they're the recorded
    creator, skip the join-request insert (and let the route return 200
    instead of 201). Matches `is_caller_member_of_group`'s user_id leg
    plus a creator check — both are cheap one-shot lookups."""
    row = conn.execute(
        """
        SELECT 1 FROM group_members
         WHERE group_id = %(g)s::uuid
           AND browser_id IN (
               SELECT browser_id FROM user_browsers WHERE user_id = %(u)s::uuid
           )
         LIMIT 1
        """,
        {"g": group_id, "u": user_id},
    ).fetchone()
    if row:
        return True
    row = conn.execute(
        """
        SELECT 1 FROM groups
         WHERE id = %(g)s::uuid AND creator_user_id = %(u)s::uuid
         LIMIT 1
        """,
        {"g": group_id, "u": user_id},
    ).fetchone()
    return row is not None


def list_pending_requests(conn, group_id: str) -> list[JoinRequestSummary]:
    """Pending requests for a group, oldest first. The email column is
    the requester's most-recently-verified email across their identity
    rows (NULL for passkey-only). `requester_name` is the account
    display_name; `requester_image_updated_at` is the profile-photo
    cache-buster (NULL when no photo)."""
    rows = conn.execute(
        """
        SELECT r.id,
               r.group_id,
               r.requester_user_id,
               r.message,
               r.requested_at,
               u.display_name AS requester_name,
               up.image_updated_at AS requester_image_updated_at,
               (
                   SELECT ui.email
                     FROM user_identities ui
                    WHERE ui.user_id = r.requester_user_id
                      AND ui.email IS NOT NULL
                    ORDER BY ui.created_at DESC
                    LIMIT 1
               ) AS requester_email
          FROM group_join_requests r
          LEFT JOIN users u ON u.id = r.requester_user_id
          LEFT JOIN user_profiles up ON up.user_id = r.requester_user_id
         WHERE r.group_id = %(g)s::uuid
           AND r.status = 'pending'
         ORDER BY r.requested_at ASC
        """,
        {"g": group_id},
    ).fetchall()
    return [
        JoinRequestSummary(
            id=str(r["id"]),
            group_id=str(r["group_id"]),
            requester_user_id=str(r["requester_user_id"]),
            requester_email=r.get("requester_email"),
            requester_name=r.get("requester_name"),
            requester_image_updated_at=r.get("requester_image_updated_at"),
            message=r.get("message"),
            requested_at=r["requested_at"],
        )
        for r in rows
    ]


@dataclass
class DecidedRequest:
    """Result of `decide_request`. Carries the new status + the
    requester's user_id so the router can drive any follow-up
    notification (Phase F doesn't fire one on deny — the requester
    doesn't get told "why" — but the data is here for Phase I)."""

    request_id: str
    group_id: str
    requester_user_id: str
    status: str  # 'approved' | 'denied'


def decide_request(
    conn,
    request_id: str,
    decision: str,
    deciding_user_id: str,
) -> DecidedRequest | None:
    """Walk a pending request to 'approved' or 'denied'. Returns None
    when the request doesn't exist or isn't pending (idempotent: a
    double-tap on Approve doesn't re-fire side effects).

    On approve, writes a `group_members` row keyed on the requester's
    earliest-linked browser_id. Picking one browser is sufficient —
    `load_user_visibility` expands membership across every linked
    browser via `user_browsers`. `joined_at` is backdated to the
    request's `requested_at` (not approval time) so a poll that closed
    while the request was pending stays visible to the new member.

    The decision row's `decided_at` is set to NOW(); `decided_by_user_id`
    records who clicked the button so the audit history is intact even
    after the creator's user row is deleted (FK is ON DELETE SET NULL).
    """
    if decision not in ("approved", "denied"):
        raise ValueError(f"invalid decision: {decision!r}")

    # Atomic transition: only flip if currently pending. RETURNING is
    # what tells us whether the transition actually fired (vs the row
    # being absent or already-decided).
    row = conn.execute(
        """
        UPDATE group_join_requests
           SET status = %(s)s,
               decided_at = NOW(),
               decided_by_user_id = %(d)s::uuid
         WHERE id = %(r)s::uuid
           AND status = 'pending'
        RETURNING id, group_id, requester_user_id, requested_at
        """,
        {"s": decision, "r": request_id, "d": deciding_user_id},
    ).fetchone()
    if row is None:
        return None

    if decision == "approved":
        # Establish membership keyed on the requester's earliest-linked
        # browser. `joined_at` is back-dated to when the request was MADE
        # (`requested_at`), not approval time, so a poll that closed while
        # the request sat pending stays visible to the new member — they
        # reached out expecting to see the group as it stood then. A
        # requester with no linked browser is a no-op (the row stays
        # approved; the next browser link picks it up via the auto-claim
        # path in docs/auth-access-model.md).
        backdate_membership_for_user(
            conn,
            str(row["group_id"]),
            str(row["requester_user_id"]),
            row["requested_at"],
        )

    return DecidedRequest(
        request_id=str(row["id"]),
        group_id=str(row["group_id"]),
        requester_user_id=str(row["requester_user_id"]),
        status=decision,
    )
