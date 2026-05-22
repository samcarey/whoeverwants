"""Phase D — WebAuthn / Passkey ceremony helpers.

Passkey registration and authentication are two-step ceremonies:

  Registration (already signed in):
    1. FE → POST /api/auth/passkey/registration/options
       Server mints a random challenge, exposes `excludeCredentials` so the
       FE refuses to register an already-known authenticator, stashes the
       challenge in `passkey_challenges`, returns the WebAuthn options dict.
    2. FE calls `navigator.credentials.create({publicKey: options})` →
       the authenticator (iCloud Keychain, YubiKey, etc.) produces an
       attestation. FE → POST /api/auth/passkey/registration/verify with
       the attestation JSON.
       Server pulls the stashed challenge, runs `verify_registration_response`
       (signature + origin + RP id + challenge match), persists the
       credential, deletes the challenge row, and writes the
       `user_identities` row for cross-provider merge.

  Authentication (signing in):
    1. FE → POST /api/auth/passkey/authentication/options
       Server mints challenge, stashes it (anonymous; no user_id known
       yet), returns options dict with optional allowCredentials filter
       (left empty so the user can pick any passkey known to their
       device — "discoverable credentials"). The signed-in user_id is
       resolved AFTER the assertion is verified, by looking up the
       credential_id the authenticator returned.
    2. FE calls `navigator.credentials.get({publicKey: options})` →
       authenticator produces an assertion. FE → POST
       /api/auth/passkey/authentication/verify.
       Server pulls the credential by `credential_id`, runs
       `verify_authentication_response`, advances sign_count (clone
       detection: reject if new <= old when old != 0), then issues a
       session via the same `complete_sign_in`-style helpers the magic-link
       and OAuth flows use.

Challenge state lives in DB (not signed cookies / JWTs) so the server is
the single source of truth — the FE can't pick its own challenge or
replay an old one. Composite PK on `(browser_id, kind)` means one
in-flight ceremony per browser per kind; restarting a ceremony
overwrites the prior challenge (the user's "I'm starting again" intent
beats their stale half-finished prior attempt).

RP (Relying Party) identity:
  - rp_id is the domain (`whoeverwants.com`, `latest.whoeverwants.com`,
    `<slug>.dev.whoeverwants.com`) — passkeys are scoped to it.
  - rp_name is the display string the OS shows ("WhoeverWants").
  - origin is the full `https://<rp_id>` URL — verified against the
    Origin header on the assertion.

The rp_id MUST match the FE's actual hostname, not be hardcoded — passkeys
registered to `whoeverwants.com` can't sign in on `latest.whoeverwants.com`
and vice versa. The router resolves rp_id + origin from the request's
Origin header (validated against the same allowlist used for magic-link
URLs) so a hostile Origin can't masquerade.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import options_to_json, parse_authentication_credential_json
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
    WebAuthnException,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

log = logging.getLogger("passkeys")


# Challenge TTL: 5 minutes. Long enough for the user to authenticate
# (most authenticators take 1-5 seconds, including biometric checks);
# short enough that an intercepted challenge can't be replayed days
# later. Matches the WebAuthn spec's recommendation of "60 seconds to a
# few minutes."
CHALLENGE_TTL_SECONDS = 300

# Display name shown in OS-level passkey prompts.
RP_NAME = "WhoeverWants"


# ---------------------------------------------------------------------------
# Base64url helpers — the FE sends credential bytes as base64url; the
# webauthn lib's parse helpers already accept base64url, but we use
# these for storing credential_id (text PK) and aaguid (text).
# ---------------------------------------------------------------------------


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    """Decode base64url, tolerating missing padding."""
    pad = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + pad)


# ---------------------------------------------------------------------------
# Challenge persistence
# ---------------------------------------------------------------------------


@dataclass
class StoredChallenge:
    challenge: str  # base64url-encoded
    user_id: str | None


def _stash_challenge(
    conn,
    *,
    browser_id: str,
    kind: str,
    challenge: bytes,
    user_id: str | None,
) -> str:
    """Persist (overwriting prior of same kind) the challenge for this
    browser. Returns the base64url-encoded challenge so the caller can
    return it inside the options dict the FE consumes."""
    challenge_b64 = _b64url_encode(challenge)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=CHALLENGE_TTL_SECONDS)
    conn.execute(
        """
        INSERT INTO passkey_challenges (browser_id, kind, challenge, user_id, expires_at)
        VALUES (%(b)s::uuid, %(k)s, %(c)s, %(u)s, %(exp)s)
        ON CONFLICT (browser_id, kind) DO UPDATE SET
          challenge = EXCLUDED.challenge,
          user_id = EXCLUDED.user_id,
          created_at = NOW(),
          expires_at = EXCLUDED.expires_at
        """,
        {
            "b": browser_id,
            "k": kind,
            "c": challenge_b64,
            "u": user_id,
            "exp": expires_at,
        },
    )
    return challenge_b64


def _peek_challenge(
    conn, *, browser_id: str, kind: str
) -> StoredChallenge | None:
    """Read the stashed challenge without deleting it. The consume
    happens in a separate `_delete_challenge` call AFTER the ceremony's
    verification step has succeeded.

    Why split: an attacker who knows the victim's X-Browser-Id (sent
    in every API response's X-Browser-Id header) could otherwise spam
    /verify with garbage credential JSON. Each garbage call would
    DELETE-RETURN the stashed challenge before the (failing) parse +
    verify, denying the legitimate ceremony its challenge. With
    peek-then-delete-on-success, a failing verify leaves the challenge
    intact for the user's retry within the 5-min TTL."""
    row = conn.execute(
        """
        SELECT challenge, user_id FROM passkey_challenges
         WHERE browser_id = %(b)s::uuid
           AND kind = %(k)s
           AND expires_at > NOW()
        """,
        {"b": browser_id, "k": kind},
    ).fetchone()
    if not row:
        return None
    return StoredChallenge(
        challenge=row["challenge"],
        user_id=str(row["user_id"]) if row.get("user_id") else None,
    )


def _delete_challenge(
    conn, *, browser_id: str, kind: str, challenge: str
) -> None:
    """Delete the stashed challenge after a successful ceremony. The
    `challenge` predicate prevents a stale browser+kind from clobbering
    a freshly-started ceremony if two cycles raced. No-op if the row
    is already gone (concurrent verify, expired, etc.)."""
    conn.execute(
        """
        DELETE FROM passkey_challenges
         WHERE browser_id = %(b)s::uuid
           AND kind = %(k)s
           AND challenge = %(c)s
        """,
        {"b": browser_id, "k": kind, "c": challenge},
    )


def _consume_challenge(
    conn, *, browser_id: str, kind: str
) -> StoredChallenge | None:
    """Atomically read + delete the stashed challenge.

    DEPRECATED for ceremony paths: use `_peek_challenge` + `_delete_challenge`
    so a failing verify doesn't consume the legitimate challenge. Kept
    only because the tests in `test_passkeys.py` exercise it directly."""
    row = conn.execute(
        """
        DELETE FROM passkey_challenges
         WHERE browser_id = %(b)s::uuid
           AND kind = %(k)s
           AND expires_at > NOW()
        RETURNING challenge, user_id
        """,
        {"b": browser_id, "k": kind},
    ).fetchone()
    if not row:
        return None
    return StoredChallenge(
        challenge=row["challenge"],
        user_id=str(row["user_id"]) if row.get("user_id") else None,
    )


# ---------------------------------------------------------------------------
# Credential storage
# ---------------------------------------------------------------------------


@dataclass
class PasskeyRow:
    credential_id: str  # base64url-encoded
    user_id: str
    public_key: bytes  # raw COSE bytes
    sign_count: int
    transports: str | None
    aaguid: str | None
    name: str | None
    created_at: datetime
    last_used_at: datetime


def list_user_passkeys(conn, user_id: str) -> list[PasskeyRow]:
    rows = conn.execute(
        """
        SELECT credential_id, user_id, public_key, sign_count, transports,
               aaguid, name, created_at, last_used_at
          FROM passkey_credentials
         WHERE user_id = %(u)s::uuid
         ORDER BY created_at DESC
        """,
        {"u": user_id},
    ).fetchall()
    return [
        PasskeyRow(
            credential_id=r["credential_id"],
            user_id=str(r["user_id"]),
            public_key=bytes(r["public_key"]),
            sign_count=int(r["sign_count"]),
            transports=r["transports"],
            aaguid=r["aaguid"],
            name=r["name"],
            created_at=r["created_at"],
            last_used_at=r["last_used_at"],
        )
        for r in rows
    ]


def get_passkey_by_credential_id(conn, credential_id: str) -> PasskeyRow | None:
    row = conn.execute(
        """
        SELECT credential_id, user_id, public_key, sign_count, transports,
               aaguid, name, created_at, last_used_at
          FROM passkey_credentials
         WHERE credential_id = %(c)s
        """,
        {"c": credential_id},
    ).fetchone()
    if not row:
        return None
    return PasskeyRow(
        credential_id=row["credential_id"],
        user_id=str(row["user_id"]),
        public_key=bytes(row["public_key"]),
        sign_count=int(row["sign_count"]),
        transports=row["transports"],
        aaguid=row["aaguid"],
        name=row["name"],
        created_at=row["created_at"],
        last_used_at=row["last_used_at"],
    )


def delete_passkey(conn, *, user_id: str, credential_id: str) -> bool:
    """Delete by (user_id, credential_id) so a stranger can't drop
    someone else's credential via id guessing. Returns True iff a row was
    deleted."""
    row = conn.execute(
        """
        DELETE FROM passkey_credentials
         WHERE credential_id = %(c)s
           AND user_id = %(u)s::uuid
        RETURNING credential_id
        """,
        {"c": credential_id, "u": user_id},
    ).fetchone()
    return row is not None


def rename_passkey(
    conn, *, user_id: str, credential_id: str, name: str
) -> bool:
    """Rename a passkey. Same identity gate as delete. Returns True iff
    a row was updated."""
    trimmed = name.strip()[:120]
    row = conn.execute(
        """
        UPDATE passkey_credentials
           SET name = %(n)s
         WHERE credential_id = %(c)s
           AND user_id = %(u)s::uuid
        RETURNING credential_id
        """,
        {"c": credential_id, "u": user_id, "n": trimmed if trimmed else None},
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# Registration ceremony
# ---------------------------------------------------------------------------


def build_registration_options(
    conn,
    *,
    user_id: str,
    user_label: str,
    browser_id: str,
    rp_id: str,
) -> dict[str, Any]:
    """Step 1 of registration. Mints a fresh challenge, persists it for
    later verification, and returns the options dict the FE feeds to
    `navigator.credentials.create()`.

    `exclude_credentials` lists every passkey already registered for this
    user so the FE refuses to re-register the same authenticator (browser
    raises `InvalidStateError`). Without this, a user could end up with
    duplicate entries pointing at the same physical key.

    `user_id` is the FE-visible WebAuthn user handle. Per spec it should
    NOT be the email (PII leak via authenticator metadata); we pass the
    raw uuid as bytes.
    """
    existing = list_user_passkeys(conn, user_id)
    exclude = [
        PublicKeyCredentialDescriptor(id=_b64url_decode(p.credential_id))
        for p in existing
    ]
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_name=user_label,
        user_id=user_id.encode("utf-8"),
        user_display_name=user_label,
        exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            # Resident keys = discoverable credentials: the user doesn't
            # need to type their email at sign-in time; the authenticator
            # offers any passkey known for this RP.
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    challenge_b64 = _stash_challenge(
        conn,
        browser_id=browser_id,
        kind="registration",
        challenge=options.challenge,
        user_id=user_id,
    )
    # The webauthn lib already encoded the challenge into options. Sub
    # it back in so what we return matches what we stashed (defensive —
    # the lib does this consistently in practice, but a future version
    # could choose a different padding strategy).
    options_dict = json.loads(options_to_json(options))
    options_dict["challenge"] = challenge_b64
    return options_dict


@dataclass
class RegisteredPasskey:
    credential_id: str
    user_id: str  # the user this passkey is now bound to — important for the
                  # anonymous registration path where the caller doesn't know
                  # the user_id ahead of time.
    aaguid: str | None
    transports: str | None


def complete_registration(
    conn,
    *,
    request_user_id: str | None,
    browser_id: str,
    rp_id: str,
    origin: str,
    credential_json: dict[str, Any],
    name: str | None,
) -> RegisteredPasskey:
    """Step 2 of registration. Verifies the attestation and persists the
    credential. Raises `PasskeyError` on any failure with a user-safe
    message — the router converts that into a 400.

    `request_user_id` is the user_id resolved by the IdentityMiddleware,
    or None for an anonymous registration (passkey-as-account-creation
    flow). The user_id the credential is bound to is read from the
    challenge row's stashed user_id — that's the one
    `build_registration_options` minted at step 1, regardless of
    whether the request was signed in or anonymous.

    When the request IS signed in, we additionally verify the stashed
    user_id matches `request_user_id` so a token swapping mid-ceremony
    can't bind a credential to an unintended account.

    On success, also inserts the `user_identities` row for
    `provider='passkey'` so cross-provider account-merge by verified
    email continues to work (the email lookup in `resolve_or_merge_user`
    spans all providers).

    Three security-critical checks before INSERT:
      1. Authenticated request → stash.user_id MUST match request_user_id.
      2. Anonymous request → stash.user_id must be a brand-new mint
         (no existing user_identities), otherwise a signed-in
         user's in-flight ceremony could be hijacked by an anonymous
         /verify call (account takeover via stale stash + dropped
         bearer token).
      3. credential_id must not already be registered (anywhere) —
         re-registering an existing credential under a different
         user_id would silently rebind it. The OS prompt may offer
         existing credentials at the anonymous "Create account"
         path; the user should sign in with them instead."""
    stash = _peek_challenge(conn, browser_id=browser_id, kind="registration")
    if not stash:
        raise PasskeyError("Registration session expired. Try again.")
    if not stash.user_id:
        # Registration challenges are always stashed with a user_id (the
        # one minted at options time). A missing value means the stash
        # was tampered with.
        raise PasskeyError("Registration session corrupted. Try again.")
    if request_user_id:
        # Authenticated: stash must belong to this user.
        if stash.user_id != request_user_id:
            raise PasskeyError("Registration session mismatch. Try again.")
    else:
        # Anonymous: stash must belong to a fresh user with no
        # identities yet (i.e. the options-side anonymous branch
        # minted it). Otherwise this is a signed-in user's stash
        # being completed without their bearer token — refuse so
        # sign-out can't be reversed and so a browser_id leak can't
        # be parlayed into a session for the original user.
        has_identities = conn.execute(
            """
            SELECT 1 FROM user_identities
             WHERE user_id = %(u)s::uuid
             LIMIT 1
            """,
            {"u": stash.user_id},
        ).fetchone()
        if has_identities:
            raise PasskeyError(
                "Registration session belongs to a signed-in account. "
                "Sign in first to add this passkey."
            )
    user_id = stash.user_id

    try:
        verification = verify_registration_response(
            credential=credential_json,
            expected_challenge=_b64url_decode(stash.challenge),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=False,
        )
    except WebAuthnException as exc:
        # Covers InvalidRegistrationResponse (verify failures) AND
        # InvalidJSONStructure / InvalidCBORData / etc. (malformed
        # input). Without the broad catch, a hostile or buggy FE
        # produces a 500 instead of a clean 400.
        log.warning("Registration verification failed: %s", exc)
        raise PasskeyError(f"Couldn't register passkey: {exc}")

    credential_id = _b64url_encode(verification.credential_id)

    # Refuse re-registering an already-known credential. The OS prompt
    # may offer an existing passkey for this RP at the anonymous
    # "Create account" path (the browser doesn't have an
    # exclude_credentials list to filter by — it's a fresh user_id).
    # Picking it would otherwise rebind the credential to the freshly-
    # minted user, corrupting the original owner's account.
    existing = get_passkey_by_credential_id(conn, credential_id)
    if existing:
        raise PasskeyError(
            "This passkey is already registered. Sign in with it instead."
        )

    raw_aaguid = getattr(verification, "aaguid", None) or ""
    # Empty / all-zero aaguids are placeholders many authenticators emit
    # when they don't want to identify themselves; treat as "unknown".
    aaguid = (
        raw_aaguid
        if raw_aaguid and raw_aaguid != "00000000-0000-0000-0000-000000000000"
        else None
    )
    # The FE submits raw `response.transports` (list of strings from the
    # browser). Stored as comma-separated text to avoid a separate
    # subtable for a tiny enum-like field. Robust to hostile/garbage
    # input shapes: a non-dict response (or one without a list
    # transports field) just yields None.
    response_dict = (
        credential_json.get("response") if isinstance(credential_json, dict) else None
    )
    transports_raw = (
        response_dict.get("transports") if isinstance(response_dict, dict) else None
    )
    transports: str | None = None
    if isinstance(transports_raw, list):
        cleaned = [str(t).strip()[:16] for t in transports_raw if str(t).strip()]
        transports = ",".join(cleaned) if cleaned else None

    # No ON CONFLICT needed — the `get_passkey_by_credential_id` guard
    # above guarantees the row is new. Catching a concurrent-insert
    # race (two parallel verify calls with the same credential_id) is
    # the unique constraint's job; the second INSERT will raise and
    # the caller's transaction rolls back.
    conn.execute(
        """
        INSERT INTO passkey_credentials
          (credential_id, user_id, public_key, sign_count, transports, aaguid, name)
        VALUES
          (%(c)s, %(u)s::uuid, %(pk)s, %(sc)s, %(t)s, %(a)s, %(n)s)
        """,
        {
            "c": credential_id,
            "u": user_id,
            "pk": verification.credential_public_key,
            "sc": verification.sign_count or 0,
            "t": transports,
            "a": aaguid,
            "n": (name.strip()[:120] if name and name.strip() else None),
        },
    )
    # Mirror the identity into `user_identities` so account-merge logic
    # (resolve_or_merge_user) can see the passkey as a linked provider.
    # The credential_id is the natural provider_user_id. Match the
    # uniqueness behavior of passkey_credentials above — INSERT only;
    # an existing row indicates concurrency or corruption.
    conn.execute(
        """
        INSERT INTO user_identities (provider, provider_user_id, user_id, email)
        VALUES ('passkey', %(c)s, %(u)s::uuid, NULL)
        """,
        {"c": credential_id, "u": user_id},
    )

    # Consume the challenge only after both INSERTs succeed.
    _delete_challenge(
        conn, browser_id=browser_id, kind="registration", challenge=stash.challenge
    )

    return RegisteredPasskey(
        credential_id=credential_id,
        user_id=user_id,
        aaguid=aaguid,
        transports=transports,
    )


# ---------------------------------------------------------------------------
# Authentication ceremony
# ---------------------------------------------------------------------------


def build_authentication_options(
    conn,
    *,
    browser_id: str,
    rp_id: str,
) -> dict[str, Any]:
    """Step 1 of sign-in. Mints a challenge, persists it (no user_id
    yet — that's resolved AFTER the assertion is verified), returns the
    options dict.

    `allow_credentials` is intentionally empty so the authenticator
    surfaces every passkey it has for `rp_id` (discoverable credentials).
    The user picks the right one in their OS-level prompt.
    """
    options = generate_authentication_options(
        rp_id=rp_id,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    challenge_b64 = _stash_challenge(
        conn,
        browser_id=browser_id,
        kind="authentication",
        challenge=options.challenge,
        user_id=None,
    )
    options_dict = json.loads(options_to_json(options))
    options_dict["challenge"] = challenge_b64
    return options_dict


@dataclass
class AuthenticatedPasskey:
    user_id: str
    credential_id: str


def complete_authentication(
    conn,
    *,
    browser_id: str,
    rp_id: str,
    origin: str,
    credential_json: dict[str, Any],
) -> AuthenticatedPasskey:
    """Step 2 of sign-in. Verifies the assertion against the stored
    credential's public key, advances sign_count, returns the user_id
    the caller can then hand to `issue_session` + friends.

    Clone detection: if the assertion's sign_count is <= the stored
    value AND the stored value isn't 0, treat as a potential clone and
    reject. Some authenticators (iCloud Keychain) intentionally always
    return 0 (the user's keychain is multi-device anyway — sign counter
    has no meaning); we accept those by the `stored != 0` guard.
    """
    # Peek (not consume) so a failing verify doesn't deny the legitimate
    # ceremony its challenge. An attacker who knows the victim's
    # X-Browser-Id (exposed in every response header) would otherwise
    # be able to spam /verify with garbage to DoS sign-in attempts.
    # Delete only after a successful verify (below).
    stash = _peek_challenge(conn, browser_id=browser_id, kind="authentication")
    if not stash:
        raise PasskeyError("Sign-in session expired. Try again.")

    try:
        parsed = parse_authentication_credential_json(credential_json)
    except Exception as exc:
        raise PasskeyError(f"Invalid passkey response: {exc}")

    credential_id = _b64url_encode(parsed.raw_id)
    stored = get_passkey_by_credential_id(conn, credential_id)
    if not stored:
        raise PasskeyError("Unknown passkey. Register on this device first.")

    try:
        verification = verify_authentication_response(
            credential=parsed,
            expected_challenge=_b64url_decode(stash.challenge),
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=stored.public_key,
            credential_current_sign_count=stored.sign_count,
            require_user_verification=False,
        )
    except WebAuthnException as exc:
        # Broad catch for the same reasons as the registration verify
        # above.
        log.warning("Authentication verification failed: %s", exc)
        raise PasskeyError(f"Couldn't sign in with passkey: {exc}")

    new_sign_count = verification.new_sign_count or 0
    # Clone detection — see docstring. webauthn lib already raises on a
    # decreasing counter when the stored value is > 0, but we double-check
    # so any future lib relaxation doesn't silently weaken this.
    if stored.sign_count > 0 and new_sign_count <= stored.sign_count:
        log.warning(
            "Suspect sign_count regression for credential %s: stored=%d new=%d",
            credential_id,
            stored.sign_count,
            new_sign_count,
        )
        raise PasskeyError("This passkey has been compromised. Remove and re-register.")

    conn.execute(
        """
        UPDATE passkey_credentials
           SET sign_count = %(sc)s,
               last_used_at = NOW()
         WHERE credential_id = %(c)s
        """,
        {"sc": new_sign_count, "c": credential_id},
    )

    # Consume the challenge only after verification + sign_count
    # update succeed. See `_peek_challenge` docstring for the DoS
    # this guards against.
    _delete_challenge(
        conn,
        browser_id=browser_id,
        kind="authentication",
        challenge=stash.challenge,
    )

    return AuthenticatedPasskey(user_id=stored.user_id, credential_id=credential_id)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class PasskeyError(Exception):
    """User-safe error message — the router converts to 400."""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def passkey_configured() -> bool:
    """Whether passkey sign-in is available on this server.

    Unlike Google / Apple OAuth (which need provider-specific client IDs
    or audiences configured per tier), WebAuthn is purely first-party —
    no third-party config required. Always-on by default. An env-var
    kill switch lets a tier disable it if needed (e.g. a dev tier that
    doesn't want passkeys in its UI):

      PASSKEYS_DISABLED=1  → returns False; the FE hides the button.
    """
    return os.environ.get("PASSKEYS_DISABLED", "").lower() not in ("1", "true", "yes")
