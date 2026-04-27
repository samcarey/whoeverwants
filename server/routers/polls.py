"""Poll API endpoints. See docs/poll-phasing.md."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from algorithms.poll_title import generate_poll_title
from database import get_db
from models import (
    CloseQuestionRequest,
    CreatePollRequest,
    CreateQuestionRequest,
    CutoffSuggestionsRequest,
    EditVoteRequest,
    PollResponse,
    PollVoteItem,
    QuestionType,
    ReopenQuestionRequest,
    SubmitPollVotesRequest,
    SubmitVoteRequest,
    UpdateThreadTitleRequest,
    VoteResponse,
)
from services.questions import (
    _edit_vote_on_question,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _json_or_none,
    _row_to_question,
    _row_to_vote,
    _submit_vote_to_question,
)

router = APIRouter(prefix="/api/polls", tags=["polls"])


def _categories_for_title(questions: list[CreateQuestionRequest]) -> list[str]:
    return [sp.category or sp.question_type.value for sp in questions]


def _iso_or_none(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _validate_request(req: CreatePollRequest) -> None:
    if not req.questions:
        raise HTTPException(status_code=400, detail="At least one question is required")

    time_count = sum(1 for sp in req.questions if sp.question_type == QuestionType.time)
    if time_count > 1:
        raise HTTPException(
            status_code=400,
            detail="A poll can contain at most one time question",
        )

    seen: dict[tuple[str, str | None], list[str | None]] = {}
    for sp in req.questions:
        key = (sp.question_type.value, (sp.category or "").strip().lower() or None)
        seen.setdefault(key, []).append((sp.context or "").strip() or None)
    for contexts in seen.values():
        if len(contexts) <= 1:
            continue
        normalized = [c.lower() if c else None for c in contexts]
        if len(set(normalized)) != len(normalized):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Sub-questions of the same kind must each have a distinct "
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


def _resolve_parent_poll_id(conn, parent_question_id: str | None) -> str | None:
    """Look up a parent question_id and return its poll_id, or None if the
    parent is a legacy (pre-Phase-4) question with no wrapper. Returns None when
    the parent doesn't exist or has no poll_id."""
    if not parent_question_id:
        return None
    row = conn.execute(
        "SELECT poll_id FROM questions WHERE id = %(id)s",
        {"id": parent_question_id},
    ).fetchone()
    if not row or not row.get("poll_id"):
        return None
    return str(row["poll_id"])


def _insert_poll(conn, req: CreatePollRequest, now: datetime) -> dict:
    # follow_up_to in the request is a *question id* (matching the legacy
    # single-question create API). Resolve to the parent's poll_id for the
    # polls row. Phase 5: legacy single-question parents are gone — every
    # question has a poll wrapper — so the questions.thread_title fallback was
    # removed.
    parent_followup_poll_id = _resolve_parent_poll_id(conn, req.follow_up_to)
    explicit_title = req.title if req.title is not None else req.thread_title
    return conn.execute(
        """
        INSERT INTO polls (
            creator_secret, creator_name, response_deadline,
            prephase_deadline, prephase_deadline_minutes,
            follow_up_to, context,
            thread_title,
            created_at, updated_at
        )
        VALUES (
            %(creator_secret)s, %(creator_name)s, %(response_deadline)s,
            %(prephase_deadline)s, %(prephase_deadline_minutes)s,
            %(follow_up_poll_id)s, %(context)s,
            COALESCE(
                %(explicit_title)s,
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
            # legacy suggestion_deadline split (see CLAUDE.md "Deferred
            # Suggestion Deadline").
            "prephase_deadline": (
                None if req.prephase_deadline_minutes else req.prephase_deadline
            ),
            "prephase_deadline_minutes": req.prephase_deadline_minutes,
            "follow_up_poll_id": parent_followup_poll_id,
            "context": req.context,
            "explicit_title": explicit_title,
            "now": now,
        },
    ).fetchone()


def _insert_question(
    conn,
    poll_row: dict,
    req: CreatePollRequest,
    sub: CreateQuestionRequest,
    question_index: int,
    title: str,
    now: datetime,
) -> dict:
    # Phase 5: wrapper-level columns (creator_secret, creator_name,
    # response_deadline, follow_up_to, thread_title, is_closed, close_reason,
    # short_id, suggestion_deadline) live exclusively on the poll wrapper.
    # Sub-question rows carry only per-question fields.
    return conn.execute(
        """
        INSERT INTO questions (
            title, question_type, options,
            suggestion_deadline_minutes,
            allow_pre_ranking,
            details,
            day_time_windows, duration_window,
            category, options_metadata,
            reference_latitude, reference_longitude,
            reference_location_label,
            min_responses, show_preliminary_results,
            min_availability_percent,
            is_auto_title,
            poll_id, question_index,
            created_at, updated_at
        )
        VALUES (
            %(title)s, %(question_type)s, %(options)s::jsonb,
            %(suggestion_deadline_minutes)s,
            %(allow_pre_ranking)s,
            %(details)s,
            %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
            %(category)s, %(options_metadata)s::jsonb,
            %(reference_latitude)s, %(reference_longitude)s,
            %(reference_location_label)s,
            %(min_responses)s, %(show_preliminary_results)s,
            %(min_availability_percent)s,
            %(is_auto_title)s,
            %(poll_id)s, %(question_index)s,
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "title": title,
            "question_type": sub.question_type.value,
            "options": _json_or_none(sub.options),
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
                sub.min_availability_percent if sub.question_type == QuestionType.time else None
            ),
            "is_auto_title": sub.is_auto_title,
            "poll_id": str(poll_row["id"]),
            "question_index": question_index,
            "now": now,
        },
    ).fetchone()


def _compute_display_title(row: dict, question_rows: list[dict]) -> str:
    override = row.get("thread_title")
    if override:
        return override
    categories = [sp.get("category") or sp.get("question_type") or "" for sp in question_rows]
    return generate_poll_title(categories, row.get("context"))


def _row_to_poll(
    row: dict,
    question_rows: list[dict],
    voter_names: list[str] | None = None,
    anonymous_count: int = 0,
) -> PollResponse:
    # Phase 5b: QuestionResponse no longer carries wrapper-level fields, so we
    # only need to splice the wrapper's follow_up_to (the FE chain pointer)
    # onto each question row. The poll's own fields are surfaced on
    # PollResponse below.
    poll_follow_up_to = (
        str(row["follow_up_to"]) if row.get("follow_up_to") else None
    )
    enriched = []
    for sp in question_rows:
        enriched_sp = dict(sp)
        enriched_sp["poll_follow_up_to"] = poll_follow_up_to
        enriched.append(enriched_sp)
    return PollResponse(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        creator_secret=row.get("creator_secret"),
        creator_name=row.get("creator_name"),
        response_deadline=_iso_or_none(row.get("response_deadline")),
        prephase_deadline=_iso_or_none(row.get("prephase_deadline")),
        prephase_deadline_minutes=row.get("prephase_deadline_minutes"),
        is_closed=row.get("is_closed", False),
        close_reason=row.get("close_reason"),
        follow_up_to=poll_follow_up_to,
        thread_title=row.get("thread_title"),
        context=row.get("context"),
        title=_compute_display_title(row, question_rows),
        created_at=_iso_or_none(row["created_at"]) or "",
        updated_at=_iso_or_none(row["updated_at"]) or "",
        questions=[_row_to_question(sp) for sp in enriched],
        voter_names=voter_names or [],
        anonymous_count=anonymous_count,
    )


def _fetch_questions(conn, poll_id: str) -> list[dict]:
    return conn.execute(
        """
        SELECT * FROM questions
        WHERE poll_id = %(poll_id)s
        ORDER BY question_index NULLS LAST, created_at
        """,
        {"poll_id": poll_id},
    ).fetchall()


def _compute_poll_voter_data(conn, poll_id: str) -> tuple[list[str], int]:
    """Poll-level voter aggregation. Per the addressability
    paradigm, the FE never sums per-question vote rows — it consumes these
    server-computed fields instead. Named voters are deduped (case-sensitive,
    matching the per-question `voter_names` aggregation in get_accessible_questions);
    anon count is `MAX(per-question anon)` — assumes anon people typically
    participate in each sibling, which is closer to reality than `SUM`."""
    row = conn.execute(
        """
        WITH all_votes AS (
            SELECT v.question_id, v.voter_name
            FROM votes v
            JOIN questions p ON v.question_id = p.id
            WHERE p.poll_id = %(mid)s
        ),
        anon_per_question AS (
            SELECT question_id, COUNT(*) AS c
            FROM all_votes
            WHERE voter_name IS NULL OR voter_name = ''
            GROUP BY question_id
        )
        SELECT
            COALESCE(
                (SELECT array_agg(DISTINCT voter_name ORDER BY voter_name)
                 FROM all_votes
                 WHERE voter_name IS NOT NULL AND voter_name != ''),
                ARRAY[]::text[]
            ) AS voter_names,
            COALESCE((SELECT MAX(c) FROM anon_per_question), 0) AS anonymous_count
        """,
        {"mid": poll_id},
    ).fetchone()
    return list(row["voter_names"] or []), int(row["anonymous_count"] or 0)


@router.post("", response_model=PollResponse, status_code=201)
def create_poll(req: CreatePollRequest):
    _validate_request(req)

    # questions.title is NOT NULL, so each question row needs a value even though
    # display goes through the poll's computed title.
    question_title = (
        req.title
        or req.thread_title
        or generate_poll_title(_categories_for_title(req.questions), req.context)
    )

    now = datetime.now(timezone.utc)

    with get_db() as conn:
        poll_row = _insert_poll(conn, req, now)
        question_rows = [
            _insert_question(conn, poll_row, req, sub, index, question_title, now)
            for index, sub in enumerate(req.questions)
        ]

    # Newly-created poll has no votes yet — skip the voter aggregation.
    return _row_to_poll(poll_row, question_rows)


@router.get("/by-id/{poll_id}", response_model=PollResponse)
def get_poll_by_id(poll_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        question_rows = _fetch_questions(conn, str(row["id"]))
        voter_names, anonymous_count = _compute_poll_voter_data(conn, str(row["id"]))
    return _row_to_poll(row, question_rows, voter_names, anonymous_count)


@router.get("/{short_id}", response_model=PollResponse)
def get_poll(short_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM polls WHERE short_id = %(short_id)s",
            {"short_id": short_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        question_rows = _fetch_questions(conn, str(row["id"]))
        voter_names, anonymous_count = _compute_poll_voter_data(conn, str(row["id"]))
    return _row_to_poll(row, question_rows, voter_names, anonymous_count)


# ---------------------------------------------------------------------------
# Poll-level operations (Phase 3)
#
# These mirror the per-question close/reopen/cutoff endpoints but operate on the
# poll wrapper + every question atomically. Authorization is gated on
# polls.creator_secret; question secrets match because they were copied at
# creation time. After Phase 5 the wrapper-level fields will be the sole source
# of truth, but until then we maintain both copies so legacy per-question readers
# (results, votes) keep working unchanged.
# ---------------------------------------------------------------------------


def _authorize_poll(conn, poll_id: str, creator_secret: str) -> dict:
    row = conn.execute(
        "SELECT * FROM polls WHERE id = %(id)s",
        {"id": poll_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Poll not found")
    if row.get("creator_secret") != creator_secret:
        raise HTTPException(status_code=403, detail="Invalid creator secret")
    return dict(row)


@router.post("/{poll_id}/close", response_model=PollResponse)
def close_poll(poll_id: str, req: CloseQuestionRequest):
    """Close a poll. Phase 5: only the wrapper carries is_closed/close_reason —
    closing the wrapper closes every question automatically.

    For each ranked_choice question mid-suggestion-phase, finalizes its options
    so results are computable immediately.
    """
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, req.creator_secret)
        conn.execute(
            """
            UPDATE polls
            SET is_closed = true,
                close_reason = %(close_reason)s,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
            """,
            {
                "poll_id": poll_id,
                "close_reason": req.close_reason.value,
                "now": now,
            },
        )

        # Finalize options for any ranked_choice question still mid-suggestion-phase.
        # The wrapper's prephase_deadline (formerly questions.suggestion_deadline) is
        # the source of truth for "is this question in a suggestion phase".
        if wrapper.get("prephase_deadline"):
            question_rows = conn.execute(
                "SELECT id FROM questions WHERE poll_id = %(poll_id)s AND question_type = 'ranked_choice'",
                {"poll_id": poll_id},
            ).fetchall()
            for sp in question_rows:
                _finalize_suggestion_options(conn, str(sp["id"]), now)

        poll_row = conn.execute(
            "SELECT * FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_names, anonymous_count = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_names, anonymous_count)


@router.post("/{poll_id}/reopen", response_model=PollResponse)
def reopen_poll(poll_id: str, req: ReopenQuestionRequest):
    """Reopen a closed poll. Phase 5: only the wrapper's is_closed
    matters; questions inherit it via JOIN."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        _authorize_poll(conn, poll_id, req.creator_secret)
        conn.execute(
            """
            UPDATE polls
            SET is_closed = false,
                close_reason = NULL,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
            """,
            {"poll_id": poll_id, "now": now},
        )
        poll_row = conn.execute(
            "SELECT * FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_names, anonymous_count = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_names, anonymous_count)


@router.post("/{poll_id}/cutoff-suggestions", response_model=PollResponse)
def cutoff_poll_suggestions(poll_id: str, req: CutoffSuggestionsRequest):
    """End the suggestion phase across every question that's still in it.

    Unlike the per-question endpoint, this is a no-op-ok operation: questions not
    in a suggestion phase are simply skipped, and we don't 400 if nobody has
    submitted suggestions yet (the poll wrapper has multiple questions,
    most of which never had a suggestion phase). Returns 400 only if NO
    question's suggestion phase advanced.
    """
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, req.creator_secret)

        # Phase 5: prephase_deadline is wrapper-level. Validate that there's a
        # phase to cut off (deadline in the future or minutes-deferred), and
        # that at least one ranked_choice question has a suggestion submitted.
        deadline = wrapper.get("prephase_deadline")
        minutes = wrapper.get("prephase_deadline_minutes")
        in_phase = (deadline is not None and deadline > now) or (
            deadline is None and minutes is not None
        )
        rc_questions = conn.execute(
            """SELECT p.id
                 FROM questions p
                 JOIN votes v ON v.question_id = p.id
                WHERE p.poll_id = %(mid)s
                  AND p.question_type = 'ranked_choice'
                  AND v.suggestions IS NOT NULL
                  AND array_length(v.suggestions, 1) > 0
                GROUP BY p.id""",
            {"mid": poll_id},
        ).fetchall()
        if not in_phase or not rc_questions:
            raise HTTPException(
                status_code=400,
                detail="No question suggestion phase to cut off",
            )

        conn.execute(
            "UPDATE polls SET prephase_deadline = %(now)s, updated_at = %(now)s WHERE id = %(mid)s",
            {"mid": poll_id, "now": now},
        )
        for row in rc_questions:
            _finalize_suggestion_options(conn, str(row["id"]), now)

        poll_row = conn.execute(
            "SELECT * FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_names, anonymous_count = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_names, anonymous_count)


def _vote_item_to_submit_req(item: PollVoteItem, voter_name: str | None) -> SubmitVoteRequest:
    if not item.vote_type:
        raise HTTPException(status_code=400, detail="vote_type is required when inserting a new vote")
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


def _vote_item_to_edit_req(item: PollVoteItem, voter_name: str | None) -> EditVoteRequest:
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
    "/{poll_id}/votes",
    response_model=list[VoteResponse],
    status_code=201,
)
def submit_poll_votes(poll_id: str, req: SubmitPollVotesRequest):
    """Atomic batch vote across multiple questions of one poll.

    Each `items[i]` either inserts a new vote (vote_id null) or updates an
    existing one (vote_id set) on `items[i].question_id`. Per the addressability
    paradigm, this is the poll-level entry point — clients should prefer
    it over per-question calls when the user submits votes across siblings in
    one action. Validation, finalization, and auto-close run per-question
    inside the same transaction; any failure rolls back every item.

    voter_name is poll-level: one voter, many question ballots.
    """
    now = datetime.now(timezone.utc)

    question_ids = [item.question_id for item in req.items]
    if len(set(question_ids)) != len(question_ids):
        raise HTTPException(
            status_code=400,
            detail="Each question_id may appear at most once per request",
        )

    with get_db() as conn:
        poll_row = conn.execute(
            "SELECT id, is_closed FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        if not poll_row:
            raise HTTPException(status_code=404, detail="Poll not found")
        if poll_row.get("is_closed"):
            raise HTTPException(status_code=400, detail="Poll is closed")

        owned = conn.execute(
            """
            SELECT id FROM questions
            WHERE poll_id = %(mid)s
              AND id::text = ANY(%(ids)s)
            """,
            {"mid": poll_id, "ids": question_ids},
        ).fetchall()
        owned_ids = {str(r["id"]) for r in owned}
        for question_id in question_ids:
            if question_id not in owned_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sub-question {question_id} does not belong to this poll",
                )

        result_rows: list[dict] = []
        for item in req.items:
            if item.vote_id:
                row = _edit_vote_on_question(
                    conn,
                    item.question_id,
                    item.vote_id,
                    _vote_item_to_edit_req(item, req.voter_name),
                    now,
                )
            else:
                row = _submit_vote_to_question(
                    conn,
                    item.question_id,
                    _vote_item_to_submit_req(item, req.voter_name),
                    now,
                )
            result_rows.append(row)

    return [_row_to_vote(r) for r in result_rows]


@router.post("/{poll_id}/cutoff-availability", response_model=PollResponse)
def cutoff_poll_availability(poll_id: str, req: CutoffSuggestionsRequest):
    """End the availability phase of the poll's time question (≤1 enforced
    on create). Phase 5: prephase_deadline is wrapper-level."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, req.creator_secret)
        deadline = wrapper.get("prephase_deadline")
        minutes = wrapper.get("prephase_deadline_minutes")
        in_phase = (deadline is not None and deadline > now) or (
            deadline is None and minutes is not None
        )
        time_questions = conn.execute(
            """SELECT p.id
                 FROM questions p
                 JOIN votes v ON v.question_id = p.id
                WHERE p.poll_id = %(mid)s
                  AND p.question_type = 'time'
                  AND v.voter_day_time_windows IS NOT NULL
                GROUP BY p.id""",
            {"mid": poll_id},
        ).fetchall()
        if not in_phase or not time_questions:
            raise HTTPException(
                status_code=400,
                detail="No availability phase to cut off",
            )

        conn.execute(
            "UPDATE polls SET prephase_deadline = %(now)s, updated_at = %(now)s WHERE id = %(mid)s",
            {"mid": poll_id, "now": now},
        )
        for row in time_questions:
            _finalize_time_slots(conn, str(row["id"]), now)

        poll_row = conn.execute(
            "SELECT * FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_names, anonymous_count = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_names, anonymous_count)


@router.post("/{poll_id}/thread-title", response_model=PollResponse)
def update_poll_thread_title(poll_id: str, req: UpdateThreadTitleRequest):
    """Update (or clear) a poll's thread_title override. No auth required —
    anyone with the poll's link can rename the thread. An empty or
    whitespace-only value clears the override (stored as NULL)."""
    normalized = (req.thread_title or "").strip()
    value: str | None = normalized if normalized else None
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        row = conn.execute(
            """
            UPDATE polls
            SET thread_title = %(thread_title)s,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "thread_title": value,
                "now": now,
            },
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        question_rows = _fetch_questions(conn, poll_id)
        voter_names, anonymous_count = _compute_poll_voter_data(conn, poll_id)
    return _row_to_poll(row, question_rows, voter_names, anonymous_count)
