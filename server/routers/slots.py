"""Playlist slots: CRUD a slot, fetch ranked activity suggestions, and serve
the "who with" picker its candidates.

Identity mirrors poll authorship: the caller's account is resolved via
`resolve_actor_user_id` (bearer session, else the browser-linked account),
and an anonymous creator with no account yet gets a lightweight browser-tied
one minted at save time — so a slot always has an owner and the "you've
picked before" suggestion group works across that browser's future slots.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import caller_browser_ids, create_anonymous_user, resolve_actor_user_id
from services.comments import (
    comment_is_mine,
    reactions_for_comments,
    sanitize_comment_body,
    toggle_reaction,
)
from services.contacts import reconcile_contacts
from services.groups import require_uuid
from services.slot_event_comments import (
    create_event_comment,
    delete_event_comment,
    event_key,
    get_event_comment,
    is_event_candidate,
    list_event_comments,
    update_event_comment,
)
from services.validation import validate_category_icon, validate_user_name
import logging

from services.slot_events import (
    EventFullError,
    NoSuchEventError,
    list_events,
    set_confirmation,
    set_event_preferences,
    start_due_event_polls,
)
from services.slots import (
    create_slot,
    delete_slot,
    list_slots,
    purge_past_slots,
    suggest_activities,
    update_slot,
    who_with_candidates,
)

router = APIRouter(prefix="/api/slots", tags=["slots"])
log = logging.getLogger("slots")


def _start_event_polls_after_save(user_id: str, day_time_windows) -> None:
    """Best-effort pass after a slot save: start any (day, activity) polls the
    save made possible (an attached draft + a now-viable gathering). Runs in
    its OWN transaction after the save commits — a failed poll insert would
    poison the save's transaction otherwise — and swallows errors (the next
    save of any participant retries)."""
    days = [d.get("day") for d in day_time_windows or [] if isinstance(d, dict)]
    if not any(days):
        return
    try:
        with get_db() as conn:
            created = start_due_event_polls(conn, user_id=user_id, days=days)
        if created:
            log.info("started event polls %s", created)
    except Exception:  # noqa: BLE001 — never fail the slot save over this
        log.exception("start_due_event_polls failed")


class WhoWithRef(BaseModel):
    # One who-with reference: the real identity (a groups.id / users.id) plus
    # the display name captured at pick time. `id` is null for a name-only pick
    # — either a legacy/raw-API bare string, or an id that didn't resolve to
    # something the owner can reach (see services.slots._resolve_who_with).
    id: str | None = None
    name: str

    @field_validator("id", mode="before")
    @classmethod
    def _blank_id_is_none(cls, v):
        return v or None


class WhoWithEntry(BaseModel):
    # One "who with" entry: an optional participant range with its own set of
    # groups and/or specific people, plus the exclude_* lists — groups/people
    # the owner would NOT do the activity with. Each list holds WhoWithRefs,
    # sanitized + capped + identity-resolved in services.slots.
    min_people: int | None = None
    max_people: int | None = None
    groups: list[WhoWithRef] | None = None
    people: list[WhoWithRef] | None = None
    exclude_groups: list[WhoWithRef] | None = None
    exclude_people: list[WhoWithRef] | None = None

    @field_validator("groups", "people", "exclude_groups", "exclude_people", mode="before")
    @classmethod
    def _coerce_refs(cls, v):
        # Tolerate bare-string refs (older clients / raw-API callers) by
        # coercing them to name-only refs — the same tolerance
        # `_coerce_activities` gives bare-string activities.
        if isinstance(v, list):
            return [{"name": x} if isinstance(x, str) else x for x in v]
        return v


class TimePrefs(BaseModel):
    # Preferred / avoided start times within the slot's window, as HH:MM marks
    # (day-agnostic — a slot is a single day). Sanitized (real HH:MM, deduped,
    # disliked-wins on overlap, capped) in services.slots. The events engine
    # picks a party's "@ time" by fewest dislikes -> most likes -> earliest.
    liked: list[str] = []
    disliked: list[str] = []


class ActivityInput(BaseModel):
    name: str
    # Optional per-activity emoji (picked in the create-slot sheet). Decoupled
    # from the name — never affects suggestion matching / blacklist.
    emoji: str | None = None
    # Optional per-activity participant range ("2–5 people"), both independent.
    # Sanitized (clamped to [1, MAX_PEOPLE]) in services.slots; decoupled from
    # the name like the emoji.
    min_people: int | None = None
    max_people: int | None = None
    # Optional per-activity "who with" entries — MULTIPLE participant ranges,
    # each with its own groups/people. None/[] = the activity-level range with
    # "Anyone".
    who_with: list[WhoWithEntry] | None = None
    # Optional per-activity start-time preferences (see TimePrefs).
    time_prefs: TimePrefs | None = None
    # Optional duration bounds in hours (0.5 steps). The engine only proposes
    # events whose members' bounds are mutually satisfiable AND whose start
    # leaves room for the binding minimum inside the shared window. None =
    # unconstrained. Sanitized in services.slots (max bumped up to min).
    min_hours: float | None = None
    max_hours: float | None = None
    # Optional attached POLL draft ({"title", "question"} — see migration 156):
    # when the events engine finds a viable gathering for this (day, activity),
    # the server creates a real poll from it and surfaces it on the event.
    # Sanitized (whitelisted question fields, bounded strings; unusable drafts
    # silently dropped) in services.slots._clean_poll_draft.
    poll_draft: dict | None = None
    # Settings EVERY poll this activity starts inherits (migration 161):
    # {"deadline", "suggestions", "winner_method", "timezone"} — when voting
    # closes relative to the event, whether options are collected first, and
    # how a ranked choice picks its winner. Sanitized field-by-field (each
    # falls back to its default) in services.slots._clean_poll_options.
    poll_options: dict | None = None


class CreateSlotRequest(BaseModel):
    day_time_windows: list[dict] = []
    activities: list[ActivityInput] = []

    @field_validator("activities", mode="before")
    @classmethod
    def _coerce_activities(cls, v):
        # Tolerate bare-string activities (older clients / raw-API callers)
        # by coercing them to {name: str}.
        if isinstance(v, list):
            return [{"name": x} if isinstance(x, str) else x for x in v]
        return v


class CreateSlotResponse(BaseModel):
    id: str


class SlotActivity(BaseModel):
    name: str
    emoji: str | None = None
    min_people: int | None = None
    max_people: int | None = None
    who_with: list[WhoWithEntry] | None = None
    time_prefs: TimePrefs | None = None
    min_hours: float | None = None
    max_hours: float | None = None
    poll_draft: dict | None = None
    poll_options: dict | None = None


class SlotResponse(BaseModel):
    id: str
    day_time_windows: list[dict] = []
    activities: list[SlotActivity] = []
    created_at: str | None = None


class SlotListResponse(BaseModel):
    slots: list[SlotResponse] = []


class SuggestionsRequest(BaseModel):
    day_time_windows: list[dict] = []


class ActivitySuggestion(BaseModel):
    name: str
    emoji: str | None = None


class ActivitySuggestionsResponse(BaseModel):
    # Highest-priority group first; each list is {name, emoji}, deduped across
    # groups and blacklist-filtered.
    overlapping: list[ActivitySuggestion] = []
    yours: list[ActivitySuggestion] = []
    others: list[ActivitySuggestion] = []


@router.post("", response_model=CreateSlotResponse)
@router.post("/", response_model=CreateSlotResponse)
def create_slot_endpoint(req: CreateSlotRequest, request: Request):
    browser_id = _browser_id(request)
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=browser_id)
        if not user_id:
            # No account yet — mint a browser-tied one (nameless; slots carry
            # no name requirement) so the slot has a stable owner.
            user_id = create_anonymous_user(conn, browser_id=browser_id, display_name=None)
        slot_id = create_slot(
            conn,
            user_id=user_id,
            day_time_windows=req.day_time_windows,
            activities=[a.model_dump() for a in req.activities],
        )
    _start_event_polls_after_save(user_id, req.day_time_windows)
    return CreateSlotResponse(id=slot_id)


@router.get("", response_model=SlotListResponse)
@router.get("/", response_model=SlotListResponse)
def list_slots_endpoint(request: Request):
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        # No account yet (fresh anonymous browser) → no slots.
        if user_id:
            # Reap the owner's fully-past slots on their own read. A write on a
            # read, like `grant_group_membership_inline` on the group read —
            # but it keeps the playlist self-healing with no cron, which
            # matters because dev tiers run no tick.
            purge_past_slots(conn, user_id=user_id)
            slots = list_slots(conn, user_id=user_id)
        else:
            slots = []
    return SlotListResponse(slots=[SlotResponse(**s) for s in slots])


class WhoWithCandidate(WhoWithRef):
    """A pickable group or person, in the same {id, name} shape a saved
    who-with stores, plus the who-with field it belongs in."""

    kind: Literal["groups", "people"]


class WhoWithCandidatesResponse(BaseModel):
    """Everything the caller can point an activity's "who with" at: the groups
    they're a member of and the people in their address book, in ONE list
    ranked most-recently-referenced first (by the caller's own past picks) —
    groups and people interleaved, since "what I reached for last" doesn't care
    which kind it was. Never-picked entries tie and fall back to groups first,
    then alphabetical."""

    candidates: list[WhoWithCandidate] = []


@router.get("/who-with-candidates", response_model=WhoWithCandidatesResponse)
def who_with_candidates_endpoint(request: Request):
    # The picker's single source. Deliberately the SAME population
    # `services.slots._resolve_who_with` validates saves against, so the picker
    # can't offer something that would then be nulled on save. Empty for a
    # fresh anonymous browser with no account yet. Reconciles contacts inline
    # so freshly shared people appear (same as the invite-members endpoint).
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        if user_id:
            reconcile_contacts(conn, user_id)
        candidates = who_with_candidates(conn, user_id=user_id)
    return WhoWithCandidatesResponse(candidates=candidates)


class SlotEventPollInfo(BaseModel):
    """The (day, activity) key's STARTED poll — created from an attached
    activity draft the moment a viable gathering existed. One per key; rides
    on every card of the key + the event page's Poll section. The FE builds
    the poll URL as /g/{group_short_id}/p/{poll_short_id}."""

    poll_short_id: str | None = None
    group_short_id: str | None = None
    title: str | None = None
    is_closed: bool = False
    # The poll's own clocks (migration 161 can set either): while a suggestion
    # phase is running the FE counts down to `prephase_deadline`, else to
    # `response_deadline`. Both null on a poll started without options.
    prephase_deadline: str | None = None
    response_deadline: str | None = None
    # The poll question's icon fields — the FE derives the display emoji the
    # same way poll surfaces do (explicit category_icon → built-in category
    # icon → question-type symbol).
    category_icon: str | None = None
    category: str | None = None
    question_type: str | None = None


class SlotEventResponse(BaseModel):
    """One system-proposed PARTY as THIS viewer sees it — several may coexist
    per (day, activity). Derived on every read from the current slots +
    confirmations — see services/slot_events.py for met / can_confirm ("Full"
    when false and not confirmed) and the fresh-card rule."""

    # The party's anchor row; null for the FRESH (not yet minted) party card.
    id: str | None = None
    day: str
    activity: str
    emoji: str | None = None
    # "@ HH:MM" for the card's first line: the earliest start that lets every
    # member's minimum be met (the confirmed set's own start once the event
    # is on).
    time: str | None = None
    # The time the (confirmed + viewer) set still shares — the card's anchor.
    window: dict | None = None
    confirmed_count: int = 0
    confirmed_names: list[str] = []
    viewer_confirmed: bool = False
    can_confirm: bool = False
    met: bool = False
    # The viewer's confirmation here is a BACKUP: they ranked this event
    # below another same-day event of theirs that's currently on, so they
    # aren't counted toward this one (met / capacity / count / names) unless
    # the higher-ranked one falls through.
    standby: bool = False
    # NEAR-MISS: how many more people a gathering still needs before it's
    # viable (0 on a normal card). Shown when no viable gathering exists so a
    # declared activity is never a silent dead end; such a card is not
    # confirmable yet.
    needed: int = 0
    # The key's started poll (see SlotEventPollInfo); null when none.
    poll: SlotEventPollInfo | None = None
    # The viewer's stored preference rank over their same-slot confirmed
    # events (migration 160): 1 = top choice, equal ranks = LINKED (attending
    # both regardless of overlap). Null when never ordered / not confirmed.
    viewer_pref_rank: int | None = None


class SlotEventsResponse(BaseModel):
    events: list[SlotEventResponse] = []


class EventConfirmationRequest(BaseModel):
    day: str
    activity: str
    confirmed: bool
    # Which party to join; omitted/null = the fresh card (join the fullest
    # party that will take the caller, else mint a new one).
    event_id: str | None = None


class EventPreferencesRequest(BaseModel):
    day: str
    # Ordered tiers of party event ids, top preference first (the DnD
    # interface's output). Several ids in one tier = LINKED — the caller
    # attends all of them regardless of overlap.
    tiers: list[list[str]] = []


@router.get("/events", response_model=SlotEventsResponse)
def list_events_endpoint(request: Request):
    # Everything proposed to this viewer across the days their slots touch.
    # Identity-resolved like the rest of the slots API; no account → nothing.
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        events = list_events(conn, user_id=user_id)
    return SlotEventsResponse(events=events)


@router.post("/events/confirmation", response_model=SlotEventResponse)
def set_event_confirmation_endpoint(req: EventConfirmationRequest, request: Request):
    # Toggle the caller's confirmation. The server re-validates the join
    # against the CURRENT confirmed set — the FE's can_confirm is advisory,
    # so a race (someone else confirmed first) surfaces as 409 "Full" and the
    # FE refreshes into the Full state.
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        if not user_id:
            raise HTTPException(status_code=404, detail="Event not found")
        if req.event_id is not None:
            require_uuid(req.event_id, "event id")
        try:
            payload = set_confirmation(
                conn,
                user_id=user_id,
                day=req.day,
                activity=req.activity,
                confirmed=req.confirmed,
                event_id=req.event_id,
            )
        except NoSuchEventError:
            raise HTTPException(status_code=404, detail="Event not found")
        except EventFullError:
            raise HTTPException(status_code=409, detail="Full")
    return SlotEventResponse(**payload)


@router.post("/events/preferences")
def set_event_preferences_endpoint(req: EventPreferencesRequest, request: Request):
    # Store the caller's fallback ordering over their confirmed events of one
    # day (see set_event_preferences). Ids that aren't the caller's own
    # confirmations are silently ignored, so no per-id validation here.
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        if not user_id:
            raise HTTPException(status_code=404, detail="Event not found")
        set_event_preferences(conn, user_id=user_id, day=req.day, tiers=req.tiers)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Event comments (migration 157) — the poll-comments model keyed on the
# event's (day, LOWER(activity)) identity. Candidates-only (the same people
# who can see the event); reuses services/comments.py's ownership + reaction
# machinery via its table-whitelisted helpers.
# ---------------------------------------------------------------------------


class SlotEventCommentReaction(BaseModel):
    emoji: str
    count: int
    mine: bool


class SlotEventCommentResponse(BaseModel):
    id: str
    commenter_name: str
    user_id: str | None = None
    body: str
    created_at: str | None = None
    edited_at: str | None = None
    # Always empty — event threads have no @mention story yet; the field
    # keeps the wire shape identical to poll comments so the FE component
    # is shared verbatim.
    mentions: list[dict] = []
    reactions: list[SlotEventCommentReaction] = []
    is_mine: bool = False


class CreateEventCommentRequest(BaseModel):
    day: str
    activity: str
    commenter_name: str | None = None
    body: str


class UpdateEventCommentRequest(BaseModel):
    body: str


class ToggleEventCommentReactionRequest(BaseModel):
    emoji: str


def _event_comment_identity(conn, request: Request) -> tuple[str | None, list[str]]:
    """(resolved actor user_id, the caller's account-aware browser set) —
    resolved once per request, the poll-comments convention."""
    browser_id = _browser_id(request)
    actor = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=browser_id)
    bids = caller_browser_ids(conn, browser_id=browser_id, user_id=actor)
    return actor, bids


def _require_event_thread(conn, request: Request, day: str, activity: str) -> tuple[str, str, str | None, list[str]]:
    """Gate the thread to the event's candidates (404 to anyone else,
    indistinguishable from not-found) and return (day, key, actor, bids)."""
    key_pair = event_key(day, activity)
    if not key_pair:
        raise HTTPException(status_code=404, detail="Event not found")
    actor, bids = _event_comment_identity(conn, request)
    if not is_event_candidate(conn, user_id=actor, day=key_pair[0], key=key_pair[1]):
        raise HTTPException(status_code=404, detail="Event not found")
    return key_pair[0], key_pair[1], actor, bids


def _row_to_event_comment(
    row: dict, *, is_mine: bool, reactions: list[dict] | None = None
) -> SlotEventCommentResponse:
    return SlotEventCommentResponse(
        id=str(row["id"]),
        commenter_name=row["commenter_name"],
        user_id=str(row["user_id"]) if row.get("user_id") else None,
        body=row["body"],
        created_at=row["created_at"].isoformat() if row.get("created_at") else None,
        edited_at=row["edited_at"].isoformat() if row.get("edited_at") else None,
        reactions=[SlotEventCommentReaction(**r) for r in (reactions or [])],
        is_mine=is_mine,
    )


_EVENT_REACTION_TABLE = "slot_event_comment_reactions"


@router.get("/events/comments", response_model=list[SlotEventCommentResponse])
def list_event_comments_endpoint(day: str, activity: str, request: Request):
    with get_db() as conn:
        d, key, actor, bids = _require_event_thread(conn, request, day, activity)
        rows = list_event_comments(conn, day=d, key=key)
        reactions = reactions_for_comments(
            conn,
            [str(r["id"]) for r in rows],
            caller_bids=bids,
            actor_user_id=actor,
            table=_EVENT_REACTION_TABLE,
        )
    return [
        _row_to_event_comment(
            r,
            is_mine=comment_is_mine(r, caller_bids=bids, actor_user_id=actor),
            reactions=reactions.get(str(r["id"])),
        )
        for r in rows
    ]


@router.post("/events/comments", response_model=SlotEventCommentResponse, status_code=201)
def create_event_comment_endpoint(req: CreateEventCommentRequest, request: Request):
    """Post a comment on an event. Name-gated like poll comments
    (validate_user_name backstop; AccountGateModal is the FE's UX); body
    trimmed + silently capped, 400 when empty after trim."""
    name = validate_user_name(req.commenter_name, field="Name")
    body = sanitize_comment_body(req.body)
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")
    with get_db() as conn:
        d, _key, actor, _bids = _require_event_thread(conn, request, req.day, req.activity)
        row = create_event_comment(
            conn,
            day=d,
            activity=req.activity.strip(),
            browser_id=_browser_id(request),
            user_id=actor,
            name=name,
            body=body,
        )
    return _row_to_event_comment(row, is_mine=True)


@router.put("/events/comments/{comment_id}", response_model=SlotEventCommentResponse)
def update_event_comment_endpoint(
    comment_id: str, req: UpdateEventCommentRequest, request: Request
):
    require_uuid(comment_id, "comment_id")
    body = sanitize_comment_body(req.body)
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")
    with get_db() as conn:
        actor, bids = _event_comment_identity(conn, request)
        row = update_event_comment(
            conn, comment_id, caller_bids=bids, actor_user_id=actor, body=body
        )
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
        reactions = reactions_for_comments(
            conn, [comment_id], caller_bids=bids, actor_user_id=actor,
            table=_EVENT_REACTION_TABLE,
        )
    return _row_to_event_comment(
        row, is_mine=True, reactions=reactions.get(comment_id)
    )


@router.delete("/events/comments/{comment_id}", status_code=204)
def delete_event_comment_endpoint(comment_id: str, request: Request):
    require_uuid(comment_id, "comment_id")
    with get_db() as conn:
        actor, bids = _event_comment_identity(conn, request)
        if not delete_event_comment(
            conn, comment_id, caller_bids=bids, actor_user_id=actor
        ):
            raise HTTPException(status_code=404, detail="Comment not found")


@router.post(
    "/events/comments/{comment_id}/reactions",
    response_model=list[SlotEventCommentReaction],
)
def toggle_event_comment_reaction_endpoint(
    comment_id: str, req: ToggleEventCommentReactionRequest, request: Request
):
    """Toggle the caller's emoji reaction (identity-light like poll comment
    reactions — no name gate); candidacy of the comment's OWN event key gates
    access. Returns the comment's updated reaction summary."""
    require_uuid(comment_id, "comment_id")
    emoji = validate_category_icon(req.emoji)
    if not emoji:
        raise HTTPException(status_code=400, detail="Reaction emoji is required")
    with get_db() as conn:
        row = get_event_comment(conn, comment_id)
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
        d, key, actor, bids = _require_event_thread(
            conn, request, str(row["day"]), row["activity"]
        )
        del d, key
        toggle_reaction(
            conn,
            comment_id,
            browser_id=_browser_id(request),
            user_id=actor,
            caller_bids=bids,
            emoji=emoji,
            table=_EVENT_REACTION_TABLE,
        )
        reactions = reactions_for_comments(
            conn, [comment_id], caller_bids=bids, actor_user_id=actor,
            table=_EVENT_REACTION_TABLE,
        )
    return [SlotEventCommentReaction(**r) for r in reactions.get(comment_id, [])]


@router.put("/{slot_id}", response_model=CreateSlotResponse)
def update_slot_endpoint(slot_id: str, req: CreateSlotRequest, request: Request):
    require_uuid(slot_id, "slot id")
    browser_id = _browser_id(request)
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=browser_id)
        if not user_id:
            raise HTTPException(status_code=404, detail="Slot not found")
        ok = update_slot(
            conn,
            slot_id=slot_id,
            user_id=user_id,
            day_time_windows=req.day_time_windows,
            activities=[a.model_dump() for a in req.activities],
        )
        if not ok:
            raise HTTPException(status_code=404, detail="Slot not found")
    _start_event_polls_after_save(user_id, req.day_time_windows)
    return CreateSlotResponse(id=slot_id)


@router.delete("/{slot_id}", status_code=204)
def delete_slot_endpoint(slot_id: str, request: Request):
    require_uuid(slot_id, "slot id")
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        if not user_id:
            raise HTTPException(status_code=404, detail="Slot not found")
        if not delete_slot(conn, slot_id=slot_id, user_id=user_id):
            raise HTTPException(status_code=404, detail="Slot not found")


@router.post("/suggestions", response_model=ActivitySuggestionsResponse)
def suggestions_endpoint(req: SuggestionsRequest, request: Request):
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        groups = suggest_activities(conn, user_id=user_id, day_time_windows=req.day_time_windows)
    return ActivitySuggestionsResponse(**groups)
