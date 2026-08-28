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
from services.auth import create_anonymous_user, resolve_actor_user_id
from services.contacts import reconcile_contacts
from services.groups import require_uuid
from services.slot_events import (
    EventFullError,
    NoSuchEventError,
    list_events,
    set_confirmation,
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


class SlotEventsResponse(BaseModel):
    events: list[SlotEventResponse] = []


class EventConfirmationRequest(BaseModel):
    day: str
    activity: str
    confirmed: bool
    # Which party to join; omitted/null = the fresh card (join the fullest
    # party that will take the caller, else mint a new one).
    event_id: str | None = None


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
