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
from services.questions import _compute_results, should_reveal_claimant_names

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Visibility rule
# ---------------------------------------------------------------------------
#
# `group_members` is the SINGLE source of truth for visibility. A poll P in
# group T is visible to browser B iff:
#   B (or, when signed in, ANY browser linked to B's user_id) has a
#   `group_members` row for T AND
#   (P.is_closed = false OR P.closed_at >= members.joined_at).
#
# The legacy `accessible_question_ids` localStorage "forget bridge" that
# used to grant group-level visibility WITHOUT a membership row has been
# REMOVED. "Forget a group" is now "leave the group" (DELETE
# /api/groups/{routeId}/membership), which drops the membership row.
#
# `closed_at` proxy: we use `polls.updated_at`, which the existing close
# trigger refreshes on every `is_closed` flip. Subsequent edits to a closed
# poll bump updated_at forward; that makes the rule slightly more permissive
# (a previously hidden closed poll becomes visible if touched after the
# user joins), which fails open.
#
# Phase E (group privacy) consequences:
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


def load_user_visibility(
    conn,
    browser_id: str | None,
    *,
    user_id: str | None = None,
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

    return UserVisibility(
        browser_id=browser_id,
        user_id=user_id,
        joined_by_group=joined_by_group,
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


def backdate_membership_for_user(conn, group_id, user_id, joined_at) -> None:
    """Establish (or back-date) `user_id`'s membership in `group_id`, keyed
    on their earliest-linked browser, with `joined_at` set to when the
    invitation was SENT (an invite-link's `created_at`, a join-request's
    `requested_at`) rather than the accept time. Runs on the caller's
    transaction so it commits atomically with the redeem / approve.

    The closed-before-join filter hides polls that closed before
    `joined_at`; back-dating to send-time keeps polls that closed in the
    gap between invite-send and accept visible to the invitee.

    ON CONFLICT ... LEAST can only pull an existing watermark EARLIER
    (a re-clicked older invite, or preserving a prior plain-URL visit) —
    never later, so it never reduces visibility. `load_user_visibility`
    takes MIN(joined_at) across linked browsers, so writing ONE row makes
    the user's effective join the earliest. No-op when the user has no
    linked browser to key the row on.
    """
    bid_row = conn.execute(
        """
        SELECT browser_id FROM user_browsers
         WHERE user_id = %(u)s::uuid
         ORDER BY linked_at ASC
         LIMIT 1
        """,
        {"u": user_id},
    ).fetchone()
    if not bid_row:
        return
    conn.execute(
        """
        INSERT INTO group_members (group_id, browser_id, joined_at)
        VALUES (%(g)s::uuid, %(b)s::uuid, %(j)s)
        ON CONFLICT (group_id, browser_id)
            DO UPDATE SET joined_at = LEAST(
                group_members.joined_at, EXCLUDED.joined_at
            )
        """,
        {"g": str(group_id), "b": str(bid_row["browser_id"]), "j": joined_at},
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


def claim_group(conn, group_id: str, user_id: str):
    """Phase I: atomically claim a group that has no recorded creator.

    Used to upgrade grandfathered (pre-Phase-E) groups and
    anonymous-created groups so a signed-in user can take over as the
    recorded creator — unlocking the privacy toggle, join-request
    approval, and invite-link minting that would otherwise be stranded
    on those groups forever.

    Returns the row dict on success (with `id`, `short_id`, `privacy`,
    `creator_user_id`) or None when someone else already holds
    creator_user_id (race or pre-claimed) OR the group doesn't exist.
    The atomic `WHERE creator_user_id IS NULL` clause serializes
    concurrent claims at row-lock granularity: whoever wins the lock
    writes their user_id, the loser sees 0 rows updated. RETURNING
    pulls the full response payload in the same statement so callers
    can skip a second SELECT.

    There's no "proof of original creation" check — `creator_secret`
    was retired in migration 123 and pre-Phase-E groups never had one
    anyway. Authority is delegated to caller-side gates (signed-in +
    group member); the function itself only enforces the
    no-recorded-creator invariant.
    """
    return conn.execute(
        """
        UPDATE groups
           SET creator_user_id = %(uid)s::uuid
         WHERE id = %(gid)s::uuid
           AND creator_user_id IS NULL
        RETURNING id, short_id, privacy, creator_user_id
        """,
        {"gid": group_id, "uid": user_id},
    ).fetchone()


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


def load_group_members(conn, group_id: str) -> tuple[list[dict], int]:
    """Resolve a group's ACTUAL roster from `group_members` (NOT poll
    participants — that's what `Group.participantNames` is, and it misses
    members who joined via approve/invite/add-people but haven't voted yet).

    Returns ``(named_members, anonymous_count)``:
      - ``named_members``: ``[{"name": str, "user_id": str | None}, ...]``,
        one entry per DISTINCT person who has a resolvable display name.
        Account-aware: a person signed in across N browsers collapses to ONE
        entry keyed on `user_id` (mirrors `load_user_visibility`'s
        `user_browsers` union); an anonymous (no-account) browser member is
        its own person keyed on `browser_id`. Name resolution per person:
        account `display_name`, else the most-recent `voter_name` that
        browser used, else they fall into `anonymous_count`.
      - ``anonymous_count``: distinct persons with no resolvable name
        (drive-by URL visitors who auto-joined a public group, nameless
        browser members). Rolled up so a public group's roster isn't a wall
        of "anonymous" rows.

    Named members are sorted by name (case-insensitive).
    """
    rows = conn.execute(
        """
        SELECT
            COALESCE(ub.user_id::text, gm.browser_id::text) AS person_key,
            ub.user_id::text AS user_id,
            COALESCE(
                NULLIF(BTRIM(u.display_name), ''),
                NULLIF(BTRIM((
                    SELECT v.voter_name FROM votes v
                     WHERE v.browser_id = gm.browser_id
                       AND v.voter_name IS NOT NULL
                     ORDER BY v.created_at DESC
                     LIMIT 1
                )), '')
            ) AS name
          FROM group_members gm
          LEFT JOIN user_browsers ub ON ub.browser_id = gm.browser_id
          LEFT JOIN users u ON u.id = ub.user_id
         WHERE gm.group_id = %(g)s::uuid
        """,
        {"g": group_id},
    ).fetchall()

    # Collapse to one entry per person (account de-dup). Keep the first
    # non-null name we see across the person's browser rows.
    by_person: dict[str, dict] = {}
    for r in rows:
        key = r["person_key"]
        existing = by_person.get(key)
        if existing is None:
            by_person[key] = {"user_id": r.get("user_id"), "name": r.get("name")}
        elif not existing["name"] and r.get("name"):
            existing["name"] = r["name"]

    named = [
        {"name": p["name"], "user_id": p["user_id"]}
        for p in by_person.values()
        if p["name"]
    ]
    anonymous_count = sum(1 for p in by_person.values() if not p["name"])
    named.sort(key=lambda m: m["name"].lower())
    return named, anonymous_count


def load_poll_voters(conn, poll_id: str) -> tuple[list[dict], int]:
    """A single poll's voter roster, same shape + account-dedup as
    `load_group_members` but scoped to who VOTED on `poll_id`. Returns
    ``(named_voters, anonymous_count)`` — one entry per distinct voter person
    (account-aware), plus a rolled-up count of voters with no resolvable name.
    Used by the poll /info respondents list (per-person rows + long-press)."""
    rows = conn.execute(
        """
        SELECT
            COALESCE(ub.user_id::text, v.browser_id::text) AS person_key,
            ub.user_id::text AS user_id,
            NULLIF(BTRIM(v.voter_name), '') AS name,
            v.created_at AS ts
          FROM votes v
          JOIN questions q ON v.question_id = q.id
          LEFT JOIN user_browsers ub ON ub.browser_id = v.browser_id
         WHERE q.poll_id = %(p)s::uuid
         ORDER BY v.created_at
        """,
        {"p": poll_id},
    ).fetchall()

    by_person: dict[str, dict] = {}
    for r in rows:
        # Legacy votes (pre-migration-120) can carry neither account nor
        # browser_id — treat each as its own anonymous person.
        key = r["person_key"] or f"legacy:{r['ts']}"
        existing = by_person.get(key)
        if existing is None:
            by_person[key] = {"user_id": r.get("user_id"), "name": r.get("name")}
        elif not existing["name"] and r.get("name"):
            existing["name"] = r["name"]

    named = [
        {"name": p["name"], "user_id": p["user_id"]}
        for p in by_person.values()
        if p["name"]
    ]
    anonymous_count = sum(1 for p in by_person.values() if not p["name"])
    named.sort(key=lambda m: m["name"].lower())
    return named, anonymous_count


def resolve_group_for_visit(
    conn,
    route_id: str,
    *,
    browser_id: str | None,
    user_id: str | None,
) -> str | None:
    """Shared read-boundary gate for the `/by-route-id/{route_id}` endpoints:
    resolve `route_id` → group_id, enforce Phase E privacy, and auto-join
    public-group visitors inline.

    Returns the group_id on success. Returns None when the route doesn't
    resolve OR the group is private and the caller isn't a member — callers
    raise their own 404 with whatever detail fits ("Group not found" for the
    whole-group read, "Poll not found" for the single-poll read). Keeping the
    privacy gate + auto-join in one place is load-bearing: the single-poll
    read and the whole-group read can't drift on who's allowed in, so a
    private group can't become readable through one endpoint but not the
    other.
    """
    group_id = resolve_group_id_from_route_id(conn, route_id)
    if not group_id:
        return None
    meta = get_group_metadata(conn, group_id)
    privacy = meta["privacy"] if meta else "public"
    if privacy == "private":
        if not is_caller_member_of_group(
            conn, group_id, browser_id=browser_id, user_id=user_id
        ):
            return None
    else:
        grant_group_membership_inline(conn, group_id, browser_id, privacy=privacy)
    return group_id


def polls_for_poll_ids(
    conn,
    poll_ids: list[str],
    *,
    include_results: bool,
    viewer_user_id: str | None = None,
    viewer_browser_id: str | None = None,
) -> list[PollResponse]:
    """Build PollResponse[] (with inline results / voter aggregates) for the
    given poll_ids. Order: most recently created first. Empty list in →
    empty list out (no DB roundtrip).

    `viewer_user_id` (the caller's resolved user_id — bearer session or the
    account linked to their browser) is threaded into each `_row_to_poll`
    so every returned poll carries the per-viewer `viewer_is_creator` flag
    that gates the FE's creator controls.

    `viewer_browser_id` (the request's raw browser_id) drives the per-poll
    `viewer_follow_state` (Gap 1): the caller's follow/ignore state, resolved
    account-aware across every linked browser. Defaults 'new' when not
    threaded in (so non-group reads keep the model default)."""
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
        PollVoterData,
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

    voter_data_by_mp: dict[str, PollVoterData] = {}
    for mp_id in poll_ids_present:
        voter_data_by_mp[mp_id] = _compute_poll_voter_data(conn, mp_id)

    # Gap 1: the caller's per-poll follow/ignore state, account-aware across
    # every browser linked to their account. Absent = 'new' (default-follow).
    # `auto_aged_at` (migration 142) is read straight off the already-loaded
    # poll rows (SELECT polls.*) so the hot read path adds no extra query; an
    # aged poll reads 'old' for everyone unless they have a newer follow row.
    from services.follow_state import effective_follow_states

    aged_map = {str(r["id"]): r["auto_aged_at"] for r in poll_rows}
    bids: list[str] = []
    if viewer_browser_id:
        from services.auth import caller_browser_ids

        bids = caller_browser_ids(
            conn, browser_id=viewer_browser_id, user_id=viewer_user_id
        )
    follow_states = effective_follow_states(
        conn, poll_ids_present, browser_ids=bids, auto_aged_at=aged_map
    )

    responses: list[PollResponse] = []
    for mp_row in poll_rows:
        mp_id = str(mp_row["id"])
        sp_rows = questions_by_mp.get(mp_id, [])
        mp_resp = _row_to_poll(
            mp_row, sp_rows, voter_data_by_mp.get(mp_id, PollVoterData()),
            viewer_user_id=viewer_user_id,
        )
        mp_resp.viewer_follow_state = follow_states.get(mp_id, "new")
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
                    # Limited-supply name visibility: creator always sees names;
                    # others only when the reveal toggle is on. Strip in the warm
                    # cache too so the group-read response can't leak names.
                    reveal_names = should_reveal_claimant_names(
                        reveal_flag=sp_row.get("reveal_claimant_names", True),
                        viewer_user_id=viewer_user_id,
                        creator_user_id=mp_row.get("creator_user_id"),
                    )
                    try:
                        # Skip tentative time-slot generation: this path serves the
                        # /api/groups/mine + /by-route-id/{id} hot loop (5s page
                        # refresh tick), and the per-question results endpoint
                        # populates tentative options separately for the ballot UI.
                        sp_resp.results = _compute_results(
                            enriched,
                            votes_by_question[pid],
                            include_tentative_time_options=False,
                            reveal_names=reveal_names,
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


_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# The RFC 4122 "nil" UUID. Never a legitimate identity — it's what a
# null/uninitialized client coerces an id to. Treated as "no identity"
# everywhere browser_id is read so it can't accumulate a shared
# membership/badge bucket that bleeds across unrelated devices (this was the
# root cause of the iOS all-zeros app-icon badge bug: one stray client joined
# a 27-poll group under the nil id, and every device that then sent the nil id
# saw that group's unread count as its badge).
NIL_UUID = "00000000-0000-0000-0000-000000000000"


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
