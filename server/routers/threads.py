"""Thread API endpoints (Phase B.3 / C.3 of the thread routing redesign).

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
row, taking the user out of membership-driven visibility. This is the
follow-up to Phase C.3 that gates retirement of the legacy
`accessible_question_ids` bridge: once the FE wires forget-of-last-poll
(or an explicit "leave thread" UX) to call this, the bridge can be
dropped from `/api/threads/mine`.

Phase C.3: both read endpoints enforce the visibility rule documented in
`services/threads.py` against the browser_id captured by
`BrowserIdMiddleware`. The membership tables (Phase C.1) and auto-join
writes (Phase C.2) feed this filter.

Phase C.3 decisions on the previously-open semantic questions:

  * **Join trigger**: vote/create only (Phase C.2 default preserved).
    The /access endpoint still grants poll_access (per-poll, not thread
    membership) and the `?p=` auto-grant on /by-route-id mirrors that.
  * **Non-member visiting `/t/<id>` with no `?p`**: 404. We treat "no
    visibility into any poll of this thread" the same as "no such
    thread" for both UX simplicity and consistent FE error handling.
  * **Forget vs leave**: forget stays localStorage-only. We do NOT
    delete `thread_members` on forget by default; the home view uses
    the legacy `accessible_question_ids` bridge to narrow membership-
    thread visibility during the rollout. The DELETE membership
    endpoint is the explicit "leave thread" action that tears down
    membership directly — it lets the FE retire the bridge once
    wired up.
"""

from __future__ import annotations

import psycopg.errors
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import get_db
from models import PollResponse
from services.memberships import leave_thread as _leave_thread_row
from services.threads import (
    filter_visible_polls,
    grant_poll_access_inline,
    load_user_visibility,
    poll_ids_for_thread_ids,
    polls_for_poll_ids,
    resolve_thread_id_from_route_id,
    thread_ids_for_poll_ids,
)


class ThreadPreviewResponse(BaseModel):
    """Public-readable thread metadata for link-preview (Open Graph)
    crawlers. Returns ONLY title + description — no question contents,
    no votes, no creator names, no per-poll details — so it's safe to
    serve without visibility checks. The URL itself is the share token;
    if you can hit this endpoint you've been handed the link."""

    title: str
    description: str | None = None

router = APIRouter(prefix="/api/threads", tags=["threads"])


def _browser_id(request: Request) -> str | None:
    """Read the browser_id captured by `BrowserIdMiddleware`. Mirror of the
    helper in routers/polls.py — kept inline here so this router has no
    cross-router import for one trivial getattr."""
    return getattr(request.state, "browser_id", None)


class MyThreadsRequest(BaseModel):
    """Request body for `POST /api/threads/mine`.

    `accessible_question_ids` is the FE's localStorage list — used as a
    transitional access bridge for users without thread_members rows yet
    (pre-B.3 voters, etc.). Phase C.3 honors it as poll-level access and
    intersects membership-thread visibility with it so forget keeps its
    "thread disappears from home" semantics until an explicit leave
    action lands.
    """

    accessible_question_ids: list[str] = Field(default_factory=list)
    include_results: bool = True


@router.post("/mine", response_model=list[PollResponse])
def get_my_threads(req: MyThreadsRequest, request: Request):
    """Return every poll the user has visibility into (per Phase C.3
    rule).

    The candidate set is the union of:
      * Polls in any thread the browser is a member of (subject to the
        closed_at filter), AND
      * Polls explicitly granted via /access (poll_access rows), AND
      * Polls in any thread reached via the legacy `accessible_question_ids`
        bridge (unfiltered — preserves Phase B.3 contract that "any
        question_id grants access to its whole thread").

    Forget bridge: when the FE passes `accessible_question_ids`, the home
    list is narrowed to threads the user still has a NON-membership signal
    in (poll_access OR legacy bridge). Without this, a thread_members row
    would keep a thread alive on the home list even after the user
    forgot every question in it. Membership-only callers (no legacy list
    passed) skip the narrowing — once an explicit `DELETE
    /api/threads/{id}/membership` lands, this transitional carve-out goes
    away.
    """
    browser_id = _browser_id(request)

    with get_db() as conn:
        visibility = load_user_visibility(
            conn,
            browser_id,
            legacy_question_ids=req.accessible_question_ids or None,
        )

        # Threads the user has a non-membership signal in. Used both as
        # the bridged-visibility input (already in `visibility`) and as
        # the forget bridge's "interesting" set.
        access_thread_ids = set(
            thread_ids_for_poll_ids(conn, visibility.access_poll_ids)
        )
        signal_thread_ids = visibility.bridged_thread_ids | access_thread_ids

        member_thread_ids = set(visibility.joined_by_thread.keys())
        if req.accessible_question_ids:
            # Forget bridge: drop member-threads with no concurrent signal.
            member_thread_ids &= signal_thread_ids

        # Candidate threads = signal threads (bridge + access) + filtered
        # member threads. Bridge threads always show; member threads
        # contribute only if they survived the forget bridge.
        candidate_thread_ids = signal_thread_ids | member_thread_ids
        candidate_pids = set(
            poll_ids_for_thread_ids(conn, list(candidate_thread_ids))
        )
        # Explicit per-poll access (e.g. direct-link visit) survives
        # even if its thread is otherwise hidden — this is the "direct
        # link from a stranger" path that doesn't grant thread membership.
        candidate_pids |= visibility.access_poll_ids
        if not candidate_pids:
            return []

        visible_pids = filter_visible_polls(conn, list(candidate_pids), visibility)
        return polls_for_poll_ids(
            conn, visible_pids, include_results=req.include_results
        )


@router.get("/by-route-id/{route_id}", response_model=list[PollResponse])
def get_thread_by_route_id(
    route_id: str,
    request: Request,
    include_results: bool = True,
    p: str | None = None,
):
    """Return every visible poll in one thread, resolved by route id.

    `route_id` accepts (in order):
      - `threads.short_id`
      - `threads.id` (uuid)
      - `polls.short_id` (Phase A → Phase B.3 fallback)
      - `polls.id` (uuid fallback)

    Optional `?p=<pollShortId>`: when present, a `poll_access` row is
    written inline for that poll (resolved within this thread) BEFORE
    visibility filtering runs. This race-safely surfaces the targeted
    poll when a stranger lands on `/t/<thread>?p=<poll>` — without it, a
    cold-start direct-link landing would hit by-route-id before the FE's
    parallel `apiGrantPollAccess` call lands on the server, returning an
    empty thread.

    Phase C.3: 404 when neither the resolved thread nor the optional `?p`
    grant produces any visible poll — i.e. the user is neither a member
    nor a direct-link visitor.
    """
    browser_id = _browser_id(request)

    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")

        # `?p=` auto-grant: best-effort. A bogus poll short_id is silently
        # ignored (the visibility filter then 404s), and a poll outside
        # this thread is also ignored — we explicitly scope the lookup to
        # the resolved thread to prevent ?p from leaking access to polls
        # in another thread that happens to match the short_id.
        if p and browser_id:
            row = conn.execute(
                "SELECT id FROM polls "
                "WHERE short_id = %(s)s AND thread_id = %(t)s::uuid",
                {"s": p, "t": thread_id},
            ).fetchone()
            if row:
                try:
                    grant_poll_access_inline(conn, str(row["id"]), browser_id)
                except psycopg.errors.ForeignKeyViolation:
                    # Poll vanished between the lookup and the insert.
                    # The visibility filter will surface this as 404 via
                    # the empty result.
                    pass

        visibility = load_user_visibility(conn, browser_id)
        thread_pids = poll_ids_for_thread_ids(conn, [thread_id])
        visible_pids = filter_visible_polls(conn, thread_pids, visibility)
        if not visible_pids:
            raise HTTPException(status_code=404, detail="Thread not found")
        return polls_for_poll_ids(
            conn, visible_pids, include_results=include_results
        )


@router.get(
    "/by-route-id/{route_id}/preview",
    response_model=ThreadPreviewResponse,
)
def get_thread_preview(route_id: str, p: str | None = None):
    """Public link-preview metadata for Open Graph / Twitter Card crawlers.

    Returns ONLY title + description so this endpoint can safely run
    without visibility filtering or `poll_access` writes. Crawlers
    (Slack, iMessage, Twitter, etc.) hit URLs without any browser
    identity; gating on the visibility filter would 404 them and our
    shared links would render as bare URLs.

    Resolution:
      - When `?p=<pollShortId>` matches a poll in the resolved thread,
        that poll's title is preferred (so a `/t/<thread>?p=<poll>`
        share targets that specific poll).
      - Else uses the thread's most recent poll's `thread_title`
        override or auto-title.

    Description (optional): the chosen poll's `details` (Notes), trimmed
    + capped, or null.

    Returns 404 when the route id doesn't resolve to any thread.
    """
    # Local import: routers/polls.py imports services/threads, so an
    # eager import would cycle.
    from routers.polls import _compute_display_title

    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")

        target = None
        if p:
            target = conn.execute(
                """SELECT * FROM polls
                    WHERE short_id = %(s)s AND thread_id = %(t)s::uuid""",
                {"s": p, "t": thread_id},
            ).fetchone()

        if target is None:
            target = conn.execute(
                """SELECT * FROM polls
                    WHERE thread_id = %(t)s::uuid
                    ORDER BY created_at DESC
                    LIMIT 1""",
                {"t": thread_id},
            ).fetchone()

        if target is None:
            raise HTTPException(status_code=404, detail="Thread not found")

        # `polls.title` is a computed value (see `_compute_display_title`
        # in routers/polls.py): thread_title override, else
        # `generate_poll_title(categories, context, per-question contexts)`.
        # Pull the question rows for the chosen poll so the helper has
        # everything it needs.
        question_rows = conn.execute(
            """SELECT category, question_type, details
                 FROM questions
                WHERE poll_id = %(pid)s
                ORDER BY question_index NULLS LAST, created_at""",
            {"pid": str(target["id"])},
        ).fetchall()
        title = _compute_display_title(dict(target), [dict(r) for r in question_rows])

        details = (target.get("details") or "").strip() or None
        if details and len(details) > 200:
            details = details[:197].rstrip() + "…"

        return ThreadPreviewResponse(title=title, description=details)


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

    `poll_access` rows are NOT touched. A user who joined a thread,
    accessed a specific poll directly, then left the thread keeps the
    poll-level access — that direct-link relationship is independent of
    thread membership. To revoke poll access, drop poll_access rows on
    the FE side (no endpoint yet — out of scope for this follow-up).

    No-op when `browser_id` is missing (no middleware id, no row to
    remove). Returns 204 either way.
    """
    browser_id = _browser_id(request)
    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")
        _leave_thread_row(conn, thread_id, browser_id)
