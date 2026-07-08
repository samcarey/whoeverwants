"""Poll API endpoints. See docs/poll-phasing.md."""

from __future__ import annotations

from dataclasses import dataclass, field

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from algorithms.poll_title import _CATEGORY_LABELS, generate_poll_title
from database import get_db
from middleware import (
    browser_id_from_request as _browser_id,
    user_id_from_request as _user_id,
)
from services.auth import (
    caller_browser_ids,
    create_anonymous_user,
    resolve_actor_user_id,
)
from models import (
    CancelRecurrenceRequest,
    CloseQuestionRequest,
    CreatePollCommentRequest,
    CreatePollRequest,
    CreateQuestionRequest,
    CutoffSuggestionsRequest,
    EditVoteRequest,
    PollCommentResponse,
    PollResponse,
    PollSummaryQuestionResponse,
    PollSummaryResponse,
    PollSummarySlot,
    SetFollowStateRequest,
    PollVoteItem,
    PlusOneCandidateResponse,
    QuestionType,
    ReopenQuestionRequest,
    SubmitPollVotesRequest,
    SubmitVoteRequest,
    VoteResponse,
)
from services.contacts import (
    earliest_browser_for_user,
    is_contact,
    list_plus_one_candidates,
    reconcile_contacts,
    user_responded_to_poll,
)
from services.invites import issue_invite
from services.comments import (
    comment_is_mine,
    create_comment,
    delete_comment,
    list_comments,
    sanitize_comment_body,
)
from services.groups import (
    EXPLORE_PRIVACY,
    NIL_UUID,
    _is_uuid_like,
    add_group_admin,
    get_group_metadata,
    get_or_create_explore_group,
    group_display_name,
    group_name_phrase,
    is_caller_member_of_group,
    require_uuid,
)
from services.memberships import join_group, join_group_for_poll
from services.poll_categories import record_poll_categories
from services.poll_suggest import refresh_poll_suggestions
from services.poll_variants import spawn_variants
from services.push import (
    fan_out_new_poll,
    fan_out_phase_transition,
    fan_out_poll_closed,
    fan_out_to_user,
)
from services.validation import (
    validate_category_icon,
    validate_user_name,
    validate_winner_method,
)
from services.questions import (
    _compute_results,
    _edit_vote_on_question,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _json_or_none,
    _maybe_close_cancelled_event_poll,
    maybe_auto_age_poll,
    _row_to_question,
    _row_to_vote,
    _submit_vote_to_question,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/polls", tags=["polls"])


# Phase B.4: every SELECT that feeds `_row_to_poll` must surface
# `groups.short_id` as `group_short_id` so the FE can build
# `/g/<group.short_id>` URLs without a second round-trip. Migration 105
# moved `group_title` to `groups.title`, so the same JOIN is the source
# of truth for the group-name override too. Centralizing the JOIN here
# keeps the SELECTs in routers/polls.py and services/groups.py in
# lockstep — adding another field from the groups table only requires
# extending this string.
_SELECT_POLLS_WITH_GROUP = (
    "SELECT polls.*, "
    "t.short_id AS group_short_id, "
    "t.title AS group_title, "
    "t.image_updated_at AS group_image_updated_at, "
    "t.privacy AS group_privacy, "
    "t.creator_user_id AS group_creator_user_id "
    "FROM polls LEFT JOIN groups t ON polls.group_id = t.id"
)


def _categories_for_title(questions: list[CreateQuestionRequest]) -> list[str]:
    return [sp.category or sp.question_type.value for sp in questions]


def _contexts_for_title(questions: list[CreateQuestionRequest]) -> list[str | None]:
    return [sp.context for sp in questions]


def _iso_or_none(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _recurrence_obj(value) -> dict | None:
    """A JSONB recurrence column → dict (psycopg usually decodes JSONB already,
    but tolerate a raw string)."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        import json as _json
        try:
            parsed = _json.loads(value)
            return parsed if isinstance(parsed, dict) else None
        except (ValueError, TypeError):
            return None
    return None


def _recurrence_skip_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        import json as _json
        try:
            value = _json.loads(value)
        except (ValueError, TypeError):
            return []
    if isinstance(value, list):
        return [str(d)[:10] for d in value]
    return []


def _validate_request(req: CreatePollRequest) -> None:
    if not req.questions:
        raise HTTPException(status_code=400, detail="At least one question is required")

    # Explore feed (migration 144): for now the evolution system only handles
    # yes/no questions — a poll posted to /explore must be exactly one yes/no
    # question. The variant spawner reads + rewrites that single prompt.
    if req.explore and (
        len(req.questions) != 1
        or req.questions[0].question_type != QuestionType.yes_no
    ):
        raise HTTPException(
            status_code=400,
            detail="Explore polls must be a single yes/no question",
        )

    time_count = sum(1 for sp in req.questions if sp.question_type == QuestionType.time)
    if time_count > 1:
        raise HTTPException(
            status_code=400,
            detail="A poll can contain at most one time question",
        )

    for sp in req.questions:
        if sp.question_type == QuestionType.limited_supply:
            if sp.supply_count is None or sp.supply_count < 1:
                raise HTTPException(
                    status_code=400,
                    detail="A limited supply question needs at least one available slot",
                )

    seen: dict[tuple[str, str | None], list[str | None]] = {}
    for sp in req.questions:
        validate_category_icon(sp.category_icon)
        validate_winner_method(sp.winner_method)
        key = (sp.question_type.value, (sp.category or "").strip().lower() or None)
        seen.setdefault(key, []).append((sp.context or "").strip() or None)
    for contexts in seen.values():
        if len(contexts) <= 1:
            continue
        normalized = [c.lower() if c else None for c in contexts]
        if len(set(normalized)) != len(normalized):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Sub-questions of the same kind must each have a distinct "
                    "context to disambiguate them"
                ),
            )

    if req.response_deadline and req.prephase_deadline:
        try:
            response_dt = datetime.fromisoformat(
                req.response_deadline.replace("Z", "+00:00")
            )
            prephase_dt = datetime.fromisoformat(
                req.prephase_deadline.replace("Z", "+00:00")
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid deadline format: {exc}") from exc
        if prephase_dt >= response_dt:
            raise HTTPException(
                status_code=400,
                detail="Prephase deadline must be before the voting deadline",
            )


def _resolve_or_create_group(
    conn,
    requested_group_id: str | None,
    initial_title: str | None,
    *,
    creator_user_id: str | None,
    signed_in: bool,
) -> str:
    """Resolve `req.group_id` to an existing group, or mint a fresh one.

    Migration 105 retired `polls.follow_up_to` so the new-poll path no
    longer walks parent → child relationships. A group is just a uuid
    that polls share via `polls.group_id`. When `requested_group_id`
    points at a real group, return it; otherwise create a new group
    (optionally with `title` set on creation so first-poll-with-name
    flows are a single transaction).

    Migration 142: a freshly-minted group ALWAYS records a creator —
    `creator_user_id` is the poll's creator, which is always set now (the
    signed-in user, or the auto-minted anonymous account) — and seeds it as
    admin #1, so no group is ever admin-less (`groups.creator_user_id` is
    NOT NULL). Privacy is DECOUPLED from the creator: it still keys on genuine
    sign-in (`signed_in`), so an anonymous creator gets a public, URL-shareable
    group even though their auto-account is the recorded creator/admin.
    Resolving to an existing group doesn't touch privacy, creator, or admins.

    Unknown / malformed group ids fall through to "mint a fresh group"
    rather than 404 — the request still succeeds, it just lands in a new
    group instead of the one the caller named. That's the same fallback
    `_resolve_or_create_group_id` had for missing parents.
    """
    if requested_group_id:
        existing = conn.execute(
            "SELECT id FROM groups WHERE id = %(id)s",
            {"id": requested_group_id},
        ).fetchone()
        if existing:
            if initial_title is not None:
                conn.execute(
                    "UPDATE groups SET title = %(title)s WHERE id = %(id)s",
                    {"id": requested_group_id, "title": initial_title},
                )
            return str(existing["id"])
        logger.warning(
            "create_poll: requested group_id=%s not found; minting a fresh group",
            requested_group_id,
        )
    privacy = "private" if signed_in else "public"
    row = conn.execute(
        "INSERT INTO groups (title, privacy, creator_user_id) "
        "VALUES (%(title)s, %(privacy)s, %(creator_user_id)s) RETURNING id",
        {
            "title": initial_title,
            "privacy": privacy,
            "creator_user_id": creator_user_id,
        },
    ).fetchone()
    group_id = str(row["id"])
    if creator_user_id:
        add_group_admin(conn, group_id, creator_user_id)
    return group_id


def _attach_group_fields(conn, row) -> dict:
    """Enrich a polls row dict with `group_short_id` and `group_title`.

    INSERT/UPDATE `RETURNING *` paths only see polls.* columns, not the
    joined groups fields surfaced by `_SELECT_POLLS_WITH_GROUP`. After
    a write, look up the group row by `group_id` so the resulting row
    dict matches the SELECT shape `_row_to_poll` expects.
    """
    out = dict(row)
    if out.get("group_id") and not (
        out.get("group_short_id")
        and "group_title" in out
        and "group_image_updated_at" in out
        and "group_privacy" in out
        and "group_creator_user_id" in out
    ):
        t = conn.execute(
            "SELECT short_id, title, image_updated_at, privacy, creator_user_id "
            "FROM groups WHERE id = %(id)s",
            {"id": out["group_id"]},
        ).fetchone()
        if t:
            out.setdefault("group_short_id", t.get("short_id"))
            out.setdefault("group_title", t.get("title"))
            out.setdefault("group_image_updated_at", t.get("image_updated_at"))
            out.setdefault("group_privacy", t.get("privacy"))
            out.setdefault("group_creator_user_id", t.get("creator_user_id"))
    return out


def _insert_poll(
    conn,
    req: CreatePollRequest,
    now: datetime,
    *,
    creator_user_id: str | None,
    group_creator_user_id: str | None,
) -> dict:
    """Insert a new poll under the requested (or freshly-minted) group.

    Migration 105 dropped `polls.follow_up_to` and `polls.group_title`:
    groups are first-class entities (one row in `groups`), and the
    group name override lives on `groups.title` rather than being
    duplicated across every poll.

    `creator_user_id` is the POLL's creator — always set now (migration 123):
    the signed-in user, or the lightweight account auto-minted for an
    anonymous creator. `group_creator_user_id` is the SIGNED-IN user only
    (None for anonymous, even though they have an auto-account): Phase E
    keys a freshly-minted group's privacy on it (signed-in → private +
    recorded creator; anonymous → public + no group creator), so the
    anonymous-first link-sharing flow keeps working — the auto-account
    must NOT flip new groups private.
    """
    # `req.group_title` only seeds the title when minting a fresh group.
    # For existing groups, it overwrites the title — kept for API symmetry
    # but the FE create flow doesn't pass it; group renames go through
    # `POST /api/groups/{route_id}/title` instead.
    group_id = _resolve_or_create_group(
        conn,
        req.group_id,
        req.group_title,
        creator_user_id=creator_user_id,
        signed_in=group_creator_user_id is not None,
    )
    # The prephase (suggestion / availability) countdown starts at creation —
    # there is no deferral to the first submission. A preset duration
    # (`prephase_deadline_minutes`) is resolved to an absolute deadline right
    # now; a custom absolute `prephase_deadline` passes through unchanged.
    # Capped to just before the voting deadline so the prephase can't outlast
    # voting.
    prephase_deadline = req.prephase_deadline
    if req.prephase_deadline_minutes:
        prephase_deadline = now + timedelta(minutes=req.prephase_deadline_minutes)
        if req.response_deadline:
            response_dt = datetime.fromisoformat(
                req.response_deadline.replace("Z", "+00:00")
            )
            # TODO (pre-existing, surfaced June 2026): a tz-NAIVE
            # response_deadline (no offset/Z) parses to a naive response_dt and
            # the comparison below raises "can't compare offset-naive and
            # offset-aware datetimes" → 500. The FE always sends tz-aware, so
            # this is latent (only a raw/malformed API caller hits it). If
            # hardening: coerce response_dt to UTC when tzinfo is None.
            if prephase_deadline >= response_dt:
                prephase_deadline = response_dt - timedelta(minutes=1)
    # "Plus one/more": default ON for polls with a time question (the common
    # scheduling case — "I'm answering for my partner too") or a limited-supply
    # question (claiming a scarce slot for yourself + others, e.g. "2 tickets,
    # I'll take both"), OFF otherwise. An explicit `req.allow_plus_ones` (the FE
    # toggle) overrides the default.
    allow_plus_ones = req.allow_plus_ones
    if allow_plus_ones is None:
        allow_plus_ones = any(
            sp.question_type
            in (QuestionType.time, QuestionType.limited_supply, QuestionType.showtime)
            for sp in req.questions
        )
    # Recurrence (migration 141): when a rule is provided, this poll becomes
    # the series anchor. `recurrence_last_run` starts at the rule's start date
    # so the anchor itself counts as the first (already-existing) occurrence;
    # the cron tick materializes only later occurrences. `_validate_recurrence`
    # returns None for a non-recurring / malformed rule.
    recurrence = _validate_recurrence(req.recurrence)
    recurrence_last_run = None
    if recurrence is not None:
        recurrence_last_run = recurrence.get("start") or now.date().isoformat()
    row = conn.execute(
        """
        INSERT INTO polls (
            creator_name, creator_user_id, response_deadline,
            prephase_deadline, prephase_deadline_minutes,
            context, details,
            min_responses, show_preliminary_results, allow_pre_ranking,
            allow_plus_ones,
            recurrence, recurrence_last_run,
            group_id,
            created_at, updated_at
        )
        VALUES (
            %(creator_name)s, %(creator_user_id)s, %(response_deadline)s,
            %(prephase_deadline)s, %(prephase_deadline_minutes)s,
            %(context)s, %(details)s,
            %(min_responses)s, %(show_preliminary_results)s, %(allow_pre_ranking)s,
            %(allow_plus_ones)s,
            %(recurrence)s::jsonb, %(recurrence_last_run)s,
            %(group_id)s,
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "creator_name": req.creator_name,
            "creator_user_id": creator_user_id,
            "response_deadline": req.response_deadline,
            "prephase_deadline": prephase_deadline,
            "prephase_deadline_minutes": req.prephase_deadline_minutes,
            "context": req.context,
            "details": req.details,
            "min_responses": req.min_responses,
            "show_preliminary_results": req.show_preliminary_results,
            "allow_pre_ranking": req.allow_pre_ranking,
            "allow_plus_ones": allow_plus_ones,
            "recurrence": _json_or_none(recurrence),
            "recurrence_last_run": recurrence_last_run,
            "group_id": group_id,
            "now": now,
        },
    ).fetchone()
    return _attach_group_fields(conn, row)


# Allowed recurrence frequencies (mirrors lib/recurrence.ts).
_RECURRENCE_FREQUENCIES = {"daily", "weekly", "monthly"}


def _validate_recurrence(rule: dict | None) -> dict | None:
    """Light validation/normalization of an incoming recurrence rule. Returns
    None for a non-recurring (frequency 'none'/missing) or malformed rule so a
    bad payload simply yields a one-off poll rather than a 500. Mirrors the
    RecurrenceRule shape; the heavy occurrence math lives in services.recurrence.
    """
    if not isinstance(rule, dict):
        return None
    freq = rule.get("frequency")
    if freq not in _RECURRENCE_FREQUENCIES:
        return None
    start = rule.get("start")
    if not isinstance(start, str) or len(start) < 10:
        return None
    interval = rule.get("interval", 1)
    try:
        interval = max(1, int(interval))
    except (ValueError, TypeError):
        interval = 1
    weekdays = [d for d in (rule.get("weekdays") or []) if isinstance(d, int) and 0 <= d <= 6]
    monthly_mode = rule.get("monthlyMode")
    if monthly_mode not in ("dayOfMonth", "nthWeekday"):
        monthly_mode = "dayOfMonth"
    end = rule.get("end") or {"type": "never"}
    end_type = end.get("type") if isinstance(end, dict) else "never"
    if end_type == "after":
        try:
            count = max(1, int(end.get("count", 1)))
        except (ValueError, TypeError):
            count = 1
        norm_end = {"type": "after", "count": count}
    elif end_type == "on" and isinstance(end.get("date"), str):
        norm_end = {"type": "on", "date": end["date"][:10]}
    else:
        norm_end = {"type": "never"}
    return {
        "frequency": freq,
        "interval": interval,
        "weekdays": weekdays,
        "monthlyMode": monthly_mode,
        "end": norm_end,
        "start": start[:10],
    }


def _insert_question(
    conn,
    poll_row: dict,
    req: CreatePollRequest,
    sub: CreateQuestionRequest,
    question_index: int,
    title: str,
    now: datetime,
) -> dict:
    # Phase 5: wrapper-level columns (creator_name, creator_user_id,
    # response_deadline, group_title, is_closed, close_reason,
    # short_id, suggestion_deadline) live exclusively on the poll wrapper.
    # Sub-question rows carry only per-question fields.
    return conn.execute(
        """
        INSERT INTO questions (
            title, question_type, options,
            suggestion_deadline_minutes,
            details,
            day_time_windows, duration_window,
            category, category_icon, options_metadata,
            reference_latitude, reference_longitude,
            reference_location_label,
            min_availability_percent,
            time_min_participants,
            exclusion_tolerance,
            supply_count,
            reveal_claimant_names,
            winner_method,
            is_auto_title,
            poll_id, question_index,
            created_at, updated_at
        )
        VALUES (
            %(title)s, %(question_type)s, %(options)s::jsonb,
            %(suggestion_deadline_minutes)s,
            %(details)s,
            %(day_time_windows)s::jsonb, %(duration_window)s::jsonb,
            %(category)s, %(category_icon)s, %(options_metadata)s::jsonb,
            %(reference_latitude)s, %(reference_longitude)s,
            %(reference_location_label)s,
            %(min_availability_percent)s,
            %(time_min_participants)s,
            %(exclusion_tolerance)s,
            %(supply_count)s,
            %(reveal_claimant_names)s,
            %(winner_method)s,
            %(is_auto_title)s,
            %(poll_id)s, %(question_index)s,
            %(now)s, %(now)s
        )
        RETURNING *
        """,
        {
            "title": title,
            "question_type": sub.question_type.value,
            "options": _json_or_none(sub.options),
            "suggestion_deadline_minutes": sub.suggestion_deadline_minutes,
            "details": sub.context,
            "day_time_windows": _json_or_none(sub.day_time_windows),
            "duration_window": _json_or_none(sub.duration_window),
            "category": sub.category or "custom",
            "category_icon": validate_category_icon(sub.category_icon),
            "options_metadata": _json_or_none(sub.options_metadata),
            "reference_latitude": sub.reference_latitude,
            "reference_longitude": sub.reference_longitude,
            "reference_location_label": sub.reference_location_label,
            "min_availability_percent": (
                sub.min_availability_percent if sub.question_type == QuestionType.time else None
            ),
            "time_min_participants": (
                sub.min_participants if sub.question_type == QuestionType.time else None
            ),
            "exclusion_tolerance": (
                max(0, sub.exclusion_tolerance) if sub.question_type == QuestionType.time else 0
            ),
            "supply_count": (
                sub.supply_count if sub.question_type == QuestionType.limited_supply else None
            ),
            "reveal_claimant_names": sub.reveal_claimant_names,
            "winner_method": (
                validate_winner_method(sub.winner_method)
                if sub.question_type == QuestionType.ranked_choice
                else "favorite"
            ),
            "is_auto_title": sub.is_auto_title,
            "poll_id": str(poll_row["id"]),
            "question_index": question_index,
            "now": now,
        },
    ).fetchone()


def _category_for_title(question_row: dict) -> str:
    """The "category" string to feed into `generate_poll_title` for one
    question row. Time questions always resolve to `"time"` regardless of
    the stored `category` column, since picking the "When" bubble in the
    create-poll UI sets `question_type=time` but leaves `category="custom"`
    (the form's default). The user model treats time AS the category, so
    a time question titled "Time for Movie" must not become
    "Custom for Movie" when the poll-level title is regenerated."""
    if question_row.get("question_type") == "time":
        return "time"
    if question_row.get("question_type") == "limited_supply":
        return "limited_supply"
    if question_row.get("question_type") == "showtime":
        return "showtime"
    return question_row.get("category") or question_row.get("question_type") or ""


def _poll_own_title(row: dict, question_rows: list[dict]) -> str:
    """The poll's OWN title, ignoring the `group_title` group-name override.

    Every question shares the wrapper-level `question_title` resolved by
    `create_poll` (user-typed yes_no prompt OR `req.group_title` OR the
    auto-generated multi-question title), so reading questions[0].title
    gives us the user's intended poll title. Notifications surface this on
    line 2 (the group name goes on line 1), so it must NOT collapse into
    the group override the way `_compute_display_title` does."""
    if question_rows:
        primary = (question_rows[0].get("title") or "").strip()
        if primary:
            return primary
    categories = [_category_for_title(sp) for sp in question_rows]
    # Per-question context lives in `questions.details` (see _insert_question
    # below). Pass it through so the auto-title can reflect a shared context
    # like "Restaurant, Movie for Tonight" when none is set on the wrapper.
    contexts = [sp.get("details") for sp in question_rows]
    return generate_poll_title(categories, row.get("context"), contexts)


def _compute_display_title(row: dict, question_rows: list[dict]) -> str:
    override = row.get("group_title")
    if override:
        return override
    return _poll_own_title(row, question_rows)


# Mirror of the FE icon resolution (components/TypeFieldInput.tsx
# BUILT_IN_TYPES + lib/questionListUtils.ts QUESTION_TYPE_SYMBOLS /
# getCategoryIcon). Used to prefix a single-question poll's title in push
# notifications. Keep in sync with the FE constants.
_CATEGORY_ICONS = {
    "yes_no": "👍",
    "time": "📅",
    "restaurant": "🍽️",
    "location": "📍",
    "movie": "🎬",
    "video_game": "🎮",
    "limited_supply": "🎟️",
    "showtime": "🎬",
}
_QUESTION_TYPE_SYMBOLS = {
    "yes_no": "👍",
    "ranked_choice": "🗳️",
    "time": "📅",
    "limited_supply": "🎟️",
    "showtime": "🎬",
}


def _question_icon(question_row: dict) -> str:
    """The category icon for a question, falling back to its question-type
    symbol (matches FE `getCategoryIcon`). A time question stores
    category="custom" but resolves to 📅 via the type-symbol fallback."""
    custom_icon = question_row.get("category_icon")
    if custom_icon:
        return custom_icon
    category = question_row.get("category")
    if category and category != "custom":
        icon = _CATEGORY_ICONS.get(category)
        if icon:
            return icon
    return _QUESTION_TYPE_SYMBOLS.get(question_row.get("question_type"), "☰")


def _poll_body(row: dict, question_rows: list[dict]) -> str:
    """The notification line-2 text: the poll's own title, prefixed with the
    category/type icon when the poll has exactly one question. Multi-question
    polls have no single category, so they show the title alone."""
    title = _poll_own_title(row, question_rows)
    if len(question_rows) == 1:
        return f"{_question_icon(question_rows[0])} {title}"
    return title


def _row_to_poll(
    row: dict,
    question_rows: list[dict],
    voter_data: PollVoterData | None = None,
    viewer_user_id: str | None = None,
) -> PollResponse:
    vd = voter_data or PollVoterData()
    creator_user_id = (
        str(row["creator_user_id"]) if row.get("creator_user_id") else None
    )
    return PollResponse(
        id=str(row["id"]),
        short_id=row.get("short_id"),
        group_id=str(row["group_id"]) if row.get("group_id") else None,
        group_short_id=row.get("group_short_id"),
        creator_name=row.get("creator_name"),
        creator_user_id=creator_user_id,
        viewer_is_creator=(
            creator_user_id is not None
            and viewer_user_id is not None
            and creator_user_id == str(viewer_user_id)
        ),
        response_deadline=_iso_or_none(row.get("response_deadline")),
        prephase_deadline=_iso_or_none(row.get("prephase_deadline")),
        prephase_deadline_minutes=row.get("prephase_deadline_minutes"),
        is_closed=row.get("is_closed", False),
        close_reason=row.get("close_reason"),
        group_title=row.get("group_title"),
        group_image_updated_at=_iso_or_none(row.get("group_image_updated_at")),
        group_privacy=row.get("group_privacy"),
        group_creator_user_id=(
            str(row["group_creator_user_id"])
            if row.get("group_creator_user_id")
            else None
        ),
        context=row.get("context"),
        details=row.get("details"),
        title=_compute_display_title(row, question_rows),
        created_at=_iso_or_none(row["created_at"]) or "",
        updated_at=_iso_or_none(row["updated_at"]) or "",
        min_responses=row.get("min_responses"),
        show_preliminary_results=row.get("show_preliminary_results", True),
        allow_pre_ranking=row.get("allow_pre_ranking", True),
        allow_plus_ones=row.get("allow_plus_ones", False),
        recurrence=_recurrence_obj(row.get("recurrence")),
        recurrence_skip_dates=_recurrence_skip_list(row.get("recurrence_skip_dates")),
        recurrence_until=_iso_or_none(row.get("recurrence_until")),
        recurrence_anchor_id=(
            str(row["recurrence_anchor_id"]) if row.get("recurrence_anchor_id") else None
        ),
        variant_parent_id=(
            str(row["variant_parent_id"]) if row.get("variant_parent_id") else None
        ),
        variant_root_id=(
            str(row["variant_root_id"]) if row.get("variant_root_id") else None
        ),
        variant_direction=row.get("variant_direction"),
        variant_generation=row.get("variant_generation") or 0,
        questions=[_row_to_question(sp) for sp in question_rows],
        voter_names=vd.voter_names,
        anonymous_count=vd.anonymous_count,
        voter_name_counts=vd.voter_name_counts,
        viewed_ignored_count=vd.viewed_ignored_count,
        viewed_total=vd.viewed_total,
        suggestion_count=vd.suggestion_count,
    )


def _fetch_questions(conn, poll_id: str) -> list[dict]:
    return conn.execute(
        """
        SELECT * FROM questions
        WHERE poll_id = %(poll_id)s
        ORDER BY question_index NULLS LAST, created_at
        """,
        {"poll_id": poll_id},
    ).fetchall()


@dataclass
class PollVoterData:
    """Poll-level engagement aggregates the FE consumes instead of summing
    per-question vote rows (per the Addressability paradigm). Named-by-field
    so callers don't depend on a positional tuple order."""

    voter_names: list[str] = field(default_factory=list)
    anonymous_count: int = 0
    # Parallel name→count map: DISTINCT people per name, keyed on browser_id
    # (GREATEST(...,1)) so one person voting across N sibling questions counts
    # once while two different "Alex"es on two browsers count as 2. Lets the FE
    # expand a shared name into that many separate bubbles. Decoupled from
    # choices per the ballot-privacy TODO. See CLAUDE.md → VoterList note.
    voter_name_counts: dict[str, int] = field(default_factory=dict)
    # Browsers that opened the poll >5 min ago but never voted/abstained
    # ("ignored" viewers — mostly nameless). Per-browser count.
    viewed_ignored_count: int = 0
    # Distinct viewers, account-collapsed (two devices of one signed-in user
    # count once). The raw "how many saw it" turnout denominator.
    viewed_total: int = 0
    # Distinct non-empty options voters proposed across the poll's ranked_choice
    # suggestion phase(s) (read from votes.suggestions, stable across phases).
    suggestion_count: int = 0


def _compute_poll_voter_data(conn, poll_id: str) -> PollVoterData:
    """Poll-level voter aggregation in two round-trips: one over the poll's
    votes (named voters deduped case-sensitively, anon = MAX-per-question,
    distinct suggestions, and per-name DISTINCT-people counts), one over
    poll_views (account-collapsed viewer total + the >5-min no-action "ignored"
    count). See CLAUDE.md 'App-Icon Badge Model + Viewed Tracking'.

    `voter_name_counts` carries the number of DISTINCT people who voted under
    each name, keyed on `browser_id` (GREATEST(...,1)) — one person voting
    across N sibling questions counts once, while two different "Alex"es (two
    browsers) count as 2. Legacy NULL-browser_id votes floor to 1. The FE
    expands each name into that many separate bubbles. Decoupled from choices
    per the ballot-privacy TODO."""
    votes_row = conn.execute(
        """
        WITH all_votes AS (
            SELECT v.question_id, v.voter_name, v.browser_id, v.suggestions,
                   v.plus_one_names
            FROM votes v
            JOIN questions p ON v.question_id = p.id
            WHERE p.poll_id = %(mid)s
        ),
        anon_per_question AS (
            SELECT question_id, COUNT(*) AS c
            FROM all_votes
            WHERE voter_name IS NULL OR voter_name = ''
            GROUP BY question_id
        ),
        submitter_counts AS (
            SELECT voter_name AS name, GREATEST(COUNT(DISTINCT browser_id), 1) AS c
            FROM all_votes
            WHERE voter_name IS NOT NULL AND voter_name != ''
            GROUP BY voter_name
        ),
        -- "Plus one/more": each submitter's plus-one array repeats across their
        -- sibling-question rows, so dedup to one array per browser before
        -- unnesting (otherwise an N-question poll would multiply the plus-ones
        -- by N).
        plus_one_arrays AS (
            SELECT DISTINCT ON (browser_id) browser_id, plus_one_names
            FROM all_votes
            WHERE plus_one_names IS NOT NULL AND browser_id IS NOT NULL
            ORDER BY browser_id
        ),
        plus_one_entries AS (
            SELECT btrim(elem) AS name
            FROM plus_one_arrays
            CROSS JOIN LATERAL jsonb_array_elements_text(plus_one_names) AS elem
        ),
        plus_one_named AS (
            SELECT name, COUNT(*)::int AS c
            FROM plus_one_entries
            WHERE name IS NOT NULL AND name <> ''
            GROUP BY name
        ),
        -- Merge submitter names + named plus-ones, summing the per-name counts
        -- so a name shared by a real voter and a plus-one (or two plus-ones)
        -- expands into that many bubbles.
        named_merged AS (
            SELECT name, SUM(c)::int AS c
            FROM (
                SELECT name, c FROM submitter_counts
                UNION ALL
                SELECT name, c FROM plus_one_named
            ) u
            GROUP BY name
        )
        SELECT
            COALESCE(
                (SELECT array_agg(name ORDER BY name) FROM named_merged),
                ARRAY[]::text[]
            ) AS voter_names,
            COALESCE(
                (SELECT jsonb_object_agg(name, c) FROM named_merged),
                '{}'::jsonb
            ) AS voter_name_counts,
            COALESCE((SELECT MAX(c) FROM anon_per_question), 0)
              + COALESCE((SELECT COUNT(*) FROM plus_one_entries
                           WHERE name IS NULL OR name = ''), 0) AS anonymous_count,
            COALESCE((SELECT COUNT(*) FROM plus_one_entries), 0) AS plus_one_total,
            (SELECT COUNT(DISTINCT s)
               FROM all_votes
               CROSS JOIN LATERAL unnest(COALESCE(suggestions, ARRAY[]::text[])) AS s
              WHERE s IS NOT NULL AND s <> '') AS suggestion_count
        """,
        {"mid": poll_id},
    ).fetchone()
    # Both viewer counts scan poll_views for this poll, so they share one query:
    #   viewed_total   — distinct viewers, collapsing every browser linked to an
    #                    account via LEFT JOIN user_browsers + COALESCE(user_id,
    #                    browser_id) (same account-aware pattern as
    #                    load_user_visibility); NO time/action filter.
    #   viewed_ignored — per-browser count of "opened >5 min ago, never
    #                    voted/abstained" (the user_browsers join is 1:1 on the
    #                    browser_id PK, so the FILTER row count is unaffected).
    viewed_row = conn.execute(
        """
        SELECT
            COUNT(DISTINCT COALESCE(ub.user_id::text, pv.browser_id::text)) AS viewed_total,
            COUNT(*) FILTER (
                WHERE pv.first_viewed_at < NOW() - INTERVAL '5 minutes'
                  AND NOT EXISTS (
                    SELECT 1 FROM votes v
                      JOIN questions q ON v.question_id = q.id
                     WHERE q.poll_id = %(mid)s AND v.browser_id = pv.browser_id
                  )
            ) AS viewed_ignored
          FROM poll_views pv
          LEFT JOIN user_browsers ub ON ub.browser_id = pv.browser_id
         WHERE pv.poll_id = %(mid)s
        """,
        {"mid": poll_id},
    ).fetchone()
    return PollVoterData(
        voter_names=list(votes_row["voter_names"] or []),
        anonymous_count=int(votes_row["anonymous_count"] or 0),
        voter_name_counts={
            k: int(v) for k, v in (votes_row["voter_name_counts"] or {}).items()
        },
        viewed_ignored_count=int(viewed_row["viewed_ignored"] or 0),
        # "Plus one/more": represented people aren't browsers in poll_views, so
        # add them to the viewer total too — keeps "voted ≤ viewed" (the group
        # card's "M of V seen" turnout line) consistent now that the voted
        # count includes plus-ones.
        viewed_total=int(viewed_row["viewed_total"] or 0)
        + int(votes_row["plus_one_total"] or 0),
        suggestion_count=int(votes_row["suggestion_count"] or 0),
    )


def _record_poll_view(conn, browser_id: str | None, poll_id: str, now: datetime) -> None:
    """Upsert this browser's last-viewed watermark for the poll. Drives the
    phase-transition skip-logic ("has this member already seen the final
    options?"). No-op when browser_id is absent."""
    if not browser_id:
        return
    # SELECT-from-polls guard so an unknown poll_id is a no-op instead of an
    # FK-violation 500 (the /viewed endpoint takes a client-supplied id).
    conn.execute(
        """
        INSERT INTO poll_views (browser_id, poll_id, last_viewed_at)
        SELECT %(b)s, %(p)s, %(now)s
        WHERE EXISTS (SELECT 1 FROM polls WHERE id = %(p)s)
        ON CONFLICT (browser_id, poll_id)
          DO UPDATE SET last_viewed_at = EXCLUDED.last_viewed_at
        """,
        {"b": browser_id, "p": poll_id, "now": now},
    )


def _notification_base(conn, poll_id: str):
    """(group_db_id, base_payload, poll_row, group_phrase, question_rows)
    shared by the close + transition payload builders, or None when the poll
    can't be routed (no group). The base carries body/url/group_id/badge; the
    `body` (line 2) is the poll's own title prefixed with its category icon.
    Callers build the title (line 1) as "<event> in <group_phrase>" + add a
    tag, where `group_phrase` is the quoted group name. `question_rows` lets
    the transition builder pick a prephase-specific event phrase."""
    row = conn.execute(
        f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
        {"id": poll_id},
    ).fetchone()
    if not row or not row.get("group_id"):
        return None
    question_rows = _fetch_questions(conn, poll_id)
    group_route = row.get("group_short_id") or str(row["group_id"])
    group_phrase = group_name_phrase(
        conn, str(row["group_id"]), override=row.get("group_title")
    )
    # Path form (`/g/<group>/p/<poll>`), not the legacy `?p=` query form, so
    # tapping the notification lands straight on the poll detail page instead
    # of painting the group list first and redirecting (the visible flash).
    poll_short = row.get("short_id")
    poll_url = f"/g/{group_route}/p/{poll_short}" if poll_short else f"/g/{group_route}"
    base = {
        "body": _poll_body(row, question_rows),
        "url": poll_url,
        "group_id": group_route,
        # No hardcoded badge — _dispatch_pushes injects each recipient's real
        # count; omitting it here means a count-computation failure leaves the
        # icon badge untouched instead of asserting a phantom "1".
    }
    return str(row["group_id"]), base, row, group_phrase, question_rows


def _format_slot_label(slot_key: str) -> str:
    """Friendly label for a time-slot key ("YYYY-MM-DD HH:MM-HH:MM") used in
    the close-notification outcome summary, e.g. "Sat Apr 28, 7 PM". Falls back
    to the raw key on any parse failure."""
    from algorithms.time_question import parse_slot_key

    try:
        date_str, start_min, _end_min = parse_slot_key(slot_key)
        d = datetime.strptime(date_str, "%Y-%m-%d")
        hour, minute = divmod(start_min, 60)
        period = "AM" if hour < 12 else "PM"
        hour12 = hour % 12 or 12
        minute_str = f":{minute:02d}" if minute else ""
        return f"{d:%a} {d:%b} {d.day}, {hour12}{minute_str} {period}"
    except Exception:
        return slot_key


def _question_decision_label(conn, question_row: dict) -> str | None:
    """The human-readable winning choice for one closed question, or None when
    no decision was reached (no votes / a tie / all-abstain). Drives the
    poll-closed notification's "Decided: …" body."""
    votes = conn.execute(
        "SELECT * FROM votes WHERE question_id = %(qid)s",
        {"qid": question_row["id"]},
    ).fetchall()
    # Tentative time-slot generation is irrelevant once the poll is closed and
    # is the most expensive branch — skip it.
    results = _compute_results(
        dict(question_row), [dict(v) for v in votes],
        include_tentative_time_options=False,
    )
    winner = results.winner
    if not winner:
        return None
    qtype = question_row["question_type"]
    if qtype == "yes_no":
        if winner == "yes":
            return "Yes"
        if winner == "no":
            return "No"
        return None  # "tie" or anything unexpected → no decision
    if qtype == "time":
        return _format_slot_label(winner)
    # ranked_choice (and any future type whose winner is the option text)
    return winner


def _poll_decision_summary(conn, question_rows: list[dict]) -> str | None:
    """The poll's combined outcome, e.g. "Thai · Sat Apr 28, 7 PM" — one part
    per question that reached a decision, joined with " · ". None when no
    question produced a winner (the caller then keeps the poll-title body)."""
    parts = [
        label
        for sp in question_rows
        if (label := _question_decision_label(conn, sp))
    ]
    if not parts:
        return None
    summary = " · ".join(parts)
    # Keep the body bounded — push services truncate, but we'd rather control
    # where the cut lands than ship an unbounded string.
    if len(summary) > 120:
        summary = summary[:119].rstrip() + "…"
    return summary


def _build_close_notification(conn, poll_id: str) -> tuple[str, dict] | None:
    """(group_id, payload) for a poll-closed push, or None when unroutable.
    Shared by the inline close endpoint and the cron tick.

    Line 2 (body) delivers the OUTCOME — "Decided: <winners>" — when the poll
    reached a decision, so a closed-poll push answers "what got decided?" not
    just "a poll closed". Falls back to the poll's own title (the base body)
    when nothing was decided (no votes / ties / all-abstain)."""
    built = _notification_base(conn, poll_id)
    if not built:
        return None
    group_id, base, _row, group_phrase, question_rows = built
    summary = _poll_decision_summary(conn, question_rows)
    body = f"Decided: {summary}" if summary else base["body"]
    return group_id, {
        **base,
        "body": body,
        "title": f"Poll closed in {group_phrase}",
        "tag": f"poll-closed-{poll_id}",
    }


def _latest_prephase_contribution(conn, poll_id: str):
    """Timestamp of the most recent option-adding vote (a suggestion or an
    availability submission) across the poll's questions, or None. Feeds the
    transition skip-logic's "did new options appear since they last looked?"."""
    row = conn.execute(
        """
        SELECT MAX(v.created_at) AS latest
          FROM votes v
          JOIN questions q ON v.question_id = q.id
         WHERE q.poll_id = %(pid)s
           AND (
             (v.suggestions IS NOT NULL AND array_length(v.suggestions, 1) > 0)
             OR v.voter_day_time_windows IS NOT NULL
           )
        """,
        {"pid": poll_id},
    ).fetchone()
    return row["latest"] if row else None


def _transition_event_phrase(question_rows: list[dict]) -> str:
    """The line-1 event phrase for a phase-transition push, chosen by the
    poll's prephase kind. ranked_choice questions collect suggestions, so
    their prephase ending means new options to rank → "New options
    available". time questions collect availability, so their prephase
    ending opens the like/dislike vote → "Time to vote". A poll mixing both
    (or any other shape) falls back to the generic "Voting is open"."""
    types = {sp.get("question_type") for sp in question_rows}
    has_ranked = "ranked_choice" in types
    has_time = "time" in types
    if has_ranked and not has_time:
        return "New options available"
    if has_time and not has_ranked:
        return "Time to vote"
    return "Voting is open"


def _build_transition_notification(conn, poll_id: str):
    """(group_id, payload, prevoting_on, latest_contribution) for a
    phase-transition push, or None when unroutable. Shared by the inline
    cutoff endpoints and the cron tick."""
    built = _notification_base(conn, poll_id)
    if not built:
        return None
    group_id, base, row, group_phrase, question_rows = built
    payload = {
        **base,
        "title": f"{_transition_event_phrase(question_rows)} in {group_phrase}",
        "tag": f"poll-voting-{poll_id}",
    }
    return (
        group_id,
        payload,
        row.get("allow_pre_ranking") is not False,
        _latest_prephase_contribution(conn, poll_id),
    )


def _build_reminder_notification(conn, poll_id: str) -> tuple[str, dict] | None:
    """(group_id, payload) for a "you haven't voted yet" reminder push, or None
    when unroutable. Used only by the cron tick's vote-reminder pass. Line 2
    (body) is the poll's own title (the base body); line 1 nudges the recipient
    to vote before the deadline."""
    built = _notification_base(conn, poll_id)
    if not built:
        return None
    group_id, base, _row, group_phrase, _question_rows = built
    return group_id, {
        **base,
        "title": f"Reminder to vote in {group_phrase}",
        "tag": f"vote-reminder-{poll_id}",
    }


def _schedule_close_notification(conn, poll_id, *, already_notified, background_tasks):
    """Build + schedule the poll-closed push, unless the poll was already
    close-notified. No-op when unroutable. Fan-out runs after the response."""
    if already_notified:
        return
    built = _build_close_notification(conn, poll_id)
    if built:
        group_id, payload = built
        background_tasks.add_task(fan_out_poll_closed, group_id, poll_id, payload)


def _schedule_transition_notification(conn, poll_id, *, already_notified, background_tasks):
    """Build + schedule the phase-transition push, unless the poll was already
    transition-notified. No-op when unroutable."""
    if already_notified:
        return
    built = _build_transition_notification(conn, poll_id)
    if built:
        group_id, payload, prevoting_on, latest = built
        background_tasks.add_task(
            fan_out_phase_transition,
            group_id,
            poll_id,
            payload,
            prevoting_on=prevoting_on,
            latest_contribution=latest,
        )


def _caller_user_id(conn, request: Request) -> str | None:
    """The caller's effective user_id — bearer session, else the account
    linked to their browser_id (auto-created at poll-create time). The
    single primitive poll authorship + `viewer_is_creator` are built on."""
    return resolve_actor_user_id(
        conn, user_id=_user_id(request), browser_id=_browser_id(request)
    )


def _resolve_or_create_creator(
    conn, request: Request, display_name: str | None
) -> str:
    """Resolve the caller's user_id, minting a lightweight anonymous
    account (bound to their browser_id) when they have none yet. Called at
    poll-create time: providing a name (already required) is what
    establishes the account that authorizes later close/reopen/cutoff."""
    user_id = _caller_user_id(conn, request)
    if user_id:
        return user_id
    return create_anonymous_user(
        conn, browser_id=_browser_id(request), display_name=display_name
    )


@router.post("", response_model=PollResponse, status_code=201)
def create_poll(
    req: CreatePollRequest, request: Request, background_tasks: BackgroundTasks
):
    _validate_request(req)
    req.creator_name = validate_user_name(req.creator_name, field="Creator name")

    # questions.title is NOT NULL, so each question row needs a value even though
    # display goes through the poll's computed title.
    question_title = (
        req.title
        or req.group_title
        or generate_poll_title(
            _categories_for_title(req.questions),
            req.context,
            _contexts_for_title(req.questions),
        )
    )

    now = datetime.now(timezone.utc)
    creator_browser_id = _browser_id(request)

    with get_db() as conn:
        # Every poll gets a creator_user_id now (migration 123 retired the
        # per-browser secret). Signed-in → the session user; anonymous →
        # a lightweight account auto-minted from the (required) creator
        # name and bound to this browser, so close/reopen/cutoff can
        # authorize against it later without a secret.
        creator_user_id = _resolve_or_create_creator(conn, request, req.creator_name)
        # Explore feed (migration 143): file the poll into the caller's own
        # explore group (minted lazily on the first explore poll). Overrides
        # any `group_id` the request carried — the explore group is resolved
        # by creator, not by id — and clears `group_title` so the FE's
        # auto-title can't rename the shared explore group. `_insert_poll`
        # then resolves this existing group, leaving its privacy='explore'.
        if req.explore:
            req.group_id = get_or_create_explore_group(conn, creator_user_id)
            req.group_title = None
        # Group privacy (Phase E) keys on GENUINE sign-in, not the auto-account
        # — anonymous-created groups must stay public so URL-sharing works.
        signed_in_user_id = _user_id(request)
        poll_row = _insert_poll(
            conn, req, now,
            creator_user_id=creator_user_id,
            group_creator_user_id=signed_in_user_id,
        )
        question_rows = [
            _insert_question(conn, poll_row, req, sub, index, question_title, now)
            for index, sub in enumerate(req.questions)
        ]
        # "Ask for Availability before Voting" toggled OFF: a time question
        # created without a prephase cutoff (`suggestion_deadline_minutes`
        # unset) has no availability phase, so finalize its candidate slots
        # from the creator's day_time_windows + duration right now. With zero
        # votes the min-availability filter is a no-op and the longest-per-start
        # dedup applies — identical to the cutoff-time finalization, just with
        # no availability data. The question lands with `options` set, which the
        # FE reads as "not in the availability phase" so the poll opens straight
        # into the like/dislike (preference) ballot.
        finalized_time_slots = False
        for sub, qrow in zip(req.questions, question_rows):
            if (
                sub.question_type == QuestionType.time
                and sub.suggestion_deadline_minutes is None
            ):
                _finalize_time_slots(conn, str(qrow["id"]), now)
                finalized_time_slots = True
        # Re-read the question rows once so the computed slots ride back on the
        # create response (mirrors the cutoff-availability endpoint's refresh).
        if finalized_time_slots:
            question_rows = _fetch_questions(conn, str(poll_row["id"]))
        # "Collect Suggestions before Vote" with the creator's own initial
        # picks: submit them as the creator's suggestion-phase vote so the poll
        # opens collecting suggestions but already seeded with those options
        # (identical to the creator submitting suggestions right after create).
        # Gated on an ACTIVE (future) prephase deadline: with no prephase, or
        # one capped into the past by a very short voting window, the question
        # has no live suggestion phase and `_submit_vote_to_question` would
        # raise 400 ("Suggestions cutoff has passed") — which would roll back
        # the whole create. Skipping keeps the create atomic AND resilient.
        # The returned vote ids ride back on the response so the creating
        # browser can recognize (and later edit) its own vote.
        initial_suggestion_vote_ids: dict[str, str] = {}
        prephase_deadline = poll_row.get("prephase_deadline")
        if prephase_deadline and prephase_deadline > now:
            for sub, qrow in zip(req.questions, question_rows):
                if sub.question_type == QuestionType.ranked_choice and sub.initial_suggestions:
                    vote_row = _submit_vote_to_question(
                        conn,
                        str(qrow["id"]),
                        SubmitVoteRequest(
                            vote_type="ranked_choice",
                            suggestions=sub.initial_suggestions,
                            is_ranking_abstain=True,
                            voter_name=req.creator_name,
                            options_metadata=sub.options_metadata,
                        ),
                        now,
                        browser_id=creator_browser_id,
                    )
                    initial_suggestion_vote_ids[str(qrow["id"])] = str(vote_row["id"])
        # A brand-new poll normally has no votes (so `_row_to_poll`'s empty
        # roster defaults apply). The seeded-suggestion path DOES create the
        # creator's vote, so compute the real roster here — otherwise the
        # create response reports "Viewed (0) / No voters yet" until the first
        # refresh.
        # Empty for a plain create; the seeded-suggestion path creates the
        # creator's vote, so compute the real roster then.
        voter_data = PollVoterData()
        if initial_suggestion_vote_ids:
            voter_data = _compute_poll_voter_data(conn, str(poll_row["id"]))
        # Notification strings for the "New poll in <Group>" push, computed
        # while the conn is open. The group phrase's participant-names fallback
        # only queries when the group has no title override; the body is the
        # poll's own title prefixed with its category icon.
        if poll_row.get("group_id"):
            new_poll_group_phrase = group_name_phrase(
                conn, str(poll_row["group_id"]), override=poll_row.get("group_title")
            )
            new_poll_body = _poll_body(poll_row, question_rows)
        else:
            new_poll_group_phrase = None
            new_poll_body = None

    group_id = str(poll_row["group_id"]) if poll_row.get("group_id") else None

    # Phase C.2: creator auto-joins the group. Runs after the create
    # commits — root polls' group_id only exists post-`_insert_poll`.
    join_group(group_id, creator_browser_id)

    # Record which categories this browser created a poll for, so the
    # group page's category bubble bar can order by recency (in-group +
    # general). `_category_for_title` normalizes a time question's stored
    # category ("custom") back to "time" so the recorded value matches
    # the bubble the user tapped. Decoupled own-transaction write.
    record_poll_categories(
        creator_browser_id,
        group_id,
        [_category_for_title(qr) for qr in question_rows],
    )

    # Fan-out "new poll" push notifications to other group members whose
    # preference is on (default ON, missing-row-is-on). Decoupled from
    # the create response: BackgroundTasks runs after the response is
    # serialized + sent so a slow push service can't block the user.
    if group_id:
        # Line 1 names the event + group ("New poll in <Group>"); line 2 (body)
        # is the icon-prefixed poll title (both computed in the block above).
        group_route_id = poll_row.get("group_short_id") or group_id
        notif_title = (
            f"New poll in {new_poll_group_phrase}"
            if new_poll_group_phrase
            else "New poll"
        )
        # Path form so the tap opens the poll detail page directly (no group
        # list flash + redirect). See _notification_base for the same rule.
        new_poll_short = poll_row.get("short_id")
        new_poll_url = (
            f"/g/{group_route_id}/p/{new_poll_short}"
            if new_poll_short
            else f"/g/{group_route_id}"
        )
        background_tasks.add_task(
            fan_out_new_poll,
            group_id,
            creator_browser_id,
            {
                "title": notif_title,
                "body": new_poll_body or question_title or "New poll",
                "url": new_poll_url,
                "group_id": group_route_id,
                "tag": f"new-poll-{poll_row.get('id')}",
            },
        )

    # Explore feed (migration 144): a yes/no poll posted to /explore is the
    # trunk of an evolution spine — spawn its 2 LLM-generated variants (one
    # 'up', one 'down') after the response. Decoupled (BackgroundTask): the LLM
    # call can take seconds and must never block the creator's create. No-op for
    # ordinary polls; the spawner re-checks eligibility against the committed row.
    if req.explore:
        background_tasks.add_task(spawn_variants, str(poll_row["id"]))

    # AI poll suggestions (migration 145): regenerate the creator's predicted
    # next polls for this group so they're cached + ready the next time they open
    # the new-poll box. Non-explore only (explore has the variant feed instead);
    # decoupled BackgroundTask because it makes a slow LLM call. No-op when the
    # LLM is unconfigured (is_configured() short-circuit inside).
    if group_id and not req.explore and creator_user_id:
        background_tasks.add_task(refresh_poll_suggestions, creator_user_id, group_id)

    # The caller is the creator, so viewer_is_creator is true. Voter data is
    # empty for a plain create, or the creator's seeded-suggestion roster when
    # that path ran (computed inside the transaction above). The seeded vote
    # ids ride back so the creating browser owns the vote.
    poll = _row_to_poll(
        poll_row,
        question_rows,
        voter_data,
        viewer_user_id=creator_user_id,
    )
    if initial_suggestion_vote_ids:
        poll.initial_suggestion_vote_ids = initial_suggestion_vote_ids
    return poll


@router.get("/by-id/{poll_id}", response_model=PollResponse)
def get_poll_by_id(poll_id: str, request: Request):
    require_uuid(poll_id, "poll_id")
    with get_db() as conn:
        row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        question_rows = _fetch_questions(conn, str(row["id"]))
        voter_data = _compute_poll_voter_data(conn, str(row["id"]))
        viewer_user_id = _caller_user_id(conn, request)
    return _row_to_poll(row, question_rows, voter_data, viewer_user_id=viewer_user_id)


@router.get("/{short_id}", response_model=PollResponse)
def get_poll(short_id: str, request: Request):
    with get_db() as conn:
        row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.short_id = %(short_id)s",
            {"short_id": short_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        question_rows = _fetch_questions(conn, str(row["id"]))
        voter_data = _compute_poll_voter_data(conn, str(row["id"]))
        viewer_user_id = _caller_user_id(conn, request)
    return _row_to_poll(row, question_rows, voter_data, viewer_user_id=viewer_user_id)


# ---------------------------------------------------------------------------
# iMessage bubble summary (Phase 2 of docs/imessage-extension-plan.md)
# ---------------------------------------------------------------------------

# Categories the per-question label NEVER surfaces, mirroring the FE's
# getQuestionLabel (lib/questionListUtils.ts): yes_no / limited_supply (the
# title IS the prompt/item — the "Yes/No is a CATEGORY, not display text"
# rule), custom (no built-in label), and time/showtime (labeled by question
# TYPE below, since the Time bubble stores category="custom"). Everything
# else resolves through the auto-title's _CATEGORY_LABELS so there's no
# fourth label map to keep in lockstep.
_SUMMARY_LABEL_EXCLUDED = {"yes_no", "yes/no", "custom", "limited_supply"}


def _summary_question_label(question_row: dict, multi: bool) -> str | None:
    """Mirrors getQuestionSectionTitle (lib/questionListUtils.ts): the
    "<Label> for <Context>" disambiguator shown above a question's result
    line in multi-question polls, either half optional. Single-question
    polls return None — the poll title IS the question."""
    if not multi:
        return None
    details = (question_row.get("details") or "").strip() or None
    qtype = question_row.get("question_type")
    if qtype == "time":
        type_label = "Time"
    elif qtype == "showtime":
        type_label = "Showtime"
    elif qtype in ("yes_no", "limited_supply"):
        type_label = None
    else:
        cat = (question_row.get("category") or "").strip().lower()
        type_label = (
            None if cat in _SUMMARY_LABEL_EXCLUDED else _CATEGORY_LABELS.get(cat)
        )
    if type_label and details:
        return f"{type_label} for {details}"
    return details or type_label


def _summarize_question(
    question_row: dict, votes: list[dict], poll_is_closed: bool, multi: bool
) -> PollSummaryQuestionResponse:
    """One question's compact result line. The wording matches what the
    Phase 1 extension rendered client-side ("Yes 2 · No 1", "1/3 claimed",
    "Winner:"/"Leading:", "No votes yet") so migrating the bubble onto this
    endpoint changed the transport, not the copy."""
    results = _compute_results(
        dict(question_row),
        votes,
        include_tentative_time_options=False,
    )
    qtype = question_row["question_type"]
    if qtype == "yes_no":
        text = (
            f"Yes {results.yes_count or 0} · No {results.no_count or 0}"
            if results.total_votes > 0
            else "No votes yet"
        )
    elif qtype == "limited_supply":
        secured = results.secured_count or 0
        text = (
            f"{secured}/{results.supply_count} claimed"
            if results.supply_count
            else f"{secured} claimed"
        )
    elif results.time_event_cancelled:
        text = "Event's off"
    elif results.winner:
        pretty = (
            _format_slot_label(results.winner)
            if qtype in ("time", "showtime")
            else results.winner
        )
        text = f"{'Winner' if poll_is_closed else 'Leading'}: {pretty}"
    elif results.total_votes > 0:
        n = results.total_votes
        text = f"{n} response{'' if n == 1 else 's'}"
    else:
        text = "No votes yet"
    # Surface the candidate list ONLY for ranked_choice with finalized options
    # — the iMessage expanded ballot ranks them (Phase 5). A ranked poll still
    # in its suggestion phase has options=None, which the bubble reads as
    # not-yet-rankable (read-only). Plain text, no metadata.
    opts = question_row.get("options")
    options = list(opts) if qtype == "ranked_choice" and opts else None
    # Time/showtime: surface the finalized slots (key + friendly label) for the
    # expanded want/neutral/can't ballot (Phase 5). A time poll still collecting
    # availability has options=None (read-only); a cancelled event surfaces none
    # (the bubble shows "Event's off"). Showtime slots are pre-finalized at
    # create. Both slot-key shapes format through _format_slot_label.
    slots = (
        [PollSummarySlot(key=k, label=_format_slot_label(k)) for k in opts]
        if qtype in ("time", "showtime") and opts and not results.time_event_cancelled
        else None
    )
    return PollSummaryQuestionResponse(
        id=str(question_row["id"]),
        label=_summary_question_label(question_row, multi),
        question_type=qtype,
        result_text=text,
        total_votes=results.total_votes,
        yes_count=results.yes_count,
        no_count=results.no_count,
        secured_count=results.secured_count,
        supply_count=results.supply_count,
        options=options,
        slots=slots,
    )


@router.get("/{short_id}/summary", response_model=PollSummaryResponse)
def get_poll_summary(short_id: str):
    """Identity-free compact summary for the iMessage live transcript bubble
    (Phase 2, docs/imessage-extension-plan.md). One tiny round-trip replaces
    the Phase 1 fan-out (visibility-blind poll read + N per-question results
    calls) — several live bubbles re-rendering in one conversation can't
    afford N+1 each.

    Deliberately PUBLIC, like /preview: a bubble in a Messages thread is a
    deliberate capability share (owner decision B), and a transcript instance
    may have no identity at all (recipient installed but never opened the
    app). Exposes only render-necessary aggregates — never voter identities
    or ballots. NO membership write either: passively scrolling past a bubble
    must not auto-join the viewer; joining stays on the explicit
    open-in-app / invite-redeem / vote paths.
    """
    with get_db() as conn:
        row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.short_id = %(short_id)s",
            {"short_id": short_id},
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Poll not found")
        poll_id = str(row["id"])
        question_rows = _fetch_questions(conn, poll_id)
        vd = _compute_poll_voter_data(conn, poll_id)
        # Name multiplicity counts people, not names — mirrors the FE's
        # namedVoterCount (components/VoterList.tsx).
        named = sum(max(1, vd.voter_name_counts.get(n, 1)) for n in vd.voter_names)
        group_name = (
            group_display_name(
                conn, str(row["group_id"]), override=row.get("group_title")
            )
            if row.get("group_id")
            else None
        )
        is_closed = bool(row.get("is_closed"))
        multi = len(question_rows) > 1
        # One batched votes fetch for the whole poll (vs per-question) — the
        # bubble render path is hotter than the per-poll-close path the
        # sibling _question_decision_label serves.
        votes_by_question: dict[str, list[dict]] = {}
        for v in conn.execute(
            """
            SELECT v.* FROM votes v
            JOIN questions q ON v.question_id = q.id
            WHERE q.poll_id = %(mid)s
            """,
            {"mid": poll_id},
        ).fetchall():
            votes_by_question.setdefault(str(v["question_id"]), []).append(dict(v))
        questions = [
            _summarize_question(
                dict(q), votes_by_question.get(str(q["id"]), []), is_closed, multi
            )
            for q in question_rows
        ]
        # The poll's OWN name, not the group-title override — same rule as the
        # detail-page header and the bubble's caption at insert time.
        title = _poll_own_title(row, question_rows)
    deadline = row.get("response_deadline")
    return PollSummaryResponse(
        poll_id=poll_id,
        short_id=row.get("short_id"),
        title=title,
        group_name=group_name,
        is_closed=is_closed,
        # Microseconds stripped: the Swift consumer parses with
        # ISO8601DateFormatter, which rejects 6-digit fractional seconds.
        response_deadline=(
            deadline.replace(microsecond=0).isoformat() if deadline else None
        ),
        respondent_count=named + vd.anonymous_count,
        questions=questions,
    )


# ---------------------------------------------------------------------------
# Poll-level operations (Phase 3)
#
# These mirror the per-question close/reopen/cutoff endpoints but operate on the
# poll wrapper + every question atomically.
#
# Authorization is purely identity-based (migration 123 retired the per-browser
# `creator_secret`). Every poll records a `creator_user_id`: a signed-in
# creator's account, or the lightweight account auto-minted for an anonymous
# creator at create time (bound to their browser_id via `user_browsers`). A
# mutation is authorized iff the caller's resolved user_id — bearer session,
# else the account linked to their browser_id — matches the poll's
# `creator_user_id`. Cross-device works for free: signing in links the browser
# to the real account, so every linked browser resolves to the same user_id.
# ---------------------------------------------------------------------------


def _authorize_poll(conn, poll_id: str, request: Request) -> dict:
    require_uuid(poll_id, "poll_id")
    row = conn.execute(
        "SELECT * FROM polls WHERE id = %(id)s",
        {"id": poll_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Poll not found")
    poll = dict(row)
    creator_user_id = poll.get("creator_user_id")
    caller_user_id = _caller_user_id(conn, request)
    if (
        creator_user_id is not None
        and caller_user_id is not None
        and str(creator_user_id) == str(caller_user_id)
    ):
        return poll
    raise HTTPException(status_code=403, detail="Not authorized")


@router.post("/{poll_id}/close", response_model=PollResponse)
def close_poll(
    poll_id: str,
    req: CloseQuestionRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Close a poll. Phase 5: only the wrapper carries is_closed/close_reason —
    closing the wrapper closes every question automatically.

    For each ranked_choice question mid-suggestion-phase, finalizes its options
    so results are computable immediately.

    Sets `close_notified` and fires the poll-closed push inline (best-effort,
    via BackgroundTasks) so an explicit close notifies instantly. The cron
    tick is the backstop for deadline-driven and auto (max_capacity) closes,
    which never reach this endpoint — it claims any `close_notified=false`
    closed poll, so the flag set here keeps the tick from double-sending.
    """
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, request)
        conn.execute(
            """
            UPDATE polls
            SET is_closed = true,
                close_reason = %(close_reason)s,
                close_notified = true,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
            """,
            {
                "poll_id": poll_id,
                "close_reason": req.close_reason.value,
                "now": now,
            },
        )

        # Finalize options for any ranked_choice question still mid-suggestion-phase.
        # The wrapper's prephase_deadline (formerly questions.suggestion_deadline) is
        # the source of truth for "is this question in a suggestion phase".
        if wrapper.get("prephase_deadline"):
            question_rows = conn.execute(
                "SELECT id FROM questions WHERE poll_id = %(poll_id)s AND question_type = 'ranked_choice'",
                {"poll_id": poll_id},
            ).fetchall()
            for sp in question_rows:
                _finalize_suggestion_options(conn, str(sp["id"]), now)

        # Auto-file the just-closed poll under Old for everyone if it's now
        # "done" (non-time/showtime, or a time/showtime poll whose decided slot
        # is already past / cancelled / has no winner). A closed time poll whose
        # winning slot is still upcoming is left for the cron tick to age once
        # the slot passes. Re-addable via the green + (migration 142).
        maybe_auto_age_poll(conn, poll_id, now)

        # Skip the push if this poll was already close-notified (a redundant
        # close on an already-closed poll mustn't re-notify).
        _schedule_close_notification(
            conn,
            poll_id,
            already_notified=bool(wrapper.get("close_notified")),
            background_tasks=background_tasks,
        )

        poll_row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_data = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_data, viewer_user_id=wrapper.get("creator_user_id"))


@router.post("/{poll_id}/reopen", response_model=PollResponse)
def reopen_poll(poll_id: str, req: ReopenQuestionRequest, request: Request):
    """Reopen a closed poll. Phase 5: only the wrapper's is_closed
    matters; questions inherit it via JOIN."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, request)
        conn.execute(
            """
            UPDATE polls
            SET is_closed = false,
                close_reason = NULL,
                close_notified = false,
                auto_aged_at = NULL,
                updated_at = %(now)s
            WHERE id = %(poll_id)s
            """,
            {"poll_id": poll_id, "now": now},
        )
        poll_row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_data = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_data, viewer_user_id=wrapper.get("creator_user_id"))


@router.post("/{poll_id}/cutoff-suggestions", response_model=PollResponse)
def cutoff_poll_suggestions(
    poll_id: str,
    req: CutoffSuggestionsRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """End the suggestion phase across every question that's still in it.

    Unlike the per-question endpoint, this is a no-op-ok operation: questions not
    in a suggestion phase are simply skipped, and we don't 400 if nobody has
    submitted suggestions yet (the poll wrapper has multiple questions,
    most of which never had a suggestion phase). Returns 400 only if NO
    question's suggestion phase advanced.

    Sets `prephase_notified` and fires the 'voting is open' push inline. The
    cron tick is the backstop for deadline-driven transitions (where no
    endpoint runs); the flag keeps it from double-sending.
    """
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, request)

        # Phase 5: prephase_deadline is wrapper-level. Validate that there's an
        # open suggestion phase (deadline in the future), and that at least one
        # ranked_choice question has a suggestion submitted.
        deadline = wrapper.get("prephase_deadline")
        in_phase = deadline is not None and deadline > now
        rc_questions = conn.execute(
            """SELECT p.id
                 FROM questions p
                 JOIN votes v ON v.question_id = p.id
                WHERE p.poll_id = %(mid)s
                  AND p.question_type = 'ranked_choice'
                  AND v.suggestions IS NOT NULL
                  AND array_length(v.suggestions, 1) > 0
                GROUP BY p.id""",
            {"mid": poll_id},
        ).fetchall()
        if not in_phase or not rc_questions:
            raise HTTPException(
                status_code=400,
                detail="No question suggestion phase to cut off",
            )

        conn.execute(
            "UPDATE polls SET prephase_deadline = %(now)s, prephase_notified = true, "
            "updated_at = %(now)s WHERE id = %(mid)s",
            {"mid": poll_id, "now": now},
        )
        for row in rc_questions:
            _finalize_suggestion_options(conn, str(row["id"]), now)

        _schedule_transition_notification(
            conn,
            poll_id,
            already_notified=bool(wrapper.get("prephase_notified")),
            background_tasks=background_tasks,
        )

        poll_row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_data = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_data, viewer_user_id=wrapper.get("creator_user_id"))


# Bounds for the "plus one/more" name list — generous enough for any real
# "answering for the group" case, tight enough to stop an abusive request from
# inflating a poll's tallies arbitrarily.
_MAX_PLUS_ONES = 50
_MAX_PLUS_ONE_NAME_LEN = 50


def _sanitize_plus_one_names(names: list[str] | None) -> list[str] | None:
    """Normalize the poll-level plus-one list: trim each name (blanks kept as
    unnamed plus-ones), drop non-strings, and bound count + per-name length.
    Returns None when nothing was provided so the vote row's column stays NULL.
    """
    if not names:
        return None
    cleaned: list[str] = []
    for n in names[:_MAX_PLUS_ONES]:
        if not isinstance(n, str):
            continue
        cleaned.append(n.strip()[:_MAX_PLUS_ONE_NAME_LEN])
    return cleaned or None


def _seed_plus_one_votes(
    conn,
    poll_id: str,
    items: list[PollVoteItem],
    user_ids: list[str],
    *,
    submitter_user_id: str | None,
    now: datetime,
) -> list[tuple[str, str, dict]]:
    """Create a seeded, editable vote for each looked-up account the submitter
    is voting for. Each account gets one vote per question mirroring the
    submitter's choice, attributed to that account (via its earliest browser),
    voter_name = the account's display_name. Their vote counts immediately.

    Does NOT add them to the group — instead mints a single-use INVITE (Phase G,
    targeted at the poll) and returns a notification spec per account so the
    caller can push "<submitter> voted for you — open to see or change your
    response". Tapping the invite lets them join + reach the poll, where the
    detail page's discovery pass adopts the seeded vote for editing.

    Skips: the submitter themself, non-contacts (can't seed an arbitrary
    account), accounts with no linked browser, and accounts that already
    responded. Each account is seeded at most once (dedup). Returns
    `[(group_id, user_id, payload)]` for the caller to fan out as pushes."""
    if not submitter_user_id:
        return []
    poll_meta = conn.execute(
        """
        SELECT p.group_id, g.short_id AS group_short_id, g.title AS group_title
          FROM polls p LEFT JOIN groups g ON p.group_id = g.id
         WHERE p.id = %(id)s
        """,
        {"id": poll_id},
    ).fetchone()
    group_id = (
        str(poll_meta["group_id"]) if poll_meta and poll_meta.get("group_id") else None
    )
    route_for_url = (poll_meta.get("group_short_id") if poll_meta else None) or group_id
    group_phrase = (
        group_name_phrase(conn, group_id, override=poll_meta.get("group_title"))
        if group_id
        else None
    )
    submitter_row = conn.execute(
        "SELECT display_name FROM users WHERE id = %(u)s::uuid",
        {"u": submitter_user_id},
    ).fetchone()
    submitter_name = (
        (submitter_row.get("display_name") if submitter_row else None) or "Someone"
    )

    notifications: list[tuple[str, str, dict]] = []
    seen: set[str] = set()
    for raw_uid in user_ids[: _MAX_PLUS_ONES]:
        uid = (raw_uid or "").strip()
        if not _is_uuid_like(uid) or uid in seen or uid == str(submitter_user_id):
            continue
        seen.add(uid)
        if not is_contact(conn, str(submitter_user_id), uid):
            continue
        if user_responded_to_poll(conn, poll_id, uid):
            continue
        their_browser = earliest_browser_for_user(conn, uid)
        if not their_browser:
            continue
        name_row = conn.execute(
            "SELECT display_name FROM users WHERE id = %(u)s::uuid", {"u": uid}
        ).fetchone()
        if not name_row:
            continue
        seeded_name = name_row.get("display_name")
        for item in items:
            # Always an INSERT for the represented account (their first vote),
            # mirroring the submitter's per-question choice. No plus-ones of
            # their own.
            _submit_vote_to_question(
                conn,
                item.question_id,
                _vote_item_to_submit_req(item, seeded_name, None),
                now,
                browser_id=their_browser,
            )
        # Invite (NOT auto-membership) + queue a notification so they can join,
        # reach the poll, and change the response we seeded for them.
        if group_id:
            try:
                invite = issue_invite(
                    conn,
                    group_id=group_id,
                    created_by_user_id=str(submitter_user_id),
                    mode="single",
                    target_poll_id=poll_id,
                )
                title = f"{submitter_name} voted for you"
                if group_phrase:
                    title += f" in {group_phrase}"
                notifications.append(
                    (
                        group_id,
                        uid,
                        {
                            "title": title,
                            "body": "Open to see or change your response.",
                            "url": f"/invite/{invite.token}",
                            "group_id": route_for_url,
                            "group_uuid": group_id,
                            "tag": f"plus-one-{poll_id}-{uid}",
                        },
                    )
                )
            except Exception:  # noqa: BLE001
                logger.exception("plus-one invite/notify failed for %s", uid)
    return notifications


def _common_vote_fields(
    item: PollVoteItem, voter_name: str | None, plus_one_names: list[str] | None
) -> dict:
    """The fields SubmitVoteRequest and EditVoteRequest share — mapped once so a
    new vote field only needs adding here, not in both converters below."""
    return {
        "yes_no_choice": item.yes_no_choice,
        "ranked_choices": item.ranked_choices,
        "ranked_choice_tiers": item.ranked_choice_tiers,
        "suggestions": item.suggestions,
        "is_abstain": item.is_abstain,
        "is_ranking_abstain": item.is_ranking_abstain,
        "voter_name": voter_name,
        "voter_day_time_windows": item.voter_day_time_windows,
        "voter_duration": item.voter_duration,
        "voter_min_participants": item.voter_min_participants,
        "options_metadata": item.options_metadata,
        "liked_slots": item.liked_slots,
        "disliked_slots": item.disliked_slots,
        "plus_one_names": plus_one_names,
    }


def _vote_item_to_submit_req(
    item: PollVoteItem, voter_name: str | None, plus_one_names: list[str] | None
) -> SubmitVoteRequest:
    if not item.vote_type:
        raise HTTPException(status_code=400, detail="vote_type is required when inserting a new vote")
    return SubmitVoteRequest(
        vote_type=item.vote_type,
        **_common_vote_fields(item, voter_name, plus_one_names),
    )


def _vote_item_to_edit_req(
    item: PollVoteItem, voter_name: str | None, plus_one_names: list[str] | None
) -> EditVoteRequest:
    return EditVoteRequest(**_common_vote_fields(item, voter_name, plus_one_names))


@router.post(
    "/{poll_id}/votes",
    response_model=list[VoteResponse],
    status_code=201,
)
def submit_poll_votes(
    poll_id: str,
    req: SubmitPollVotesRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Atomic batch vote across multiple questions of one poll.

    Each `items[i]` either inserts a new vote (vote_id null) or updates an
    existing one (vote_id set) on `items[i].question_id`. Per the addressability
    paradigm, this is the poll-level entry point — clients should prefer
    it over per-question calls when the user submits votes across siblings in
    one action. Validation, finalization, and auto-close run per-question
    inside the same transaction; any failure rolls back every item.

    voter_name is poll-level: one voter, many question ballots.
    """
    require_uuid(poll_id, "poll_id")
    req.voter_name = validate_user_name(req.voter_name, field="Voter name")
    now = datetime.now(timezone.utc)
    browser_id = _browser_id(request)

    # Phase C.2: group join runs BEFORE the vote in its own transaction so
    # "attempted to participate" is the membership trigger — a vote that
    # fails validation still leaves the user as a group member.
    join_group_for_poll(poll_id, browser_id)

    question_ids = [item.question_id for item in req.items]
    if len(set(question_ids)) != len(question_ids):
        raise HTTPException(
            status_code=400,
            detail="Each question_id may appear at most once per request",
        )

    with get_db() as conn:
        poll_row = conn.execute(
            "SELECT p.id, p.is_closed, p.allow_plus_ones, p.variant_spawned, "
            "t.privacy AS group_privacy "
            "FROM polls p LEFT JOIN groups t ON p.group_id = t.id "
            "WHERE p.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        if not poll_row:
            raise HTTPException(status_code=404, detail="Poll not found")
        if poll_row.get("is_closed"):
            raise HTTPException(status_code=400, detail="Poll is closed")

        # "Plus one/more" — one ballot can represent additional people. Clamp to
        # None when the poll doesn't allow it (the FE shouldn't send any, but a
        # crafted request must not inflate a poll that opted out), and sanitize
        # otherwise (trim names, keep blanks as unnamed plus-ones, bound count +
        # length). Poll-level: written onto every item's vote row below.
        plus_one_names = (
            _sanitize_plus_one_names(req.plus_one_names)
            if poll_row.get("allow_plus_ones")
            else None
        )

        owned = conn.execute(
            """
            SELECT id FROM questions
            WHERE poll_id = %(mid)s
              AND id::text = ANY(%(ids)s)
            """,
            {"mid": poll_id, "ids": question_ids},
        ).fetchall()
        owned_ids = {str(r["id"]) for r in owned}
        for question_id in question_ids:
            if question_id not in owned_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sub-question {question_id} does not belong to this poll",
                )

        # Account-aware browser set of the editing caller — passed to the edit
        # path so possession of a vote_id alone can't let one voter overwrite
        # another's ballot (ballot-privacy backstop). Computed once per request.
        caller_bids = caller_browser_ids(
            conn, browser_id=browser_id, user_id=_user_id(request)
        )

        result_rows: list[dict] = []
        for item in req.items:
            if item.vote_id:
                row = _edit_vote_on_question(
                    conn,
                    item.question_id,
                    item.vote_id,
                    _vote_item_to_edit_req(item, req.voter_name, plus_one_names),
                    now,
                    caller_browser_ids=caller_bids,
                )
            else:
                row = _submit_vote_to_question(
                    conn,
                    item.question_id,
                    _vote_item_to_submit_req(item, req.voter_name, plus_one_names),
                    now,
                    browser_id=browser_id,
                )
            result_rows.append(row)

        # "Plus one/more" — looked-up accounts each get their OWN editable vote,
        # seeded with the submitter's ballot, so they can change it later. Gated
        # on allow_plus_ones; only the submitter's contacts can be seeded; an
        # account that already responded is skipped (never overwrite their own
        # vote). Runs in the same transaction as the submitter's votes.
        plus_one_notifications: list[tuple[str, str, dict]] = []
        if poll_row.get("allow_plus_ones") and req.plus_one_user_ids:
            plus_one_notifications = _seed_plus_one_votes(
                conn,
                poll_id,
                req.items,
                req.plus_one_user_ids,
                submitter_user_id=_caller_user_id(conn, request),
                now=now,
            )

        # Voting IS viewing — record the watermark so the phase-transition
        # skip-logic treats this voter as having seen the options they just
        # acted on. The FE also pings /viewed on poll open; this covers the
        # vote-without-a-separate-view path.
        _record_poll_view(conn, browser_id, poll_id, now)

    # Notify each represented account (decoupled, after the response) that
    # someone voted for them + invited them to change it.
    for notif_group_id, notif_user_id, payload in plus_one_notifications:
        background_tasks.add_task(
            fan_out_to_user, notif_group_id, notif_user_id, payload
        )

    # Explore feed (migration 144): a not-yet-spawned poll in an explore group
    # may now have crossed the vote threshold and should spawn its next variant.
    # The spawner re-checks all eligibility (variant vs trunk, threshold, depth)
    # and is a no-op otherwise; gate the scheduling on the cheap flags so a
    # normal-group vote never queues the task.
    if (
        poll_row.get("group_privacy") == EXPLORE_PRIVACY
        and not poll_row.get("variant_spawned")
    ):
        background_tasks.add_task(spawn_variants, poll_id)

    return [_row_to_vote(r) for r in result_rows]


@router.get(
    "/{poll_id}/plus-one-candidates",
    response_model=list[PlusOneCandidateResponse],
)
def list_poll_plus_one_candidates(poll_id: str, request: Request):
    """Accounts the caller can vote FOR as plus-ones on this poll: their
    contacts (address book), each flagged `responded` when they've already cast
    a vote here. The FE uses this for the name lookup dropdown — responded
    accounts are greyed out + unselectable.

    Empty when the poll doesn't allow plus-ones, the caller has no resolvable
    account (no contacts), or the poll doesn't exist."""
    require_uuid(poll_id, "poll_id")
    with get_db() as conn:
        poll_row = conn.execute(
            "SELECT id, allow_plus_ones FROM polls WHERE id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        if not poll_row or not poll_row.get("allow_plus_ones"):
            return []
        me = _caller_user_id(conn, request)
        if not me:
            return []
        reconcile_contacts(conn, me)
        candidates = list_plus_one_candidates(conn, me, poll_id)
    return [
        PlusOneCandidateResponse(
            user_id=c.user_id, name=c.name, responded=c.responded
        )
        for c in candidates
    ]


@router.post("/{poll_id}/cutoff-availability", response_model=PollResponse)
def cutoff_poll_availability(
    poll_id: str,
    req: CutoffSuggestionsRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """End the availability phase of the poll's time question (≤1 enforced
    on create). Phase 5: prephase_deadline is wrapper-level.

    Sets `prephase_notified` and fires the 'voting is open' push inline (same
    contract as cutoff-suggestions)."""
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        wrapper = _authorize_poll(conn, poll_id, request)
        deadline = wrapper.get("prephase_deadline")
        in_phase = deadline is not None and deadline > now
        time_questions = conn.execute(
            """SELECT p.id
                 FROM questions p
                 JOIN votes v ON v.question_id = p.id
                WHERE p.poll_id = %(mid)s
                  AND p.question_type = 'time'
                  AND v.voter_day_time_windows IS NOT NULL
                GROUP BY p.id""",
            {"mid": poll_id},
        ).fetchall()
        if not in_phase or not time_questions:
            raise HTTPException(
                status_code=400,
                detail="No availability phase to cut off",
            )

        conn.execute(
            "UPDATE polls SET prephase_deadline = %(now)s, prephase_notified = true, "
            "updated_at = %(now)s WHERE id = %(mid)s",
            {"mid": poll_id, "now": now},
        )
        for row in time_questions:
            _finalize_time_slots(conn, str(row["id"]), now)

        # If the whole poll is now a cancelled time event ("event's off"),
        # auto-close it + fire the close push instead of "voting is open".
        if _maybe_close_cancelled_event_poll(conn, poll_id, now, notified=True):
            # "Event's off" → file under Old for everyone (no future outcome).
            maybe_auto_age_poll(conn, poll_id, now)
            _schedule_close_notification(
                conn,
                poll_id,
                already_notified=False,
                background_tasks=background_tasks,
            )
        else:
            _schedule_transition_notification(
                conn,
                poll_id,
                already_notified=bool(wrapper.get("prephase_notified")),
                background_tasks=background_tasks,
            )

        poll_row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": poll_id},
        ).fetchone()
        question_rows = _fetch_questions(conn, poll_id)
        voter_data = _compute_poll_voter_data(conn, poll_id)

    return _row_to_poll(poll_row, question_rows, voter_data, viewer_user_id=wrapper.get("creator_user_id"))


@router.post("/{poll_id}/recurrence/cancel", response_model=PollResponse)
def cancel_recurrence(poll_id: str, req: CancelRecurrenceRequest, request: Request):
    """Cancel part of a recurring series (creator only).

    `scope='occurrence'` adds `date` to the anchor's skip list (just that
    instance is dropped). `scope='series'` sets the anchor's `recurrence_until`
    to `date` (that instance AND every later one are dropped). `poll_id` may be
    the anchor itself OR a materialized child instance — both resolve to the
    anchor that carries the schedule. Returns the updated ANCHOR poll so the FE
    can refresh the Scheduled list from one response.
    """
    require_uuid(poll_id, "poll_id")
    if req.scope not in ("occurrence", "series"):
        raise HTTPException(status_code=400, detail="scope must be 'occurrence' or 'series'")
    target_date = (req.date or "")[:10]
    if len(target_date) != 10:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    with get_db() as conn:
        # Authorize against the given poll (child instances share the anchor's
        # creator_user_id, so a creator can cancel from either surface).
        poll = _authorize_poll(conn, poll_id, request)
        anchor_id = poll.get("recurrence_anchor_id") or poll["id"]
        anchor = conn.execute(
            "SELECT * FROM polls WHERE id = %(id)s",
            {"id": str(anchor_id)},
        ).fetchone()
        if not anchor or not anchor.get("recurrence"):
            raise HTTPException(status_code=404, detail="Poll is not part of a recurring series")

        if req.scope == "occurrence":
            existing = _recurrence_skip_list(anchor.get("recurrence_skip_dates"))
            if target_date not in existing:
                existing.append(target_date)
            conn.execute(
                "UPDATE polls SET recurrence_skip_dates = %(skip)s::jsonb, updated_at = %(now)s "
                "WHERE id = %(id)s",
                {
                    "skip": _json_or_none(sorted(existing)),
                    "now": datetime.now(timezone.utc),
                    "id": str(anchor_id),
                },
            )
        else:  # series
            conn.execute(
                "UPDATE polls SET recurrence_until = %(until)s, updated_at = %(now)s "
                "WHERE id = %(id)s",
                {
                    "until": target_date,
                    "now": datetime.now(timezone.utc),
                    "id": str(anchor_id),
                },
            )

        row = conn.execute(
            f"{_SELECT_POLLS_WITH_GROUP} WHERE polls.id = %(id)s",
            {"id": str(anchor_id)},
        ).fetchone()
        question_rows = _fetch_questions(conn, str(anchor_id))
        viewer_user_id = _caller_user_id(conn, request)
    return _row_to_poll(row, question_rows, viewer_user_id=viewer_user_id)


@router.post("/{poll_id}/viewed", status_code=204)
def record_poll_viewed(poll_id: str, request: Request):
    """Record that the calling browser viewed this poll right now. The FE
    pings this when opening a poll whose prephase is still active; the
    watermark lets the phase-transition notification skip members who've
    already seen the latest options. Idempotent + best-effort — unknown
    poll ids no-op (see `_record_poll_view`)."""
    require_uuid(poll_id, "poll_id")
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        _record_poll_view(conn, _browser_id(request), poll_id, now)


@router.post("/{poll_id}/follow-state", status_code=204)
def set_poll_follow_state(
    poll_id: str, req: SetFollowStateRequest, request: Request
):
    """Set the calling browser's follow/ignore state for a poll (Gap 1).
    `state='old'` (the ✕) FILES the poll in the viewer's Old tab + silences
    its badge/push notifications; `state='new'` (the +) re-follows it.

    Per-viewer + reversible; NOT a creator action and orthogonal to group
    membership (✕ ≠ leaving the group). Requires a browser identity (400 when
    absent) and a valid poll_id (404). 400 on an unknown state value."""
    require_uuid(poll_id, "poll_id")
    from services.follow_state import VALID_STATES, set_follow_state

    if req.state not in VALID_STATES:
        raise HTTPException(status_code=400, detail="Invalid follow state")
    browser_id = _browser_id(request)
    if not browser_id or browser_id == NIL_UUID:
        raise HTTPException(status_code=400, detail="Browser identity required")
    with get_db() as conn:
        # Guard against an unknown poll_id 500ing on the FK violation.
        exists = conn.execute(
            "SELECT 1 FROM polls WHERE id = %(id)s::uuid", {"id": poll_id}
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Poll not found")
        set_follow_state(conn, poll_id, browser_id, req.state)


# ---------------------------------------------------------------------------
# Poll comments (migration 146)
# ---------------------------------------------------------------------------


def _require_comment_access(conn, poll_id: str, request: Request) -> dict:
    """Resolve the poll and gate NON-PUBLIC groups (private + explore) to
    members — a comment thread is user content, so it follows the group read
    contract (404 to strangers, indistinguishable from not-found) rather than
    the visibility-blind poll GETs. Membership is account-aware: the check is
    fed the resolved actor user_id (bearer OR browser-linked account), per the
    load_user_visibility rule."""
    poll = conn.execute(
        "SELECT id, group_id FROM polls WHERE id = %(id)s",
        {"id": poll_id},
    ).fetchone()
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    group_id = str(poll["group_id"]) if poll.get("group_id") else None
    meta = get_group_metadata(conn, group_id) if group_id else None
    if meta and meta["privacy"] != "public":
        if not is_caller_member_of_group(
            conn,
            group_id,
            browser_id=_browser_id(request),
            user_id=_caller_user_id(conn, request),
        ):
            raise HTTPException(status_code=404, detail="Poll not found")
    return poll


def _row_to_comment(row: dict, *, is_mine: bool) -> PollCommentResponse:
    return PollCommentResponse(
        id=str(row["id"]),
        poll_id=str(row["poll_id"]),
        commenter_name=row["commenter_name"],
        user_id=str(row["user_id"]) if row.get("user_id") else None,
        body=row["body"],
        created_at=row["created_at"],
        is_mine=is_mine,
    )


@router.get("/{poll_id}/comments", response_model=list[PollCommentResponse])
def get_poll_comments(poll_id: str, request: Request):
    """The poll's comments, oldest first. Members-only for non-public groups
    (404 to strangers); each row carries the per-viewer `is_mine` flag
    (account-aware, mirrors viewer_is_creator)."""
    require_uuid(poll_id, "poll_id")
    with get_db() as conn:
        _require_comment_access(conn, poll_id, request)
        rows = list_comments(conn, poll_id)
        bids = caller_browser_ids(
            conn, browser_id=_browser_id(request), user_id=_user_id(request)
        )
        actor = _caller_user_id(conn, request)
    return [
        _row_to_comment(
            r, is_mine=comment_is_mine(r, caller_bids=bids, actor_user_id=actor)
        )
        for r in rows
    ]


@router.post(
    "/{poll_id}/comments", response_model=PollCommentResponse, status_code=201
)
def create_poll_comment(
    poll_id: str, req: CreatePollCommentRequest, request: Request
):
    """Post a comment. Name-gated like voting (`validate_user_name` backstop —
    the FE's AccountGateModal is the primary UX); body is trimmed + silently
    capped (COMMENT_MAX_CHARS), 400 when empty after trim. Commenting is
    participating, so the poster auto-joins the group AFTER the access check
    (the check must run first — joining a non-member onto a private group
    would be a visibility grant)."""
    require_uuid(poll_id, "poll_id")
    name = validate_user_name(req.commenter_name, field="Name")
    body = sanitize_comment_body(req.body)
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")
    browser_id = _browser_id(request)
    with get_db() as conn:
        _require_comment_access(conn, poll_id, request)
        actor = _caller_user_id(conn, request)
        row = create_comment(
            conn,
            poll_id,
            browser_id=browser_id,
            user_id=actor,
            name=name,
            body=body,
        )
    # Decoupled own-transaction membership write (services/memberships.py
    # convention) — a public-group commenter becomes a member like a voter
    # does; idempotent for existing members.
    join_group_for_poll(poll_id, browser_id)
    return _row_to_comment(row, is_mine=True)


@router.delete("/{poll_id}/comments/{comment_id}", status_code=204)
def delete_poll_comment(poll_id: str, comment_id: str, request: Request):
    """Delete the caller's OWN comment (account-aware ownership — posted on
    any of their linked browsers). 404 when the comment doesn't exist, belongs
    to another poll, or isn't theirs (indistinguishable on purpose)."""
    require_uuid(poll_id, "poll_id")
    require_uuid(comment_id, "comment_id")
    with get_db() as conn:
        _require_comment_access(conn, poll_id, request)
        bids = caller_browser_ids(
            conn, browser_id=_browser_id(request), user_id=_user_id(request)
        )
        actor = _caller_user_id(conn, request)
        if not delete_comment(
            conn, poll_id, comment_id, caller_bids=bids, actor_user_id=actor
        ):
            raise HTTPException(status_code=404, detail="Comment not found")


