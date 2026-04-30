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
def find_duplicate_question(title: str, follow_up_to: str):
    """Find an existing question under the same poll-level chain as
    `follow_up_to` (a question id) with the same title (case-insensitive).

    Phase 5: walks poll-level chains. The candidate question's wrapper
    must have `follow_up_to` equal to the input question's wrapper id. (The
    legacy implementation queried `questions.follow_up_to` directly; that column
    no longer exists.)
    """
    with get_db() as conn:
        row = conn.execute(
            _SELECT_QUESTION_FULL
            + """
            WHERE LOWER(p.title) = LOWER(%(title)s)
              AND mp.follow_up_to = (
                SELECT poll_id FROM questions WHERE id = %(follow_up_to)s
              )
            ORDER BY p.created_at ASC
            LIMIT 1
            """,
            {"title": title, "follow_up_to": follow_up_to},
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
# thread-title endpoints all removed — these are poll-level concerns and
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
    """
    # Local import keeps this file from growing a circular dep with polls.py.
    from routers.polls import (
        _compute_poll_voter_data,
        _row_to_poll,
    )

    if not req.question_ids:
        return []
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Resolve requested question_ids → unique poll_ids. Questions without a
        # poll_id are skipped (post-Phase-4 there shouldn't be any).
        mp_id_rows = conn.execute(
            """SELECT DISTINCT poll_id
                 FROM questions
                WHERE id = ANY(%(ids)s) AND poll_id IS NOT NULL""",
            {"ids": req.question_ids},
        ).fetchall()
        poll_ids = [str(r["poll_id"]) for r in mp_id_rows]
        if not poll_ids:
            return []

        # Fetch every poll wrapper.
        poll_rows = conn.execute(
            """SELECT * FROM polls
                WHERE id = ANY(%(ids)s)
                ORDER BY created_at DESC""",
            {"ids": poll_ids},
        ).fetchall()

        # Fetch every question of these polls in one query, preserving
        # creator-intended order.
        question_rows = conn.execute(
            """SELECT * FROM questions
                WHERE poll_id = ANY(%(ids)s)
                ORDER BY poll_id, question_index NULLS LAST, created_at""",
            {"ids": poll_ids},
        ).fetchall()
        questions_by_mp: dict[str, list] = {}
        for sp in question_rows:
            questions_by_mp.setdefault(str(sp["poll_id"]), []).append(sp)
        all_question_ids = [str(sp["id"]) for sp in question_rows]

        # Inline-results gating mirrors the previous per-question behavior. A
        # question's `is_closed` / `response_deadline` come from its wrapper.
        wrappers_by_id = {str(mp["id"]): mp for mp in poll_rows}
        closed_question_ids: list[str] = []
        open_question_ids: list[str] = []
        for sp in question_rows:
            mp = wrappers_by_id.get(str(sp["poll_id"]))
            is_closed = bool(mp and mp.get("is_closed"))
            deadline = mp.get("response_deadline") if mp else None
            deadline_passed = bool(deadline and deadline <= now)
            (closed_question_ids if (is_closed or deadline_passed) else open_question_ids).append(str(sp["id"]))

        votes_by_question: dict[str, list] = {pid: [] for pid in closed_question_ids}
        if closed_question_ids:
            vote_rows = conn.execute(
                "SELECT * FROM votes WHERE question_id = ANY(%(question_ids)s)",
                {"question_ids": closed_question_ids},
            ).fetchall()
            for v in vote_rows:
                pid = str(v["question_id"])
                if pid in votes_by_question:
                    votes_by_question[pid].append(v)

        response_counts: dict[str, int] = {}
        if open_question_ids:
            count_rows = conn.execute(
                "SELECT question_id, COUNT(*) as cnt FROM votes WHERE question_id = ANY(%(question_ids)s) GROUP BY question_id",
                {"question_ids": open_question_ids},
            ).fetchall()
            for cr in count_rows:
                response_counts[str(cr["question_id"])] = cr["cnt"]

        question_rows_by_id = {str(sp["id"]): sp for sp in question_rows}
        preliminary_question_ids: list[str] = []
        for pid in open_question_ids:
            sp = question_rows_by_id[pid]
            mp = wrappers_by_id.get(str(sp["poll_id"]))
            # Migration 098: these settings live on the poll wrapper now.
            min_resp = mp.get("min_responses") if mp else None
            show_prelim = mp.get("show_preliminary_results", True) if mp else True
            if show_prelim and (min_resp is None or response_counts.get(pid, 0) >= min_resp):
                preliminary_question_ids.append(pid)
        if preliminary_question_ids:
            prelim_vote_rows = conn.execute(
                "SELECT * FROM votes WHERE question_id = ANY(%(question_ids)s)",
                {"question_ids": preliminary_question_ids},
            ).fetchall()
            for v in prelim_vote_rows:
                pid = str(v["question_id"])
                votes_by_question.setdefault(pid, []).append(v)

        # Per-question voter_names (kept on QuestionResponse for per-card respondent
        # rows). Reuse vote rows we already fetched to avoid a second pass.
        voter_names_by_question: dict[str, list[str]] = {}
        for pid, votes in votes_by_question.items():
            names = sorted({
                v["voter_name"] for v in votes
                if v.get("voter_name") and v["voter_name"] != ""
            })
            if names:
                voter_names_by_question[pid] = names
        remaining_question_ids = [pid for pid in all_question_ids if pid not in votes_by_question]
        if remaining_question_ids:
            vn_rows = conn.execute(
                """SELECT question_id, array_agg(DISTINCT voter_name ORDER BY voter_name) as names
                     FROM votes
                    WHERE question_id = ANY(%(question_ids)s)
                      AND voter_name IS NOT NULL AND voter_name != ''
                    GROUP BY question_id""",
                {"question_ids": remaining_question_ids},
            ).fetchall()
            for vn in vn_rows:
                voter_names_by_question[str(vn["question_id"])] = vn["names"]

        # Poll-level voter aggregates. _compute_poll_voter_data
        # issues one query per poll; for the typical user with <100
        # accessible polls this is fine, and matching the existing
        # /api/polls/by-id/{id} behavior keeps the aggregation logic
        # in one place.
        voter_data_by_mp: dict[str, tuple[list[str], int]] = {}
        for mp_id in poll_ids:
            voter_data_by_mp[mp_id] = _compute_poll_voter_data(conn, mp_id)

    # Build the response. Inline results / response_count / per-question
    # voter_names are attached to each QuestionResponse after _row_to_poll
    # builds it.
    responses: list[PollResponse] = []
    for mp_row in poll_rows:
        mp_id = str(mp_row["id"])
        sp_rows = questions_by_mp.get(mp_id, [])
        voter_names, anon_count = voter_data_by_mp.get(mp_id, ([], 0))
        mp_resp = _row_to_poll(mp_row, sp_rows, voter_names, anon_count)
        if req.include_results:
            for sp_resp in mp_resp.questions:
                pid = sp_resp.id
                if pid in votes_by_question:
                    sp_row = question_rows_by_id[pid]
                    # _compute_results reads wrapper-level fields off the row
                    # (response_deadline, close_reason, suggestion_deadline)
                    # so splice them in from the wrapper.
                    enriched = dict(sp_row)
                    enriched["response_deadline"] = mp_row.get("response_deadline")
                    enriched["close_reason"] = mp_row.get("close_reason")
                    enriched["is_closed"] = mp_row.get("is_closed", False)
                    enriched["suggestion_deadline"] = mp_row.get("prephase_deadline")
                    try:
                        sp_resp.results = _compute_results(enriched, votes_by_question[pid])
                    except Exception:
                        logger.warning("Failed to compute results for question %s", pid, exc_info=True)
                if pid in response_counts:
                    sp_resp.response_count = response_counts[pid]
                if pid in voter_names_by_question:
                    sp_resp.voter_names = voter_names_by_question[pid]
        responses.append(mp_resp)
    return responses


@router.post("/related", response_model=RelatedQuestionsResponse)
def get_related_questions(req: RelatedQuestionsRequest):
    """Discover all questions related to the input IDs via follow-up chains."""
    if not req.question_ids:
        return RelatedQuestionsResponse(
            all_related_ids=[], original_count=0, discovered_count=0
        )
    with get_db() as conn:
        # Fetch every question plus its poll's follow_up_to (Phase 3.5 source
        # of truth for thread chains). The discovery walks poll-level
        # chains via mp.follow_up_to + poll-sibling grouping; per-question
        # follow_up_to is no longer consulted for chain traversal.
        rows = conn.execute(
            """SELECT p.id, p.poll_id,
                      mp.follow_up_to AS poll_follow_up_to
                 FROM questions p
                 LEFT JOIN polls mp ON p.poll_id = mp.id
                WHERE mp.follow_up_to IS NOT NULL
                   OR p.poll_id IS NOT NULL
                   OR p.id = ANY(%(question_ids)s)""",
            {"question_ids": req.question_ids},
        ).fetchall()

    all_questions = [
        QuestionRelation(
            id=str(r["id"]),
            poll_id=str(r["poll_id"]) if r.get("poll_id") else None,
            poll_follow_up_to=(
                str(r["poll_follow_up_to"])
                if r.get("poll_follow_up_to")
                else None
            ),
        )
        for r in rows
    ]
    related_ids = get_all_related_question_ids(req.question_ids, all_questions)
    return RelatedQuestionsResponse(
        all_related_ids=related_ids,
        original_count=len(req.question_ids),
        discovered_count=len(related_ids),
    )


