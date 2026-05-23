-- Account-tied display name.
--
-- A user's display name (the "your name" used to auto-fill voting forms /
-- creator name) is per-browser localStorage by default. Once a user signs
-- in, the name becomes tied to their account so it follows them across
-- devices: sign-in mirrors the account name down to local storage, and
-- changing the name while signed in pushes it back up here.
--
-- Nullable: an account can exist without a name (passkey-only / OAuth
-- accounts that never set one). The FE clears this to NULL when the user
-- clears their name while signed in.

BEGIN;

ALTER TABLE users ADD COLUMN display_name TEXT;

COMMIT;
