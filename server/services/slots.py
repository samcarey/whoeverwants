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
"""

from __future__ import annotations

from services.validation import truncate_text

MAX_ACTIVITY_LEN = 100
SUGGESTIONS_PER_GROUP = 15


def normalize_activity(value: str | None) -> str | None:
    """Trim + length-cap an activity string; None/empty → None."""
    return truncate_text(value, MAX_ACTIVITY_LEN)


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

def create_slot(conn, *, user_id: str, day_time_windows, activities) -> str:
    """Persist a slot (owner + availability windows + activities) and return
    its id. `activities` are normalized + deduped case-insensitively; the
    caller has already resolved/minted `user_id`."""
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

    seen: set[str] = set()
    for raw in activities or []:
        act = normalize_activity(raw)
        if not act:
            continue
        key = act.lower()
        if key in seen:
            continue
        seen.add(key)
        conn.execute(
            "INSERT INTO slot_activities (slot_id, activity) VALUES (%(s)s::uuid, %(a)s)",
            {"s": slot_id, "a": act},
        )
    return slot_id


# ----------------------------------------------------------------------------
# Suggestions
# ----------------------------------------------------------------------------

def _rank(rows: list[dict]) -> list[str]:
    """rows: [{key, display, count, last}] → display strings ordered by
    count desc then recency desc, capped."""
    ordered = sorted(rows, key=lambda r: (r["count"], r["last"] or ""), reverse=True)
    return [r["display"] for r in ordered[:SUGGESTIONS_PER_GROUP]]


def suggest_activities(conn, *, user_id: str | None, day_time_windows) -> dict:
    """Return {overlapping, yours, others} lists of activity strings for the
    given account + current selection, blacklist-filtered, no cross-group
    duplicates. `user_id` None (brand-new anonymous browser) → `yours` empty
    and everyone counts as "others"."""
    selection = _windows_by_day(day_time_windows)
    selected_days = list(selection.keys())

    blacklisted = get_blacklist_keys(conn, user_id) if user_id else set()

    # --- Group 1: other users' OVERLAPPING slots -------------------------
    overlap_map: dict[str, dict] = {}
    if selected_days:
        cand = conn.execute(
            """
            SELECT s.id, s.day_time_windows, sa.activity, sa.created_at
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
            _accumulate(overlap_map, r["activity"], r["created_at"], blacklisted)

    # --- Group 2: this account's own past activities ---------------------
    yours_map: dict[str, dict] = {}
    if user_id:
        rows = conn.execute(
            """
            SELECT sa.activity, sa.created_at
              FROM slot_activities sa
              JOIN slots s ON s.id = sa.slot_id
             WHERE s.user_id = %(uid)s::uuid
            """,
            {"uid": user_id},
        ).fetchall()
        for r in rows:
            _accumulate(yours_map, r["activity"], r["created_at"], blacklisted, skip_keys=overlap_map.keys())

    # --- Group 3: other users' activities, any time ----------------------
    others_map: dict[str, dict] = {}
    rows = conn.execute(
        """
        SELECT sa.activity, sa.created_at
          FROM slot_activities sa
          JOIN slots s ON s.id = sa.slot_id
         WHERE (%(uid)s::uuid IS NULL OR s.user_id <> %(uid)s::uuid)
        """,
        {"uid": user_id},
    ).fetchall()
    for r in rows:
        _accumulate(
            others_map, r["activity"], r["created_at"], blacklisted,
            skip_keys=set(overlap_map.keys()) | set(yours_map.keys()),
        )

    return {
        "overlapping": _rank(list(overlap_map.values())),
        "yours": _rank(list(yours_map.values())),
        "others": _rank(list(others_map.values())),
    }


def _accumulate(acc: dict[str, dict], activity: str, created_at, blacklisted: set[str], *, skip_keys=None) -> None:
    """Fold one (activity, created_at) into a key→{key,display,count,last}
    accumulator, skipping blacklisted keys and any keys already claimed by a
    higher-priority group."""
    act = normalize_activity(activity)
    if not act:
        return
    key = act.lower()
    if key in blacklisted:
        return
    if skip_keys and key in skip_keys:
        return
    stamp = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at or "")
    cur = acc.get(key)
    if cur is None:
        acc[key] = {"key": key, "display": act, "count": 1, "last": stamp}
    else:
        cur["count"] += 1
        if stamp > (cur["last"] or ""):
            cur["last"] = stamp
            cur["display"] = act  # freshest casing wins


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
