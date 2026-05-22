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

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from database import get_db
from middleware import (
    browser_id_from_request as _browser_id,
    user_id_from_request as _user_id,
)
from models import PollResponse, UpdateGroupTitleRequest
from services.memberships import leave_group as _leave_group_row
from services.groups import (
    filter_visible_polls,
    get_group_metadata,
    grant_group_membership_inline,
    is_caller_member_of_group,
    load_user_visibility,
    poll_ids_for_group_ids,
    polls_for_poll_ids,
    resolve_group_id_from_route_id,
)


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


class GroupPreviewResponse(BaseModel):
    """Public-readable group metadata for link-preview (Open Graph)
    crawlers. Returns ONLY title + description — no question contents,
    no votes, no creator names, no per-poll details — so it's safe to
    serve without visibility checks. The URL itself is the share token;
    if you can hit this endpoint you've been handed the link."""

    title: str
    description: str | None = None


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

    `accessible_question_ids` is the FE's localStorage list — used as a
    transitional access bridge for users without group_members rows yet
    (pre-B.3 voters, etc.). Treated as group-level access (every poll
    in the resolved group visible, no closed_at filter) to preserve
    Phase B.3 behavior. Also drives the forget bridge: when present, the
    home list narrows member-groups to those still represented in the
    list, so forgetting every question in a group removes it from home.
    """

    accessible_question_ids: list[str] = Field(default_factory=list)
    include_results: bool = True


@router.post("/mine", response_model=list[PollResponse])
def get_my_groups(req: MyGroupsRequest, request: Request):
    """Return every poll the user has visibility into. See the visibility
    rule in `services/groups.py`.

    Forget bridge: when the FE passes `accessible_question_ids`, the home
    list is narrowed to groups still represented in that list, so
    forgetting every question in a group removes it from home even while
    the `group_members` row persists.

    Membership-only "empty groups" (member row but zero visible polls)
    are surfaced by the sibling `POST /api/groups/empty` endpoint.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)

    with get_db() as conn:
        visibility = load_user_visibility(
            conn,
            browser_id,
            user_id=user_id,
            legacy_question_ids=req.accessible_question_ids or None,
        )

        member_group_ids = set(visibility.joined_by_group.keys())
        if req.accessible_question_ids and not user_id:
            # Forget bridge: drop member-groups with no bridge signal.
            # Anonymous-only — signed-in users' membership is authoritative
            # and not subject to per-device localStorage forget.
            # Signed-in users drop groups via the explicit "leave group"
            # action (DELETE /membership), which removes the membership
            # row across all linked browsers.
            member_group_ids &= visibility.bridged_group_ids

        # Candidate groups = bridge groups + filtered member groups.
        # Bridge groups always show; member groups contribute only if
        # they survived the forget bridge.
        candidate_group_ids = visibility.bridged_group_ids | member_group_ids
        candidate_pids = poll_ids_for_group_ids(conn, list(candidate_group_ids))
        if not candidate_pids:
            return []

        visible_pids = filter_visible_polls(conn, candidate_pids, visibility)
        return polls_for_poll_ids(
            conn, visible_pids, include_results=req.include_results
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


def _row_to_group_summary(row) -> GroupSummary:
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
        row = conn.execute(
            f"SELECT {_GROUP_SUMMARY_COLUMNS} FROM groups WHERE id = %(id)s",
            {"id": group_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Group not found")
        return _row_to_group_summary(row)


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
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")

        meta = get_group_metadata(conn, group_id)
        privacy = meta["privacy"] if meta else "public"

        # Phase E: strangers don't auto-join private groups via URL and
        # don't see any polls — 404 at the boundary instead.
        if privacy == "private":
            if not is_caller_member_of_group(
                conn, group_id, browser_id=browser_id, user_id=user_id
            ):
                raise HTTPException(status_code=404, detail="Group not found")
        else:
            grant_group_membership_inline(
                conn, group_id, browser_id, privacy=privacy
            )

        visibility = load_user_visibility(conn, browser_id, user_id=user_id)
        group_pids = poll_ids_for_group_ids(conn, [group_id])
        visible_pids = filter_visible_polls(conn, group_pids, visibility)
        return polls_for_poll_ids(
            conn, visible_pids, include_results=include_results
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

        if target is None:
            raise HTTPException(status_code=404, detail="Group not found")

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
def get_group_image(route_id: str, request: Request):
    """Serve the group's avatar image bytes with the stored MIME type.

    Public groups: no membership / browser-id check. The URL itself is
    unguessable (it requires the group's short_id or uuid), and the
    image surface is intentionally narrow (just the avatar). Cached
    via the FE's `?v=<image_updated_at>` query string; the response
    sets `Cache-Control: public, max-age=31536000, immutable` so a
    given URL never re-fetches once received (the next change bumps
    the timestamp, producing a new URL).

    Private groups (Phase E): gated by membership. Strangers get 404 —
    the avatar is private-group content too. Members get the bytes with
    the same immutable cache headers.

    Returns 404 when no image is set (FE renders fallback initials).
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
