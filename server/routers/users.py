"""User profile API endpoints.

Mirrors the group avatar image upload (migration 108) for per-browser
profile images. The image is the FE-cropped square JPEG/PNG that
replaces the user's initials circle wherever their name renders.

Storage: inline BYTEA on a `user_profiles` row keyed by `browser_id`
(migration 109). The browser_id comes from `BrowserIdMiddleware`, so
the caller's identity is implicit — there is no body-supplied
identifier. `image_updated_at` doubles as the cache-buster: the FE
constructs `/api/users/by-browser-id/<id>/image?v=<isoTimestamp>` so
a freshly-updated image invalidates browser + CDN caches without
changing the user's identity.

Trust model matches the groups endpoints: anyone with the URL of an
existing image may fetch it; only the holder of a browser_id may
write/clear the image for that id. The middleware echoes browser_id
from the request header, so this effectively gates writes by physical
possession of the browser (or its localStorage).
"""

from __future__ import annotations

import base64
import binascii

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from database import get_db
from middleware import browser_id_from_request as _browser_id


class UserImageRequest(BaseModel):
    """`POST /api/users/me/image` body.

    `image_base64` is the FE-cropped square image (JPEG or PNG) encoded
    as base64 with no `data:` prefix. `mime_type` must be `image/jpeg`
    or `image/png`. Max decoded size: `MAX_IMAGE_BYTES`. Same contract
    as the matching groups endpoint.
    """

    image_base64: str
    mime_type: str


class UserImageResponse(BaseModel):
    """Returned by `POST` / `DELETE /api/users/me/image`."""

    browser_id: str
    image_updated_at: str | None = None


class UserProfileResponse(BaseModel):
    """Returned by `GET /api/users/me/profile`. Returns null timestamp
    when the user has not uploaded an image. The FE uses this to decide
    whether to render a `/by-browser-id/<id>/image` URL or fall through
    to initials."""

    browser_id: str
    image_updated_at: str | None = None


# Mirrors `MAX_IMAGE_BYTES` in routers/groups.py. 5 MiB is well above the
# FE-cropped ~100KB target but bounded enough that a pathological client
# can't OOM the 1GB droplet's API container.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png"})


router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me/profile", response_model=UserProfileResponse)
def get_my_profile(request: Request):
    """Current browser's profile metadata.

    Returns the caller's browser_id (so the FE can confirm middleware
    handshake completed) and image_updated_at (null when no image is
    set). Idempotent and side-effect free — does not create the
    user_profiles row.
    """
    browser_id = _browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=400, detail="browser_id required")
    with get_db() as conn:
        row = conn.execute(
            "SELECT image_updated_at FROM user_profiles WHERE browser_id = %(id)s",
            {"id": browser_id},
        ).fetchone()
    image_updated_at = (
        row.get("image_updated_at") if row and row.get("image_updated_at") else None
    )
    return UserProfileResponse(
        browser_id=browser_id,
        image_updated_at=image_updated_at.isoformat() if image_updated_at else None,
    )


@router.post("/me/image", response_model=UserImageResponse)
def upload_my_image(request: Request, req: UserImageRequest):
    """Set the caller's profile avatar image.

    Body: base64-encoded JPEG or PNG bytes (already square-cropped by
    the FE — the server does NOT crop or resize). Replaces any previous
    image for this browser_id. Stamps `image_updated_at` so the FE
    knows to invalidate its `/api/users/by-browser-id/<id>/image?v=<ts>`
    cache.

    `INSERT ... ON CONFLICT` so the same endpoint covers both first
    upload and replacement.
    """
    browser_id = _browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=400, detail="browser_id required")
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
        row = conn.execute(
            """
            INSERT INTO user_profiles (browser_id, image_data, image_mime_type, image_updated_at)
            VALUES (%(id)s, %(data)s, %(mime)s, NOW())
            ON CONFLICT (browser_id) DO UPDATE
              SET image_data = EXCLUDED.image_data,
                  image_mime_type = EXCLUDED.image_mime_type,
                  image_updated_at = EXCLUDED.image_updated_at
            RETURNING image_updated_at
            """,
            {"id": browser_id, "data": image_bytes, "mime": req.mime_type},
        ).fetchone()
    image_updated_at = row.get("image_updated_at") if row else None
    return UserImageResponse(
        browser_id=browser_id,
        image_updated_at=image_updated_at.isoformat() if image_updated_at else None,
    )


@router.delete("/me/image", response_model=UserImageResponse)
def delete_my_image(request: Request):
    """Clear the caller's profile avatar image. Idempotent — a 200 is
    returned even if no image was set, so the FE doesn't have to
    distinguish "was set" from "wasn't set" to reset state.
    `image_updated_at` is set to NULL so the FE falls back to initials.
    """
    browser_id = _browser_id(request)
    if not browser_id:
        raise HTTPException(status_code=400, detail="browser_id required")
    with get_db() as conn:
        conn.execute(
            """
            UPDATE user_profiles
               SET image_data = NULL,
                   image_mime_type = NULL,
                   image_updated_at = NULL
             WHERE browser_id = %(id)s
            """,
            {"id": browser_id},
        )
    return UserImageResponse(browser_id=browser_id, image_updated_at=None)


@router.get("/by-browser-id/{browser_id}/image")
def get_user_image(browser_id: str):
    """Serve a user's avatar image bytes with the stored MIME type.

    Public — no membership / browser-id check. The browser_id is the
    URL token, so anyone holding a valid id can fetch the image (same
    trust model as the groups image endpoint). Cached via the FE's
    `?v=<image_updated_at>` query string with the immutable cache-
    control header so a given URL never re-fetches once received
    (the next change bumps the timestamp, producing a new URL).

    Returns 404 when no image is set (FE renders fallback initials).
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT image_data, image_mime_type FROM user_profiles WHERE browser_id = %(id)s",
            {"id": browser_id},
        ).fetchone()
    if not row or not row.get("image_data"):
        raise HTTPException(status_code=404, detail="Image not set")
    return Response(
        content=bytes(row["image_data"]),
        media_type=row.get("image_mime_type") or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
