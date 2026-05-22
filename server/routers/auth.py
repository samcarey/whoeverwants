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
    complete_sign_in,
    consume_magic_link,
    email_throttled,
    is_valid_email,
    issue_magic_link,
    load_user_profile,
    normalize_email,
    revoke_session,
    unlink_browser,
)
from services.email import email_configured, send_magic_link
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
        user=UserSummary(
            user_id=completed.profile.user_id,
            email=completed.profile.email,
            providers=completed.profile.providers,
            created_at=completed.profile.created_at,
        ),
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
    with get_db() as conn:
        completed = complete_sign_in(
            conn,
            provider=identity.provider,
            provider_user_id=identity.provider_user_id,
            email=identity.email,
            browser_id=_browser_id(request),
            user_agent=request.headers.get("user-agent"),
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
    try:
        with get_db() as conn:
            authed = complete_authentication(
                conn,
                browser_id=browser_id,
                rp_id=rp_id,
                origin=origin,
                credential_json=req.credential,
            )
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
