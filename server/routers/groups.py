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

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import get_db
from middleware import browser_id_from_request as _browser_id
from models import PollResponse, UpdateGroupTitleRequest
from services.memberships import leave_group as _leave_group_row
from services.groups import (
    filter_visible_polls,
    grant_group_membership_inline,
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
    `empty_groups` array on `POST /api/groups/mine`."""

    id: str
    short_id: str | None = None
    title: str | None = None
    created_at: str


class GroupPreviewResponse(BaseModel):
    """Public-readable group metadata for link-preview (Open Graph)
    crawlers. Returns ONLY title + description — no question contents,
    no votes, no creator names, no per-poll details — so it's safe to
    serve without visibility checks. The URL itself is the share token;
    if you can hit this endpoint you've been handed the link."""

    title: str
    description: str | None = None


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

    with get_db() as conn:
        visibility = load_user_visibility(
            conn,
            browser_id,
            legacy_question_ids=req.accessible_question_ids or None,
        )

        member_group_ids = set(visibility.joined_by_group.keys())
        if req.accessible_question_ids:
            # Forget bridge: drop member-groups with no bridge signal.
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
    if not browser_id:
        return []
    with get_db() as conn:
        rows = conn.execute(
            """SELECT g.id, g.short_id, g.title, g.created_at
                 FROM groups g
                 JOIN group_members m ON m.group_id = g.id
                WHERE m.browser_id = %(bid)s
                  AND NOT EXISTS (
                      SELECT 1 FROM polls p WHERE p.group_id = g.id
                  )
                ORDER BY g.created_at DESC""",
            {"bid": browser_id},
        ).fetchall()
        return [_row_to_group_summary(r) for r in rows]


def _row_to_group_summary(row) -> GroupSummary:
    created_at = row.get("created_at")
    return GroupSummary(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        title=row.get("title"),
        created_at=created_at.isoformat() if created_at else "",
    )


@router.post("", response_model=GroupSummary, status_code=201)
def create_group(request: Request):
    """Create an empty group + auto-join the caller as a member.

    Requires `browser_id` (from `BrowserIdMiddleware`) — without one
    the group would be created but unreachable, so return 400 and let
    the FE retry after the middleware mints an id.
    """
    browser_id = _browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=400, detail="Missing browser identity")

    with get_db() as conn:
        row = conn.execute(
            "INSERT INTO groups DEFAULT VALUES "
            "RETURNING id, short_id, title, created_at"
        ).fetchone()
        grant_group_membership_inline(conn, str(row["id"]), browser_id)
        return _row_to_group_summary(row)


@router.get(
    "/by-route-id/{route_id}/summary",
    response_model=GroupSummary,
)
def get_group_summary(route_id: str):
    """Group metadata (id, short_id, title, created_at) for the group
    page header when `/by-route-id/{route_id}` returned no visible
    polls. Identity-free + no membership writes, so it's safe to call
    from preview crawlers or metadata routes. Returns 404 on route
    resolution failure.
    """
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        row = conn.execute(
            "SELECT id, short_id, title, created_at "
            "FROM groups WHERE id = %(id)s",
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

    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")

        # Auto-join: every visit becomes a group member. Idempotent via
        # ON CONFLICT, so re-visits don't advance joined_at — the
        # closed-before-join filter compares against the FIRST visit's
        # watermark.
        grant_group_membership_inline(conn, group_id, browser_id)

        visibility = load_user_visibility(conn, browser_id)
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

    Title is the poll's auto-generated title; the `group_title`
    override is deliberately ignored so a custom group name (often a
    participant-name string) doesn't replace the poll's actual subject.

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
            """SELECT category, question_type, details, options
                 FROM questions
                WHERE poll_id = %(pid)s
                ORDER BY question_index NULLS LAST, created_at""",
            {"pid": str(target["id"])},
        ).fetchall()

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
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, route_id)
        if not group_id:
            raise HTTPException(status_code=404, detail="Group not found")
        _leave_group_row(conn, group_id, browser_id)
