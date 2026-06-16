"""User profile API endpoints.

The profile image is the FE-cropped square JPEG/PNG that replaces the
user's initials circle wherever their name renders.

Storage: inline BYTEA on a `user_profiles` row keyed by `user_id`
(migration 124 — previously keyed by `browser_id`, migration 109). The
photo is account data, like `users.display_name`: it follows the user
across every device they're signed in on and disappears on sign-out.
`image_updated_at` doubles as the cache-buster: the FE constructs
`/api/users/by-user-id/<user_id>/image?v=<isoTimestamp>` so a
freshly-updated image invalidates browser + CDN caches without changing
the user's identity.

Identity model: the caller's account is resolved via
`resolve_actor_user_id` (bearer session, else the account linked to
their browser). Uploading requires an account — when the caller has
none, `POST /me/image` mints a lightweight one from the supplied name,
exactly like `POST /api/polls` does for the creator (the FE gates the
upload behind the same account-setup modal as creating a group, so a
name is present). Reads/deletes never mint: an account-less caller
simply has no photo.

Trust model matches the groups endpoints: anyone with the URL of an
existing image may fetch it (the user_id is the URL token). Writes are
gated by the caller's resolved account.
"""

from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import create_anonymous_user, resolve_actor_user_id
from services.category_options import load_category_options
from services.contacts import forget_contact
from services.groups import (
    get_group_metadata,
    require_uuid,
    resolve_group_id_from_route_id,
)
from services.poll_categories import load_category_recency
from services.poll_suggest import (
    is_stale as _suggestions_stale,
    load_cached_suggestions,
    refresh_poll_suggestions,
)
from services.profiles import get_profile_card
from services.validation import validate_user_name


def _group_is_explore(conn, group_id: str | None) -> bool:
    """Whether `group_id` is an explore-feed group (migration 143). Drives the
    explore/regular isolation of category suggestions."""
    if not group_id:
        return False
    meta = get_group_metadata(conn, group_id)
    return bool(meta and meta.get("privacy") == "explore")


def _caller_user_id(conn, request: Request) -> str | None:
    """The caller's effective account: bearer session user_id, else the
    account linked to their browser (auto-created at poll/photo-create
    time). None for a brand-new browser that has never created anything."""
    return resolve_actor_user_id(
        conn, user_id=_user_id(request), browser_id=_browser_id(request)
    )


class UserImageRequest(BaseModel):
    """`POST /api/users/me/image` body.

    `image_base64` is the FE-cropped square image (JPEG or PNG) encoded
    as base64 with no `data:` prefix. `mime_type` must be `image/jpeg`
    or `image/png`. Max decoded size: `MAX_IMAGE_BYTES`. `creator_name`
    is used ONLY when the caller has no account yet — it names the
    lightweight account minted to own the photo (ignored when an account
    already resolves). Same shape as `POST /api/polls`'s creator_name.
    """

    image_base64: str
    mime_type: str
    creator_name: str | None = None


class UserImageResponse(BaseModel):
    """Returned by `POST` / `DELETE /api/users/me/image`. `user_id` is the
    account the photo is keyed to (null only on a delete by an
    account-less caller)."""

    user_id: str | None = None
    image_updated_at: str | None = None


class UserProfileResponse(BaseModel):
    """Returned by `GET /api/users/me/profile`. `user_id` is the caller's
    resolved account (null when they have none → no photo possible).
    `image_updated_at` is null when no image is set. The FE renders a
    `/by-user-id/<user_id>/image` URL when both are present, else
    falls through to initials."""

    user_id: str | None = None
    image_updated_at: str | None = None


class SharedGroupResponse(BaseModel):
    """One group the caller shares with the profiled user. `route_id` builds a
    `/g/<route_id>` link; `name` is the group's display name (may be null)."""

    route_id: str
    name: str | None = None


class UserProfileCardResponse(BaseModel):
    """`GET /api/users/{user_id}/profile-card` — the long-press profile modal
    data. `name`/`image_updated_at`/`created_at` are account-level;
    `shared_groups` is computed per-caller (groups BOTH belong to)."""

    user_id: str
    name: str | None = None
    image_updated_at: str | None = None
    created_at: str
    shared_groups: list[SharedGroupResponse]


class PollCategoryHistoryResponse(BaseModel):
    """Returned by `GET /api/users/me/poll-category-history`.

    Two recency-ordered (most-recent-first) category lists for the caller:
    `group` is scoped to the `?group=` route id (empty when absent /
    nothing created there yet); `general` spans every group. The FE orders
    the category bubble bar by group recency, then general recency, then a
    per-app-start random fallback for categories absent from both lists."""

    group: list[str]
    general: list[str]


class CategoryOptionEntry(BaseModel):
    """One previously-referenced option: its display text + optional rich
    metadata (favicon / poster / address / rating / coords) so the
    autocomplete dropdown can render it identically to a fresh search hit and
    re-attach the metadata when it's picked."""

    label: str
    metadata: dict | None = None


class CategoryOptionsResponse(BaseModel):
    """Returned by `GET /api/users/me/category-options`.

    Two most-recent-first lists of options previously referenced (given as
    ballot options OR suggested) for the requested category: `group` is scoped
    to the `?group=` route id; `general` spans every group the caller can see,
    excluding labels already in `group`. The FE concatenates `group` then
    `general` and shows them above live search results."""

    group: list[CategoryOptionEntry]
    general: list[CategoryOptionEntry]


class PollSuggestionEntry(BaseModel):
    """One AI-predicted poll the caller might create next. STRUCTURED fields, not
    a title — the FE re-derives the displayed title from them (same as every
    poll). `title` is the typed prompt for yes_no / the item for limited_supply;
    `options` is a fixed ballot list (>= 2) for choice categories; `context` is
    the short "for X" subject."""

    category: str
    title: str | None = None
    options: list[str] | None = None
    # Per-option DB ref (favicon / poster / coords / address) for options that
    # were previously referenced in the group — keyed by option label. Lets the
    # prefilled form render the rich chip the original pick had.
    options_metadata: dict | None = None
    context: str | None = None


class PollSuggestionsResponse(BaseModel):
    """Returned by `GET /api/users/me/poll-suggestions`. The cached, per-(user,
    group) list of predicted next polls + when it was generated (null when none
    cached yet — the read schedules a background generation in that case)."""

    suggestions: list[PollSuggestionEntry]
    generated_at: str | None = None


# Mirrors `MAX_IMAGE_BYTES` in routers/groups.py. 5 MiB is well above the
# FE-cropped ~100KB target but bounded enough that a pathological client
# can't OOM the 1GB droplet's API container.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png"})


router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me/profile", response_model=UserProfileResponse)
def get_my_profile(request: Request):
    """Current account's profile metadata.

    Returns the caller's resolved user_id (null when they have no account
    → no photo possible) and image_updated_at (null when no image is
    set). Idempotent and side-effect free — never mints an account or a
    user_profiles row.
    """
    with get_db() as conn:
        user_id = _caller_user_id(conn, request)
        image_updated_at = None
        if user_id:
            row = conn.execute(
                "SELECT image_updated_at FROM user_profiles WHERE user_id = %(id)s",
                {"id": user_id},
            ).fetchone()
            if row and row.get("image_updated_at"):
                image_updated_at = row["image_updated_at"]
    return UserProfileResponse(
        user_id=user_id,
        image_updated_at=image_updated_at.isoformat() if image_updated_at else None,
    )


@router.get("/{user_id}/profile-card", response_model=UserProfileCardResponse)
def get_user_profile_card(user_id: str, request: Request):
    """Profile card for another user: name, avatar timestamp, account age
    (`created_at`), and the groups the caller shares with them. The user_id is
    the URL token (name + image are already broadly exposed); shared_groups is
    intersected with the caller's own visible memberships. 404 when the target
    account doesn't exist.
    """
    require_uuid(user_id, "user_id")
    browser_id = _browser_id(request)
    caller_user_id = _user_id(request)
    with get_db() as conn:
        card = get_profile_card(
            conn,
            user_id,
            caller_browser_id=browser_id,
            caller_user_id=resolve_actor_user_id(
                conn, user_id=caller_user_id, browser_id=browser_id
            ),
        )
    if card is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserProfileCardResponse(
        user_id=card.user_id,
        name=card.name,
        image_updated_at=card.image_updated_at.isoformat()
        if card.image_updated_at
        else None,
        created_at=card.created_at.isoformat(),
        shared_groups=[
            SharedGroupResponse(route_id=g.route_id, name=g.name)
            for g in card.shared_groups
        ],
    )


@router.get("/me/poll-category-history", response_model=PollCategoryHistoryResponse)
def get_my_poll_category_history(request: Request, group: str | None = None):
    """Recency-ordered poll categories the caller has created.

    Drives the group page's category bubble bar ordering. `group` is the
    `/g/<routeId>` route id of the current group (resolved against the
    same four forms as the other group endpoints); omit it on the empty
    `/g/` placeholder. Identity is implicit (browser_id + signed-in
    user_id from middleware), so the union spans every linked device.

    Tolerant by design: an anonymous request, an unresolvable group, or a
    user with no history all return empty lists rather than erroring — the
    bubble bar must always render in *some* order.
    """
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    if not browser_id and not user_id:
        return PollCategoryHistoryResponse(group=[], general=[])
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, group) if group else None
        explore = _group_is_explore(conn, group_id)
        recency = load_category_recency(
            conn, browser_id, user_id=user_id, group_id=group_id, explore=explore
        )
    return PollCategoryHistoryResponse(group=recency.group, general=recency.general)


@router.get("/me/category-options", response_model=CategoryOptionsResponse)
def get_my_category_options(request: Request, category: str, group: str | None = None):
    """Options previously referenced for `category`, to prime the create-poll
    autocomplete dropdown before the user types. (Parallels
    `get_my_poll_category_history`, which orders the category bubble bar; both
    union across the caller's linked devices.)

    `group` is the `/g/<routeId>` route id of the group being created in
    (resolved against the four group route forms; omit on the empty `/g/`
    placeholder). Identity is implicit (browser_id + signed-in user_id from
    middleware), so the cross-group `general` list spans every linked device's
    memberships.

    Tolerant by design: anonymous request, blank category, unresolvable group,
    or no history all return empty lists — the field must still work."""
    browser_id = _browser_id(request)
    user_id = _user_id(request)
    if not browser_id and not user_id:
        return CategoryOptionsResponse(group=[], general=[])
    with get_db() as conn:
        group_id = resolve_group_id_from_route_id(conn, group) if group else None
        explore = _group_is_explore(conn, group_id)
        result = load_category_options(
            conn,
            browser_id=browser_id,
            user_id=user_id,
            category=category,
            group_id=group_id,
            explore=explore,
        )
    return CategoryOptionsResponse(
        group=[CategoryOptionEntry(label=e.label, metadata=e.metadata) for e in result.group],
        general=[CategoryOptionEntry(label=e.label, metadata=e.metadata) for e in result.general],
    )


@router.get("/me/poll-suggestions", response_model=PollSuggestionsResponse)
def get_my_poll_suggestions(
    request: Request, background_tasks: BackgroundTasks, group: str | None = None
):
    """AI-predicted next polls for the caller in `group` (the `/g/<routeId>`
    route id), tailored per (user, group) by an LLM from the group's + the
    caller's poll history.

    Returns the cached list (empty when none generated yet). When the cache is
    missing or stale, schedules a background regeneration so the NEXT open is
    ready — the create-poll box falls back to its deterministic heuristic
    suggestions in the meantime, and re-ranks/filters this list in real time
    with the on-device model as the user types.

    Tolerant by design: anonymous request, no account, unresolvable group, or no
    history all return an empty list — the box must still work. Explore groups
    return empty (they have the variant feed instead)."""
    browser_id = _browser_id(request)
    with get_db() as conn:
        user_id = _caller_user_id(conn, request)
        group_id = resolve_group_id_from_route_id(conn, group) if group else None
        if not user_id or not group_id or _group_is_explore(conn, group_id):
            return PollSuggestionsResponse(suggestions=[], generated_at=None)
        cached = load_cached_suggestions(conn, user_id, group_id)
    if _suggestions_stale(cached):
        background_tasks.add_task(refresh_poll_suggestions, user_id, group_id)
    if cached is None:
        return PollSuggestionsResponse(suggestions=[], generated_at=None)
    return PollSuggestionsResponse(
        suggestions=[PollSuggestionEntry(**s) for s in cached.suggestions],
        generated_at=cached.generated_at.isoformat() if cached.generated_at else None,
    )


@router.post("/me/image", response_model=UserImageResponse)
def upload_my_image(request: Request, req: UserImageRequest):
    """Set the caller's profile avatar image (account-keyed).

    Body: base64-encoded JPEG or PNG bytes (already square-cropped by
    the FE — the server does NOT crop or resize). Replaces any previous
    image for this account. Stamps `image_updated_at` so the FE knows to
    invalidate its `/api/users/by-user-id/<id>/image?v=<ts>` cache.

    Requires an account: when the caller has none, a lightweight one is
    minted from `creator_name` (mirrors `POST /api/polls`). The FE gates
    the upload behind the account-setup modal, so a name is present;
    `validate_user_name` enforces it server-side as the backstop.

    `INSERT ... ON CONFLICT (user_id)` so the same endpoint covers both
    first upload and replacement.
    """
    if req.mime_type not in _ALLOWED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Image mime_type must be image/jpeg or image/png",
        )
    try:
        image_bytes = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid base64 image data: {exc}"
        ) from exc
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image is empty")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds {MAX_IMAGE_BYTES} bytes",
        )
    with get_db() as conn:
        user_id = _caller_user_id(conn, request)
        if not user_id:
            # No account yet — mint one named by the (FE-gated) creator name.
            name = validate_user_name(req.creator_name, field="name")
            user_id = create_anonymous_user(
                conn, browser_id=_browser_id(request), display_name=name
            )
        row = conn.execute(
            """
            INSERT INTO user_profiles (user_id, image_data, image_mime_type, image_updated_at)
            VALUES (%(id)s, %(data)s, %(mime)s, NOW())
            ON CONFLICT (user_id) DO UPDATE
              SET image_data = EXCLUDED.image_data,
                  image_mime_type = EXCLUDED.image_mime_type,
                  image_updated_at = EXCLUDED.image_updated_at
            RETURNING image_updated_at
            """,
            {"id": user_id, "data": image_bytes, "mime": req.mime_type},
        ).fetchone()
    image_updated_at = row.get("image_updated_at") if row else None
    return UserImageResponse(
        user_id=user_id,
        image_updated_at=image_updated_at.isoformat() if image_updated_at else None,
    )


@router.delete("/me/image", response_model=UserImageResponse)
def delete_my_image(request: Request):
    """Clear the caller's profile avatar image. Idempotent — a 200 is
    returned even if no image was set (or the caller has no account), so
    the FE doesn't have to distinguish "was set" from "wasn't set".
    Never mints an account. `image_updated_at` is set to NULL so the FE
    falls back to initials.
    """
    with get_db() as conn:
        user_id = _caller_user_id(conn, request)
        if user_id:
            conn.execute(
                """
                UPDATE user_profiles
                   SET image_data = NULL,
                       image_mime_type = NULL,
                       image_updated_at = NULL
                 WHERE user_id = %(id)s
                """,
                {"id": user_id},
            )
    return UserImageResponse(user_id=user_id, image_updated_at=None)


@router.delete("/me/contacts/{contact_user_id}", status_code=204)
def forget_my_contact(contact_user_id: str, request: Request):
    """Remove an account from the caller's address book ("forget" them).

    Backs the long-press profile modal's Forget button, shown only when the
    caller shares NO groups with the person — without a shared group, the
    `user_contacts` row is the only reason they keep surfacing (invite-members
    candidates, plus-one lookup), and `reconcile_contacts` won't re-add them.
    (Forgetting someone you DO still share a group with is allowed but
    pointless: the next reconcile re-adds them.)

    Idempotent — 204 even when no contact row existed or the caller has no
    account (no account → no contacts). Malformed ids 404 via `require_uuid`.
    """
    require_uuid(contact_user_id, "user_id")
    with get_db() as conn:
        user_id = _caller_user_id(conn, request)
        if user_id:
            forget_contact(conn, user_id, contact_user_id)
    return Response(status_code=204)


@router.get("/by-user-id/{user_id}/image")
def get_user_image(user_id: str):
    """Serve a user's avatar image bytes with the stored MIME type.

    Public — no auth check. The user_id is the URL token, so anyone
    holding a valid id can fetch the image (same trust model as the
    groups image endpoint; the image is the caller's own avatar, shown
    only to themselves). Cached via the FE's `?v=<image_updated_at>`
    query string with the immutable cache-control header so a given URL
    never re-fetches once received (the next change bumps the timestamp,
    producing a new URL).

    Returns 404 when no image is set (FE renders fallback initials).
    """
    require_uuid(user_id, "user_id")
    with get_db() as conn:
        row = conn.execute(
            "SELECT image_data, image_mime_type FROM user_profiles WHERE user_id = %(id)s",
            {"id": user_id},
        ).fetchone()
    if not row or not row.get("image_data"):
        raise HTTPException(status_code=404, detail="Image not set")
    return Response(
        content=bytes(row["image_data"]),
        media_type=row.get("image_mime_type") or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
