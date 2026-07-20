"""Playlist slots: create a slot + fetch ranked activity suggestions.

Identity mirrors poll authorship: the caller's account is resolved via
`resolve_actor_user_id` (bearer session, else the browser-linked account),
and an anonymous creator with no account yet gets a lightweight browser-tied
one minted at save time — so a slot always has an owner and the "you've
picked before" suggestion group works across that browser's future slots.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import create_anonymous_user, resolve_actor_user_id
from services.contacts import list_invitable_accounts, reconcile_contacts
from services.groups import require_uuid
from services.slots import (
    create_slot,
    delete_slot,
    list_slots,
    suggest_activities,
    update_slot,
)

router = APIRouter(prefix="/api/slots", tags=["slots"])

# A group id that no group has, so `list_invitable_accounts`' "not already a
# member of THIS group" exclusion is a no-op → it returns the caller's whole
# contact list. Lets the slot form's "Who With → Pick" picker reuse the same
# address book the group invite-members search uses, minus any group scope.
_NO_GROUP_ID = "00000000-0000-0000-0000-000000000000"


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
    # Optional per-activity "who with": groups and/or specific people the
    # owner is willing to do this with (display-name strings, sanitized +
    # capped in services.slots). None/[] = "Anyone".
    with_groups: list[str] | None = None
    with_people: list[str] | None = None


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
    with_groups: list[str] | None = None
    with_people: list[str] | None = None


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
        slots = list_slots(conn, user_id=user_id) if user_id else []
    return SlotListResponse(slots=[SlotResponse(**s) for s in slots])


class ContactResponse(BaseModel):
    """One pickable person for the slot form's "Who With → Pick" list: an
    account the caller has shared a group with (their `user_contacts` address
    book). Mirrors the group invite-members row, without a group scope."""

    user_id: str
    name: str | None
    shared_group_count: int
    last_seen_at: str


@router.get("/contacts", response_model=list[ContactResponse])
def list_contacts_endpoint(request: Request):
    # Read-only source for the "Who With → Pick" picker: every account the
    # caller has encountered, newest-shared first. Empty for a fresh
    # anonymous browser with no account yet. Reconciles inline so freshly
    # shared contacts appear (same as the group invite-members endpoint).
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        if not user_id:
            return []
        reconcile_contacts(conn, user_id)
        accounts = list_invitable_accounts(conn, user_id, _NO_GROUP_ID)
    return [
        ContactResponse(
            user_id=a.user_id,
            name=a.name,
            shared_group_count=a.shared_group_count,
            last_seen_at=a.last_seen_at.isoformat() if a.last_seen_at else "",
        )
        for a in accounts
    ]


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
