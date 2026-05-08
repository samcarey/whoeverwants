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
from dataclasses import dataclass, field
from datetime import datetime, timezone

from models import PollResponse
from services.questions import _compute_results

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Visibility rule
# ---------------------------------------------------------------------------
#
# A poll P in thread T is visible to browser B iff EITHER:
#   1. B has a thread_members row for T AND
#      (P.is_closed = false OR P.closed_at >= members.joined_at), OR
#   2. (transitional bridge) The legacy `accessible_question_ids` list
#      passed by the FE contains a question_id whose poll lives in T.
#      Treated as THREAD-level access (every poll in T visible, no
#      closed_at filter) — pre-B.3 votes never wrote browser_id, so the
#      localStorage list is the only access signal those users have
#      until they re-establish membership by voting. Applies to
#      /api/threads/mine only.
#
# `closed_at` proxy: we use `polls.updated_at`, which the existing close
# trigger refreshes on every `is_closed` flip. Subsequent edits to a closed
# poll bump updated_at forward; that makes the rule slightly more permissive
# (a previously hidden closed poll becomes visible if touched after the
# user joins), which fails open.


@dataclass
class UserVisibility:
    """Snapshot of one browser's visibility state.

    Built once per request via `load_user_visibility`; consumed by the
    visibility filter and by candidate-set construction.
    """

    browser_id: str | None
    # thread_id → joined_at watermark (drives closed_at filter for
    # member-thread polls).
    joined_by_thread: dict[str, datetime] = field(default_factory=dict)
    # thread_ids the legacy accessible_question_ids list resolves to.
    # Treated as thread-level access with no closed_at filter for
    # backwards compatibility during the rollout window.
    bridged_thread_ids: set[str] = field(default_factory=set)


def load_user_visibility(
    conn,
    browser_id: str | None,
    *,
    legacy_question_ids: list[str] | None = None,
) -> UserVisibility:
    """Read every membership/access signal for one browser in a single
    place so callers can construct candidate sets and filter against the
    same data without re-querying."""
    joined_by_thread: dict[str, datetime] = {}
    if browser_id:
        rows = conn.execute(
            "SELECT thread_id, joined_at FROM thread_members "
            "WHERE browser_id = %(bid)s",
            {"bid": browser_id},
        ).fetchall()
        for r in rows:
            joined_by_thread[str(r["thread_id"])] = r["joined_at"]

    bridged_thread_ids: set[str] = set()
    if legacy_question_ids:
        bridged_thread_ids = set(
            thread_ids_for_question_ids(conn, legacy_question_ids)
        )

    return UserVisibility(
        browser_id=browser_id,
        joined_by_thread=joined_by_thread,
        bridged_thread_ids=bridged_thread_ids,
    )


def filter_visible_polls(
    conn,
    candidate_poll_ids: list[str],
    visibility: UserVisibility,
) -> list[str]:
    """Apply the visibility rule. Returns the subset of
    `candidate_poll_ids` visible to `visibility.browser_id` per the rule
    documented above. Empty in → empty out; preserves no specific order."""
    if not candidate_poll_ids:
        return []
    rows = conn.execute(
        "SELECT id, thread_id, is_closed, updated_at "
        "FROM polls WHERE id = ANY(%(ids)s)",
        {"ids": candidate_poll_ids},
    ).fetchall()
    visible: list[str] = []
    for r in rows:
        pid = str(r["id"])
        tid = str(r["thread_id"]) if r.get("thread_id") else None
        # Thread-level legacy bridge: every poll in the thread visible
        # without a closed_at filter (per Phase B.3 backwards-compat).
        if tid and tid in visibility.bridged_thread_ids:
            visible.append(pid)
            continue
        # Membership: visible if open OR closed-after-joined_at.
        if not tid or tid not in visibility.joined_by_thread:
            continue
        if not r["is_closed"]:
            visible.append(pid)
            continue
        closed_at = r.get("updated_at")
        joined_at = visibility.joined_by_thread[tid]
        if closed_at and closed_at >= joined_at:
            visible.append(pid)
    return visible


def grant_thread_membership_inline(
    conn,
    thread_id: str,
    browser_id: str | None,
) -> None:
    """Write `thread_members(thread_id, browser_id)` in the same
    transaction as the read that's about to use it. Used by
    `/api/threads/by-route-id/{id}` so any visit to a thread URL
    establishes membership before the visibility filter runs — no
    chicken-and-egg with a separate round-trip.

    No-op when `browser_id` is missing. ON CONFLICT preserves the original
    `joined_at` watermark across re-visits, which is load-bearing for the
    closed-before-join filter (a re-visit must NOT advance `joined_at`,
    or polls closed after the first visit but before the latest one
    would silently disappear).
    """
    if not browser_id:
        return
    conn.execute(
        """
        INSERT INTO thread_members (thread_id, browser_id)
        VALUES (%(t)s::uuid, %(b)s)
        ON CONFLICT (thread_id, browser_id) DO NOTHING
        """,
        {"t": thread_id, "b": browser_id},
    )


def polls_for_poll_ids(
    conn,
    poll_ids: list[str],
    *,
    include_results: bool,
) -> list[PollResponse]:
    """Build PollResponse[] (with inline results / voter aggregates) for the
    given poll_ids. Order: most recently created first. Empty list in →
    empty list out (no DB roundtrip)."""
    # Local import keeps services/* free of router cycles. Reusing
    # `_SELECT_POLLS_WITH_THREAD` (rather than re-writing the JOIN) is what
    # actually keeps this read in lockstep with the rest of the polls reads —
    # the previous local copy quietly went stale after Migration 105 moved
    # `thread_title` from polls to threads, returning thread_title=null on
    # every /api/threads/* read.
    from routers.polls import (
        _SELECT_POLLS_WITH_THREAD,
        _compute_poll_voter_data,
        _row_to_poll,
    )

    if not poll_ids:
        return []

    now = datetime.now(timezone.utc)

    poll_rows = conn.execute(
        f"{_SELECT_POLLS_WITH_THREAD} "
        "WHERE polls.id = ANY(%(ids)s) "
        "ORDER BY polls.created_at DESC",
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
        # Pre-seed empty vote lists for every prelim-eligible question so the
        # results-attachment loop below picks them up even when 0 votes have
        # been cast — `_compute_results` is well-defined on an empty list and
        # returns the "no votes yet" shape that the FE expects.
        for pid in preliminary_question_ids:
            votes_by_question.setdefault(pid, [])
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
