"""Shared question helpers used by the questions and polls routers.

Pulled out of `routers/questions.py` so the routing layer is mostly endpoint
declarations and the data-massaging / vote-write / results-computation logic
lives in one place. Both `routers.questions` and `routers.polls` import from
here; nothing here depends on the router modules, so there are no circular
imports.
"""

import json
from datetime import datetime, timezone

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
from algorithms.ranked_choice import (
    calculate_ranked_choice_winner,
    consensus_winner_from_borda,
)
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.yes_no import count_yes_no_votes


# Phase 5b: wrapper-level fields are no longer surfaced on QuestionResponse.
# `_row_to_question` ignores them when building the response. Internal logic
# (vote submission, results computation, finalization) still needs to read
# these from the wrapper, so the JOIN here aliases the same names — callers
# operate on the joined dict in-memory and the response shape is filtered by
# `_row_to_question`.
#
# Migration 105 moved `group_title` off `polls` and onto `groups.title`,
# and dropped `polls.follow_up_to` entirely (groups are flat — no chain
# pointers). `group_title` now joins from the groups row; the legacy
# `poll_follow_up_to` field is gone along with every consumer.
_SELECT_QUESTION_FULL = """
    SELECT p.*,
           mp.short_id AS short_id,
           mp.creator_name AS creator_name,
           mp.creator_user_id AS poll_creator_user_id,
           mp.response_deadline AS response_deadline,
           mp.is_closed AS is_closed,
           mp.close_reason AS close_reason,
           mp.group_id AS group_id,
           t.title AS group_title,
           mp.prephase_deadline AS suggestion_deadline,
           mp.min_responses AS min_responses,
           mp.show_preliminary_results AS show_preliminary_results,
           mp.allow_pre_ranking AS allow_pre_ranking
      FROM questions p
      LEFT JOIN polls mp ON p.poll_id = mp.id
      LEFT JOIN groups t ON mp.group_id = t.id
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
    from the parent poll (and its group). Use after UPDATE/INSERT on the
    questions table when the response goes back through `_row_to_question`.

    Phase 5b: none of these fields are surfaced on QuestionResponse, but
    they're still attached here so internal post-write logic that reads
    `row["is_closed"]` etc. keeps working. Migration 105 moves
    `group_title` off `polls` to `groups.title` and removes
    `polls.follow_up_to`, so the join now reaches all the way to groups.
    """
    if row is None:
        return None
    row = dict(row)
    poll_id = row.get("poll_id")
    if not poll_id:
        for key in (
            "short_id",
            "creator_name",
            "response_deadline",
            "is_closed",
            "close_reason",
            "group_id",
            "group_title",
            "suggestion_deadline",
            "min_responses",
            "show_preliminary_results",
            "allow_pre_ranking",
        ):
            row.setdefault(key, None)
        return row
    mp_row = conn.execute(
        """
        SELECT mp.short_id, mp.creator_name, mp.response_deadline,
               mp.is_closed, mp.close_reason, mp.group_id, t.title AS group_title,
               mp.prephase_deadline, mp.min_responses, mp.show_preliminary_results,
               mp.allow_pre_ranking
          FROM polls mp
          LEFT JOIN groups t ON mp.group_id = t.id
         WHERE mp.id = %(id)s
        """,
        {"id": str(poll_id)},
    ).fetchone()
    if mp_row:
        row["short_id"] = mp_row["short_id"]
        row["creator_name"] = mp_row["creator_name"]
        row["response_deadline"] = mp_row["response_deadline"]
        row["is_closed"] = mp_row["is_closed"]
        row["close_reason"] = mp_row["close_reason"]
        row["group_id"] = mp_row["group_id"]
        row["group_title"] = mp_row["group_title"]
        row["suggestion_deadline"] = mp_row["prephase_deadline"]
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


def _compute_candidate_time_slots(question: dict, votes: list[dict]) -> tuple[list[str], bool]:
    """Compute candidate slots for a time question without writing them to the DB.

    Shared by `_finalize_time_slots` (which persists the result to `question.options`)
    and `_compute_results` (which surfaces them as `tentative_options` during the
    availability phase when `allow_pre_ranking` is enabled, so voters can react to
    currently-viable slots before the cutoff).

    Applies the "Minimum Participants" viability gate: a slot is kept only if at
    least `time_min_participants` people are available for it, then the
    longest-duration slot per start time wins.

    Returns `(slots, has_availability)`. An empty `slots` with `has_availability`
    True means no time cleared the bar (the caller treats that as "event's off");
    empty with False means nobody submitted availability yet (no cancellation).
    """
    from algorithms.time_question import (
        generate_time_question_slots,
        compute_slot_availability,
        filter_slots_by_min_participants,
        _keep_longest_per_start_time,
    )

    all_slots = generate_time_question_slots(question, votes)

    # The viability gate only applies once people have actually submitted
    # availability. With no availability data (an availability-phase-off poll
    # finalized at create, or a phase that closed with zero submissions) every
    # slot has a count of 0, so gating would wrongly cancel everything — skip it
    # and keep all of the creator's slots.
    if not any(v.get("voter_day_time_windows") for v in votes):
        return _keep_longest_per_start_time(all_slots), False

    availability_counts = compute_slot_availability(all_slots, votes)
    slots = filter_slots_by_min_participants(
        all_slots,
        availability_counts,
        question.get("time_min_participants") or 2,
    )
    return _keep_longest_per_start_time(slots), True


def _finalize_time_slots(conn, question_id: str, now: datetime) -> None:
    """Finalize time slots for a time question after its availability deadline passes.

    Generates all candidate time slots from the question's day_time_windows + duration_window,
    applies the "Minimum Participants" viability gate + longest-per-start-time dedup, and
    writes the surviving slots to question.options. When availability was collected but no
    slot met the gate, marks the question `time_event_cancelled` ("event's off") instead.
    """
    question = _fetch_question_full(conn, question_id)
    if not question or question.get("options") or question.get("time_event_cancelled"):
        return  # Already finalized / cancelled / missing

    votes = conn.execute(
        "SELECT voter_day_time_windows, voter_duration, voter_min_participants, plus_one_names "
        "FROM votes WHERE question_id = %(question_id)s",
        {"question_id": question_id},
    ).fetchall()
    votes_list = [dict(v) for v in votes]

    slots, has_availability = _compute_candidate_time_slots(dict(question), votes_list)

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
    elif has_availability:
        # People submitted availability but no slot met the Minimum Participants
        # gate → the event is cancelled. Empty option list + the flag drive the
        # "no time works — event's off" result UI.
        conn.execute(
            """UPDATE questions
               SET options = '[]'::jsonb, time_event_cancelled = true, updated_at = %(now)s
               WHERE id = %(question_id)s""",
            {"now": now, "question_id": question_id},
        )


def _maybe_close_cancelled_event_poll(
    conn, poll_id: str, now: datetime, *, notified: bool = False
) -> bool:
    """Auto-close a poll whose ENTIRE content is a cancelled time event.

    A time question is marked `time_event_cancelled` ("event's off") by
    `_finalize_time_slots` when availability was collected but no slot met the
    Minimum Participants gate. There's nothing left to vote on, and the
    "event's off" result banner is closed-gated (`TimeResults`), so the poll
    should close so that banner surfaces.

    Scope is deliberately conservative: the poll closes ONLY when every question
    is a `time` question AND every one is cancelled. A multi-question poll that
    still has any non-time question (always votable) or any uncancelled time
    question keeps that votable work open. The most common case — a
    single-question time poll — is covered.

    Idempotent (no-op when already closed) and returns whether it closed the
    poll so callers can route the close notification instead of a "voting is
    open" transition push. Pass `notified=True` to also set `close_notified`
    when the caller fires the close push inline (the inline cutoff path); the
    cron tick leaves it False so the next pass claims + sends the close push.
    """
    rows = conn.execute(
        "SELECT question_type, time_event_cancelled FROM questions WHERE poll_id = %(pid)s",
        {"pid": poll_id},
    ).fetchall()
    if not rows:
        return False
    if not all(
        r["question_type"] == "time" and r["time_event_cancelled"] for r in rows
    ):
        return False
    closed = conn.execute(
        """UPDATE polls
           SET is_closed = true, close_reason = 'cancelled',
               close_notified = %(notified)s, updated_at = %(now)s
           WHERE id = %(pid)s AND is_closed = false
           RETURNING id""",
        {"pid": poll_id, "now": now, "notified": notified},
    ).fetchone()
    return closed is not None


def _row_to_question(row: dict) -> QuestionResponse:
    """Convert a database row to a QuestionResponse.

    Phase 5b: wrapper-level fields (response_deadline, creator_name,
    is_closed, close_reason, short_id, group_title,
    suggestion_deadline) are no longer surfaced on QuestionResponse — the FE
    sources them from the parent Poll. Migration 105 also removed the
    `poll_follow_up_to` chain pointer along with `polls.follow_up_to`."""
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
        category_icon=row.get("category_icon"),
        options_metadata=row.get("options_metadata"),
        reference_latitude=row.get("reference_latitude"),
        reference_longitude=row.get("reference_longitude"),
        reference_location_label=row.get("reference_location_label"),
        is_auto_title=row.get("is_auto_title", False),
        min_availability_percent=row.get("min_availability_percent"),
        time_min_participants=row.get("time_min_participants"),
        supply_count=row.get("supply_count"),
        reveal_claimant_names=row.get("reveal_claimant_names", True),
        winner_method=row.get("winner_method") or "favorite",
        poll_id=str(row["poll_id"]) if row.get("poll_id") else None,
        question_index=row.get("question_index"),
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
        voter_min_participants=row.get("voter_min_participants"),
        liked_slots=row.get("liked_slots"),
        disliked_slots=row.get("disliked_slots"),
        plus_one_names=row.get("plus_one_names"),
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
    )


def _enforce_suggestion_phase_timing(question: dict, suggestions, ranked_choices) -> bool:
    """Validate that the request's suggestions/ranked_choices respect the question's
    suggestion-phase cutoff. Raises HTTPException(400) on violation. Returns
    `has_suggestion_phase` for downstream use by `validate_vote()`.
    """
    has_suggestion_phase = question.get("suggestion_deadline") is not None
    if has_suggestion_phase:
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


def _submit_vote_to_question(
    conn,
    question_id: str,
    req: SubmitVoteRequest,
    now: datetime,
    browser_id: str | None = None,
) -> dict:
    """Insert a vote row inside an existing transaction. Shared by the per-question
    `submit_vote` endpoint and the poll batch-vote endpoint. Returns the
    inserted row. Raises HTTPException on validation failures.

    `browser_id` is recorded so the phase-transition notification can tell
    which group members prevoted (and therefore may already have seen the
    finalized options). Only set on insert — edits keep the original."""
    question = conn.execute(
        """SELECT p.id, p.question_type, p.poll_id,
                  mp.allow_pre_ranking,
                  mp.is_closed, mp.prephase_deadline AS suggestion_deadline
             FROM questions p
             LEFT JOIN polls mp ON p.poll_id = mp.id
            WHERE p.id = %(question_id)s""",
        {"question_id": question_id},
    ).fetchone()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    if question["is_closed"]:
        raise HTTPException(status_code=400, detail="Question is closed")

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
                           voter_day_time_windows, voter_duration, voter_min_participants,
                           liked_slots, disliked_slots, plus_one_names, browser_id,
                           created_at, updated_at)
        VALUES (%(question_id)s, %(vote_type)s, %(yes_no_choice)s, %(ranked_choices)s,
                %(ranked_choice_tiers)s::jsonb,
                %(suggestions)s, %(is_abstain)s, %(is_ranking_abstain)s, %(voter_name)s,
                %(voter_day_time_windows)s::jsonb, %(voter_duration)s::jsonb, %(voter_min_participants)s,
                %(liked_slots)s::jsonb, %(disliked_slots)s::jsonb, %(plus_one_names)s::jsonb, %(browser_id)s,
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
            "voter_min_participants": req.voter_min_participants,
            "liked_slots": json.dumps(req.liked_slots) if req.liked_slots is not None else None,
            "disliked_slots": json.dumps(req.disliked_slots) if req.disliked_slots is not None else None,
            "plus_one_names": json.dumps(req.plus_one_names) if req.plus_one_names is not None else None,
            "browser_id": browser_id,
            "now": now,
        },
    ).fetchone()

    _merge_suggestion_metadata(conn, question_id, req.options_metadata, req.suggestions)

    _check_auto_close(conn, question_id)
    return row


def _merge_suggestion_metadata(conn, question_id: str, options_metadata, suggestions) -> None:
    """Merge a vote's per-option metadata into questions.options_metadata so
    OTHER voters' ballots render the rich OptionLabel (favicon / underline /
    place modal) for search-picked suggestions, not plain text.

    Gated on both being present: metadata has no option to attach to without
    suggestions. Shared by the insert AND edit paths so adding a search-picked
    suggestion via either propagates cross-browser — an edit that adds a new
    suggestion was previously dropping its metadata, leaving the option plain
    text for everyone but the submitter (and once finalized into
    questions.options, plain text forever)."""
    if options_metadata and suggestions:
        conn.execute(
            """
            UPDATE questions
            SET options_metadata = COALESCE(options_metadata, '{}'::jsonb) || %(new_metadata)s::jsonb
            WHERE id = %(question_id)s
            """,
            {
                "question_id": question_id,
                "new_metadata": json.dumps(options_metadata),
            },
        )


def _edit_vote_on_question(
    conn,
    question_id: str,
    vote_id: str,
    req: EditVoteRequest,
    now: datetime,
    *,
    caller_browser_ids: list[str] | None = None,
) -> dict:
    """Update a vote row inside an existing transaction. Shared by the per-question
    `edit_vote` endpoint and the poll batch-vote endpoint. Returns the
    updated row. Raises HTTPException on validation failures.

    Ballot-privacy belt-and-suspenders (see the Auth & Access Model TODO in
    CLAUDE.md): when `caller_browser_ids` is provided (the account-aware browser
    set of whoever is editing), the vote's own `browser_id` must be in that set
    — so possession of a vote_id alone can't let one voter edit another's ballot.
    Legacy votes cast before migration 120 have a NULL `browser_id` (can't be
    attributed to any caller) and stay editable by possession so we don't
    regress them. When the set is empty/None (no resolvable identity) the gate is
    skipped, preserving prior behavior — this only ever adds protection."""
    existing = conn.execute(
        "SELECT id, browser_id FROM votes WHERE id = %(vote_id)s AND question_id = %(question_id)s",
        {"vote_id": vote_id, "question_id": question_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Vote not found")

    if caller_browser_ids:
        owner = existing["browser_id"]
        if owner is not None and str(owner) not in caller_browser_ids:
            raise HTTPException(status_code=403, detail="You can only edit your own vote")

    question = conn.execute(
        """SELECT p.question_type,
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
    if has_suggestion_phase:
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
            voter_min_participants = %(voter_min_participants)s,
            liked_slots = COALESCE(%(liked_slots)s::jsonb, liked_slots),
            disliked_slots = COALESCE(%(disliked_slots)s::jsonb, disliked_slots),
            plus_one_names = %(plus_one_names)s::jsonb,
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
            "voter_min_participants": req.voter_min_participants,
            "liked_slots": json.dumps(req.liked_slots) if req.liked_slots is not None else None,
            "disliked_slots": json.dumps(req.disliked_slots) if req.disliked_slots is not None else None,
            "plus_one_names": json.dumps(req.plus_one_names) if req.plus_one_names is not None else None,
            "now": now,
            "vote_id": vote_id,
            "question_id": question_id,
        },
    ).fetchone()

    _merge_suggestion_metadata(conn, question_id, req.options_metadata, req.suggestions)

    _check_auto_close(conn, question_id)
    return row


def should_reveal_claimant_names(*, reveal_flag: bool, viewer_user_id, creator_user_id) -> bool:
    """Whether a limited_supply question's claimant names are visible to this
    viewer. `reveal_flag` (the question's `reveal_claimant_names`) → visible to
    everyone; otherwise only the poll creator. Shared by the per-question
    `get_results` and the bulk `polls_for_poll_ids` read paths so the rule
    can't diverge. Callers gate WHEN to resolve `viewer_user_id` (the
    per-question path skips the lookup entirely when `reveal_flag` is true)."""
    if reveal_flag:
        return True
    return viewer_user_id is not None and str(viewer_user_id) == str(creator_user_id)


def _compute_results(
    question, votes, *, include_tentative_time_options: bool = True, reveal_names: bool = True
) -> QuestionResultsResponse:
    """Compute question results from a question row and its votes. Shared by get_results and get_accessible_questions.

    `include_tentative_time_options` gates the pre-ranking tentative-slots
    computation for time questions in the availability phase. The bulk
    `polls_for_poll_ids` path (`/api/groups/mine`, `/by-route-id/{id}`) sets
    this to False because the group page refreshes every 5s and the slot
    generation pass is the most expensive thing in this codepath — sustained
    cost scales with (polls × voters × duration_window × slot_grid) per active
    tab. The per-question results endpoint keeps it on so `QuestionBallot` can
    advance to the preferences bubble UI once a voter has submitted availability.

    `reveal_names` only affects limited_supply: when False, claimant names are
    stripped from the roster (the caller decides this per the reveal toggle +
    whether the viewer is the creator). Counts/positions/timestamps are kept so
    the FE can still show the viewer their own status.
    """
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

        winner_method = question.get("winner_method") or "favorite"

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
                consensus_winner=question_options[0],
                winner_method=winner_method,
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
        rc_borda = None
        ranking_votes = [
            v for v in votes
            if v.get("ranked_choices") or v.get("ranked_choice_tiers")
        ]
        consensus_winner = None
        if question_options and len(question_options) >= 2 and ranking_votes:
            result = calculate_ranked_choice_winner(ranking_votes, question_options)
            rc_winner = result.winner
            rc_borda = result.borda_scores or None
            consensus_winner = consensus_winner_from_borda(rc_borda, question_options)

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

        # The headline winner: IRV ('favorite') or Borda ('consensus'). Same
        # ballots; only which winner is surfaced as the decision differs. Both
        # are returned so the FE can show "the other lens would've picked Y".
        headline = consensus_winner if winner_method == "consensus" else rc_winner
        return QuestionResultsResponse(
            question_id=str(question["id"]),
            title=question["title"],
            question_type=question_type,
            created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
            response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
            options=question_options,
            total_votes=len(votes),
            winner=headline,
            ranked_choice_winner=rc_winner,
            consensus_winner=consensus_winner,
            winner_method=winner_method,
            ranked_choice_rounds=rc_rounds if rc_rounds else None,
            borda_scores=rc_borda,
            suggestion_counts=suggestion_counts_data,
        )

    if question_type == "limited_supply":
        from algorithms.limited_supply import calculate_limited_supply_result

        result = calculate_limited_supply_result(
            [dict(v) for v in votes], question.get("supply_count") or 0
        )
        return QuestionResultsResponse(
            question_id=str(question["id"]),
            title=question["title"],
            question_type=question_type,
            created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
            response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
            total_votes=len(votes),
            supply_count=result.supply_count,
            secured_count=result.secured_count,
            waitlist_count=result.waitlist_count,
            names_hidden=not reveal_names,
            claims=[
                {
                    # Strip names when the viewer isn't allowed to see them
                    # (reveal toggle off + not the creator). created_at stays so
                    # the FE can match the viewer's OWN claim for their status.
                    "name": c.name if reveal_names else None,
                    "secured": c.secured,
                    "position": c.position,
                    "created_at": c.created_at,
                }
                for c in result.claims
            ],
        )

    if question_type == "time":
        from algorithms.time_question import calculate_time_question_results

        raw_options = question.get("options")
        question_options = None
        options_are_tentative = False
        if raw_options:
            question_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        vote_dicts = [dict(v) for v in votes]

        # Pre-ranking mode: when slots aren't finalized yet but `allow_pre_ranking`
        # is on, surface a tentative slot list computed from the votes so far so
        # voters can react to currently-viable slots before the availability cutoff.
        # `_finalize_time_slots` runs the same algorithm at cutoff to persist
        # `question.options`; this path mirrors it without writing. Skipped on
        # bulk reads (see `include_tentative_time_options` doc).
        if (
            include_tentative_time_options
            and question_options is None
            and question.get("allow_pre_ranking") is not False
            and any(v.get("voter_day_time_windows") for v in vote_dicts)
        ):
            tentative, _ = _compute_candidate_time_slots(question, vote_dicts)
            if tentative:
                question_options = tentative
                options_are_tentative = True

        # `calculate_time_question_results` reads question["options"] (list or
        # JSON string). Substitute the tentative list when we computed one,
        # otherwise keep whatever was already on the row.
        synth_question = {**dict(question), "options": question_options}
        time_result = calculate_time_question_results(synth_question, vote_dicts)

        return QuestionResultsResponse(
            question_id=str(question["id"]),
            title=question["title"],
            question_type=question_type,
            created_at=question["created_at"].isoformat() if isinstance(question["created_at"], datetime) else str(question["created_at"]),
            response_deadline=question["response_deadline"].isoformat() if question.get("response_deadline") else None,
            options=question_options,
            options_are_tentative=options_are_tentative,
            total_votes=len(votes),
            winner=time_result["winner"],
            availability_counts=time_result["availability_counts"],
            max_availability=time_result["max_availability"],
            like_counts=time_result["like_counts"],
            dislike_counts=time_result["dislike_counts"],
            time_event_cancelled=bool(question.get("time_event_cancelled")),
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
