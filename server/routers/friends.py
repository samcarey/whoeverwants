"""Friends: overview (friends / requests / suggestions / blocks / contact
groups / the shareable friend code), request lifecycle, block list, private
contact-group CRUD, and the /f/<code> profile lookup.

Identity mirrors the slots router: `resolve_actor_user_id` (bearer session,
else the browser-linked account). Friends are strictly account-keyed — an
account-less browser gets an empty overview and 401s on writes (the FE
gates those flows behind AccountGateModal).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import resolve_actor_user_id
from services.contacts import reconcile_contacts
from services.friends import (
    block_user,
    blocked_rows,
    create_contact_group,
    delete_contact_group,
    ensure_friend_code,
    friend_rows,
    friend_suggestions,
    list_contact_groups,
    pending_requests,
    profile_for_code,
    reconcile_event_contacts,
    respond_to_request,
    send_friend_request,
    unblock_user,
    unfriend,
    update_contact_group,
    user_id_for_code,
)
from services.groups import require_uuid
from services.validation import validate_user_name

router = APIRouter(prefix="/api/friends", tags=["friends"])


def _resolve_user(conn, request: Request) -> str | None:
    return resolve_actor_user_id(
        conn, user_id=_user_id(request), browser_id=_browser_id(request)
    )


def _require_user(conn, request: Request) -> str:
    user_id = _resolve_user(conn, request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to manage friends")
    return user_id


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PersonRef(BaseModel):
    user_id: str
    name: str | None = None
    image_updated_at: datetime | None = None


class FriendRequestRef(PersonRef):
    id: str
    created_at: datetime | None = None


class ContactGroupResponse(BaseModel):
    id: str
    name: str
    members: list[PersonRef]


class FriendsOverviewResponse(BaseModel):
    signed_in: bool
    friend_code: str | None = None
    friends: list[PersonRef] = []
    incoming: list[FriendRequestRef] = []
    outgoing: list[FriendRequestRef] = []
    suggestions: list[PersonRef] = []
    blocked: list[PersonRef] = []
    groups: list[ContactGroupResponse] = []


class SendRequestBody(BaseModel):
    to_user_id: str | None = None
    code: str | None = None


class BlockBody(BaseModel):
    user_id: str


class CreateGroupBody(BaseModel):
    name: str
    member_ids: list[str] = []


class UpdateGroupBody(BaseModel):
    name: str | None = None
    member_ids: list[str] | None = None


class ProfileResponse(BaseModel):
    user_id: str
    name: str | None
    created_at: datetime | None = None
    image_updated_at: datetime | None = None
    relationship: str


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@router.get("", response_model=FriendsOverviewResponse)
@router.get("/", response_model=FriendsOverviewResponse, include_in_schema=False)
def get_overview(request: Request):
    with get_db() as conn:
        user_id = _resolve_user(conn, request)
        if not user_id:
            return FriendsOverviewResponse(signed_in=False)
        # Freshen the encountered pool (shared groups + shared suggested
        # events) so the suggestions list reflects current reality.
        reconcile_contacts(conn, user_id)
        reconcile_event_contacts(conn, user_id)
        incoming, outgoing = pending_requests(conn, user_id)
        return FriendsOverviewResponse(
            signed_in=True,
            friend_code=ensure_friend_code(conn, user_id),
            friends=[PersonRef(**f) for f in friend_rows(conn, user_id)],
            incoming=[FriendRequestRef(**r) for r in incoming],
            outgoing=[FriendRequestRef(**r) for r in outgoing],
            suggestions=[PersonRef(**s) for s in friend_suggestions(conn, user_id)],
            blocked=[PersonRef(**b) for b in blocked_rows(conn, user_id)],
            groups=[ContactGroupResponse(**g) for g in list_contact_groups(conn, user_id)],
        )


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

@router.post("/requests")
def send_request(req: SendRequestBody, request: Request):
    with get_db() as conn:
        user_id = _require_user(conn, request)
        # The recipient needs SOMETHING to recognize the requester by —
        # same name-required rule as group join requests.
        me = conn.execute(
            "SELECT display_name FROM users WHERE id = %(u)s::uuid", {"u": user_id}
        ).fetchone()
        validate_user_name(me["display_name"] if me else None, field="Name")
        if req.code:
            target = user_id_for_code(conn, req.code)
            if not target:
                raise HTTPException(status_code=404, detail="Profile not found")
        elif req.to_user_id:
            require_uuid(req.to_user_id, "user id")
            target = req.to_user_id
            exists = conn.execute(
                "SELECT 1 FROM users WHERE id = %(t)s::uuid", {"t": target}
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="User not found")
        else:
            raise HTTPException(status_code=400, detail="to_user_id or code is required")
        status = send_friend_request(conn, user_id, target)
        if status == "self":
            raise HTTPException(status_code=400, detail="That's you")
        return {"status": status}


@router.post("/requests/{request_id}/accept")
def accept_request(request_id: str, request: Request):
    with get_db() as conn:
        user_id = _require_user(conn, request)
        require_uuid(request_id, "request id")
        if not respond_to_request(conn, user_id, request_id, accept=True):
            raise HTTPException(status_code=404, detail="Request not found")
        return {"status": "friends"}


@router.post("/requests/{request_id}/reject")
def reject_request(request_id: str, request: Request):
    with get_db() as conn:
        user_id = _require_user(conn, request)
        require_uuid(request_id, "request id")
        if not respond_to_request(conn, user_id, request_id, accept=False):
            raise HTTPException(status_code=404, detail="Request not found")
        return {"status": "rejected"}


@router.post("/requests/{request_id}/block")
def block_requester(request_id: str, request: Request):
    """Reject the request AND block its sender in one step."""
    with get_db() as conn:
        user_id = _require_user(conn, request)
        require_uuid(request_id, "request id")
        row = respond_to_request(conn, user_id, request_id, accept=False)
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        block_user(conn, user_id, row["from_user_id"])
        return {"status": "blocked"}


# ---------------------------------------------------------------------------
# Friendships + blocks
# ---------------------------------------------------------------------------

@router.delete("/friendship/{user_id}", status_code=204)
def remove_friend(user_id: str, request: Request):
    with get_db() as conn:
        me = _require_user(conn, request)
        require_uuid(user_id, "user id")
        unfriend(conn, me, user_id)


@router.post("/blocks")
def add_block(req: BlockBody, request: Request):
    with get_db() as conn:
        me = _require_user(conn, request)
        require_uuid(req.user_id, "user id")
        block_user(conn, me, req.user_id)
        return {"status": "blocked"}


@router.delete("/blocks/{user_id}", status_code=204)
def remove_block(user_id: str, request: Request):
    with get_db() as conn:
        me = _require_user(conn, request)
        require_uuid(user_id, "user id")
        unblock_user(conn, me, user_id)


# ---------------------------------------------------------------------------
# Contact groups
# ---------------------------------------------------------------------------

def _clean_group_name(name: str) -> str:
    cleaned = (name or "").strip()[:50]
    if not cleaned:
        raise HTTPException(status_code=400, detail="Group name is required")
    return cleaned


@router.post("/groups", status_code=201)
def create_group(req: CreateGroupBody, request: Request):
    with get_db() as conn:
        user_id = _require_user(conn, request)
        name = _clean_group_name(req.name)
        group_id = create_contact_group(conn, user_id, name)
        if not group_id:
            raise HTTPException(status_code=409, detail="You already have a group with that name")
        if req.member_ids:
            update_contact_group(conn, user_id, group_id, member_ids=req.member_ids)
        return {"id": group_id, "name": name}


@router.put("/groups/{group_id}")
def update_group(group_id: str, req: UpdateGroupBody, request: Request):
    with get_db() as conn:
        user_id = _require_user(conn, request)
        require_uuid(group_id, "group id")
        name = _clean_group_name(req.name) if req.name is not None else None
        ok = update_contact_group(
            conn, user_id, group_id, name=name, member_ids=req.member_ids
        )
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"status": "ok"}


@router.delete("/groups/{group_id}", status_code=204)
def remove_group(group_id: str, request: Request):
    with get_db() as conn:
        user_id = _require_user(conn, request)
        require_uuid(group_id, "group id")
        if not delete_contact_group(conn, user_id, group_id):
            raise HTTPException(status_code=404, detail="Group not found")


# ---------------------------------------------------------------------------
# Profile link
# ---------------------------------------------------------------------------

@router.get("/profile/{code}", response_model=ProfileResponse)
def get_profile(code: str, request: Request):
    with get_db() as conn:
        viewer = _resolve_user(conn, request)
        profile = profile_for_code(conn, code, viewer)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        return ProfileResponse(**profile)
