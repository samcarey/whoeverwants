"""Auth endpoints — Phase A (foundation) + Phase B (magic link).

`POST /api/auth/magic-link/request`  start magic-link sign-in
`POST /api/auth/magic-link/verify`   consume token, issue session
`GET  /api/auth/me`                   resolve current session → user profile
`POST /api/auth/sign-out`             revoke current session, unlink browser

Phases C (Apple/Google OAuth) and D (Passkey) will add sibling routes
that share `services/auth.py`'s `resolve_or_merge_user` +
`issue_session` + `link_browser_to_user` helpers.

Identity resolution for the current request is done by
`IdentityMiddleware` in `server/middleware.py` (sets
`request.state.user_id` from the Authorization header). This router
uses the middleware-resolved value rather than re-resolving locally.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from database import get_db
from middleware import (
    browser_id_from_request as _browser_id,
    session_token_from_request as _session_token,
    user_id_from_request as _user_id,
)
from services.auth import (
    consume_magic_link,
    email_throttled,
    is_valid_email,
    issue_magic_link,
    issue_session,
    link_browser_to_user,
    load_user_profile,
    normalize_email,
    resolve_or_merge_user,
    revoke_session,
    unlink_browser,
)
from services.email import email_configured, send_magic_link

log = logging.getLogger("auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class MagicLinkRequestBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class MagicLinkRequestResponse(BaseModel):
    """Always identical regardless of whether the email is registered —
    no user enumeration via response shape. `email_configured` lets the
    FE warn users on dev tiers where Resend isn't wired up that the
    email won't actually be delivered (look at API logs instead)."""

    accepted: bool
    email_configured: bool


class MagicLinkVerifyBody(BaseModel):
    token: str = Field(min_length=8, max_length=128)


class UserSummary(BaseModel):
    user_id: str
    email: str | None
    providers: list[str]
    created_at: datetime


class SessionResponse(BaseModel):
    session_token: str
    expires_at: datetime
    user: UserSummary


# ---------------------------------------------------------------------------
# FE-origin resolution for the magic-link URL
# ---------------------------------------------------------------------------
#
# The link in the email opens the FE route /auth/verify?token=... We want
# the link to land on the same tier the user is signing in from:
#   prod      → https://whoeverwants.com
#   canary    → https://latest.whoeverwants.com
#   dev branch → https://<slug>.dev.whoeverwants.com
#
# The request's Origin header is the natural signal — it's set by every
# major browser on cross-origin fetches and matches the FE host that
# initiated the request. Validated against an allowlist so a hostile
# Origin doesn't end up in the email body (otherwise users would click
# links to attacker-controlled domains).

_ALLOWED_ORIGIN_PATTERNS = [
    re.compile(r"^https://whoeverwants\.com$"),
    re.compile(r"^https://latest\.whoeverwants\.com$"),
    re.compile(r"^https://[a-z0-9-]+\.dev\.whoeverwants\.com$"),
    re.compile(r"^http://localhost:\d+$"),
    re.compile(r"^http://127\.0\.0\.1:\d+$"),
]
_DEFAULT_FE_ORIGIN = os.environ.get("FE_DEFAULT_ORIGIN", "https://whoeverwants.com")


def _resolve_fe_origin(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin and any(p.match(origin) for p in _ALLOWED_ORIGIN_PATTERNS):
        return origin
    return _DEFAULT_FE_ORIGIN


# ---------------------------------------------------------------------------
# Magic link
# ---------------------------------------------------------------------------


@router.post(
    "/magic-link/request",
    response_model=MagicLinkRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_magic_link(req: MagicLinkRequestBody, request: Request):
    """Send a magic-link email. Response is identical for "valid email"
    and "validation error suppressed" cases — no enumeration via shape
    or timing.

    Validation errors that the user can act on (malformed email) are
    returned as 400. Throttling and email-send failures DO NOT 4xx —
    they map to `accepted=false` if visible, but we currently always
    return `accepted=true` so the FE flow is uniform.
    """
    if not is_valid_email(req.email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    email = normalize_email(req.email)
    browser_id = _browser_id(request)
    fe_origin = _resolve_fe_origin(request)

    with get_db() as conn:
        if email_throttled(conn, email):
            # Silently treat as accepted — don't tell the requester that
            # the throttle fired (would leak existence of a recent
            # request). Server-side log only.
            log.info("Magic-link request throttled for %s", email)
            return MagicLinkRequestResponse(
                accepted=True, email_configured=email_configured()
            )

        issued = issue_magic_link(conn, email=email, browser_id=browser_id)

    magic_url = f"{fe_origin}/auth/verify?token={issued.token}"
    # Don't block on email send result — return 202 regardless. The user
    # retries via the UI if their inbox stays empty; server logs surface
    # any send failures.
    ok = send_magic_link(to_email=email, magic_url=magic_url)
    if not ok:
        log.error("Magic-link email send failed for %s", email)

    return MagicLinkRequestResponse(
        accepted=True, email_configured=email_configured()
    )


@router.post(
    "/magic-link/verify",
    response_model=SessionResponse,
)
def verify_magic_link(req: MagicLinkVerifyBody, request: Request):
    """Consume a magic-link token and issue a session. The browser_id
    used for the user_browsers link comes from the VERIFY request's
    headers — not the magic_link_tokens row's browser_id — so signing
    in by clicking the email on a different device than the one that
    requested the link links the CLICKING device, which matches user
    intent."""
    browser_id = _browser_id(request)
    user_agent = request.headers.get("user-agent")

    with get_db() as conn:
        consumed = consume_magic_link(conn, req.token)
        if not consumed:
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired sign-in link",
            )

        resolved = resolve_or_merge_user(
            conn,
            provider="email",
            provider_user_id=consumed.email,
            email=consumed.email,
        )
        link_browser_to_user(
            conn, user_id=resolved.user_id, browser_id=browser_id
        )
        session = issue_session(
            conn,
            user_id=resolved.user_id,
            browser_id=browser_id,
            user_agent=user_agent,
        )
        profile = load_user_profile(conn, resolved.user_id)

    assert profile is not None, "profile must exist immediately after issue"
    return SessionResponse(
        session_token=session.token,
        expires_at=session.expires_at,
        user=UserSummary(
            user_id=profile.user_id,
            email=profile.email,
            providers=profile.providers,
            created_at=profile.created_at,
        ),
    )


# ---------------------------------------------------------------------------
# Profile + sign-out
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserSummary)
def get_me(request: Request):
    """Resolve the current session to a user profile, or 401."""
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not signed in",
        )
    with get_db() as conn:
        profile = load_user_profile(conn, user_id)
    if not profile:
        # Session resolves to a user that no longer exists (deleted
        # account). Treat as signed out.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
        )
    return UserSummary(
        user_id=profile.user_id,
        email=profile.email,
        providers=profile.providers,
        created_at=profile.created_at,
    )


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(request: Request):
    """Revoke the current session and drop the browser → user link on
    this device. Idempotent — calling without an active session 204s."""
    token = _session_token(request)
    browser_id = _browser_id(request)
    with get_db() as conn:
        if token:
            revoke_session(conn, token)
        unlink_browser(conn, browser_id=browser_id)
