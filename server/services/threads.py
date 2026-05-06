"""Shared helpers for poll/thread aggregation queries.

Phase B.3 extracted the heavy aggregation body of
`POST /api/questions/accessible` here so both the legacy endpoint and the
new `/api/threads/*` endpoints can build identical PollResponse[] payloads
from a list of poll_ids — without each router re-implementing the
inline-results / per-question voter_names / poll-level voter aggregation
logic.

`polls_for_poll_ids(conn, poll_ids, include_results)` is the canonical entry:
caller resolves which poll_ids to surface (via question_ids → poll_id
lookup, thread_id-grouped fanout, or any other path) and the helper does the
rest.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from models import PollResponse
from services.questions import _compute_results

logger = logging.getLogger(__name__)


def polls_for_poll_ids(
    conn,
    poll_ids: list[str],
    *,
    include_results: bool,
) -> list[PollResponse]:
    """Build PollResponse[] (with inline results / voter aggregates) for the
    given poll_ids. Order: most recently created first. Empty list in →
    empty list out (no DB roundtrip)."""
    # Local import keeps services/* free of router cycles.
    from routers.polls import _compute_poll_voter_data, _row_to_poll

    if not poll_ids:
        return []

    now = datetime.now(timezone.utc)

    poll_rows = conn.execute(
        """SELECT * FROM polls
            WHERE id = ANY(%(ids)s)
            ORDER BY created_at DESC""",
        {"ids": poll_ids},
    ).fetchall()
    if not poll_rows:
        return []

    poll_ids_present = [str(r["id"]) for r in poll_rows]

    question_rows = conn.execute(
        """SELECT * FROM questions
            WHERE poll_id = ANY(%(ids)s)
            ORDER BY poll_id, question_index NULLS LAST, created_at""",
        {"ids": poll_ids_present},
    ).fetchall()
    questions_by_mp: dict[str, list] = {}
    for sp in question_rows:
        questions_by_mp.setdefault(str(sp["poll_id"]), []).append(sp)
    all_question_ids = [str(sp["id"]) for sp in question_rows]

    wrappers_by_id = {str(mp["id"]): mp for mp in poll_rows}
    closed_question_ids: list[str] = []
    open_question_ids: list[str] = []
    for sp in question_rows:
        mp = wrappers_by_id.get(str(sp["poll_id"]))
        is_closed = bool(mp and mp.get("is_closed"))
        deadline = mp.get("response_deadline") if mp else None
        deadline_passed = bool(deadline and deadline <= now)
        target = closed_question_ids if (is_closed or deadline_passed) else open_question_ids
        target.append(str(sp["id"]))

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

    voter_data_by_mp: dict[str, tuple[list[str], int]] = {}
    for mp_id in poll_ids_present:
        voter_data_by_mp[mp_id] = _compute_poll_voter_data(conn, mp_id)

    responses: list[PollResponse] = []
    for mp_row in poll_rows:
        mp_id = str(mp_row["id"])
        sp_rows = questions_by_mp.get(mp_id, [])
        voter_names, anon_count = voter_data_by_mp.get(mp_id, ([], 0))
        mp_resp = _row_to_poll(mp_row, sp_rows, voter_names, anon_count)
        if include_results:
            for sp_resp in mp_resp.questions:
                pid = sp_resp.id
                if pid in votes_by_question:
                    sp_row = question_rows_by_id[pid]
                    enriched = dict(sp_row)
                    enriched["response_deadline"] = mp_row.get("response_deadline")
                    enriched["close_reason"] = mp_row.get("close_reason")
                    enriched["is_closed"] = mp_row.get("is_closed", False)
                    enriched["suggestion_deadline"] = mp_row.get("prephase_deadline")
                    try:
                        sp_resp.results = _compute_results(enriched, votes_by_question[pid])
                    except Exception:
                        logger.warning(
                            "Failed to compute results for question %s", pid, exc_info=True,
                        )
                if pid in response_counts:
                    sp_resp.response_count = response_counts[pid]
                if pid in voter_names_by_question:
                    sp_resp.voter_names = voter_names_by_question[pid]
        responses.append(mp_resp)
    return responses


def thread_ids_for_question_ids(conn, question_ids: list[str]) -> list[str]:
    """Resolve a list of question_ids to the set of thread_ids that own them.
    Skips question_ids without a poll_id (post-Phase-4 there shouldn't be any)
    and polls without a thread_id (post-migration-100 there aren't any). Order
    is unstable — the caller deduplicates."""
    if not question_ids:
        return []
    rows = conn.execute(
        """SELECT DISTINCT mp.thread_id
             FROM questions p
             JOIN polls mp ON p.poll_id = mp.id
            WHERE p.id = ANY(%(ids)s)
              AND mp.thread_id IS NOT NULL""",
        {"ids": question_ids},
    ).fetchall()
    return [str(r["thread_id"]) for r in rows]


def poll_ids_for_thread_ids(conn, thread_ids: list[str]) -> list[str]:
    """Resolve a list of thread_ids to every poll_id that belongs to those
    threads. Used by the threads endpoints to fan out from the user's
    'these threads matter' set to every poll the user should see."""
    if not thread_ids:
        return []
    rows = conn.execute(
        """SELECT id FROM polls WHERE thread_id = ANY(%(ids)s)""",
        {"ids": thread_ids},
    ).fetchall()
    return [str(r["id"]) for r in rows]


def resolve_thread_id_from_route_id(conn, route_id: str) -> str | None:
    """Resolve a route id (path param of `/t/<routeId>`) to a `threads.id`.

    Phase B.3 supports four forms:
      - threads.short_id (preferred when present)
      - threads.id (uuid, e.g. fresh threads with NULL short_id)
      - polls.short_id (Phase A → Phase B.3 fallback: threadShortId today
        is the root poll's short_id)
      - polls.id (uuid fallback for unkeyed routing)

    Returns None if no thread can be resolved.
    """
    if not route_id:
        return None

    row = conn.execute(
        "SELECT id FROM threads WHERE short_id = %(rid)s",
        {"rid": route_id},
    ).fetchone()
    if row:
        return str(row["id"])

    is_uuid_like = (len(route_id) == 36 and route_id.count("-") == 4)
    if is_uuid_like:
        row = conn.execute(
            "SELECT id FROM threads WHERE id = %(rid)s::uuid",
            {"rid": route_id},
        ).fetchone()
        if row:
            return str(row["id"])

    row = conn.execute(
        "SELECT thread_id FROM polls WHERE short_id = %(rid)s AND thread_id IS NOT NULL",
        {"rid": route_id},
    ).fetchone()
    if row:
        return str(row["thread_id"])

    if is_uuid_like:
        row = conn.execute(
            "SELECT thread_id FROM polls WHERE id = %(rid)s::uuid AND thread_id IS NOT NULL",
            {"rid": route_id},
        ).fetchone()
        if row:
            return str(row["thread_id"])

    return None
