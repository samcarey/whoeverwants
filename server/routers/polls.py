"""Poll API endpoints."""

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException

from database import get_db
from models import (
    AccessiblePollsRequest,
    ClosePollRequest,
    CreatePollRequest,
    EditVoteRequest,
    ParticipantResponse,
    PollResponse,
    PollResultsResponse,
    PollType,
    RankedChoiceRoundResponse,
    RelatedPollsRequest,
    RelatedPollsResponse,
    ReopenPollRequest,
    SubmitVoteRequest,
    TimeSlotResponse,
    VoteResponse,
)
from algorithms.suggestion import count_suggestion_votes
from algorithms.ranked_choice import calculate_ranked_choice_winner
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.participation import calculate_participating_voters
from algorithms.auto_close import should_auto_close
from algorithms.related_polls import PollRelation, get_all_related_poll_ids
from algorithms.yes_no import count_yes_no_votes

router = APIRouter(prefix="/api/polls", tags=["polls"])


def _check_auto_close(conn, poll_id: str) -> None:
    """Auto-close a poll based on auto_close_after (respondent count) or max_participants."""
    poll = conn.execute(
        """SELECT id, poll_type, is_closed, auto_close_after, max_participants,
                  suggestion_deadline, allow_pre_ranking,
                  sub_poll_role, parent_participation_poll_id, options
           FROM polls WHERE id = %(poll_id)s""",
        {"poll_id": poll_id},
    ).fetchone()
    if not poll or poll["is_closed"]:
        return

    closed = False

    # Check auto_close_after (works for all poll types)
    if poll["auto_close_after"] is not None:
        respondent_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM votes WHERE poll_id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()["cnt"]
        if respondent_count >= poll["auto_close_after"]:
            conn.execute(
                "UPDATE polls SET is_closed = true, close_reason = 'max_capacity' WHERE id = %(poll_id)s",
                {"poll_id": poll_id},
            )
            closed = True

    # Check max_participants (participation polls only)
    if not closed and poll["poll_type"] == "participation" and poll["max_participants"] is not None:
        yes_count = conn.execute(
            """SELECT COUNT(*) as cnt FROM votes
               WHERE poll_id = %(poll_id)s
                 AND vote_type = 'participation'
                 AND yes_no_choice = 'yes'""",
            {"poll_id": poll_id},
        ).fetchone()["cnt"]
        if should_auto_close(
            poll["poll_type"], poll["is_closed"], poll["max_participants"], yes_count
        ):
            conn.execute(
                "UPDATE polls SET is_closed = true, close_reason = 'max_capacity' WHERE id = %(poll_id)s",
                {"poll_id": poll_id},
            )
            closed = True

    if closed:
        # If we just closed a ranked_choice sub-poll, resolve the winner to parent
        if poll["poll_type"] == "ranked_choice" and poll.get("sub_poll_role"):
            _resolve_sub_poll_winner(conn, dict(poll))


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



def _row_to_poll(row: dict) -> PollResponse:
    """Convert a database row to a PollResponse."""
    return PollResponse(
        id=str(row["id"]),
        title=row["title"],
        poll_type=row["poll_type"],
        options=row.get("options"),
        response_deadline=row["response_deadline"].isoformat() if row.get("response_deadline") else None,
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
        creator_secret=row.get("creator_secret"),
        creator_name=row.get("creator_name"),
        is_closed=row.get("is_closed", False),
        close_reason=row.get("close_reason"),
        follow_up_to=str(row["follow_up_to"]) if row.get("follow_up_to") else None,
        fork_of=str(row["fork_of"]) if row.get("fork_of") else None,
        min_participants=row.get("min_participants"),
        max_participants=row.get("max_participants"),
        short_id=row.get("short_id"),
        suggestion_deadline=row["suggestion_deadline"].isoformat() if row.get("suggestion_deadline") else None,
        allow_pre_ranking=row.get("allow_pre_ranking", True),
        auto_close_after=row.get("auto_close_after"),
        details=row.get("details"),
        location_mode=row.get("location_mode"),
        location_value=row.get("location_value"),
        location_options=row.get("location_options"),
        resolved_location=row.get("resolved_location"),
        time_mode=row.get("time_mode"),
        time_value=row.get("time_value"),
        time_options=row.get("time_options"),
        resolved_time=row.get("resolved_time"),
        is_sub_poll=row.get("is_sub_poll", False),
        sub_poll_role=row.get("sub_poll_role"),
        parent_participation_poll_id=str(row["parent_participation_poll_id"]) if row.get("parent_participation_poll_id") else None,
        location_suggestions_deadline_minutes=row.get("location_suggestions_deadline_minutes"),
        location_preferences_deadline_minutes=row.get("location_preferences_deadline_minutes"),
        time_suggestions_deadline_minutes=row.get("time_suggestions_deadline_minutes"),
        time_preferences_deadline_minutes=row.get("time_preferences_deadline_minutes"),
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
    )


def _row_to_vote(row: dict) -> VoteResponse:
    """Convert a database row to a VoteResponse."""
    return VoteResponse(
        id=str(row["id"]),
        poll_id=str(row["poll_id"]),
        vote_type=row["vote_type"],
        yes_no_choice=row.get("yes_no_choice"),
        ranked_choices=row.get("ranked_choices"),
        suggestions=row.get("suggestions"),
        is_abstain=row.get("is_abstain", False),
        voter_name=row.get("voter_name"),
        min_participants=row.get("min_participants"),
        max_participants=row.get("max_participants"),
        voter_day_time_windows=row.get("voter_day_time_windows"),
        voter_duration=row.get("voter_duration"),
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
    )


def _create_sub_polls_for_field(
    conn, now, parent_id, parent_title, creator_secret, creator_name,
    field: str, mode: str | None, options: list[str] | None,
    suggestions_deadline_minutes: int | None,
    preferences_deadline_minutes: int | None,
) -> None:
    """Create sub-polls for a location or time field on a participation poll."""
    import json
    from datetime import timedelta

    if not mode or mode == "set":
        return

    label = "Location" if field == "location" else "Time"
    sub_title = f"{label} for {parent_title}"

    if mode == "preferences":
        # Create a ranked_choice sub-poll with creator-provided options
        deadline_mins = preferences_deadline_minutes or 10
        deadline = now + timedelta(minutes=deadline_mins)
        conn.execute(
            """
            INSERT INTO polls (title, poll_type, options, response_deadline,
                               creator_secret, creator_name,
                               is_sub_poll, sub_poll_role,
                               parent_participation_poll_id,
                               is_closed, created_at, updated_at)
            VALUES (%(title)s, 'ranked_choice', %(options)s::jsonb, %(deadline)s,
                    %(creator_secret)s, %(creator_name)s,
                    true, %(sub_poll_role)s,
                    %(parent_id)s,
                    false, %(now)s, %(now)s)
            """,
            {
                "title": sub_title,
                "options": json.dumps(options),
                "deadline": deadline.isoformat(),
                "creator_secret": creator_secret,
                "creator_name": creator_name,
                "sub_poll_role": f"{field}_preferences",
                "parent_id": parent_id,
                "now": now,
            },
        )

    elif mode == "suggestions":
        # Create a ranked_choice sub-poll with a suggestion phase
        sug_deadline_mins = suggestions_deadline_minutes or 10
        sug_deadline = now + timedelta(minutes=sug_deadline_mins)
        pref_deadline_mins = preferences_deadline_minutes or 10
        pref_deadline = sug_deadline + timedelta(minutes=pref_deadline_mins)
        conn.execute(
            """
            INSERT INTO polls (title, poll_type, response_deadline,
                               suggestion_deadline,
                               creator_secret, creator_name,
                               is_sub_poll, sub_poll_role,
                               parent_participation_poll_id,
                               is_closed, created_at, updated_at)
            VALUES (%(title)s, 'ranked_choice', %(pref_deadline)s,
                    %(sug_deadline)s,
                    %(creator_secret)s, %(creator_name)s,
                    true, %(sub_poll_role)s,
                    %(parent_id)s,
                    false, %(now)s, %(now)s)
            """,
            {
                "title": sub_title,
                "pref_deadline": pref_deadline.isoformat(),
                "sug_deadline": sug_deadline.isoformat(),
                "creator_secret": creator_secret,
                "creator_name": creator_name,
                "sub_poll_role": f"{field}_suggestions",
                "parent_id": parent_id,
                "now": now,
            },
        )


def _resolve_sub_poll_winner(conn, poll_row: dict) -> None:
    """When a ranked_choice sub-poll with sub_poll_role closes, resolve the winner
    back to the parent participation poll."""
    sub_poll_role = poll_row.get("sub_poll_role")
    parent_id = poll_row.get("parent_participation_poll_id")
    if not sub_poll_role or not parent_id or not sub_poll_role.endswith("_preferences"):
        return

    # Determine which field to resolve
    field = sub_poll_role.replace("_preferences", "")  # "location" or "time"
    if field not in ("location", "time"):
        return
    resolved_column = f"resolved_{field}"

    # Get the winner from the ranked choice results
    from algorithms.ranked_choice import calculate_ranked_choice_winner
    import json

    poll_id = str(poll_row["id"])
    votes = conn.execute(
        "SELECT * FROM votes WHERE poll_id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchall()

    raw_options = poll_row.get("options")
    poll_options = []
    if raw_options:
        poll_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

    if not poll_options:
        return

    # Uncontested: single option wins automatically without votes
    if len(poll_options) == 1 and poll_row.get("close_reason") == "uncontested":
        winner = poll_options[0]
    elif not votes:
        return
    else:
        result = calculate_ranked_choice_winner([dict(v) for v in votes], poll_options)
        winner = result.winner

    if winner:
        conn.execute(
            f"UPDATE polls SET {resolved_column} = %(winner)s, updated_at = %(now)s WHERE id = %(parent_id)s",
            {
                "winner": result.winner,
                "now": datetime.now(timezone.utc),
                "parent_id": str(parent_id),
            },
        )


# --- Poll CRUD ---


@router.post("", response_model=PollResponse, status_code=201)
def create_poll(req: CreatePollRequest):
    """Create a new poll."""
    import json
    now = datetime.now(timezone.utc)

    # Validation for location/time fields
    if req.location_mode or req.time_mode:
        if req.poll_type != PollType.participation:
            raise HTTPException(status_code=400, detail="Location/time modes are only valid for participation polls")

    if req.location_mode == "set" and not req.location_value:
        raise HTTPException(status_code=400, detail="Location value is required for 'set' mode")
    if req.time_mode == "set" and not req.time_value:
        raise HTTPException(status_code=400, detail="Time value is required for 'set' mode")
    if req.location_mode == "preferences" and (not req.location_options or len(req.location_options) < 2):
        raise HTTPException(status_code=400, detail="At least 2 location options are required for 'preferences' mode")
    if req.time_mode == "preferences" and (not req.time_options or len(req.time_options) < 2):
        raise HTTPException(status_code=400, detail="At least 2 time options are required for 'preferences' mode")

    with get_db() as conn:
        # Determine resolved values for 'set' mode
        resolved_location = req.location_value if req.location_mode == "set" else None
        resolved_time = req.time_value if req.time_mode == "set" else None

        row = conn.execute(
            """
            INSERT INTO polls (title, poll_type, options, response_deadline,
                               creator_secret, creator_name, follow_up_to,
                               fork_of, min_participants, max_participants,
                               suggestion_deadline, allow_pre_ranking,
                               auto_close_after, details,
                               location_mode, location_value, resolved_location,
                               time_mode, time_value, resolved_time,
                               location_options, time_options,
                               location_suggestions_deadline_minutes,
                               location_preferences_deadline_minutes,
                               time_suggestions_deadline_minutes,
                               time_preferences_deadline_minutes,
                               day_time_windows, duration_window,
                               category, options_metadata,
                               reference_latitude, reference_longitude,
                               reference_location_label,
                               is_auto_title,
                               min_responses, show_preliminary_results,
                               created_at, updated_at)
            VALUES (%(title)s, %(poll_type)s, %(options)s::jsonb, %(response_deadline)s,
                    %(creator_secret)s, %(creator_name)s, %(follow_up_to)s,
                    %(fork_of)s, %(min_participants)s, %(max_participants)s,
                    %(suggestion_deadline)s, %(allow_pre_ranking)s,
                    %(auto_close_after)s, %(details)s,
                    %(location_mode)s, %(location_value)s, %(resolved_location)s,
                    %(time_mode)s, %(time_value)s, %(resolved_time)s,
                    %(location_options)s, %(time_options)s,
                    %(location_suggestions_deadline_minutes)s,
                    %(location_preferences_deadline_minutes)s,
                    %(time_suggestions_deadline_minutes)s,
                    %(time_preferences_deadline_minutes)s,
                    %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
                    %(category)s, %(options_metadata)s::jsonb,
                    %(reference_latitude)s, %(reference_longitude)s,
                    %(reference_location_label)s,
                    %(is_auto_title)s,
                    %(min_responses)s, %(show_preliminary_results)s,
                    %(now)s, %(now)s)
            RETURNING *
            """,
            {
                "title": req.title,
                "poll_type": req.poll_type.value,
                "options": _json_or_none(req.options),
                "response_deadline": req.response_deadline,
                "creator_secret": req.creator_secret,
                "creator_name": req.creator_name,
                "follow_up_to": req.follow_up_to,
                "fork_of": req.fork_of,
                "min_participants": req.min_participants,
                "max_participants": req.max_participants,
                "suggestion_deadline": req.suggestion_deadline,
                "allow_pre_ranking": req.allow_pre_ranking,
                "auto_close_after": req.auto_close_after,
                "details": req.details,
                "location_mode": req.location_mode,
                "location_value": req.location_value,
                "resolved_location": resolved_location,
                "time_mode": req.time_mode,
                "time_value": req.time_value,
                "resolved_time": resolved_time,
                "location_options": req.location_options,
                "time_options": req.time_options,
                "location_suggestions_deadline_minutes": req.location_suggestions_deadline_minutes,
                "location_preferences_deadline_minutes": req.location_preferences_deadline_minutes,
                "time_suggestions_deadline_minutes": req.time_suggestions_deadline_minutes,
                "time_preferences_deadline_minutes": req.time_preferences_deadline_minutes,
                "day_time_windows": json.dumps(req.day_time_windows) if req.day_time_windows else None,
                "duration_window": json.dumps(req.duration_window) if req.duration_window else None,
                "category": req.category or "custom",
                "options_metadata": json.dumps(req.options_metadata) if req.options_metadata else None,
                "reference_latitude": req.reference_latitude,
                "reference_longitude": req.reference_longitude,
                "reference_location_label": req.reference_location_label,
                "is_auto_title": req.is_auto_title,
                "min_responses": req.min_responses,
                "show_preliminary_results": req.show_preliminary_results,
                "now": now,
            },
        ).fetchone()

        parent_id = str(row["id"])

        # Create sub-polls for location/time fields
        _create_sub_polls_for_field(
            conn, now, parent_id, req.title, req.creator_secret, req.creator_name,
            "location", req.location_mode, req.location_options,
            req.location_suggestions_deadline_minutes,
            req.location_preferences_deadline_minutes,
        )
        _create_sub_polls_for_field(
            conn, now, parent_id, req.title, req.creator_secret, req.creator_name,
            "time", req.time_mode, req.time_options,
            req.time_suggestions_deadline_minutes,
            req.time_preferences_deadline_minutes,
        )

    return _row_to_poll(row)


@router.get("/{poll_id}/sub-polls", response_model=list[PollResponse])
def get_sub_polls(poll_id: str):
    """Get all sub-polls for a participation poll."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM polls WHERE parent_participation_poll_id = %(poll_id)s ORDER BY created_at",
            {"poll_id": poll_id},
        ).fetchall()
    return [_row_to_poll(r) for r in rows]


@router.get("/dev/all-ids")
def get_all_poll_ids():
    """Return all poll IDs in the database. Only available in dev environments."""
    if os.environ.get("DISABLE_RATE_LIMIT") != "1":
        raise HTTPException(status_code=404, detail="Not found")
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id FROM polls WHERE is_sub_poll = false ORDER BY created_at DESC"
        ).fetchall()
    return {"poll_ids": [row["id"] for row in rows]}


@router.get("/find-duplicate", response_model=PollResponse)
def find_duplicate_poll(title: str, follow_up_to: str):
    """Find an existing poll that is a follow-up to the same parent with the same title (case-insensitive)."""
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT * FROM polls
            WHERE LOWER(title) = LOWER(%(title)s)
              AND follow_up_to = %(follow_up_to)s
            ORDER BY created_at ASC
            LIMIT 1
            """,
            {"title": title, "follow_up_to": follow_up_to},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No duplicate poll found")
    return _row_to_poll(row)


@router.get("/by-short-id/{short_id}", response_model=PollResponse)
def get_poll_by_short_id(short_id: str):
    """Get a poll by its short ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM polls WHERE short_id = %(short_id)s",
            {"short_id": short_id},
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Poll not found")
    return _row_to_poll(row)


@router.get("/{poll_id}", response_model=PollResponse)
def get_poll(poll_id: str):
    """Get a poll by UUID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
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


@router.post("/{poll_id}/votes", response_model=VoteResponse, status_code=201)
def submit_vote(poll_id: str, req: SubmitVoteRequest):
    """Submit a vote on a poll."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Verify poll exists and is open
        poll = conn.execute(
            "SELECT id, is_closed, poll_type, suggestion_deadline, allow_pre_ranking FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if not poll:
            raise HTTPException(status_code=404, detail="Poll not found")
        if poll["is_closed"]:
            raise HTTPException(status_code=400, detail="Poll is closed")

        has_suggestion_phase = poll.get("suggestion_deadline") is not None

        # Enforce suggestion phase timing
        if has_suggestion_phase:
            now_check = datetime.now(timezone.utc)
            cutoff = poll["suggestion_deadline"]
            in_suggestion_phase = now_check < cutoff

            # Reject new suggestions after cutoff
            if not in_suggestion_phase and req.suggestions:
                raise HTTPException(status_code=400, detail="Suggestions cutoff has passed")

            # Reject rankings before cutoff if pre-ranking is disabled
            if in_suggestion_phase and req.ranked_choices:
                if not poll["allow_pre_ranking"]:
                    raise HTTPException(status_code=400, detail="Rankings not allowed until suggestions cutoff")

        # Validate vote structure
        try:
            validate_vote(
                poll_type=poll["poll_type"],
                vote_type=req.vote_type,
                yes_no_choice=req.yes_no_choice,
                ranked_choices=req.ranked_choices,
                suggestions=req.suggestions,
                is_abstain=req.is_abstain,
                has_suggestion_phase=has_suggestion_phase,
            )
        except VoteValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))

        import json
        row = conn.execute(
            """
            INSERT INTO votes (poll_id, vote_type, yes_no_choice, ranked_choices,
                               suggestions, is_abstain, voter_name,
                               min_participants, max_participants,
                               voter_day_time_windows, voter_duration,
                               created_at, updated_at)
            VALUES (%(poll_id)s, %(vote_type)s, %(yes_no_choice)s, %(ranked_choices)s,
                    %(suggestions)s, %(is_abstain)s, %(voter_name)s,
                    %(min_participants)s, %(max_participants)s,
                    %(voter_day_time_windows)s::jsonb, %(voter_duration)s::jsonb,
                    %(now)s, %(now)s)
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "vote_type": req.vote_type,
                "yes_no_choice": req.yes_no_choice,
                "ranked_choices": req.ranked_choices,
                "suggestions": req.suggestions,
                "is_abstain": req.is_abstain,
                "voter_name": req.voter_name,
                "min_participants": req.min_participants,
                "max_participants": req.max_participants,
                "voter_day_time_windows": json.dumps(req.voter_day_time_windows) if req.voter_day_time_windows else None,
                "voter_duration": json.dumps(req.voter_duration) if req.voter_duration else None,
                "now": now,
            },
        ).fetchone()

        # Merge suggestion metadata into poll's options_metadata
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
    return _row_to_vote(row)


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


@router.put("/{poll_id}/votes/{vote_id}", response_model=VoteResponse)
def edit_vote(poll_id: str, vote_id: str, req: EditVoteRequest):
    """Edit an existing vote."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Verify vote exists and belongs to this poll
        existing = conn.execute(
            "SELECT id FROM votes WHERE id = %(vote_id)s AND poll_id = %(poll_id)s",
            {"vote_id": vote_id, "poll_id": poll_id},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Vote not found")

        # Check poll is still open and get suggestion phase info
        poll = conn.execute(
            "SELECT is_closed, poll_type, suggestion_deadline, allow_pre_ranking FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if poll and poll["is_closed"]:
            raise HTTPException(status_code=400, detail="Poll is closed")

        has_suggestion_phase = poll.get("suggestion_deadline") is not None
        if has_suggestion_phase:
            now_check = datetime.now(timezone.utc)
            cutoff = poll["suggestion_deadline"]
            in_suggestion_phase = now_check < cutoff

            # Reject new suggestions after cutoff
            if not in_suggestion_phase and req.suggestions:
                raise HTTPException(status_code=400, detail="Suggestions cutoff has passed")

            # Reject rankings before cutoff if pre-ranking is disabled
            if in_suggestion_phase and req.ranked_choices and not poll["allow_pre_ranking"]:
                raise HTTPException(status_code=400, detail="Rankings not allowed until suggestions cutoff")

            # Prevent unsuggesting options that others have ranked
            if in_suggestion_phase and req.suggestions is not None:
                old_vote = conn.execute(
                    "SELECT suggestions FROM votes WHERE id = %(vote_id)s",
                    {"vote_id": vote_id},
                ).fetchone()
                if old_vote and old_vote["suggestions"]:
                    removed = set(old_vote["suggestions"]) - set(req.suggestions)
                    if removed:
                        # Check if any other voter has ranked any of the removed suggestions
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
                suggestions = %(suggestions)s,
                is_abstain = %(is_abstain)s,
                voter_name = %(voter_name)s,
                min_participants = %(min_participants)s,
                max_participants = %(max_participants)s,
                voter_day_time_windows = %(voter_day_time_windows)s::jsonb,
                voter_duration = %(voter_duration)s::jsonb,
                updated_at = %(now)s
            WHERE id = %(vote_id)s AND poll_id = %(poll_id)s
            RETURNING *
            """,
            {
                "yes_no_choice": req.yes_no_choice,
                "ranked_choices": req.ranked_choices,
                "suggestions": req.suggestions,
                "is_abstain": req.is_abstain,
                "voter_name": req.voter_name,
                "min_participants": req.min_participants,
                "max_participants": req.max_participants,
                "voter_day_time_windows": json.dumps(req.voter_day_time_windows) if req.voter_day_time_windows else None,
                "voter_duration": json.dumps(req.voter_duration) if req.voter_duration else None,
                "now": now,
                "vote_id": vote_id,
                "poll_id": poll_id,
            },
        ).fetchone()
        _check_auto_close(conn, poll_id)
    return _row_to_vote(row)


# --- Results ---


@router.get("/{poll_id}/results", response_model=PollResultsResponse)
def get_results(poll_id: str):
    """Compute and return poll results."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        poll = conn.execute(
            "SELECT * FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
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
            # Re-read poll to get updated options
            poll = conn.execute(
                "SELECT * FROM polls WHERE id = %(poll_id)s",
                {"poll_id": poll_id},
            ).fetchone()

        # Auto-close ranked_choice sub-polls when deadline passes, and resolve winner
        if (
            poll["poll_type"] == "ranked_choice"
            and poll.get("sub_poll_role")
            and not poll["is_closed"]
            and poll.get("response_deadline")
            and poll["response_deadline"] <= now
        ):
            result = conn.execute(
                """UPDATE polls SET is_closed = true, close_reason = 'deadline', updated_at = %(now)s
                   WHERE id = %(poll_id)s AND is_closed = false""",
                {"poll_id": poll_id, "now": now},
            )
            if result.rowcount == 1:
                _resolve_sub_poll_winner(conn, dict(poll))

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
            min_participants=poll.get("min_participants"),
            max_participants=poll.get("max_participants"),
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
                min_participants=poll.get("min_participants"),
                max_participants=poll.get("max_participants"),
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

        # Only compute ranked choice results if there are options to rank
        rc_rounds = []
        rc_winner = None
        ranking_votes = [v for v in votes if v.get("ranked_choices")]
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
            min_participants=poll.get("min_participants"),
            max_participants=poll.get("max_participants"),
            winner=rc_winner,
            ranked_choice_winner=rc_winner,
            ranked_choice_rounds=rc_rounds if rc_rounds else None,
            suggestion_counts=suggestion_counts_data,
        )

    if poll_type == "participation":
        # Count yes/no/abstain votes
        yes_count = 0
        no_count = 0
        abstain_count = 0
        for v in votes:
            if v.get("is_abstain"):
                abstain_count += 1
            elif v.get("yes_no_choice") == "yes":
                yes_count += 1
            elif v.get("yes_no_choice") == "no":
                no_count += 1

        # Run the participation priority algorithm to get actual participants
        vote_dicts = [dict(v) for v in votes]
        participating = calculate_participating_voters(vote_dicts)
        participating_count = len(participating)

        # Calculate time slot rounds if poll has day_time_windows
        time_slot_rounds_data = None
        if poll.get("day_time_windows"):
            from algorithms.time_slots import calculate_time_slot_rounds
            ts_rounds = calculate_time_slot_rounds(dict(poll), vote_dicts)
            if ts_rounds:
                time_slot_rounds_data = [
                    TimeSlotResponse(
                        round_number=r.round_number,
                        slot_date=r.slot_date,
                        slot_start_time=r.slot_start_time,
                        slot_end_time=r.slot_end_time,
                        duration_hours=r.duration_hours,
                        participant_count=r.participant_count,
                        participant_vote_ids=r.participant_vote_ids,
                        participant_names=r.participant_names,
                        is_winner=r.is_winner,
                    )
                    for r in ts_rounds
                ]

        return PollResultsResponse(
            poll_id=str(poll["id"]),
            title=poll["title"],
            poll_type=poll_type,
            created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
            response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
            options=poll.get("options"),
            yes_count=participating_count,
            no_count=no_count,
            abstain_count=abstain_count,
            total_yes_votes=yes_count,
            total_votes=len(votes),
            min_participants=poll.get("min_participants"),
            max_participants=poll.get("max_participants"),
            time_slot_rounds=time_slot_rounds_data,
            participating_vote_ids=[p.vote_id for p in participating],
            participating_voter_names=[p.voter_name for p in participating if p.voter_name],
        )

    # For other poll types, return basic structure (to be extended in later phases)
    return PollResultsResponse(
        poll_id=str(poll["id"]),
        title=poll["title"],
        poll_type=poll_type,
        created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
        response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
        options=poll.get("options"),
        total_votes=len(votes),
        min_participants=poll.get("min_participants"),
        max_participants=poll.get("max_participants"),
    )


@router.get("/{poll_id}/participants", response_model=list[ParticipantResponse])
def get_participants(poll_id: str):
    """Get the list of participating voters determined by the priority algorithm."""
    with get_db() as conn:
        poll = conn.execute(
            "SELECT poll_type FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if not poll:
            raise HTTPException(status_code=404, detail="Poll not found")
        if poll["poll_type"] != "participation":
            return []

        votes = conn.execute(
            "SELECT * FROM votes WHERE poll_id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchall()

    vote_dicts = [dict(v) for v in votes]
    participating = calculate_participating_voters(vote_dicts)
    return [
        ParticipantResponse(vote_id=p.vote_id, voter_name=p.voter_name)
        for p in participating
    ]


# --- Poll management ---


@router.post("/{poll_id}/close", response_model=PollResponse)
def close_poll(poll_id: str, req: ClosePollRequest):
    """Close a poll. Requires creator_secret."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        row = conn.execute(
            """
            UPDATE polls
            SET is_closed = true,
                close_reason = %(close_reason)s,
                updated_at = %(now)s
            WHERE id = %(poll_id)s AND creator_secret = %(creator_secret)s
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "creator_secret": req.creator_secret,
                "close_reason": req.close_reason.value,
                "now": now,
            },
        ).fetchone()
        if not row:
            raise HTTPException(status_code=403, detail="Invalid creator secret or poll not found")

        # If closing a ranked_choice poll with suggestion phase, finalize options
        if row["poll_type"] == "ranked_choice" and row.get("suggestion_deadline"):
            _finalize_suggestion_options(conn, poll_id, now)

        # If this is a ranked_choice sub-poll, resolve the winner to parent
        if row["poll_type"] == "ranked_choice" and row.get("sub_poll_role"):
            _resolve_sub_poll_winner(conn, dict(row))

    return _row_to_poll(row)


@router.post("/{poll_id}/reopen", response_model=PollResponse)
def reopen_poll(poll_id: str, req: ReopenPollRequest):
    """Reopen a closed poll. Requires creator_secret."""
    with get_db() as conn:
        row = conn.execute(
            """
            UPDATE polls
            SET is_closed = false,
                close_reason = NULL,
                updated_at = %(now)s
            WHERE id = %(poll_id)s AND creator_secret = %(creator_secret)s
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "creator_secret": req.creator_secret,
                "now": datetime.now(timezone.utc),
            },
        ).fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Invalid creator secret or poll not found")
    return _row_to_poll(row)


# --- Accessible polls ---


@router.post("/accessible", response_model=list[PollResponse])
def get_accessible_polls(req: AccessiblePollsRequest):
    """Get polls by a list of IDs (used by frontend to fetch polls the browser has access to)."""
    if not req.poll_ids:
        return []
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM polls
               WHERE id = ANY(%(poll_ids)s)
                 AND (is_sub_poll = false OR is_sub_poll IS NULL)
               ORDER BY created_at DESC""",
            {"poll_ids": req.poll_ids},
        ).fetchall()

        if not req.include_results:
            return [_row_to_poll(r) for r in rows]

        closed_poll_ids = []
        open_poll_ids = []
        for r in rows:
            is_closed = r.get("is_closed", False)
            deadline = r.get("response_deadline")
            deadline_passed = deadline and deadline <= now
            if is_closed or deadline_passed:
                closed_poll_ids.append(str(r["id"]))
            else:
                open_poll_ids.append(str(r["id"]))

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

        # Count responses for open polls and fetch votes for those meeting min_responses
        response_counts: dict[str, int] = {}
        if open_poll_ids:
            count_rows = conn.execute(
                "SELECT poll_id, COUNT(*) as cnt FROM votes WHERE poll_id = ANY(%(poll_ids)s) GROUP BY poll_id",
                {"poll_ids": open_poll_ids},
            ).fetchall()
            for cr in count_rows:
                response_counts[str(cr["poll_id"])] = cr["cnt"]

        # Identify open polls that qualify for preliminary results
        preliminary_poll_ids = []
        rows_by_id = {str(r["id"]): r for r in rows}
        for pid in open_poll_ids:
            r = rows_by_id[pid]
            min_resp = r.get("min_responses")
            show_prelim = r.get("show_preliminary_results", True)
            if show_prelim and min_resp is not None and response_counts.get(pid, 0) >= min_resp:
                preliminary_poll_ids.append(pid)

        if preliminary_poll_ids:
            prelim_vote_rows = conn.execute(
                "SELECT * FROM votes WHERE poll_id = ANY(%(poll_ids)s)",
                {"poll_ids": preliminary_poll_ids},
            ).fetchall()
            for v in prelim_vote_rows:
                pid = str(v["poll_id"])
                if pid not in votes_by_poll:
                    votes_by_poll[pid] = []
                votes_by_poll[pid].append(v)

    results = []
    for r in rows:
        poll_resp = _row_to_poll(r)
        pid = str(r["id"])
        if pid in votes_by_poll:
            try:
                poll_resp.results = _compute_results(dict(r), votes_by_poll[pid])
            except Exception:
                logger.warning("Failed to compute results for poll %s", pid, exc_info=True)
        if pid in response_counts:
            poll_resp.response_count = response_counts[pid]
        results.append(poll_resp)
    return results


@router.post("/related", response_model=RelatedPollsResponse)
def get_related_polls(req: RelatedPollsRequest):
    """Discover all polls related to the input IDs via follow-up/fork chains."""
    if not req.poll_ids:
        return RelatedPollsResponse(
            all_related_ids=[], original_count=0, discovered_count=0
        )
    with get_db() as conn:
        # Fetch all polls that have any relationship (or are in the input set)
        rows = conn.execute(
            """SELECT id, follow_up_to, fork_of FROM polls
               WHERE follow_up_to IS NOT NULL
                  OR fork_of IS NOT NULL
                  OR id = ANY(%(poll_ids)s)""",
            {"poll_ids": req.poll_ids},
        ).fetchall()

    all_polls = [
        PollRelation(
            id=str(r["id"]),
            follow_up_to=str(r["follow_up_to"]) if r["follow_up_to"] else None,
            fork_of=str(r["fork_of"]) if r["fork_of"] else None,
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


def _json_or_none(val: list[str] | None) -> str | None:
    """Convert a list to a JSON string for JSONB column, or None."""
    if val is None:
        return None
    import json
    return json.dumps(val)
