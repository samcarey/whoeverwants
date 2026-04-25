"""Multipoll API endpoints (Phase 1 of multipoll redesign).

POST /api/multipolls
GET  /api/multipolls/{short_id}
GET  /api/multipolls/by-id/{multipoll_id}

Phase 1 only covers wrapper creation + read. Voting, results, and close/reopen
still flow through the existing per-sub-poll endpoints (see routers/polls.py).
See docs/multipoll-phasing.md.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from algorithms.multipoll_title import generate_multipoll_title
from database import get_db
from models import (
    CreateMultipollRequest,
    CreateSubPollRequest,
    MultipollResponse,
    PollType,
)
from routers.polls import _row_to_poll

router = APIRouter(prefix="/api/multipolls", tags=["multipolls"])


# Categories used to derive the auto-title. A sub-poll's `category` (when set)
# is preferred over its raw `poll_type` so e.g. a `yes_no` sub-poll with
# category="movie" becomes "Movie", not "Yes/No".
def _categories_for_title(sub_polls: list[CreateSubPollRequest]) -> list[str]:
    return [sp.category or sp.poll_type.value for sp in sub_polls]


def _validate_request(req: CreateMultipollRequest) -> None:
    """Reject requests that violate Phase 1 invariants. Raises HTTPException."""
    if not req.sub_polls:
        raise HTTPException(status_code=400, detail="At least one sub-poll is required")

    # Phase 1: participation polls are explicitly excluded from multipolls.
    for sp in req.sub_polls:
        if sp.poll_type == PollType.participation:
            raise HTTPException(
                status_code=400,
                detail="Participation polls cannot be sub-polls of a multipoll",
            )

    # At most one time sub-poll: a multipoll has a single shared availability phase.
    time_count = sum(1 for sp in req.sub_polls if sp.poll_type == PollType.time)
    if time_count > 1:
        raise HTTPException(
            status_code=400,
            detail="A multipoll can contain at most one time sub-poll",
        )

    # Multiple sub-polls of the same (poll_type, category) require distinct context.
    seen: dict[tuple[str, str | None], list[str | None]] = {}
    for sp in req.sub_polls:
        key = (sp.poll_type.value, (sp.category or "").strip().lower() or None)
        seen.setdefault(key, []).append((sp.context or "").strip() or None)
    for key, contexts in seen.items():
        if len(contexts) <= 1:
            continue
        normalized = [c.lower() if c else None for c in contexts]
        if len(set(normalized)) != len(normalized):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Sub-polls of the same kind must each have a distinct "
                    "context to disambiguate them"
                ),
            )

    # Deadline ordering. Both are optional; only enforce when both are set.
    if req.response_deadline and req.prephase_deadline:
        try:
            response_dt = datetime.fromisoformat(
                req.response_deadline.replace("Z", "+00:00")
            )
            prephase_dt = datetime.fromisoformat(
                req.prephase_deadline.replace("Z", "+00:00")
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid deadline format: {exc}") from exc
        if prephase_dt >= response_dt:
            raise HTTPException(
                status_code=400,
                detail="Prephase deadline must be before the voting deadline",
            )


def _insert_multipoll(conn, req: CreateMultipollRequest, now: datetime) -> dict:
    """Insert the multipoll wrapper row.

    `req.title` (when provided) is stored in `thread_title` per the plan:
    explicit titles are persisted; absent titles are computed at read time
    from sub-poll categories. The COALESCE subquery inherits the parent
    multipoll's thread_title for follow-ups when neither `req.title` nor
    `req.thread_title` is set.
    """
    explicit_title = req.title if req.title is not None else req.thread_title
    return conn.execute(
        """
        INSERT INTO multipolls (
            creator_secret, creator_name, response_deadline,
            prephase_deadline, prephase_deadline_minutes,
            follow_up_to, fork_of, context,
            thread_title,
            created_at, updated_at
        )
        VALUES (
            %(creator_secret)s, %(creator_name)s, %(response_deadline)s,
            %(prephase_deadline)s, %(prephase_deadline_minutes)s,
            %(follow_up_to)s, %(fork_of)s, %(context)s,
            COALESCE(
                %(explicit_title)s,
                (SELECT thread_title FROM multipolls WHERE id = %(follow_up_to)s)
            ),
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "creator_secret": req.creator_secret,
            "creator_name": req.creator_name,
            "response_deadline": req.response_deadline,
            # If prephase_deadline_minutes is set, defer the absolute deadline
            # (mirrors the suggestion_deadline / suggestion_deadline_minutes
            # split on polls — see CLAUDE.md "Deferred Suggestion Deadline").
            "prephase_deadline": (
                None if req.prephase_deadline_minutes else req.prephase_deadline
            ),
            "prephase_deadline_minutes": req.prephase_deadline_minutes,
            "follow_up_to": req.follow_up_to,
            "fork_of": req.fork_of,
            "context": req.context,
            "explicit_title": explicit_title,
            "now": now,
        },
    ).fetchone()


def _insert_sub_poll(
    conn,
    multipoll_row: dict,
    sub: CreateSubPollRequest,
    sub_poll_index: int,
    title: str,
    creator_secret: str,
    creator_name: str | None,
    response_deadline: str | None,
    suggestion_deadline: str | None,
    now: datetime,
) -> dict:
    """Insert one sub-poll row into `polls` linked to the parent multipoll.

    Wrapper-level fields (creator_secret, creator_name, response_deadline) are
    written on the polls row too — Phase 1 keeps the legacy single-poll columns
    populated so existing per-sub-poll endpoints (vote/results/close) keep
    working without modification. Phase 5 will retire those.
    """
    suggestion_deadline_value = (
        None if sub.suggestion_deadline_minutes else suggestion_deadline
    )
    return conn.execute(
        """
        INSERT INTO polls (
            title, poll_type, options, response_deadline,
            creator_secret, creator_name,
            suggestion_deadline, suggestion_deadline_minutes,
            allow_pre_ranking,
            details,
            day_time_windows, duration_window,
            category, options_metadata,
            reference_latitude, reference_longitude,
            reference_location_label,
            min_responses, show_preliminary_results,
            min_availability_percent,
            multipoll_id, sub_poll_index,
            created_at, updated_at
        )
        VALUES (
            %(title)s, %(poll_type)s, %(options)s::jsonb, %(response_deadline)s,
            %(creator_secret)s, %(creator_name)s,
            %(suggestion_deadline)s, %(suggestion_deadline_minutes)s,
            %(allow_pre_ranking)s,
            %(details)s,
            %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
            %(category)s, %(options_metadata)s::jsonb,
            %(reference_latitude)s, %(reference_longitude)s,
            %(reference_location_label)s,
            %(min_responses)s, %(show_preliminary_results)s,
            %(min_availability_percent)s,
            %(multipoll_id)s, %(sub_poll_index)s,
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "title": title,
            "poll_type": sub.poll_type.value,
            "options": json.dumps(sub.options) if sub.options else None,
            "response_deadline": response_deadline,
            "creator_secret": creator_secret,
            "creator_name": creator_name,
            "suggestion_deadline": suggestion_deadline_value,
            "suggestion_deadline_minutes": sub.suggestion_deadline_minutes,
            "allow_pre_ranking": sub.allow_pre_ranking,
            "details": sub.context,
            "day_time_windows": (
                json.dumps(sub.day_time_windows) if sub.day_time_windows else None
            ),
            "duration_window": (
                json.dumps(sub.duration_window) if sub.duration_window else None
            ),
            "category": sub.category or "custom",
            "options_metadata": (
                json.dumps(sub.options_metadata) if sub.options_metadata else None
            ),
            "reference_latitude": sub.reference_latitude,
            "reference_longitude": sub.reference_longitude,
            "reference_location_label": sub.reference_location_label,
            "min_responses": sub.min_responses,
            "show_preliminary_results": sub.show_preliminary_results,
            "min_availability_percent": (
                sub.min_availability_percent if sub.poll_type == PollType.time else None
            ),
            "multipoll_id": str(multipoll_row["id"]),
            "sub_poll_index": sub_poll_index,
            "now": now,
        },
    ).fetchone()


def _compute_display_title(row: dict, sub_poll_rows: list[dict]) -> str:
    """Effective display title: thread_title override OR auto-generated."""
    override = row.get("thread_title")
    if override:
        return override
    categories = [sp.get("category") or sp.get("poll_type") or "" for sp in sub_poll_rows]
    return generate_multipoll_title(categories, row.get("context"))


def _row_to_multipoll(row: dict, sub_poll_rows: list[dict]) -> MultipollResponse:
    return MultipollResponse(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        creator_secret=row.get("creator_secret"),
        creator_name=row.get("creator_name"),
        response_deadline=(
            row["response_deadline"].isoformat() if row.get("response_deadline") else None
        ),
        prephase_deadline=(
            row["prephase_deadline"].isoformat() if row.get("prephase_deadline") else None
        ),
        prephase_deadline_minutes=row.get("prephase_deadline_minutes"),
        is_closed=row.get("is_closed", False),
        close_reason=row.get("close_reason"),
        follow_up_to=str(row["follow_up_to"]) if row.get("follow_up_to") else None,
        fork_of=str(row["fork_of"]) if row.get("fork_of") else None,
        thread_title=row.get("thread_title"),
        context=row.get("context"),
        title=_compute_display_title(row, sub_poll_rows),
        created_at=(
            row["created_at"].isoformat()
            if isinstance(row["created_at"], datetime)
            else str(row["created_at"])
        ),
        updated_at=(
            row["updated_at"].isoformat()
            if isinstance(row["updated_at"], datetime)
            else str(row["updated_at"])
        ),
        sub_polls=[_row_to_poll(sp) for sp in sub_poll_rows],
    )


def _fetch_sub_polls(conn, multipoll_id: str) -> list[dict]:
    return conn.execute(
        """
        SELECT * FROM polls
        WHERE multipoll_id = %(multipoll_id)s
        ORDER BY sub_poll_index NULLS LAST, created_at
        """,
        {"multipoll_id": multipoll_id},
    ).fetchall()


@router.post("", response_model=MultipollResponse, status_code=201)
def create_multipoll(req: CreateMultipollRequest):
    _validate_request(req)

    # Sub-poll title: use thread_title override (if any) or the auto-computed
    # title. polls.title is NOT NULL, so each sub-poll needs *some* title even
    # though Phase 2+ will display the multipoll's computed title instead.
    sub_poll_title = (
        req.title
        or req.thread_title
        or generate_multipoll_title(_categories_for_title(req.sub_polls), req.context)
    )

    now = datetime.now(timezone.utc)

    with get_db() as conn:
        multipoll_row = _insert_multipoll(conn, req, now)

        sub_poll_rows: list[dict] = []
        for index, sub in enumerate(req.sub_polls):
            sub_poll_rows.append(
                _insert_sub_poll(
                    conn,
                    multipoll_row,
                    sub,
                    index,
                    sub_poll_title,
                    req.creator_secret,
                    req.creator_name,
                    req.response_deadline,
                    req.prephase_deadline,
                    now,
                )
            )

    return _row_to_multipoll(multipoll_row, sub_poll_rows)


@router.get("/by-id/{multipoll_id}", response_model=MultipollResponse)
def get_multipoll_by_id(multipoll_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM multipolls WHERE id = %(id)s",
            {"id": multipoll_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Multipoll not found")
        sub_poll_rows = _fetch_sub_polls(conn, str(row["id"]))
    return _row_to_multipoll(row, sub_poll_rows)


@router.get("/{short_id}", response_model=MultipollResponse)
def get_multipoll(short_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM multipolls WHERE short_id = %(short_id)s",
            {"short_id": short_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Multipoll not found")
        sub_poll_rows = _fetch_sub_polls(conn, str(row["id"]))
    return _row_to_multipoll(row, sub_poll_rows)
