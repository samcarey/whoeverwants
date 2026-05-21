-- Phase A of the auth & access model (see docs/auth-access-model.md):
-- introduces the user identity tables. Pure additive — no existing
-- columns touched, no behavior changes for anonymous flows.
--
-- Five tables:
--   `users`             — one row per real person; identity is the uuid id.
--   `user_identities`   — per (provider, account-on-that-provider) link to a
--                         user. One user can have multiple rows (one per
--                         provider). `provider_user_id` is the provider's
--                         opaque-but-stable id: normalized lowercase email
--                         for provider='email'; OAuth sub for apple/google;
--                         credential id for passkey. `email` is denormalized
--                         (per row) so cross-provider account merge on
--                         shared verified email is a single index lookup.
--   `user_browsers`     — bridges a `browser_id` to a `user_id`. One user
--                         can have N browsers; one browser can be linked
--                         to one user at a time (composite PK, no
--                         secondary uniqueness — same browser re-signing in
--                         as a different user replaces the row via
--                         `ON CONFLICT (browser_id) DO UPDATE`).
--   `sessions`          — opaque bearer tokens. Server stores only the
--                         sha256 hash of the raw token; a DB leak doesn't
--                         yield usable tokens. The raw token is sent by
--                         the FE via `Authorization: Bearer <token>` and
--                         only ever returned once (at sign-in).
--   `magic_link_tokens` — single-use email verification tokens. Same
--                         storage model as sessions (sha256 only).
--                         `used_at` flips on consume; a unique partial
--                         index would block re-issuing for the same email
--                         within the expiry window, so we instead enforce
--                         single-use via the consume UPDATE's predicate.
--
-- See `services/groups.py: load_user_visibility` for the existing
-- browser-id-only visibility model. Phase E will extend that to read
-- user_id when present and resolve all linked browsers.

BEGIN;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_identities (
  provider TEXT NOT NULL CHECK (provider IN ('email', 'apple', 'google', 'passkey')),
  provider_user_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX user_identities_user_id_idx ON user_identities (user_id);
-- Non-unique by design: the same verified email can appear on multiple
-- identity rows (e.g. Apple identity + email identity for the same
-- person, both pointing at the same user_id). Account-merge logic in
-- `services/auth.py: resolve_or_merge_user` enforces "one user per
-- email" via the lookup at INSERT time.
CREATE INDEX user_identities_email_idx ON user_identities (email);

CREATE TABLE user_browsers (
  browser_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_browsers_user_id_idx ON user_browsers (user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser_id UUID,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE magic_link_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  browser_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX magic_link_tokens_email_idx ON magic_link_tokens (email);
CREATE INDEX magic_link_tokens_expires_at_idx ON magic_link_tokens (expires_at);

COMMIT;
