"""Shared poll helpers used by the polls and multipolls routers.

Pulled out of `routers/polls.py` so the routing layer is mostly endpoint
declarations and the data-massaging / vote-write / results-computation logic
lives in one place. Both `routers.polls` and `routers.multipolls` import from
here; nothing here depends on the router modules, so there are no circular
imports.
"""

import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from models import (
    EditVoteRequest,
    PollResponse,
    PollResultsResponse,
    RankedChoiceRoundResponse,
    SubmitVoteRequest,
    VoteResponse,
)
from algorithms.suggestion import count_suggestion_votes
from algorithms.ranked_choice import calculate_ranked_choice_winner
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.yes_no import count_yes_no_votes


# Phase 5b: wrapper-level fields are no longer surfaced on PollResponse.
# `_row_to_poll` ignores them when building the response. Internal logic
# (vote submission, results computation, finalization) still needs to read
# these from the wrapper, so the JOIN here aliases the same names — callers
# operate on the joined dict in-memory and the response shape is filtered by
# `_row_to_poll`. The FE-only `multipoll_follow_up_to` is the chain pointer
# used for thread building.
_SELECT_POLL_FULL = """
    SELECT p.*,
           mp.short_id AS short_id,
           mp.creator_secret AS creator_secret,
           mp.creator_name AS creator_name,
           mp.response_deadline AS response_deadline,
           mp.is_closed AS is_closed,
           mp.close_reason AS close_reason,
           mp.thread_title AS thread_title,
           mp.prephase_deadline AS suggestion_deadline,
           mp.follow_up_to AS multipoll_follow_up_to
      FROM polls p
      LEFT JOIN multipolls mp ON p.multipoll_id = mp.id
"""


def _fetch_poll_full(conn, poll_id: str) -> dict | None:
    """Fetch a poll plus its wrapper-level fields (joined from multipolls)
    for internal consumption. The fields aren't surfaced in PollResponse but
    are needed by results computation, vote validation, and finalization."""
    return conn.execute(
        _SELECT_POLL_FULL + " WHERE p.id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchone()


def _attach_wrapper_fields(conn, row) -> dict | None:
    """Annotate a RETURNING * row from polls with wrapper-level fields fetched
    from the parent multipoll. Use after UPDATE/INSERT on the polls table when
    the response goes back through `_row_to_poll`. Phase 5b: only
    `multipoll_follow_up_to` is surfaced on PollResponse, but the other fields
    are still attached here so internal post-write logic that reads
    `row["is_closed"]` etc. keeps working."""
    if row is None:
        return None
    row = dict(row)
    multipoll_id = row.get("multipoll_id")
    if not multipoll_id:
        for key in (
            "short_id",
            "creator_secret",
            "creator_name",
            "response_deadline",
            "is_closed",
            "close_reason",
            "thread_title",
            "suggestion_deadline",
            "multipoll_follow_up_to",
        ):
            row.setdefault(key, None)
        return row
    mp_row = conn.execute(
        """
        SELECT short_id, creator_secret, creator_name, response_deadline,
               is_closed, close_reason, thread_title, prephase_deadline,
               follow_up_to
          FROM multipolls WHERE id = %(id)s
        """,
        {"id": str(multipoll_id)},
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
        row["multipoll_follow_up_to"] = (
            str(mp_row["follow_up_to"]) if mp_row.get("follow_up_to") else None
        )
    return row


def _check_auto_close(conn, poll_id: str) -> None:
    """Auto-close the parent multipoll when this sub-poll's respondent count
    reaches its auto_close_after threshold. Closes ALL sub-polls of the
    multipoll via the wrapper's is_closed. Auto-close is per-sub-poll today
    only because the threshold lives on polls; the wrapper-level close is the
    natural unit after Phase 5."""
    poll = conn.execute(
        """SELECT p.auto_close_after, p.multipoll_id, mp.is_closed
             FROM polls p
             LEFT JOIN multipolls mp ON p.multipoll_id = mp.id
            WHERE p.id = %(poll_id)s""",
        {"poll_id": poll_id},
    ).fetchone()
    if not poll or poll["auto_close_after"] is None:
        return
    if poll.get("is_closed") or not poll.get("multipoll_id"):
        return

    respondent_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM votes WHERE poll_id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchone()["cnt"]
    if respondent_count >= poll["auto_close_after"]:
        conn.execute(
            "UPDATE multipolls SET is_closed = true, close_reason = 'max_capacity', updated_at = NOW() WHERE id = %(mp_id)s",
            {"mp_id": str(poll["multipoll_id"])},
        )


def _finalize_suggestion_options(conn, poll_id: str, now: datetime) -> None:
    """Finalize options for a ranked_choice poll after its suggestion_deadline passes.

    Collects all unique suggestions from votes and writes them to the poll's options column.
    """
    votes = conn.execute(
        "SELECT suggestions FROM votes WHERE poll_id = %(poll_id)s AND suggestions IS NOT NULL",
        {"poll_id": poll_id},
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
            """UPDATE polls SET options = %(options)s::jsonb, updated_at = %(now)s
               WHERE id = %(poll_id)s""",
            {
                "options": json.dumps(all_suggestions),
                "now": now,
                "poll_id": poll_id,
            },
        )


def _finalize_time_slots(conn, poll_id: str, now: datetime) -> None:
    """Finalize time slots for a time poll after its availability deadline passes.

    Generates all candidate time slots from the poll's day_time_windows + duration_window,
    then applies the availability threshold filter and longest-per-start-time dedup so
    poll.options contains only the slots voters will actually rank.
    """
    from algorithms.time_poll import (
        generate_time_poll_slots,
        compute_slot_availability,
        filter_slots_by_min_availability,
        _keep_longest_per_start_time,
    )

    poll = _fetch_poll_full(conn, poll_id)
    if not poll or poll.get("options"):
        return  # Already finalized or missing

    votes = conn.execute(
        "SELECT voter_day_time_windows, voter_duration FROM votes WHERE poll_id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchall()
    votes_list = [dict(v) for v in votes]

    all_slots = generate_time_poll_slots(dict(poll), votes_list)

    availability_counts = compute_slot_availability(all_slots, votes_list)
    slots = filter_slots_by_min_availability(
        all_slots,
        availability_counts,
        poll.get("min_availability_percent") or 95,
    )

    # Keep only the longest-duration slot per start time
    slots = _keep_longest_per_start_time(slots)

    if slots:
        conn.execute(
            """UPDATE polls SET options = %(options)s::jsonb, updated_at = %(now)s
               WHERE id = %(poll_id)s""",
            {
                "options": json.dumps(slots),
                "now": now,
                "poll_id": poll_id,
            },
        )


def _row_to_poll(row: dict) -> PollResponse:
    """Convert a database row to a PollResponse.

    Phase 5b: wrapper-level fields (response_deadline, creator_secret,
    creator_name, is_closed, close_reason, short_id, thread_title,
    suggestion_deadline) are no longer surfaced on PollResponse — the FE
    sources them from the parent Multipoll. Use `_SELECT_POLL_FULL` (or
    `_attach_wrapper_fields` for RETURNING * paths) to populate
    `multipoll_follow_up_to` on the row dict before calling here, since
    that's the only wrapper field we still expose."""
    return PollResponse(
        id=str(row["id"]),
        title=row["title"],
        poll_type=row["poll_type"],
        options=row.get("options"),
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
        suggestion_deadline_minutes=row.get("suggestion_deadline_minutes"),
        allow_pre_ranking=row.get("allow_pre_ranking", True),
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
        min_responses=row.get("min_responses"),
        show_preliminary_results=row.get("show_preliminary_results", True),
        min_availability_percent=row.get("min_availability_percent"),
        multipoll_id=str(row["multipoll_id"]) if row.get("multipoll_id") else None,
        sub_poll_index=row.get("sub_poll_index"),
        multipoll_follow_up_to=(
            str(row["multipoll_follow_up_to"])
            if row.get("multipoll_follow_up_to")
            else None
        ),
    )


def _row_to_vote(row: dict) -> VoteResponse:
    """Convert a database row to a VoteResponse."""
    return VoteResponse(
        id=str(row["id"]),
        poll_id=str(row["poll_id"]),
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


def _enforce_suggestion_phase_timing(poll: dict, suggestions, ranked_choices) -> bool:
    """Validate that the request's suggestions/ranked_choices respect the poll's
    suggestion-phase cutoff. Raises HTTPException(400) on violation. Returns
    `has_suggestion_phase` for downstream use by `validate_vote()`.
    """
    has_suggestion_phase = (
        poll.get("suggestion_deadline") is not None
        or poll.get("suggestion_deadline_minutes") is not None
    )
    if has_suggestion_phase and poll.get("suggestion_deadline"):
        in_suggestion_phase = datetime.now(timezone.utc) < poll["suggestion_deadline"]

        # Reject new suggestions after cutoff
        if not in_suggestion_phase and suggestions:
            raise HTTPException(status_code=400, detail="Suggestions cutoff has passed")

        # For time polls: reject ranked_choices while still in availability phase
        # (slots aren't finalized yet, so rankings can't be submitted)
        if poll["poll_type"] == "time" and in_suggestion_phase and ranked_choices:
            raise HTTPException(status_code=400, detail="Rankings not allowed until availability phase has closed")

        # Reject rankings before cutoff if pre-ranking is disabled (ranked_choice polls)
        if poll["poll_type"] != "time" and in_suggestion_phase and ranked_choices and not poll["allow_pre_ranking"]:
            raise HTTPException(status_code=400, detail="Rankings not allowed until suggestions cutoff")

    return has_suggestion_phase


def _submit_vote_to_poll(conn, poll_id: str, req: SubmitVoteRequest, now: datetime) -> dict:
    """Insert a vote row inside an existing transaction. Shared by the per-poll
    `submit_vote` endpoint and the multipoll batch-vote endpoint. Returns the
    inserted row. Raises HTTPException on validation failures."""
    poll = conn.execute(
        """SELECT p.id, p.poll_type, p.multipoll_id, p.suggestion_deadline_minutes, p.allow_pre_ranking,
                  mp.is_closed, mp.prephase_deadline AS suggestion_deadline,
                  mp.response_deadline
             FROM polls p
             LEFT JOIN multipolls mp ON p.multipoll_id = mp.id
            WHERE p.id = %(poll_id)s""",
        {"poll_id": poll_id},
    ).fetchone()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    if poll["is_closed"]:
        raise HTTPException(status_code=400, detail="Poll is closed")

    has_deferred_deadline = (
        poll.get("suggestion_deadline_minutes")
        and not poll.get("suggestion_deadline")
        and (
            req.suggestions
            or (poll["poll_type"] == "time" and req.voter_day_time_windows)
        )
    )
    if has_deferred_deadline:
        new_deadline = now + timedelta(minutes=poll["suggestion_deadline_minutes"])
        if poll.get("response_deadline"):
            response_dt = poll["response_deadline"]
            if not response_dt.tzinfo:
                response_dt = response_dt.replace(tzinfo=timezone.utc)
            if new_deadline >= response_dt:
                new_deadline = response_dt - timedelta(minutes=1)
        # Phase 5: write to the multipoll wrapper's prephase_deadline
        # (formerly `polls.suggestion_deadline`).
        if poll.get("multipoll_id"):
            conn.execute(
                "UPDATE multipolls SET prephase_deadline = %(deadline)s, updated_at = %(now)s WHERE id = %(mp_id)s",
                {"deadline": new_deadline, "now": now, "mp_id": str(poll["multipoll_id"])},
            )
        poll = dict(poll)
        poll["suggestion_deadline"] = new_deadline

    has_suggestion_phase = _enforce_suggestion_phase_timing(
        poll, req.suggestions, req.ranked_choices
    )

    try:
        validate_vote(
            poll_type=poll["poll_type"],
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
        INSERT INTO votes (poll_id, vote_type, yes_no_choice, ranked_choices,
                           ranked_choice_tiers,
                           suggestions, is_abstain, is_ranking_abstain, voter_name,
                           voter_day_time_windows, voter_duration,
                           liked_slots, disliked_slots,
                           created_at, updated_at)
        VALUES (%(poll_id)s, %(vote_type)s, %(yes_no_choice)s, %(ranked_choices)s,
                %(ranked_choice_tiers)s::jsonb,
                %(suggestions)s, %(is_abstain)s, %(is_ranking_abstain)s, %(voter_name)s,
                %(voter_day_time_windows)s::jsonb, %(voter_duration)s::jsonb,
                %(liked_slots)s::jsonb, %(disliked_slots)s::jsonb,
                %(now)s, %(now)s)
        RETURNING *
        """,
        {
            "poll_id": poll_id,
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
            UPDATE polls
            SET options_metadata = COALESCE(options_metadata, '{}'::jsonb) || %(new_metadata)s::jsonb
            WHERE id = %(poll_id)s
            """,
            {
                "poll_id": poll_id,
                "new_metadata": json.dumps(req.options_metadata),
            },
        )

    _check_auto_close(conn, poll_id)
    return row


def _edit_vote_on_poll(conn, poll_id: str, vote_id: str, req: EditVoteRequest, now: datetime) -> dict:
    """Update a vote row inside an existing transaction. Shared by the per-poll
    `edit_vote` endpoint and the multipoll batch-vote endpoint. Returns the
    updated row. Raises HTTPException on validation failures."""
    existing = conn.execute(
        "SELECT id FROM votes WHERE id = %(vote_id)s AND poll_id = %(poll_id)s",
        {"vote_id": vote_id, "poll_id": poll_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Vote not found")

    poll = conn.execute(
        """SELECT p.poll_type, p.suggestion_deadline_minutes, p.allow_pre_ranking,
                  mp.is_closed, mp.prephase_deadline AS suggestion_deadline
             FROM polls p
             LEFT JOIN multipolls mp ON p.multipoll_id = mp.id
            WHERE p.id = %(poll_id)s""",
        {"poll_id": poll_id},
    ).fetchone()
    if poll and poll["is_closed"]:
        raise HTTPException(status_code=400, detail="Poll is closed")

    has_suggestion_phase = _enforce_suggestion_phase_timing(
        poll, req.suggestions, req.ranked_choices
    )
    if has_suggestion_phase and poll.get("suggestion_deadline"):
        in_suggestion_phase = datetime.now(timezone.utc) < poll["suggestion_deadline"]

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
                           WHERE poll_id = %(poll_id)s
                             AND id != %(vote_id)s
                             AND ranked_choices IS NOT NULL""",
                        {"poll_id": poll_id, "vote_id": vote_id},
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
        WHERE id = %(vote_id)s AND poll_id = %(poll_id)s
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
            "poll_id": poll_id,
        },
    ).fetchone()
    _check_auto_close(conn, poll_id)
    return row


def _compute_results(poll, votes) -> PollResultsResponse:
    """Compute poll results from a poll row and its votes. Shared by get_results and get_accessible_polls."""
    poll_type = poll["poll_type"]

    if poll_type == "yes_no":
        result = count_yes_no_votes(votes)
        return PollResultsResponse(
            poll_id=str(poll["id"]),
            title=poll["title"],
            poll_type=poll_type,
            created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
            response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
            options=poll.get("options"),
            yes_count=result.yes_count,
            no_count=result.no_count,
            abstain_count=result.abstain_count,
            total_votes=result.total_votes,
            yes_percentage=result.yes_percentage,
            no_percentage=result.no_percentage,
            winner=result.winner,
        )

    if poll_type == "ranked_choice":
        raw_options = poll.get("options")
        poll_options = None
        if raw_options:
            poll_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        has_suggestion_phase = poll.get("suggestion_deadline") is not None

        # Compute suggestion counts if this poll has a suggestion phase
        suggestion_counts_data = None
        if has_suggestion_phase:
            sug_result = count_suggestion_votes(votes, poll_options=poll_options)
            suggestion_counts_data = [
                {"option": sc.option, "count": sc.count}
                for sc in sug_result.suggestion_counts
            ]
            # During suggestion phase (options not yet finalized), derive options from suggestions
            if not poll_options and suggestion_counts_data:
                poll_options = [sc["option"] for sc in suggestion_counts_data]

        # Uncontested: single option wins automatically
        if poll.get("close_reason") == "uncontested" and poll_options and len(poll_options) == 1:
            return PollResultsResponse(
                poll_id=str(poll["id"]),
                title=poll["title"],
                poll_type=poll_type,
                created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
                response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
                options=poll_options,
                total_votes=0,
                winner=poll_options[0],
                ranked_choice_winner=poll_options[0],
                ranked_choice_rounds=[RankedChoiceRoundResponse(
                    round_number=1,
                    option_name=poll_options[0],
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
        if poll_options and len(poll_options) >= 2 and ranking_votes:
            result = calculate_ranked_choice_winner(ranking_votes, poll_options)
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

        return PollResultsResponse(
            poll_id=str(poll["id"]),
            title=poll["title"],
            poll_type=poll_type,
            created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
            response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
            options=poll_options,
            total_votes=len(votes),
            winner=rc_winner,
            ranked_choice_winner=rc_winner,
            ranked_choice_rounds=rc_rounds if rc_rounds else None,
            suggestion_counts=suggestion_counts_data,
        )

    if poll_type == "time":
        from algorithms.time_poll import calculate_time_poll_results

        raw_options = poll.get("options")
        poll_options = None
        if raw_options:
            poll_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        vote_dicts = [dict(v) for v in votes]
        time_result = calculate_time_poll_results(dict(poll), vote_dicts)

        return PollResultsResponse(
            poll_id=str(poll["id"]),
            title=poll["title"],
            poll_type=poll_type,
            created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
            response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
            options=poll_options,
            total_votes=len(votes),
            winner=time_result["winner"],
            availability_counts=time_result["availability_counts"],
            max_availability=time_result["max_availability"],
            like_counts=time_result["like_counts"],
            dislike_counts=time_result["dislike_counts"],
        )

    # Fallback for any unhandled poll type — should be unreachable post-migration.
    return PollResultsResponse(
        poll_id=str(poll["id"]),
        title=poll["title"],
        poll_type=poll_type,
        created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
        response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
        options=poll.get("options"),
        total_votes=len(votes),
    )


def _json_or_none(val) -> str | None:
    """Serialize a JSON-compatible value for a JSONB column, or None."""
    if val is None:
        return None
    return json.dumps(val)
