"""Group API endpoints.

Two read endpoints — `POST /api/groups/mine` and
`GET /api/groups/by-route-id/{route_id}` — collapse the legacy three-step
home / group page bootstrap (discoverRelatedQuestions + getAccessiblePolls
+ client-side `buildGroups`) into a single server round-trip driven by
`polls.group_id`.

`POST /api/groups` creates an empty group and joins the caller — used by
the home "+" FAB so a group materializes in the DB BEFORE any polls
exist. That way the user can name the group, see info, and share the
URL immediately. Empty groups (member with 0 visible polls) are
surfaced on `POST /api/groups/mine` via the `empty_groups` array, and
on `GET /api/groups/by-route-id/{id}/summary` for the group page's
direct-URL load path.

A third endpoint — `DELETE /api/groups/{route_id}/membership` — is the
explicit "leave group" action. It removes the caller's `group_members`
row, taking the user out of membership-driven visibility.

Both read endpoints enforce the visibility rule documented in
`services/groups.py` against the browser_id captured by
`BrowserIdMiddleware`. Migration 106 retired per-poll access — visiting
any group URL via `/by-route-id/{id}` writes a `group_members` row
inline, granting whole-group visibility (subject to the
closed-before-join filter). Sharing a group link with someone is now
sufficient to bring them into the conversation; they don't need to vote
first.
"""

from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from database import get_db
from middleware import (
    browser_id_from_request as _browser_id,
    user_id_from_request as _user_id,
)
from models import PollResponse, UpdateGroupTitleRequest
from services.invites import (
    IssuedInvite,
    InviteSummary,
    issue_invite,
    list_active_invites,
    revoke_invite,
)
from services.join_requests import (
    create_join_request,
    decide_request,
    is_member_or_creator,
    list_pending_requests,
)
from services.auth import resolve_actor_user_id
from services.contacts import (
    add_member_for_user,
    is_contact,
    list_invitable_accounts,
    reconcile_contacts,
    reconcile_contacts_safe,
)
from services.memberships import leave_group as _leave_group_row
from services.validation import validate_user_name
from services.groups import (
    _is_uuid_like,
    claim_group as _claim_group_row,
    filter_visible_polls,
    get_group_metadata,
    grant_group_membership_inline,
    group_name_phrase,
    is_caller_member_of_group,
    load_user_visibility,
    poll_ids_for_group_ids,
    polls_for_poll_ids,
    resolve_group_for_visit,
    resolve_group_id_from_route_id,
)
from services.push import fan_out_join_request, fan_out_to_user


class GroupSummary(BaseModel):
    """Minimal group metadata for a group that may or may not have polls
    yet. Surfaced by `POST /api/groups` (the empty-group create endpoint),
    `GET /api/groups/by-route-id/{id}/summary` (for the group page's
    direct-URL load when there are no visible polls), and the
    `empty_groups` array on `POST /api/groups/mine`.

    `image_updated_at` (migration 108) is the ISO timestamp of when the
    group's avatar image was last set/cleared. Null when no custom image
    is set. The FE constructs `/api/groups/by-route-id/<id>/image?v=<ts>`
    using this value as the cache-buster.

    `privacy` + `creator_user_id` (migration 114, Phase E) drive the
    visibility filter and the /info privacy badge. `privacy` is
    'public' or 'private'; `creator_user_id` is the signed-in creator's
    user_id (NULL for anonymous-created groups and grandfathered
    pre-Phase-E groups).
    """

    id: str
    short_id: str | None = None
    title: str | None = None
    created_at: str
    image_updated_at: str | None = None
    privacy: str | None = None
    creator_user_id: str | None = None
    # True iff the group has ANY polls at all, regardless of the caller's
    # visibility (the closed-before-join filter can hide every poll from a
    # late joiner, so `/by-route-id` returns [] while the group is not
    # actually empty). Lets the FE distinguish a brand-new empty group
    # (show the create-first-poll flow) from a group whose history is all
    # hidden pre-join (show the To Do/New/Old tabs with empty messages).
    # Only `get_group_summary` computes a real value; the /empty + create
    # paths are genuinely poll-less so they keep the False default.
    has_polls: bool = False


class UpdateGroupPrivacyRequest(BaseModel):
    """Body for `POST /api/groups/{route_id}/privacy`.

    Only the group's recorded `creator_user_id` (set at create time
    when the creator was signed in) can flip privacy. Phase F/G will
    layer join requests + invite links on top of this so non-creators
    can still get into private groups.
    """

    privacy: str  # 'public' or 'private'


class UpdateGroupPrivacyResponse(BaseModel):
    group_id: str
    group_short_id: str | None = None
    privacy: str
    creator_user_id: str | None = None


class ClaimGroupResponse(BaseModel):
    """Returned by `POST /api/groups/{route_id}/claim`. Surfaces the new
    `creator_user_id` (always the caller) so the FE can patch its
    in-memory group state and immediately enable creator-only controls
    (privacy toggle, join-request approval, invite-link minting)
    without a refetch. `privacy` is included for parity with the
    privacy endpoint's shape, even though claiming doesn't flip it."""

    group_id: str
    group_short_id: str | None = None
    privacy: str
    creator_user_id: str


class GroupPreviewResponse(BaseModel):
    """Public-readable group metadata for link-preview (Open Graph)
    crawlers. Returns ONLY title + description — no question contents,
    no votes, no creator names, no per-poll details — so it's safe to
    serve without visibility checks. The URL itself is the share token;
    if you can hit this endpoint you've been handed the link."""

    title: str
    description: str | None = None


class GroupPollResponse(BaseModel):
    """Visibility-aware single-poll read for the direct-poll-link landing
    (`GET /api/groups/by-route-id/{route_id}/poll/{poll_ref}`).

    `status`:
      - "visible": the caller can see this poll; `poll` carries the full
        PollResponse (identical shape to the group read's entries).
      - "hidden_pre_join": the poll exists in this group and the caller IS
        a member, but it closed before the caller joined the group, so the
        visibility rule withholds its contents. `poll` is null; `closed_at`
        is the closure timestamp (the `polls.updated_at` close proxy) so the
        FE can render a clear "this poll closed before you joined" note —
        existence + closure timing ONLY, never the hidden poll's contents.

    A poll that doesn't exist in this group (or a private group the caller
    isn't a member of) returns 404, never this body."""

    status: str
    poll: PollResponse | None = None
    closed_at: str | None = None


class GroupImageRequest(BaseModel):
    """`POST /api/groups/{route_id}/image` body.

    `image_base64` is the FE-cropped square image (JPEG or PNG) encoded as
    base64 with no `data:` prefix. `mime_type` must be `image/jpeg` or
    `image/png`. Max decoded size: `MAX_IMAGE_BYTES`. The FE crops to a
    square + downscales to ~512px before sending, so the typical payload
    is well under 100KB.
    """

    image_base64: str
    mime_type: str


class GroupImageResponse(BaseModel):
    group_id: str
    group_short_id: str | None = None
    image_updated_at: str | None = None


# 5 MiB — well above the FE-cropped ~100KB target but below anything
# that would risk OOMing the 1GB droplet's API container even on a
# pathological client.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png"})


class GroupTitleResponse(BaseModel):
    """Returned by `POST /api/groups/{route_id}/title`. Surfaces the
    fields the FE needs to patch its in-memory group cache without a
    refetch: the resolved group id, its short_id (so the route id is
    canonical going forward), and the new title (or null on clear)."""

    group_id: str
    group_short_id: str | None = None
    title: str | None = None

router = APIRouter(prefix="/api/groups", tags=["groups"])


class MyGroupsRequest(BaseModel):
    """Request body for `POST /api/groups/mine`.

    `group_members` is the single source of truth for visibility. The old
    localStorage `accessible_question_ids` "forget bridge" is fully gone —
    the field was retired from this model too. Older client bundles that
    still POST `accessible_question_ids` are unaffected: Pydantic's default
    `extra="ignore"` drops the unknown key (no 422), matching the prior
    behavior where the declared field was accepted-but-never-read.
    """

    include_results: bool = True


@router.post("/mine", response_model=list[PollResponse])
def get_my_groups(
    req: MyGroupsRequest, request: Request, background_tasks: BackgroundTasks
):
    """Return every poll the user has visibility into. See the visibility
    rule in `services/groups.py`.

    `group_members` is the sole authority: every group the caller (or any
    browser linked to their user_id) is a member of contributes its
    visible polls (open OR closed-after-joined_at). The legacy
    `accessible_question_ids` forget bridge has been removed — "forget a
    group" is now "leave the group" (DELETE /api/groups/{id}/membership).

    Membership-only "empty groups" (member row but zero visible polls)
    are surfaced by the sibling `POST /api/groups/empty` endpoint.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)

    with get_db() as conn:
        visibility = load_user_visibility(conn, browser_id, user_id=user_id)

        member_group_ids = list(visibility.joined_by_group.keys())
        candidate_pids = poll_ids_for_group_ids(conn, member_group_ids)
        if not candidate_pids:
            return []

        visible_pids = filter_visible_polls(conn, candidate_pids, visibility)
        viewer_user_id = resolve_actor_user_id(
            conn, user_id=user_id, browser_id=browser_id
        )
        # Keep the caller's contact list ("people you've encountered") fresh
        # off the home-load path: a decoupled upsert of everyone they
        # currently share a group with, bumping each contact's last_seen_at.
        # This is the always-running hook that lets the invite screen later
        # surface someone the caller no longer shares a group with — it
        # captures the encounter (+ recency) while they still do. No-op for
        # account-less callers (reconcile_contacts_safe handles None).
        background_tasks.add_task(reconcile_contacts_safe, viewer_user_id)
        return polls_for_poll_ids(
            conn, visible_pids, include_results=req.include_results,
            viewer_user_id=viewer_user_id, viewer_browser_id=browser_id,
        )


@router.post("/empty", response_model=list[GroupSummary])
def get_my_empty_groups(request: Request):
    """Return every group the caller is a `group_members` row for that
    has zero polls. Sorted newest-first. Called by the home page in
    parallel with `/mine`.

    The visibility rule is intentionally NOT applied — a group whose
    every poll was closed before the caller's joined_at watermark
    still appears here (the "are there any polls at all?" question
    has no time dimension). The /mine endpoint owns visibility
    filtering for groups that do have polls.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    if not browser_id and not user_id:
        return []
    with get_db() as conn:
        # Membership predicate matches `load_user_visibility`'s logic:
        # current browser OR any browser linked to the caller's
        # user_id. DISTINCT collapses duplicates when multiple linked
        # browsers all have a row for the same group.
        rows = conn.execute(
            """SELECT DISTINCT g.id, g.short_id, g.title, g.created_at,
                       g.image_updated_at, g.privacy, g.creator_user_id
                 FROM groups g
                 JOIN group_members m ON m.group_id = g.id
                WHERE (
                    m.browser_id = %(bid)s::uuid
                    OR (
                        %(uid)s::uuid IS NOT NULL
                        AND m.browser_id IN (
                            SELECT browser_id FROM user_browsers
                             WHERE user_id = %(uid)s::uuid
                        )
                    )
                )
                  AND NOT EXISTS (
                      SELECT 1 FROM polls p WHERE p.group_id = g.id
                  )
                ORDER BY g.created_at DESC""",
            {"bid": browser_id, "uid": user_id},
        ).fetchall()
        return [_row_to_group_summary(r) for r in rows]


def _row_to_group_summary(row, has_polls: bool = False) -> GroupSummary:
    created_at = row.get("created_at")
    image_updated_at = row.get("image_updated_at")
    creator_user_id = row.get("creator_user_id")
    return GroupSummary(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        title=row.get("title"),
        created_at=created_at.isoformat() if created_at else "",
        image_updated_at=image_updated_at.isoformat() if image_updated_at else None,
        privacy=row.get("privacy"),
        creator_user_id=str(creator_user_id) if creator_user_id else None,
        has_polls=has_polls,
    )


_GROUP_SUMMARY_COLUMNS = (
    "id, short_id, title, created_at, image_updated_at, privacy, creator_user_id"
)


@router.post("", response_model=GroupSummary, status_code=201)
def create_group(request: Request):
    """Create an empty group + auto-join the caller as a member.

    Requires `browser_id` (from `BrowserIdMiddleware`) — without one
    the group would be created but unreachable, so return 400 and let
    the FE retry after the middleware mints an id.

    Phase E: privacy + creator_user_id are derived from the caller's
    auth state. Signed-in callers get `privacy='private'` with
    `creator_user_id` recorded; anonymous callers always get
    `privacy='public'`. There's no body param for this — anonymous
    browsers can't create private groups (the spec invariant: approval
    authority can't be stranded on a wiped browser).
    """
    browser_id = _browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=400, detail="Missing browser identity")
    user_id = _user_id(request)
    privacy = "private" if user_id else "public"

    with get_db() as conn:
        row = conn.execute(
            f"""
            INSERT INTO groups (privacy, creator_user_id)
            VALUES (%(privacy)s, %(creator_user_id)s)
            RETURNING {_GROUP_SUMMARY_COLUMNS}
            """,
            {"privacy": privacy, "creator_user_id": user_id},
        ).fetchone()
        # Bypass the helper's private-skip — creators are always members.
        grant_group_membership_inline(
            conn, str(row["id"]), browser_id, privacy="public"
        )
        return _row_to_group_summary(row)


@router.get(
    "/by-route-id/{route_id}/summary",
    response_model=GroupSummary,
)
def get_group_summary(route_id: str, request: Request):
    """Group metadata for the group page header when
    `/by-route-id/{route_id}` returned no visible polls (or for any
    direct-URL load that needs the chrome before the polls list lands).

    Phase E: gated by membership for private groups. Non-members hitting
    a private group's URL get 404 here too — surfacing the group's title
    + avatar to strangers would leak a private group's existence and
    name. Public groups remain identity-free (no membership write, no
    visibility check) so crawlers and direct-URL loads keep working.

    Returns 404 on route resolution failure regardless of privacy.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        meta = get_group_metadata(conn, group_id)
        if meta and meta["privacy"] == "private":
            if not is_caller_member_of_group(
                conn, group_id, browser_id=browser_id, user_id=user_id
            ):
                raise HTTPException(status_code=404, detail="Group not found")
        # `has_polls` (visibility-blind) lets the FE tell "all my history is
        # hidden pre-join" apart from "brand-new empty group" — folded into
        # the one SELECT so the summary stays a single round-trip. See
        # GroupSummary.has_polls.
        row = conn.execute(
            f"""SELECT {_GROUP_SUMMARY_COLUMNS},
                       EXISTS (SELECT 1 FROM polls WHERE group_id = g.id) AS has_polls
                  FROM groups g WHERE g.id = %(id)s""",
            {"id": group_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
        return _row_to_group_summary(row, has_polls=row["has_polls"])


@router.get("/by-route-id/{route_id}", response_model=list[PollResponse])
def get_group_by_route_id(
    route_id: str,
    request: Request,
    include_results: bool = True,
):
    """Return every visible poll in one group, resolved by route id.

    See the visibility rule documented in `services/groups.py`. The
    caller is auto-joined to the resolved group inline (idempotent via
    ON CONFLICT) — sharing a group link is the canonical "invite
    someone" mechanism. The closed-before-join filter still applies, so
    a brand-new member sees open polls plus polls closed after
    `joined_at`. A linked poll closed before the visitor joined is
    silently absent (per the user spec: "just show the group and don't
    try to show the old poll").

    `route_id` accepts `groups.short_id`, `groups.id`,
    `polls.short_id`, or `polls.id`.

    Returns 404 only when route resolution itself fails. An empty
    visible-polls list returns 200 with `[]` so the group page can
    still render its chrome (header + Share + Create Poll).
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)

    with get_db() as conn:
        group_id = resolve_group_for_visit(
            conn, route_id, browser_id=browser_id, user_id=user_id
        )
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")

        visibility = load_user_visibility(conn, browser_id, user_id=user_id)
        group_pids = poll_ids_for_group_ids(conn, [group_id])
        visible_pids = filter_visible_polls(conn, group_pids, visibility)
        viewer_user_id = resolve_actor_user_id(
            conn, user_id=user_id, browser_id=browser_id
        )
        return polls_for_poll_ids(
            conn, visible_pids, include_results=include_results,
            viewer_user_id=viewer_user_id, viewer_browser_id=browser_id,
        )


@router.get(
    "/by-route-id/{route_id}/poll/{poll_ref}",
    response_model=GroupPollResponse,
)
def get_group_poll(route_id: str, poll_ref: str, request: Request):
    """Visibility-aware fetch of one poll within a group — the direct
    poll-link landing path (`/g/<group>/p/<poll>`).

    Unlike the visibility-blind `GET /api/polls/{short_id}`, this enforces
    the group visibility rule (documented in `services/groups.py`) so a
    late joiner who taps a link to a poll that closed BEFORE they joined
    the group gets a `hidden_pre_join` marker — existence + closure timing
    only, never the poll's contents — instead of either the leaked
    contents or a misleading "not found". The visibility rule stands.

    Auto-join semantics match the group read: landing on a public group's
    poll link joins the caller (so the closed-before-join watermark is
    "now"); private groups 404 non-members at the boundary.

    `poll_ref` is resolved against THIS group as a `polls.short_id` or a
    `polls.id` uuid — a poll id from a different group does not resolve
    here (404)."""
    browser_id = _browser_id(request)
    user_id = _user_id(request)

    with get_db() as conn:
        group_id = resolve_group_for_visit(
            conn, route_id, browser_id=browser_id, user_id=user_id
        )
        if not group_id:
            raise HTTPException(status_code=404, detail="Poll not found")

        # Resolve the poll WITHIN this group (short_id, then uuid). Scoping
        # to group_id keeps a cross-group poll id from resolving here.
        poll_row = conn.execute(
            "SELECT id, updated_at FROM polls "
            "WHERE group_id = %(gid)s::uuid AND short_id = %(ref)s",
            {"gid": group_id, "ref": poll_ref},
        ).fetchone()
        if not poll_row and _is_uuid_like(poll_ref):
            poll_row = conn.execute(
                "SELECT id, updated_at FROM polls "
                "WHERE group_id = %(gid)s::uuid AND id = %(ref)s::uuid",
                {"gid": group_id, "ref": poll_ref},
            ).fetchone()
        if not poll_row:
            raise HTTPException(status_code=404, detail="Poll not found")

        poll_id = str(poll_row["id"])
        visibility = load_user_visibility(conn, browser_id, user_id=user_id)
        visible = filter_visible_polls(conn, [poll_id], visibility)
        if visible:
            viewer_user_id = resolve_actor_user_id(
                conn, user_id=user_id, browser_id=browser_id
            )
            polls = polls_for_poll_ids(
                conn, visible, include_results=True,
                viewer_user_id=viewer_user_id,
            )
            return GroupPollResponse(
                status="visible", poll=polls[0] if polls else None,
            )

        # The caller is a member of this group (auto-joined above for
        # public, confirmed for private), so the ONLY way the poll filtered
        # out is the closed-before-join watermark. Return existence +
        # closure timing; never the contents.
        closed_at = poll_row.get("updated_at")
        return GroupPollResponse(
            status="hidden_pre_join",
            poll=None,
            closed_at=closed_at.isoformat() if closed_at else None,
        )


@router.get(
    "/by-route-id/{route_id}/preview",
    response_model=GroupPreviewResponse,
)
def get_group_preview(route_id: str, p: str | None = None):
    """Public link-preview metadata for Open Graph / Twitter Card crawlers.

    Visibility-free + no membership writes: crawlers (Slack, iMessage,
    Twitter, etc.) hit URLs without any browser identity, and gating
    them on visibility would 404 every share. Returning only title +
    description (no votes, no question contents) keeps this safe.

    Title mirrors the in-app `_compute_display_title` (questions[0].title
    when set — preserves user-typed yes_no prompts and the wrapper title
    stamped at create time for any other category — falling back to the
    auto-generated title from categories/contexts). The `group_title`
    override is deliberately bypassed so a custom group name (often a
    participant-name string like "Alice, Bob") doesn't replace the
    poll's actual subject.

    Description: comma-joined options across the poll's questions; else
    the `details` (Notes) field; else null. Capped at 200 chars.
    """
    # Local imports: routers/polls.py imports services/groups, so an
    # eager import would cycle.
    from algorithms.poll_title import generate_poll_title
    from routers.polls import _category_for_title

    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")

        target = None
        if p:
            target = conn.execute(
                """SELECT id, context, details FROM polls
                    WHERE short_id = %(s)s AND group_id = %(t)s::uuid""",
                {"s": p, "t": group_id},
            ).fetchone()

        if target is None:
            target = conn.execute(
                """SELECT id, context, details FROM polls
                    WHERE group_id = %(t)s::uuid
                    ORDER BY created_at DESC
                    LIMIT 1""",
                {"t": group_id},
            ).fetchone()

        # Empty group (no polls yet): return a minimal preview using the
        # group's `title` override (or a default) instead of 404'ing. The
        # GroupNotFound page uses this endpoint to distinguish "group is
        # private + you don't have access" from "group genuinely doesn't
        # exist" — 404'ing here would mis-classify any private empty group
        # as missing, leaving the user with the "may not exist" copy on a
        # group that actually does. Unlike the populated case, the
        # `groups.title` override IS used here (no poll subject to defer
        # to), falling back to "WhoeverWants" so crawlers always have
        # something renderable.
        if target is None:
            group_row = conn.execute(
                "SELECT title FROM groups WHERE id = %(gid)s::uuid",
                {"gid": group_id},
            ).fetchone()
            override = (
                (group_row.get("title") or "").strip() if group_row else ""
            )
            return GroupPreviewResponse(
                title=override or "WhoeverWants",
                description=None,
            )

        question_rows = conn.execute(
            """SELECT title, category, question_type, details, options
                 FROM questions
                WHERE poll_id = %(pid)s
                ORDER BY question_index NULLS LAST, created_at""",
            {"pid": str(target["id"])},
        ).fetchall()

        primary_title = ""
        if question_rows:
            primary_title = (question_rows[0].get("title") or "").strip()

        if primary_title:
            title = primary_title
        else:
            categories = [_category_for_title(dict(q)) for q in question_rows]
            contexts = [q.get("details") for q in question_rows]
            title = (
                generate_poll_title(categories, target.get("context"), contexts)
                or "WhoeverWants"
            )

        option_strs: list[str] = []
        seen: set[str] = set()
        for q in question_rows:
            for opt in q.get("options") or []:
                stripped = (opt or "").strip()
                if stripped and stripped not in seen:
                    seen.add(stripped)
                    option_strs.append(stripped)

        if option_strs:
            description = ", ".join(option_strs)
        else:
            description = (target.get("details") or "").strip() or None

        if description and len(description) > 200:
            description = description[:197].rstrip() + "…"

        return GroupPreviewResponse(title=title, description=description)


@router.post("/{route_id}/title", response_model=GroupTitleResponse)
def update_group_title(route_id: str, req: UpdateGroupTitleRequest):
    """Set or clear a group's title override.

    Migration 105 moved the override from `polls.group_title` (per-poll)
    to `groups.title` (one row per group). Anyone with the URL can
    rename the group — there's no creator-secret check today, matching
    the prior `/api/polls/<id>/group-title` semantics.

    Empty / whitespace-only `group_title` clears the override (NULL).

    `route_id` accepts the same four forms as `/by-route-id/{route_id}`:
    `groups.short_id`, `groups.id`, `polls.short_id`, `polls.id`.
    """
    normalized = (req.group_title or "").strip()
    value: str | None = normalized if normalized else None
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        row = conn.execute(
            """
            UPDATE groups
               SET title = %(title)s
             WHERE id = %(id)s
            RETURNING id, short_id, title
            """,
            {"id": group_id, "title": value},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
    return GroupTitleResponse(
        group_id=str(row["id"]),
        group_short_id=row.get("short_id"),
        title=row.get("title"),
    )


@router.post("/{route_id}/image", response_model=GroupImageResponse)
def upload_group_image(route_id: str, req: GroupImageRequest):
    """Set the group's avatar image (migration 108).

    Body: base64-encoded JPEG or PNG bytes (already square-cropped by the
    FE — the server does NOT crop or resize). Replaces any previous image
    on the group. Stamps `image_updated_at` so the FE knows to invalidate
    its `/api/groups/by-route-id/<id>/image?v=<ts>` cache.

    Anyone with the URL can change the group's image — same trust model
    as `POST /api/groups/{route_id}/title`. No creator-secret check today.

    `route_id` accepts the same four forms as `/by-route-id/{route_id}`:
    `groups.short_id`, `groups.id`, `polls.short_id`, `polls.id`.
    """
    if req.mime_type not in _ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Image mime_type must be image/jpeg or image/png",
        )
    try:
        image_bytes = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid base64 image data: {exc}"
        ) from exc
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image is empty")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds {MAX_IMAGE_BYTES} bytes",
        )
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        row = conn.execute(
            """
            UPDATE groups
               SET image_data = %(data)s,
                   image_mime_type = %(mime)s,
                   image_updated_at = NOW()
             WHERE id = %(id)s
            RETURNING id, short_id, image_updated_at
            """,
            {"id": group_id, "data": image_bytes, "mime": req.mime_type},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
    image_updated_at = row.get("image_updated_at")
    return GroupImageResponse(
        group_id=str(row["id"]),
        group_short_id=row.get("short_id"),
        image_updated_at=image_updated_at.isoformat() if image_updated_at else None,
    )


@router.delete("/{route_id}/image", response_model=GroupImageResponse)
def delete_group_image(route_id: str):
    """Clear the group's avatar image. Idempotent — a 200 is returned
    even if no image was set, so the FE doesn't have to distinguish
    "was set" from "wasn't set" to reset state. `image_updated_at` is
    set to NULL so the FE falls back to the initials avatar."""
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        row = conn.execute(
            """
            UPDATE groups
               SET image_data = NULL,
                   image_mime_type = NULL,
                   image_updated_at = NULL
             WHERE id = %(id)s
            RETURNING id, short_id, image_updated_at
            """,
            {"id": group_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
    return GroupImageResponse(
        group_id=str(row["id"]),
        group_short_id=row.get("short_id"),
        image_updated_at=None,
    )


@router.get("/by-route-id/{route_id}/image")
def get_group_image(route_id: str):
    """Serve the group's avatar image bytes with the stored MIME type.

    PUBLIC for both public AND private groups — no membership /
    browser-id check. This is required, not just convenient: the avatar
    is rendered with a plain `<img src>` tag, which CANNOT send the
    `X-Browser-Id` / `Authorization: Bearer` headers the membership
    check reads. Gating private groups by membership here therefore
    404'd the avatar for EVERY member (the creator included) — the
    `<img>` request always arrives header-less, so the middleware mints
    a fresh non-member browser_id and the gate fails. The result was the
    reported "set a group image, it shows as a question mark" bug.

    The unguessable route_id (short_id / uuid) in the path IS the
    capability token — exactly the model the user-profile image uses
    (`by-user-id/<user_id>/image`, public because `<img>` can't carry
    the bearer). It's consistent with the rest of this group's trust
    model: `POST /image` and `POST /title` are already unauthenticated
    ("anyone with the URL can change it"), and `/preview` already
    exposes the group's title to anyone with the URL. The avatar is the
    narrowest, least-sensitive surface of all — keeping it loadable for
    members necessarily means keeping it loadable for anyone with the
    link, since `<img>` can't distinguish the two.

    Cached via the FE's `?v=<image_updated_at>` query string; the
    response sets `Cache-Control: public, max-age=31536000, immutable`
    so a given URL never re-fetches once received (the next change bumps
    the timestamp, producing a new URL).

    Returns 404 when no image is set (FE renders fallback initials).
    """
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        row = conn.execute(
            "SELECT image_data, image_mime_type FROM groups WHERE id = %(id)s",
            {"id": group_id},
        ).fetchone()
        if not row or not row.get("image_data"):
            raise HTTPException(status_code=404, detail="Image not set")
        return Response(
            content=bytes(row["image_data"]),
            media_type=row.get("image_mime_type") or "application/octet-stream",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )


@router.post(
    "/{route_id}/privacy",
    response_model=UpdateGroupPrivacyResponse,
)
def update_group_privacy(
    route_id: str, req: UpdateGroupPrivacyRequest, request: Request
):
    """Phase E: flip a group between 'public' and 'private'.

    Authorization: must be signed in AND match the group's
    `creator_user_id`. Groups created anonymously (creator_user_id NULL)
    and grandfathered pre-Phase-E groups can NOT be flipped — they stay
    public forever. Phase I will add an "anonymous → claim → private"
    upgrade path; deferred until then.

    Without this endpoint, signed-in users who create a group get a
    private group with no way to share it (Phase F/G aren't shipped
    yet). The toggle is the escape hatch: flip to public until invites
    land, then optionally flip back to private once the group is
    bootstrapped.
    """
    if req.privacy not in ("public", "private"):
        raise HTTPException(
            status_code=400,
            detail="privacy must be 'public' or 'private'",
        )
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Sign in to change group privacy",
        )
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        meta = get_group_metadata(conn, group_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Group not found")
        # Anonymous-created or pre-Phase-E groups can't be re-keyed by
        # any signed-in caller: there's no creator to authorize against.
        # Returning 403 distinguishes "not your group" from "no such
        # group" (404).
        if not meta["creator_user_id"]:
            raise HTTPException(
                status_code=403,
                detail="Group has no recorded creator; cannot change privacy",
            )
        if meta["creator_user_id"] != user_id:
            raise HTTPException(
                status_code=403,
                detail="Only the group's creator can change privacy",
            )
        row = conn.execute(
            """
            UPDATE groups
               SET privacy = %(privacy)s
             WHERE id = %(id)s
            RETURNING id, short_id, privacy, creator_user_id
            """,
            {"id": group_id, "privacy": req.privacy},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
    creator_user_id = row.get("creator_user_id")
    return UpdateGroupPrivacyResponse(
        group_id=str(row["id"]),
        group_short_id=row.get("short_id"),
        privacy=row["privacy"],
        creator_user_id=str(creator_user_id) if creator_user_id else None,
    )


@router.post("/{route_id}/claim", response_model=ClaimGroupResponse)
def claim_group_endpoint(route_id: str, request: Request):
    """Phase I: signed-in member takes over as the recorded creator of a
    group whose `creator_user_id` is NULL — i.e. anonymous-created or
    grandfathered (pre-Phase-E) groups.

    Why this exists: privacy / join-request / invite-link endpoints all
    authorize against `groups.creator_user_id`. Groups without one are
    stranded — no one can flip privacy or manage invites. Claiming
    unlocks all of those for the new creator.

    Authorization (defense in depth):
      * 401 if not signed in (only accounts can be creators).
      * 404 if the route doesn't resolve.
      * 403 if the caller isn't a member of the group (any browser
        linked to their user_id counts). Restricts claiming to people
        with a demonstrated connection to the group — visiting the
        URL once is enough to qualify (auto-join writes a member row
        on public groups), so this is intentionally a low bar.
      * 409 if the group already has a creator_user_id. First-mover
        wins via the atomic UPDATE WHERE creator_user_id IS NULL in
        `claim_group`. A creator can't re-claim (the row is no longer
        NULL); transferring creator_user_id is out of scope.

    There is no "proof of original creation" check — `creator_secret`
    was retired in migration 123 and pre-Phase-E groups never carried
    one anyway. Membership is the only available signal.
    """
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in to claim this group"
        )
    browser_id = _browser_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        if not is_caller_member_of_group(
            conn, group_id, browser_id=browser_id, user_id=user_id
        ):
            raise HTTPException(
                status_code=403, detail="Join the group to claim it"
            )
        # Single atomic UPDATE ... RETURNING — the WHERE creator_user_id IS NULL
        # clause serializes concurrent claims at row-lock granularity. None on
        # return means either (a) already claimed (the common case) or (b) the
        # group was deleted mid-flight (no group-delete endpoint exists today,
        # so this is essentially unreachable). Both surface as 409.
        row = _claim_group_row(conn, group_id, user_id)
        if row is None:
            raise HTTPException(
                status_code=409, detail="Group already has a creator"
            )
    return ClaimGroupResponse(
        group_id=str(row["id"]),
        group_short_id=row.get("short_id"),
        privacy=row["privacy"],
        creator_user_id=str(row["creator_user_id"]),
    )


@router.delete("/{route_id}/membership", status_code=204)
def leave_group(route_id: str, request: Request):
    """Explicit "leave group" action — remove the caller's
    `group_members` row for the resolved group.

    Idempotent: returns 204 whether or not a row existed. Strangers
    (no membership row) get 204 too, since the operation is "ensure no
    membership exists" and that's already true.

    `route_id` accepts the same four forms as `/by-route-id/{route_id}`:
    groups.short_id, groups.id, polls.short_id, polls.id. Resolution
    fails (404) when none of those produce a group — distinguishing
    "group doesn't exist" from "no membership to remove".

    Migration 106 retired per-poll access; group membership is the only
    access mechanism. Re-visiting any group URL after leave will write
    a fresh group_members row (with a new joined_at watermark), so
    "leave" is durable only against the user not navigating back.

    No-op when `browser_id` is missing (no middleware id, no row to
    remove). Returns 204 either way.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        _leave_group_row(conn, group_id, browser_id, user_id=user_id)


# ---------------------------------------------------------------------------
# Phase F: join requests
# ---------------------------------------------------------------------------
#
# Signed-in non-members of a private group can request access. The creator
# (`groups.creator_user_id`) approves or denies. On approve, the requester
# gets a `group_members` row keyed on one of their linked browsers — and
# `load_user_visibility`'s user_browsers walk makes the group visible on
# every device they're signed in on.
#
# Anonymous browsers can't request (no durable identity to approve).
#
# Existence-leak surface: a signed-in non-member POSTing /join-requests
# learns whether the route resolves (201 vs 404). That's the same leak
# the existing /by-route-id surfaces (which 404s strangers on private
# groups today), so no new channel.


class JoinRequestCreate(BaseModel):
    """Body for `POST /api/groups/{route_id}/join-requests`. `message`
    is optional — the requester can include a brief "hi, it's Alice
    from work" so the creator has context. Empty / whitespace-only
    becomes NULL."""

    message: str | None = None


class JoinRequestSummaryResponse(BaseModel):
    """Per-request shape returned to the creator (list endpoint) and
    echoed by the create endpoint. `requester_email` is NULL for
    passkey-only users (Phase D registration permits no-email accounts)
    — the FE renders a "Passkey user" fallback. `requester_name` is the
    requester's account display_name; `requester_image_updated_at` is the
    profile-photo cache-buster (NULL when no photo) the FE feeds into the
    public `/by-user-id/<id>/image?v=<ts>` URL."""

    id: str
    group_id: str
    requester_user_id: str
    requester_email: str | None
    requester_name: str | None
    requester_image_updated_at: str | None
    message: str | None
    requested_at: str


class JoinRequestCreateResponse(BaseModel):
    """`status` walks 'pending' (newly created) | 'already_pending'
    (re-request while one's still open) | 'already_member' (signed-in
    creator or member POSTed, so no row was inserted). The FE collapses
    'pending' and 'already_pending' into "request sent" — the distinction
    is preserved here for observability."""

    status: str  # 'pending' | 'already_pending' | 'already_member'
    request: JoinRequestSummaryResponse | None = None


class JoinRequestDecideBody(BaseModel):
    """`action` is 'approve' or 'deny'. The route's `decided_at` is set
    server-side; the creator can't backdate."""

    action: str  # 'approve' | 'deny'


class JoinRequestDecideResponse(BaseModel):
    request_id: str
    status: str  # 'approved' | 'denied'


def _summary_to_response(s, fallback_email: str | None = None) -> JoinRequestSummaryResponse:
    return JoinRequestSummaryResponse(
        id=s.id,
        group_id=s.group_id,
        requester_user_id=s.requester_user_id,
        requester_email=s.requester_email if s.requester_email is not None else fallback_email,
        requester_name=s.requester_name,
        requester_image_updated_at=(
            s.requester_image_updated_at.isoformat()
            if s.requester_image_updated_at
            else None
        ),
        message=s.message,
        requested_at=s.requested_at.isoformat() if s.requested_at else "",
    )


def _build_group_push_context(conn, group_id: str) -> tuple[str, str, str | None]:
    """Single source for the (route_for_url, group_phrase, group_short_id)
    triple every group-scoped push fan-out needs. `route_for_url` is the
    short_id when present else the UUID; `group_phrase` is the display
    name resolved via `group_name_phrase` (honoring the title override).

    Extracted from the three sites that previously inlined this lookup
    (create_join_request, decide_group_join_request, add_group_members) —
    extending it once (e.g. to add a new groups-table field to every push
    payload) now reaches every caller.
    """
    group_row = conn.execute(
        "SELECT short_id, title FROM groups WHERE id = %(g)s::uuid",
        {"g": group_id},
    ).fetchone()
    group_short_id = group_row.get("short_id") if group_row else None
    group_phrase = group_name_phrase(
        conn,
        group_id,
        override=group_row.get("title") if group_row else None,
    )
    route_for_url = group_short_id or group_id
    return route_for_url, group_phrase, group_short_id


@router.post(
    "/{route_id}/join-requests",
    response_model=JoinRequestCreateResponse,
)
def create_group_join_request(
    route_id: str,
    body: JoinRequestCreate,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Phase F: signed-in non-member requests access to a (typically
    private) group. Returns:

      * 401 — not signed in. Anonymous browsers can't request because
        there's no durable identity to approve.
      * 404 — route doesn't resolve to any group.
      * 200 + status='already_member' — caller is already a member or
        the group's recorded creator. No row written, no push fired.
      * 201 + status='pending' — fresh request inserted.
      * 200 + status='already_pending' — an open request already
        existed; the row is returned but no second push fires.

    Push notification to the creator (when `creator_user_id` is
    recorded) is dispatched via BackgroundTasks AFTER the response is
    serialized, mirroring the new-poll fan-out pattern. Anonymous-
    created / pre-Phase-E groups have no recorded creator and no push
    is fired — the request still records, so a future "claim group"
    Phase I action can surface the backlog.
    """
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in to request access"
        )

    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")

        # Already-member / creator short-circuit. We return 200 (not 201)
        # so the FE can show "you're already in this group" instead of
        # "request sent". The row in group_members might be keyed on a
        # different browser_id than the current one — that's fine, the
        # user_browsers walk makes it visible on this device too.
        if is_member_or_creator(conn, group_id, user_id):
            return JoinRequestCreateResponse(
                status="already_member", request=None
            )

        # Name gate: the creator needs SOMETHING to recognize the requester
        # by ("Approve / deny request from <who>?"). `requester_email` is
        # null for passkey-only accounts and the UI's "Passkey user"
        # placeholder reads as anonymous to creators — a display name closes
        # that gap. Validated here as the backstop; the FE's
        # AccountGateModal is the primary gate at the click. Runs AFTER
        # the member check so a nameless existing-member tapping retry
        # gets the friendly already_member response, not 400.
        name_row = conn.execute(
            "SELECT display_name FROM users WHERE id = %(u)s::uuid",
            {"u": user_id},
        ).fetchone()
        validate_user_name(
            name_row["display_name"] if name_row else None,
            field="name",
        )

        # Snapshot existence BEFORE the create so we know whether this
        # call inserted a new row or returned an existing pending one.
        # The partial-unique-index conflict path makes create_join_request
        # idempotent; the SELECT distinguishes the two cases for the
        # response status + the push-fire decision.
        existing = conn.execute(
            """
            SELECT 1 FROM group_join_requests
             WHERE group_id = %(g)s::uuid
               AND requester_user_id = %(u)s::uuid
               AND status = 'pending'
             LIMIT 1
            """,
            {"g": group_id, "u": user_id},
        ).fetchone()
        is_new = existing is None

        summary = create_join_request(conn, group_id, user_id, body.message)

        # Fetch the requester's email for the response shape (the helper
        # doesn't join — it's used for both create and list, but only
        # list joins on user_identities). Inline lookup is cheaper than
        # adding another helper.
        email_row = conn.execute(
            """
            SELECT email FROM user_identities
             WHERE user_id = %(u)s::uuid AND email IS NOT NULL
             ORDER BY created_at DESC LIMIT 1
            """,
            {"u": user_id},
        ).fetchone()
        requester_email = email_row["email"] if email_row else None

        # Read the creator for the push fan-out. Anonymous-created
        # groups have NULL creator_user_id; skip the push in that case.
        meta = get_group_metadata(conn, group_id)
        creator_user_id = meta["creator_user_id"] if meta else None
        route_for_url, group_phrase, _ = _build_group_push_context(conn, group_id)

    # Fire-and-forget push fan-out. Runs only on a brand-new request;
    # a repeat-ping for an already-pending request would just noise the
    # creator on every "polite re-request" tap.
    if is_new and creator_user_id:
        # Line 1 names the event + group ("Join request for <Group>"); line 2
        # is who's asking. Body stays generic for passkey-only requesters
        # (no email) so they don't surface as a literal "null wants to join".
        # The /info page has full details once the creator taps in.
        body_text = (
            f"{requester_email} wants to join"
            if requester_email
            else "Someone wants to join"
        )
        background_tasks.add_task(
            fan_out_join_request,
            group_id,
            creator_user_id,
            {
                "title": f"Join request for {group_phrase}",
                "body": body_text,
                "url": f"/g/{route_for_url}/info",
                # `group_id` is the route_for_url (short_id form) — used by
                # FE listeners that build URLs. `group_uuid` is the canonical
                # UUID — used by listeners that resolve a viewer's routeId
                # (which may be EITHER short_id or UUID depending on URL form)
                # to match against the push.
                "group_id": route_for_url,
                "group_uuid": group_id,
                "tag": f"join-request-{summary.id}",
            },
        )

    return JoinRequestCreateResponse(
        status="pending" if is_new else "already_pending",
        request=_summary_to_response(summary, fallback_email=requester_email),
    )


@router.get(
    "/{route_id}/join-requests",
    response_model=list[JoinRequestSummaryResponse],
)
def list_group_join_requests(route_id: str, request: Request):
    """Phase F: list pending requests for a group. Creator-only.

    Authorization: must be signed in AND match the group's recorded
    `creator_user_id`. Anonymous-created / pre-Phase-E groups have
    NULL creator and can't have a creator viewer either, so they 403
    here for everyone — the join-request system simply isn't available
    on those groups.

    404 on route resolution failure; 401 when not signed in; 403 when
    signed in but not the creator (distinguishes "not your group" from
    "no such group" — same convention as the privacy toggle).
    """
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in to view join requests"
        )
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        meta = get_group_metadata(conn, group_id)
        if not meta or not meta["creator_user_id"]:
            raise HTTPException(
                status_code=403,
                detail="Group has no recorded creator",
            )
        if meta["creator_user_id"] != user_id:
            raise HTTPException(
                status_code=403,
                detail="Only the group's creator can view join requests",
            )
        summaries = list_pending_requests(conn, group_id)
    return [_summary_to_response(s) for s in summaries]


@router.post(
    "/{route_id}/join-requests/{request_id}/decide",
    response_model=JoinRequestDecideResponse,
)
def decide_group_join_request(
    route_id: str,
    request_id: str,
    body: JoinRequestDecideBody,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Phase F: creator approves or denies a pending request.

    On approve: writes a `group_members` row for the requester's
    earliest-linked browser_id (per `user_browsers`). The walk in
    `load_user_visibility` expands that to every device the requester
    is signed in on, so they see the group immediately on the next
    refresh — no per-device approval needed. Also fires a
    `fan_out_to_user` push so the requester's open client (e.g.
    sitting on the GroupNotFound "Request to join" screen) can
    auto-refresh into the group without a manual reload, AND so
    devices that aren't open get a banner they can tap to navigate in.

    On deny: the row's status walks to 'denied'. The requester gets no
    notification (per `docs/auth-access-model.md`: "Requester gets no
    notification on deny — avoids 'why rejected' follow-ups"). They
    can re-request, since the partial unique index only blocks
    pending duplicates.

    Idempotent: a second decide on the same request returns 404 (the
    row's no longer pending). Distinguishing 'already_decided' from
    'never_existed' isn't worth a separate status code — both states
    have the same "do nothing else" implication for the caller.
    """
    if body.action not in ("approve", "deny"):
        raise HTTPException(
            status_code=400, detail="action must be 'approve' or 'deny'"
        )
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in to decide join requests"
        )
    decision = "approved" if body.action == "approve" else "denied"
    notify_payload: dict | None = None
    notify_user_id: str | None = None
    notify_group_id: str | None = None
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        meta = get_group_metadata(conn, group_id)
        if not meta or not meta["creator_user_id"]:
            raise HTTPException(
                status_code=403, detail="Group has no recorded creator"
            )
        if meta["creator_user_id"] != user_id:
            raise HTTPException(
                status_code=403,
                detail="Only the group's creator can decide join requests",
            )
        # Existence + group-scoping guard: the route-id MUST match the
        # request's group_id. Without this, a creator of group A could
        # decide on a request that belongs to group B by guessing
        # request_ids (the join-request table is indexed but not
        # secret). Tying decision authority to (group_id, request_id)
        # together closes the cross-group manipulation channel.
        ownership = conn.execute(
            """
            SELECT 1 FROM group_join_requests
             WHERE id = %(r)s::uuid
               AND group_id = %(g)s::uuid
               AND status = 'pending'
             LIMIT 1
            """,
            {"r": request_id, "g": group_id},
        ).fetchone()
        if not ownership:
            raise HTTPException(
                status_code=404,
                detail="Request not found or already decided",
            )
        decided = decide_request(conn, request_id, decision, user_id)
        if decided and decision == "approved":
            # Build the approval-push payload while we still hold the
            # connection; same shape as the invite-members fan-out so
            # client-side handling can be uniform on `member-added-*`
            # tags. `group_uuid` rides alongside `group_id` so listeners
            # whose viewer routeId is the UUID form (legacy URL share)
            # can still match — see lib/swMessages.ts.
            route_for_url, group_phrase, _ = _build_group_push_context(
                conn, group_id
            )
            notify_payload = {
                "title": f"Added to {group_phrase}",
                "body": "Your request to join was approved",
                "url": f"/g/{route_for_url}",
                "group_id": route_for_url,
                "group_uuid": group_id,
                "tag": f"member-added-{group_id}",
            }
            notify_user_id = decided.requester_user_id
            notify_group_id = group_id
    if not decided:
        # decide_request returns None only on race (a second click
        # flipped the row between our SELECT and UPDATE). Treat the
        # same as "already decided".
        raise HTTPException(
            status_code=404,
            detail="Request not found or already decided",
        )
    if notify_payload and notify_user_id and notify_group_id:
        background_tasks.add_task(
            fan_out_to_user,
            notify_group_id,
            notify_user_id,
            notify_payload,
        )
    return JoinRequestDecideResponse(
        request_id=decided.request_id,
        status=decided.status,
    )


# ---------------------------------------------------------------------------
# Invite members directly (in-app "address book")
# ---------------------------------------------------------------------------
#
# A member of a group can add accounts they've encountered (shared a group
# with) straight into the group — no link to share, no approval round-trip.
# The added account gets a push notification. Complements Phase F (joiner
# pulls) and Phase G (creator mints a link): this is "member pushes a known
# account in directly".
#
# Authorization is MEMBERSHIP, not creator-only — consistent with the
# existing trust model where any member can already invite anyone by sharing
# the group URL (visiting it grants membership). The candidate set is the
# caller's own contacts (`services/contacts.py`), and the add endpoint only
# accepts user_ids already in that address book, so a member can't add an
# arbitrary stranger by guessing user_ids.


class InvitableAccountResponse(BaseModel):
    """One row of the invite-members candidate list. `shared_group_count`
    is the number of OTHER groups the caller currently shares with this
    account (primary sort key, desc); `last_seen_at` is the persisted
    recency watermark (secondary sort key for accounts with 0 current
    shared groups). `name` is the account's display_name (may be null)."""

    user_id: str
    name: str | None
    shared_group_count: int
    last_seen_at: str


class AddMembersRequest(BaseModel):
    user_ids: list[str] = Field(default_factory=list)


class AddMembersResponse(BaseModel):
    added: int


@router.get(
    "/{route_id}/invitable-accounts",
    response_model=list[InvitableAccountResponse],
)
def list_group_invitable_accounts(route_id: str, request: Request):
    """Accounts the caller can add to this group: people they've encountered
    (the `user_contacts` address book) who aren't already members here.

    Authorization: caller must be a member of the group (any member can
    invite). 404 on unresolvable route; 403 when the caller isn't a member.
    An account-less caller (no resolvable user_id — e.g. a pure lurker who
    never created or voted) has no contacts, so this returns an empty list
    rather than erroring.

    Reconciles the caller's contacts inline first so the list reflects
    everyone they currently share a group with, even on the first open after
    this feature shipped. Sorted: most shared groups first, then most
    recently seen together.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        if not is_caller_member_of_group(
            conn, group_id, browser_id=browser_id, user_id=user_id
        ):
            raise HTTPException(
                status_code=403, detail="Join the group to invite people"
            )
        me = resolve_actor_user_id(conn, user_id=user_id, browser_id=browser_id)
        if not me:
            return []
        reconcile_contacts(conn, me)
        accounts = list_invitable_accounts(conn, me, group_id)
    return [
        InvitableAccountResponse(
            user_id=a.user_id,
            name=a.name,
            shared_group_count=a.shared_group_count,
            last_seen_at=a.last_seen_at.isoformat() if a.last_seen_at else "",
        )
        for a in accounts
    ]


@router.post("/{route_id}/members", response_model=AddMembersResponse)
def add_group_members(
    route_id: str,
    body: AddMembersRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Add one or more accounts to a group. Any member can invite.

    Each requested user_id must be one of the caller's contacts (in the
    `user_contacts` address book) — non-contacts are silently skipped so a
    member can't add an arbitrary stranger by guessing ids. Accounts already
    in the group (via any of their browsers) are skipped too (no duplicate
    membership, no notification). Each newly-added account gets an 'added to
    a group' push.

    401/403/404 mirror the candidates endpoint. Returns the count of accounts
    actually added.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        if not is_caller_member_of_group(
            conn, group_id, browser_id=browser_id, user_id=user_id
        ):
            raise HTTPException(
                status_code=403, detail="Join the group to invite people"
            )
        me = resolve_actor_user_id(conn, user_id=user_id, browser_id=browser_id)
        if not me:
            raise HTTPException(
                status_code=403,
                detail="Create or join a poll first so we can invite from your account",
            )

        added_user_ids: list[str] = []
        # dict.fromkeys dedupes while preserving order. Skip the caller, any
        # malformed (non-uuid) id, and any id that isn't in the caller's
        # contacts — only people they've actually encountered are addable.
        for uid in dict.fromkeys(body.user_ids):
            if uid == me or not _is_uuid_like(uid):
                continue
            if not is_contact(conn, me, uid):
                continue
            if add_member_for_user(conn, group_id, uid):
                added_user_ids.append(uid)

        # Notification payload bits — read once for the whole batch.
        route_for_url, group_phrase, _ = _build_group_push_context(
            conn, group_id
        )
        inviter_row = conn.execute(
            "SELECT display_name FROM users WHERE id = %(u)s::uuid",
            {"u": me},
        ).fetchone()
        inviter_name = inviter_row.get("display_name") if inviter_row else None

    body_text = (
        f"{inviter_name} added you to the group"
        if inviter_name
        else "You were added to a group"
    )
    for uid in added_user_ids:
        background_tasks.add_task(
            fan_out_to_user,
            group_id,
            uid,
            {
                "title": f"Added to {group_phrase}",
                "body": body_text,
                "url": f"/g/{route_for_url}",
                "group_id": route_for_url,
                "group_uuid": group_id,
                "tag": f"member-added-{group_id}",
            },
        )

    return AddMembersResponse(added=len(added_user_ids))


# ---------------------------------------------------------------------------
# Phase G: invite links
# ---------------------------------------------------------------------------
#
# Creator-owned shareable URLs that grant private-group membership on
# redemption. Complements Phase F join requests: invites are
# creator-initiated (push from creator → joiner); join requests are
# joiner-initiated (pull from joiner → creator approves).
#
# Storage: `services/invites.py` persists sha256(token) only. The raw
# token is returned ONCE at create time and embedded in the shareable
# URL. The redeem endpoint hashes the inbound raw token and matches.
#
# Authorization: create / list / revoke are creator-only (signed-in
# AND `creator_user_id` matches the session). Redeem (in `routers/auth.py`)
# requires signed-in but ANY user can redeem.


class CreateInviteRequest(BaseModel):
    """Body for `POST /api/groups/{route_id}/invites`.

    `mode='single'` forces max_uses=1 server-side; `mode='multi'`
    accepts an optional max_uses (NULL = unlimited).

    `target_poll_id` is the optional auto-scroll target: the FE
    redirects to `/g/<group>/p/<poll_short>` instead of `/g/<group>`
    after redemption. Must be a poll in the same group; the server
    silently drops cross-group target_poll_ids (returns NULL).

    `expires_in_hours` is the time-to-live knob. NULL = never expires
    (creator must revoke explicitly).
    """

    mode: str  # 'single' | 'multi'
    max_uses: int | None = None
    target_poll_id: str | None = None
    expires_in_hours: int | None = None


class InviteResponse(BaseModel):
    """Shape returned by create + list. `token` and `url` are populated
    ONLY on create (they're the one-time raw-token reveal); list
    omits them since the creator already received the URL at create
    time."""

    id: str
    group_id: str
    mode: str
    target_poll_id: str | None
    max_uses: int | None
    use_count: int
    expires_at: str | None
    created_at: str
    token: str | None = None
    url: str | None = None


def _summary_to_invite_response(s) -> InviteResponse:
    """List-side conversion. No token/url since list doesn't reveal."""
    return InviteResponse(
        id=s.id,
        group_id=s.group_id,
        mode=s.mode,
        target_poll_id=s.target_poll_id,
        max_uses=s.max_uses,
        use_count=s.use_count,
        expires_at=s.expires_at.isoformat() if s.expires_at else None,
        created_at=s.created_at.isoformat() if s.created_at else "",
    )


def _issued_to_invite_response(
    issued: IssuedInvite, url: str
) -> InviteResponse:
    """Create-side conversion. Carries the raw token + the FE-host-
    derived shareable URL — both surfaced exactly once."""
    return InviteResponse(
        id=issued.id,
        group_id=issued.group_id,
        mode=issued.mode,
        target_poll_id=issued.target_poll_id,
        max_uses=issued.max_uses,
        use_count=issued.use_count,
        expires_at=issued.expires_at.isoformat() if issued.expires_at else None,
        created_at=issued.created_at.isoformat(),
        token=issued.token,
        url=url,
    )


def _require_creator(conn, group_id: str, user_id: str | None) -> None:
    """Raise 401/403 unless the caller is signed in AND matches the
    group's recorded `creator_user_id`. Shared 3-way authorization
    gate for every invite-management endpoint."""
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in to manage invites"
        )
    meta = get_group_metadata(conn, group_id)
    if not meta or not meta["creator_user_id"]:
        raise HTTPException(
            status_code=403, detail="Group has no recorded creator"
        )
    if meta["creator_user_id"] != user_id:
        raise HTTPException(
            status_code=403,
            detail="Only the group's creator can manage invites",
        )


@router.post(
    "/{route_id}/invites",
    response_model=InviteResponse,
    status_code=201,
)
def create_group_invite(
    route_id: str,
    body: CreateInviteRequest,
    request: Request,
):
    """Phase G: mint a new invite link. Creator-only.

    The response is the ONLY time the raw token + URL are returned —
    sha256(token) is what hits the DB. If the creator loses the URL,
    they have to mint a new invite.
    """
    from services.fe_origin import resolve_fe_origin

    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        _require_creator(conn, group_id, user_id)

        if body.mode not in ("single", "multi"):
            raise HTTPException(
                status_code=400, detail="mode must be 'single' or 'multi'"
            )
        if body.max_uses is not None and body.max_uses <= 0:
            raise HTTPException(
                status_code=400, detail="max_uses must be positive"
            )
        if body.expires_in_hours is not None and body.expires_in_hours <= 0:
            raise HTTPException(
                status_code=400, detail="expires_in_hours must be positive"
            )

        # Cross-group target_poll_id silently downgraded to NULL — a
        # 400 would force the FE to handle "stale poll selection" as a
        # distinct error path; falling back to "land on the group
        # root" is more forgiving and matches what target_poll_id
        # being NULL means at redeem time anyway.
        target_poll_id: str | None = None
        if body.target_poll_id:
            poll_row = conn.execute(
                """SELECT id FROM polls
                    WHERE id = %(p)s::uuid AND group_id = %(g)s::uuid""",
                {"p": body.target_poll_id, "g": group_id},
            ).fetchone()
            if poll_row:
                target_poll_id = str(poll_row["id"])

        issued = issue_invite(
            conn,
            group_id=group_id,
            created_by_user_id=user_id,
            mode=body.mode,
            target_poll_id=target_poll_id,
            max_uses=body.max_uses,
            expires_in_hours=body.expires_in_hours,
        )

    # URL build runs OUTSIDE the get_db() block; no DB roundtrip
    # needed. The token is embedded in the path; the FE's
    # `/invite/[token]/page.tsx` resolves on receipt.
    origin = resolve_fe_origin(request)
    url = f"{origin}/invite/{issued.token}"
    return _issued_to_invite_response(issued, url)


@router.get(
    "/{route_id}/invites",
    response_model=list[InviteResponse],
)
def list_group_invites(route_id: str, request: Request):
    """Phase G: list a group's active invites. Creator-only.

    "Active" = not revoked, not expired, has remaining uses. Revoked
    or fully-used invites are excluded — the UI doesn't need them.
    """
    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        _require_creator(conn, group_id, user_id)
        summaries = list_active_invites(conn, group_id)
    return [_summary_to_invite_response(s) for s in summaries]


@router.delete(
    "/{route_id}/invites/{invite_id}",
    status_code=204,
)
def revoke_group_invite(
    route_id: str, invite_id: str, request: Request
):
    """Phase G: revoke an active invite. Creator-only.

    Returns 204 on successful revoke. 404 when the invite doesn't
    exist OR isn't owned by the caller OR was already revoked —
    indistinguishable to the caller, no information leak about
    invites belonging to other creators.
    """
    user_id = _user_id(request)
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        _require_creator(conn, group_id, user_id)
        ok = revoke_invite(conn, invite_id, user_id)
    if not ok:
        raise HTTPException(
            status_code=404, detail="Invite not found or already revoked"
        )
