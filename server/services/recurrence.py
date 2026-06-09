"""Server-side poll recurrence: occurrence generation + materialization.

The occurrence math mirrors the front-end `lib/recurrence.ts` (FREQ / INTERVAL
/ BYDAY / COUNT / UNTIL semantics) so the Scheduled-page preview and the
scheduler agree on which dates a series produces. The rule shape is:

    {
      "frequency": "none" | "daily" | "weekly" | "monthly",
      "interval": int >= 1,
      "weekdays": [0..6]            # weekly only, 0 = Sunday
      "monthlyMode": "dayOfMonth" | "nthWeekday",
      "end": {"type": "never"}
           | {"type": "after", "count": int}
           | {"type": "on", "date": "YYYY-MM-DD"},
      "start": "YYYY-MM-DD"         # first occurrence (the anchor poll's date)
    }

`materialize_due_instances` is called once per cron tick: for every recurring
anchor it creates a fresh copy of the anchor's questions in the same group for
each occurrence whose open date has arrived (and isn't skipped / past the
series' `until` cutoff), advancing `recurrence_last_run`.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

log = logging.getLogger("recurrence")

_HARD_WALK_CAP = 2000


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value)[:10]
    try:
        y, m, d = (int(p) for p in s.split("-"))
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - timedelta(days=1)).day


def _weekday_sun0(d: date) -> int:
    # Python's date.weekday() is Mon=0..Sun=6; we use Sun=0..Sat=6.
    return (d.weekday() + 1) % 7


def _weekday_ordinal_in_month(d: date) -> int:
    return (d.day - 1) // 7 + 1


def _nth_weekday_of_month(year: int, month: int, weekday_sun0: int, ordinal: int) -> date | None:
    first = date(year, month, 1)
    offset = (weekday_sun0 - _weekday_sun0(first)) % 7
    day = 1 + offset + (ordinal - 1) * 7
    dim = _days_in_month(year, month)
    if day > dim:
        if ordinal >= 5:  # "5th" requested but absent → fall back to the last.
            day -= 7
            if day < 1 or day > dim:
                return None
        else:
            return None
    return date(year, month, day)


def _add_months(d: date, months: int) -> date:
    total = (d.year * 12 + (d.month - 1)) + months
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


# ---------------------------------------------------------------------------
# Occurrence generation
# ---------------------------------------------------------------------------

def is_active(rule: dict | None) -> bool:
    return bool(rule) and rule.get("frequency", "none") != "none"


def generate_occurrences(
    rule: dict,
    start: date,
    *,
    limit: int = 5,
    include_start: bool = True,
) -> list[date]:
    """Generate the series' occurrence dates from `start`, honouring the rule's
    own end condition (never / after N / until) AND `limit`, whichever first."""
    if not is_active(rule):
        return []
    interval = max(1, int(rule.get("interval", 1) or 1))
    end = rule.get("end") or {"type": "never"}
    max_count = (
        max(1, int(end.get("count", 1))) if end.get("type") == "after" else None
    )
    until = _parse_date(end.get("date")) if end.get("type") == "on" else None
    freq = rule.get("frequency")

    out: list[date] = []

    def push(d: date) -> bool:
        if until and d > until:
            return False
        out.append(d)
        if max_count is not None and len(out) >= max_count:
            return False
        return len(out) < limit

    if freq == "daily":
        k = 0 if include_start else 1
        for _ in range(_HARD_WALK_CAP):
            if not push(start + timedelta(days=k * interval)):
                break
            k += 1
        return out

    if freq == "weekly":
        days = sorted(rule.get("weekdays") or [_weekday_sun0(start)])
        day_set = set(days)
        week_anchor = start - timedelta(days=_weekday_sun0(start))
        cursor = start
        for _ in range(_HARD_WALK_CAP):
            ok = True
            if cursor < start:
                ok = False
            elif not include_start and cursor == start:
                ok = False
            elif _weekday_sun0(cursor) not in day_set:
                ok = False
            else:
                cursor_week = cursor - timedelta(days=_weekday_sun0(cursor))
                week_index = (cursor_week - week_anchor).days // 7
                if week_index % interval != 0:
                    ok = False
            if ok and not push(cursor):
                break
            cursor += timedelta(days=1)
        return out

    # monthly
    anchor_ordinal = _weekday_ordinal_in_month(start)
    anchor_weekday = _weekday_sun0(start)
    anchor_dom = start.day
    monthly_mode = rule.get("monthlyMode", "dayOfMonth")
    k = 0 if include_start else 1
    for _ in range(_HARD_WALK_CAP):
        base = _add_months(date(start.year, start.month, 1), k * interval)
        if monthly_mode == "nthWeekday":
            occ = _nth_weekday_of_month(base.year, base.month, anchor_weekday, anchor_ordinal)
        else:
            occ = date(base.year, base.month, min(anchor_dom, _days_in_month(base.year, base.month)))
        k += 1
        if occ is None or occ < start:
            continue
        if not push(occ):
            break
    return out


def _skip_set(anchor_row: dict) -> set[date]:
    raw = anchor_row.get("recurrence_skip_dates")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = []
    out: set[date] = set()
    for item in raw or []:
        d = _parse_date(item)
        if d:
            out.add(d)
    return out


def _rule_of(anchor_row: dict) -> dict | None:
    rule = anchor_row.get("recurrence")
    if isinstance(rule, str):
        try:
            rule = json.loads(rule)
        except (ValueError, TypeError):
            return None
    return rule if isinstance(rule, dict) else None


def upcoming_occurrences(anchor_row: dict, today: date, *, limit: int = 6) -> list[date]:
    """Future, not-yet-materialized, not-cancelled occurrence dates (> today)."""
    rule = _rule_of(anchor_row)
    if not is_active(rule):
        return []
    start = _parse_date(rule.get("start")) or today
    until = _parse_date(anchor_row.get("recurrence_until"))
    skip = _skip_set(anchor_row)
    occ = generate_occurrences(rule, start, limit=limit + 60)
    out: list[date] = []
    for d in occ:
        if d <= today:
            continue
        if until and d >= until:
            break
        if d in skip:
            continue
        out.append(d)
        if len(out) >= limit:
            break
    return out


def due_occurrences(anchor_row: dict, today: date) -> list[date]:
    """Occurrence dates that should be materialized NOW: after the anchor's
    `recurrence_last_run`, on/before `today`, not skipped, before `until`."""
    rule = _rule_of(anchor_row)
    if not is_active(rule):
        return []
    start = _parse_date(rule.get("start")) or today
    last_run = _parse_date(anchor_row.get("recurrence_last_run")) or start
    until = _parse_date(anchor_row.get("recurrence_until"))
    skip = _skip_set(anchor_row)
    out: list[date] = []
    for d in generate_occurrences(rule, start, limit=_HARD_WALK_CAP):
        if d <= last_run:
            continue
        if d > today:
            break
        if until and d >= until:
            break
        if d in skip:
            continue
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# Materialization (scheduler)
# ---------------------------------------------------------------------------

def _shift_day_time_windows(windows: Any, day_delta: int) -> Any:
    """Shift each window's `day` forward by `day_delta` days so a recurring
    time poll's availability dates advance with the series instead of staying
    pinned to the anchor's (now-past) dates."""
    if isinstance(windows, str):
        try:
            windows = json.loads(windows)
        except (ValueError, TypeError):
            return windows
    if not isinstance(windows, list):
        return windows
    out = []
    for w in windows:
        if isinstance(w, dict) and "day" in w:
            d = _parse_date(w.get("day"))
            nw = dict(w)
            if d:
                nw["day"] = (d + timedelta(days=day_delta)).isoformat()
            out.append(nw)
        else:
            out.append(w)
    return out


def materialize_due_instances(conn, today: date, *, max_instances: int = 50) -> list[str]:
    """For every recurring anchor, create a fresh poll instance for each due
    occurrence date. Returns the new poll ids. Reuses the create-time insert
    helpers (imported lazily to avoid a circular import with routers.polls).

    Each new instance:
      - copies the anchor's questions (template options for fixed-options
        polls; suggestion polls re-open collecting from scratch; time-window
        dates are shifted forward to the occurrence date),
      - lands in the anchor's group with the anchor's creator + settings,
      - gets a response_deadline = occurrence date + the anchor's voting window,
      - is linked back to the anchor via `recurrence_anchor_id` (and carries no
        recurrence of its own — only the anchor drives the schedule).
    """
    # Lazy import: routers.polls imports this module's pure helpers at top level.
    from routers.polls import _insert_poll, _insert_question  # noqa: PLC0415
    from models import CreatePollRequest, CreateQuestionRequest  # noqa: PLC0415

    anchors = conn.execute(
        "SELECT * FROM polls WHERE recurrence IS NOT NULL"
    ).fetchall()
    new_ids: list[str] = []

    for anchor in anchors:
        anchor = dict(anchor)
        due = due_occurrences(anchor, today)
        if not due:
            continue
        rule = _rule_of(anchor) or {}
        start = _parse_date(rule.get("start")) or today
        anchor_created = anchor.get("created_at")
        anchor_created_dt = (
            anchor_created if isinstance(anchor_created, datetime) else None
        )
        # Voting window length (deadline - created_at) to re-apply per instance.
        window: timedelta | None = None
        rd = anchor.get("response_deadline")
        if isinstance(rd, datetime) and isinstance(anchor_created_dt, datetime):
            window = rd - anchor_created_dt
        q_rows = conn.execute(
            "SELECT * FROM questions WHERE poll_id = %(pid)s ORDER BY question_index NULLS LAST, created_at",
            {"pid": str(anchor["id"])},
        ).fetchall()

        last_done = _parse_date(anchor.get("recurrence_last_run")) or start
        for occ in due:
            if len(new_ids) >= max_instances:
                break
            # The instance opens at the anchor's wall-clock time on the occurrence date.
            base_time = anchor_created_dt or datetime.now(timezone.utc)
            occ_dt = datetime(
                occ.year, occ.month, occ.day,
                base_time.hour, base_time.minute, base_time.second,
                tzinfo=timezone.utc,
            )
            response_deadline = (occ_dt + window).isoformat() if window else None
            day_delta = (occ - start).days

            sub_reqs: list[CreateQuestionRequest] = []
            for q in q_rows:
                q = dict(q)
                qtype = q.get("question_type")
                is_suggestion = (
                    qtype == "ranked_choice" and q.get("suggestion_deadline_minutes") is not None
                )
                options = None if is_suggestion else _as_list(q.get("options"))
                sub_reqs.append(
                    CreateQuestionRequest(
                        question_type=qtype,
                        category=q.get("category"),
                        category_icon=q.get("category_icon"),
                        options=options,
                        options_metadata=_as_obj(q.get("options_metadata")),
                        context=q.get("details"),
                        suggestion_deadline_minutes=q.get("suggestion_deadline_minutes"),
                        day_time_windows=_shift_day_time_windows(q.get("day_time_windows"), day_delta),
                        duration_window=_as_obj(q.get("duration_window")),
                        reference_latitude=q.get("reference_latitude"),
                        reference_longitude=q.get("reference_longitude"),
                        reference_location_label=q.get("reference_location_label"),
                        min_availability_percent=q.get("min_availability_percent") or 95,
                        min_participants=q.get("time_min_participants") or 2,
                        exclusion_tolerance=q.get("exclusion_tolerance") or 0,
                        supply_count=q.get("supply_count") or 1,
                        reveal_claimant_names=(
                            q.get("reveal_claimant_names") if q.get("reveal_claimant_names") is not None else True
                        ),
                        winner_method=q.get("winner_method") or "favorite",
                        is_auto_title=q.get("is_auto_title", True),
                    )
                )

            req = CreatePollRequest(
                creator_name=anchor.get("creator_name"),
                response_deadline=response_deadline,
                prephase_deadline_minutes=anchor.get("prephase_deadline_minutes"),
                group_id=str(anchor["group_id"]) if anchor.get("group_id") else None,
                details=anchor.get("details"),
                context=anchor.get("context"),
                min_responses=anchor.get("min_responses"),
                show_preliminary_results=anchor.get("show_preliminary_results", True),
                allow_pre_ranking=anchor.get("allow_pre_ranking", True),
                allow_plus_ones=anchor.get("allow_plus_ones", False),
                questions=sub_reqs,
            )

            try:
                poll_row = _insert_poll(
                    conn, req, occ_dt,
                    creator_user_id=anchor.get("creator_user_id"),
                    group_creator_user_id=None,
                )
                title = _instance_title(q_rows)
                for index, sub in enumerate(sub_reqs):
                    _insert_question(conn, poll_row, req, sub, index, title, occ_dt)
                # Link the instance to its anchor; it carries no rule of its own.
                conn.execute(
                    "UPDATE polls SET recurrence_anchor_id = %(anchor)s WHERE id = %(id)s",
                    {"anchor": str(anchor["id"]), "id": str(poll_row["id"])},
                )
                new_ids.append(str(poll_row["id"]))
                last_done = occ
            except Exception:  # noqa: BLE001
                log.exception("recurrence: failed to materialize instance for anchor %s on %s", anchor["id"], occ)
                # Stop advancing this anchor on failure so we retry next tick.
                break

        # Advance the anchor's watermark to the last successfully-materialized date.
        conn.execute(
            "UPDATE polls SET recurrence_last_run = %(d)s WHERE id = %(id)s",
            {"d": last_done, "id": str(anchor["id"])},
        )

    return new_ids


def _instance_title(q_rows: Iterable[dict]) -> str:
    for q in q_rows:
        t = (q.get("title") or "").strip()
        if t:
            return t
    return "Poll"


def _as_list(value: Any) -> list | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return None
    return value if isinstance(value, list) else None


def _as_obj(value: Any) -> dict | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return None
    return value if isinstance(value, dict) else None
