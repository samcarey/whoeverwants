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

  * `met`      — the party's confirmed set satisfies every member's full
                 condition, minimums included. The event is on. There is NO
                 global headcount floor: a solo confirmer whose "At Least" is
                 "Just me" (min_people <= 1, the default) is a met event —
                 an event still happens if only one person goes.
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

from services.slots import _hhmm_to_minutes, _windows_by_day, normalize_activity

# Beyond this many viewer-compatible candidates the exists-a-viable-subset
# search stops being cheap (2^n subsets); extras beyond the cap are dropped
# from the SEARCH only (confirmed-set math is exact regardless). 2^14 = 16k
# subset checks worst case.
MAX_SEARCH_CANDIDATES = 14
# There is NO global headcount floor: each member's own "At Least" minimum
# (min_people, default 1 = "Just me") is the floor. An event still happens if
# only one person goes — that's the point of allowing "Me" in the "At Least"
# field, so a solo confirmation with min_people <= 1 makes the event met.


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
    # Preferred / avoided start times (minutes since midnight), from the
    # freshest activity row's time_prefs. The "@ time" pick scores candidate
    # starts by fewest dislikes -> most likes -> earliest (the time-poll
    # winner rule); all-empty preserves the old earliest-start behavior.
    liked: set[int] = field(default_factory=set)
    disliked: set[int] = field(default_factory=set)
    # Duration bounds in MINUTES (from min_hours/max_hours). min_dur 0 /
    # max_dur None = unconstrained. A set is duration-compatible when
    # max(min_dur) <= min(max_dur), and an event can only start where the
    # binding minimum still fits the shared window.
    min_dur: int = 0
    max_dur: int | None = None

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


def _apply_time_prefs(cand: _Candidate, time_prefs) -> None:
    """Fold an activity row's start-time preferences into the candidate
    (freshest row wins, like the who-with condition)."""
    liked: set[int] = set()
    disliked: set[int] = set()
    if isinstance(time_prefs, dict):
        for field_name, acc in (("liked", liked), ("disliked", disliked)):
            for v in time_prefs.get(field_name) or []:
                mins = _hhmm_to_minutes(v) if isinstance(v, str) else None
                if mins is not None:
                    acc.add(mins)
    cand.liked = liked
    cand.disliked = disliked


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


def _required_min_dur(cands: list[_Candidate]) -> int:
    """The binding minimum duration for this set — the event must run at
    least this long or somebody's minimum isn't met."""
    return max((c.min_dur for c in cands), default=0)


def _durations_ok(cands: list[_Candidate]) -> bool:
    """Are the set's duration bounds mutually satisfiable? Someone insisting
    on >= 3h can't gather with someone capping at 2h. Growth can only raise
    the binding minimum / lower the allowed maximum, so this is enforced for
    growing AND final sets alike."""
    caps = [c.max_dur for c in cands if c.max_dur is not None]
    return not caps or _required_min_dur(cands) <= min(caps)


def _fitting_windows(cands: list[_Candidate]) -> list[tuple[int, int]]:
    """The shared windows long enough to hold the set's binding minimum —
    an event must FIT, not merely start, inside everyone's availability."""
    req = _required_min_dur(cands)
    return [w for w in _common_windows(cands) if w[1] - w[0] >= req]


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
    join a still-growing set" (mins are satisfied by growth, not violated).
    Duration bounds are enforced unconditionally (growth can only tighten
    them — see _durations_ok)."""
    if not _durations_ok(cands):
        return False
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
    """Constraints AND a shared time window LONG ENOUGH for the binding
    minimum duration — the full "this set works" check."""
    return _constraints_ok(cands, members, require_min=require_min) and bool(
        _fitting_windows(cands)
    )


# The bubble pitch of the start-preference ballot — a disliked mark "escapes"
# to the next bubble over when nothing better is available.
PREF_STEP = 30


def _start_candidates(cands: list[_Candidate], commons: list[tuple[int, int]]) -> list[int]:
    """The start minutes worth scoring within the shared windows: each window's
    own start (the old earliest-start behavior), every member's liked mark
    (something to move TOWARD), and one step past every disliked mark
    (somewhere to escape a disliked window start to). Every candidate must
    leave room for the set's binding minimum duration before the window
    closes — an event may not start where it would outlast someone's
    availability — and windows too short for it are skipped outright."""
    req = _required_min_dur(cands)
    out: set[int] = set()
    marks: set[int] = set()
    for c in cands:
        marks |= c.liked
        marks |= {d + PREF_STEP for d in c.disliked}
    for lo, hi in commons:
        if hi - lo < req:
            continue
        out.add(lo)
        out.update(m for m in marks if lo <= m < hi and m + req <= hi)
    return sorted(out)


def _start_score(start: int, cands: list[_Candidate]) -> tuple[int, int, int]:
    """Rank a candidate start for this set: fewest dislikes, then most likes,
    then earliest — the time-poll winner rule. Lower tuple = better."""
    dislikes = sum(1 for c in cands if start in c.disliked)
    likes = sum(1 for c in cands if start in c.liked)
    return (dislikes, -likes, start)


def _best_start(cands: list[_Candidate], commons: list[tuple[int, int]]) -> int | None:
    """The best-scoring start the set shares; None when no common window."""
    starts = _start_candidates(cands, commons)
    if not starts:
        return None
    return min(starts, key=lambda s: _start_score(s, cands))


def _preferred_viable_start(
    viewer: _Candidate,
    others: list[_Candidate],
    members: dict[str, set[str]],
) -> int | None:
    """The best start minute at which SOME subset containing the viewer (the
    singleton included — going alone is legitimate when the viewer's own
    minimum allows it; everyone's condition holding, minimums included) could
    gather; None when no such subset exists (→ the event isn't proposed).
    Pre-filters to candidates mutually compatible with the viewer (a member of
    a valid set must be), then brute-forces subsets, scoring each viable one's
    candidate starts by the members' time preferences (fewest dislikes → most
    likes → earliest); with no preferences anywhere this reduces to the old
    "earliest time that allows the minimum amount of people to attend"."""
    pool = [
        o
        for o in others
        if _allows(viewer, o.user_id, members)
        and _allows(o, viewer.user_id, members)
        and _intersect(viewer.windows, o.windows)
    ][: MAX_SEARCH_CANDIDATES - 1]
    best: tuple[int, int, int] | None = None
    best_start: int | None = None
    # From 0: the singleton {viewer} is a viable gathering whenever their own
    # minimum is "Just me" — no global two-person floor.
    for mask in range(0, 1 << len(pool)):
        subset = [viewer] + [o for i, o in enumerate(pool) if mask >> i & 1]
        if not _constraints_ok(subset, members, require_min=True):
            continue
        commons = _common_windows(subset)
        if not commons:
            continue
        for start in _start_candidates(subset, commons):
            score = _start_score(start, subset)
            if best is None or score < best:
                best = score
                best_start = start
    return best_start


def _needed_more(
    viewer: _Candidate,
    others: list[_Candidate],
    members: dict[str, set[str]],
) -> int | None:
    """How many MORE people (beyond every compatible candidate who exists)
    the smallest near-viable gathering including the viewer still needs —
    the "1 more needed" number. Walks the same compatible-subset space as
    `_preferred_viable_start`, but for each subset with a shared window and
    constraints holding (minimums exempt) computes how far short of the
    binding minimum it falls, skipping subsets whose maximums couldn't fit
    the extra heads. None when even that fails (no shared window at all —
    which can't happen for the singleton {viewer} unless their slot has no
    usable windows)."""
    pool = [
        o
        for o in others
        if _allows(viewer, o.user_id, members)
        and _allows(o, viewer.user_id, members)
        and _intersect(viewer.windows, o.windows)
    ][: MAX_SEARCH_CANDIDATES - 1]
    best: int | None = None
    # From 0: the singleton {viewer} is a legitimate near-miss base — the
    # common case of "I declared an activity and nobody else has it yet".
    for mask in range(0, 1 << len(pool)):
        subset = [viewer] + [o for i, o in enumerate(pool) if mask >> i & 1]
        if not _constraints_ok(subset, members, require_min=False):
            continue
        if not _fitting_windows(subset):
            continue
        n = len(subset)
        need = max(c.min_people for c in subset) - n
        if need <= 0:
            continue  # viable outright — the fresh card handles it
        caps = [c.max_people for c in subset if c.max_people is not None]
        if caps and n + need > min(caps):
            continue  # the missing heads wouldn't fit someone's maximum
        if best is None or need < best:
            best = need
    return best


def _near_miss_payload(
    day: str,
    cands: dict[str, _Candidate],
    viewer_id: str,
    members: dict[str, set[str]],
    unattached: set[str],
) -> dict | None:
    """The "needs N more" card shown when NO viable gathering exists for the
    viewer — so a declared activity is never a silent dead end. Not
    confirmable (there's nothing to join yet); the card just says how close
    the gathering is."""
    viewer = cands[viewer_id]
    pool = [cands[u] for u in unattached - {viewer_id}]
    need = _needed_more(viewer, pool, members)
    if need is None:
        return None
    window = max(viewer.windows, key=lambda w: w[1] - w[0]) if viewer.windows else None
    freshest = max(cands.values(), key=lambda c: c.freshest)
    return {
        "id": None,
        "day": day,
        "activity": viewer.display or freshest.display,
        "emoji": viewer.emoji or freshest.emoji,
        "time": None,
        "window": (
            {"min": _minutes_to_hhmm(window[0]), "max": _minutes_to_hhmm(window[1])}
            if window
            else None
        ),
        "confirmed_count": 0,
        "confirmed_names": [],
        "viewer_confirmed": False,
        "can_confirm": False,
        "met": False,
        "needed": need,
    }


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
               sa.who_with, sa.time_prefs, sa.min_hours, sa.max_hours,
               sa.created_at
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
                _apply_time_prefs(cand, r["time_prefs"])
                cand.min_dur = int(round(float(r["min_hours"]) * 60)) if r["min_hours"] is not None else 0
                cand.max_dur = int(round(float(r["max_hours"]) * 60)) if r["max_hours"] is not None else None
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


def _load_event_polls(conn, days: list[str]) -> dict[tuple[str, str], dict]:
    """(day, activity_key) → the STARTED poll's display info, from the
    slot_event_polls link table (one per key). What the event card's timer
    line and the event page's Poll section render."""
    if not days:
        return {}
    rows = conn.execute(
        """
        SELECT sep.day::text AS day, LOWER(sep.activity) AS key, sep.title,
               p.short_id AS poll_short_id, p.is_closed,
               g.short_id AS group_short_id
          FROM slot_event_polls sep
          JOIN polls p ON p.id = sep.poll_id
          LEFT JOIN groups g ON g.id = p.group_id
         WHERE sep.day = ANY(%(days)s::date[])
        """,
        {"days": days},
    ).fetchall()
    return {
        (r["day"], r["key"]): {
            "poll_short_id": r["poll_short_id"],
            "group_short_id": r["group_short_id"],
            "title": r["title"],
            "is_closed": bool(r["is_closed"]),
        }
        for r in rows
    }


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
    earliest_viable = _preferred_viable_start(viewer, pool, members)
    if party_id is None and earliest_viable is None:
        return None

    if viewer_confirmed:
        can_confirm = True  # the button is a cancel; always available
        joined = confirmed
    else:
        joined = confirmed + [viewer]
        can_confirm = _set_ok(joined, members, require_min=False)

    # Met = the people actually going satisfy every one of THEIR conditions,
    # minimums included. A solo confirmer whose "At Least" is "Just me" IS a
    # met event — going alone counts; there is no global two-person floor.
    met = bool(confirmed) and _set_ok(confirmed, members, require_min=True)

    # The "@ time" on the card: once the event is ON it's the best-preferred
    # start the people actually going all share; until then it's the
    # best-preferred start any viable group containing the viewer could
    # manage (falling back to earliest when nobody marked preferences).
    if met:
        time_min = _best_start(confirmed, _common_windows(confirmed))
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
        # Count includes the viewer; the NAMES exclude them — every surface
        # shows the viewer's own membership as "you" (the card's "You're
        # going!" pill, the event page's "You" row), never as their own disc.
        "confirmed_count": len(confirmed),
        "confirmed_names": sorted(
            (c.name or "Someone") for c in confirmed if c.user_id != viewer_id
        ),
        "viewer_confirmed": viewer_confirmed,
        "can_confirm": can_confirm,
        "met": met,
        "needed": 0,
    }


def _cards_for_key(
    day: str,
    cands: dict[str, _Candidate],
    parties: dict[str, set[str]],
    viewer_id: str,
    members: dict[str, set[str]],
    poll_info: dict | None = None,
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
        elif not cards:
            # Nothing viable AND nothing else to show for this key — surface
            # how close it is ("needs N more") instead of a silent dead end.
            near = _near_miss_payload(day, cands, viewer_id, members, unattached)
            if near is not None:
                cards.append(near)
    # The key's started poll (if any) rides on EVERY card of the key — it
    # belongs to the gathering, not to any one party.
    if poll_info is not None:
        for card in cards:
            card["poll"] = poll_info
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
    polls = _load_event_polls(conn, days)
    out: list[dict] = []
    for (day, key), cands in events.items():
        out.extend(
            _cards_for_key(
                day, cands, confirmations.get((day, key), {}), user_id, members,
                poll_info=polls.get((day, key)),
            )
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
                if _preferred_viable_start(cands[user_id], pool, members) is None:
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
    poll_info = _load_event_polls(conn, [day]).get((day, key))
    cards = _cards_for_key(day, cands, fresh_parties, user_id, members, poll_info=poll_info)
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
        "needed": 0,
        "poll": poll_info,
    }


# ----------------------------------------------------------------------------
# Attached polls: start one when the gathering becomes possible
# ----------------------------------------------------------------------------

def _load_poll_drafts(conn, days: list[str]) -> dict[tuple[str, str], list[dict]]:
    """(day, activity_key) → the attached poll drafts among slots touching
    those days, earliest-attached first (the first attacher's draft wins when
    a key starts its poll)."""
    if not days:
        return {}
    rows = conn.execute(
        """
        SELECT s.user_id, s.day_time_windows, sa.activity, sa.poll_draft, sa.created_at
          FROM slots s
          JOIN slot_activities sa ON sa.slot_id = s.id
         WHERE sa.poll_draft IS NOT NULL
           AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(s.day_time_windows) e
                  WHERE e->>'day' = ANY(%(days)s)
               )
        """,
        {"days": days},
    ).fetchall()
    out: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        act = normalize_activity(r["activity"])
        if not act or not isinstance(r["poll_draft"], dict):
            continue
        key = act.lower()
        slot_days = set(_windows_by_day(r["day_time_windows"]).keys())
        for day in days:
            if day not in slot_days:
                continue
            out.setdefault((day, key), []).append(
                {
                    "user_id": str(r["user_id"]),
                    "draft": r["poll_draft"],
                    "created_at": r["created_at"],
                }
            )
    for lst in out.values():
        lst.sort(key=lambda d: (d["created_at"] is None, d["created_at"]))
    return out


def _create_event_poll(conn, day: str, activity_display: str, cands: dict[str, _Candidate], draft_row: dict) -> str | None:
    """Create a REAL poll from an activity's attached draft and link it to the
    (day, activity) key. Reuses the create endpoint's insert helpers (lazy
    import, the recurrence-materializer pattern): the poll lands in a fresh
    PUBLIC group (no signed-in group creator), owned by the draft's attacher,
    with no voting deadline (the event card's timer counts to the EVENT start
    instead — slot times are wall-clock with no timezone, so a server-side
    deadline would be a lie somewhere). Every current candidate of the key is
    added as a group member so the poll is on their home list and votable."""
    from datetime import datetime, timezone  # noqa: PLC0415

    from models import CreatePollRequest, CreateQuestionRequest  # noqa: PLC0415
    from routers.polls import _insert_poll, _insert_question  # noqa: PLC0415
    from services.contacts import add_member_for_user  # noqa: PLC0415

    d = draft_row["draft"]
    q = d.get("question") or {}
    qtype = q.get("question_type")
    if qtype not in ("yes_no", "ranked_choice"):
        return None
    owner_id = draft_row["user_id"]
    owner = cands.get(owner_id)
    creator_name = (owner.name if owner else None) or "Someone"
    title = (d.get("title") or "").strip() or (q.get("context") or "").strip() or "Poll"
    sub = CreateQuestionRequest(
        question_type=qtype,
        category=q.get("category"),
        category_icon=q.get("category_icon"),
        options=q.get("options"),
        context=q.get("context"),
        winner_method=q.get("winner_method") or ("consensus" if qtype == "ranked_choice" else "favorite"),
        is_auto_title=bool(q.get("is_auto_title", qtype != "yes_no")),
    )
    now = datetime.now(timezone.utc)
    req = CreatePollRequest(
        creator_name=creator_name,
        response_deadline=None,
        group_id=None,
        questions=[sub],
    )
    poll_row = _insert_poll(
        conn, req, now,
        creator_user_id=owner_id,
        group_creator_user_id=None,
    )
    _insert_question(conn, poll_row, req, sub, 0, title, now)
    inserted = conn.execute(
        """
        INSERT INTO slot_event_polls (day, activity, poll_id, title)
        VALUES (%(d)s::date, %(a)s, %(p)s::uuid, %(t)s)
        ON CONFLICT (day, LOWER(activity)) DO NOTHING
        RETURNING poll_id
        """,
        {"d": day, "a": activity_display, "p": str(poll_row["id"]), "t": title},
    ).fetchone()
    if not inserted:
        # A concurrent save won the key — abandon this copy (the poll row is
        # orphaned in its own group; harmless, and the txn may roll back).
        return None
    for uid in cands:
        add_member_for_user(conn, str(poll_row["group_id"]), uid)
    return str(poll_row["id"])


def start_due_event_polls(conn, *, user_id: str | None, days: list[str]) -> list[str]:
    """After a slot save touching `days`: for every (day, activity) key the
    saver is a candidate of, if some candidate attached a poll draft, no poll
    has started for the key yet, and a viable gathering exists for the
    draft's owner (the "suggested for a time slot" moment — the same
    subset-viability rule that surfaces the fresh card), create the poll and
    record the link. One poll per key, ever. Returns the created poll ids.

    Deliberately called OUTSIDE the slot-save transaction (own connection,
    errors swallowed by the caller) so a poll-creation hiccup can't fail the
    save — the next save of any participant retries."""
    days = sorted({d for d in days if d})
    if not user_id or not days:
        return []
    events = _gather_days(conn, days)
    keys = [(day, key) for (day, key), cands in events.items() if user_id in cands]
    if not keys:
        return []
    existing = _load_event_polls(conn, days)
    pending = [k for k in keys if k not in existing]
    if not pending:
        return []
    drafts = _load_poll_drafts(conn, days)
    gids, uids = _all_ref_group_ids(events)
    members = _load_memberships(conn, gids, uids)
    created: list[str] = []
    for day, key in pending:
        cands = events[(day, key)]
        for row in drafts.get((day, key), []):
            owner = cands.get(row["user_id"])
            if owner is None:
                continue
            pool = [c for c in cands.values() if c.user_id != owner.user_id]
            if _preferred_viable_start(owner, pool, members) is None:
                continue
            pid = _create_event_poll(conn, day, owner.display or key, cands, row)
            if pid:
                created.append(pid)
            break
    return created
