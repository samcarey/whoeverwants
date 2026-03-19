"""Poll API endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import get_db
from models import (
    AccessiblePollsRequest,
    ClosePollRequest,
    CreatePollRequest,
    EditVoteRequest,
    PollResponse,
    PollResultsResponse,
    RankedChoiceRoundResponse,
    ReopenPollRequest,
    SubmitVoteRequest,
    VoteResponse,
)
from algorithms.nomination import count_nomination_votes
from algorithms.ranked_choice import calculate_ranked_choice_winner
from algorithms.vote_validation import VoteValidationError, validate_vote
from algorithms.yes_no import count_yes_no_votes

router = APIRouter(prefix="/api/polls", tags=["polls"])


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
    )


def _row_to_vote(row: dict) -> VoteResponse:
    """Convert a database row to a VoteResponse."""
    return VoteResponse(
        id=str(row["id"]),
        poll_id=str(row["poll_id"]),
        vote_type=row["vote_type"],
        yes_no_choice=row.get("yes_no_choice"),
        ranked_choices=row.get("ranked_choices"),
        nominations=row.get("nominations"),
        is_abstain=row.get("is_abstain", False),
        voter_name=row.get("voter_name"),
        min_participants=row.get("min_participants"),
        max_participants=row.get("max_participants"),
        created_at=row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
        updated_at=row["updated_at"].isoformat() if isinstance(row["updated_at"], datetime) else str(row["updated_at"]),
    )


# --- Poll CRUD ---


@router.post("", response_model=PollResponse, status_code=201)
def create_poll(req: CreatePollRequest):
    """Create a new poll."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        row = conn.execute(
            """
            INSERT INTO polls (title, poll_type, options, response_deadline,
                               creator_secret, creator_name, follow_up_to,
                               fork_of, min_participants, max_participants,
                               created_at, updated_at)
            VALUES (%(title)s, %(poll_type)s, %(options)s::jsonb, %(response_deadline)s,
                    %(creator_secret)s, %(creator_name)s, %(follow_up_to)s,
                    %(fork_of)s, %(min_participants)s, %(max_participants)s,
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
                "now": now,
            },
        ).fetchone()
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
    return _row_to_poll(row)


# --- Voting ---


@router.post("/{poll_id}/votes", response_model=VoteResponse, status_code=201)
def submit_vote(poll_id: str, req: SubmitVoteRequest):
    """Submit a vote on a poll."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        # Verify poll exists and is open
        poll = conn.execute(
            "SELECT id, is_closed, poll_type FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if not poll:
            raise HTTPException(status_code=404, detail="Poll not found")
        if poll["is_closed"]:
            raise HTTPException(status_code=400, detail="Poll is closed")

        # Validate vote structure
        try:
            validate_vote(
                poll_type=poll["poll_type"],
                vote_type=req.vote_type,
                yes_no_choice=req.yes_no_choice,
                ranked_choices=req.ranked_choices,
                nominations=req.nominations,
                is_abstain=req.is_abstain,
            )
        except VoteValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))

        row = conn.execute(
            """
            INSERT INTO votes (poll_id, vote_type, yes_no_choice, ranked_choices,
                               nominations, is_abstain, voter_name,
                               min_participants, max_participants,
                               created_at, updated_at)
            VALUES (%(poll_id)s, %(vote_type)s, %(yes_no_choice)s, %(ranked_choices)s,
                    %(nominations)s, %(is_abstain)s, %(voter_name)s,
                    %(min_participants)s, %(max_participants)s,
                    %(now)s, %(now)s)
            RETURNING *
            """,
            {
                "poll_id": poll_id,
                "vote_type": req.vote_type,
                "yes_no_choice": req.yes_no_choice,
                "ranked_choices": req.ranked_choices,
                "nominations": req.nominations,
                "is_abstain": req.is_abstain,
                "voter_name": req.voter_name,
                "min_participants": req.min_participants,
                "max_participants": req.max_participants,
                "now": now,
            },
        ).fetchone()
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

        # Check poll is still open
        poll = conn.execute(
            "SELECT is_closed FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if poll and poll["is_closed"]:
            raise HTTPException(status_code=400, detail="Poll is closed")

        row = conn.execute(
            """
            UPDATE votes
            SET yes_no_choice = %(yes_no_choice)s,
                ranked_choices = %(ranked_choices)s,
                nominations = %(nominations)s,
                is_abstain = %(is_abstain)s,
                voter_name = %(voter_name)s,
                min_participants = %(min_participants)s,
                max_participants = %(max_participants)s,
                updated_at = %(now)s
            WHERE id = %(vote_id)s AND poll_id = %(poll_id)s
            RETURNING *
            """,
            {
                "yes_no_choice": req.yes_no_choice,
                "ranked_choices": req.ranked_choices,
                "nominations": req.nominations,
                "is_abstain": req.is_abstain,
                "voter_name": req.voter_name,
                "min_participants": req.min_participants,
                "max_participants": req.max_participants,
                "now": now,
                "vote_id": vote_id,
                "poll_id": poll_id,
            },
        ).fetchone()
    return _row_to_vote(row)


# --- Results ---


@router.get("/{poll_id}/results", response_model=PollResultsResponse)
def get_results(poll_id: str):
    """Compute and return poll results."""
    with get_db() as conn:
        poll = conn.execute(
            "SELECT * FROM polls WHERE id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchone()
        if not poll:
            raise HTTPException(status_code=404, detail="Poll not found")

        votes = conn.execute(
            "SELECT * FROM votes WHERE poll_id = %(poll_id)s",
            {"poll_id": poll_id},
        ).fetchall()

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

    if poll_type == "nomination":
        # Parse poll options from JSONB
        import json
        raw_options = poll.get("options")
        poll_options = None
        if raw_options:
            poll_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        result = count_nomination_votes(votes, poll_options=poll_options)
        return PollResultsResponse(
            poll_id=str(poll["id"]),
            title=poll["title"],
            poll_type=poll_type,
            created_at=poll["created_at"].isoformat() if isinstance(poll["created_at"], datetime) else str(poll["created_at"]),
            response_deadline=poll["response_deadline"].isoformat() if poll.get("response_deadline") else None,
            options=poll_options,
            total_votes=result.total_votes,
            abstain_count=result.abstain_count,
            min_participants=poll.get("min_participants"),
            max_participants=poll.get("max_participants"),
            nomination_counts=[
                {"option": nc.option, "count": nc.count}
                for nc in result.nomination_counts
            ],
        )

    if poll_type == "ranked_choice":
        import json
        raw_options = poll.get("options")
        poll_options = None
        if raw_options:
            poll_options = json.loads(raw_options) if isinstance(raw_options, str) else raw_options

        result = calculate_ranked_choice_winner(votes, poll_options or [])

        # Build round response objects
        rc_rounds = []
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
            winner=result.winner,
            ranked_choice_winner=result.winner,
            ranked_choice_rounds=rc_rounds,
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


# --- Poll management ---


@router.post("/{poll_id}/close", response_model=PollResponse)
def close_poll(poll_id: str, req: ClosePollRequest):
    """Close a poll. Requires creator_secret."""
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
                "now": datetime.now(timezone.utc),
            },
        ).fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Invalid creator secret or poll not found")
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
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM polls WHERE id = ANY(%(poll_ids)s) ORDER BY created_at DESC",
            {"poll_ids": req.poll_ids},
        ).fetchall()
    return [_row_to_poll(r) for r in rows]


# --- Helpers ---


def _json_or_none(val: list[str] | None) -> str | None:
    """Convert a list to a JSON string for JSONB column, or None."""
    if val is None:
        return None
    import json
    return json.dumps(val)
