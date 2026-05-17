"""Question API endpoints."""

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException

from database import get_db
from models import (
    AccessibleQuestionsRequest,
    PollResponse,
    QuestionResponse,
    QuestionResultsResponse,
    RelatedQuestionsRequest,
    RelatedQuestionsResponse,
    VoteResponse,
)
from algorithms.related_polls import QuestionRelation, get_all_related_question_ids
from services.questions import (
    _SELECT_QUESTION_FULL,
    _compute_results,
    _fetch_question_full,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _row_to_question,
    _row_to_vote,
)
from services.groups import polls_for_poll_ids, require_uuid

router = APIRouter(prefix="/api/questions", tags=["questions"])


# --- Question CRUD ---
# Phase 5: the legacy `POST /api/questions` create endpoint is gone — every question is
# now created through `POST /api/polls` (one question wrapped in a 1-sub-
# question poll for the simple case).


@router.get("/dev/all-ids")
def get_all_question_ids():
    """Return all question IDs in the database. Only available in dev environments."""
    if os.environ.get("DISABLE_RATE_LIMIT") != "1":
        raise HTTPException(status_code=404, detail="Not found")
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id FROM questions ORDER BY created_at DESC"
        ).fetchall()
    return {"question_ids": [row["id"] for row in rows]}


@router.get("/find-duplicate", response_model=QuestionResponse)
def find_duplicate_question(title: str, group_id: str):
    """Find an existing question under the same group as `group_id` with
    the same title (case-insensitive). Used by the create-poll flow to
    short-circuit accidental duplicates when the user types a title that
    already exists in the group they're posting into.

    Migration 105 retired `polls.follow_up_to` so the legacy "walk the
    parent question's chain" approach is gone — this is now a flat
    `WHERE mp.group_id = ?` lookup.
    """
    with get_db() as conn:
        row = conn.execute(
            _SELECT_QUESTION_FULL
            + """
            WHERE LOWER(p.title) = LOWER(%(title)s)
              AND mp.group_id = %(group_id)s::uuid
            ORDER BY p.created_at ASC
            LIMIT 1
            """,
            {"title": title, "group_id": group_id},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No duplicate question found")
    return _row_to_question(row)


@router.get("/by-short-id/{short_id}", response_model=QuestionResponse)
def get_question_by_short_id(short_id: str):
    """Get a question by its (wrapper's) short ID."""
    with get_db() as conn:
        row = conn.execute(
            _SELECT_QUESTION_FULL + " WHERE mp.short_id = %(short_id)s ORDER BY p.question_index NULLS LAST LIMIT 1",
            {"short_id": short_id},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    return _row_to_question(row)


@router.get("/{question_id}", response_model=QuestionResponse)
def get_question(question_id: str):
    """Get a question by UUID."""
    require_uuid(question_id, "question_id")
    with get_db() as conn:
        row = _fetch_question_full(conn, question_id)
        if not row:
            raise HTTPException(status_code=404, detail="Question not found")

        # Auto-finalize options when suggestion deadline has passed but options not yet set
        if (
            row.get("suggestion_deadline")
            and not row.get("options")
            and not row.get("is_closed")
            and datetime.now(timezone.utc) >= row["suggestion_deadline"]
        ):
            _finalize_suggestion_options(conn, question_id, datetime.now(timezone.utc))
            # Re-fetch to get updated options
            row = _fetch_question_full(conn, question_id)

        question_resp = _row_to_question(row)
        # Include response count for open questions (used for min_responses threshold)
        if not row.get("is_closed", False):
            count = conn.execute(
                "SELECT COUNT(*) as cnt FROM votes WHERE question_id = %(question_id)s",
                {"question_id": question_id},
            ).fetchone()["cnt"]
            question_resp.response_count = count
    return question_resp


@router.get("/{question_id}/votes", response_model=list[VoteResponse])
def get_votes(question_id: str):
    """Get all votes for a question."""
    require_uuid(question_id, "question_id")
    with get_db() as conn:
        # Verify question exists
        question = conn.execute(
            "SELECT id FROM questions WHERE id = %(question_id)s",
            {"question_id": question_id},
        ).fetchone()
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")

        rows = conn.execute(
            "SELECT * FROM votes WHERE question_id = %(question_id)s ORDER BY created_at",
            {"question_id": question_id},
        ).fetchall()
    return [_row_to_vote(r) for r in rows]


# --- Results ---


@router.get("/{question_id}/results", response_model=QuestionResultsResponse)
def get_results(question_id: str):
    """Compute and return question results."""
    require_uuid(question_id, "question_id")
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        question = _fetch_question_full(conn, question_id)
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")

        # For ranked_choice questions with suggestion phase: finalize options when
        # suggestion_deadline passes (populate options from collected suggestions)
        if (
            question["question_type"] == "ranked_choice"
            and question.get("suggestion_deadline")
            and not question["is_closed"]
            and question["suggestion_deadline"] <= now
            and not question.get("options")  # Not yet finalized
        ):
            _finalize_suggestion_options(conn, question_id, now)
            question = _fetch_question_full(conn, question_id)

        # For time questions: finalize time slot options when availability deadline passes
        if (
            question["question_type"] == "time"
            and question.get("suggestion_deadline")
            and question["suggestion_deadline"] <= now
            and not question.get("options")  # Not yet finalized
        ):
            _finalize_time_slots(conn, question_id, now)
            question = _fetch_question_full(conn, question_id)

        votes = conn.execute(
            "SELECT * FROM votes WHERE question_id = %(question_id)s",
            {"question_id": question_id},
        ).fetchall()

    return _compute_results(question, votes)


# --- Question management ---
# Phase 5: per-question close/reopen/cutoff-suggestions/cutoff-availability and
# group-title endpoints all removed — these are poll-level concerns and
# now live exclusively under `/api/polls/{id}/...`.


# --- Accessible questions ---


@router.post("/accessible", response_model=list[PollResponse])
def get_accessible_questions(req: AccessibleQuestionsRequest):
    """Return the poll wrappers covering the user's accessible question IDs.

    Phase 5b: returns `PollResponse[]` instead of flat `QuestionResponse[]`.
    Per the addressability paradigm, the poll is the unit of identity —
    the FE consumes wrapper-level fields (response_deadline, is_closed, etc.)
    from the poll and per-question fields from each `question`.

    Each requested question_id resolves to its poll; we return one
    PollResponse per unique poll covered, including ALL questions
    of that poll (siblings of any requested question). Inline `results` are
    populated on each question using the same gating as the per-question /results
    endpoint (closed questions always; open questions when show_preliminary_results
    is true and min_responses is unset-or-met).

    Phase B.3: aggregation logic moved to `services.groups.polls_for_poll_ids`
    so `/api/groups/*` can build identical payloads from a group-id-driven
    poll set. This endpoint stays as a same-shape compatibility surface.
    """
    if not req.question_ids:
        return []
    with get_db() as conn:
        mp_id_rows = conn.execute(
            """SELECT DISTINCT poll_id
                 FROM questions
                WHERE id = ANY(%(ids)s) AND poll_id IS NOT NULL""",
            {"ids": req.question_ids},
        ).fetchall()
        poll_ids = [str(r["poll_id"]) for r in mp_id_rows]
        return polls_for_poll_ids(conn, poll_ids, include_results=req.include_results)


@router.post("/related", response_model=RelatedQuestionsResponse)
def get_related_questions(req: RelatedQuestionsRequest):
    """Discover all questions related to the input IDs via follow-up chains."""
    if not req.question_ids:
        return RelatedQuestionsResponse(
            all_related_ids=[], original_count=0, discovered_count=0
        )
    with get_db() as conn:
        # Phase B.2: group membership is materialized as `polls.group_id`.
        # Fetch every question whose group matches any input's group —
        # one indexed lookup, no chain walking.
        rows = conn.execute(
            """SELECT p.id, mp.group_id
                 FROM questions p
                 JOIN polls mp ON p.poll_id = mp.id
                WHERE mp.group_id IN (
                          SELECT mp2.group_id
                            FROM questions p2
                            JOIN polls mp2 ON p2.poll_id = mp2.id
                           WHERE p2.id = ANY(%(question_ids)s)
                             AND mp2.group_id IS NOT NULL
                      )
                   OR p.id = ANY(%(question_ids)s)""",
            {"question_ids": req.question_ids},
        ).fetchall()

    all_questions = [
        QuestionRelation(
            id=str(r["id"]),
            group_id=str(r["group_id"]) if r.get("group_id") else None,
        )
        for r in rows
    ]
    related_ids = get_all_related_question_ids(req.question_ids, all_questions)
    return RelatedQuestionsResponse(
        all_related_ids=related_ids,
        original_count=len(req.question_ids),
        discovered_count=len(related_ids),
    )


