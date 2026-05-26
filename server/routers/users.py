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

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from database import get_db
from middleware import browser_id_from_request as _browser_id
from middleware import user_id_from_request as _user_id
from services.auth import create_anonymous_user, resolve_actor_user_id
from services.groups import require_uuid, resolve_group_id_from_route_id
from services.poll_categories import load_category_recency
from services.validation import validate_user_name


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


class PollCategoryHistoryResponse(BaseModel):
    """Returned by `GET /api/users/me/poll-category-history`.

    Two recency-ordered (most-recent-first) category lists for the caller:
    `group` is scoped to the `?group=` route id (empty when absent /
    nothing created there yet); `general` spans every group. The FE orders
    the category bubble bar by group recency, then general recency, then a
    per-app-start random fallback for categories absent from both lists."""

    group: list[str]
    general: list[str]


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
        recency = load_category_recency(
            conn, browser_id, user_id=user_id, group_id=group_id
        )
    return PollCategoryHistoryResponse(group=recency.group, general=recency.general)


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
