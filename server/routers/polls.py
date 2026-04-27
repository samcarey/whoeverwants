"""Poll API endpoints."""

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException

from database import get_db
from models import (
    AccessiblePollsRequest,
    MultipollResponse,
    PollResponse,
    PollResultsResponse,
    RelatedPollsRequest,
    RelatedPollsResponse,
    VoteResponse,
)
from algorithms.related_polls import PollRelation, get_all_related_poll_ids
from services.polls import (
    _SELECT_POLL_FULL,
    _compute_results,
    _fetch_poll_full,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _row_to_poll,
    _row_to_vote,
)

router = APIRouter(prefix="/api/polls", tags=["polls"])


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


