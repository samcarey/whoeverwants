"""Playlist slots: create a slot + fetch ranked activity suggestions.

Identity mirrors poll authorship: the caller's account is resolved via
`resolve_actor_user_id` (bearer session, else the browser-linked account),
and an anonymous creator with no account yet gets a lightweight browser-tied
one minted at save time — so a slot always has an owner and the "you've
picked before" suggestion group works across that browser's future slots.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import create_anonymous_user, resolve_actor_user_id
from services.slots import create_slot, suggest_activities

router = APIRouter(prefix="/api/slots", tags=["slots"])


class CreateSlotRequest(BaseModel):
    day_time_windows: list[dict] = []
    activities: list[str] = []


class CreateSlotResponse(BaseModel):
    id: str


class SuggestionsRequest(BaseModel):
    day_time_windows: list[dict] = []


class ActivitySuggestionsResponse(BaseModel):
    # Highest-priority group first; each list is display strings, deduped
    # across groups and blacklist-filtered.
    overlapping: list[str] = []
    yours: list[str] = []
    others: list[str] = []


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
            activities=req.activities,
        )
    return CreateSlotResponse(id=slot_id)


@router.post("/suggestions", response_model=ActivitySuggestionsResponse)
def suggestions_endpoint(req: SuggestionsRequest, request: Request):
    with get_db() as conn:
        user_id = resolve_actor_user_id(conn, user_id=_user_id(request), browser_id=_browser_id(request))
        groups = suggest_activities(conn, user_id=user_id, day_time_windows=req.day_time_windows)
    return ActivitySuggestionsResponse(**groups)
