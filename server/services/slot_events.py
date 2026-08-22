"""Slot EVENTS: propose gatherings from overlapping slots + confirmations.

Events are derived, never authored: everyone whose slot availability shares a
day, overlaps in time, and carries the SAME activity (case-insensitive) is a
candidate for gatherings of (day, LOWER(activity)). A concrete gathering is a
PARTY — a group of confirmations anchored on one slot_events row — and several
parties of the same (day, activity) may coexist. A viewer's proposal list for
a key is:

  * every live party (≥1 valid confirmation), each scored independently, PLUS
  * ONE fresh (empty, unminted) party — shown exactly when the viewer is
    attached to no party, can join no existing party, and a viable gathering
    exists among the UNATTACHED candidates including them.

The fresh card is the engine's base case, not a special case: before anyone
confirms there are no parties, so the same rule produces the original
proposal — and when a party fills up, the rule re-fires for whoever got left
out, so "another identical event appears" with no extra machinery. A party
whose confirmations all cancel (or go stale) dissolves back into that base
case. Each user holds at most ONE confirmation per key; confirming a
different party moves them.

A gathering is POSSIBLE for a set when EVERY member's who-with condition
holds:

  * party size within their [min_people, max_people],
  * every other member allowed by their include set (groups/people) when one
    is set,
  * no member in their exclude set,
  * and all members sharing a common time window on that day.

Per-party flags the UI depends on:

  * `met`      — the party's confirmed set (≥2 people) satisfies every
                 member's full condition, minimums included. The event is on.
  * `can_confirm` — adding the viewer would not break any confirmed member's
                 condition (maximums / include / exclude / common window;
                 minimums are exempt — satisfied by growth, not violated by
                 it) nor the viewer's own. False + not confirmed = "Full".
  * cancelling frees capacity; everything recomputes from scratch on every
                 read — nothing derived is stored.

Constraint source: the activity's who_with[0] (the editor is
single-condition), else the legacy activity-level range, else unconstrained.
Only ID-BEARING who-with refs participate in matching — a name-only ref
(legacy pick, unresolvable id) has no identity to match a real user against,
so it is display-only, documented in services/slots.py. Group refs resolve
through group_members × user_browsers (account-aware membership).

Viability search is a brute-force walk over subsets of the viewer-compatible
candidates (bitmask, capped at MAX_SEARCH_CANDIDATES) — candidate sets are
"people free at the same time for the same thing", i.e. small.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from services.slots import _windows_by_day, normalize_activity

# Beyond this many viewer-compatible candidates the exists-a-viable-subset
# search stops being cheap (2^n subsets); extras beyond the cap are dropped
# from the SEARCH only (confirmed-set math is exact regardless). 2^14 = 16k
# subset checks worst case.
MAX_SEARCH_CANDIDATES = 14
# An event needs at least two people — a party of one is just your slot.
MIN_EVENT_PEOPLE = 2


@dataclass
class _Candidate:
    user_id: str
    name: str | None
    # This user's availability on the event's day, minute intervals.
    windows: list[tuple[int, int]] = field(default_factory=list)
    # Freshest activity row's display bits.
    display: str = ""
    emoji: str | None = None
    freshest: str = ""  # created_at iso, for freshest-wins merging
    # Who-with condition (freshest activity row wins).
    min_people: int = 1
    max_people: int | None = None
    include_groups: set[str] = field(default_factory=set)
    include_people: set[str] = field(default_factory=set)
    exclude_groups: set[str] = field(default_factory=set)
    exclude_people: set[str] = field(default_factory=set)

    @property
    def has_include(self) -> bool:
        return bool(self.include_groups or self.include_people)


def _ref_ids(refs) -> set[str]:
    """The id-bearing refs of a who-with list; name-only refs are display-only
    (no identity to match against a real user)."""
    out: set[str] = set()
    for r in refs or []:
        if isinstance(r, dict) and r.get("id"):
            out.add(str(r["id"]))
    return out


def _apply_condition(cand: _Candidate, activity_row: dict) -> None:
    """Fold an activity row's who-with condition into the candidate (callers
    only invoke this for the freshest row per (user, day, activity))."""
    entries = activity_row.get("who_with") or []
    entry = entries[0] if entries and isinstance(entries[0], dict) else None
    if entry:
        mn, mx = entry.get("min_people"), entry.get("max_people")
        cand.include_groups = _ref_ids(entry.get("groups"))
        cand.include_people = _ref_ids(entry.get("people"))
        cand.exclude_groups = _ref_ids(entry.get("exclude_groups"))
        cand.exclude_people = _ref_ids(entry.get("exclude_people"))
    else:
        mn, mx = activity_row.get("min_people"), activity_row.get("max_people")
        cand.include_groups = set()
        cand.include_people = set()
        cand.exclude_groups = set()
        cand.exclude_people = set()
    cand.min_people = int(mn) if mn else 1
    cand.max_people = int(mx) if mx else None


def _intersect(a: list[tuple[int, int]], b: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Intersection of two interval lists (each sorted-or-not, minutes)."""
    out: list[tuple[int, int]] = []
    for a0, a1 in a:
        for b0, b1 in b:
            lo, hi = max(a0, b0), min(a1, b1)
            if lo < hi:
                out.append((lo, hi))
    return out


def _common_windows(cands: list[_Candidate]) -> list[tuple[int, int]]:
    """The time everyone in `cands` shares on the day; empty = no common slot."""
    if not cands:
        return []
    common = list(cands[0].windows)
    for c in cands[1:]:
        common = _intersect(common, c.windows)
        if not common:
            return []
    return common


def _allows(c: _Candidate, other_uid: str, members: dict[str, set[str]]) -> bool:
    """Would `c` do this activity alongside `other_uid`? Exclusions veto;
    a non-empty include set must claim them; empty include set = anyone."""
    if other_uid in c.exclude_people:
        return False
    for gid in c.exclude_groups:
        if other_uid in members.get(gid, ()):
            return False
    if not c.has_include:
        return True
    if other_uid in c.include_people:
        return True
    return any(other_uid in members.get(gid, ()) for gid in c.include_groups)


def _constraints_ok(
    cands: list[_Candidate],
    members: dict[str, set[str]],
    *,
    require_min: bool,
) -> bool:
    """Does this exact set satisfy every member's size + include/exclude
    conditions (the time windows are checked separately)? `require_min`
    distinguishes "the event is on" (mins must hold) from "may this person
    join a still-growing set" (mins are satisfied by growth, not violated)."""
    n = len(cands)
    for c in cands:
        if require_min and n < c.min_people:
            return False
        if c.max_people is not None and n > c.max_people:
            return False
        for other in cands:
            if other.user_id != c.user_id and not _allows(c, other.user_id, members):
                return False
    return True


def _set_ok(
    cands: list[_Candidate],
    members: dict[str, set[str]],
    *,
    require_min: bool,
) -> bool:
    """Constraints AND a shared time window — the full "this set works" check."""
    return _constraints_ok(cands, members, require_min=require_min) and bool(
        _common_windows(cands)
    )


def _earliest_viable_start(
    viewer: _Candidate,
    others: list[_Candidate],
    members: dict[str, set[str]],
) -> int | None:
    """The earliest minute at which SOME subset containing the viewer (size ≥
    MIN_EVENT_PEOPLE, everyone's condition holding — minimums included) could
    gather; None when no such subset exists (→ the event isn't proposed).
    Pre-filters to candidates mutually compatible with the viewer (a member of
    a valid set must be), then brute-forces subsets, keeping the earliest
    common-window start across every viable one — "the earliest time that
    allows the minimum amount of people to attend"."""
    pool = [
        o
        for o in others
        if _allows(viewer, o.user_id, members)
        and _allows(o, viewer.user_id, members)
        and _intersect(viewer.windows, o.windows)
    ][: MAX_SEARCH_CANDIDATES - 1]
    earliest: int | None = None
    for mask in range(1, 1 << len(pool)):
        subset = [viewer] + [o for i, o in enumerate(pool) if mask >> i & 1]
        if len(subset) < MIN_EVENT_PEOPLE:
            continue
        if not _constraints_ok(subset, members, require_min=True):
            continue
        commons = _common_windows(subset)
        if not commons:
            continue
        start = min(w[0] for w in commons)
        if earliest is None or start < earliest:
            earliest = start
    return earliest


# ----------------------------------------------------------------------------
# Gathering
# ----------------------------------------------------------------------------

def _gather_days(conn, days: list[str]) -> dict[tuple[str, str], dict[str, _Candidate]]:
    """Every (day, activity_key) → {user_id: _Candidate} across ALL users'
    slots touching those days. One user with several matching slots merges:
    windows union, freshest row's display + condition."""
    if not days:
        return {}
    rows = conn.execute(
        """
        SELECT s.user_id, u.display_name, s.day_time_windows,
               sa.activity, sa.emoji, sa.min_people, sa.max_people,
               sa.who_with, sa.created_at
          FROM slots s
          JOIN slot_activities sa ON sa.slot_id = s.id
          JOIN users u ON u.id = s.user_id
         WHERE EXISTS (
                 SELECT 1 FROM jsonb_array_elements(s.day_time_windows) e
                  WHERE e->>'day' = ANY(%(days)s)
               )
        """,
        {"days": days},
    ).fetchall()
    events: dict[tuple[str, str], dict[str, _Candidate]] = {}
    for r in rows:
        act = normalize_activity(r["activity"])
        if not act:
            continue
        key = act.lower()
        by_day = _windows_by_day(r["day_time_windows"])
        stamp = r["created_at"].isoformat() if r["created_at"] else ""
        uid = str(r["user_id"])
        for day in days:
            wins = by_day.get(day)
            if not wins:
                continue
            cands = events.setdefault((day, key), {})
            cand = cands.get(uid)
            if cand is None:
                cand = _Candidate(user_id=uid, name=r["display_name"])
                cands[uid] = cand
            for w in wins:
                if w not in cand.windows:
                    cand.windows.append(w)
            if stamp >= cand.freshest:
                cand.freshest = stamp
                cand.display = act
                cand.emoji = (r["emoji"] or "").strip() or None
                _apply_condition(
                    cand,
                    {
                        "who_with": r["who_with"],
                        "min_people": r["min_people"],
                        "max_people": r["max_people"],
                    },
                )
    return events


def _load_memberships(
    conn, group_ids: set[str], user_ids: set[str]
) -> dict[str, set[str]]:
    """{group_id: {member user_ids}} restricted to the candidate users —
    account-aware via user_browsers, mirroring is_caller_member_of_group."""
    if not group_ids or not user_ids:
        return {}
    rows = conn.execute(
        """
        SELECT DISTINCT gm.group_id, ub.user_id
          FROM group_members gm
          JOIN user_browsers ub ON ub.browser_id = gm.browser_id
         WHERE gm.group_id = ANY(%(gids)s::uuid[])
           AND ub.user_id = ANY(%(uids)s::uuid[])
        """,
        {"gids": list(group_ids), "uids": list(user_ids)},
    ).fetchall()
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(str(r["group_id"]), set()).add(str(r["user_id"]))
    return out


def _load_confirmations(conn, days: list[str]) -> dict[tuple[str, str], dict[str, set[str]]]:
    """(day, activity_key) → {party event_id: {confirmed user_ids}} for the
    given days. LEFT JOIN so a party row whose confirmations all vanished
    still surfaces (with an empty set) — the confirm path can then target it,
    and the cancel path garbage-collects it."""
    if not days:
        return {}
    rows = conn.execute(
        """
        SELECT e.id AS event_id, e.day::text AS day, LOWER(e.activity) AS key,
               c.user_id
          FROM slot_events e
          LEFT JOIN slot_event_confirmations c ON c.event_id = e.id
         WHERE e.day = ANY(%(days)s::date[])
        """,
        {"days": days},
    ).fetchall()
    out: dict[tuple[str, str], dict[str, set[str]]] = {}
    for r in rows:
        parties = out.setdefault((r["day"], r["key"]), {})
        uids = parties.setdefault(str(r["event_id"]), set())
        if r["user_id"]:
            uids.add(str(r["user_id"]))
    return out


def _minutes_to_hhmm(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def _party_payload(
    day: str,
    cands: dict[str, _Candidate],
    viewer_id: str,
    members: dict[str, set[str]],
    *,
    party_id: str | None,
    party_uids: set[str],
    unattached: set[str],
) -> dict | None:
    """One party as the viewer sees it. `party_id` None = the fresh (unminted)
    party — returned only when a viable gathering exists among the unattached
    candidates including the viewer; a live party always returns a card.

    The completion pool for a party is its own members plus the UNATTACHED
    candidates (people committed to another party of this key aren't available
    to grow this one) — that scoping is what makes a second party's math
    honest without any special-casing."""
    viewer = cands[viewer_id]
    confirmed = [cands[u] for u in party_uids if u in cands]
    viewer_confirmed = viewer_id in {c.user_id for c in confirmed}
    pool_ids = ({c.user_id for c in confirmed} | unattached) - {viewer_id}
    pool = [cands[u] for u in pool_ids]
    earliest_viable = _earliest_viable_start(viewer, pool, members)
    if party_id is None and earliest_viable is None:
        return None

    if viewer_confirmed:
        can_confirm = True  # the button is a cancel; always available
        joined = confirmed
    else:
        joined = confirmed + [viewer]
        can_confirm = _set_ok(joined, members, require_min=False)

    met = len(confirmed) >= MIN_EVENT_PEOPLE and _set_ok(
        confirmed, members, require_min=True
    )

    # The "@ time" on the card: once the event is ON it's when the people
    # actually going can all start; until then it's the earliest start any
    # viable group containing the viewer could manage — the earliest time
    # that lets everyone's minimum be met.
    if met:
        commons = _common_windows(confirmed)
        time_min = min(w[0] for w in commons) if commons else None
    else:
        time_min = earliest_viable

    # The window shown on the card: what the (joined) set still shares —
    # longest common stretch; falls back to the viewer's own when the viewer
    # can't currently join (their card still anchors somewhere).
    common = _common_windows(joined) if can_confirm or viewer_confirmed else []
    window_src = common or viewer.windows
    window = max(window_src, key=lambda w: w[1] - w[0]) if window_src else None

    # Display bits: the VIEWER tagged this activity themselves, so show them
    # their own casing + emoji; fall back to the freshest tagging row (the
    # suggest_activities convention) for anything they left unset.
    freshest = max(cands.values(), key=lambda c: c.freshest)
    return {
        "id": party_id,
        "day": day,
        "activity": viewer.display or freshest.display,
        "emoji": viewer.emoji or freshest.emoji,
        "time": _minutes_to_hhmm(time_min) if time_min is not None else None,
        "window": (
            {"min": _minutes_to_hhmm(window[0]), "max": _minutes_to_hhmm(window[1])}
            if window
            else None
        ),
        "confirmed_count": len(confirmed),
        "confirmed_names": sorted(
            (c.name or "Someone") for c in confirmed
        ),
        "viewer_confirmed": viewer_confirmed,
        "can_confirm": can_confirm,
        "met": met,
    }


def _cards_for_key(
    day: str,
    cands: dict[str, _Candidate],
    parties: dict[str, set[str]],
    viewer_id: str,
    members: dict[str, set[str]],
) -> list[dict]:
    """Every card the viewer sees for one (day, activity): each LIVE party
    (≥1 valid confirmation), plus the fresh empty party exactly when the
    viewer is attached to none, can join none, and a viable gathering exists
    among the unattached. With no parties at all this reduces to the single
    original proposal — the fresh card IS the base case."""
    if viewer_id not in cands:
        return []
    valid = {
        eid: {u for u in uids if u in cands} for eid, uids in parties.items()
    }
    live = {eid: uids for eid, uids in valid.items() if uids}
    attached: set[str] = set().union(*live.values()) if live else set()
    unattached = set(cands) - attached
    cards: list[dict] = []
    viewer_attached = False
    joinable = False
    for eid, uids in live.items():
        card = _party_payload(
            day, cands, viewer_id, members,
            party_id=eid, party_uids=uids, unattached=unattached,
        )
        if card is None:
            continue
        if card["viewer_confirmed"]:
            viewer_attached = True
        elif card["can_confirm"]:
            joinable = True
        cards.append(card)
    if not viewer_attached and not joinable:
        fresh = _party_payload(
            day, cands, viewer_id, members,
            party_id=None, party_uids=set(), unattached=unattached,
        )
        if fresh is not None:
            cards.append(fresh)
    # The viewer's own party first, then joinable ones (fullest first), then
    # full ones, with the fresh card at the end.
    cards.sort(
        key=lambda c: (
            not c["viewer_confirmed"],
            c["id"] is None,
            not c["can_confirm"],
            -c["confirmed_count"],
        )
    )
    return cards


def _all_ref_group_ids(events: dict[tuple[str, str], dict[str, _Candidate]]) -> tuple[set[str], set[str]]:
    gids: set[str] = set()
    uids: set[str] = set()
    for cands in events.values():
        for c in cands.values():
            gids |= c.include_groups | c.exclude_groups
            uids.add(c.user_id)
    return gids, uids


def list_events(conn, *, user_id: str | None) -> list[dict]:
    """Every event proposed to this viewer, across all days their slots touch.
    Sorted by (day, window start). No account → nothing (slots imply one)."""
    if not user_id:
        return []
    day_rows = conn.execute(
        """
        SELECT DISTINCT e->>'day' AS day
          FROM slots s, jsonb_array_elements(s.day_time_windows) e
         WHERE s.user_id = %(u)s::uuid AND e->>'day' IS NOT NULL
        """,
        {"u": user_id},
    ).fetchall()
    days = sorted(r["day"] for r in day_rows)
    events = _gather_days(conn, days)
    gids, uids = _all_ref_group_ids(events)
    members = _load_memberships(conn, gids, uids)
    confirmations = _load_confirmations(conn, days)
    out: list[dict] = []
    for (day, key), cands in events.items():
        out.extend(
            _cards_for_key(day, cands, confirmations.get((day, key), {}), user_id, members)
        )
    # Chronological across keys BY THE DISPLAYED "@ time" (falling back to the
    # anchor window) so the list order matches what the cards say;
    # _cards_for_key already ordered within a key (own party, joinable,
    # fresh) — Python's stable sort keeps that for ties.
    out.sort(
        key=lambda e: (
            e["day"],
            e["time"] or (e["window"] or {}).get("min", ""),
            e["activity"].lower(),
        )
    )
    return out


# ----------------------------------------------------------------------------
# Confirm / cancel
# ----------------------------------------------------------------------------

class EventFullError(Exception):
    """Confirming would break an already-confirmed member's condition (or the
    caller's own) — the button reads "Full"."""


class NoSuchEventError(Exception):
    """The caller isn't a candidate for (day, activity) — no matching slot."""


def set_confirmation(
    conn,
    *,
    user_id: str,
    day: str,
    activity: str,
    confirmed: bool,
    event_id: str | None = None,
) -> dict:
    """Toggle the caller's confirmation for (day, activity), re-validating
    against the CURRENT parties inside this transaction — the FE's flags are
    advisory; this is the gate.

    Confirming with an `event_id` targets that party. Without one (older
    clients, the fresh card) the caller joins the fullest party that will take
    them, else MINTS a new party — but only when a viable gathering exists
    among the unattached candidates including them (otherwise EventFullError:
    every party is full for them and no second gathering could work).

    A caller holds at most one confirmation per key — confirming a different
    party moves them. Cancelling deletes it, and any party left with zero
    confirmations is garbage-collected, dissolving back into the fresh-card
    base case. Returns the refreshed card for the party acted on."""
    act = normalize_activity(activity)
    if not act:
        raise NoSuchEventError()
    key = act.lower()
    events = _gather_days(conn, [day])
    cands = events.get((day, key))
    if not cands or user_id not in cands:
        raise NoSuchEventError()
    gids, uids = _all_ref_group_ids({(day, key): cands})
    members = _load_memberships(conn, gids, uids)
    parties = _load_confirmations(conn, [day]).get((day, key), {})
    valid = {eid: {u for u in uids_ if u in cands} for eid, uids_ in parties.items()}
    attached: set[str] = set().union(*valid.values()) if valid else set()
    unattached = set(cands) - attached

    def _may_join(uids_: set[str]) -> bool:
        joined = [cands[u] for u in uids_] + [cands[user_id]]
        return _set_ok(joined, members, require_min=False)

    target: str | None = None
    if confirmed:
        if event_id is not None:
            if event_id not in parties:
                raise NoSuchEventError()
            if user_id not in valid[event_id] and not _may_join(valid[event_id]):
                raise EventFullError()
            target = event_id
        else:
            # No party named: take the fullest one that works, else mint.
            for eid, uids_ in sorted(valid.items(), key=lambda kv: -len(kv[1])):
                if user_id in uids_ or _may_join(uids_):
                    target = eid
                    break
            if target is None:
                pool = [cands[u] for u in unattached - {user_id}]
                if _earliest_viable_start(cands[user_id], pool, members) is None:
                    raise EventFullError()
                row = conn.execute(
                    "INSERT INTO slot_events (day, activity) VALUES (%(d)s::date, %(a)s) RETURNING id",
                    {"d": day, "a": act},
                ).fetchone()
                target = str(row["id"])
        # One confirmation per key: moving parties drops the old one.
        conn.execute(
            """
            DELETE FROM slot_event_confirmations c
             USING slot_events e
             WHERE c.event_id = e.id AND c.user_id = %(u)s::uuid
               AND e.day = %(d)s::date AND LOWER(e.activity) = %(k)s
               AND e.id <> %(t)s::uuid
            """,
            {"u": user_id, "d": day, "k": key, "t": target},
        )
        conn.execute(
            """
            INSERT INTO slot_event_confirmations (event_id, user_id)
            VALUES (%(e)s::uuid, %(u)s::uuid)
            ON CONFLICT DO NOTHING
            """,
            {"e": target, "u": user_id},
        )
    else:
        conn.execute(
            """
            DELETE FROM slot_event_confirmations c
             USING slot_events e
             WHERE c.event_id = e.id AND c.user_id = %(u)s::uuid
               AND e.day = %(d)s::date AND LOWER(e.activity) = %(k)s
            """,
            {"u": user_id, "d": day, "k": key},
        )
    # Garbage-collect parties nobody is confirmed into (covers the cancel
    # path AND parties whose members all went stale) — an empty party
    # dissolves back into the fresh-card base case.
    conn.execute(
        """
        DELETE FROM slot_events e
         WHERE e.day = %(d)s::date AND LOWER(e.activity) = %(k)s
           AND NOT EXISTS (
                 SELECT 1 FROM slot_event_confirmations c WHERE c.event_id = e.id
               )
        """,
        {"d": day, "k": key},
    )

    fresh_parties = _load_confirmations(conn, [day]).get((day, key), {})
    cards = _cards_for_key(day, cands, fresh_parties, user_id, members)
    for card in cards:
        if confirmed and card["id"] == target:
            return card
    if cards:
        return cards[0]
    # Candidate but nothing to show (e.g. cancelled and no viable gathering
    # remains) — a minimal echo so the FE can clear the card.
    return {
        "id": None,
        "day": day,
        "activity": act,
        "emoji": None,
        "time": None,
        "window": None,
        "confirmed_count": 0,
        "confirmed_names": [],
        "viewer_confirmed": False,
        "can_confirm": False,
        "met": False,
    }
