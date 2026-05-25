"""Shared helpers for poll/group aggregation queries.

Phase B.3 extracted the heavy aggregation body of
`POST /api/questions/accessible` here so both the legacy endpoint and the
new `/api/groups/*` endpoints can build identical PollResponse[] payloads
from a list of poll_ids — without each router re-implementing the
inline-results / per-question voter_names / poll-level voter aggregation
logic.

`polls_for_poll_ids(conn, poll_ids, include_results)` is the canonical entry:
caller resolves which poll_ids to surface (via question_ids → poll_id
lookup, group_id-grouped fanout, or any other path) and the helper does the
rest.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from models import PollResponse
from services.questions import _compute_results

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Visibility rule
# ---------------------------------------------------------------------------
#
# A poll P in group T is visible to browser B iff EITHER:
#   1. B has a group_members row for T AND
#      (P.is_closed = false OR P.closed_at >= members.joined_at), OR
#   2. (transitional bridge, public groups only) The legacy
#      `accessible_question_ids` list passed by the FE contains a
#      question_id whose poll lives in T AND T.privacy = 'public'.
#      Treated as GROUP-level access (every poll in T visible, no
#      closed_at filter) — pre-B.3 votes never wrote browser_id, so the
#      localStorage list is the only access signal those users have
#      until they re-establish membership by voting. Applies to
#      /api/groups/mine only. Private groups bypass this bridge entirely;
#      see Phase E in docs/auth-access-model.md.
#
# `closed_at` proxy: we use `polls.updated_at`, which the existing close
# trigger refreshes on every `is_closed` flip. Subsequent edits to a closed
# poll bump updated_at forward; that makes the rule slightly more permissive
# (a previously hidden closed poll becomes visible if touched after the
# user joins), which fails open.
#
# Phase E (group privacy) consequences:
#   * The legacy bridge filters to public groups only — see
#     `load_user_visibility` below.
#   * `grant_group_membership_inline` skips writing for private groups —
#     callers (the `/by-route-id` read endpoint) pass the resolved
#     `privacy` so we don't need a separate DB lookup. Private groups
#     require an explicit Phase F/G invite or approval to join.
#   * Non-members visiting a private group's `/by-route-id` get 404
#     directly from the router — visibility is enforced at the read
#     boundary, not silently via filtering.


@dataclass
class UserVisibility:
    """Snapshot of one caller's visibility state.

    Built once per request via `load_user_visibility`; consumed by the
    visibility filter and by candidate-set construction.

    The caller is identified by (browser_id, user_id). For anonymous
    callers user_id is None — `joined_by_group` is keyed only on the
    current browser_id. For signed-in callers, memberships from EVERY
    browser linked to this user_id are unioned in, with the earliest
    joined_at retained per group (the closed-before-join filter is
    most permissive that way — the user "joined" when their earliest
    browser did, not when they signed in on this device).
    """

    browser_id: str | None
    user_id: str | None
    # group_id → joined_at watermark (drives closed_at filter for
    # member-group polls). For signed-in users this is the MIN
    # joined_at across all browsers linked to user_id.
    joined_by_group: dict[str, datetime] = field(default_factory=dict)
    # group_ids the legacy accessible_question_ids list resolves to.
    # Treated as group-level access with no closed_at filter for
    # backwards compatibility during the rollout window.
    bridged_group_ids: set[str] = field(default_factory=set)


def load_user_visibility(
    conn,
    browser_id: str | None,
    *,
    user_id: str | None = None,
    legacy_question_ids: list[str] | None = None,
) -> UserVisibility:
    """Read every membership/access signal for one caller in a single
    place so route handlers can construct candidate sets and filter
    against the same data without re-querying.

    When `user_id` is set, the membership query walks `user_browsers`
    to find every browser_id linked to this user and unions their
    `group_members` rows. This is what makes "same user signed in on
    Browser A and Browser B see the same groups" work — without the
    user-aware lookup, each browser would only see groups it joined
    directly, and a fresh sign-in on a second device would show an
    empty home list.

    Per-group `joined_at` is the MIN across all linked browsers'
    rows: the most permissive choice for the closed-before-join
    filter (a user who's been a member via any browser since t=0
    sees polls that closed after t=0 regardless of which device
    they're viewing from).
    """
    joined_by_group: dict[str, datetime] = {}
    if browser_id or user_id:
        # Build the candidate browser_id set: the current one + every
        # browser the user has signed in on. Empty for fully-anonymous
        # requests (no browser_id, no user_id — shouldn't happen with
        # BrowserIdMiddleware in place, but defensive).
        rows = conn.execute(
            """
            SELECT group_id, MIN(joined_at) AS joined_at
              FROM group_members
             WHERE browser_id = %(bid)s::uuid
                OR (
                    %(uid)s::uuid IS NOT NULL
                    AND browser_id IN (
                      SELECT browser_id FROM user_browsers
                       WHERE user_id = %(uid)s::uuid
                    )
                )
             GROUP BY group_id
            """,
            {"bid": browser_id, "uid": user_id},
        ).fetchall()
        for r in rows:
            joined_by_group[str(r["group_id"])] = r["joined_at"]

    bridged_group_ids: set[str] = set()
    if legacy_question_ids:
        candidate = set(group_ids_for_question_ids(conn, legacy_question_ids))
        if candidate:
            # Phase E: the legacy access bridge applies to PUBLIC groups
            # only. Private groups require an explicit `group_members`
            # row — pre-B.3 localStorage signals don't qualify, so a
            # legacy voter on a group that later flipped private (or that
            # was created private post-Phase-E) stops seeing it via the
            # bridge. The membership leg above is unaffected — members
            # see private groups regardless of privacy state.
            public_rows = conn.execute(
                "SELECT id FROM groups WHERE id = ANY(%(ids)s) "
                "AND privacy = 'public'",
                {"ids": list(candidate)},
            ).fetchall()
            bridged_group_ids = {str(r["id"]) for r in public_rows}

    return UserVisibility(
        browser_id=browser_id,
        user_id=user_id,
        joined_by_group=joined_by_group,
        bridged_group_ids=bridged_group_ids,
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
        "SELECT id, group_id, is_closed, updated_at "
        "FROM polls WHERE id = ANY(%(ids)s)",
        {"ids": candidate_poll_ids},
    ).fetchall()
    visible: list[str] = []
    for r in rows:
        pid = str(r["id"])
        tid = str(r["group_id"]) if r.get("group_id") else None
        # Group-level legacy bridge: every poll in the group visible
        # without a closed_at filter (per Phase B.3 backwards-compat).
        if tid and tid in visibility.bridged_group_ids:
            visible.append(pid)
            continue
        # Membership: visible if open OR closed-after-joined_at.
        if not tid or tid not in visibility.joined_by_group:
            continue
        if not r["is_closed"]:
            visible.append(pid)
            continue
        closed_at = r.get("updated_at")
        joined_at = visibility.joined_by_group[tid]
        if closed_at and closed_at >= joined_at:
            visible.append(pid)
    return visible


def grant_group_membership_inline(
    conn,
    group_id: str,
    browser_id: str | None,
    *,
    privacy: str | None = None,
) -> None:
    """Write `group_members(group_id, browser_id)` in the same
    transaction as the read that's about to use it. Used by
    `/api/groups/by-route-id/{id}` so any visit to a group URL
    establishes membership before the visibility filter runs — no
    chicken-and-egg with a separate round-trip.

    No-op when `browser_id` is missing. ON CONFLICT preserves the original
    `joined_at` watermark across re-visits, which is load-bearing for the
    closed-before-join filter (a re-visit must NOT advance `joined_at`,
    or polls closed after the first visit but before the latest one
    would silently disappear).

    Phase E: when `privacy='private'` the auto-join is skipped — the URL
    is not enough to join a private group; an explicit Phase F approval
    or Phase G invite redemption must write the row instead. Callers
    should pass the resolved privacy so we don't need a separate DB
    lookup. Treating an omitted `privacy` as 'public' preserves the
    pre-Phase-E behavior for any caller that hasn't been updated yet.
    """
    if not browser_id:
        return
    if privacy == "private":
        return
    conn.execute(
        """
        INSERT INTO group_members (group_id, browser_id)
        VALUES (%(t)s::uuid, %(b)s)
        ON CONFLICT (group_id, browser_id) DO NOTHING
        """,
        {"t": group_id, "b": browser_id},
    )


def get_group_metadata(conn, group_id: str) -> dict | None:
    """Read a group's privacy + creator_user_id in a single round-trip.
    Used by the read-side endpoints (Phase E) to decide whether to
    auto-join, 404 non-members, or accept the visit. Returns None when
    the group doesn't exist.
    """
    row = conn.execute(
        "SELECT privacy, creator_user_id FROM groups WHERE id = %(id)s",
        {"id": group_id},
    ).fetchone()
    if not row:
        return None
    return {
        "privacy": row["privacy"],
        "creator_user_id": (
            str(row["creator_user_id"]) if row.get("creator_user_id") else None
        ),
    }


def group_display_name(conn, group_id: str, *, override: str | None) -> str | None:
    """The group's human-facing name, or None when it has no name and no
    named participants yet. Resolution order mirrors what the FE renders
    as the group title:
      1. The `groups.title` override (`override` arg) when set.
      2. The deduplicated list of participant names (poll creators +
         voters across the group), creators first, in creation order.

    The participant query only runs when no override is set, so the
    common (named-group) path is a single string check.
    """
    if override and override.strip():
        return override.strip()
    rows = conn.execute(
        """
        SELECT name FROM (
            SELECT p.creator_name AS name, 0 AS kind, p.created_at AS ts
              FROM polls p
             WHERE p.group_id = %(gid)s::uuid
            UNION ALL
            SELECT v.voter_name AS name, 1 AS kind, v.created_at AS ts
              FROM votes v
              JOIN questions q ON v.question_id = q.id
              JOIN polls p ON q.poll_id = p.id
             WHERE p.group_id = %(gid)s::uuid
        ) participants
        WHERE name IS NOT NULL AND btrim(name) <> ''
        ORDER BY kind, ts
        """,
        {"gid": group_id},
    ).fetchall()
    seen: list[str] = []
    for r in rows:
        nm = (r["name"] or "").strip()
        if nm and nm not in seen:
            seen.append(nm)
    return ", ".join(seen) if seen else None


def group_name_phrase(conn, group_id: str, *, override: str | None) -> str:
    """Ready-to-interpolate group reference for notification titles
    ("... in <phrase>"): the group name in double quotes, or the unquoted
    literal "your group" when there's no name and no named participants."""
    name = group_display_name(conn, group_id, override=override)
    return f'"{name}"' if name else "your group"


def is_caller_member_of_group(
    conn,
    group_id: str,
    *,
    browser_id: str | None,
    user_id: str | None,
) -> bool:
    """True iff (browser_id OR any browser linked to user_id) has a
    `group_members` row for `group_id`. Mirrors the union the visibility
    filter does — used by the read endpoints to gate access to private
    groups BEFORE running the full visibility pass."""
    if not browser_id and not user_id:
        return False
    row = conn.execute(
        """
        SELECT 1 FROM group_members
         WHERE group_id = %(t)s::uuid
           AND (
                browser_id = %(b)s::uuid
                OR (
                    %(u)s::uuid IS NOT NULL
                    AND browser_id IN (
                        SELECT browser_id FROM user_browsers
                         WHERE user_id = %(u)s::uuid
                    )
                )
           )
         LIMIT 1
        """,
        {"t": group_id, "b": browser_id, "u": user_id},
    ).fetchone()
    return row is not None


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
    # `_SELECT_POLLS_WITH_GROUP` (rather than re-writing the JOIN) is what
    # actually keeps this read in lockstep with the rest of the polls reads —
    # the previous local copy quietly went stale after Migration 105 moved
    # `group_title` from polls to groups, returning group_title=null on
    # every /api/groups/* read.
    from routers.polls import (
        _SELECT_POLLS_WITH_GROUP,
        _compute_poll_voter_data,
        _row_to_poll,
    )

    if not poll_ids:
        return []

    now = datetime.now(timezone.utc)

    poll_rows = conn.execute(
        f"{_SELECT_POLLS_WITH_GROUP} "
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

    voter_data_by_mp: dict[str, tuple[list[str], int, int]] = {}
    for mp_id in poll_ids_present:
        voter_data_by_mp[mp_id] = _compute_poll_voter_data(conn, mp_id)

    responses: list[PollResponse] = []
    for mp_row in poll_rows:
        mp_id = str(mp_row["id"])
        sp_rows = questions_by_mp.get(mp_id, [])
        voter_names, anon_count, viewed_ignored = voter_data_by_mp.get(mp_id, ([], 0, 0))
        mp_resp = _row_to_poll(mp_row, sp_rows, voter_names, anon_count, viewed_ignored)
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
                        # Skip tentative time-slot generation: this path serves the
                        # /api/groups/mine + /by-route-id/{id} hot loop (5s page
                        # refresh tick), and the per-question results endpoint
                        # populates tentative options separately for the ballot UI.
                        sp_resp.results = _compute_results(
                            enriched,
                            votes_by_question[pid],
                            include_tentative_time_options=False,
                        )
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


def group_ids_for_question_ids(conn, question_ids: list[str]) -> list[str]:
    """Resolve a list of question_ids to the set of group_ids that own them.
    Skips question_ids without a poll_id (post-Phase-4 there shouldn't be any)
    and polls without a group_id (post-migration-100 there aren't any).
    Silently drops any non-UUID values from the caller's list before the query
    — the FE's localStorage accessible-question list can pick up corrupted
    entries (legacy bugs, manual edits) and one bad id used to 500 the whole
    `/api/groups/mine` request, wedging the home page. Filtering here is
    pragmatic resilience; the FE should also validate before sending.
    Order is unstable — the caller deduplicates."""
    valid_ids = [qid for qid in question_ids if _is_uuid_like(qid)]
    if not valid_ids:
        return []
    rows = conn.execute(
        """SELECT DISTINCT mp.group_id
             FROM questions p
             JOIN polls mp ON p.poll_id = mp.id
            WHERE p.id = ANY(%(ids)s)
              AND mp.group_id IS NOT NULL""",
        {"ids": valid_ids},
    ).fetchall()
    return [str(r["group_id"]) for r in rows]


_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _is_uuid_like(value: str) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.match(value))


def require_uuid(value: str, label: str = "id") -> None:
    """Reject malformed UUIDs with 404 before the DB query 500s on
    `psycopg.errors.InvalidTextRepresentation`. `label` distinguishes
    user-visible causes ("poll_id" / "question_id" / "browser_id")."""
    from fastapi import HTTPException
    if not _is_uuid_like(value):
        raise HTTPException(status_code=404, detail=f"Invalid {label}")


def poll_ids_for_group_ids(conn, group_ids: list[str]) -> list[str]:
    """Resolve a list of group_ids to every poll_id that belongs to those
    groups. Used by the groups endpoints to fan out from the user's
    'these groups matter' set to every poll the user should see."""
    if not group_ids:
        return []
    rows = conn.execute(
        """SELECT id FROM polls WHERE group_id = ANY(%(ids)s)""",
        {"ids": group_ids},
    ).fetchall()
    return [str(r["id"]) for r in rows]


def resolve_group_id_from_route_id(conn, route_id: str) -> str | None:
    """Resolve a route id (path param of `/g/<routeId>`) to a `groups.id`.

    Phase B.3 supports four forms:
      - groups.short_id (preferred when present)
      - groups.id (uuid, e.g. fresh groups with NULL short_id)
      - polls.short_id (Phase A → Phase B.3 fallback: groupShortId today
        is the root poll's short_id)
      - polls.id (uuid fallback for unkeyed routing)

    Returns None if no group can be resolved.
    """
    if not route_id:
        return None

    row = conn.execute(
        "SELECT id FROM groups WHERE short_id = %(rid)s",
        {"rid": route_id},
    ).fetchone()
    if row:
        return str(row["id"])

    is_uuid_like = (len(route_id) == 36 and route_id.count("-") == 4)
    if is_uuid_like:
        row = conn.execute(
            "SELECT id FROM groups WHERE id = %(rid)s::uuid",
            {"rid": route_id},
        ).fetchone()
        if row:
            return str(row["id"])

    row = conn.execute(
        "SELECT group_id FROM polls WHERE short_id = %(rid)s AND group_id IS NOT NULL",
        {"rid": route_id},
    ).fetchone()
    if row:
        return str(row["group_id"])

    if is_uuid_like:
        row = conn.execute(
            "SELECT group_id FROM polls WHERE id = %(rid)s::uuid AND group_id IS NOT NULL",
            {"rid": route_id},
        ).fetchone()
        if row:
            return str(row["group_id"])

    return None
