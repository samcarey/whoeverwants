"""Decided-poll event layer (Phase 1, migration 146 — docs/event-layer-plan.md).

A closed poll whose time/showtime question produced a winning slot HAS an
event: the winning slot is when it happens, and the attendee list is derived
from the ballots — **presumed in** (docs/purpose.md decision, 2026-07-08):

  * time question with availability windows on the vote → presumed in when the
    windows cover the winning slot (`_voter_available_at`);
  * time without windows / showtime → presumed in when the voter responded
    (non-abstain, engaged with slots) and did NOT mark the winner in
    `disliked_slots` (showtime semantics: dislike = can't attend);
  * plus-ones ride along with their submitter;
  * abstains and non-voters are not presumed.

`event_attendance` rows are the per-person exceptions: 'out' = backed out,
'in' = late opt-in from someone the derivation didn't presume. Reads are
account-aware with recency-wins across a person's linked browsers (person key
= COALESCE(user_id, browser_id)), mirroring `effective_follow_states`; writes
are browser-keyed, mirroring `set_follow_state`.

Known v1 limits (documented in the plan): legacy votes with NULL browser_id
are presumed in but can't self-toggle; a submitter's back-out removes their
whole party (plus-ones aren't individually toggleable); derivation ignores
`voter_min_participants` conditionality.
"""

from __future__ import annotations

from dataclasses import dataclass, field

VALID_ATTENDANCE = ("in", "out")


@dataclass
class EventAttendee:
    name: str | None
    status: str  # 'in' | 'out'
    is_viewer: bool = False


@dataclass
class PollEvent:
    slot_key: str  # "YYYY-MM-DD HH:MM-HH:MM" — FE formats via lib/timeUtils
    question_id: str
    attendees: list[EventAttendee] = field(default_factory=list)
    in_count: int = 0
    viewer_status: str | None = None  # 'in' | 'out' | None (viewer not listed)


def decided_event_slot(conn, poll_id: str):
    """(time/showtime question row, winning slot key, that question's votes)
    for a closed, non-cancelled poll — else None. First time-bearing question
    wins (create-time validation allows at most one `time` question; a
    time+showtime mix is exotic enough to anchor on the first by index)."""
    # Lazy import: services.questions pulls in the whole results stack.
    from services.questions import _compute_results

    poll = conn.execute(
        "SELECT is_closed FROM polls WHERE id = %(pid)s::uuid",
        {"pid": poll_id},
    ).fetchone()
    if not poll or not poll["is_closed"]:
        return None
    q_rows = conn.execute(
        """SELECT * FROM questions WHERE poll_id = %(pid)s::uuid
           ORDER BY question_index""",
        {"pid": poll_id},
    ).fetchall()
    for q in q_rows:
        if q["question_type"] not in ("time", "showtime"):
            continue
        votes = [
            dict(v)
            for v in conn.execute(
                "SELECT * FROM votes WHERE question_id = %(qid)s",
                {"qid": q["id"]},
            ).fetchall()
        ]
        results = _compute_results(
            dict(q), votes, include_tentative_time_options=False
        )
        if getattr(results, "time_event_cancelled", False):
            return None
        winner = results.winner
        if winner and " " in winner:  # slot-shaped ("date HH:MM-HH:MM")
            return dict(q), winner, votes
        return None  # tie / all-abstain / no votes → no event
    return None


def _vote_presumed_in(vote: dict, date: str, start_min: int, eff_end: int,
                      winner: str) -> bool:
    from algorithms.time_slots import _voter_available_at

    if vote.get("is_abstain"):
        return False
    windows = vote.get("voter_day_time_windows")
    if windows:
        # Availability is authoritative for time polls: a preference "dislike"
        # is "prefer not", not "can't" — they can still back out explicitly.
        return _voter_available_at(windows, date, start_min, eff_end)
    liked = vote.get("liked_slots")
    disliked = vote.get("disliked_slots")
    if liked is None and disliked is None:
        return False  # never engaged with the slots
    return winner not in (disliked or [])


def poll_event(conn, poll_id: str, *, browser_id: str | None,
               user_id: str | None):
    """The poll's event + effective attendee list for this caller, or None
    when the poll has no event (open / no time question / no winner /
    cancelled)."""
    from algorithms.time_question import parse_slot_key
    from services.auth import resolve_actor_user_id

    found = decided_event_slot(conn, poll_id)
    if not found:
        return None
    q, winner, votes = found
    date, start_min, end_min = parse_slot_key(winner)
    eff_end = end_min if end_min > start_min else end_min + 24 * 60

    presumed = [
        v for v in votes
        if _vote_presumed_in(v, date, start_min, eff_end, winner)
    ]

    att_rows = conn.execute(
        """SELECT browser_id::text AS b, status, updated_at
             FROM event_attendance WHERE poll_id = %(pid)s::uuid""",
        {"pid": poll_id},
    ).fetchall()

    # person key = the account when the browser is linked, else the browser.
    all_bids = {str(v["browser_id"]) for v in presumed if v.get("browser_id")}
    all_bids |= {r["b"] for r in att_rows}
    acct: dict[str, str] = {}
    if all_bids:
        rows = conn.execute(
            """SELECT browser_id::text AS b, user_id::text AS u
                 FROM user_browsers WHERE browser_id = ANY(%(b)s::uuid[])""",
            {"b": list(all_bids)},
        ).fetchall()
        acct = {r["b"]: r["u"] for r in rows}

    def person(bid: str | None) -> str | None:
        if not bid:
            return None
        return acct.get(bid) or bid

    # Effective override per person — most recent row across their browsers.
    override: dict[str, tuple[str, object]] = {}
    for r in att_rows:
        k = person(r["b"])
        cur = override.get(k)
        if cur is None or r["updated_at"] >= cur[1]:
            override[k] = (r["status"], r["updated_at"])

    uid = resolve_actor_user_id(conn, user_id=user_id, browser_id=browser_id)
    caller_key = uid or (browser_id if browser_id else None)

    attendees: list[EventAttendee] = []
    listed: set[str] = set()
    viewer_status: str | None = None
    for v in presumed:
        bid = str(v["browser_id"]) if v.get("browser_id") else None
        k = person(bid)
        if k is not None:
            if k in listed:
                continue  # same person across linked browsers
            listed.add(k)
        status = override.get(k, ("in", None))[0] if k else "in"
        is_viewer = k is not None and k == caller_key
        if is_viewer:
            viewer_status = status
        attendees.append(EventAttendee(v.get("voter_name"), status, is_viewer))
        for pname in v.get("plus_one_names") or []:
            attendees.append(EventAttendee(pname or None, status, False))

    # Late opt-ins: 'in' overrides from people the derivation didn't presume.
    optin_keys = [
        k for k, (status, _) in override.items()
        if status == "in" and k not in listed
    ]
    names: dict[str, str] = {}
    optin_uids = [k for k in optin_keys if k in set(acct.values())]
    if optin_uids:
        rows = conn.execute(
            """SELECT id::text AS u, display_name FROM users
                WHERE id = ANY(%(u)s::uuid[])""",
            {"u": optin_uids},
        ).fetchall()
        names = {r["u"]: r["display_name"] for r in rows}
    for k in optin_keys:
        is_viewer = k == caller_key
        if is_viewer:
            viewer_status = "in"
        attendees.append(EventAttendee(names.get(k), "in", is_viewer))
        listed.add(k)

    # Viewer first, then those still in, then by name; stable within groups.
    attendees.sort(
        key=lambda a: (not a.is_viewer, a.status != "in", (a.name or "~").lower())
    )
    return PollEvent(
        slot_key=winner,
        question_id=str(q["id"]),
        attendees=attendees,
        in_count=sum(1 for a in attendees if a.status == "in"),
        viewer_status=viewer_status,
    )


def set_event_attendance(conn, poll_id: str, browser_id: str, status: str) -> None:
    """Upsert this browser's attendance override. 'out' = can't make it,
    'in' = (re-)opt-in. `clock_timestamp()` for same-transaction recency,
    mirroring `set_follow_state`."""
    if status not in VALID_ATTENDANCE:
        raise ValueError(f"invalid attendance status: {status!r}")
    conn.execute(
        """
        INSERT INTO event_attendance (poll_id, browser_id, status, updated_at)
        VALUES (%(pid)s::uuid, %(bid)s::uuid, %(status)s, clock_timestamp())
        ON CONFLICT (poll_id, browser_id)
        DO UPDATE SET status = EXCLUDED.status, updated_at = clock_timestamp()
        """,
        {"pid": poll_id, "bid": browser_id, "status": status},
    )
