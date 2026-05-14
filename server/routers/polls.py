"""Poll API endpoints. See docs/poll-phasing.md."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from algorithms.poll_title import generate_poll_title
from database import get_db
from middleware import browser_id_from_request as _browser_id
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
    VoteResponse,
)
from services.memberships import join_group, join_group_for_poll
from services.push import fan_out_new_poll
from services.questions import (
    _edit_vote_on_question,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _json_or_none,
    _row_to_question,
    _row_to_vote,
    _submit_vote_to_question,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/polls", tags=["polls"])


# Phase B.4: every SELECT that feeds `_row_to_poll` must surface
# `groups.short_id` as `group_short_id` so the FE can build
# `/g/<group.short_id>` URLs without a second round-trip. Migration 105
# moved `group_title` to `groups.title`, so the same JOIN is the source
# of truth for the group-name override too. Centralizing the JOIN here
# keeps the SELECTs in routers/polls.py and services/groups.py in
# lockstep — adding another field from the groups table only requires
# extending this string.
_SELECT_POLLS_WITH_GROUP = (
    "SELECT polls.*, "
    "t.short_id AS group_short_id, "
    "t.title AS group_title, "
    "t.image_updated_at AS group_image_updated_at "
    "FROM polls LEFT JOIN groups t ON polls.group_id = t.id"
)


def _categories_for_title(questions: list[CreateQuestionRequest]) -> list[str]:
    return [sp.category or sp.question_type.value for sp in questions]


def _contexts_for_title(questions: list[CreateQuestionRequest]) -> list[str | None]:
    return [sp.context for sp in questions]


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


def _resolve_or_create_group(
    conn,
    requested_group_id: str | None,
    initial_title: str | None,
) -> str:
    """Resolve `req.group_id` to an existing group, or mint a fresh one.

    Migration 105 retired `polls.follow_up_to` so the new-poll path no
    longer walks parent → child relationships. A group is just a uuid
    that polls share via `polls.group_id`. When `requested_group_id`
    points at a real group, return it; otherwise create a new group
    (optionally with `title` set on creation so first-poll-with-name
    flows are a single transaction).

    Unknown / malformed group ids fall through to "mint a fresh group"
    rather than 404 — the request still succeeds, it just lands in a new
    group instead of the one the caller named. That's the same fallback
    `_resolve_or_create_group_id` had for missing parents.
    """
    if requested_group_id:
        existing = conn.execute(
            "SELECT id FROM groups WHERE id = %(id)s",
            {"id": requested_group_id},
        ).fetchone()
        if existing:
            if initial_title is not None:
                conn.execute(
                    "UPDATE groups SET title = %(title)s WHERE id = %(id)s",
                    {"id": requested_group_id, "title": initial_title},
                )
            return str(existing["id"])
        logger.warning(
            "create_poll: requested group_id=%s not found; minting a fresh group",
            requested_group_id,
        )
    row = conn.execute(
        "INSERT INTO groups (title) VALUES (%(title)s) RETURNING id",
        {"title": initial_title},
    ).fetchone()
    return str(row["id"])


def _attach_group_fields(conn, row) -> dict:
    """Enrich a polls row dict with `group_short_id` and `group_title`.

    INSERT/UPDATE `RETURNING *` paths only see polls.* columns, not the
    joined groups fields surfaced by `_SELECT_POLLS_WITH_GROUP`. After
    a write, look up the group row by `group_id` so the resulting row
    dict matches the SELECT shape `_row_to_poll` expects.
    """
    out = dict(row)
    if out.get("group_id") and not (
        out.get("group_short_id")
        and "group_title" in out
        and "group_image_updated_at" in out
    ):
        t = conn.execute(
            "SELECT short_id, title, image_updated_at FROM groups WHERE id = %(id)s",
            {"id": out["group_id"]},
        ).fetchone()
        if t:
            out.setdefault("group_short_id", t.get("short_id"))
            out.setdefault("group_title", t.get("title"))
            out.setdefault("group_image_updated_at", t.get("image_updated_at"))
    return out


def _insert_poll(conn, req: CreatePollRequest, now: datetime) -> dict:
    """Insert a new poll under the requested (or freshly-minted) group.

    Migration 105 dropped `polls.follow_up_to` and `polls.group_title`:
    groups are first-class entities (one row in `groups`), and the
    group name override lives on `groups.title` rather than being
    duplicated across every poll.
    """
    # `req.group_title` only seeds the title when minting a fresh group.
    # For existing groups, it overwrites the title — kept for API symmetry
    # but the FE create flow doesn't pass it; group renames go through
    # `POST /api/groups/{route_id}/title` instead.
    group_id = _resolve_or_create_group(
        conn, req.group_id, req.group_title
    )
    row = conn.execute(
        """
        INSERT INTO polls (
            creator_secret, creator_name, response_deadline,
            prephase_deadline, prephase_deadline_minutes,
            context, details,
            min_responses, show_preliminary_results, allow_pre_ranking,
            group_id,
            created_at, updated_at
        )
        VALUES (
            %(creator_secret)s, %(creator_name)s, %(response_deadline)s,
            %(prephase_deadline)s, %(prephase_deadline_minutes)s,
            %(context)s, %(details)s,
            %(min_responses)s, %(show_preliminary_results)s, %(allow_pre_ranking)s,
            %(group_id)s,
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
            "context": req.context,
            "details": req.details,
            "min_responses": req.min_responses,
            "show_preliminary_results": req.show_preliminary_results,
            "allow_pre_ranking": req.allow_pre_ranking,
            "group_id": group_id,
            "now": now,
        },
    ).fetchone()
    return _attach_group_fields(conn, row)


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
    # response_deadline, follow_up_to, group_title, is_closed, close_reason,
    # short_id, suggestion_deadline) live exclusively on the poll wrapper.
    # Sub-question rows carry only per-question fields.
    return conn.execute(
        """
        INSERT INTO questions (
            title, question_type, options,
            suggestion_deadline_minutes,
            details,
            day_time_windows, duration_window,
            category, options_metadata,
            reference_latitude, reference_longitude,
            reference_location_label,
            min_availability_percent,
            is_auto_title,
            poll_id, question_index,
            created_at, updated_at
        )
        VALUES (
            %(title)s, %(question_type)s, %(options)s::jsonb,
            %(suggestion_deadline_minutes)s,
            %(details)s,
            %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
            %(category)s, %(options_metadata)s::jsonb,
            %(reference_latitude)s, %(reference_longitude)s,
            %(reference_location_label)s,
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
            "details": sub.context,
            "day_time_windows": _json_or_none(sub.day_time_windows),
            "duration_window": _json_or_none(sub.duration_window),
            "category": sub.category or "custom",
            "options_metadata": _json_or_none(sub.options_metadata),
            "reference_latitude": sub.reference_latitude,
            "reference_longitude": sub.reference_longitude,
            "reference_location_label": sub.reference_location_label,
            "min_availability_percent": (
                sub.min_availability_percent if sub.question_type == QuestionType.time else None
            ),
            "is_auto_title": sub.is_auto_title,
            "poll_id": str(poll_row["id"]),
            "question_index": question_index,
            "now": now,
        },
    ).fetchone()


def _category_for_title(question_row: dict) -> str:
    """The "category" string to feed into `generate_poll_title` for one
    question row. Time questions always resolve to `"time"` regardless of
    the stored `category` column, since picking the "When" bubble in the
    create-poll UI sets `question_type=time` but leaves `category="custom"`
    (the form's default). The user model treats time AS the category, so
    a time question titled "Time for Movie" must not become
    "Custom for Movie" when the poll-level title is regenerated."""
    if question_row.get("question_type") == "time":
        return "time"
    return question_row.get("category") or question_row.get("question_type") or ""


def _compute_display_title(row: dict, question_rows: list[dict]) -> str:
    override = row.get("group_title")
    if override:
        return override
    # Every question shares the wrapper-level `question_title` resolved by
    # `create_poll` (user-typed yes_no prompt OR `req.group_title` OR the
    # auto-generated multi-question title), so reading questions[0].title
    # gives us the user's intended poll title without conflating with the
    # `group_title` group-name override.
    if question_rows:
        primary = (question_rows[0].get("title") or "").strip()
        if primary:
            return primary
    categories = [_category_for_title(sp) for sp in question_rows]
    # Per-question context lives in `questions.details` (see _insert_question
    # below). Pass it through so the auto-title can reflect a shared context
    # like "Restaurant, Movie for Tonight" when none is set on the wrapper.
    contexts = [sp.get("details") for sp in question_rows]
    return generate_poll_title(categories, row.get("context"), contexts)


def _row_to_poll(
    row: dict,
    question_rows: list[dict],
    voter_names: list[str] | None = None,
    anonymous_count: int = 0,
) -> PollResponse:
    return PollResponse(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        group_id=str(row["group_id"]) if row.get("group_id") else None,
        group_short_id=row.get("group_short_id"),
        creator_secret=row.get("creator_secret"),
        creator_name=row.get("creator_name"),
        response_deadline=_iso_or_none(row.get("response_deadline")),
        prephase_deadline=_iso_or_none(row.get("prephase_deadline")),
        prephase_deadline_minutes=row.get("prephase_deadline_minutes"),
        is_closed=row.get("is_closed", False),
        close_reason=row.get("close_reason"),
        group_title=row.get("group_title"),
        group_image_updated_at=_iso_or_none(row.get("group_image_updated_at")),
        context=row.get("context"),
        details=row.get("details"),
        title=_compute_display_title(row, question_rows),
        created_at=_iso_or_none(row["created_at"]) or "",
        updated_at=_iso_or_none(row["updated_at"]) or "",
        min_responses=row.get("min_responses"),
        show_preliminary_results=row.get("show_preliminary_results", True),
        allow_pre_ranking=row.get("allow_pre_ranking", True),
        questions=[_row_to_question(sp) for sp in question_rows],
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
def create_poll(
    req: CreatePollRequest, request: Request, background_tasks: BackgroundTasks
):
    _validate_request(req)

    # questions.title is NOT NULL, so each question row needs a value even though
    # display goes through the poll's computed title.
    question_title = (
        req.title
        or req.group_title
        or generate_poll_title(
            _categories_for_title(req.questions),
            req.context,
            _contexts_for_title(req.questions),
        )
    )

    now = datetime.now(timezone.utc)

    with get_db() as conn:
        poll_row = _insert_poll(conn, req, now)
        question_rows = [
            _insert_question(conn, poll_row, req, sub, index, question_title, now)
            for index, sub in enumerate(req.questions)
        ]

    creator_browser_id = _browser_id(request)
    group_id = str(poll_row["group_id"]) if poll_row.get("group_id") else None

    # Phase C.2: creator auto-joins the group. Runs after the create
    # commits — root polls' group_id only exists post-`_insert_poll`.
    join_group(group_id, creator_browser_id)

    # Fan-out "new poll" push notifications to other group members whose
    # preference is on (default ON, missing-row-is-on). Decoupled from
    # the create response: BackgroundTasks runs after the response is
    # serialized + sent so a slow push service can't block the user.
    if group_id:
        # Build the notification payload from the freshly-created poll.
        # Prefer the explicit title; fall back to the auto-generated one
        # already computed above.
        poll_title = poll_row.get("title") or question_title or "New poll"
        group_route_id = poll_row.get("group_short_id") or group_id
        background_tasks.add_task(
            fan_out_new_poll,
            group_id,
            creator_browser_id,
            {
                "title": "New poll",
                "body": poll_title,
                "url": f"/g/{group_route_id}?p={poll_row.get('short_id') or ''}",
                "group_id": group_route_id,
                "tag": f"new-poll-{poll_row.get('id')}",
            },
        )

    # Newly-created poll has no votes yet — skip the voter aggregation.
    return _row_to_poll(poll_row, question_rows)


@router.get("/by-id/{poll_id}", response_model=PollResponse)
def get_poll_by_id(poll_id: str):
    with get_db() as conn:
        row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
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
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.short_id = %(short_id)s",
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
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
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
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
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
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
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
def submit_poll_votes(poll_id: str, req: SubmitPollVotesRequest, request: Request):
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

    # Phase C.2: group join runs BEFORE the vote in its own transaction so
    # "attempted to participate" is the membership trigger — a vote that
    # fails validation still leaves the user as a group member.
    join_group_for_poll(poll_id, _browser_id(request))

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
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_names, anonymous_count = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_names, anonymous_count)


