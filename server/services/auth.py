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


# The device-bound "this browser" identity (migration 128). A first-class
# but weak sign-in method: it makes a vote-first / name-only account satisfy
# the "every account has an identity" invariant and surfaces as "This browser"
# in the account's sign-in methods. It is NOT a re-resolvable credential —
# `provider_user_id` is a random marker, and browser → account resolution
# stays via `user_browsers`. `account_has_durable_identity` excludes it.
BROWSER_PROVIDER = "browser"


def _insert_browser_identity(conn, *, user_id: str) -> None:
    """Attach a 'browser' identity marker to `user_id`. Idempotent-ish: a
    random `provider_user_id` means re-calling adds a second harmless marker
    rather than colliding, but callers only invoke this once at account
    mint time."""
    conn.execute(
        """
        INSERT INTO user_identities (provider, provider_user_id, user_id, email)
        VALUES (%(p)s, %(pid)s, %(u)s::uuid, NULL)
        """,
        {
            "p": BROWSER_PROVIDER,
            "pid": f"browser-{secrets.token_urlsafe(16)}",
            "u": user_id,
        },
    )


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


def resolve_existing_user_for_identity(
    conn,
    *,
    provider: str,
    provider_user_id: str,
    email: str | None,
) -> str | None:
    """Read-only sibling of `resolve_or_merge_user`: which EXISTING user does
    this identity resolve to, WITHOUT inserting anything? Returns the user_id
    via the (provider, provider_user_id) match, else the verified-email match,
    else None. Used by the explicit-merge flow to find the "other account" to
    fold into the signed-in one."""
    existing = conn.execute(
        """
        SELECT user_id FROM user_identities
        WHERE provider = %(p)s AND provider_user_id = %(pid)s
        """,
        {"p": provider, "pid": provider_user_id},
    ).fetchone()
    if existing:
        return str(existing["user_id"])
    if email:
        merged = conn.execute(
            """
            SELECT user_id FROM user_identities
            WHERE email = %(e)s
            ORDER BY created_at ASC
            LIMIT 1
            """,
            {"e": normalize_email(email)},
        ).fetchone()
        if merged:
            return str(merged["user_id"])
    return None


def merge_in_other_account(
    conn,
    *,
    current_user_id: str,
    provider: str,
    provider_user_id: str,
    email: str | None,
) -> bool:
    """Explicit two-account merge: when a signed-in user (A) proves control of
    an identity owned by a DIFFERENT existing account (B) — by completing B's
    sign-in ceremony with merge intent — fold B into A. Returns True if a merge
    happened (B existed and != A), False otherwise (identity unowned or already
    A's). After this, A owns everything B had; the caller attaches the identity
    to A (a no-op for credentials the merge already moved). The dual proof
    (A's bearer + B's just-verified ceremony) is what authorizes the merge."""
    other = resolve_existing_user_for_identity(
        conn, provider=provider, provider_user_id=provider_user_id, email=email
    )
    if other and other != current_user_id:
        merge_accounts(conn, source_user_id=other, dest_user_id=current_user_id)
        return True
    return False


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


def resolve_actor_user_id(
    conn, *, user_id: str | None, browser_id: str | None
) -> str | None:
    """The caller's effective user_id: the bearer-resolved session user_id
    when signed in, else the account linked to this browser (auto-created
    the first time the browser created a poll — see
    `create_anonymous_user`). Returns None when neither resolves (a brand-
    new anonymous browser that has never created anything).

    This is the single primitive poll authorship + `viewer_is_creator`
    are built on now that `creator_secret` is retired: a poll's
    `creator_user_id` is compared against this value. Cross-device works
    for free — signing in links the browser to the real user_id, so every
    linked browser resolves to the same account.

    Takes the already-resolved bearer user_id + browser_id as args (rather
    than the Request) to avoid a circular import on `middleware`."""
    if user_id:
        return user_id
    return get_user_id_for_browser(conn, browser_id)


def caller_browser_ids(conn, *, browser_id: str | None, user_id: str | None) -> list[str]:
    """The set of browser_ids that count as "this caller": the current browser
    plus every browser linked to their resolved account. Mirrors
    `load_user_visibility`'s union so account-aware reads (badge counts, the
    caller's own votes) span every device the user is signed in on — voting on
    one device is visible to the same account on another.

    The underlying rows (votes, poll_views, group_members) stay browser-keyed
    (written per-device); only the READ unions, exactly like group visibility.
    The nil UUID is never a legitimate identity (see BrowserIdMiddleware), so
    it's excluded."""
    # Local import keeps this low-level identity helper free of a top-level
    # services.groups import (groups → questions); matches the cycle-avoidance
    # pattern used elsewhere in services/*.
    from services.groups import NIL_UUID

    bids: set[str] = set()
    if browser_id and browser_id != NIL_UUID:
        bids.add(browser_id)
    uid = resolve_actor_user_id(conn, user_id=user_id, browser_id=browser_id)
    if uid:
        rows = conn.execute(
            "SELECT browser_id::text AS b FROM user_browsers WHERE user_id = %(u)s::uuid",
            {"u": uid},
        ).fetchall()
        bids.update(r["b"] for r in rows)
    return list(bids)


def create_anonymous_user(
    conn, *, browser_id: str | None, display_name: str | None
) -> str:
    """Mint a lightweight account for an anonymous creator and bind it to
    their browser. Used when someone who isn't signed in provides a name
    (already required to create a poll) — the name minting an account is
    what lets the server authorize their later close/reopen/cutoff without
    a per-browser secret.

    No session token is issued: the account is resolved on subsequent
    requests via the persistent `user_browsers` link (so the FE never
    perceives a "signed in" state). If `browser_id` is missing (shouldn't
    happen with BrowserIdMiddleware), the account is created unlinked and
    is effectively unmanageable — a defensive edge, not a real path.

    Such an account has no durable identity, so when this browser later
    signs in with a real identity (email / OAuth / passkey),
    `complete_sign_in` ABSORBS it into the signed-in account rather than
    orphaning its polls/groups — see `complete_sign_in` + `merge_accounts`."""
    row = conn.execute(
        "INSERT INTO users (display_name) VALUES (%(n)s) RETURNING id",
        {"n": display_name},
    ).fetchone()
    user_id = str(row["id"])
    _insert_browser_identity(conn, user_id=user_id)
    link_browser_to_user(conn, user_id=user_id, browser_id=browser_id)
    return user_id


def account_has_durable_identity(conn, user_id: str) -> bool:
    """True if the account has at least one identity that isn't bound to a
    single device — i.e. a way to sign back in from anywhere (email / apple
    / google / passkey). The `provider <> 'browser'` filter is the
    canonical "is this a real account vs. a throwaway?" predicate.

    A browser-only (or, today, identity-less) account is the weak,
    upgradeable kind created by the vote-first / name-only flow; signing in
    with a durable identity absorbs it (see `complete_sign_in`). The
    `'browser'` provider doesn't exist yet — it's introduced as a
    first-class identity in a later migration — but excluding it here now
    keeps this predicate correct across that change (today every existing
    identity is durable, so an account with ANY identity row reads as
    durable, which matches the current behavior)."""
    row = conn.execute(
        """
        SELECT 1 FROM user_identities
         WHERE user_id = %(u)s::uuid AND provider <> 'browser'
         LIMIT 1
        """,
        {"u": user_id},
    ).fetchone()
    return row is not None


def merge_accounts(conn, *, source_user_id: str, dest_user_id: str) -> None:
    """Move everything owned by `source_user_id` onto `dest_user_id`, then
    delete the source `users` row. Used by (a) sign-in absorb — folding a
    weak browser-only account into the account the user signed into — and
    (b) the explicit "combine my two accounts" flow.

    Every column that references `users(id)` (enumerated from the
    migrations) is repointed here; a missed table would either strand data
    or fail the final source-user DELETE on a FK that's CASCADE/SET NULL.
    Constrained tables (unique / partial-unique / composite PK) keep the
    DEST row on collision and drop the source's, so the keeper's state
    wins. Caller controls the transaction; this opens no connection.

    Caveat (shared device): because a browser-only account IS effectively
    "whoever is on this browser", absorbing it into the signed-in account
    moves polls created on this browser into that account. On a shared
    device that can mis-attribute the previous occupant's polls — accepted
    as the lesser evil vs. orphaning them, and the only realistic source of
    a browser-only account is the device owner's own vote-first flow."""
    if source_user_id == dest_user_id:
        return
    p = {"src": source_user_id, "dst": dest_user_id}

    # --- Identities + auth artifacts (no app-visible conflicts) ---
    # The source's device-bound 'browser' marker is meaningless once folded
    # into another account (which keeps its own identities), so drop it rather
    # than moving it — otherwise the dest accumulates redundant browser markers
    # across repeated merges. Durable identities (email/apple/google/passkey)
    # DO move. PKs are (provider, provider_user_id) / browser_id / token_hash /
    # credential_id — all globally unique, so the repoint can't collide.
    conn.execute(
        "DELETE FROM user_identities WHERE user_id = %(src)s::uuid AND provider = 'browser'",
        p,
    )
    conn.execute(
        "UPDATE user_identities SET user_id = %(dst)s::uuid WHERE user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE user_browsers SET user_id = %(dst)s::uuid WHERE user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE sessions SET user_id = %(dst)s::uuid WHERE user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE passkey_credentials SET user_id = %(dst)s::uuid WHERE user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE passkey_challenges SET user_id = %(dst)s::uuid WHERE user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE magic_link_tokens SET user_id = %(dst)s::uuid WHERE user_id = %(src)s::uuid",
        p,
    )

    # --- Authorship: the whole point of the merge ---
    conn.execute(
        "UPDATE polls SET creator_user_id = %(dst)s::uuid WHERE creator_user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE groups SET creator_user_id = %(dst)s::uuid WHERE creator_user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        "UPDATE group_invites SET created_by_user_id = %(dst)s::uuid WHERE created_by_user_id = %(src)s::uuid",
        p,
    )

    # --- group_join_requests: decided_by is unconstrained; requester has a
    # partial-unique (group_id, requester_user_id) WHERE status='pending'.
    # Drop source pending rows that would collide with a dest pending row in
    # the same group, then repoint the rest.
    conn.execute(
        "UPDATE group_join_requests SET decided_by_user_id = %(dst)s::uuid "
        "WHERE decided_by_user_id = %(src)s::uuid",
        p,
    )
    conn.execute(
        """
        DELETE FROM group_join_requests s
         WHERE s.requester_user_id = %(src)s::uuid
           AND s.status = 'pending'
           AND EXISTS (
             SELECT 1 FROM group_join_requests d
              WHERE d.requester_user_id = %(dst)s::uuid
                AND d.group_id = s.group_id
                AND d.status = 'pending'
           )
        """,
        p,
    )
    conn.execute(
        "UPDATE group_join_requests SET requester_user_id = %(dst)s::uuid "
        "WHERE requester_user_id = %(src)s::uuid",
        p,
    )

    # --- user_profiles (PK user_id): keep dest's photo if it has one. ---
    conn.execute(
        """
        UPDATE user_profiles SET user_id = %(dst)s::uuid
         WHERE user_id = %(src)s::uuid
           AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = %(dst)s::uuid)
        """,
        p,
    )
    conn.execute("DELETE FROM user_profiles WHERE user_id = %(src)s::uuid", p)

    # --- group_notification_preferences (partial-unique (user_id, group_id)):
    # dest's pref wins per group.
    conn.execute(
        """
        DELETE FROM group_notification_preferences s
         WHERE s.user_id = %(src)s::uuid
           AND EXISTS (
             SELECT 1 FROM group_notification_preferences d
              WHERE d.user_id = %(dst)s::uuid AND d.group_id = s.group_id
           )
        """,
        p,
    )
    conn.execute(
        "UPDATE group_notification_preferences SET user_id = %(dst)s::uuid "
        "WHERE user_id = %(src)s::uuid",
        p,
    )

    # --- user_contacts (PK (owner_user_id, contact_user_id)): move both
    # directions, dedupe via ON CONFLICT (newest watermark wins), and never
    # create a self-contact (owner == contact).
    conn.execute(
        """
        INSERT INTO user_contacts (owner_user_id, contact_user_id, first_seen_at, last_seen_at)
        SELECT %(dst)s::uuid, contact_user_id, first_seen_at, last_seen_at
          FROM user_contacts
         WHERE owner_user_id = %(src)s::uuid AND contact_user_id <> %(dst)s::uuid
        ON CONFLICT (owner_user_id, contact_user_id) DO UPDATE
          SET last_seen_at = GREATEST(user_contacts.last_seen_at, EXCLUDED.last_seen_at),
              first_seen_at = LEAST(user_contacts.first_seen_at, EXCLUDED.first_seen_at)
        """,
        p,
    )
    conn.execute(
        """
        INSERT INTO user_contacts (owner_user_id, contact_user_id, first_seen_at, last_seen_at)
        SELECT owner_user_id, %(dst)s::uuid, first_seen_at, last_seen_at
          FROM user_contacts
         WHERE contact_user_id = %(src)s::uuid AND owner_user_id <> %(dst)s::uuid
        ON CONFLICT (owner_user_id, contact_user_id) DO UPDATE
          SET last_seen_at = GREATEST(user_contacts.last_seen_at, EXCLUDED.last_seen_at),
              first_seen_at = LEAST(user_contacts.first_seen_at, EXCLUDED.first_seen_at)
        """,
        p,
    )
    conn.execute(
        "DELETE FROM user_contacts WHERE owner_user_id = %(src)s::uuid OR contact_user_id = %(src)s::uuid",
        p,
    )

    # --- users: give the keeper the source's display name only if it has
    # none (don't clobber the keeper's own name). Badge / recovery prefs stay
    # the keeper's. Then drop the now-empty source user.
    conn.execute(
        """
        UPDATE users SET display_name = src.display_name, updated_at = NOW()
          FROM (SELECT display_name FROM users WHERE id = %(src)s::uuid) src
         WHERE users.id = %(dst)s::uuid
           AND users.display_name IS NULL
           AND src.display_name IS NOT NULL
        """,
        p,
    )
    conn.execute("DELETE FROM users WHERE id = %(src)s::uuid", p)


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


def attach_oauth_identity(
    conn,
    *,
    user_id: str,
    provider: str,
    provider_user_id: str,
    email: str | None,
) -> str:
    """Bind an OAuth-provider identity (Google / Apple) to `user_id`.

    The signed-in counterpart to `resolve_or_merge_user`: when a user is
    ALREADY signed in (e.g. a recovery-less name-only account adding a
    recovery method), tapping "Sign in with Google" should LINK that
    Google identity to the current account, not mint / switch to a
    separate one. Returns a status discriminator mirroring
    `attach_email_identity`:

      * 'attached'       — new identity row inserted.
      * 'already_linked' — (provider, provider_user_id) already points at
                           THIS user (idempotent re-link).
      * 'conflict'       — (provider, provider_user_id) belongs to a
                           DIFFERENT user, OR the verified email is already
                           used by a different user via any provider.
                           Refused: linking would let this account claim
                           an identity another account proved control of.
    """
    existing = conn.execute(
        """
        SELECT user_id FROM user_identities
        WHERE provider = %(p)s AND provider_user_id = %(pid)s
        """,
        {"p": provider, "pid": provider_user_id},
    ).fetchone()
    if existing:
        return "already_linked" if str(existing["user_id"]) == user_id else "conflict"

    normalized = normalize_email(email) if email else None
    if normalized:
        others = conn.execute(
            """
            SELECT 1 FROM user_identities
             WHERE email = %(e)s AND user_id <> %(u)s::uuid
             LIMIT 1
            """,
            {"e": normalized, "u": user_id},
        ).fetchone()
        if others:
            return "conflict"

    conn.execute(
        """
        INSERT INTO user_identities (provider, provider_user_id, user_id, email)
        VALUES (%(p)s, %(pid)s, %(u)s::uuid, %(e)s)
        ON CONFLICT (provider, provider_user_id) DO NOTHING
        """,
        {"p": provider, "pid": provider_user_id, "u": user_id, "e": normalized},
    )
    return "attached"


def set_recovery_reminder_dismissed(conn, *, user_id: str, dismissed: bool) -> None:
    """Set the per-account 'stop reminding me to add a recovery method'
    flag (migration 123). The home-page recovery banner reads it via
    `load_user_profile`."""
    conn.execute(
        """
        UPDATE users
           SET recovery_reminder_dismissed = %(d)s, updated_at = NOW()
         WHERE id = %(u)s::uuid
        """,
        {"d": dismissed, "u": user_id},
    )


def delete_user_account(conn, user_id: str) -> bool:
    """Delete a user and everything that cascades from it.

    Every FK that references `users(id)` was declared in migrations
    112–117 with the right ON DELETE action for this single statement to
    be a clean teardown:
      * user_identities, user_browsers, sessions, passkey_credentials,
        passkey_challenges, group_join_requests.requester_user_id,
        group_invites.created_by_user_id, magic_link_tokens.user_id
        → CASCADE (rows deleted).
      * groups.creator_user_id, group_join_requests.decided_by_user_id,
        polls.creator_user_id → SET NULL (group / decision / poll
        survives, ownership cleared).

    `group_members` is keyed on browser_id (no user_id column), so the
    browser keeps its memberships and works anonymously after deletion —
    which is the intended "drop the user layer, keep the browser"
    behavior. Votes have no user FK so they survive intact. Polls survive
    too, but their `creator_user_id` is SET NULL (migration 122) — since
    that's now the sole poll-mutation authority (migration 123 retired
    `creator_secret`), a deleted creator's polls become immutable
    (close/reopen/cutoff no longer authorize). Returns True if a row was
    deleted, False if the user was already gone (idempotent)."""
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
    # Migration 123: per-account "stop nagging me to add a recovery method"
    # flag for the home-page banner shown to recovery-less accounts.
    recovery_reminder_dismissed: bool = False


def load_user_profile(conn, user_id: str) -> UserProfile | None:
    user_row = conn.execute(
        "SELECT id, display_name, created_at, badge_todo_mode, "
        "badge_on_voting_open, badge_on_results, recovery_reminder_dismissed "
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
        recovery_reminder_dismissed=bool(user_row["recovery_reminder_dismissed"]),
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

    Absorb rule: if this browser is currently on a weak account (no durable
    identity — the vote-first / name-only / auto-created throwaway) and the
    incoming identity resolves elsewhere, fold the two together instead of
    repointing the browser and orphaning the weak account's polls/groups:
      * incoming identity is BRAND NEW  → it minted an empty account; fold
        that into the existing weak account so the weak account keeps its
        polls + name and merely GAINS the durable identity (upgrade in
        place — the keeper stays the account the user already had).
      * incoming identity already EXISTS → fold the weak account's data into
        that pre-existing real account (the keeper).
    A browser already on a durable account is NOT absorbed — that's a real
    account switch, and the prior account stays recoverable.
    """
    # Captured BEFORE link_browser_to_user repoints the browser below.
    prior_user_id = get_user_id_for_browser(conn, browser_id)

    resolved = resolve_or_merge_user(
        conn,
        provider=provider,
        provider_user_id=provider_user_id,
        email=email,
    )
    keeper_user_id = resolved.user_id

    if (
        prior_user_id
        and prior_user_id != keeper_user_id
        and not account_has_durable_identity(conn, prior_user_id)
    ):
        if resolved.is_new_user:
            merge_accounts(
                conn, source_user_id=keeper_user_id, dest_user_id=prior_user_id
            )
            keeper_user_id = prior_user_id
        else:
            merge_accounts(
                conn, source_user_id=prior_user_id, dest_user_id=keeper_user_id
            )

    link_browser_to_user(conn, user_id=keeper_user_id, browser_id=browser_id)
    session = issue_session(
        conn,
        user_id=keeper_user_id,
        browser_id=browser_id,
        user_agent=user_agent,
    )
    profile = load_user_profile(conn, keeper_user_id)
    assert profile is not None, "profile must exist immediately after issue"
    return CompletedSignIn(session=session, profile=profile)


def create_name_only_account(
    conn,
    *,
    display_name: str,
    browser_id: str | None,
    user_agent: str | None,
) -> CompletedSignIn:
    """Create a recovery-less account from just a display name.

    Mints a `users` row with the given name + a device-bound `browser`
    identity (so `providers` is `['browser']` — it satisfies the
    "every account has an identity" invariant and shows as "This browser",
    but there's no DURABLE way to sign back in if the device is lost),
    links the browser, and issues a session. The FE nudges the user to
    add a recovery method afterwards via the home-page banner (gated on
    `recovery_reminder_dismissed`; `hasRecoveryMethod` ignores `browser`).

    Existing group memberships (keyed on browser_id) carry over for free:
    `load_user_visibility` unions the browser's own `group_members` rows
    with those of every browser linked to the new user_id, and this
    browser is now linked.
    """
    new_row = conn.execute(
        "INSERT INTO users (display_name) VALUES (%(n)s) RETURNING id",
        {"n": display_name},
    ).fetchone()
    user_id = str(new_row["id"])
    _insert_browser_identity(conn, user_id=user_id)
    link_browser_to_user(conn, user_id=user_id, browser_id=browser_id)
    session = issue_session(
        conn, user_id=user_id, browser_id=browser_id, user_agent=user_agent
    )
    profile = load_user_profile(conn, user_id)
    assert profile is not None, "profile must exist immediately after insert"
    return CompletedSignIn(session=session, profile=profile)
