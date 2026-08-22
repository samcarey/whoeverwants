"""Slot EVENTS: propose gatherings from overlapping slots + confirmations.

An event is derived, never authored: everyone whose slot availability shares a
day, overlaps in time, and carries the SAME activity (case-insensitive) is a
candidate for one event, identified by (day, LOWER(activity)). The system
proposes an event to a viewer only when it is POSSIBLE for them — some group of
candidates including the viewer could confirm such that EVERY member's own
who-with condition holds:

  * party size within their [min_people, max_people],
  * every other member allowed by their include set (groups/people) when one
    is set,
  * no member in their exclude set,
  * and all members sharing a common time window on that day.

Confirmations then walk toward that state one person at a time. The rules the
UI depends on:

  * `met`      — the CONFIRMED set (≥2 people) satisfies every confirmed
                 member's full condition, minimums included. The event is on.
  * `can_confirm` — adding the viewer to the confirmed set would not break any
                 confirmed member's condition (maximums / include / exclude /
                 common window; minimums are exempt — they are satisfied by
                 growth, not violated by it) nor the viewer's own. When false
                 and the viewer hasn't confirmed, the button reads "Full".
  * cancelling frees capacity, so can_confirm is recomputed from scratch on
                 every read — nothing is cached.

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


def _set_ok(
    cands: list[_Candidate],
    members: dict[str, set[str]],
    *,
    require_min: bool,
) -> bool:
    """Does this exact set satisfy every member's condition? `require_min`
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
    return bool(_common_windows(cands))


def _viable_with(
    viewer: _Candidate,
    others: list[_Candidate],
    members: dict[str, set[str]],
) -> bool:
    """Does ANY subset containing the viewer (size ≥ MIN_EVENT_PEOPLE) satisfy
    everyone in it? Pre-filters to candidates mutually compatible with the
    viewer (a member of a valid set must be), then brute-forces subsets."""
    pool = [
        o
        for o in others
        if _allows(viewer, o.user_id, members)
        and _allows(o, viewer.user_id, members)
        and _intersect(viewer.windows, o.windows)
    ][: MAX_SEARCH_CANDIDATES - 1]
    for mask in range(1, 1 << len(pool)):
        subset = [viewer] + [o for i, o in enumerate(pool) if mask >> i & 1]
        if len(subset) >= MIN_EVENT_PEOPLE and _set_ok(subset, members, require_min=True):
            return True
    return False


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


def _load_confirmations(conn, days: list[str]) -> dict[tuple[str, str], set[str]]:
    """(day, activity_key) → {confirmed user_ids} for the given days."""
    if not days:
        return {}
    rows = conn.execute(
        """
        SELECT e.day::text AS day, LOWER(e.activity) AS key, c.user_id
          FROM slot_events e
          JOIN slot_event_confirmations c ON c.event_id = e.id
         WHERE e.day = ANY(%(days)s::date[])
        """,
        {"days": days},
    ).fetchall()
    out: dict[tuple[str, str], set[str]] = {}
    for r in rows:
        out.setdefault((r["day"], r["key"]), set()).add(str(r["user_id"]))
    return out


def _minutes_to_hhmm(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def _event_payload(
    day: str,
    cands: dict[str, _Candidate],
    confirmed_ids: set[str],
    viewer_id: str,
    members: dict[str, set[str]],
) -> dict | None:
    """One event as the viewer sees it, or None when it shouldn't be shown
    (viewer not a candidate, or no viable group containing them exists)."""
    viewer = cands.get(viewer_id)
    if viewer is None:
        return None
    others = [c for u, c in cands.items() if u != viewer_id]
    if not _viable_with(viewer, others, members):
        return None

    # Stale confirmations (the slot behind them was edited/deleted) drop out
    # of the math entirely — the candidate set is the source of truth.
    confirmed = [cands[u] for u in confirmed_ids if u in cands]
    viewer_confirmed = viewer_id in {c.user_id for c in confirmed}

    if viewer_confirmed:
        can_confirm = True  # the button is a cancel; always available
        joined = confirmed
    else:
        joined = confirmed + [viewer]
        can_confirm = _set_ok(joined, members, require_min=False)

    met = len(confirmed) >= MIN_EVENT_PEOPLE and _set_ok(
        confirmed, members, require_min=True
    )

    # The window shown on the card: what the (joined) set still shares —
    # longest common stretch; falls back to the viewer's own when the viewer
    # can't currently join (their card still anchors somewhere).
    common = _common_windows(joined) if can_confirm or viewer_confirmed else []
    window_src = common or viewer.windows
    window = max(window_src, key=lambda w: w[1] - w[0]) if window_src else None

    # Display bits: the freshest tagging row across candidates wins (same
    # convention as suggest_activities).
    freshest = max(cands.values(), key=lambda c: c.freshest)
    return {
        "day": day,
        "activity": freshest.display,
        "emoji": freshest.emoji,
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
        payload = _event_payload(day, cands, confirmations.get((day, key), set()), user_id, members)
        if payload:
            out.append(payload)
    out.sort(key=lambda e: (e["day"], (e["window"] or {}).get("min", ""), e["activity"].lower()))
    return out


# ----------------------------------------------------------------------------
# Confirm / cancel
# ----------------------------------------------------------------------------

class EventFullError(Exception):
    """Confirming would break an already-confirmed member's condition (or the
    caller's own) — the button reads "Full"."""


class NoSuchEventError(Exception):
    """The caller isn't a candidate for (day, activity) — no matching slot."""


def set_confirmation(conn, *, user_id: str, day: str, activity: str, confirmed: bool) -> dict:
    """Toggle the caller's confirmation on (day, activity), re-validating the
    join against the CURRENT confirmed set inside this transaction — the FE's
    can_confirm is advisory; this is the gate. Returns the refreshed event
    payload as this caller sees it."""
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
    confirmed_ids = _load_confirmations(conn, [day]).get((day, key), set())

    if confirmed:
        joined = [cands[u] for u in confirmed_ids if u in cands]
        if user_id not in confirmed_ids:
            if not _set_ok(joined + [cands[user_id]], members, require_min=False):
                raise EventFullError()
            row = conn.execute(
                """
                INSERT INTO slot_events (day, activity)
                VALUES (%(d)s::date, %(a)s)
                ON CONFLICT (day, LOWER(activity)) DO UPDATE SET activity = slot_events.activity
                RETURNING id
                """,
                {"d": day, "a": act},
            ).fetchone()
            conn.execute(
                """
                INSERT INTO slot_event_confirmations (event_id, user_id)
                VALUES (%(e)s::uuid, %(u)s::uuid)
                ON CONFLICT DO NOTHING
                """,
                {"e": str(row["id"]), "u": user_id},
            )
            confirmed_ids = confirmed_ids | {user_id}
    else:
        conn.execute(
            """
            DELETE FROM slot_event_confirmations c
             USING slot_events e
             WHERE c.event_id = e.id
               AND c.user_id = %(u)s::uuid
               AND e.day = %(d)s::date AND LOWER(e.activity) = %(k)s
            """,
            {"u": user_id, "d": day, "k": key},
        )
        confirmed_ids = confirmed_ids - {user_id}

    payload = _event_payload(day, cands, confirmed_ids, user_id, members)
    # The caller IS a candidate (checked above); payload can still be None if
    # no viable group contains them — return a minimal echo so the FE can
    # clear the card.
    return payload or {
        "day": day,
        "activity": act,
        "emoji": None,
        "window": None,
        "confirmed_count": len(confirmed_ids),
        "confirmed_names": [],
        "viewer_confirmed": user_id in confirmed_ids,
        "can_confirm": False,
        "met": False,
    }
