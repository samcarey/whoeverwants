-- Phase D of the auth & access model (see docs/auth-access-model.md):
-- adds WebAuthn passkey credentials. Pure additive — no existing
-- columns touched. The `user_identities` constraint already allows
-- provider='passkey' (set in migration 112).
--
-- Two tables:
--   `passkey_credentials` — one row per registered authenticator key.
--                         `credential_id` is the WebAuthn credential id
--                         (base64url-encoded) and is the natural unique
--                         identity for a passkey. `public_key` stores
--                         the COSE-encoded public key as bytes (verifier
--                         needs the raw bytes, not a base64 wrapper).
--                         `sign_count` is the authenticator's signature
--                         counter; we advance it on every successful
--                         assertion to detect cloned authenticators.
--                         `name` is an optional human label set at
--                         registration ("iCloud Keychain", "YubiKey 5"
--                         etc.) for the settings UI.
--   `passkey_challenges`  — short-lived (5 min) per-(browser, kind)
--                         challenge cache. The server hands a challenge
--                         to the FE in step 1 of registration /
--                         authentication; the FE feeds it to the
--                         authenticator; in step 2 the FE returns the
--                         signed assertion + the original challenge,
--                         and the server verifies the signed challenge
--                         matches. State lives server-side so the FE
--                         can't replay an old challenge or pick its
--                         own. (browser_id, kind) PK means one
--                         in-flight ceremony of each kind per browser
--                         at a time — re-running register/authenticate
--                         options before consuming overwrites the old
--                         challenge, which matches user intent ("the
--                         freshest options request is the one I'm
--                         using").
--
-- Sign-count clone-detection: when an assertion comes back with a
-- sign_count <= the stored value AND the stored value isn't 0, treat as
-- a potential clone — log + reject. Some authenticators (notably iCloud
-- Keychain) intentionally always return 0; we accept those by checking
-- `stored = 0` as well.

BEGIN;

CREATE TABLE passkey_credentials (
  credential_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BYTEA NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0,
  transports TEXT,  -- comma-separated WebAuthn transports (e.g. "internal,hybrid")
  aaguid TEXT,      -- authenticator model identifier; lets us name a default ("Touch ID") in the UI
  name TEXT,        -- optional user-supplied label
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX passkey_credentials_user_id_idx ON passkey_credentials (user_id);

CREATE TABLE passkey_challenges (
  browser_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  challenge TEXT NOT NULL,  -- base64url-encoded random bytes
  -- For registration: the user_id the challenge was minted for (registration
  -- requires a signed-in user). For authentication: NULL (no user required;
  -- assertion's credential_id tells us which user).
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (browser_id, kind)
);
CREATE INDEX passkey_challenges_expires_at_idx ON passkey_challenges (expires_at);

COMMIT;
