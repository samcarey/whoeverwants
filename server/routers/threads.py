"""Thread API endpoints.

Two read endpoints — `POST /api/threads/mine` and
`GET /api/threads/by-route-id/{route_id}` — collapse the legacy three-step
home / thread page bootstrap (discoverRelatedQuestions + getAccessiblePolls
+ client-side `buildThreads`) into a single server round-trip driven by
`polls.thread_id`.

Both return `list[PollResponse]` — same shape as
`POST /api/questions/accessible` — so the FE consumer is a drop-in for
the existing flow.

A third endpoint — `DELETE /api/threads/{route_id}/membership` — is the
explicit "leave thread" action. It removes the caller's `thread_members`
row, taking the user out of membership-driven visibility.

Both read endpoints enforce the visibility rule documented in
`services/threads.py` against the browser_id captured by
`BrowserIdMiddleware`. Migration 106 retired per-poll access — visiting
any thread URL via `/by-route-id/{id}` writes a `thread_members` row
inline, granting whole-thread visibility (subject to the
closed-before-join filter). Sharing a thread link with someone is now
sufficient to bring them into the conversation; they don't need to vote
first.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import get_db
from middleware import browser_id_from_request as _browser_id
from models import PollResponse, UpdateThreadTitleRequest
from services.memberships import leave_thread as _leave_thread_row
from services.threads import (
    filter_visible_polls,
    grant_thread_membership_inline,
    load_user_visibility,
    poll_ids_for_thread_ids,
    polls_for_poll_ids,
    resolve_thread_id_from_route_id,
)


class ThreadPreviewResponse(BaseModel):
    """Public-readable thread metadata for link-preview (Open Graph)
    crawlers. Returns ONLY title + description — no question contents,
    no votes, no creator names, no per-poll details — so it's safe to
    serve without visibility checks. The URL itself is the share token;
    if you can hit this endpoint you've been handed the link."""

    title: str
    description: str | None = None


class ThreadTitleResponse(BaseModel):
    """Returned by `POST /api/threads/{route_id}/title`. Surfaces the
    fields the FE needs to patch its in-memory thread cache without a
    refetch: the resolved thread id, its short_id (so the route id is
    canonical going forward), and the new title (or null on clear)."""

    thread_id: str
    thread_short_id: str | None = None
    title: str | None = None

router = APIRouter(prefix="/api/threads", tags=["threads"])


class MyThreadsRequest(BaseModel):
    """Request body for `POST /api/threads/mine`.

    `accessible_question_ids` is the FE's localStorage list — used as a
    transitional access bridge for users without thread_members rows yet
    (pre-B.3 voters, etc.). Treated as thread-level access (every poll
    in the resolved thread visible, no closed_at filter) to preserve
    Phase B.3 behavior. Also drives the forget bridge: when present, the
    home list narrows member-threads to those still represented in the
    list, so forgetting every question in a thread removes it from home.
    """

    accessible_question_ids: list[str] = Field(default_factory=list)
    include_results: bool = True


@router.post("/mine", response_model=list[PollResponse])
def get_my_threads(req: MyThreadsRequest, request: Request):
    """Return every poll the user has visibility into. See the visibility
    rule documented in `services/threads.py`.

    Forget bridge: when the FE passes `accessible_question_ids`, the home
    list is narrowed to threads still represented in that list, so
    forgetting every question in a thread removes it from home even
    while the `thread_members` row persists. Membership-only callers
    (empty list) skip the narrowing.
    """
    browser_id = _browser_id(request)

    with get_db() as conn:
        visibility = load_user_visibility(
            conn,
            browser_id,
            legacy_question_ids=req.accessible_question_ids or None,
        )

        member_thread_ids = set(visibility.joined_by_thread.keys())
        if req.accessible_question_ids:
            # Forget bridge: drop member-threads with no bridge signal.
            member_thread_ids &= visibility.bridged_thread_ids

        # Candidate threads = bridge threads + filtered member threads.
        # Bridge threads always show; member threads contribute only if
        # they survived the forget bridge.
        candidate_thread_ids = visibility.bridged_thread_ids | member_thread_ids
        candidate_pids = poll_ids_for_thread_ids(conn, list(candidate_thread_ids))
        if not candidate_pids:
            return []

        visible_pids = filter_visible_polls(conn, candidate_pids, visibility)
        return polls_for_poll_ids(
            conn, visible_pids, include_results=req.include_results
        )


@router.get("/by-route-id/{route_id}", response_model=list[PollResponse])
def get_thread_by_route_id(
    route_id: str,
    request: Request,
    include_results: bool = True,
):
    """Return every visible poll in one thread, resolved by route id.

    See the visibility rule documented in `services/threads.py`. The
    caller is auto-joined to the resolved thread inline (idempotent via
    ON CONFLICT) — sharing a thread link is the canonical "invite
    someone" mechanism. The closed-before-join filter still applies, so
    a brand-new member sees open polls plus polls closed after
    `joined_at`. A linked poll closed before the visitor joined is
    silently absent (per the user spec: "just show the thread and don't
    try to show the old poll").

    `route_id` accepts `threads.short_id`, `threads.id`,
    `polls.short_id`, or `polls.id`.

    Returns 404 only when route resolution itself fails. An empty
    visible-polls list returns 200 with `[]` so the thread page can
    still render its chrome (header + Share + Create Poll).
    """
    browser_id = _browser_id(request)

    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")

        # Auto-join: every visit becomes a thread member. Idempotent via
        # ON CONFLICT, so re-visits don't advance joined_at — the
        # closed-before-join filter compares against the FIRST visit's
        # watermark.
        grant_thread_membership_inline(conn, thread_id, browser_id)

        visibility = load_user_visibility(conn, browser_id)
        thread_pids = poll_ids_for_thread_ids(conn, [thread_id])
        visible_pids = filter_visible_polls(conn, thread_pids, visibility)
        return polls_for_poll_ids(
            conn, visible_pids, include_results=include_results
        )


@router.get(
    "/by-route-id/{route_id}/preview",
    response_model=ThreadPreviewResponse,
)
def get_thread_preview(route_id: str, p: str | None = None):
    """Public link-preview metadata for Open Graph / Twitter Card crawlers.

    Visibility-free + no membership writes: crawlers (Slack, iMessage,
    Twitter, etc.) hit URLs without any browser identity, and gating
    them on visibility would 404 every share. Returning only title +
    description (no votes, no question contents) keeps this safe.

    Title is the poll's auto-generated title; the `thread_title`
    override is deliberately ignored so a custom thread name (often a
    participant-name string) doesn't replace the poll's actual subject.

    Description: comma-joined options across the poll's questions; else
    the `details` (Notes) field; else null. Capped at 200 chars.
    """
    # Local imports: routers/polls.py imports services/threads, so an
    # eager import would cycle.
    from algorithms.poll_title import generate_poll_title
    from routers.polls import _category_for_title

    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")

        target = None
        if p:
            target = conn.execute(
                """SELECT id, context, details FROM polls
                    WHERE short_id = %(s)s AND thread_id = %(t)s::uuid""",
                {"s": p, "t": thread_id},
            ).fetchone()

        if target is None:
            target = conn.execute(
                """SELECT id, context, details FROM polls
                    WHERE thread_id = %(t)s::uuid
                    ORDER BY created_at DESC
                    LIMIT 1""",
                {"t": thread_id},
            ).fetchone()

        if target is None:
            raise HTTPException(status_code=404, detail="Thread not found")

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

        return ThreadPreviewResponse(title=title, description=description)


@router.post("/{route_id}/title", response_model=ThreadTitleResponse)
def update_thread_title(route_id: str, req: UpdateThreadTitleRequest):
    """Set or clear a thread's title override.

    Migration 105 moved the override from `polls.thread_title` (per-poll)
    to `threads.title` (one row per thread). Anyone with the URL can
    rename the thread — there's no creator-secret check today, matching
    the prior `/api/polls/<id>/thread-title` semantics.

    Empty / whitespace-only `thread_title` clears the override (NULL).

    `route_id` accepts the same four forms as `/by-route-id/{route_id}`:
    `threads.short_id`, `threads.id`, `polls.short_id`, `polls.id`.
    """
    normalized = (req.thread_title or "").strip()
    value: str | None = normalized if normalized else None
    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")
        row = conn.execute(
            """
            UPDATE threads
               SET title = %(title)s
             WHERE id = %(id)s
            RETURNING id, short_id, title
            """,
            {"id": thread_id, "title": value},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Thread not found")
    return ThreadTitleResponse(
        thread_id=str(row["id"]),
        thread_short_id=row.get("short_id"),
        title=row.get("title"),
    )


@router.delete("/{route_id}/membership", status_code=204)
def leave_thread(route_id: str, request: Request):
    """Explicit "leave thread" action — remove the caller's
    `thread_members` row for the resolved thread.

    Idempotent: returns 204 whether or not a row existed. Strangers
    (no membership row) get 204 too, since the operation is "ensure no
    membership exists" and that's already true.

    `route_id` accepts the same four forms as `/by-route-id/{route_id}`:
    threads.short_id, threads.id, polls.short_id, polls.id. Resolution
    fails (404) when none of those produce a thread — distinguishing
    "thread doesn't exist" from "no membership to remove".

    Migration 106 retired per-poll access; thread membership is the only
    access mechanism. Re-visiting any thread URL after leave will write
    a fresh thread_members row (with a new joined_at watermark), so
    "leave" is durable only against the user not navigating back.

    No-op when `browser_id` is missing (no middleware id, no row to
    remove). Returns 204 either way.
    """
    browser_id = _browser_id(request)
    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")
        _leave_thread_row(conn, thread_id, browser_id)
