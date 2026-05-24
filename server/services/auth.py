"""User identity / session / magic-link helpers.

See `docs/auth-access-model.md` for the design. Provider-agnostic surface:
the magic-link router (Phase B), Apple / Google routers (Phase C), and
passkey router (Phase D) all reach through these functions so the
account-merge + browser-link + session-issuance rules live in one place.

Storage model:
  - `users(id)` — one row per real person.
  - `user_identities(provider, provider_user_id, user_id, email)` — one row
    per provider account; `(provider, provider_user_id)` is the natural
    key.
  - `user_browsers(browser_id PK, user_id)` — one row per browser. PK on
    browser_id means a browser can be linked to ONE user at a time;
    re-signing in as a different user replaces the row via
    `ON CONFLICT (browser_id) DO UPDATE`.
  - `sessions(token_hash PK, user_id, browser_id, expires_at, ...)` —
    opaque bearer tokens. Server stores only the sha256 hash; the raw
    token is returned exactly once at sign-in and sent thereafter via
    `Authorization: Bearer <token>`.

Magic-link tokens follow the same hash-only storage as sessions.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# Session lifetime: 90 days from issuance, no sliding refresh. Long
# enough that users don't notice; short enough that abandoned sessions
# clean up eventually. Re-auth via magic link is cheap.
SESSION_TTL_DAYS = 90

# Magic-link lifetime: 15 minutes, single-use. Long enough that the user
# can switch from the app to email and back; short enough that an
# intercepted link doesn't sit usable for hours.
MAGIC_LINK_TTL_MINUTES = 15

# Per-email magic-link request throttle: server-side cooldown to prevent
# an attacker from spamming a victim's inbox. Measured against the most
# recent NON-expired token's created_at.
MAGIC_LINK_COOLDOWN_SECONDS = 60


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str) -> str:
    """Lowercase + strip. Magic-link `provider_user_id` and the email
    lookup index both use the normalized form so the same email entered
    with different casing resolves to one identity row."""
    return value.strip().lower()


def is_valid_email(value: str) -> bool:
    if not isinstance(value, str):
        return False
    normalized = normalize_email(value)
    if len(normalized) > 254 or len(normalized) < 3:
        return False
    return bool(_EMAIL_RE.match(normalized))


# ---------------------------------------------------------------------------
# Token primitives
# ---------------------------------------------------------------------------


def generate_token() -> str:
    """43-char URL-safe random token (32 bytes of entropy). Used for both
    session tokens AND magic-link tokens — same storage shape, same
    threat model (server stores sha256 only)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """sha256 hex of the raw token. Storing only the hash means a DB
    leak doesn't yield usable tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# User + identity resolution
# ---------------------------------------------------------------------------


@dataclass
class ResolvedUser:
    user_id: str
    is_new_user: bool


def resolve_or_merge_user(
    conn,
    *,
    provider: str,
    provider_user_id: str,
    email: str | None,
) -> ResolvedUser:
    """Find the user for this auth, creating + merging as needed.

    Order of operations:
      1. (provider, provider_user_id) exact match → existing user_id.
      2. Else if `email` is provided AND any identity row has matching
         email → existing user_id; insert new identity row pointing to
         it (account merge across providers).
      3. Else → create new user + identity row.

    Returns the resolved user_id and whether a new user was created.
    """
    existing = conn.execute(
        """
        SELECT user_id FROM user_identities
        WHERE provider = %(p)s AND provider_user_id = %(pid)s
        """,
        {"p": provider, "pid": provider_user_id},
    ).fetchone()
    if existing:
        return ResolvedUser(user_id=str(existing["user_id"]), is_new_user=False)

    if email:
        normalized = normalize_email(email)
        merged = conn.execute(
            """
            SELECT user_id FROM user_identities
            WHERE email = %(e)s
            ORDER BY created_at ASC
            LIMIT 1
            """,
            {"e": normalized},
        ).fetchone()
        if merged:
            user_id = str(merged["user_id"])
            conn.execute(
                """
                INSERT INTO user_identities (provider, provider_user_id, user_id, email)
                VALUES (%(p)s, %(pid)s, %(u)s::uuid, %(e)s)
                ON CONFLICT (provider, provider_user_id) DO NOTHING
                """,
                {"p": provider, "pid": provider_user_id, "u": user_id, "e": normalized},
            )
            return ResolvedUser(user_id=user_id, is_new_user=False)

    new_row = conn.execute(
        "INSERT INTO users DEFAULT VALUES RETURNING id"
    ).fetchone()
    user_id = str(new_row["id"])
    conn.execute(
        """
        INSERT INTO user_identities (provider, provider_user_id, user_id, email)
        VALUES (%(p)s, %(pid)s, %(u)s::uuid, %(e)s)
        """,
        {
            "p": provider,
            "pid": provider_user_id,
            "u": user_id,
            "e": normalize_email(email) if email else None,
        },
    )
    return ResolvedUser(user_id=user_id, is_new_user=True)


def link_browser_to_user(conn, *, user_id: str, browser_id: str | None) -> None:
    """Establish or update the browser → user link. ON CONFLICT
    (browser_id) DO UPDATE: a browser can only be linked to one user at
    a time, so re-signing in as a different user from the same browser
    replaces the row. `linked_at` advances on the relink (intentional —
    "last time this browser was linked to anyone") but stays the same
    on a re-sign-in to the same user (the cheaper path through
    EXCLUDED.user_id = current row's user_id is folded into the same
    statement)."""
    if not browser_id:
        return
    conn.execute(
        """
        INSERT INTO user_browsers (browser_id, user_id, linked_at)
        VALUES (%(b)s::uuid, %(u)s::uuid, NOW())
        ON CONFLICT (browser_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          linked_at = CASE
            WHEN user_browsers.user_id = EXCLUDED.user_id THEN user_browsers.linked_at
            ELSE NOW()
          END
        """,
        {"b": browser_id, "u": user_id},
    )


def unlink_browser(conn, *, browser_id: str | None) -> None:
    """Drop the browser → user link (used at sign-out). Idempotent — a
    browser that was never linked or already unlinked just 0-rows."""
    if not browser_id:
        return
    conn.execute(
        "DELETE FROM user_browsers WHERE browser_id = %(b)s::uuid",
        {"b": browser_id},
    )


def get_user_id_for_browser(conn, browser_id: str | None) -> str | None:
    """Reverse lookup used by the IdentityMiddleware fallback path when
    no session token is present — a previously-signed-in browser still
    resolves to its user_id via the persistent `user_browsers` link."""
    if not browser_id:
        return None
    row = conn.execute(
        "SELECT user_id FROM user_browsers WHERE browser_id = %(b)s::uuid",
        {"b": browser_id},
    ).fetchone()
    return str(row["user_id"]) if row else None


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


@dataclass
class IssuedSession:
    token: str  # raw token — return to FE exactly once, never persisted.
    expires_at: datetime


def issue_session(
    conn,
    *,
    user_id: str,
    browser_id: str | None,
    user_agent: str | None,
) -> IssuedSession:
    """Mint a new session for `user_id`. Returns the raw token; server
    stores only sha256(token)."""
    token = generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    conn.execute(
        """
        INSERT INTO sessions
          (token_hash, user_id, browser_id, user_agent, expires_at, last_used_at)
        VALUES
          (%(h)s, %(u)s::uuid, %(b)s, %(ua)s, %(exp)s, NOW())
        """,
        {
            "h": hash_token(token),
            "u": user_id,
            "b": browser_id,
            "ua": (user_agent[:512] if user_agent else None),
            "exp": expires_at,
        },
    )
    return IssuedSession(token=token, expires_at=expires_at)


def lookup_session_user_id(conn, token: str | None) -> str | None:
    """Return the user_id for a valid, non-expired session token, or
    None. Also bumps `last_used_at` so we can prune idle sessions later.
    Reads + writes a single row; safe to call on every request."""
    if not token or len(token) < 16:
        return None
    row = conn.execute(
        """
        UPDATE sessions
           SET last_used_at = NOW()
         WHERE token_hash = %(h)s
           AND expires_at > NOW()
        RETURNING user_id
        """,
        {"h": hash_token(token)},
    ).fetchone()
    return str(row["user_id"]) if row else None


def revoke_session(conn, token: str) -> None:
    """Drop a session by its raw token. Idempotent."""
    if not token:
        return
    conn.execute(
        "DELETE FROM sessions WHERE token_hash = %(h)s",
        {"h": hash_token(token)},
    )


# ---------------------------------------------------------------------------
# Magic links
# ---------------------------------------------------------------------------


@dataclass
class IssuedMagicLink:
    token: str  # raw token — embed in the email URL exactly once.
    expires_at: datetime


def issue_magic_link(
    conn,
    *,
    email: str,
    browser_id: str | None,
    user_id: str | None = None,
) -> IssuedMagicLink:
    """Mint a new magic-link token for `email`. Caller is responsible
    for sending the email containing the raw token. Throttling is
    enforced via `email_throttled` BEFORE this is called.

    `user_id` is NULL for sign-in tokens (Phase B) and set for
    recovery-email-attach tokens (Phase I). The two flows are kept
    uncrossed by the consume predicates — see `consume_magic_link`
    (NULL only) and `consume_recovery_email_token` (NOT NULL only)."""
    token = generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=MAGIC_LINK_TTL_MINUTES)
    conn.execute(
        """
        INSERT INTO magic_link_tokens
          (token_hash, email, browser_id, user_id, expires_at)
        VALUES
          (%(h)s, %(e)s, %(b)s, %(u)s, %(exp)s)
        """,
        {
            "h": hash_token(token),
            "e": normalize_email(email),
            "b": browser_id,
            "u": user_id,
            "exp": expires_at,
        },
    )
    return IssuedMagicLink(token=token, expires_at=expires_at)


def email_throttled(conn, email: str) -> bool:
    """True if a token for this email was issued within the cooldown
    window. Prevents an attacker from spamming a victim's inbox."""
    row = conn.execute(
        """
        SELECT 1 FROM magic_link_tokens
         WHERE email = %(e)s
           AND created_at > NOW() - %(window)s::interval
         LIMIT 1
        """,
        {
            "e": normalize_email(email),
            "window": f"{MAGIC_LINK_COOLDOWN_SECONDS} seconds",
        },
    ).fetchone()
    return row is not None


@dataclass
class ConsumedMagicLink:
    email: str
    # The browser_id that requested the link. Carried through for fraud
    # detection only — the verify endpoint uses the REQUEST's browser_id
    # for the user_browsers link, not this one (the link may be clicked
    # on a different device than it was requested from).
    requesting_browser_id: str | None


def consume_magic_link(conn, token: str) -> ConsumedMagicLink | None:
    """Atomically validate + mark-used. Returns the email if the token
    was valid and not yet used; None otherwise. Wrap the predicate + the
    UPDATE in one statement so two simultaneous clicks don't both pass.

    `AND user_id IS NULL` scopes this to SIGN-IN tokens — a Phase I
    recovery-email-attach token (which carries a user_id) can never be
    redeemed here as a fresh sign-in.
    """
    if not token:
        return None
    row = conn.execute(
        """
        UPDATE magic_link_tokens
           SET used_at = NOW()
         WHERE token_hash = %(h)s
           AND used_at IS NULL
           AND user_id IS NULL
           AND expires_at > NOW()
        RETURNING email, browser_id
        """,
        {"h": hash_token(token)},
    ).fetchone()
    if not row:
        return None
    return ConsumedMagicLink(
        email=row["email"],
        requesting_browser_id=str(row["browser_id"]) if row.get("browser_id") else None,
    )


# ---------------------------------------------------------------------------
# Recovery email — Phase I
# ---------------------------------------------------------------------------
#
# Attach an email identity to an account that doesn't have one yet
# (passkey-only, or OAuth-only without an 'email' provider row). Reuses
# the magic-link table (tokens tagged with user_id) for email-control
# proof. The verify step additionally requires the caller's session to
# match the token's user_id, so possessing the link alone can't bind an
# email to someone else's account.


@dataclass
class RecoveryEmailToken:
    email: str
    user_id: str


def peek_recovery_email_token(conn, token: str) -> RecoveryEmailToken | None:
    """Read a recovery-email-attach token WITHOUT marking it used.

    `AND user_id IS NOT NULL` scopes this to attach tokens (a sign-in
    token can't be redeemed here). Peeking (rather than the atomic
    consume) lets the verify endpoint validate session-ownership +
    email-conflict BEFORE burning the token — so a wrong-device click or
    an already-taken email leaves the token usable for a correct retry
    within its TTL. `consume_recovery_email_token` is called only after
    those checks pass.
    """
    if not token:
        return None
    row = conn.execute(
        """
        SELECT email, user_id FROM magic_link_tokens
         WHERE token_hash = %(h)s
           AND used_at IS NULL
           AND user_id IS NOT NULL
           AND expires_at > NOW()
        """,
        {"h": hash_token(token)},
    ).fetchone()
    if not row:
        return None
    return RecoveryEmailToken(email=row["email"], user_id=str(row["user_id"]))


def consume_recovery_email_token(conn, token: str) -> RecoveryEmailToken | None:
    """Mark a recovery-email token used and return its (email, user_id).

    The `used_at IS NULL` predicate is the concurrency guard — two
    simultaneous verifies both peek successfully but only one wins the
    UPDATE. Returns None if the token was already consumed between peek
    and consume (rare two-tab race)."""
    if not token:
        return None
    row = conn.execute(
        """
        UPDATE magic_link_tokens
           SET used_at = NOW()
         WHERE token_hash = %(h)s
           AND used_at IS NULL
           AND user_id IS NOT NULL
           AND expires_at > NOW()
        RETURNING email, user_id
        """,
        {"h": hash_token(token)},
    ).fetchone()
    if not row:
        return None
    return RecoveryEmailToken(email=row["email"], user_id=str(row["user_id"]))


def user_has_email_identity(conn, user_id: str) -> bool:
    """True if this user already has an 'email'-provider identity. Gates
    the recovery-email request endpoint: the feature only adds an email
    to accounts that lack one (adding a SECOND email is out of scope —
    see docs/auth-access-model.md → 'Out of scope for v1')."""
    row = conn.execute(
        """
        SELECT 1 FROM user_identities
         WHERE user_id = %(u)s::uuid AND provider = 'email'
         LIMIT 1
        """,
        {"u": user_id},
    ).fetchone()
    return row is not None


def attach_email_identity(conn, *, user_id: str, email: str) -> str:
    """Bind an email-provider identity to `user_id`.

    Returns a status discriminator:
      * 'attached'       — new identity row inserted.
      * 'already_linked' — this user already has this exact email
                           identity (idempotent no-op).
      * 'conflict'       — the email is already used by a DIFFERENT
                           user (via any provider). Refused — binding it
                           would let this user hijack magic-link sign-in
                           for an address another account proved control
                           of. (Option (a) in the doc: account merge
                           requires proving control of both sides at the
                           same time, which an attach can't.)

    The conflict check spans ALL providers, not just 'email': if user B
    signed in with Google using foo@x.com, that address is "theirs" and
    user A can't claim it as a sign-in email.
    """
    normalized = normalize_email(email)
    rows = conn.execute(
        """
        SELECT user_id, provider, provider_user_id FROM user_identities
         WHERE email = %(e)s
        """,
        {"e": normalized},
    ).fetchall()

    for r in rows:
        if r["provider"] == "email" and r["provider_user_id"] == normalized:
            return "already_linked" if str(r["user_id"]) == user_id else "conflict"

    if any(str(r["user_id"]) != user_id for r in rows):
        return "conflict"

    # Email is unused, or only carried by THIS user via a non-email
    # provider (e.g. they signed in with Google using this address).
    # Safe to add the email-provider identity so they gain magic-link
    # sign-in / recovery too.
    conn.execute(
        """
        INSERT INTO user_identities (provider, provider_user_id, user_id, email)
        VALUES ('email', %(e)s, %(u)s::uuid, %(e)s)
        ON CONFLICT (provider, provider_user_id) DO NOTHING
        """,
        {"e": normalized, "u": user_id},
    )
    return "attached"


def delete_user_account(conn, user_id: str) -> bool:
    """Delete a user and everything that cascades from it.

    Every FK that references `users(id)` was declared in migrations
    112–117 with the right ON DELETE action for this single statement to
    be a clean teardown:
      * user_identities, user_browsers, sessions, passkey_credentials,
        passkey_challenges, group_join_requests.requester_user_id,
        group_invites.created_by_user_id, magic_link_tokens.user_id
        → CASCADE (rows deleted).
      * groups.creator_user_id, group_join_requests.decided_by_user_id
        → SET NULL (group / decision survives, ownership cleared).

    `group_members` is keyed on browser_id (no user_id column), so the
    browser keeps its memberships and works anonymously after deletion —
    which is the intended "drop the user layer, keep the browser"
    behavior. Polls / votes have no user FK either, so they survive
    intact (creator_secret still authorizes the original creator's
    browser). Returns True if a row was deleted, False if the user was
    already gone (idempotent)."""
    row = conn.execute(
        "DELETE FROM users WHERE id = %(u)s::uuid RETURNING id",
        {"u": user_id},
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# Profile lookup (used by /api/auth/me)
# ---------------------------------------------------------------------------


@dataclass
class UserProfile:
    user_id: str
    email: str | None  # most recent verified email across identities (None for passkey-only)
    providers: list[str]  # distinct provider names linked to this user
    created_at: datetime
    display_name: str | None  # account-tied display name (None when unset)
    # Account-synced app-icon badge preferences (migration 121).
    badge_todo_mode: bool = False
    badge_on_voting_open: bool = True
    badge_on_results: bool = True


def load_user_profile(conn, user_id: str) -> UserProfile | None:
    user_row = conn.execute(
        "SELECT id, display_name, created_at, badge_todo_mode, "
        "badge_on_voting_open, badge_on_results "
        "FROM users WHERE id = %(u)s::uuid",
        {"u": user_id},
    ).fetchone()
    if not user_row:
        return None
    identity_rows = conn.execute(
        """
        SELECT provider, email, created_at FROM user_identities
        WHERE user_id = %(u)s::uuid
        ORDER BY created_at DESC
        """,
        {"u": user_id},
    ).fetchall()
    providers = sorted({r["provider"] for r in identity_rows})
    email = next((r["email"] for r in identity_rows if r["email"]), None)
    return UserProfile(
        user_id=str(user_row["id"]),
        email=email,
        providers=providers,
        created_at=user_row["created_at"],
        display_name=user_row["display_name"],
        badge_todo_mode=bool(user_row["badge_todo_mode"]),
        badge_on_voting_open=bool(user_row["badge_on_voting_open"]),
        badge_on_results=bool(user_row["badge_on_results"]),
    )


def update_user_badge_settings(
    conn,
    *,
    user_id: str,
    todo_mode: bool,
    on_voting_open: bool,
    on_results: bool,
) -> None:
    """Set the account-synced app-icon badge preferences. Booleans only —
    the caller has already coerced. Bumps `updated_at` like the name writer."""
    conn.execute(
        """
        UPDATE users
           SET badge_todo_mode = %(todo)s,
               badge_on_voting_open = %(voting)s,
               badge_on_results = %(results)s,
               updated_at = NOW()
         WHERE id = %(u)s::uuid
        """,
        {"todo": todo_mode, "voting": on_voting_open, "results": on_results, "u": user_id},
    )


def update_user_display_name(conn, *, user_id: str, display_name: str | None) -> None:
    """Set (or clear, when `display_name` is None) the user's account-tied
    display name. Callers validate / trim the value first; this just writes
    it. `updated_at` is bumped so a future "name last changed" surface has
    a timestamp."""
    conn.execute(
        """
        UPDATE users
           SET display_name = %(n)s, updated_at = NOW()
         WHERE id = %(u)s::uuid
        """,
        {"n": display_name, "u": user_id},
    )


# ---------------------------------------------------------------------------
# Shared sign-in completion (magic-link + OAuth providers)
# ---------------------------------------------------------------------------


@dataclass
class CompletedSignIn:
    """Result of `complete_sign_in`: a freshly-issued session + the user's
    profile snapshot. Routers serialize this into their own response
    models (SessionResponse / etc.) — keeping the data shape here lets
    the magic-link and OAuth routes share one finalization rhythm."""

    session: IssuedSession
    profile: UserProfile


def complete_sign_in(
    conn,
    *,
    provider: str,
    provider_user_id: str,
    email: str | None,
    browser_id: str | None,
    user_agent: str | None,
) -> CompletedSignIn:
    """The four-step finalization shared by every sign-in provider:
    `resolve_or_merge_user` → `link_browser_to_user` → `issue_session`
    → `load_user_profile`. Magic-link verify, Google OAuth, and Apple
    OAuth all hand off here; Phase D's passkey route will too.

    `profile` is guaranteed non-None by construction — `resolve_or_merge_user`
    inserted/found a row whose id we then pass to `load_user_profile` in
    the same transaction.
    """
    resolved = resolve_or_merge_user(
        conn,
        provider=provider,
        provider_user_id=provider_user_id,
        email=email,
    )
    link_browser_to_user(conn, user_id=resolved.user_id, browser_id=browser_id)
    session = issue_session(
        conn,
        user_id=resolved.user_id,
        browser_id=browser_id,
        user_agent=user_agent,
    )
    profile = load_user_profile(conn, resolved.user_id)
    assert profile is not None, "profile must exist immediately after issue"
    return CompletedSignIn(session=session, profile=profile)
