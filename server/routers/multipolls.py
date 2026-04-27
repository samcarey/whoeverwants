"""Multipoll API endpoints. See docs/multipoll-phasing.md."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from algorithms.multipoll_title import generate_multipoll_title
from database import get_db
from models import (
    ClosePollRequest,
    CreateMultipollRequest,
    CreateSubPollRequest,
    CutoffSuggestionsRequest,
    EditVoteRequest,
    MultipollResponse,
    MultipollVoteItem,
    PollType,
    ReopenPollRequest,
    SubmitMultipollVotesRequest,
    SubmitVoteRequest,
    VoteResponse,
)
from routers.polls import (
    _edit_vote_on_poll,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _json_or_none,
    _row_to_poll,
    _row_to_vote,
    _submit_vote_to_poll,
)

router = APIRouter(prefix="/api/multipolls", tags=["multipolls"])


def _categories_for_title(sub_polls: list[CreateSubPollRequest]) -> list[str]:
    return [sp.category or sp.poll_type.value for sp in sub_polls]


def _iso_or_none(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _validate_request(req: CreateMultipollRequest) -> None:
    if not req.sub_polls:
        raise HTTPException(status_code=400, detail="At least one sub-poll is required")

    time_count = sum(1 for sp in req.sub_polls if sp.poll_type == PollType.time)
    if time_count > 1:
        raise HTTPException(
            status_code=400,
            detail="A multipoll can contain at most one time sub-poll",
        )

    seen: dict[tuple[str, str | None], list[str | None]] = {}
    for sp in req.sub_polls:
        key = (sp.poll_type.value, (sp.category or "").strip().lower() or None)
        seen.setdefault(key, []).append((sp.context or "").strip() or None)
    for contexts in seen.values():
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


def _resolve_parent_multipoll_id(conn, parent_poll_id: str | None) -> str | None:
    """Look up a parent poll_id and return its multipoll_id, or None if the
    parent is a legacy (pre-Phase-4) poll with no wrapper. Returns None when
    the parent doesn't exist or has no multipoll_id."""
    if not parent_poll_id:
        return None
    row = conn.execute(
        "SELECT multipoll_id FROM polls WHERE id = %(id)s",
        {"id": parent_poll_id},
    ).fetchone()
    if not row or not row.get("multipoll_id"):
        return None
    return str(row["multipoll_id"])


def _insert_multipoll(conn, req: CreateMultipollRequest, now: datetime) -> dict:
    # follow_up_to / fork_of in the request are *poll ids* (matching the legacy
    # single-poll create API). Resolve to the parent's multipoll_id for the
    # multipolls row; the original poll_id is also written onto each sub-poll's
    # polls.follow_up_to / polls.fork_of so legacy thread aggregation keeps
    # working until Phase 5. thread_title falls back through both kinds of
    # parent so threads with mixed-mode parents inherit titles correctly.
    parent_followup_multipoll_id = _resolve_parent_multipoll_id(conn, req.follow_up_to)
    parent_fork_multipoll_id = _resolve_parent_multipoll_id(conn, req.fork_of)
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
            %(follow_up_multipoll_id)s, %(fork_multipoll_id)s, %(context)s,
            COALESCE(
                %(explicit_title)s,
                (SELECT thread_title FROM multipolls WHERE id = %(follow_up_multipoll_id)s),
                (SELECT thread_title FROM polls WHERE id = %(follow_up_poll_id)s)
            ),
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "creator_secret": req.creator_secret,
            "creator_name": req.creator_name,
            "response_deadline": req.response_deadline,
            # Defer the absolute deadline when *_minutes is set — mirrors the
            # suggestion_deadline split on polls (see CLAUDE.md "Deferred
            # Suggestion Deadline").
            "prephase_deadline": (
                None if req.prephase_deadline_minutes else req.prephase_deadline
            ),
            "prephase_deadline_minutes": req.prephase_deadline_minutes,
            "follow_up_multipoll_id": parent_followup_multipoll_id,
            "fork_multipoll_id": parent_fork_multipoll_id,
            "follow_up_poll_id": req.follow_up_to,
            "context": req.context,
            "explicit_title": explicit_title,
            "now": now,
        },
    ).fetchone()


def _insert_sub_poll(
    conn,
    multipoll_row: dict,
    req: CreateMultipollRequest,
    sub: CreateSubPollRequest,
    sub_poll_index: int,
    title: str,
    now: datetime,
) -> dict:
    # Wrapper-level fields are duplicated onto the polls row so the existing
    # per-sub-poll endpoints (vote/results/close) keep working without
    # modification. Phase 5 retires the duplicated columns.
    suggestion_deadline_value = (
        None if sub.suggestion_deadline_minutes else req.prephase_deadline
    )
    return conn.execute(
        """
        INSERT INTO polls (
            title, poll_type, options, response_deadline,
            creator_secret, creator_name,
            follow_up_to, fork_of,
            suggestion_deadline, suggestion_deadline_minutes,
            allow_pre_ranking,
            details,
            day_time_windows, duration_window,
            category, options_metadata,
            reference_latitude, reference_longitude,
            reference_location_label,
            min_responses, show_preliminary_results,
            min_availability_percent,
            is_auto_title,
            multipoll_id, sub_poll_index,
            created_at, updated_at
        )
        VALUES (
            %(title)s, %(poll_type)s, %(options)s::jsonb, %(response_deadline)s,
            %(creator_secret)s, %(creator_name)s,
            %(follow_up_to)s, %(fork_of)s,
            %(suggestion_deadline)s, %(suggestion_deadline_minutes)s,
            %(allow_pre_ranking)s,
            %(details)s,
            %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
            %(category)s, %(options_metadata)s::jsonb,
            %(reference_latitude)s, %(reference_longitude)s,
            %(reference_location_label)s,
            %(min_responses)s, %(show_preliminary_results)s,
            %(min_availability_percent)s,
            %(is_auto_title)s,
            %(multipoll_id)s, %(sub_poll_index)s,
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "title": title,
            "poll_type": sub.poll_type.value,
            "options": _json_or_none(sub.options),
            "response_deadline": req.response_deadline,
            "creator_secret": req.creator_secret,
            "creator_name": req.creator_name,
            # Mirror the request's poll-id refs onto the polls row so legacy
            # thread aggregation keeps walking until Phase 5 (see
            # CreateMultipollRequest docstring for the full semantics).
            "follow_up_to": req.follow_up_to,
            "fork_of": req.fork_of,
            "suggestion_deadline": suggestion_deadline_value,
            "suggestion_deadline_minutes": sub.suggestion_deadline_minutes,
            "allow_pre_ranking": sub.allow_pre_ranking,
            "details": sub.context,
            "day_time_windows": _json_or_none(sub.day_time_windows),
            "duration_window": _json_or_none(sub.duration_window),
            "category": sub.category or "custom",
            "options_metadata": _json_or_none(sub.options_metadata),
            "reference_latitude": sub.reference_latitude,
            "reference_longitude": sub.reference_longitude,
            "reference_location_label": sub.reference_location_label,
            "min_responses": sub.min_responses,
            "show_preliminary_results": sub.show_preliminary_results,
            "min_availability_percent": (
                sub.min_availability_percent if sub.poll_type == PollType.time else None
            ),
            "is_auto_title": sub.is_auto_title,
            "multipoll_id": str(multipoll_row["id"]),
            "sub_poll_index": sub_poll_index,
            "now": now,
        },
    ).fetchone()


def _compute_display_title(row: dict, sub_poll_rows: list[dict]) -> str:
    override = row.get("thread_title")
    if override:
        return override
    categories = [sp.get("category") or sp.get("poll_type") or "" for sp in sub_poll_rows]
    return generate_multipoll_title(categories, row.get("context"))


def _row_to_multipoll(
    row: dict,
    sub_poll_rows: list[dict],
    voter_names: list[str] | None = None,
    anonymous_count: int = 0,
) -> MultipollResponse:
    return MultipollResponse(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        creator_secret=row.get("creator_secret"),
        creator_name=row.get("creator_name"),
        response_deadline=_iso_or_none(row.get("response_deadline")),
        prephase_deadline=_iso_or_none(row.get("prephase_deadline")),
        prephase_deadline_minutes=row.get("prephase_deadline_minutes"),
        is_closed=row.get("is_closed", False),
        close_reason=row.get("close_reason"),
        follow_up_to=str(row["follow_up_to"]) if row.get("follow_up_to") else None,
        fork_of=str(row["fork_of"]) if row.get("fork_of") else None,
        thread_title=row.get("thread_title"),
        context=row.get("context"),
        title=_compute_display_title(row, sub_poll_rows),
        created_at=_iso_or_none(row["created_at"]) or "",
        updated_at=_iso_or_none(row["updated_at"]) or "",
        sub_polls=[_row_to_poll(sp) for sp in sub_poll_rows],
        voter_names=voter_names or [],
        anonymous_count=anonymous_count,
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


def _compute_multipoll_voter_data(conn, multipoll_id: str) -> tuple[list[str], int]:
    """Multipoll-level voter aggregation. Per the addressability
    paradigm, the FE never sums per-sub-poll vote rows — it consumes these
    server-computed fields instead. Named voters are deduped (case-sensitive,
    matching the per-poll `voter_names` aggregation in get_accessible_polls);
    anon count is `MAX(per-sub-poll anon)` — assumes anon people typically
    participate in each sibling, which is closer to reality than `SUM`."""
    row = conn.execute(
        """
        WITH all_votes AS (
            SELECT v.poll_id, v.voter_name
            FROM votes v
            JOIN polls p ON v.poll_id = p.id
            WHERE p.multipoll_id = %(mid)s
        ),
        anon_per_poll AS (
            SELECT poll_id, COUNT(*) AS c
            FROM all_votes
            WHERE voter_name IS NULL OR voter_name = ''
            GROUP BY poll_id
        )
        SELECT
            COALESCE(
                (SELECT array_agg(DISTINCT voter_name ORDER BY voter_name)
                 FROM all_votes
                 WHERE voter_name IS NOT NULL AND voter_name != ''),
                ARRAY[]::text[]
            ) AS voter_names,
            COALESCE((SELECT MAX(c) FROM anon_per_poll), 0) AS anonymous_count
        """,
        {"mid": multipoll_id},
    ).fetchone()
    return list(row["voter_names"] or []), int(row["anonymous_count"] or 0)


@router.post("", response_model=MultipollResponse, status_code=201)
def create_multipoll(req: CreateMultipollRequest):
    _validate_request(req)

    # polls.title is NOT NULL, so each sub-poll row needs a value even though
    # display goes through the multipoll's computed title.
    sub_poll_title = (
        req.title
        or req.thread_title
        or generate_multipoll_title(_categories_for_title(req.sub_polls), req.context)
    )

    now = datetime.now(timezone.utc)

    with get_db() as conn:
        multipoll_row = _insert_multipoll(conn, req, now)
        sub_poll_rows = [
            _insert_sub_poll(conn, multipoll_row, req, sub, index, sub_poll_title, now)
            for index, sub in enumerate(req.sub_polls)
        ]

    # Newly-created multipoll has no votes yet — skip the voter aggregation.
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
        voter_names, anonymous_count = _compute_multipoll_voter_data(conn, str(row["id"]))
    return _row_to_multipoll(row, sub_poll_rows, voter_names, anonymous_count)


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
        voter_names, anonymous_count = _compute_multipoll_voter_data(conn, str(row["id"]))
    return _row_to_multipoll(row, sub_poll_rows, voter_names, anonymous_count)


# ---------------------------------------------------------------------------
# Multipoll-level operations (Phase 3)
#
# These mirror the per-poll close/reopen/cutoff endpoints but operate on the
# multipoll wrapper + every sub-poll atomically. Authorization is gated on
# multipolls.creator_secret; sub-poll secrets match because they were copied at
# creation time. After Phase 5 the wrapper-level fields will be the sole source
# of truth, but until then we maintain both copies so legacy per-poll readers
# (results, votes) keep working unchanged.
# ---------------------------------------------------------------------------


def _authorize_multipoll(conn, multipoll_id: str, creator_secret: str) -> dict:
    row = conn.execute(
        "SELECT * FROM multipolls WHERE id = %(id)s",
        {"id": multipoll_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Multipoll not found")
    if row.get("creator_secret") != creator_secret:
        raise HTTPException(status_code=403, detail="Invalid creator secret")
    return dict(row)


@router.post("/{multipoll_id}/close", response_model=MultipollResponse)
def close_multipoll(multipoll_id: str, req: ClosePollRequest):
    """Close a multipoll. Closes the wrapper + every sub-poll atomically.

    For each ranked_choice sub-poll mid-suggestion-phase, finalizes its options
    so results are computable immediately (mirrors the per-poll close flow).
    """
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        _authorize_multipoll(conn, multipoll_id, req.creator_secret)
        conn.execute(
            """
            UPDATE multipolls
            SET is_closed = true,
                close_reason = %(close_reason)s,
                updated_at = %(now)s
            WHERE id = %(multipoll_id)s
            """,
            {
                "multipoll_id": multipoll_id,
                "close_reason": req.close_reason.value,
                "now": now,
            },
        )
        sub_poll_rows = conn.execute(
            """
            UPDATE polls
            SET is_closed = true,
                close_reason = %(close_reason)s,
                updated_at = %(now)s
            WHERE multipoll_id = %(multipoll_id)s
            RETURNING *
            """,
            {
                "multipoll_id": multipoll_id,
                "close_reason": req.close_reason.value,
                "now": now,
            },
        ).fetchall()

        for sp in sub_poll_rows:
            sp_dict = dict(sp)
            if sp_dict["poll_type"] == "ranked_choice" and sp_dict.get("suggestion_deadline"):
                _finalize_suggestion_options(conn, str(sp_dict["id"]), now)

        # Re-read to reflect any finalize_suggestion_options writes.
        multipoll_row = conn.execute(
            "SELECT * FROM multipolls WHERE id = %(id)s",
            {"id": multipoll_id},
        ).fetchone()
        sub_poll_rows = _fetch_sub_polls(conn, multipoll_id)
        voter_names, anonymous_count = _compute_multipoll_voter_data(conn, multipoll_id)

    return _row_to_multipoll(multipoll_row, sub_poll_rows, voter_names, anonymous_count)


@router.post("/{multipoll_id}/reopen", response_model=MultipollResponse)
def reopen_multipoll(multipoll_id: str, req: ReopenPollRequest):
    """Reopen a closed multipoll + every sub-poll atomically."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        _authorize_multipoll(conn, multipoll_id, req.creator_secret)
        conn.execute(
            """
            UPDATE multipolls
            SET is_closed = false,
                close_reason = NULL,
                updated_at = %(now)s
            WHERE id = %(multipoll_id)s
            """,
            {"multipoll_id": multipoll_id, "now": now},
        )
        conn.execute(
            """
            UPDATE polls
            SET is_closed = false,
                close_reason = NULL,
                updated_at = %(now)s
            WHERE multipoll_id = %(multipoll_id)s
            """,
            {"multipoll_id": multipoll_id, "now": now},
        )
        multipoll_row = conn.execute(
            "SELECT * FROM multipolls WHERE id = %(id)s",
            {"id": multipoll_id},
        ).fetchone()
        sub_poll_rows = _fetch_sub_polls(conn, multipoll_id)
        voter_names, anonymous_count = _compute_multipoll_voter_data(conn, multipoll_id)

    return _row_to_multipoll(multipoll_row, sub_poll_rows, voter_names, anonymous_count)


@router.post("/{multipoll_id}/cutoff-suggestions", response_model=MultipollResponse)
def cutoff_multipoll_suggestions(multipoll_id: str, req: CutoffSuggestionsRequest):
    """End the suggestion phase across every sub-poll that's still in it.

    Unlike the per-poll endpoint, this is a no-op-ok operation: sub-polls not
    in a suggestion phase are simply skipped, and we don't 400 if nobody has
    submitted suggestions yet (the multipoll wrapper has multiple sub-polls,
    most of which never had a suggestion phase). Returns 400 only if NO
    sub-poll's suggestion phase advanced.
    """
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        _authorize_multipoll(conn, multipoll_id, req.creator_secret)
        advanced = conn.execute(
            """
            UPDATE polls
            SET suggestion_deadline = %(now)s,
                updated_at = %(now)s
            WHERE multipoll_id = %(multipoll_id)s
              AND poll_type = 'ranked_choice'
              AND (
                (suggestion_deadline IS NOT NULL AND suggestion_deadline > %(now)s)
                OR (suggestion_deadline IS NULL AND suggestion_deadline_minutes IS NOT NULL)
              )
              AND EXISTS (
                SELECT 1 FROM votes
                WHERE votes.poll_id = polls.id
                  AND suggestions IS NOT NULL
                  AND array_length(suggestions, 1) > 0
              )
            RETURNING id
            """,
            {"multipoll_id": multipoll_id, "now": now},
        ).fetchall()
        if not advanced:
            raise HTTPException(
                status_code=400,
                detail="No sub-poll suggestion phase to cut off",
            )
        for row in advanced:
            _finalize_suggestion_options(conn, str(row["id"]), now)

        multipoll_row = conn.execute(
            "SELECT * FROM multipolls WHERE id = %(id)s",
            {"id": multipoll_id},
        ).fetchone()
        sub_poll_rows = _fetch_sub_polls(conn, multipoll_id)
        voter_names, anonymous_count = _compute_multipoll_voter_data(conn, multipoll_id)

    return _row_to_multipoll(multipoll_row, sub_poll_rows, voter_names, anonymous_count)


def _vote_item_to_submit_req(item: MultipollVoteItem, voter_name: str | None) -> SubmitVoteRequest:
    return SubmitVoteRequest(
        vote_type=item.vote_type,
        yes_no_choice=item.yes_no_choice,
        ranked_choices=item.ranked_choices,
        ranked_choice_tiers=item.ranked_choice_tiers,
        suggestions=item.suggestions,
        is_abstain=item.is_abstain,
        is_ranking_abstain=item.is_ranking_abstain,
        voter_name=voter_name,
        voter_day_time_windows=item.voter_day_time_windows,
        voter_duration=item.voter_duration,
        options_metadata=item.options_metadata,
        liked_slots=item.liked_slots,
        disliked_slots=item.disliked_slots,
    )


def _vote_item_to_edit_req(item: MultipollVoteItem, voter_name: str | None) -> EditVoteRequest:
    return EditVoteRequest(
        yes_no_choice=item.yes_no_choice,
        ranked_choices=item.ranked_choices,
        ranked_choice_tiers=item.ranked_choice_tiers,
        suggestions=item.suggestions,
        is_abstain=item.is_abstain,
        is_ranking_abstain=item.is_ranking_abstain,
        voter_name=voter_name,
        voter_day_time_windows=item.voter_day_time_windows,
        voter_duration=item.voter_duration,
        liked_slots=item.liked_slots,
        disliked_slots=item.disliked_slots,
    )


@router.post(
    "/{multipoll_id}/votes",
    response_model=list[VoteResponse],
    status_code=201,
)
def submit_multipoll_votes(multipoll_id: str, req: SubmitMultipollVotesRequest):
    """Atomic batch vote across multiple sub-polls of one multipoll.

    Each `items[i]` either inserts a new vote (vote_id null) or updates an
    existing one (vote_id set) on `items[i].sub_poll_id`. Per the addressability
    paradigm, this is the multipoll-level entry point — clients should prefer
    it over per-sub-poll calls when the user submits votes across siblings in
    one action. Validation, finalization, and auto-close run per-sub-poll
    inside the same transaction; any failure rolls back every item.

    voter_name is multipoll-level: one voter, many sub-poll ballots.
    """
    now = datetime.now(timezone.utc)

    sub_poll_ids = [item.sub_poll_id for item in req.items]
    if len(set(sub_poll_ids)) != len(sub_poll_ids):
        raise HTTPException(
            status_code=400,
            detail="Each sub_poll_id may appear at most once per request",
        )

    with get_db() as conn:
        multipoll_row = conn.execute(
            "SELECT id, is_closed FROM multipolls WHERE id = %(id)s",
            {"id": multipoll_id},
        ).fetchone()
        if not multipoll_row:
            raise HTTPException(status_code=404, detail="Multipoll not found")
        if multipoll_row.get("is_closed"):
            raise HTTPException(status_code=400, detail="Multipoll is closed")

        owned = conn.execute(
            """
            SELECT id FROM polls
            WHERE multipoll_id = %(mid)s
              AND id::text = ANY(%(ids)s)
            """,
            {"mid": multipoll_id, "ids": sub_poll_ids},
        ).fetchall()
        owned_ids = {str(r["id"]) for r in owned}
        for sub_poll_id in sub_poll_ids:
            if sub_poll_id not in owned_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sub-poll {sub_poll_id} does not belong to this multipoll",
                )

        result_rows: list[dict] = []
        for item in req.items:
            if item.vote_id:
                row = _edit_vote_on_poll(
                    conn,
                    item.sub_poll_id,
                    item.vote_id,
                    _vote_item_to_edit_req(item, req.voter_name),
                    now,
                )
            else:
                row = _submit_vote_to_poll(
                    conn,
                    item.sub_poll_id,
                    _vote_item_to_submit_req(item, req.voter_name),
                    now,
                )
            result_rows.append(row)

    return [_row_to_vote(r) for r in result_rows]


@router.post("/{multipoll_id}/cutoff-availability", response_model=MultipollResponse)
def cutoff_multipoll_availability(multipoll_id: str, req: CutoffSuggestionsRequest):
    """End the availability phase of the multipoll's time sub-poll (≤1 enforced
    on create). Mirrors the per-poll endpoint's preconditions."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        _authorize_multipoll(conn, multipoll_id, req.creator_secret)
        advanced = conn.execute(
            """
            UPDATE polls
            SET suggestion_deadline = %(now)s,
                updated_at = %(now)s
            WHERE multipoll_id = %(multipoll_id)s
              AND poll_type = 'time'
              AND (
                (suggestion_deadline IS NOT NULL AND suggestion_deadline > %(now)s)
                OR (suggestion_deadline IS NULL AND suggestion_deadline_minutes IS NOT NULL)
              )
              AND EXISTS (
                SELECT 1 FROM votes
                WHERE votes.poll_id = polls.id
                  AND voter_day_time_windows IS NOT NULL
              )
            RETURNING id
            """,
            {"multipoll_id": multipoll_id, "now": now},
        ).fetchall()
        if not advanced:
            raise HTTPException(
                status_code=400,
                detail="No availability phase to cut off",
            )
        for row in advanced:
            _finalize_time_slots(conn, str(row["id"]), now)

        multipoll_row = conn.execute(
            "SELECT * FROM multipolls WHERE id = %(id)s",
            {"id": multipoll_id},
        ).fetchone()
        sub_poll_rows = _fetch_sub_polls(conn, multipoll_id)
        voter_names, anonymous_count = _compute_multipoll_voter_data(conn, multipoll_id)

    return _row_to_multipoll(multipoll_row, sub_poll_rows, voter_names, anonymous_count)
