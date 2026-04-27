"""Poll API endpoints."""

import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException

from database import get_db
from models import (
    AccessiblePollsRequest,
    EditVoteRequest,
    MultipollResponse,
    PollResponse,
    PollResultsResponse,
    PollType,
    RankedChoiceRoundResponse,
    RelatedPollsRequest,
    RelatedPollsResponse,
    SubmitVoteRequest,
    VoteResponse,
)
from algorithms.suggestion import count_suggestion_votes
from algorithms.ranked_choice import calculate_ranked_choice_winner
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.related_polls import PollRelation, get_all_related_poll_ids
from algorithms.yes_no import count_yes_no_votes

router = APIRouter(prefix="/api/polls", tags=["polls"])


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
    import json

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
    import json
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




# --- Poll CRUD ---
# Phase 5: the legacy `POST /api/polls` create endpoint is gone — every poll is
# now created through `POST /api/multipolls` (one sub-poll wrapped in a 1-sub-
# poll multipoll for the simple case).


@router.get("/dev/all-ids")
def get_all_poll_ids():
    """Return all poll IDs in the database. Only available in dev environments."""
    if os.environ.get("DISABLE_RATE_LIMIT") != "1":
        raise HTTPException(status_code=404, detail="Not found")
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id FROM polls ORDER BY created_at DESC"
        ).fetchall()
    return {"poll_ids": [row["id"] for row in rows]}


@router.get("/find-duplicate", response_model=PollResponse)
def find_duplicate_poll(title: str, follow_up_to: str):
    """Find an existing sub-poll under the same multipoll-level chain as
    `follow_up_to` (a poll id) with the same title (case-insensitive).

    Phase 5: walks multipoll-level chains. The candidate sub-poll's wrapper
    must have `follow_up_to` equal to the input poll's wrapper id. (The
    legacy implementation queried `polls.follow_up_to` directly; that column
    no longer exists.)
    """
    with get_db() as conn:
        row = conn.execute(
            _SELECT_POLL_FULL
            + """
            WHERE LOWER(p.title) = LOWER(%(title)s)
              AND mp.follow_up_to = (
                SELECT multipoll_id FROM polls WHERE id = %(follow_up_to)s
              )
            ORDER BY p.created_at ASC
            LIMIT 1
            """,
            {"title": title, "follow_up_to": follow_up_to},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No duplicate poll found")
    return _row_to_poll(row)


@router.get("/by-short-id/{short_id}", response_model=PollResponse)
def get_poll_by_short_id(short_id: str):
    """Get a poll by its (wrapper's) short ID."""
    with get_db() as conn:
        row = conn.execute(
            _SELECT_POLL_FULL + " WHERE mp.short_id = %(short_id)s ORDER BY p.sub_poll_index NULLS LAST LIMIT 1",
            {"short_id": short_id},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Poll not found")
    return _row_to_poll(row)


@router.get("/{poll_id}", response_model=PollResponse)
def get_poll(poll_id: str):
    """Get a poll by UUID."""
    with get_db() as conn:
        row = _fetch_poll_full(conn, poll_id)
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")

        # Auto-finalize options when suggestion deadline has passed but options not yet set
        if (
            row.get("suggestion_deadline")
            and not row.get("options")
            and not row.get("is_closed")
            and datetime.now(timezone.utc) >= row["suggestion_deadline"]
        ):
            _finalize_suggestion_options(conn, poll_id, datetime.now(timezone.utc))
            # Re-fetch to get updated options
            row = _fetch_poll_full(conn, poll_id)

        poll_resp = _row_to_poll(row)
        # Include response count for open polls (used for min_responses threshold)
        if not row.get("is_closed", False):
            count = conn.execute(
                "SELECT COUNT(*) as cnt FROM votes WHERE poll_id = %(poll_id)s",
                {"poll_id": poll_id},
            ).fetchone()["cnt"]
            poll_resp.response_count = count
    return poll_resp


# --- Voting ---


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

    import json
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

    import json
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


# Phase 5: per-poll vote submit/edit endpoints removed. All vote writes go
# through `POST /api/multipolls/{id}/votes`, which uses the same
# `_submit_vote_to_poll` / `_edit_vote_on_poll` helpers internally.


@router.get("/{poll_id}/votes", response_model=list[VoteResponse])
def get_votes(poll_id: str):
    """Get all votes for a poll."""
    with get_db() as conn:
        # Verify poll exists
        poll = conn.execute(
            "SELECT id FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if not poll:
            raise HTTPException(status_code=404, detail="Poll not found")

        rows = conn.execute(
            "SELECT * FROM votes WHERE poll_id = %(poll_id)s ORDER BY created_at",
            {"poll_id": poll_id},
        ).fetchall()
    return [_row_to_vote(r) for r in rows]


# --- Results ---


@router.get("/{poll_id}/results", response_model=PollResultsResponse)
def get_results(poll_id: str):
    """Compute and return poll results."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        poll = _fetch_poll_full(conn, poll_id)
        if not poll:
            raise HTTPException(status_code=404, detail="Poll not found")

        # For ranked_choice polls with suggestion phase: finalize options when
        # suggestion_deadline passes (populate options from collected suggestions)
        if (
            poll["poll_type"] == "ranked_choice"
            and poll.get("suggestion_deadline")
            and not poll["is_closed"]
            and poll["suggestion_deadline"] <= now
            and not poll.get("options")  # Not yet finalized
        ):
            _finalize_suggestion_options(conn, poll_id, now)
            poll = _fetch_poll_full(conn, poll_id)

        # For time polls: finalize time slot options when availability deadline passes
        if (
            poll["poll_type"] == "time"
            and poll.get("suggestion_deadline")
            and poll["suggestion_deadline"] <= now
            and not poll.get("options")  # Not yet finalized
        ):
            _finalize_time_slots(conn, poll_id, now)
            poll = _fetch_poll_full(conn, poll_id)

        votes = conn.execute(
            "SELECT * FROM votes WHERE poll_id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchall()

    return _compute_results(poll, votes)


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
        import json
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
        import json
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


# --- Poll management ---
# Phase 5: per-poll close/reopen/cutoff-suggestions/cutoff-availability and
# thread-title endpoints all removed — these are multipoll-level concerns and
# now live exclusively under `/api/multipolls/{id}/...`.


# --- Accessible polls ---


@router.post("/accessible", response_model=list[MultipollResponse])
def get_accessible_polls(req: AccessiblePollsRequest):
    """Return the multipoll wrappers covering the user's accessible poll IDs.

    Phase 5b: returns `MultipollResponse[]` instead of flat `PollResponse[]`.
    Per the addressability paradigm, the multipoll is the unit of identity —
    the FE consumes wrapper-level fields (response_deadline, is_closed, etc.)
    from the multipoll and per-sub-poll fields from each `sub_poll`.

    Each requested poll_id resolves to its multipoll; we return one
    MultipollResponse per unique multipoll covered, including ALL sub-polls
    of that multipoll (siblings of any requested poll). Inline `results` are
    populated on each sub-poll using the same gating as the per-poll /results
    endpoint (closed polls always; open polls when show_preliminary_results
    is true and min_responses is unset-or-met).
    """
    # Local import keeps this file from growing a circular dep with multipolls.py.
    from routers.multipolls import (
        _compute_multipoll_voter_data,
        _row_to_multipoll,
    )

    if not req.poll_ids:
        return []
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Resolve requested poll_ids → unique multipoll_ids. Polls without a
        # multipoll_id are skipped (post-Phase-4 there shouldn't be any).
        mp_id_rows = conn.execute(
            """SELECT DISTINCT multipoll_id
                 FROM polls
                WHERE id = ANY(%(ids)s) AND multipoll_id IS NOT NULL""",
            {"ids": req.poll_ids},
        ).fetchall()
        multipoll_ids = [str(r["multipoll_id"]) for r in mp_id_rows]
        if not multipoll_ids:
            return []

        # Fetch every multipoll wrapper.
        multipoll_rows = conn.execute(
            """SELECT * FROM multipolls
                WHERE id = ANY(%(ids)s)
                ORDER BY created_at DESC""",
            {"ids": multipoll_ids},
        ).fetchall()

        # Fetch every sub-poll of these multipolls in one query, preserving
        # creator-intended order.
        sub_poll_rows = conn.execute(
            """SELECT * FROM polls
                WHERE multipoll_id = ANY(%(ids)s)
                ORDER BY multipoll_id, sub_poll_index NULLS LAST, created_at""",
            {"ids": multipoll_ids},
        ).fetchall()
        sub_polls_by_mp: dict[str, list] = {}
        for sp in sub_poll_rows:
            sub_polls_by_mp.setdefault(str(sp["multipoll_id"]), []).append(sp)
        all_sub_poll_ids = [str(sp["id"]) for sp in sub_poll_rows]

        # Inline-results gating mirrors the previous per-poll behavior. A
        # sub-poll's `is_closed` / `response_deadline` come from its wrapper.
        wrappers_by_id = {str(mp["id"]): mp for mp in multipoll_rows}
        closed_poll_ids: list[str] = []
        open_poll_ids: list[str] = []
        for sp in sub_poll_rows:
            mp = wrappers_by_id.get(str(sp["multipoll_id"]))
            is_closed = bool(mp and mp.get("is_closed"))
            deadline = mp.get("response_deadline") if mp else None
            deadline_passed = bool(deadline and deadline <= now)
            (closed_poll_ids if (is_closed or deadline_passed) else open_poll_ids).append(str(sp["id"]))

        votes_by_poll: dict[str, list] = {pid: [] for pid in closed_poll_ids}
        if closed_poll_ids:
            vote_rows = conn.execute(
                "SELECT * FROM votes WHERE poll_id = ANY(%(poll_ids)s)",
                {"poll_ids": closed_poll_ids},
            ).fetchall()
            for v in vote_rows:
                pid = str(v["poll_id"])
                if pid in votes_by_poll:
                    votes_by_poll[pid].append(v)

        response_counts: dict[str, int] = {}
        if open_poll_ids:
            count_rows = conn.execute(
                "SELECT poll_id, COUNT(*) as cnt FROM votes WHERE poll_id = ANY(%(poll_ids)s) GROUP BY poll_id",
                {"poll_ids": open_poll_ids},
            ).fetchall()
            for cr in count_rows:
                response_counts[str(cr["poll_id"])] = cr["cnt"]

        sub_poll_rows_by_id = {str(sp["id"]): sp for sp in sub_poll_rows}
        preliminary_poll_ids: list[str] = []
        for pid in open_poll_ids:
            sp = sub_poll_rows_by_id[pid]
            min_resp = sp.get("min_responses")
            show_prelim = sp.get("show_preliminary_results", True)
            if show_prelim and (min_resp is None or response_counts.get(pid, 0) >= min_resp):
                preliminary_poll_ids.append(pid)
        if preliminary_poll_ids:
            prelim_vote_rows = conn.execute(
                "SELECT * FROM votes WHERE poll_id = ANY(%(poll_ids)s)",
                {"poll_ids": preliminary_poll_ids},
            ).fetchall()
            for v in prelim_vote_rows:
                pid = str(v["poll_id"])
                votes_by_poll.setdefault(pid, []).append(v)

        # Per-sub-poll voter_names (kept on PollResponse for per-card respondent
        # rows). Reuse vote rows we already fetched to avoid a second pass.
        voter_names_by_poll: dict[str, list[str]] = {}
        for pid, votes in votes_by_poll.items():
            names = sorted({
                v["voter_name"] for v in votes
                if v.get("voter_name") and v["voter_name"] != ""
            })
            if names:
                voter_names_by_poll[pid] = names
        remaining_poll_ids = [pid for pid in all_sub_poll_ids if pid not in votes_by_poll]
        if remaining_poll_ids:
            vn_rows = conn.execute(
                """SELECT poll_id, array_agg(DISTINCT voter_name ORDER BY voter_name) as names
                     FROM votes
                    WHERE poll_id = ANY(%(poll_ids)s)
                      AND voter_name IS NOT NULL AND voter_name != ''
                    GROUP BY poll_id""",
                {"poll_ids": remaining_poll_ids},
            ).fetchall()
            for vn in vn_rows:
                voter_names_by_poll[str(vn["poll_id"])] = vn["names"]

        # Multipoll-level voter aggregates. _compute_multipoll_voter_data
        # issues one query per multipoll; for the typical user with <100
        # accessible multipolls this is fine, and matching the existing
        # /api/multipolls/by-id/{id} behavior keeps the aggregation logic
        # in one place.
        voter_data_by_mp: dict[str, tuple[list[str], int]] = {}
        for mp_id in multipoll_ids:
            voter_data_by_mp[mp_id] = _compute_multipoll_voter_data(conn, mp_id)

    # Build the response. Inline results / response_count / per-sub-poll
    # voter_names are attached to each PollResponse after _row_to_multipoll
    # builds it.
    responses: list[MultipollResponse] = []
    for mp_row in multipoll_rows:
        mp_id = str(mp_row["id"])
        sp_rows = sub_polls_by_mp.get(mp_id, [])
        voter_names, anon_count = voter_data_by_mp.get(mp_id, ([], 0))
        mp_resp = _row_to_multipoll(mp_row, sp_rows, voter_names, anon_count)
        if req.include_results:
            for sp_resp in mp_resp.sub_polls:
                pid = sp_resp.id
                if pid in votes_by_poll:
                    sp_row = sub_poll_rows_by_id[pid]
                    # _compute_results reads wrapper-level fields off the row
                    # (response_deadline, close_reason, suggestion_deadline)
                    # so splice them in from the wrapper.
                    enriched = dict(sp_row)
                    enriched["response_deadline"] = mp_row.get("response_deadline")
                    enriched["close_reason"] = mp_row.get("close_reason")
                    enriched["is_closed"] = mp_row.get("is_closed", False)
                    enriched["suggestion_deadline"] = mp_row.get("prephase_deadline")
                    try:
                        sp_resp.results = _compute_results(enriched, votes_by_poll[pid])
                    except Exception:
                        logger.warning("Failed to compute results for poll %s", pid, exc_info=True)
                if pid in response_counts:
                    sp_resp.response_count = response_counts[pid]
                if pid in voter_names_by_poll:
                    sp_resp.voter_names = voter_names_by_poll[pid]
        responses.append(mp_resp)
    return responses


@router.post("/related", response_model=RelatedPollsResponse)
def get_related_polls(req: RelatedPollsRequest):
    """Discover all polls related to the input IDs via follow-up chains."""
    if not req.poll_ids:
        return RelatedPollsResponse(
            all_related_ids=[], original_count=0, discovered_count=0
        )
    with get_db() as conn:
        # Fetch every poll plus its multipoll's follow_up_to (Phase 3.5 source
        # of truth for thread chains). The discovery walks multipoll-level
        # chains via mp.follow_up_to + multipoll-sibling grouping; per-poll
        # follow_up_to is no longer consulted for chain traversal.
        rows = conn.execute(
            """SELECT p.id, p.multipoll_id,
                      mp.follow_up_to AS multipoll_follow_up_to
                 FROM polls p
                 LEFT JOIN multipolls mp ON p.multipoll_id = mp.id
                WHERE mp.follow_up_to IS NOT NULL
                   OR p.multipoll_id IS NOT NULL
                   OR p.id = ANY(%(poll_ids)s)""",
            {"poll_ids": req.poll_ids},
        ).fetchall()

    all_polls = [
        PollRelation(
            id=str(r["id"]),
            multipoll_id=str(r["multipoll_id"]) if r.get("multipoll_id") else None,
            multipoll_follow_up_to=(
                str(r["multipoll_follow_up_to"])
                if r.get("multipoll_follow_up_to")
                else None
            ),
        )
        for r in rows
    ]
    related_ids = get_all_related_poll_ids(req.poll_ids, all_polls)
    return RelatedPollsResponse(
        all_related_ids=related_ids,
        original_count=len(req.poll_ids),
        discovered_count=len(related_ids),
    )


# --- Helpers ---


def _json_or_none(val) -> str | None:
    """Serialize a JSON-compatible value for a JSONB column, or None."""
    if val is None:
        return None
    import json
    return json.dumps(val)
