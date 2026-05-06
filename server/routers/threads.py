"""Thread API endpoints (Phase B.3 of the thread routing redesign).

Two endpoints — `POST /api/threads/mine` and
`GET /api/threads/by-route-id/{route_id}` — collapse the legacy three-step
home / thread page bootstrap (discoverRelatedQuestions + getAccessiblePolls
+ client-side `buildThreads`) into a single server round-trip driven by
`polls.thread_id`.

Both return `list[PollResponse]` — same shape as
`POST /api/questions/accessible` — so the FE consumer is a drop-in for
the existing flow. The thread set is computed server-side using the
indexed `polls.thread_id` column rather than walking
`polls.follow_up_to` chains in Python.

Phase B.3 deliberately stops short of cookie-driven membership (Phase C):
`POST /api/threads/mine` still accepts `{accessible_question_ids: list[str]}`
as the access signal. The browser_id captured by `BrowserIdMiddleware` is
read for telemetry/forward-compat but never gates results yet.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from database import get_db
from models import PollResponse
from services.threads import (
    poll_ids_for_thread_ids,
    polls_for_poll_ids,
    resolve_thread_id_from_route_id,
    thread_ids_for_question_ids,
)

router = APIRouter(prefix="/api/threads", tags=["threads"])


class MyThreadsRequest(BaseModel):
    """Request body for `POST /api/threads/mine`.

    Phase B.3: the FE passes its localStorage `accessible_question_ids` list;
    the server resolves to thread_ids and returns every poll in those threads.
    Phase C will switch to cookie-driven membership and this list becomes
    optional/legacy.
    """

    accessible_question_ids: list[str] = Field(default_factory=list)
    include_results: bool = True


@router.post("/mine", response_model=list[PollResponse])
def get_my_threads(req: MyThreadsRequest, request: Request):
    """Return every poll in any thread that contains one of the user's
    accessible questions.

    Replaces the legacy `discoverRelatedQuestions + getAccessiblePolls`
    pair: the server walks `polls.thread_id` once to fan out from the
    requested question_ids to every poll in their threads, then hydrates
    each poll the same way `POST /api/questions/accessible` does.

    The browser_id (set by BrowserIdMiddleware) is captured on
    `request.state.browser_id` but not used for filtering yet — Phase C
    will add `thread_members` and start enforcing visibility here.
    """
    # Touch attribute so static checkers don't flag unused state. Phase C
    # will read this for membership lookup.
    _ = getattr(request.state, "browser_id", None)

    if not req.accessible_question_ids:
        return []
    with get_db() as conn:
        thread_ids = thread_ids_for_question_ids(conn, req.accessible_question_ids)
        if not thread_ids:
            return []
        poll_ids = poll_ids_for_thread_ids(conn, thread_ids)
        return polls_for_poll_ids(conn, poll_ids, include_results=req.include_results)


@router.get("/by-route-id/{route_id}", response_model=list[PollResponse])
def get_thread_by_route_id(
    route_id: str,
    request: Request,
    include_results: bool = True,
):
    """Return every poll in one thread, resolved by route id.

    `route_id` accepts (in order):
      - `threads.short_id`
      - `threads.id` (uuid)
      - `polls.short_id` (Phase A → Phase B.3 fallback: today's
        `threadShortId` is the root poll's short_id; Phase B.4 will mint
        dedicated thread short_ids)
      - `polls.id` (uuid fallback)

    404 when no thread can be resolved.
    """
    _ = getattr(request.state, "browser_id", None)

    with get_db() as conn:
        thread_id = resolve_thread_id_from_route_id(conn, route_id)
        if not thread_id:
            raise HTTPException(status_code=404, detail="Thread not found")
        poll_ids = poll_ids_for_thread_ids(conn, [thread_id])
        return polls_for_poll_ids(conn, poll_ids, include_results=include_results)
