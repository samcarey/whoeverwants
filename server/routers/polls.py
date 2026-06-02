"""Poll API endpoints. See docs/poll-phasing.md."""

from __future__ import annotations

from dataclasses import dataclass, field

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from algorithms.poll_title import generate_poll_title
from database import get_db
from middleware import (
    browser_id_from_request as _browser_id,
    user_id_from_request as _user_id,
)
from services.auth import create_anonymous_user, resolve_actor_user_id
from models import (
    CloseQuestionRequest,
    CreatePollRequest,
    CreateQuestionRequest,
    CutoffSuggestionsRequest,
    EditVoteRequest,
    PollResponse,
    PollVoteItem,
    PlusOneCandidateResponse,
    QuestionType,
    ReopenQuestionRequest,
    SubmitPollVotesRequest,
    SubmitVoteRequest,
    VoteResponse,
)
from services.contacts import (
    add_member_for_user,
    earliest_browser_for_user,
    is_contact,
    list_plus_one_candidates,
    reconcile_contacts,
    user_responded_to_poll,
)
from services.groups import _is_uuid_like, group_name_phrase, require_uuid
from services.memberships import join_group, join_group_for_poll
from services.poll_categories import record_poll_categories
from services.push import (
    fan_out_new_poll,
    fan_out_phase_transition,
    fan_out_poll_closed,
)
from services.validation import validate_category_icon, validate_user_name
from services.questions import (
    _edit_vote_on_question,
    _finalize_suggestion_options,
    _finalize_time_slots,
    _json_or_none,
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


def _validate_request(req: CreatePollRequest) -> None:
    if not req.questions:
        raise HTTPException(status_code=400, detail="At least one question is required")

    time_count = sum(1 for sp in req.questions if sp.question_type == QuestionType.time)
    if time_count > 1:
        raise HTTPException(
            status_code=400,
            detail="A poll can contain at most one time question",
        )

    seen: dict[tuple[str, str | None], list[str | None]] = {}
    for sp in req.questions:
        validate_category_icon(sp.category_icon)
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
) -> str:
    """Resolve `req.group_id` to an existing group, or mint a fresh one.

    Migration 105 retired `polls.follow_up_to` so the new-poll path no
    longer walks parent → child relationships. A group is just a uuid
    that polls share via `polls.group_id`. When `requested_group_id`
    points at a real group, return it; otherwise create a new group
    (optionally with `title` set on creation so first-poll-with-name
    flows are a single transaction).

    Phase E: minting a fresh group sets `privacy` from the caller's
    auth state — signed-in (`creator_user_id` set) → 'private' + records
    the creator; anonymous → 'public' (forced) + creator_user_id NULL.
    Resolving to an existing group doesn't touch privacy or
    creator_user_id; those are set-at-create-time fields.

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
    privacy = "private" if creator_user_id else "public"
    row = conn.execute(
        "INSERT INTO groups (title, privacy, creator_user_id) "
        "VALUES (%(title)s, %(privacy)s, %(creator_user_id)s) RETURNING id",
        {
            "title": initial_title,
            "privacy": privacy,
            "creator_user_id": creator_user_id,
        },
    ).fetchone()
    return str(row["id"])


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
        creator_user_id=group_creator_user_id,
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
            if prephase_deadline >= response_dt:
                prephase_deadline = response_dt - timedelta(minutes=1)
    # "Plus one/more": default ON for polls with a time question (the common
    # scheduling case — "I'm answering for my partner too"), OFF otherwise.
    # An explicit `req.allow_plus_ones` (the FE toggle) overrides the default.
    allow_plus_ones = req.allow_plus_ones
    if allow_plus_ones is None:
        allow_plus_ones = any(
            sp.question_type == QuestionType.time for sp in req.questions
        )
    row = conn.execute(
        """
        INSERT INTO polls (
            creator_name, creator_user_id, response_deadline,
            prephase_deadline, prephase_deadline_minutes,
            context, details,
            min_responses, show_preliminary_results, allow_pre_ranking,
            allow_plus_ones,
            group_id,
            created_at, updated_at
        )
        VALUES (
            %(creator_name)s, %(creator_user_id)s, %(response_deadline)s,
            %(prephase_deadline)s, %(prephase_deadline_minutes)s,
            %(context)s, %(details)s,
            %(min_responses)s, %(show_preliminary_results)s, %(allow_pre_ranking)s,
            %(allow_plus_ones)s,
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
            "group_id": group_id,
            "now": now,
        },
    ).fetchone()
    return _attach_group_fields(conn, row)


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
}
_QUESTION_TYPE_SYMBOLS = {
    "yes_no": "👍",
    "ranked_choice": "🗳️",
    "time": "📅",
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


def _build_close_notification(conn, poll_id: str) -> tuple[str, dict] | None:
    """(group_id, payload) for a poll-closed push, or None when unroutable.
    Shared by the inline close endpoint and the cron tick."""
    built = _notification_base(conn, poll_id)
    if not built:
        return None
    group_id, base, _row, group_phrase, _question_rows = built
    return group_id, {
        **base,
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
) -> None:
    """Create a seeded, editable vote for each looked-up account the submitter
    is voting for. Each account gets one vote per question mirroring the
    submitter's choice, attributed to that account (via its earliest browser),
    voter_name = the account's display_name. Also grants the account membership
    so it can see + later change the response.

    Skips: the submitter themself, non-contacts (can't seed an arbitrary
    account), accounts with no linked browser, and accounts that already
    responded to the poll. Each account is seeded at most once (dedup)."""
    if not submitter_user_id:
        return
    group_row = conn.execute(
        "SELECT group_id FROM polls WHERE id = %(id)s", {"id": poll_id}
    ).fetchone()
    group_id = str(group_row["group_id"]) if group_row and group_row.get("group_id") else None

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
        # Membership so the account can see + edit the poll it was voted into.
        if group_id:
            add_member_for_user(conn, group_id, uid)
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


def _vote_item_to_submit_req(
    item: PollVoteItem, voter_name: str | None, plus_one_names: list[str] | None
) -> SubmitVoteRequest:
    if not item.vote_type:
        raise HTTPException(status_code=400, detail="vote_type is required when inserting a new vote")
    return SubmitVoteRequest(
        vote_type=item.vote_type,
        yes_no_choice=item.yes_no_choice,
        ranked_choices=item.ranked_choices,
        ranked_choice_tiers=item.ranked_choice_tiers,
        suggestions=item.suggestions,
        is_abstain=item.is_abstain,
        is_ranking_abstain=item.is_ranking_abstain,
        voter_name=voter_name,
        voter_day_time_windows=item.voter_day_time_windows,
        voter_duration=item.voter_duration,
        options_metadata=item.options_metadata,
        liked_slots=item.liked_slots,
        disliked_slots=item.disliked_slots,
        plus_one_names=plus_one_names,
    )


def _vote_item_to_edit_req(
    item: PollVoteItem, voter_name: str | None, plus_one_names: list[str] | None
) -> EditVoteRequest:
    return EditVoteRequest(
        yes_no_choice=item.yes_no_choice,
        ranked_choices=item.ranked_choices,
        ranked_choice_tiers=item.ranked_choice_tiers,
        suggestions=item.suggestions,
        is_abstain=item.is_abstain,
        is_ranking_abstain=item.is_ranking_abstain,
        voter_name=voter_name,
        voter_day_time_windows=item.voter_day_time_windows,
        voter_duration=item.voter_duration,
        options_metadata=item.options_metadata,
        liked_slots=item.liked_slots,
        disliked_slots=item.disliked_slots,
        plus_one_names=plus_one_names,
    )


@router.post(
    "/{poll_id}/votes",
    response_model=list[VoteResponse],
    status_code=201,
)
def submit_poll_votes(poll_id: str, req: SubmitPollVotesRequest, request: Request):
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
            "SELECT id, is_closed, allow_plus_ones FROM polls WHERE id = %(id)s",
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

        result_rows: list[dict] = []
        for item in req.items:
            if item.vote_id:
                row = _edit_vote_on_question(
                    conn,
                    item.question_id,
                    item.vote_id,
                    _vote_item_to_edit_req(item, req.voter_name, plus_one_names),
                    now,
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
        if poll_row.get("allow_plus_ones") and req.plus_one_user_ids:
            _seed_plus_one_votes(
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


