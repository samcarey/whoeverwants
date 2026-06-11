"""Auth endpoints — Phase A (foundation) + Phase B (magic link)
+ Phase C (Apple / Google OAuth) + Phase D (Passkey / WebAuthn).

`POST /api/auth/magic-link/request`            start magic-link sign-in
`POST /api/auth/magic-link/verify`             consume token, issue session
`POST /api/auth/oauth/google`                  verify Google ID token, issue session
`POST /api/auth/oauth/apple`                   verify Apple ID token, issue session
`POST /api/auth/passkey/registration/options`  start passkey registration
`POST /api/auth/passkey/registration/verify`   finish passkey registration
`POST /api/auth/passkey/authentication/options` start passkey sign-in
`POST /api/auth/passkey/authentication/verify`  finish passkey sign-in, issue session
`GET  /api/auth/passkeys`                       list current user's passkeys
`DELETE /api/auth/passkeys/{credential_id}`     drop a passkey
`PATCH /api/auth/passkeys/{credential_id}`      rename a passkey
`GET  /api/auth/providers`                      list which sign-in methods are wired up
`GET  /api/auth/me`                              resolve current session → user profile
`POST /api/auth/sign-out`                        revoke current session, unlink browser
`POST /api/auth/recovery-email/request`         Phase I: send "confirm recovery email" link
`POST /api/auth/recovery-email/verify`          Phase I: attach the confirmed email identity
`DELETE /api/auth/me`                            Phase I: delete the signed-in account

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
    CompletedSignIn,
    attach_email_identity,
    attach_oauth_identity,
    complete_sign_in,
    consume_magic_link,
    consume_recovery_email_token,
    create_name_only_account,
    delete_user_account,
    email_throttled,
    is_valid_email,
    issue_magic_link,
    issue_session,
    link_browser_to_user,
    load_user_profile,
    lookup_session_user_id,
    merge_in_other_account,
    normalize_email,
    peek_recovery_email_token,
    revoke_session,
    set_recovery_reminder_dismissed,
    unlink_browser,
    update_user_badge_settings,
    update_user_display_name,
    update_user_vote_reminder,
    user_has_email_identity,
)
from services.validation import validate_user_name, validate_vote_reminder
from services.email import email_configured, send_magic_link, send_recovery_email
from services.oauth import (
    OAuthVerificationError,
    apple_configured,
    google_configured,
    verify_apple_id_token,
    verify_google_id_token,
)
from services.passkeys import (
    PasskeyError,
    build_authentication_options,
    build_registration_options,
    complete_authentication,
    complete_registration,
    delete_passkey,
    list_user_passkeys,
    passkey_configured,
    rename_passkey,
)

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
    # Account-tied display name. Mirrored down to the FE's local profile on
    # sign-in; pushed back up via POST /me/name when changed while signed in.
    name: str | None = None
    # Account-synced app-icon badge preferences (migration 121). Ride every
    # sign-in response + /me so the FE's local cache + client-side badge
    # resync stay in lockstep with the account.
    badge_todo_mode: bool = True
    badge_on_voting_open: bool = True
    badge_on_results: bool = True
    # Migration 123: drives the home-page "add a recovery method" banner.
    # True = the user dismissed the nudge. The FE additionally gates the
    # banner on the account lacking an email/OAuth recovery identity.
    recovery_reminder_dismissed: bool = False
    # Migration 136: account-synced "remind me to vote" preference. Rides
    # every sign-in response + /me so the FE's local mirror stays in lockstep.
    vote_reminder: str = "0.2x"


def _summary_from_profile(profile) -> "UserSummary":
    """Single profile→UserSummary mapping so the sign-in / me / name / badge
    endpoints can't drift on which fields they surface."""
    return UserSummary(
        user_id=profile.user_id,
        email=profile.email,
        providers=profile.providers,
        created_at=profile.created_at,
        name=profile.display_name,
        badge_todo_mode=profile.badge_todo_mode,
        badge_on_voting_open=profile.badge_on_voting_open,
        badge_on_results=profile.badge_on_results,
        recovery_reminder_dismissed=profile.recovery_reminder_dismissed,
        vote_reminder=profile.vote_reminder,
    )


class SessionResponse(BaseModel):
    session_token: str
    expires_at: datetime
    user: UserSummary


class OAuthSignInBody(BaseModel):
    """ID-token bearing payload from a successful OAuth flow on the FE.

    Both Google and Apple use the same shape: a single `id_token` JWT
    signed by the provider. The verifier in `services/oauth.py` checks
    signature + issuer + audience + expiry against the provider's JWKS
    and pulls `sub` (stable user id) + `email` (when present and
    verified) from the claims. The FE never sends user-controlled
    identity strings here — everything the server trusts comes from the
    JWT itself.
    """

    id_token: str = Field(min_length=32, max_length=4096)
    # Explicit two-account merge intent (set by Settings → "Combine another
    # account"). When the signed-in caller verifies an identity owned by a
    # DIFFERENT account, fold that account into the current one instead of
    # 409-ing. Ignored when not signed in. Default false so ordinary sign-in /
    # link behavior is unchanged.
    merge: bool = False


class ProvidersResponse(BaseModel):
    """Which sign-in providers this API tier has configured. The FE
    hides OAuth / passkey buttons when the matching provider is
    unconfigured so users don't tap an inert button. Email is always
    available (the Resend fallback logs to stdout when RESEND_API_KEY
    is unset). Passkeys are first-party (no third-party config) and
    default on; gated behind `PASSKEYS_DISABLED=1` for tiers that want
    to hide them."""

    email: bool
    google: bool
    apple: bool
    passkey: bool


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

# `services.fe_origin.resolve_fe_origin` is the canonical FE origin
# allowlist now — same logic, shared across magic-link + invite URL
# minting. Kept as a thin alias here so existing call sites in this
# router keep working without a churnful rename.
def _resolve_fe_origin(request: Request) -> str:
    from services.fe_origin import resolve_fe_origin as _resolve
    return _resolve(request)


def is_prod_origin(request: Request) -> bool:
    """Thin alias so dev-only endpoints in this router can gate on the
    shared `services.fe_origin.is_prod_origin` without re-importing it at
    each call site."""
    from services.fe_origin import is_prod_origin as _is_prod
    return _is_prod(request)


def _resolve_rp_id(request: Request) -> str:
    """Derive the WebAuthn RP id from the validated FE origin. RP id is
    the hostname (`whoeverwants.com`, `latest.whoeverwants.com`,
    `<slug>.dev.whoeverwants.com`, `localhost`), no scheme, no port.

    Passkeys are scoped to the RP id, so a key registered against
    `whoeverwants.com` cannot sign in on `latest.whoeverwants.com` and
    vice versa. The RP id MUST match the FE's actual hostname at both
    registration AND authentication time.
    """
    origin = _resolve_fe_origin(request)
    # Strip scheme and any port. Origin format is always `<scheme>://<host>(:port)?`.
    if "://" in origin:
        host_with_port = origin.split("://", 1)[1]
    else:
        host_with_port = origin
    host = host_with_port.split(":", 1)[0]
    return host


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


def _signin_response(completed: CompletedSignIn) -> SessionResponse:
    """Wrap `services.auth.CompletedSignIn` in the FE-facing response
    shape. Every sign-in route — magic-link verify, OAuth providers,
    eventual passkey — funnels through here so they don't drift."""
    return SessionResponse(
        session_token=completed.session.token,
        expires_at=completed.session.expires_at,
        user=_summary_from_profile(completed.profile),
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
    with get_db() as conn:
        consumed = consume_magic_link(conn, req.token)
        if not consumed:
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired sign-in link",
            )
        completed = complete_sign_in(
            conn,
            provider="email",
            provider_user_id=consumed.email,
            email=consumed.email,
            browser_id=_browser_id(request),
            user_agent=request.headers.get("user-agent"),
        )
    return _signin_response(completed)


class CreateNameAccountBody(BaseModel):
    name: str = Field(min_length=1, max_length=50)


@router.post("/account/name", response_model=SessionResponse)
def create_account_with_name(req: CreateNameAccountBody, request: Request):
    """Create a recovery-less account from just a name (or, when already
    signed in, set the name on the existing account). Issues a session
    either way so the FE persists the bearer token via `persistSignIn`.

    This is the "provide a name to continue" path of the unified gating
    modal — the alternative to a full sign-in. The resulting account has
    no `user_identities` row (no way to recover it if the device is
    lost), so the FE surfaces a home-page banner nudging the user to add
    a sign-in method afterwards (gated on `recovery_reminder_dismissed`).

    The name runs through the shared `validate_user_name` (same rules as
    poll creator/voter names) so a bypassed FE can't store garbage.
    """
    display_name = validate_user_name(req.name, field="name")
    browser_id = _browser_id(request)
    user_agent = request.headers.get("user-agent")
    current_user_id = _user_id(request)
    with get_db() as conn:
        if current_user_id:
            # Already signed in (e.g. a passkey-only account that never
            # set a name): name the existing account rather than minting
            # a new one. A fresh session is issued for response uniformity;
            # the prior token stays valid until it expires.
            update_user_display_name(
                conn, user_id=current_user_id, display_name=display_name
            )
            session = issue_session(
                conn,
                user_id=current_user_id,
                browser_id=browser_id,
                user_agent=user_agent,
            )
            profile = load_user_profile(conn, current_user_id)
            assert profile is not None
            completed = CompletedSignIn(session=session, profile=profile)
        else:
            completed = create_name_only_account(
                conn,
                display_name=display_name,
                browser_id=browser_id,
                user_agent=user_agent,
            )
    return _signin_response(completed)


# ---------------------------------------------------------------------------
# Dev-only instant sign-in links (demo helper)
# ---------------------------------------------------------------------------
#
# Lets a developer (or Claude, when assembling a demo) mint a throwaway
# account and hand back a URL that signs the recipient straight into it
# with no prompts — so a specific app state / context can be shared as a
# single click. Two endpoints:
#
#   POST /api/auth/dev/instant-link   (caller: the developer, via curl)
#     mints a recovery-less account, returns a ready-to-send URL whose
#     `?token` carries the account's session token + the live session
#     token itself (so the caller can keep acting as the account to seed
#     polls / votes before sending the link).
#   POST /api/auth/instant/adopt      (caller: the recipient's browser)
#     validates the session token from the URL, LINKS the recipient's
#     browser to the account (so its browser-keyed group memberships +
#     pre-seeded polls become visible — `load_user_visibility` unions
#     across every browser linked to the user), and returns the profile.
#
# Both are gated to non-production tiers via `is_prod_origin`: a real
# prod request (Origin https://whoeverwants.com, or no recognized
# Origin) gets 503. This keeps the "sign a browser in from a URL token"
# capability (a login-CSRF vector) off production entirely; on dev /
# canary it's a convenience with a throwaway-data threat model.


class DevInstantLinkBody(BaseModel):
    # Defaults to a generic demo name so a bare call works; overridable so
    # the demo account reads like a real participant.
    name: str = Field(default="Demo User", min_length=1, max_length=50)
    # Optional same-origin path to land on after sign-in (e.g. "/g/~abc").
    # Validated server-side to a relative path; defaults to "/".
    next: str | None = None


class DevInstantLinkResponse(BaseModel):
    url: str
    session_token: str
    expires_at: datetime
    user_id: str
    name: str | None
    # Echoed so the caller knows which browser_id the account was linked
    # to — seed the demo's polls/votes with this SAME X-Browser-Id so the
    # membership rows land under a browser linked to the account.
    browser_id: str | None


class InstantAdoptBody(BaseModel):
    token: str = Field(min_length=16, max_length=128)


def _safe_relative_next(value: str | None) -> str:
    """Coerce a caller-supplied `next` to a same-origin relative path, or
    "/". Rejects absolute URLs, protocol-relative `//host` (open-redirect
    vector), backslashes, and control chars. The FE page redirects to this
    value, so it must never escape the app's own origin."""
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    if "\\" in value or any(ord(c) < 0x20 for c in value):
        return "/"
    return value


@router.post("/dev/instant-link", response_model=DevInstantLinkResponse)
def create_dev_instant_link(req: DevInstantLinkBody, request: Request):
    """DEV-ONLY: mint a fresh recovery-less account + return a URL that
    instantly signs the recipient into it. 503 on production (see the
    section comment above). The `session_token` is a real 90-day bearer —
    keep using it (with the returned `browser_id` as X-Browser-Id) to seed
    the account's polls/votes before sending `url`."""
    if is_prod_origin(request):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Instant sign-in links aren't available on this tier",
        )
    display_name = validate_user_name(req.name, field="name")
    next_path = _safe_relative_next(req.next)
    browser_id = _browser_id(request)
    fe_origin = _resolve_fe_origin(request)
    with get_db() as conn:
        completed = create_name_only_account(
            conn,
            display_name=display_name,
            browser_id=browser_id,
            user_agent=request.headers.get("user-agent"),
        )
    token = completed.session.token
    url = f"{fe_origin}/auth/instant?token={token}"
    if next_path != "/":
        from urllib.parse import quote

        url += f"&next={quote(next_path, safe='')}"
    return DevInstantLinkResponse(
        url=url,
        session_token=token,
        expires_at=completed.session.expires_at,
        user_id=completed.profile.user_id,
        name=completed.profile.display_name,
        browser_id=browser_id,
    )


@router.post("/instant/adopt", response_model=UserSummary)
def adopt_instant_session(req: InstantAdoptBody, request: Request):
    """DEV-ONLY companion to /dev/instant-link. The recipient's browser
    POSTs the session token carried in the instant-sign-in URL; we
    validate it, link THIS browser to the account, and return the
    profile. Linking is the load-bearing step — group memberships are
    browser-keyed and visibility unions across every browser linked to
    the user, so without it the recipient signs in but sees an empty
    account. 503 on production."""
    if is_prod_origin(request):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Instant sign-in links aren't available on this tier",
        )
    browser_id = _browser_id(request)
    with get_db() as conn:
        user_id = lookup_session_user_id(conn, req.token)
        if not user_id:
            raise HTTPException(
                status_code=400, detail="Invalid or expired sign-in link"
            )
        link_browser_to_user(conn, user_id=user_id, browser_id=browser_id)
        profile = load_user_profile(conn, user_id)
    if not profile:
        raise HTTPException(
            status_code=400, detail="Invalid or expired sign-in link"
        )
    return _summary_from_profile(profile)


# ---------------------------------------------------------------------------
# OAuth (Apple + Google) — Phase C
# ---------------------------------------------------------------------------
#
# Both endpoints share a flow:
#   1. FE drives the provider's sign-in UI and obtains an ID token.
#   2. FE POSTs the raw id_token here.
#   3. `services/oauth.py` verifies the token against the provider's
#      JWKS (signature + iss + aud + exp) and extracts the verified
#      identity.
#   4. `resolve_or_merge_user` keys the identity into our users table —
#      either matching the existing (provider, sub) row OR merging by
#      verified email across providers OR minting a new user.
#   5. `link_browser_to_user` + `issue_session` issue the bearer token
#      the FE stores for subsequent requests.
#
# The provider-specific logic lives in `services/oauth.py`; the router
# is intentionally thin so adding a third OIDC provider (e.g. Microsoft)
# would be a 10-line addition here.


def _handle_oauth_signin(
    *,
    request: Request,
    id_token: str,
    provider_label: str,
    configured: bool,
    verify: callable,
    merge: bool = False,
) -> SessionResponse:
    """Provider-agnostic OAuth handler. The verify endpoint passes its
    provider-specific `configured()` flag + `verify(id_token)` function;
    we handle the 503 / 400 / session-issuance rhythm uniformly. Adding
    a third OIDC provider is one route handler + one row of imports."""
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{provider_label} sign-in isn't available on this server",
        )
    try:
        identity = verify(id_token)
    except OAuthVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    current_user_id = _user_id(request)
    browser_id = _browser_id(request)
    user_agent = request.headers.get("user-agent")
    with get_db() as conn:
        if current_user_id:
            # Signed-in caller → LINK this provider identity to the
            # current account (e.g. a recovery-less name-only account
            # adding Google/Apple for recovery) rather than switching to
            # a separate account. Conflict when the identity (or its
            # verified email) already belongs to a different user — UNLESS
            # the caller asked to merge, in which case fold that other
            # account into the current one first (the bearer proves the
            # current account; this just-verified identity proves the other).
            if merge:
                merge_in_other_account(
                    conn,
                    current_user_id=current_user_id,
                    provider=identity.provider,
                    provider_user_id=identity.provider_user_id,
                    email=identity.email,
                )
            result = attach_oauth_identity(
                conn,
                user_id=current_user_id,
                provider=identity.provider,
                provider_user_id=identity.provider_user_id,
                email=identity.email,
            )
            if result == "conflict":
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"That {provider_label} account is already linked to "
                        "a different WhoeverWants account."
                    ),
                )
            session = issue_session(
                conn,
                user_id=current_user_id,
                browser_id=browser_id,
                user_agent=user_agent,
            )
            profile = load_user_profile(conn, current_user_id)
            assert profile is not None
            completed = CompletedSignIn(session=session, profile=profile)
        else:
            completed = complete_sign_in(
                conn,
                provider=identity.provider,
                provider_user_id=identity.provider_user_id,
                email=identity.email,
                browser_id=browser_id,
                user_agent=user_agent,
            )
    return _signin_response(completed)


@router.post("/oauth/google", response_model=SessionResponse)
def sign_in_with_google(req: OAuthSignInBody, request: Request):
    """Verify a Google OIDC ID token and issue a session.

    Failure cases:
      400 — token failed signature / issuer / audience / expiry checks,
            or `sub` is missing. Message is user-safe.
      503 — Google OAuth isn't configured on this API tier
            (GOOGLE_OAUTH_CLIENT_IDS unset). FE should hide the button
            but a stale bundle that still tries it gets a clear 503.
    """
    return _handle_oauth_signin(
        request=request,
        id_token=req.id_token,
        provider_label="Google",
        configured=google_configured(),
        verify=verify_google_id_token,
        merge=req.merge,
    )


@router.post("/oauth/apple", response_model=SessionResponse)
def sign_in_with_apple(req: OAuthSignInBody, request: Request):
    """Verify an Apple Sign In ID token and issue a session.

    Apple's quirks vs Google:
      - Email is sent on the FIRST sign-in only; subsequent sign-ins
        carry just `sub`. We resolve via the (provider, sub) lookup
        regardless of email presence, so repeat sign-ins still land on
        the right user.
      - "Hide my email" relays produce a stable per-(user, RP) proxy
        address. Treated identically to a real email for merge purposes.
      - Token is ES256-signed (not RS256). The verifier pins the
        algorithm to keep a hostile token from switching families.
    """
    return _handle_oauth_signin(
        request=request,
        id_token=req.id_token,
        provider_label="Apple",
        configured=apple_configured(),
        verify=verify_apple_id_token,
        merge=req.merge,
    )


# ---------------------------------------------------------------------------
# Providers (capability discovery)
# ---------------------------------------------------------------------------


@router.get("/providers", response_model=ProvidersResponse)
def get_providers():
    """Report which sign-in methods this API tier supports. Read by the
    FE on first paint of the sign-in modal so OAuth buttons can hide
    when the provider isn't configured (avoids the user tapping an
    inert button and seeing a 503)."""
    return ProvidersResponse(
        email=True,
        google=google_configured(),
        apple=apple_configured(),
        passkey=passkey_configured(),
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
    return _summary_from_profile(profile)


class UpdateNameBody(BaseModel):
    # Nullable / optional: a null or empty value clears the account name.
    name: str | None = None


@router.post("/me/name", response_model=UserSummary)
def update_my_name(req: UpdateNameBody, request: Request):
    """Set or clear the signed-in user's account-tied display name.

    The name is the source of truth once signed in: the FE mirrors it down
    to local storage on sign-in and calls this whenever the user changes
    their name while signed in. A null / empty / whitespace-only value
    clears it. Non-empty values run through the shared `validate_user_name`
    (same length + control-char rules as poll creator/voter names) so a
    bypassed FE can't store a garbage name."""
    user_id = _require_signed_in(request)
    raw = req.name
    if raw is not None and raw.strip():
        display_name: str | None = validate_user_name(raw, field="name")
    else:
        display_name = None
    with get_db() as conn:
        update_user_display_name(conn, user_id=user_id, display_name=display_name)
        profile = load_user_profile(conn, user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
        )
    return _summary_from_profile(profile)


class UpdateBadgeSettingsBody(BaseModel):
    badge_todo_mode: bool = True
    badge_on_voting_open: bool = True
    badge_on_results: bool = True


@router.post("/me/badge-settings", response_model=UserSummary)
def update_my_badge_settings(req: UpdateBadgeSettingsBody, request: Request):
    """Set the signed-in user's account-synced app-icon badge preferences.
    See the 'App-Icon Badge Model' section in CLAUDE.md. Signed-in only;
    anonymous browsers keep their preference in localStorage (client-side
    badge only)."""
    user_id = _require_signed_in(request)
    with get_db() as conn:
        update_user_badge_settings(
            conn,
            user_id=user_id,
            todo_mode=req.badge_todo_mode,
            on_voting_open=req.badge_on_voting_open,
            on_results=req.badge_on_results,
        )
        profile = load_user_profile(conn, user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
        )
    return _summary_from_profile(profile)


class UpdateVoteReminderBody(BaseModel):
    vote_reminder: str = "0.2x"


@router.post("/me/vote-reminder", response_model=UserSummary)
def update_my_vote_reminder(req: UpdateVoteReminderBody, request: Request):
    """Set the signed-in user's account-synced "remind me to vote" preference
    (migration 136). Signed-in only; anonymous browsers keep their preference
    in localStorage. The value is validated against VOTE_REMINDER_OPTIONS."""
    user_id = _require_signed_in(request)
    value = validate_vote_reminder(req.vote_reminder)
    with get_db() as conn:
        update_user_vote_reminder(conn, user_id=user_id, vote_reminder=value)
        profile = load_user_profile(conn, user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
        )
    return _summary_from_profile(profile)


class UpdateRecoveryReminderBody(BaseModel):
    dismissed: bool = True


@router.post("/me/recovery-reminder", response_model=UserSummary)
def update_my_recovery_reminder(req: UpdateRecoveryReminderBody, request: Request):
    """Set the signed-in user's "stop reminding me to add a recovery
    method" flag (migration 123). Drives the home-page recovery banner's
    "don't remind me again" toggle. Signed-in only."""
    user_id = _require_signed_in(request)
    with get_db() as conn:
        set_recovery_reminder_dismissed(
            conn, user_id=user_id, dismissed=req.dismissed
        )
        profile = load_user_profile(conn, user_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
        )
    return _summary_from_profile(profile)


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


# ---------------------------------------------------------------------------
# Account management — Phase I
# ---------------------------------------------------------------------------
#
# Recovery email: attach an email-provider identity to an account that
# lacks one (passkey-only, or OAuth-only). Two steps mirroring magic-link
# sign-in — request (mints a user_id-tagged token + sends the link) and
# verify (binds the email after confirming BOTH email control via the
# token AND account control via the session). See
# docs/auth-access-model.md → "Adding a recovery email".
#
# Account deletion: a single DELETE that cascades through every
# users(id) FK (declared with the right ON DELETE action in migrations
# 112–117). The browser keeps its group memberships + poll creator
# secrets and reverts to anonymous.


class RecoveryEmailRequestBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class RecoveryEmailRequestResponse(BaseModel):
    """Same shape as the magic-link request response. `accepted` is
    always True for valid input (no per-step leak about whether the
    address is already taken — that's surfaced at verify). `email_configured`
    lets the FE warn on dev tiers that the link only appears in API logs."""

    accepted: bool
    email_configured: bool


class RecoveryEmailVerifyBody(BaseModel):
    token: str = Field(min_length=8, max_length=128)


@router.post(
    "/recovery-email/request",
    response_model=RecoveryEmailRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_recovery_email(req: RecoveryEmailRequestBody, request: Request):
    """Send a "confirm your recovery email" link to `email`, tagged with
    the current user_id. Signed-in only.

    Rejects (400) when the account already has an email identity — this
    feature ADDS an email to an account that lacks one; adding a second
    email is out of scope (docs → "Out of scope for v1"). Throttling and
    "email belongs to someone else" do NOT 4xx here — the former returns
    a generic accepted, the latter is caught at verify so we don't leak
    which addresses are registered."""
    user_id = _require_signed_in(request)

    if not is_valid_email(req.email):
        raise HTTPException(status_code=400, detail="Invalid email address")

    email = normalize_email(req.email)
    browser_id = _browser_id(request)
    fe_origin = _resolve_fe_origin(request)

    with get_db() as conn:
        if user_has_email_identity(conn, user_id):
            raise HTTPException(
                status_code=400,
                detail="This account already has an email address.",
            )
        if email_throttled(conn, email):
            log.info("Recovery-email request throttled for %s", email)
            return RecoveryEmailRequestResponse(
                accepted=True, email_configured=email_configured()
            )
        issued = issue_magic_link(
            conn, email=email, browser_id=browser_id, user_id=user_id
        )

    verify_url = f"{fe_origin}/auth/recovery-email?token={issued.token}"
    ok = send_recovery_email(to_email=email, verify_url=verify_url)
    if not ok:
        log.error("Recovery-email send failed for %s", email)

    return RecoveryEmailRequestResponse(
        accepted=True, email_configured=email_configured()
    )


@router.post("/recovery-email/verify", response_model=UserSummary)
def verify_recovery_email(req: RecoveryEmailVerifyBody, request: Request):
    """Confirm a recovery-email link and bind the email to the account.

    Requires BOTH proofs at once (option (a) in the doc):
      * email control — possession of the token sent to that address;
      * account control — a signed-in session whose user_id matches the
        token's user_id (403 otherwise, so a stranger who received a
        mistyped link can't attach it to the requester's account).

    The token is PEEKED (not consumed) until both checks pass, so a
    wrong-device click or an already-taken email leaves it usable for a
    correct retry within its 15-minute TTL. No new session is issued —
    the user was already signed in to confirm.
    """
    user_id = _require_signed_in(request)
    with get_db() as conn:
        peeked = peek_recovery_email_token(conn, req.token)
        if not peeked:
            raise HTTPException(
                status_code=400, detail="Invalid or expired link"
            )
        if peeked.user_id != user_id:
            raise HTTPException(
                status_code=403,
                detail=(
                    "This link belongs to a different account. Open it on "
                    "the device where you're signed in to that account."
                ),
            )
        result = attach_email_identity(conn, user_id=user_id, email=peeked.email)
        if result == "conflict":
            raise HTTPException(
                status_code=409,
                detail="That email is already used by another account.",
            )
        # Both checks passed (attached OR already_linked) → burn the token.
        consume_recovery_email_token(conn, req.token)
        profile = load_user_profile(conn, user_id)
    if not profile:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return _summary_from_profile(profile)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(request: Request):
    """Delete the signed-in user's account. Cascades through every
    users(id) FK (sessions, identities, browser links, passkeys, this
    user's join requests + invites; groups they created keep working
    with creator_user_id NULL). The caller's browser reverts to
    anonymous — group memberships (browser-keyed) and poll creator
    secrets survive, so previously-created polls remain manageable from
    this browser."""
    user_id = _require_signed_in(request)
    with get_db() as conn:
        delete_user_account(conn, user_id)


# ---------------------------------------------------------------------------
# Passkey / WebAuthn — Phase D
# ---------------------------------------------------------------------------
#
# Two ceremonies, each a two-step request/response: registration adds a
# new credential to a signed-in user; authentication verifies an
# existing credential and issues a session. Both flow through
# `services/passkeys.py` so the ceremony logic + DB shape live in one
# place; this router is mostly auth + serialization.
#
# `_require_passkey_configured` mirrors the OAuth 503 pattern so a tier
# with `PASSKEYS_DISABLED=1` returns a clear failure mode rather than
# 500ing on the missing table reads.


class PasskeyRegistrationOptionsBody(BaseModel):
    """Registration options request is empty — the user_id is read from
    `request.state.user_id` and the browser_id from the middleware. A
    body field is reserved for future flexibility (e.g. a per-tier
    attestation policy override)."""


class PasskeyRegistrationVerifyBody(BaseModel):
    """The WebAuthn attestation as produced by
    `navigator.credentials.create()` and serialized via the FE
    helper. Pydantic accepts the raw dict; `services/passkeys.py`
    feeds it to `verify_registration_response` which does the actual
    structure validation. A user-supplied `name` is optional ("MacBook
    Touch ID")."""

    credential: dict
    name: str | None = None


class PasskeyAuthenticationOptionsBody(BaseModel):
    """No body — server uses the browser_id from middleware to scope
    the challenge."""


class PasskeyAuthenticationVerifyBody(BaseModel):
    """The WebAuthn assertion as produced by
    `navigator.credentials.get()`."""

    credential: dict
    # Explicit two-account merge intent — same semantics as the OAuth body.
    # When the signed-in caller authenticates a passkey owned by a DIFFERENT
    # account, fold that account into the current one. Ignored when not
    # signed in.
    merge: bool = False


class PasskeySummary(BaseModel):
    """One row in `GET /passkeys`. The credential_id is returned so the
    FE can target it for delete / rename; the public_key bytes are
    intentionally omitted (no use case)."""

    credential_id: str
    name: str | None
    aaguid: str | None
    transports: str | None
    created_at: datetime
    last_used_at: datetime


class PasskeyListResponse(BaseModel):
    passkeys: list[PasskeySummary]


class PasskeyRenameBody(BaseModel):
    name: str = Field(min_length=0, max_length=120)


def _require_passkey_configured():
    if not passkey_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Passkey sign-in isn't available on this server",
        )


def _require_signed_in(request: Request) -> str:
    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not signed in",
        )
    return user_id


def _require_browser_id(request: Request) -> str:
    """Most callers can pass `None` because the middleware mints one,
    but passkey ceremonies key the challenge cache on browser_id —
    abort defensively if it's missing rather than silently using an
    empty string as the PK."""
    bid = _browser_id(request)
    if not bid:
        raise HTTPException(status_code=400, detail="Missing browser id")
    return bid


@router.post("/passkey/registration/options")
def passkey_registration_options(
    _: PasskeyRegistrationOptionsBody, request: Request
) -> dict:
    """Mint a fresh registration challenge.

    Two paths converge here:
      - Signed-in caller → ADD a passkey to the existing account. The
        request's user_id is used; user_identities for that account get
        a new 'passkey' row at verify time.
      - Anonymous caller → CREATE a brand-new account with a passkey as
        its only identity. A fresh `users` row is minted up front so
        the registration options can encode the user_id correctly (the
        WebAuthn `user.id` field needs to be stable across the
        ceremony — the credential is bound to it). The matching
        session is issued at verify time, not here.

    Account-recovery tradeoff: an anonymous passkey-only account has
    no email on file, so losing the device with the only passkey means
    losing the account. The FE flow encourages adding a recovery
    email after the fact, but doesn't enforce it.
    """
    _require_passkey_configured()
    browser_id = _require_browser_id(request)
    rp_id = _resolve_rp_id(request)
    request_user_id = _user_id(request)
    with get_db() as conn:
        if request_user_id:
            profile = load_user_profile(conn, request_user_id)
            if not profile:
                # Bearer token resolves to a non-existent user. Treat
                # as anonymous and mint fresh below.
                request_user_id = None
        if request_user_id:
            user_id = request_user_id
            # The "user label" is what the OS shows in the passkey prompt
            # ("Sign in to WhoeverWants as <label>"). Prefer the user's
            # email; fall back to a short user_id slice.
            user_label = profile.email or f"User {user_id[:8]}"
        else:
            # Anonymous: mint a fresh user up front. The WebAuthn user.id
            # field needs to be stable across the ceremony — credentials
            # are bound to it on the authenticator — so we can't defer
            # the user creation to verify time without playing games with
            # placeholder ids. Abandoned ceremonies (user closes the
            # prompt before completing) leave an orphan row in `users`
            # with no `user_identities` row; periodic cleanup query is
            # `DELETE FROM users WHERE NOT EXISTS (SELECT 1 FROM
            # user_identities WHERE user_id = users.id)`.
            new_row = conn.execute(
                "INSERT INTO users DEFAULT VALUES RETURNING id"
            ).fetchone()
            user_id = str(new_row["id"])
            user_label = f"User {user_id[:8]}"
        options = build_registration_options(
            conn,
            user_id=user_id,
            user_label=user_label,
            browser_id=browser_id,
            rp_id=rp_id,
        )
    return options


@router.post("/passkey/registration/verify")
def passkey_registration_verify(
    req: PasskeyRegistrationVerifyBody, request: Request
) -> dict:
    """Verify the registration attestation and persist the credential.

    Returns `{credential_id, aaguid, transports, session?}`. The
    optional `session` is set when the request was anonymous (passkey-
    as-account-creation flow) — the FE then persists the bearer token
    so subsequent fetches are authenticated. For the signed-in
    "Add a passkey" path the session is null (the existing session
    keeps working).

    On any verification failure raises 400 with a user-safe message
    from `PasskeyError`.
    """
    _require_passkey_configured()
    browser_id = _require_browser_id(request)
    rp_id = _resolve_rp_id(request)
    origin = _resolve_fe_origin(request)
    request_user_id = _user_id(request)
    issued_session: SessionResponse | None = None
    try:
        with get_db() as conn:
            registered = complete_registration(
                conn,
                request_user_id=request_user_id,
                browser_id=browser_id,
                rp_id=rp_id,
                origin=origin,
                credential_json=req.credential,
                name=req.name,
            )
            # Anonymous registration → issue a session via the shared
            # complete_sign_in helper so the FE doesn't have to do a
            # separate sign-in round-trip. Uses the SAME provider /
            # provider_user_id as complete_registration writes (ON
            # CONFLICT DO NOTHING in resolve_or_merge_user makes the
            # duplicate identity-row insert a no-op).
            if not request_user_id:
                completed = complete_sign_in(
                    conn,
                    provider="passkey",
                    provider_user_id=registered.credential_id,
                    email=None,
                    browser_id=browser_id,
                    user_agent=request.headers.get("user-agent"),
                )
                issued_session = _signin_response(completed)
    except PasskeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "credential_id": registered.credential_id,
        "aaguid": registered.aaguid,
        "transports": registered.transports,
        "session": issued_session.model_dump(mode="json") if issued_session else None,
    }


@router.post("/passkey/authentication/options")
def passkey_authentication_options(
    _: PasskeyAuthenticationOptionsBody, request: Request
) -> dict:
    """Mint a fresh authentication challenge. Anonymous: the user_id
    isn't known until the assertion comes back. The browser_id from
    middleware scopes the challenge so a second tab on the same
    browser can't pick up another tab's in-flight challenge.
    """
    _require_passkey_configured()
    browser_id = _require_browser_id(request)
    rp_id = _resolve_rp_id(request)
    with get_db() as conn:
        options = build_authentication_options(
            conn,
            browser_id=browser_id,
            rp_id=rp_id,
        )
    return options


@router.post("/passkey/authentication/verify", response_model=SessionResponse)
def passkey_authentication_verify(
    req: PasskeyAuthenticationVerifyBody, request: Request
):
    """Verify the assertion and issue a session.

    Funnels through `complete_sign_in` with `provider='passkey'` and
    `provider_user_id=credential_id` — same account-merge rhythm as
    magic-link / OAuth so a user who already has the credential row
    (from a prior registration) signs into the same account here.
    `email=None` because passkey authentication doesn't carry one.
    """
    _require_passkey_configured()
    browser_id = _require_browser_id(request)
    rp_id = _resolve_rp_id(request)
    origin = _resolve_fe_origin(request)
    current_user_id = _user_id(request)
    try:
        with get_db() as conn:
            authed = complete_authentication(
                conn,
                browser_id=browser_id,
                rp_id=rp_id,
                origin=origin,
                credential_json=req.credential,
            )
            if current_user_id and req.merge:
                # Explicit merge: the just-verified passkey proves the OTHER
                # account; the bearer proves the current one. Fold the other
                # into the current (the merge moves the credential onto it),
                # then keep the caller on their current account.
                merge_in_other_account(
                    conn,
                    current_user_id=current_user_id,
                    provider="passkey",
                    provider_user_id=authed.credential_id,
                    email=None,
                )
                session = issue_session(
                    conn,
                    user_id=current_user_id,
                    browser_id=browser_id,
                    user_agent=request.headers.get("user-agent"),
                )
                profile = load_user_profile(conn, current_user_id)
                assert profile is not None
                completed = CompletedSignIn(session=session, profile=profile)
            else:
                completed = complete_sign_in(
                    conn,
                    provider="passkey",
                    provider_user_id=authed.credential_id,
                    email=None,
                    browser_id=browser_id,
                    user_agent=request.headers.get("user-agent"),
                )
    except PasskeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _signin_response(completed)


@router.get("/passkeys", response_model=PasskeyListResponse)
def list_passkeys(request: Request):
    """List the signed-in user's registered passkeys. Used by the
    Settings page to show "you have N passkeys" with delete + rename
    affordances. Public-key bytes are intentionally not surfaced.

    Gated on `passkey_configured()` like the ceremony endpoints — a
    tier with `PASSKEYS_DISABLED=1` returns 503 across all passkey
    routes (not just registration/authentication) so the operator's
    kill switch actually kills the feature."""
    _require_passkey_configured()
    user_id = _require_signed_in(request)
    with get_db() as conn:
        rows = list_user_passkeys(conn, user_id)
    return PasskeyListResponse(
        passkeys=[
            PasskeySummary(
                credential_id=r.credential_id,
                name=r.name,
                aaguid=r.aaguid,
                transports=r.transports,
                created_at=r.created_at,
                last_used_at=r.last_used_at,
            )
            for r in rows
        ]
    )


@router.delete(
    "/passkeys/{credential_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_user_passkey(credential_id: str, request: Request):
    """Drop a passkey by credential_id. Scoped to the signed-in user
    via the WHERE in `delete_passkey` — a stranger can't drop someone
    else's credential via id guessing. 404s when the row doesn't exist
    (or belongs to someone else); 204s on successful delete.

    Refuses to remove the user's LAST sign-in method. A passkey-only
    account (created via the anonymous `Create with a passkey` flow)
    can otherwise lock itself out by deleting its single credential —
    no email / OAuth to recover, no path back in. The check counts
    user_identities rows excluding the one we're about to delete; 0
    means deletion would orphan the account."""
    _require_passkey_configured()
    user_id = _require_signed_in(request)
    with get_db() as conn:
        # Last-identity safeguard. Refuse the delete if there are no
        # other identities for this user.
        remaining = conn.execute(
            """
            SELECT 1 FROM user_identities
             WHERE user_id = %(u)s::uuid
               AND NOT (provider = 'passkey' AND provider_user_id = %(c)s)
             LIMIT 1
            """,
            {"u": user_id, "c": credential_id},
        ).fetchone()
        if not remaining:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Can't remove your only sign-in method. Add an email "
                    "or another passkey first."
                ),
            )
        ok = delete_passkey(conn, user_id=user_id, credential_id=credential_id)
        if ok:
            # Mirror-row in user_identities was inserted alongside
            # the credential at registration; remove it here so the
            # provider list stays consistent and a future
            # re-registration of a (cryptographically unrelated)
            # credential doesn't have to fight a dead row.
            conn.execute(
                """
                DELETE FROM user_identities
                 WHERE provider = 'passkey'
                   AND provider_user_id = %(c)s
                   AND user_id = %(u)s::uuid
                """,
                {"c": credential_id, "u": user_id},
            )
    if not ok:
        raise HTTPException(status_code=404, detail="Passkey not found")


@router.patch("/passkeys/{credential_id}")
def rename_user_passkey(
    credential_id: str, req: PasskeyRenameBody, request: Request
):
    """Rename a passkey ("YubiKey" → "Office YubiKey"). Same identity
    gate as delete. Empty string is accepted and clears the name."""
    _require_passkey_configured()
    user_id = _require_signed_in(request)
    with get_db() as conn:
        ok = rename_passkey(
            conn, user_id=user_id, credential_id=credential_id, name=req.name
        )
    if not ok:
        raise HTTPException(status_code=404, detail="Passkey not found")
    return {"credential_id": credential_id, "name": req.name.strip()[:120] or None}


# ---------------------------------------------------------------------------
# Phase G: invite redemption
# ---------------------------------------------------------------------------
#
# Lives on /api/auth (not /api/groups/<route>/invites/<token>/redeem)
# because the redeem flow is keyed solely on the raw token — there's
# no group route_id in the URL the joiner clicked. The token + the
# session token are the two inputs; the group falls out of the lookup.


class InviteRedeemResponse(BaseModel):
    """Result of `POST /api/auth/invites/{token}/redeem`. The FE uses
    `group_short_id` (preferred) or `group_id` (fallback) to build the
    redirect URL; when `target_poll_short_id` is set, the redirect goes
    deep into the poll detail page. `already_member` lets the FE
    differentiate "you just joined" toast vs "you were already here"
    no-op so it doesn't double-show a welcome flow."""

    group_id: str
    group_short_id: str | None
    target_poll_id: str | None
    target_poll_short_id: str | None
    already_member: bool


class InvitePreviewResponse(BaseModel):
    """Result of `GET /api/auth/invites/{token}/preview`. `group_name`
    is None when the group has no title override and no named
    participants — the FE shell falls back to generic copy."""

    group_name: str | None


@router.get(
    "/invites/{token}/preview",
    response_model=InvitePreviewResponse,
)
def get_invite_preview(token: str):
    """Identity-free link-preview metadata for an invite URL.

    Mirrors `GET /api/groups/by-route-id/{id}/preview`'s trust model:
    crawlers (iMessage, Slack, ...) hit the URL with no browser
    identity, so there's no auth gate and no membership write. The
    unguessable token is the capability; the only data returned is the
    group's display name. Read-only — fetching a preview never
    consumes a use on a single-use invite. 404 on invalid / expired /
    revoked / fully-used tokens (indistinguishable, same as redeem).
    """
    from services.invites import invite_group_name

    with get_db() as conn:
        preview = invite_group_name(conn, token)
    if preview is None:
        raise HTTPException(
            status_code=404, detail="Invite invalid or expired"
        )
    return InvitePreviewResponse(group_name=preview.group_name)


@router.post(
    "/invites/{token}/redeem",
    response_model=InviteRedeemResponse,
)
def redeem_group_invite(token: str, request: Request):
    """Phase G: consume an invite token + write membership.

    Requires user_id (401 anonymous). Returns 404 on invalid /
    expired / revoked / fully-used tokens — indistinguishable to the
    caller (no leak about WHY redemption failed).

    Already-a-member callers get a 200 with `already_member=true`
    instead of an error. Same row count after their click as before
    — they can re-share an invite they previously redeemed without
    surprises.
    """
    # Local import: services/invites.py uses services/auth.py's
    # hash_token; eager import here is fine but the deferred form
    # keeps router imports tidy.
    from services.invites import redeem_invite

    user_id = _user_id(request)
    if not user_id:
        raise HTTPException(
            status_code=401, detail="Sign in to redeem invites"
        )

    with get_db() as conn:
        result = redeem_invite(conn, token, user_id)
    if result is None:
        raise HTTPException(
            status_code=404, detail="Invite invalid or expired"
        )
    return InviteRedeemResponse(
        group_id=result.group_id,
        group_short_id=result.group_short_id,
        target_poll_id=result.target_poll_id,
        target_poll_short_id=result.target_poll_short_id,
        already_member=result.already_member,
    )
