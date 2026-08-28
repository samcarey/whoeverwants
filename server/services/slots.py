"""Playlist slots + activity suggestions + per-account activity blacklist.

A slot = a user's availability window(s) tagged with activities. Slots feed
the create-slot sheet's activity SUGGESTIONS, ranked into three groups:

  1. "Others are planning" — activities OTHER users tagged on slots whose
     time period OVERLAPS the current selection.
  2. "You've picked before" — activities THIS account used on past slots.
  3. "Others have picked" — activities OTHER users used on any past slot.

Each distinct activity appears in the highest-priority group it qualifies
for (no duplicates across groups). The caller's blacklist is filtered out of
all three. Time-overlap is computed in Python (the day_time_windows JSONB is
awkward to intersect in SQL); candidate slots are SQL-prefiltered to those
sharing at least one selected day so the Python pass stays small.

An activity can also carry a "who with" condition — a party-size range plus the
groups/people it is (or is explicitly NOT) with. Those are stored as REFERENCES
(``{"id", "name"}``, id = a `groups.id` / `users.id`, name = the display
snapshot at pick time — the `poll_comments.mentions` convention), resolved on
save against the owner's own memberships + address book so a who-with can only
ever point at something they can actually reach. `who_with_candidates` serves
that same population to the picker, recency-ranked.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

# `_is_uuid_like` is the shared "is this a real uuid?" shape check that
# `require_uuid` wraps; here a bad id is nulled rather than 404'd (see
# `_clean_refs`), so we want the predicate, not the raiser.
from services.groups import _is_uuid_like
from services.validation import truncate_text, validate_category_icon

MAX_ACTIVITY_LEN = 100
# A slot's day/times are wall clock with no timezone, so it is only definitely
# past once it is past in every timezone: 14h clears UTC-12 with a DST margin.
# Mirrors `services.questions._SLOT_PAST_GRACE`.
PAST_GRACE_HOURS = 14
SUGGESTIONS_PER_GROUP = 15
# Sanity bounds on a per-activity participant count (min/max people).
MAX_PEOPLE = 999
# Per-activity preferred-start-time caps (silent truncation).
MAX_TIME_PREFS = 96
# Per-activity "who with" caps (silent truncation, like COMMENT_MAX_CHARS).
MAX_WITH_NAMES = 20
MAX_WITH_NAME_CHARS = 50
MAX_WHO_WITH_ENTRIES = 10
# What an unnamed group (no title override, no named participants yet) reads as
# in the who-with picker. Mirrors the FE's `EMPTY_GROUP_TITLE`.
UNNAMED_GROUP_LABEL = "New Group"


def normalize_activity(value: str | None) -> str | None:
    """Trim + length-cap an activity string; None/empty → None."""
    return truncate_text(value, MAX_ACTIVITY_LEN)


def _clean_people(value) -> int | None:
    """Coerce a per-activity participant count to an int in [1, MAX_PEOPLE];
    None / non-numeric / < 1 → None (treated as unset)."""
    if value is None:
        return None
    try:
        n = int(value)
    except (ValueError, TypeError):
        return None
    if n < 1:
        return None
    return min(n, MAX_PEOPLE)


def _hhmm_to_minutes(value: str | None) -> int | None:
    if not value or ":" not in value:
        return None
    try:
        h, m = value.split(":", 1)
        return int(h) * 60 + int(m)
    except (ValueError, TypeError):
        return None


def _windows_by_day(day_time_windows) -> dict[str, list[tuple[int, int]]]:
    """{day: [(min_minutes, max_minutes), ...]} from the day_time_windows
    JSONB/list shape ([{day, windows:[{min,max}]}])."""
    out: dict[str, list[tuple[int, int]]] = {}
    for entry in day_time_windows or []:
        if not isinstance(entry, dict):
            continue
        day = entry.get("day")
        if not day:
            continue
        for w in entry.get("windows") or []:
            if not isinstance(w, dict):
                continue
            mn = _hhmm_to_minutes(w.get("min"))
            mx = _hhmm_to_minutes(w.get("max"))
            if mn is None or mx is None:
                continue
            out.setdefault(day, []).append((mn, mx))
    return out


def _periods_overlap(a: dict[str, list[tuple[int, int]]], b: dict[str, list[tuple[int, int]]]) -> bool:
    """True if two day→windows maps share a day with intersecting windows."""
    for day, a_wins in a.items():
        for bw in b.get(day, []):
            for aw in a_wins:
                if aw[0] < bw[1] and bw[0] < aw[1]:
                    return True
    return False


# ----------------------------------------------------------------------------
# Slot persistence
# ----------------------------------------------------------------------------

def _clean_refs(value) -> list[dict] | None:
    """Sanitize a "who with" reference list. Each entry is
    ``{"id": <uuid str | None>, "name": str}`` — the id is the REAL identity
    (a `groups.id` or a `users.id`) and the name is the display snapshot
    captured at pick time, mirroring `poll_comments.mentions`. A BARE STRING is
    accepted and coerced to a name-only ref (`id: None`) so older clients and
    raw-API callers keep working, the same tolerance the router already gives
    bare-string activities.

    Names are trimmed + length-capped and the list size capped (silent
    truncation, the join-request-message convention); blank names are dropped.
    None/empty → None."""
    if not isinstance(value, list):
        return None
    out: list[dict] = []
    for v in value:
        if isinstance(v, str):
            raw_id, raw_name = None, v
        elif isinstance(v, dict):
            raw_id, raw_name = v.get("id"), v.get("name")
        else:
            continue
        if not isinstance(raw_name, str):
            continue
        name = raw_name.strip()[:MAX_WITH_NAME_CHARS].rstrip()
        if not name:
            continue
        out.append({"id": raw_id if _is_uuid_like(raw_id) else None, "name": name})
        if len(out) >= MAX_WITH_NAMES:
            break
    return out or None


def _clean_who_with(value) -> list[dict] | None:
    """Sanitize a per-activity "who with" entry list — each entry an optional
    participant range plus its own groups/people REFERENCE lists (see
    `_clean_refs`), and the exclude_* lists (people/groups the owner would NOT
    do it with). Empty entries are dropped; min > max bumps max up to min; list
    capped (silent truncation). None/empty → None (= the activity-level range
    with "Anyone").

    Shape only — `_resolve_who_with` is what checks the ids are real."""
    if not isinstance(value, list):
        return None
    out: list[dict] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        mn = _clean_people(raw.get("min_people"))
        mx = _clean_people(raw.get("max_people"))
        if mn is not None and mx is not None and mx < mn:
            mx = mn
        groups = _clean_refs(raw.get("groups"))
        people = _clean_refs(raw.get("people"))
        ex_groups = _clean_refs(raw.get("exclude_groups"))
        ex_people = _clean_refs(raw.get("exclude_people"))
        if mn is None and mx is None and not groups and not people and not ex_groups and not ex_people:
            continue
        out.append(
            {
                "min_people": mn,
                "max_people": mx,
                "groups": groups,
                "people": people,
                "exclude_groups": ex_groups,
                "exclude_people": ex_people,
            }
        )
        if len(out) >= MAX_WHO_WITH_ENTRIES:
            break
    return out or None


def _clean_time_prefs(value) -> dict | None:
    """Sanitize a per-activity start-time preference blob:
    ``{"liked": ["HH:MM", ...], "disliked": ["HH:MM", ...]}``. Times are
    validated as real HH:MM marks, deduped (a time can't be both — disliked
    wins, matching the ballot's cycle where dislike is the later state), and
    capped. Empty both ways → None (no preference — the engine proposes the
    earliest viable start as before)."""
    if not isinstance(value, dict):
        return None

    def clean(field: str) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for v in value.get(field) or []:
            if not isinstance(v, str):
                continue
            mins = _hhmm_to_minutes(v.strip())
            if mins is None or not 0 <= mins < 1440:
                continue
            norm = f"{mins // 60:02d}:{mins % 60:02d}"
            if norm in seen:
                continue
            seen.add(norm)
            out.append(norm)
            if len(out) >= MAX_TIME_PREFS:
                break
        return out

    disliked = clean("disliked")
    liked = [t for t in clean("liked") if t not in set(disliked)]
    if not liked and not disliked:
        return None
    return {"liked": liked, "disliked": disliked}


def _member_group_names(conn, user_id: str) -> dict[str, str]:
    """{group_id: display name} for every group the account is a member of.

    Account-aware: unions every browser linked to the account, mirroring
    `services.groups.load_user_visibility`. The name resolves through the
    canonical `group_display_name` (title override → participant names), so a
    who-with pick reads the same as the group does everywhere else. A group
    with neither falls back to UNNAMED_GROUP_LABEL, mirroring the FE's
    `EMPTY_GROUP_TITLE` — a brand-new group is still a real thing to plan
    around, and the pick is keyed on its id, not its label.
    """
    from services.groups import group_display_name

    rows = conn.execute(
        """
        SELECT DISTINCT g.id, g.title
          FROM group_members gm
          JOIN groups g ON g.id = gm.group_id
         WHERE gm.browser_id IN (
                 SELECT browser_id FROM user_browsers WHERE user_id = %(u)s::uuid
               )
        """,
        {"u": user_id},
    ).fetchall()
    out: dict[str, str] = {}
    for r in rows:
        gid = str(r["id"])
        out[gid] = group_display_name(conn, gid, override=r["title"]) or UNNAMED_GROUP_LABEL
    return out


def _contact_names(conn, user_id: str) -> dict[str, str]:
    """{user_id: display name} for every named account in the caller's address
    book (`user_contacts`) — the same population the invite-members and
    plus-ones pickers draw from. Nameless accounts are dropped."""
    rows = conn.execute(
        """
        SELECT c.contact_user_id AS id, u.display_name AS name
          FROM user_contacts c
          JOIN users u ON u.id = c.contact_user_id
         WHERE c.owner_user_id = %(u)s::uuid
           AND u.display_name IS NOT NULL
           AND btrim(u.display_name) <> ''
        """,
        {"u": user_id},
    ).fetchall()
    return {str(r["id"]): r["name"].strip() for r in rows}


def _resolve_refs(refs, known: dict[str, str]) -> list[dict] | None:
    """Validate a ref list against the caller's own `known` id→name map.

    An id the caller can't actually reach (not a group they're in / not a
    contact — including a forged or stale one) is NULLED rather than dropped,
    so the pick survives as a name-only condition instead of silently vanishing
    from the owner's activity. A resolvable id refreshes its stored name, so
    the display snapshot doesn't rot after a rename."""
    if not refs:
        return None
    out = [
        {"id": r["id"], "name": known[r["id"]]}
        if r["id"] and r["id"] in known
        else {"id": None, "name": r["name"]}
        for r in refs
    ]
    return out or None


def _resolve_who_with(entries, groups: dict[str, str], people: dict[str, str]) -> list[dict] | None:
    """Point every who-with reference at something the caller can actually
    reach (see `_resolve_refs`), against id→name maps the caller reads ONCE for
    the whole activity list."""
    if not entries:
        return None
    for e in entries:
        e["groups"] = _resolve_refs(e.get("groups"), groups)
        e["people"] = _resolve_refs(e.get("people"), people)
        e["exclude_groups"] = _resolve_refs(e.get("exclude_groups"), groups)
        e["exclude_people"] = _resolve_refs(e.get("exclude_people"), people)
    return entries


def _insert_slot_activities(conn, slot_id: str, activities, *, user_id: str) -> None:
    """Normalize + dedup (case-insensitive on the name) `activities` dicts
    (``{"name", "emoji", "min_people", "max_people", "who_with"}``) and write
    one slot_activities row each. The optional emoji + participant range +
    who-with entries are decoupled — they never affect matching. When both
    people bounds are present but min > max, max is bumped up to min.

    Who-with references are resolved against `user_id`'s own groups + contacts
    (`_resolve_who_with`); the two id→name maps are read at most once per call,
    only when some activity actually carries a who-with."""
    import json

    ref_maps: tuple[dict[str, str], dict[str, str]] | None = None
    seen: set[str] = set()
    for raw in activities or []:
        name, emoji = raw.get("name"), raw.get("emoji")
        act = normalize_activity(name)
        if not act:
            continue
        key = act.lower()
        if key in seen:
            continue
        seen.add(key)
        # Same validator as poll category emoji — lenient on emoji shape,
        # rejects over-length / control-char / plain-text (raises 400).
        clean_emoji = validate_category_icon(emoji)
        min_people = _clean_people(raw.get("min_people"))
        max_people = _clean_people(raw.get("max_people"))
        if min_people is not None and max_people is not None and max_people < min_people:
            max_people = min_people
        who_with = _clean_who_with(raw.get("who_with"))
        if who_with:
            if ref_maps is None:
                ref_maps = (_member_group_names(conn, user_id), _contact_names(conn, user_id))
            who_with = _resolve_who_with(who_with, *ref_maps)
        time_prefs = _clean_time_prefs(raw.get("time_prefs"))
        conn.execute(
            """
            INSERT INTO slot_activities
                (slot_id, activity, emoji, min_people, max_people, who_with, time_prefs)
            VALUES (%(s)s::uuid, %(a)s, %(e)s, %(mn)s, %(mx)s, %(ww)s::jsonb, %(tp)s::jsonb)
            """,
            {
                "s": slot_id,
                "a": act,
                "e": clean_emoji,
                "mn": min_people,
                "mx": max_people,
                "ww": json.dumps(who_with) if who_with else None,
                "tp": json.dumps(time_prefs) if time_prefs else None,
            },
        )


def create_slot(conn, *, user_id: str, day_time_windows, activities) -> str:
    """Persist a slot (owner + availability windows + activities) and return
    its id. `activities` items are ``{"name", "emoji"}`` dicts (the router
    coerces bare strings to that shape). The caller has already
    resolved/minted `user_id`."""
    import json

    row = conn.execute(
        """
        INSERT INTO slots (user_id, day_time_windows)
        VALUES (%(u)s::uuid, %(dtw)s::jsonb)
        RETURNING id
        """,
        {"u": user_id, "dtw": json.dumps(day_time_windows or [])},
    ).fetchone()
    slot_id = str(row["id"])
    _insert_slot_activities(conn, slot_id, activities, user_id=user_id)
    return slot_id


def _slot_end(day_time_windows) -> datetime | None:
    """The latest window end across a slot, as a tz-naive wall clock read as
    UTC. None when the slot declares no usable window — such a slot has no
    "past" to be in, so it is never auto-deleted."""
    latest: datetime | None = None
    for day, windows in _windows_by_day(day_time_windows).items():
        try:
            base = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        for mn, mx in windows:
            # `max <= min` is the cross-midnight convention (equal = 24h), so
            # the window ends on the following day.
            end_min = mx if mx > mn else mx + 1440
            end = base + timedelta(minutes=end_min)
            if latest is None or end > latest:
                latest = end
    return latest


def purge_past_slots(conn, *, user_id: str, now: datetime | None = None) -> int:
    """Delete the account's slots whose every window has ended, returning how
    many were removed (activities cascade). A slot is availability, so once it
    is entirely behind us it is dead weight on the playlist.

    Slot days/times are wall clock with no timezone, so a slot only counts as
    past once it is past in EVERY timezone — hence the PAST_GRACE_HOURS margin,
    the same convention `services.questions._time_outcome_settled` uses for
    tz-naive time slots. Erring late costs a stale row for a few hours; erring
    early would delete a slot the owner is still living in."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=PAST_GRACE_HOURS)
    rows = conn.execute(
        "SELECT id, day_time_windows FROM slots WHERE user_id = %(u)s::uuid",
        {"u": user_id},
    ).fetchall()
    dead = []
    for r in rows:
        end = _slot_end(r["day_time_windows"])
        if end is not None and end <= cutoff:
            dead.append(str(r["id"]))
    if not dead:
        return 0
    conn.execute("DELETE FROM slots WHERE id = ANY(%(ids)s::uuid[])", {"ids": dead})
    return len(dead)


def list_slots(conn, *, user_id: str) -> list[dict]:
    """Every slot the account owns, each with its activities ({name, emoji},
    creation order). Newest slot first as a stable default — the FE re-sorts
    by soonest availability start for display."""
    rows = conn.execute(
        """
        SELECT id, day_time_windows, created_at
          FROM slots
         WHERE user_id = %(u)s::uuid
         ORDER BY created_at DESC
        """,
        {"u": user_id},
    ).fetchall()
    slot_ids = [str(r["id"]) for r in rows]
    acts: dict[str, list[dict]] = {}
    if slot_ids:
        arows = conn.execute(
            """
            SELECT slot_id, activity, emoji, min_people, max_people, who_with, time_prefs
              FROM slot_activities
             WHERE slot_id = ANY(%(ids)s::uuid[])
             ORDER BY created_at
            """,
            {"ids": slot_ids},
        ).fetchall()
        for a in arows:
            acts.setdefault(str(a["slot_id"]), []).append(
                {
                    "name": a["activity"],
                    "emoji": (a["emoji"] or None),
                    "min_people": a["min_people"],
                    "max_people": a["max_people"],
                    "who_with": a["who_with"] or None,
                    "time_prefs": a["time_prefs"] or None,
                }
            )
    return [
        {
            "id": str(r["id"]),
            "day_time_windows": r["day_time_windows"] or [],
            "activities": acts.get(str(r["id"]), []),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


def update_slot(conn, *, slot_id: str, user_id: str, day_time_windows, activities) -> bool:
    """Replace a slot's windows + activities (owner-gated). Returns False when
    the slot doesn't exist or isn't owned by `user_id` (→ 404). The activity
    rows are wholesale-replaced (delete + re-insert), same dedup/validation as
    create."""
    import json

    row = conn.execute(
        """
        UPDATE slots
           SET day_time_windows = %(dtw)s::jsonb
         WHERE id = %(id)s::uuid AND user_id = %(u)s::uuid
        RETURNING id
        """,
        {"id": slot_id, "u": user_id, "dtw": json.dumps(day_time_windows or [])},
    ).fetchone()
    if not row:
        return False
    conn.execute("DELETE FROM slot_activities WHERE slot_id = %(id)s::uuid", {"id": slot_id})
    _insert_slot_activities(conn, slot_id, activities, user_id=user_id)
    return True


def delete_slot(conn, *, slot_id: str, user_id: str) -> bool:
    """Delete a slot (owner-gated; slot_activities cascade). Returns False when
    the slot doesn't exist or isn't owned (→ 404)."""
    row = conn.execute(
        "DELETE FROM slots WHERE id = %(id)s::uuid AND user_id = %(u)s::uuid RETURNING id",
        {"id": slot_id, "u": user_id},
    ).fetchone()
    return row is not None


# ----------------------------------------------------------------------------
# Who-with candidates
# ----------------------------------------------------------------------------

def _who_with_recency(conn, user_id: str) -> tuple[dict[str, str], dict[str, str]]:
    """(groups, people) → {id: last-referenced ISO timestamp} across every
    who-with the account has ever saved, INCLUDING the exclude_* lists (picking
    someone to avoid is just as much a "you reached for this one" signal).

    Folded in Python rather than SQL: the who_with JSONB is a nested
    list-of-objects-of-lists that `jsonb_array_elements` would need three
    lateral joins to walk, and the row set is bounded by the caller's own
    slots. Only id-bearing refs count — a name-only pick has no stable identity
    to rank."""
    rows = conn.execute(
        """
        SELECT sa.who_with, sa.created_at
          FROM slot_activities sa
          JOIN slots s ON s.id = sa.slot_id
         WHERE s.user_id = %(u)s::uuid
           AND sa.who_with IS NOT NULL
        """,
        {"u": user_id},
    ).fetchall()
    groups: dict[str, str] = {}
    people: dict[str, str] = {}
    for r in rows:
        stamp = r["created_at"].isoformat() if r["created_at"] else ""
        for entry in r["who_with"] or []:
            if not isinstance(entry, dict):
                continue
            for field, acc in (
                ("groups", groups),
                ("exclude_groups", groups),
                ("people", people),
                ("exclude_people", people),
            ):
                for ref in entry.get(field) or []:
                    rid = ref.get("id") if isinstance(ref, dict) else None
                    if rid and stamp > acc.get(rid, ""):
                        acc[rid] = stamp
    return groups, people


def who_with_candidates(conn, *, user_id: str | None) -> list[dict]:
    """Everything the account can point a who-with at, as ONE ranked list of
    ``{"kind": "groups" | "people", "id", "name"}``. `kind` names the who-with
    field the pick belongs in, so the picker can render it without a second
    lookup.

    Groups = the account's memberships; people = its contacts address book —
    the SAME populations `_resolve_who_with` validates saves against, so the
    picker can never offer something that would then be nulled on save.

    ONE list rather than two because the ranking is global: whatever the caller
    reached for most recently comes first, whether that's a group or a person.
    Splitting by kind would make every group outrank every person. Groups only
    lead among entries that tie — i.e. everything never picked, which then
    sorts alphabetically. No account yet (fresh anonymous browser) → empty."""
    if not user_id:
        return []
    group_seen, people_seen = _who_with_recency(conn, user_id)
    rows = [
        {"kind": kind, "id": cid, "name": name, "seen": seen.get(cid, ""), "rank": rank}
        for kind, names, seen, rank in (
            ("groups", _member_group_names(conn, user_id), group_seen, 0),
            ("people", _contact_names(conn, user_id), people_seen, 1),
        )
        for cid, name in names.items()
    ]
    # Two passes so the keys can run in OPPOSITE directions: kind then name
    # ascending, then a stable re-sort by recency descending.
    rows.sort(key=lambda r: (r["rank"], r["name"].lower()))
    rows.sort(key=lambda r: r["seen"], reverse=True)
    return [{"kind": r["kind"], "id": r["id"], "name": r["name"]} for r in rows]


# ----------------------------------------------------------------------------
# Suggestions
# ----------------------------------------------------------------------------

def _rank(rows: list[dict]) -> list[dict]:
    """rows: [{key, display, emoji, count, last}] → [{name, emoji}] ordered by
    count desc then recency desc, capped."""
    ordered = sorted(rows, key=lambda r: (r["count"], r["last"] or ""), reverse=True)
    return [{"name": r["display"], "emoji": r["emoji"]} for r in ordered[:SUGGESTIONS_PER_GROUP]]


def suggest_activities(conn, *, user_id: str | None, day_time_windows) -> dict:
    """Return {overlapping, yours, others} lists of {name, emoji} suggestions
    for the given account + current selection, blacklist-filtered, no
    cross-group duplicates. `user_id` None (brand-new anonymous browser) →
    `yours` empty and everyone counts as "others". The emoji on each
    suggestion is the freshest tagging user's pick for that activity (None if
    the freshest row had none)."""
    selection = _windows_by_day(day_time_windows)
    selected_days = list(selection.keys())

    blacklisted = get_blacklist_keys(conn, user_id) if user_id else set()

    # --- Group 1: other users' OVERLAPPING slots -------------------------
    overlap_map: dict[str, dict] = {}
    if selected_days:
        cand = conn.execute(
            """
            SELECT s.id, s.day_time_windows, sa.activity, sa.emoji, sa.created_at
              FROM slots s
              JOIN slot_activities sa ON sa.slot_id = s.id
             WHERE (%(uid)s::uuid IS NULL OR s.user_id <> %(uid)s::uuid)
               AND EXISTS (
                     SELECT 1 FROM jsonb_array_elements(s.day_time_windows) e
                      WHERE e->>'day' = ANY(%(days)s)
                   )
            """,
            {"uid": user_id, "days": selected_days},
        ).fetchall()
        # Cache each candidate slot's overlap decision so we only test once.
        overlap_cache: dict[str, bool] = {}
        for r in cand:
            sid = str(r["id"])
            if sid not in overlap_cache:
                overlap_cache[sid] = _periods_overlap(selection, _windows_by_day(r["day_time_windows"]))
            if not overlap_cache[sid]:
                continue
            _accumulate(overlap_map, r["activity"], r["emoji"], r["created_at"], blacklisted)

    # --- Group 2: this account's own past activities ---------------------
    yours_map: dict[str, dict] = {}
    if user_id:
        rows = conn.execute(
            """
            SELECT sa.activity, sa.emoji, sa.created_at
              FROM slot_activities sa
              JOIN slots s ON s.id = sa.slot_id
             WHERE s.user_id = %(uid)s::uuid
            """,
            {"uid": user_id},
        ).fetchall()
        for r in rows:
            _accumulate(yours_map, r["activity"], r["emoji"], r["created_at"], blacklisted, skip_keys=overlap_map.keys())

    # --- Group 3: other users' activities, any time ----------------------
    others_map: dict[str, dict] = {}
    rows = conn.execute(
        """
        SELECT sa.activity, sa.emoji, sa.created_at
          FROM slot_activities sa
          JOIN slots s ON s.id = sa.slot_id
         WHERE (%(uid)s::uuid IS NULL OR s.user_id <> %(uid)s::uuid)
        """,
        {"uid": user_id},
    ).fetchall()
    for r in rows:
        _accumulate(
            others_map, r["activity"], r["emoji"], r["created_at"], blacklisted,
            skip_keys=set(overlap_map.keys()) | set(yours_map.keys()),
        )

    return {
        "overlapping": _rank(list(overlap_map.values())),
        "yours": _rank(list(yours_map.values())),
        "others": _rank(list(others_map.values())),
    }


def _accumulate(acc: dict[str, dict], activity: str, emoji, created_at, blacklisted: set[str], *, skip_keys=None) -> None:
    """Fold one (activity, emoji, created_at) into a
    key→{key,display,emoji,count,last} accumulator, skipping blacklisted keys
    and any keys already claimed by a higher-priority group. The freshest row
    wins both the casing AND the emoji."""
    act = normalize_activity(activity)
    if not act:
        return
    key = act.lower()
    if key in blacklisted:
        return
    if skip_keys and key in skip_keys:
        return
    stamp = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at or "")
    clean_emoji = (emoji or "").strip() or None
    cur = acc.get(key)
    if cur is None:
        acc[key] = {"key": key, "display": act, "emoji": clean_emoji, "count": 1, "last": stamp}
    else:
        cur["count"] += 1
        if stamp > (cur["last"] or ""):
            cur["last"] = stamp
            cur["display"] = act  # freshest casing wins
            cur["emoji"] = clean_emoji  # …and freshest emoji


# ----------------------------------------------------------------------------
# Blacklist
# ----------------------------------------------------------------------------

def get_blacklist(conn, user_id: str) -> list[str]:
    """The account's blacklisted activity strings, most-recently-added first."""
    rows = conn.execute(
        "SELECT activity FROM activity_blacklist WHERE user_id = %(u)s::uuid ORDER BY created_at DESC",
        {"u": user_id},
    ).fetchall()
    return [r["activity"] for r in rows]


def get_blacklist_keys(conn, user_id: str) -> set[str]:
    """Lowercased blacklist keys, for suggestion filtering."""
    return {a.lower() for a in get_blacklist(conn, user_id)}


def add_to_blacklist(conn, *, user_id: str, activity: str) -> None:
    """Add an activity to the account's blacklist (case-insensitive, idempotent)."""
    act = normalize_activity(activity)
    if not act:
        return
    conn.execute(
        """
        INSERT INTO activity_blacklist (user_id, activity)
        VALUES (%(u)s::uuid, %(a)s)
        ON CONFLICT (user_id, LOWER(activity)) DO NOTHING
        """,
        {"u": user_id, "a": act},
    )


def remove_from_blacklist(conn, *, user_id: str, activity: str) -> None:
    """Remove an activity from the account's blacklist (case-insensitive)."""
    act = normalize_activity(activity)
    if not act:
        return
    conn.execute(
        "DELETE FROM activity_blacklist WHERE user_id = %(u)s::uuid AND LOWER(activity) = LOWER(%(a)s)",
        {"u": user_id, "a": act},
    )
