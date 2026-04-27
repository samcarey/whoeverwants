"""Poll API endpoints."""

import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException

from database import get_db
from models import (
    AccessiblePollsRequest,
    ClosePollRequest,
    CreatePollRequest,
    CutoffSuggestionsRequest,
    EditVoteRequest,
    PollResponse,
    PollResultsResponse,
    PollType,
    RankedChoiceRoundResponse,
    RelatedPollsRequest,
    RelatedPollsResponse,
    ReopenPollRequest,
    SubmitVoteRequest,
    UpdateThreadTitleRequest,
    VoteResponse,
)
from algorithms.suggestion import count_suggestion_votes
from algorithms.ranked_choice import calculate_ranked_choice_winner
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.related_polls import PollRelation, get_all_related_poll_ids
from algorithms.yes_no import count_yes_no_votes

router = APIRouter(prefix="/api/polls", tags=["polls"])


# SELECTs feeding `_row_to_poll` use this prefix so the row carries the
# wrapper's `follow_up_to` (the source of truth for thread chains). Pair it
# with a WHERE clause that references the `p` alias.
_SELECT_POLL_WITH_MULTIPOLL_PREFIX = """
    SELECT p.*, mp.follow_up_to AS multipoll_follow_up_to
      FROM polls p
      LEFT JOIN multipolls mp ON p.multipoll_id = mp.id
"""


def _attach_multipoll_chain_fields(conn, row) -> dict | None:
    """Annotate a RETURNING * row with multipoll_follow_up_to via a separate
    lookup. Use this for UPDATE/INSERT paths; SELECT paths should use
    `_SELECT_POLL_WITH_MULTIPOLL_PREFIX` instead."""
    if row is None:
        return None
    row = dict(row)
    multipoll_id = row.get("multipoll_id")
    if not multipoll_id:
        row["multipoll_follow_up_to"] = None
        return row
    mp_row = conn.execute(
        "SELECT follow_up_to FROM multipolls WHERE id = %(id)s",
        {"id": str(multipoll_id)},
    ).fetchone()
    row["multipoll_follow_up_to"] = (
        str(mp_row["follow_up_to"])
        if mp_row and mp_row.get("follow_up_to")
        else None
    )
    return row


def _check_auto_close(conn, poll_id: str) -> None:
    """Auto-close a poll based on auto_close_after (respondent count)."""
    poll = conn.execute(
        "SELECT is_closed, auto_close_after FROM polls WHERE id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchone()
    if not poll or poll["is_closed"] or poll["auto_close_after"] is None:
        return

    respondent_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM votes WHERE poll_id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchone()["cnt"]
    if respondent_count >= poll["auto_close_after"]:
        conn.execute(
            "UPDATE polls SET is_closed = true, close_reason = 'max_capacity' WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
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

    poll = conn.execute(
        "SELECT * FROM polls WHERE id = %(poll_id)s",
        {"poll_id": poll_id},
    ).fetchone()
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
        short_id=row.get("short_id"),
        suggestion_deadline=row["suggestion_deadline"].isoformat() if row.get("suggestion_deadline") else None,
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
        thread_title=row.get("thread_title"),
        multipoll_id=str(row["multipoll_id"]) if row.get("multipoll_id") else None,
        sub_poll_index=row.get("sub_poll_index"),
        # Populated by _SELECT_POLL_WITH_MULTIPOLL_PREFIX (or the post-mutation
        # _attach_multipoll_chain_fields). Other callers get None.
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


@router.post("", response_model=PollResponse, status_code=201)
def create_poll(req: CreatePollRequest):
    """Create a new poll.

    Legacy single-poll endpoint. Phase 2.2 routes most creates through
    `POST /api/multipolls`; this remains for direct API consumers and the
    pre-Phase-4 fallback path.
    """
    import json
    now = datetime.now(timezone.utc)

    # Validate deadlines are in the future and suggestion cutoff < voting cutoff
    response_dt = (
        datetime.fromisoformat(req.response_deadline.replace("Z", "+00:00"))
        if req.response_deadline else None
    )
    if response_dt and response_dt <= now:
        raise HTTPException(status_code=400, detail="Voting deadline must be in the future")

    if req.suggestion_deadline:
        suggestion_dt = datetime.fromisoformat(req.suggestion_deadline.replace("Z", "+00:00"))
        if suggestion_dt <= now:
            raise HTTPException(status_code=400, detail="Suggestion deadline must be in the future")
        if response_dt and suggestion_dt >= response_dt:
            raise HTTPException(status_code=400, detail="Suggestion deadline must be before the voting deadline")

    if req.suggestion_deadline_minutes and response_dt:
        max_suggestion_dt = now + timedelta(minutes=req.suggestion_deadline_minutes)
        if max_suggestion_dt >= response_dt:
            raise HTTPException(status_code=400, detail="Suggestion deadline must be before the voting deadline")

    with get_db() as conn:
        # thread_title: explicit request wins; otherwise inherit from the
        # follow_up_to parent via a COALESCE subquery in the INSERT (below)
        # so we avoid a round-trip.

        row = conn.execute(
            """
            INSERT INTO polls (title, poll_type, options, response_deadline,
                               creator_secret, creator_name, follow_up_to,
                               suggestion_deadline, suggestion_deadline_minutes,
                               allow_pre_ranking,
                               auto_close_after, details,
                               day_time_windows, duration_window,
                               category, options_metadata,
                               reference_latitude, reference_longitude,
                               reference_location_label,
                               is_auto_title,
                               min_responses, show_preliminary_results,
                               min_availability_percent,
                               thread_title,
                               created_at, updated_at)
            VALUES (%(title)s, %(poll_type)s, %(options)s::jsonb, %(response_deadline)s,
                    %(creator_secret)s, %(creator_name)s, %(follow_up_to)s,
                    %(suggestion_deadline)s, %(suggestion_deadline_minutes)s,
                    %(allow_pre_ranking)s,
                    %(auto_close_after)s, %(details)s,
                    %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
                    %(category)s, %(options_metadata)s::jsonb,
                    %(reference_latitude)s, %(reference_longitude)s,
                    %(reference_location_label)s,
                    %(is_auto_title)s,
                    %(min_responses)s, %(show_preliminary_results)s,
                    %(min_availability_percent)s,
                    COALESCE(%(thread_title)s, (SELECT thread_title FROM polls WHERE id = %(follow_up_to)s)),
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
                # If suggestion_deadline_minutes is set, defer the deadline until first suggestion
                "suggestion_deadline": None if req.suggestion_deadline_minutes else req.suggestion_deadline,
                "suggestion_deadline_minutes": req.suggestion_deadline_minutes,
                "allow_pre_ranking": req.allow_pre_ranking,
                "auto_close_after": req.auto_close_after,
                "details": req.details,
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
                "min_availability_percent": req.min_availability_percent if req.poll_type == PollType.time else None,
                "thread_title": req.thread_title,
                "now": now,
            },
        ).fetchone()

    return _row_to_poll(row)


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
    """Find an existing poll that is a follow-up to the same parent with the same title (case-insensitive)."""
    with get_db() as conn:
        row = conn.execute(
            _SELECT_POLL_WITH_MULTIPOLL_PREFIX
            + """
            WHERE LOWER(p.title) = LOWER(%(title)s)
              AND p.follow_up_to = %(follow_up_to)s
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
    """Get a poll by its short ID."""
    with get_db() as conn:
        row = conn.execute(
            _SELECT_POLL_WITH_MULTIPOLL_PREFIX + " WHERE p.short_id = %(short_id)s",
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
            _SELECT_POLL_WITH_MULTIPOLL_PREFIX + " WHERE p.id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
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
            row = conn.execute(
                _SELECT_POLL_WITH_MULTIPOLL_PREFIX + " WHERE p.id = %(poll_id)s",
                {"poll_id": poll_id},
            ).fetchone()

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
        "SELECT id, is_closed, poll_type, suggestion_deadline, suggestion_deadline_minutes, allow_pre_ranking, response_deadline FROM polls WHERE id = %(poll_id)s",
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
        conn.execute(
            "UPDATE polls SET suggestion_deadline = %(deadline)s, updated_at = %(now)s WHERE id = %(poll_id)s",
            {"deadline": new_deadline, "now": now, "poll_id": poll_id},
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
        "SELECT is_closed, poll_type, suggestion_deadline, suggestion_deadline_minutes, allow_pre_ranking FROM polls WHERE id = %(poll_id)s",
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


@router.post("/{poll_id}/votes", response_model=VoteResponse, status_code=201)
def submit_vote(poll_id: str, req: SubmitVoteRequest):
    """Submit a vote on a poll."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        row = _submit_vote_to_poll(conn, poll_id, req, now)
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
        row = _edit_vote_on_poll(conn, poll_id, vote_id, req, now)
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

        # For time polls: finalize time slot options when availability deadline passes
        if (
            poll["poll_type"] == "time"
            and poll.get("suggestion_deadline")
            and poll["suggestion_deadline"] <= now
            and not poll.get("options")  # Not yet finalized
        ):
            _finalize_time_slots(conn, poll_id, now)
            poll = conn.execute(
                "SELECT * FROM polls WHERE id = %(poll_id)s",
                {"poll_id": poll_id},
            ).fetchone()

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

        row = _attach_multipoll_chain_fields(conn, row)

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
        row = _attach_multipoll_chain_fields(conn, row)
    return _row_to_poll(row)


@router.post("/{poll_id}/thread-title", response_model=PollResponse)
def update_thread_title(poll_id: str, req: UpdateThreadTitleRequest):
    """Update (or clear) a poll's thread_title override. No auth required —
    anyone with the poll's link can rename the thread. An empty or
    whitespace-only value clears the override (stored as NULL), causing the
    thread UI to fall back to the participant-names default title."""
    normalized = (req.thread_title or "").strip()
    value: str | None = normalized if normalized else None
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
                "now": datetime.now(timezone.utc),
            },
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        row = _attach_multipoll_chain_fields(conn, row)
    return _row_to_poll(row)


@router.post("/{poll_id}/cutoff-suggestions", response_model=PollResponse)
def cutoff_suggestions(poll_id: str, req: CutoffSuggestionsRequest):
    """End the suggestion phase immediately. Requires creator_secret."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Single query: update only if suggestions exist and deadline hasn't passed
        row = conn.execute(
            """
            UPDATE polls
            SET suggestion_deadline = %(now)s,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
              AND creator_secret = %(creator_secret)s
              AND (
                (suggestion_deadline IS NOT NULL AND suggestion_deadline > %(now)s)
                OR (suggestion_deadline IS NULL AND suggestion_deadline_minutes IS NOT NULL)
              )
              AND EXISTS (
                SELECT 1 FROM votes
                WHERE poll_id = %(poll_id)s
                  AND suggestions IS NOT NULL
                  AND array_length(suggestions, 1) > 0
              )
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "creator_secret": req.creator_secret,
                "now": now,
            },
        ).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="No suggestions to cutoff, invalid creator secret, or suggestion phase already ended")

        _finalize_suggestion_options(conn, poll_id, now)

        row = _attach_multipoll_chain_fields(conn, row)

    return _row_to_poll(row)


@router.post("/{poll_id}/cutoff-availability", response_model=PollResponse)
def cutoff_availability(poll_id: str, req: CutoffSuggestionsRequest):
    """End the availability phase of a time poll immediately. Requires creator_secret."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Verify it's a time poll and availability phase hasn't ended
        row = conn.execute(
            """
            UPDATE polls
            SET suggestion_deadline = %(now)s,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
              AND poll_type = 'time'
              AND creator_secret = %(creator_secret)s
              AND (
                (suggestion_deadline IS NOT NULL AND suggestion_deadline > %(now)s)
                OR (suggestion_deadline IS NULL AND suggestion_deadline_minutes IS NOT NULL)
              )
              AND EXISTS (
                SELECT 1 FROM votes
                WHERE poll_id = %(poll_id)s
                  AND voter_day_time_windows IS NOT NULL
              )
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "creator_secret": req.creator_secret,
                "now": now,
            },
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=400,
                detail="No availability entries to cutoff, invalid creator secret, or availability phase already ended"
            )

        _finalize_time_slots(conn, poll_id, now)

    # Re-read to get updated options
    with get_db() as conn:
        row = conn.execute(
            _SELECT_POLL_WITH_MULTIPOLL_PREFIX + " WHERE p.id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
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
            _SELECT_POLL_WITH_MULTIPOLL_PREFIX
            + """ WHERE p.id = ANY(%(poll_ids)s)
                ORDER BY p.created_at DESC""",
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

        # Include inline results when show_preliminary_results is true AND
        # (min_responses is unset OR met). Matches the per-poll /results
        # endpoint, so the thread page doesn't need a follow-up per-card fetch.
        preliminary_poll_ids = []
        rows_by_id = {str(r["id"]): r for r in rows}
        for pid in open_poll_ids:
            r = rows_by_id[pid]
            min_resp = r.get("min_responses")
            show_prelim = r.get("show_preliminary_results", True)
            if show_prelim and (min_resp is None or response_counts.get(pid, 0) >= min_resp):
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

        # Fetch unique voter names per poll for thread title generation.
        # First, extract names from votes already loaded in memory.
        voter_names_by_poll: dict[str, list[str]] = {}
        for pid, votes in votes_by_poll.items():
            names = sorted({
                v["voter_name"] for v in votes
                if v.get("voter_name") and v["voter_name"] != ""
            })
            if names:
                voter_names_by_poll[pid] = names

        # Only query DB for polls whose votes weren't already fetched.
        remaining_poll_ids = [
            str(r["id"]) for r in rows if str(r["id"]) not in votes_by_poll
        ]
        if remaining_poll_ids:
            vn_rows = conn.execute(
                """SELECT poll_id, array_agg(DISTINCT voter_name ORDER BY voter_name) as names
                   FROM votes
                   WHERE poll_id = ANY(%(poll_ids)s) AND voter_name IS NOT NULL AND voter_name != ''
                   GROUP BY poll_id""",
                {"poll_ids": remaining_poll_ids},
            ).fetchall()
            for vn in vn_rows:
                voter_names_by_poll[str(vn["poll_id"])] = vn["names"]

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
        if pid in voter_names_by_poll:
            poll_resp.voter_names = voter_names_by_poll[pid]
        results.append(poll_resp)
    return results


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
