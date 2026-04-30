"""Shared question helpers used by the questions and polls routers.

Pulled out of `routers/questions.py` so the routing layer is mostly endpoint
declarations and the data-massaging / vote-write / results-computation logic
lives in one place. Both `routers.questions` and `routers.polls` import from
here; nothing here depends on the router modules, so there are no circular
imports.
"""

import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from models import (
    EditVoteRequest,
    QuestionResponse,
    QuestionResultsResponse,
    RankedChoiceRoundResponse,
    SubmitVoteRequest,
    VoteResponse,
)
from algorithms.suggestion import count_suggestion_votes
from algorithms.ranked_choice import calculate_ranked_choice_winner
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.yes_no import count_yes_no_votes


# Phase 5b: wrapper-level fields are no longer surfaced on QuestionResponse.
# `_row_to_question` ignores them when building the response. Internal logic
# (vote submission, results computation, finalization) still needs to read
# these from the wrapper, so the JOIN here aliases the same names — callers
# operate on the joined dict in-memory and the response shape is filtered by
# `_row_to_question`. The FE-only `poll_follow_up_to` is the chain pointer
# used for thread building.
_SELECT_QUESTION_FULL = """
    SELECT p.*,
           mp.short_id AS short_id,
           mp.creator_secret AS creator_secret,
           mp.creator_name AS creator_name,
           mp.response_deadline AS response_deadline,
           mp.is_closed AS is_closed,
           mp.close_reason AS close_reason,
           mp.thread_title AS thread_title,
           mp.prephase_deadline AS suggestion_deadline,
           mp.follow_up_to AS poll_follow_up_to,
           mp.min_responses AS min_responses,
           mp.show_preliminary_results AS show_preliminary_results,
           mp.allow_pre_ranking AS allow_pre_ranking
      FROM questions p
      LEFT JOIN polls mp ON p.poll_id = mp.id
"""


def _fetch_question_full(conn, question_id: str) -> dict | None:
    """Fetch a question plus its wrapper-level fields (joined from polls)
    for internal consumption. The fields aren't surfaced in QuestionResponse but
    are needed by results computation, vote validation, and finalization."""
    return conn.execute(
        _SELECT_QUESTION_FULL + " WHERE p.id = %(question_id)s",
        {"question_id": question_id},
    ).fetchone()


def _attach_wrapper_fields(conn, row) -> dict | None:
    """Annotate a RETURNING * row from questions with wrapper-level fields fetched
    from the parent poll. Use after UPDATE/INSERT on the questions table when
    the response goes back through `_row_to_question`. Phase 5b: only
    `poll_follow_up_to` is surfaced on QuestionResponse, but the other fields
    are still attached here so internal post-write logic that reads
    `row["is_closed"]` etc. keeps working."""
    if row is None:
        return None
    row = dict(row)
    poll_id = row.get("poll_id")
    if not poll_id:
        for key in (
            "short_id",
            "creator_secret",
            "creator_name",
            "response_deadline",
            "is_closed",
            "close_reason",
            "thread_title",
            "suggestion_deadline",
            "poll_follow_up_to",
            "min_responses",
            "show_preliminary_results",
            "allow_pre_ranking",
        ):
            row.setdefault(key, None)
        return row
    mp_row = conn.execute(
        """
        SELECT short_id, creator_secret, creator_name, response_deadline,
               is_closed, close_reason, thread_title, prephase_deadline,
               follow_up_to, min_responses, show_preliminary_results,
               allow_pre_ranking
          FROM polls WHERE id = %(id)s
        """,
        {"id": str(poll_id)},
    ).fetchone()
    if mp_row:
        row["short_id"] = mp_row["short_id"]
        row["creator_secret"] = mp_row["creator_secret"]
        row["creator_name"] = mp_row["creator_name"]
        row["response_deadline"] = mp_row["response_deadline"]
        row["is_closed"] = mp_row["is_closed"]
        row["close_reason"] = mp_row["close_reason"]
        row["thread_title"] = mp_row["thread_title"]
        row["suggestion_deadline"] = mp_row["prephase_deadline"]
        row["poll_follow_up_to"] = (
            str(mp_row["follow_up_to"]) if mp_row.get("follow_up_to") else None
        )
        row["min_responses"] = mp_row["min_responses"]
        row["show_preliminary_results"] = mp_row["show_preliminary_results"]
        row["allow_pre_ranking"] = mp_row["allow_pre_ranking"]
    return row


def _check_auto_close(conn, question_id: str) -> None:
    """Auto-close the parent poll when this question's respondent count
    reaches its auto_close_after threshold. Closes ALL questions of the
    poll via the wrapper's is_closed. Auto-close is per-question today
    only because the threshold lives on questions; the wrapper-level close is the
    natural unit after Phase 5."""
    question = conn.execute(
        """SELECT p.auto_close_after, p.poll_id, mp.is_closed
             FROM questions p
             LEFT JOIN polls mp ON p.poll_id = mp.id
            WHERE p.id = %(question_id)s""",
        {"question_id": question_id},
    ).fetchone()
    if not question or question["auto_close_after"] is None:
        return
    if question.get("is_closed") or not question.get("poll_id"):
        return

    respondent_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM votes WHERE question_id = %(question_id)s",
        {"question_id": question_id},
    ).fetchone()["cnt"]
    if respondent_count >= question["auto_close_after"]:
        conn.execute(
            "UPDATE polls SET is_closed = true, close_reason = 'max_capacity', updated_at = NOW() WHERE id = %(mp_id)s",
            {"mp_id": str(question["poll_id"])},
        )


def _finalize_suggestion_options(conn, question_id: str, now: datetime) -> None:
    """Finalize options for a ranked_choice question after its suggestion_deadline passes.

    Collects all unique suggestions from votes and writes them to the question's options column.
    """
    votes = conn.execute(
        "SELECT suggestions FROM votes WHERE question_id = %(question_id)s AND suggestions IS NOT NULL",
        {"question_id": question_id},
    ).fetchall()

    all_suggestions: list[str] = []
    seen: set[str] = set()
    for v in votes:
        for sug in (v["suggestions"] or []):
            lower = sug.strip().lower()
            if lower and lower not in seen:
                seen.add(lower)
                all_suggestions.append(sug.strip())

    if all_suggestions:
        conn.execute(
            """UPDATE questions SET options = %(options)s::jsonb, updated_at = %(now)s
               WHERE id = %(question_id)s""",
            {
                "options": json.dumps(all_suggestions),
                "now": now,
                "question_id": question_id,
            },
        )


def _finalize_time_slots(conn, question_id: str, now: datetime) -> None:
    """Finalize time slots for a time question after its availability deadline passes.

    Generates all candidate time slots from the question's day_time_windows + duration_window,
    then applies the availability threshold filter and longest-per-start-time dedup so
    question.options contains only the slots voters will actually rank.
    """
    from algorithms.time_question import (
        generate_time_question_slots,
        compute_slot_availability,
        filter_slots_by_min_availability,
        _keep_longest_per_start_time,
    )

    question = _fetch_question_full(conn, question_id)
    if not question or question.get("options"):
        return  # Already finalized or missing

    votes = conn.execute(
        "SELECT voter_day_time_windows, voter_duration FROM votes WHERE question_id = %(question_id)s",
        {"question_id": question_id},
    ).fetchall()
    votes_list = [dict(v) for v in votes]

    all_slots = generate_time_question_slots(dict(question), votes_list)

    availability_counts = compute_slot_availability(all_slots, votes_list)
    slots = filter_slots_by_min_availability(
        all_slots,
        availability_counts,
        question.get("min_availability_percent") or 95,
    )

    # Keep only the longest-duration slot per start time
    slots = _keep_longest_per_start_time(slots)

    if slots:
        conn.execute(
            """UPDATE questions SET options = %(options)s::jsonb, updated_at = %(now)s
               WHERE id = %(question_id)s""",
            {
                "options": json.dumps(slots),
                "now": now,
                "question_id": question_id,
            },
        )


def _row_to_question(row: dict) -> QuestionResponse:
    """Convert a database row to a QuestionResponse.

    Phase 5b: wrapper-level fields (response_deadline, creator_secret,
    creator_name, is_closed, close_reason, short_id, thread_title,
    suggestion_deadline) are no longer surfaced on QuestionResponse — the FE
    sources them from the parent Poll. Use `_SELECT_QUESTION_FULL` (or
    `_attach_wrapper_fields` for RETURNING * paths) to populate
    `poll_follow_up_to` on the row dict before calling here, since
    that's the only wrapper field we still expose."""
    return QuestionResponse(
        id=str(row["id"]),
        title=row["title"],
        question_type=row["question_type"],
        options=row.get("options"),
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
        suggestion_deadline_minutes=row.get("suggestion_deadline_minutes"),
        auto_close_after=row.get("auto_close_after"),
        details=row.get("details"),
        day_time_windows=row.get("day_time_windows"),
        duration_window=row.get("duration_window"),
        category=row.get("category"),
        options_metadata=row.get("options_metadata"),
        reference_latitude=row.get("reference_latitude"),
        reference_longitude=row.get("reference_longitude"),
        reference_location_label=row.get("reference_location_label"),
        is_auto_title=row.get("is_auto_title", False),
        min_availability_percent=row.get("min_availability_percent"),
        poll_id=str(row["poll_id"]) if row.get("poll_id") else None,
        question_index=row.get("question_index"),
        poll_follow_up_to=(
            str(row["poll_follow_up_to"])
            if row.get("poll_follow_up_to")
            else None
        ),
    )


def _row_to_vote(row: dict) -> VoteResponse:
    """Convert a database row to a VoteResponse."""
    return VoteResponse(
        id=str(row["id"]),
        question_id=str(row["question_id"]),
        vote_type=row["vote_type"],
        yes_no_choice=row.get("yes_no_choice"),
        ranked_choices=row.get("ranked_choices"),
        ranked_choice_tiers=row.get("ranked_choice_tiers"),
        suggestions=row.get("suggestions"),
        is_abstain=row.get("is_abstain", False),
        is_ranking_abstain=row.get("is_ranking_abstain", False),
        voter_name=row.get("voter_name"),
        voter_day_time_windows=row.get("voter_day_time_windows"),
        voter_duration=row.get("voter_duration"),
        liked_slots=row.get("liked_slots"),
        disliked_slots=row.get("disliked_slots"),
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
    )


def _enforce_suggestion_phase_timing(question: dict, suggestions, ranked_choices) -> bool:
    """Validate that the request's suggestions/ranked_choices respect the question's
    suggestion-phase cutoff. Raises HTTPException(400) on violation. Returns
    `has_suggestion_phase` for downstream use by `validate_vote()`.
    """
    has_suggestion_phase = (
        question.get("suggestion_deadline") is not None
        or question.get("suggestion_deadline_minutes") is not None
    )
    if has_suggestion_phase and question.get("suggestion_deadline"):
        in_suggestion_phase = datetime.now(timezone.utc) < question["suggestion_deadline"]

        # Reject new suggestions after cutoff
        if not in_suggestion_phase and suggestions:
            raise HTTPException(status_code=400, detail="Suggestions cutoff has passed")

        # For time questions: reject ranked_choices while still in availability phase
        # (slots aren't finalized yet, so rankings can't be submitted)
        if question["question_type"] == "time" and in_suggestion_phase and ranked_choices:
            raise HTTPException(status_code=400, detail="Rankings not allowed until availability phase has closed")

        # Reject rankings before cutoff if pre-ranking is disabled (ranked_choice questions)
        if question["question_type"] != "time" and in_suggestion_phase and ranked_choices and not question["allow_pre_ranking"]:
            raise HTTPException(status_code=400, detail="Rankings not allowed until suggestions cutoff")

    return has_suggestion_phase


def _submit_vote_to_question(conn, question_id: str, req: SubmitVoteRequest, now: datetime) -> dict:
    """Insert a vote row inside an existing transaction. Shared by the per-question
    `submit_vote` endpoint and the poll batch-vote endpoint. Returns the
    inserted row. Raises HTTPException on validation failures."""
    question = conn.execute(
        """SELECT p.id, p.question_type, p.poll_id, p.suggestion_deadline_minutes,
                  mp.allow_pre_ranking,
                  mp.is_closed, mp.prephase_deadline AS suggestion_deadline,
                  mp.response_deadline
             FROM questions p
             LEFT JOIN polls mp ON p.poll_id = mp.id
            WHERE p.id = %(question_id)s""",
        {"question_id": question_id},
    ).fetchone()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    if question["is_closed"]:
        raise HTTPException(status_code=400, detail="Question is closed")

    has_deferred_deadline = (
        question.get("suggestion_deadline_minutes")
        and not question.get("suggestion_deadline")
        and (
            req.suggestions
            or (question["question_type"] == "time" and req.voter_day_time_windows)
        )
    )
    if has_deferred_deadline:
        new_deadline = now + timedelta(minutes=question["suggestion_deadline_minutes"])
        if question.get("response_deadline"):
            response_dt = question["response_deadline"]
            if not response_dt.tzinfo:
                response_dt = response_dt.replace(tzinfo=timezone.utc)
            if new_deadline >= response_dt:
                new_deadline = response_dt - timedelta(minutes=1)
        # Phase 5: write to the poll wrapper's prephase_deadline
        # (formerly `questions.suggestion_deadline`).
        if question.get("poll_id"):
            conn.execute(
                "UPDATE polls SET prephase_deadline = %(deadline)s, updated_at = %(now)s WHERE id = %(mp_id)s",
                {"deadline": new_deadline, "now": now, "mp_id": str(question["poll_id"])},
            )
        question = dict(question)
        question["suggestion_deadline"] = new_deadline

    has_suggestion_phase = _enforce_suggestion_phase_timing(
        question, req.suggestions, req.ranked_choices
    )

    try:
        validate_vote(
            question_type=question["question_type"],
            vote_type=req.vote_type,
            yes_no_choice=req.yes_no_choice,
            ranked_choices=req.ranked_choices,
            ranked_choice_tiers=req.ranked_choice_tiers,
            suggestions=req.suggestions,
            is_abstain=req.is_abstain,
            is_ranking_abstain=req.is_ranking_abstain,
            has_suggestion_phase=has_suggestion_phase,
        )
    except VoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    row = conn.execute(
        """
        INSERT INTO votes (question_id, vote_type, yes_no_choice, ranked_choices,
                           ranked_choice_tiers,
                           suggestions, is_abstain, is_ranking_abstain, voter_name,
                           voter_day_time_windows, voter_duration,
                           liked_slots, disliked_slots,
                           created_at, updated_at)
        VALUES (%(question_id)s, %(vote_type)s, %(yes_no_choice)s, %(ranked_choices)s,
                %(ranked_choice_tiers)s::jsonb,
                %(suggestions)s, %(is_abstain)s, %(is_ranking_abstain)s, %(voter_name)s,
                %(voter_day_time_windows)s::jsonb, %(voter_duration)s::jsonb,
                %(liked_slots)s::jsonb, %(disliked_slots)s::jsonb,
                %(now)s, %(now)s)
        RETURNING *
        """,
        {
            "question_id": question_id,
            "vote_type": req.vote_type,
            "yes_no_choice": req.yes_no_choice,
            "ranked_choices": req.ranked_choices,
            "ranked_choice_tiers": json.dumps(req.ranked_choice_tiers) if req.ranked_choice_tiers is not None else None,
            "suggestions": req.suggestions,
            "is_abstain": req.is_abstain,
            "is_ranking_abstain": req.is_ranking_abstain,
            "voter_name": req.voter_name,
            "voter_day_time_windows": json.dumps(req.voter_day_time_windows) if req.voter_day_time_windows else None,
            "voter_duration": json.dumps(req.voter_duration) if req.voter_duration else None,
            "liked_slots": json.dumps(req.liked_slots) if req.liked_slots is not None else None,
            "disliked_slots": json.dumps(req.disliked_slots) if req.disliked_slots is not None else None,
            "now": now,
        },
    ).fetchone()

    if req.options_metadata and req.suggestions:
        conn.execute(
            """
            UPDATE questions
            SET options_metadata = COALESCE(options_metadata, '{}'::jsonb) || %(new_metadata)s::jsonb
            WHERE id = %(question_id)s
            """,
            {
                "question_id": question_id,
                "new_metadata": json.dumps(req.options_metadata),
            },
        )

    _check_auto_close(conn, question_id)
    return row


def _edit_vote_on_question(conn, question_id: str, vote_id: str, req: EditVoteRequest, now: datetime) -> dict:
    """Update a vote row inside an existing transaction. Shared by the per-question
    `edit_vote` endpoint and the poll batch-vote endpoint. Returns the
    updated row. Raises HTTPException on validation failures."""
    existing = conn.execute(
        "SELECT id FROM votes WHERE id = %(vote_id)s AND question_id = %(question_id)s",
        {"vote_id": vote_id, "question_id": question_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Vote not found")

    question = conn.execute(
        """SELECT p.question_type, p.suggestion_deadline_minutes,
                  mp.allow_pre_ranking,
                  mp.is_closed, mp.prephase_deadline AS suggestion_deadline
             FROM questions p
             LEFT JOIN polls mp ON p.poll_id = mp.id
            WHERE p.id = %(question_id)s""",
        {"question_id": question_id},
    ).fetchone()
    if question and question["is_closed"]:
        raise HTTPException(status_code=400, detail="Question is closed")

    has_suggestion_phase = _enforce_suggestion_phase_timing(
        question, req.suggestions, req.ranked_choices
    )
    if has_suggestion_phase and question.get("suggestion_deadline"):
        in_suggestion_phase = datetime.now(timezone.utc) < question["suggestion_deadline"]

        if in_suggestion_phase and req.suggestions is not None:
            old_vote = conn.execute(
                "SELECT suggestions FROM votes WHERE id = %(vote_id)s",
                {"vote_id": vote_id},
            ).fetchone()
            if old_vote and old_vote["suggestions"]:
                removed = set(old_vote["suggestions"]) - set(req.suggestions)
                if removed:
                    ranked_by_others = conn.execute(
                        """SELECT DISTINCT unnest(ranked_choices) as opt
                           FROM votes
                           WHERE question_id = %(question_id)s
                             AND id != %(vote_id)s
                             AND ranked_choices IS NOT NULL""",
                        {"question_id": question_id, "vote_id": vote_id},
                    ).fetchall()
                    ranked_set = {r["opt"] for r in ranked_by_others}
                    blocked = removed & ranked_set
                    if blocked:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Cannot remove suggestions that others have ranked: {', '.join(sorted(blocked))}",
                        )

    row = conn.execute(
        """
        UPDATE votes
        SET yes_no_choice = %(yes_no_choice)s,
            ranked_choices = %(ranked_choices)s,
            ranked_choice_tiers = %(ranked_choice_tiers)s::jsonb,
            suggestions = COALESCE(%(suggestions)s, suggestions),
            is_abstain = %(is_abstain)s,
            is_ranking_abstain = %(is_ranking_abstain)s,
            voter_name = %(voter_name)s,
            voter_day_time_windows = %(voter_day_time_windows)s::jsonb,
            voter_duration = %(voter_duration)s::jsonb,
            liked_slots = COALESCE(%(liked_slots)s::jsonb, liked_slots),
            disliked_slots = COALESCE(%(disliked_slots)s::jsonb, disliked_slots),
            updated_at = %(now)s
        WHERE id = %(vote_id)s AND question_id = %(question_id)s
        RETURNING *
        """,
        {
            "yes_no_choice": req.yes_no_choice,
            "ranked_choices": req.ranked_choices,
            "ranked_choice_tiers": json.dumps(req.ranked_choice_tiers) if req.ranked_choice_tiers is not None else None,
            "suggestions": req.suggestions,
            "is_abstain": req.is_abstain,
            "is_ranking_abstain": req.is_ranking_abstain,
            "voter_name": req.voter_name,
            "voter_day_time_windows": json.dumps(req.voter_day_time_windows) if req.voter_day_time_windows else None,
            "voter_duration": json.dumps(req.voter_duration) if req.voter_duration else None,
            "liked_slots": json.dumps(req.liked_slots) if req.liked_slots is not None else None,
            "disliked_slots": json.dumps(req.disliked_slots) if req.disliked_slots is not None else None,
            "now": now,
            "vote_id": vote_id,
            "question_id": question_id,
        },
    ).fetchone()
    _check_auto_close(conn, question_id)
    return row


def _compute_results(question, votes) -> QuestionResultsResponse:
    """Compute question results from a question row and its votes. Shared by get_results and get_accessible_questions."""
    question_type = question["question_type"]

    if question_type == "yes_no":
        result = count_yes_no_votes(votes)
        return QuestionResultsResponse(
            question_id=str(question["id"]),
            title=question["title"],
            question_type=question_type,
            created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
            response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
            options=question.get("options"),
            yes_count=result.yes_count,
            no_count=result.no_count,
            abstain_count=result.abstain_count,
            total_votes=result.total_votes,
            yes_percentage=result.yes_percentage,
            no_percentage=result.no_percentage,
            winner=result.winner,
        )

    if question_type == "ranked_choice":
        raw_options = question.get("options")
        question_options = None
        if raw_options:
            question_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        has_suggestion_phase = question.get("suggestion_deadline") is not None

        # Compute suggestion counts if this question has a suggestion phase
        suggestion_counts_data = None
        if has_suggestion_phase:
            sug_result = count_suggestion_votes(votes, question_options=question_options)
            suggestion_counts_data = [
                {"option": sc.option, "count": sc.count}
                for sc in sug_result.suggestion_counts
            ]
            # During suggestion phase (options not yet finalized), derive options from suggestions
            if not question_options and suggestion_counts_data:
                question_options = [sc["option"] for sc in suggestion_counts_data]

        # Uncontested: single option wins automatically
        if question.get("close_reason") == "uncontested" and question_options and len(question_options) == 1:
            return QuestionResultsResponse(
                question_id=str(question["id"]),
                title=question["title"],
                question_type=question_type,
                created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
                response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
                options=question_options,
                total_votes=0,
                winner=question_options[0],
                ranked_choice_winner=question_options[0],
                ranked_choice_rounds=[RankedChoiceRoundResponse(
                    round_number=1,
                    option_name=question_options[0],
                    vote_count=0,
                    is_eliminated=False,
                    borda_score=0.0,
                    tie_broken_by_borda=False,
                )],
                suggestion_counts=suggestion_counts_data,
            )

        # Only compute ranked choice results if there are options to rank.
        # A vote counts as having rankings if it has either a flat list or a
        # tiered ballot.
        rc_rounds = []
        rc_winner = None
        ranking_votes = [
            v for v in votes
            if v.get("ranked_choices") or v.get("ranked_choice_tiers")
        ]
        if question_options and len(question_options) >= 2 and ranking_votes:
            result = calculate_ranked_choice_winner(ranking_votes, question_options)
            rc_winner = result.winner

            for round_idx, round_entries in enumerate(result.rounds):
                for entry in round_entries:
                    rc_rounds.append(RankedChoiceRoundResponse(
                        round_number=round_idx + 1,
                        option_name=entry.option_name,
                        vote_count=entry.vote_count,
                        is_eliminated=entry.is_eliminated,
                        borda_score=entry.borda_score,
                        tie_broken_by_borda=entry.tie_broken_by_borda,
                    ))

        return QuestionResultsResponse(
            question_id=str(question["id"]),
            title=question["title"],
            question_type=question_type,
            created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
            response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
            options=question_options,
            total_votes=len(votes),
            winner=rc_winner,
            ranked_choice_winner=rc_winner,
            ranked_choice_rounds=rc_rounds if rc_rounds else None,
            suggestion_counts=suggestion_counts_data,
        )

    if question_type == "time":
        from algorithms.time_question import calculate_time_question_results

        raw_options = question.get("options")
        question_options = None
        if raw_options:
            question_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        vote_dicts = [dict(v) for v in votes]
        time_result = calculate_time_question_results(dict(question), vote_dicts)

        return QuestionResultsResponse(
            question_id=str(question["id"]),
            title=question["title"],
            question_type=question_type,
            created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
            response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
            options=question_options,
            total_votes=len(votes),
            winner=time_result["winner"],
            availability_counts=time_result["availability_counts"],
            max_availability=time_result["max_availability"],
            like_counts=time_result["like_counts"],
            dislike_counts=time_result["dislike_counts"],
        )

    # Fallback for any unhandled question type — should be unreachable post-migration.
    return QuestionResultsResponse(
        question_id=str(question["id"]),
        title=question["title"],
        question_type=question_type,
        created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
        response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
        options=question.get("options"),
        total_votes=len(votes),
    )


def _json_or_none(val) -> str | None:
    """Serialize a JSON-compatible value for a JSONB column, or None."""
    if val is None:
        return None
    return json.dumps(val)
