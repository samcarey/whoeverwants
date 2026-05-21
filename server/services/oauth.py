"""OAuth ID-token verification for Phase C (Apple + Google sign-in).

Apple and Google both issue OpenID Connect ID tokens — JWTs signed by the
provider's private key, with claims that include a stable subject (`sub`),
the user's email (when scope grants it), and a verified-email flag. The
server verifies the signature against the provider's published JWKS (rotated
public keys), validates the issuer / audience / expiry, and trusts the
resulting claims as proof of identity.

Both providers expose JWKS via standard endpoints; PyJWT's `PyJWKClient`
caches the keys and handles rotation transparently. We pin the algorithms
list to `RS256` for both providers so a hostile token can't switch to a
weaker family. (Apple's Sign In with Apple documentation references
ES256 historically, but the live JWKS at https://appleid.apple.com/auth/keys
publishes ONLY RS256 keys — Apple issues RS256-signed tokens in practice.
Verified empirically; the docs are stale.)

`verify_google_id_token` and `verify_apple_id_token` are the public
surface. Both return an `OAuthIdentity` describing the verified user, or
raise `OAuthVerificationError` with a user-safe message on any failure.
The verify endpoints in `routers/auth.py` convert that into a 400 with the
message.

Configuration via env vars on each API droplet:
  GOOGLE_OAUTH_CLIENT_IDS  — comma-separated list of acceptable audiences
                             (web client id + iOS client id, future
                             Android client id, etc.). Tokens whose `aud`
                             isn't in this list are rejected.
  APPLE_OAUTH_AUDIENCES    — comma-separated list of acceptable audiences
                             (web Service ID + iOS app bundle id).

When the env var for a provider is unset, `<provider>_configured()`
returns False and the verify endpoint 503s. This lets dev tiers run
without OAuth configured and the FE flag the buttons as unavailable.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Iterable

import jwt
from jwt import InvalidTokenError, PyJWKClient

log = logging.getLogger("oauth")


# Audience configuration. Comma-separated so a single deployment can serve
# multiple client IDs (web + iOS bundle). Stored as a tuple to keep ordering
# stable across reads.
def _split_audiences(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


_GOOGLE_AUDIENCES = _split_audiences(os.environ.get("GOOGLE_OAUTH_CLIENT_IDS"))
_APPLE_AUDIENCES = _split_audiences(os.environ.get("APPLE_OAUTH_AUDIENCES"))

# JWKS endpoints. These are well-known; PyJWKClient caches the fetched
# keys (default TTL is generous) so we don't pay the network cost per
# verify. Module-level instantiation is safe — the clients are
# thread-safe.
_GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"

_APPLE_ISSUER = "https://appleid.apple.com"
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

_google_jwks: PyJWKClient | None = None
_apple_jwks: PyJWKClient | None = None


def _google_jwks_client() -> PyJWKClient:
    global _google_jwks
    if _google_jwks is None:
        _google_jwks = PyJWKClient(_GOOGLE_JWKS_URL, cache_keys=True)
    return _google_jwks


def _apple_jwks_client() -> PyJWKClient:
    global _apple_jwks
    if _apple_jwks is None:
        _apple_jwks = PyJWKClient(_APPLE_JWKS_URL, cache_keys=True)
    return _apple_jwks


def google_configured() -> bool:
    return bool(_GOOGLE_AUDIENCES)


def apple_configured() -> bool:
    return bool(_APPLE_AUDIENCES)


class OAuthVerificationError(Exception):
    """Raised when an ID token fails verification. Message is user-safe
    (no raw provider error leaks)."""


@dataclass(frozen=True)
class OAuthIdentity:
    provider: str  # 'google' | 'apple'
    provider_user_id: str  # stable per-user 'sub' claim
    email: str | None  # only set when present + verified
    email_verified: bool


def _verify(
    *,
    id_token: str,
    jwks_client: PyJWKClient,
    audiences: Iterable[str],
    issuers: Iterable[str],
    algorithms: Iterable[str],
) -> dict:
    """Common verify pipeline: signing key lookup + decode + claim
    checks. Raises `OAuthVerificationError` with a user-safe message on
    any failure (signature mismatch, expired, wrong issuer/audience,
    malformed token). The provider-specific wrappers add the
    `email_verified` rule on top."""
    if not id_token or len(id_token) < 32:
        raise OAuthVerificationError("Missing or malformed ID token")

    audiences_tuple = tuple(audiences)
    if not audiences_tuple:
        raise OAuthVerificationError(
            "OAuth provider not configured on this server"
        )

    try:
        signing_key = jwks_client.get_signing_key_from_jwt(id_token).key
    except Exception as exc:
        log.warning("OAuth JWKS key lookup failed: %s", exc)
        raise OAuthVerificationError("Could not verify sign-in token") from exc

    try:
        # `audience` accepts a list; `issuer` does not (PyJWT only
        # checks against a single value). Check `iss` manually after
        # decode if multiple issuers are valid.
        claims = jwt.decode(
            id_token,
            signing_key,
            algorithms=list(algorithms),
            audience=list(audiences_tuple),
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise OAuthVerificationError(
            "Sign-in token has expired. Please try again."
        ) from exc
    except jwt.InvalidAudienceError as exc:
        raise OAuthVerificationError(
            "Sign-in token isn't for this application."
        ) from exc
    except InvalidTokenError as exc:
        log.warning("OAuth token decode failed: %s", exc)
        raise OAuthVerificationError("Invalid sign-in token") from exc

    issuers_tuple = tuple(issuers)
    if claims.get("iss") not in issuers_tuple:
        raise OAuthVerificationError("Sign-in token has unexpected issuer.")

    sub = claims.get("sub")
    if not sub or not isinstance(sub, str):
        raise OAuthVerificationError("Sign-in token is missing a subject id.")

    return claims


def verify_google_id_token(id_token: str) -> OAuthIdentity:
    """Verify a Google OIDC ID token. Returns the identity.

    Google sends `email_verified` as a boolean (sometimes as a string in
    older flows — accept both). We only treat the email as the merge key
    when it's verified; an unverified email can't be trusted to belong
    to the sub.
    """
    claims = _verify(
        id_token=id_token,
        jwks_client=_google_jwks_client(),
        audiences=_GOOGLE_AUDIENCES,
        issuers=_GOOGLE_ISSUERS,
        algorithms=("RS256",),
    )
    email = claims.get("email")
    raw_verified = claims.get("email_verified")
    # Google docs say this is a boolean; some flows return the string
    # "true". Treat anything truthy except an explicit false-y value as
    # verified.
    email_verified = bool(raw_verified) and raw_verified not in (
        "false",
        "False",
        False,
    )
    return OAuthIdentity(
        provider="google",
        provider_user_id=claims["sub"],
        email=email if (email and email_verified) else None,
        email_verified=email_verified,
    )


def verify_apple_id_token(id_token: str) -> OAuthIdentity:
    """Verify an Apple Sign In ID token. Returns the identity.

    Apple sends emails in the first sign-in only and may use the
    "hide my email" proxy (`is_private_email: true`). Either form is
    accepted as the merge key — the proxy address is stable per
    (user, relying-party) and is the same email Apple uses for repeat
    sign-ins. `email_verified` is sent as a string in Apple's tokens.
    """
    claims = _verify(
        id_token=id_token,
        jwks_client=_apple_jwks_client(),
        audiences=_APPLE_AUDIENCES,
        issuers=(_APPLE_ISSUER,),
        algorithms=("RS256",),
    )
    email = claims.get("email")
    raw_verified = claims.get("email_verified")
    email_verified = raw_verified in (True, "true", "True")
    return OAuthIdentity(
        provider="apple",
        provider_user_id=claims["sub"],
        email=email if (email and email_verified) else None,
        email_verified=email_verified,
    )
