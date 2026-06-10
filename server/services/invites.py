"""Phase G (group invites) — server-side helpers.

Four operations:
  * `issue_invite(conn, ...)` mints a raw token + persists its sha256
    hash + metadata. Returns the raw token to the caller exactly once.
  * `list_active_invites(conn, group_id)` returns non-revoked,
    non-expired invites with use_count info, sorted newest first.
  * `redeem_invite(conn, token, user_id)` walks the redemption
    transaction: validates the token + use_count + expiry + revoked
    state, bumps use_count, writes a `group_members` row for the
    requester's earliest-linked browser_id (with `joined_at` backdated
    to the invite's `created_at` so the joiner sees polls that closed
    between invite-send and redeem), returns the resolved group_id +
    target poll info for the FE redirect.
  * `revoke_invite(conn, invite_id, by_user_id)` stamps `revoked_at`
    on a creator-owned invite. Idempotent.

Token storage mirrors sessions + magic-link tokens: raw value returned
ONLY at create time, sha256 hash persisted. The raw token never sits in
the DB at rest.

Redemption is gated on user_id (signed-in only). Anonymous browsers
can't redeem because there's no durable identity to write membership
against — the same reasoning as Phase F join requests.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from services.auth import generate_token, hash_token
from services.groups import backdate_membership_for_user

logger = logging.getLogger(__name__)


@dataclass
class IssuedInvite:
    """Result of `issue_invite`. `token` is the raw value — returned
    ONCE at create time and embedded in the shareable URL. Server
    stores only `token_hash`; if the creator loses the URL, they have
    to mint a new invite."""

    id: str
    token: str
    group_id: str
    mode: str
    target_poll_id: str | None
    max_uses: int | None
    use_count: int
    expires_at: datetime | None
    created_at: datetime


@dataclass
class InviteSummary:
    """Creator-facing view of an active invite (no raw token — that's
    one-shot at create time). The FE builds the shareable URL on the
    server side via the `url` field on the create response;
    list-endpoint entries don't carry one because the creator already
    has the URL from the create call. `use_count` + `max_uses` drive
    the "3/5 uses" display."""

    id: str
    group_id: str
    mode: str
    target_poll_id: str | None
    max_uses: int | None
    use_count: int
    expires_at: datetime | None
    created_at: datetime


@dataclass
class RedeemResult:
    """Result of `redeem_invite`. `group_short_id` and
    `target_poll_short_id` are pre-resolved so the FE doesn't need a
    second round-trip to build the redirect URL. `already_member` is
    True when redemption was a no-op because membership existed before
    the redeem call — use_count is NOT bumped in that case (a member
    re-clicking the URL shouldn't consume an invite use)."""

    group_id: str
    group_short_id: str | None
    target_poll_id: str | None
    target_poll_short_id: str | None
    already_member: bool


def issue_invite(
    conn,
    *,
    group_id: str,
    created_by_user_id: str,
    mode: str,
    target_poll_id: str | None = None,
    max_uses: int | None = None,
    expires_in_hours: int | None = None,
) -> IssuedInvite:
    """Mint a new invite. Caller is responsible for authorization
    (creator-only at the router layer).

    `mode='single'` forces `max_uses=1` regardless of what was passed
    (the client's request is normalized rather than rejected — fewer
    edge cases to surface in the UI).
    `mode='multi'` accepts max_uses NULL (unlimited) or any positive
    int.

    `expires_in_hours` is the client's "expire after N hours" knob;
    NULL = never expires (the creator must revoke explicitly).
    """
    if mode not in ("single", "multi"):
        raise ValueError(f"invalid mode: {mode!r}")
    if mode == "single":
        max_uses = 1
    elif max_uses is not None and max_uses <= 0:
        raise ValueError("max_uses must be positive")
    expires_at: datetime | None = None
    if expires_in_hours is not None:
        if expires_in_hours <= 0:
            raise ValueError("expires_in_hours must be positive")
        expires_at = datetime.now(timezone.utc) + timedelta(
            hours=expires_in_hours
        )

    raw_token = generate_token()
    row = conn.execute(
        """
        INSERT INTO group_invites (
            token_hash, group_id, created_by_user_id, mode,
            target_poll_id, max_uses, expires_at
        )
        VALUES (
            %(h)s, %(g)s::uuid, %(u)s::uuid, %(m)s,
            %(p)s, %(mx)s, %(e)s
        )
        RETURNING id, group_id, mode, target_poll_id, max_uses,
                  use_count, expires_at, created_at
        """,
        {
            "h": hash_token(raw_token),
            "g": group_id,
            "u": created_by_user_id,
            "m": mode,
            "p": target_poll_id,
            "mx": max_uses,
            "e": expires_at,
        },
    ).fetchone()
    return IssuedInvite(
        id=str(row["id"]),
        token=raw_token,
        group_id=str(row["group_id"]),
        mode=row["mode"],
        target_poll_id=(
            str(row["target_poll_id"]) if row.get("target_poll_id") else None
        ),
        max_uses=row.get("max_uses"),
        use_count=row["use_count"],
        expires_at=row.get("expires_at"),
        created_at=row["created_at"],
    )


def list_active_invites(conn, group_id: str) -> list[InviteSummary]:
    """List a group's active (non-revoked, non-expired, not-fully-used)
    invites, newest first. The compound active-predicate matches the
    redeem-time check in `redeem_invite` so the list and the actual
    redeemable set don't diverge."""
    rows = conn.execute(
        """
        SELECT id, group_id, mode, target_poll_id, max_uses,
               use_count, expires_at, created_at
          FROM group_invites
         WHERE group_id = %(g)s::uuid
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (max_uses IS NULL OR use_count < max_uses)
         ORDER BY created_at DESC
        """,
        {"g": group_id},
    ).fetchall()
    return [
        InviteSummary(
            id=str(r["id"]),
            group_id=str(r["group_id"]),
            mode=r["mode"],
            target_poll_id=(
                str(r["target_poll_id"]) if r.get("target_poll_id") else None
            ),
            max_uses=r.get("max_uses"),
            use_count=r["use_count"],
            expires_at=r.get("expires_at"),
            created_at=r["created_at"],
        )
        for r in rows
    ]


def revoke_invite(conn, invite_id: str, group_id: str) -> bool:
    """Mark an invite as revoked. Returns True iff the UPDATE affected a row
    (the invite existed in `group_id` and wasn't already revoked).

    Migration 142: scoped to `group_id` rather than the minting user, so ANY
    admin of the group (gated at the router) can revoke any of its invites —
    invite management is a shared admin power. The group_id check keeps a
    guessed invite_id from another group from being revoked through this
    group's route.
    """
    row = conn.execute(
        """
        UPDATE group_invites
           SET revoked_at = NOW()
         WHERE id = %(i)s::uuid
           AND group_id = %(g)s::uuid
           AND revoked_at IS NULL
        RETURNING id
        """,
        {"i": invite_id, "g": group_id},
    ).fetchone()
    return row is not None


def redeem_invite(
    conn,
    token: str,
    user_id: str,
) -> RedeemResult | None:
    """Validate + consume an invite. Returns the resolved group +
    target poll info for the FE redirect. Returns None when the token
    is invalid, expired, revoked, or fully used — the router 404s in
    all those cases so we don't leak which specific reason failed.

    Atomic increment is the load-bearing piece. Two simultaneous
    redemptions race on `use_count < max_uses` if we do read-then-write;
    the UPDATE with the predicate in the WHERE clause + RETURNING
    serializes them at row-lock granularity. Whoever wins the lock
    increments; whoever loses sees `use_count = max_uses` on retry and
    fails the predicate.

    Already-member short-circuit: if the requester is already a member
    (via any of their linked browsers) we don't bump use_count — a
    member re-clicking the share URL shouldn't consume a use. Same
    rationale as Phase F's `is_member_or_creator` skip.
    """
    if not token:
        return None

    # Atomic conditional UPDATE: only bump if redeemable. RETURNING
    # tells us whether the lock + predicate succeeded.
    invite = conn.execute(
        """
        UPDATE group_invites
           SET use_count = use_count + 1
         WHERE token_hash = %(h)s
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING id, group_id, target_poll_id, created_at
        """,
        {"h": hash_token(token)},
    ).fetchone()
    if invite is None:
        return None

    group_id = str(invite["group_id"])
    target_poll_id = (
        str(invite["target_poll_id"]) if invite.get("target_poll_id") else None
    )
    # Backdate the joiner's membership watermark to the moment the invite
    # was MINTED (`created_at`), not the redeem time. The closed-before-join
    # filter (services/groups.py) hides polls that closed before joined_at;
    # an invite is the creator sharing "the group as it stands now", so the
    # joiner should see polls that closed between invite-send and redeem.
    invite_created_at = invite["created_at"]

    # Check existing membership across every browser linked to the
    # requesting user_id. Same logic as
    # `services/join_requests.is_member_or_creator` minus the creator
    # leg — creators can redeem their own invite too (it's a no-op
    # increment-then-skip-write path).
    already_member_row = conn.execute(
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
    already_member = already_member_row is not None

    if already_member:
        # Roll back the use_count bump so a re-clicking member doesn't
        # consume a use. A separate UPDATE keeps the redemption
        # transaction concise; the race here is benign (a concurrent
        # non-member redeem would have written its own row by now).
        conn.execute(
            """
            UPDATE group_invites
               SET use_count = use_count - 1
             WHERE id = %(i)s::uuid
            """,
            {"i": str(invite["id"])},
        )

    # Write (or backdate) membership keyed on the requester's
    # earliest-linked browser_id. Runs even for an already-member: the
    # LEAST-upsert can only pull the watermark earlier, never later (see
    # backdate_membership_for_user).
    backdate_membership_for_user(
        conn, group_id, user_id, invite_created_at
    )

    # Record which invite this member joined through (migration 142) so a
    # future boot can revoke this specific link. Only on a genuine first join
    # (not an already-member re-click — they didn't join via this link) and
    # only when not already attributed, on the earliest-linked browser's row
    # (the one backdate_membership_for_user wrote).
    if not already_member:
        conn.execute(
            """
            UPDATE group_members
               SET joined_via_invite_id = %(i)s::uuid
             WHERE group_id = %(g)s::uuid
               AND joined_via_invite_id IS NULL
               AND browser_id IN (
                   SELECT browser_id FROM user_browsers WHERE user_id = %(u)s::uuid
               )
            """,
            {"i": str(invite["id"]), "g": group_id, "u": user_id},
        )

    # Resolve short_ids in one round-trip so the FE can build the
    # redirect URL without a follow-up call.
    group_short_id_row = conn.execute(
        "SELECT short_id FROM groups WHERE id = %(g)s::uuid",
        {"g": group_id},
    ).fetchone()
    target_poll_short_id: str | None = None
    if target_poll_id:
        poll_row = conn.execute(
            "SELECT short_id FROM polls WHERE id = %(p)s::uuid",
            {"p": target_poll_id},
        ).fetchone()
        if poll_row:
            target_poll_short_id = poll_row.get("short_id")

    return RedeemResult(
        group_id=group_id,
        group_short_id=(
            group_short_id_row.get("short_id") if group_short_id_row else None
        ),
        target_poll_id=target_poll_id,
        target_poll_short_id=target_poll_short_id,
        already_member=already_member,
    )
