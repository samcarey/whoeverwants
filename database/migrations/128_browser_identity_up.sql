-- Make the browser tie a first-class (device-bound) identity so the
-- invariant "no session / account without an identity" holds literally.
--
-- The lightweight account created by the vote-first / "just provide a name"
-- path used to have ZERO user_identities rows — an identity-less account.
-- This migration models the browser tie as a real (but weak) identity
-- provider, alongside email / apple / google / passkey, so it shows up as
-- "This browser" in the account's sign-in methods and durable methods attach
-- on top of it later (upgrade in place).
--
-- provider_user_id is a fresh random marker, NOT the browser_id: the browser
-- identity is a LABEL ("this account is anchored to a browser"), never a
-- re-resolvable credential. Browser → account resolution stays via
-- `user_browsers` (unchanged). Using a random marker keeps the
-- (provider, provider_user_id) PK collision-free across sign-out/recreate and
-- merge_accounts moves, and avoids the "resurrect a deleted account by its
-- browser_id" edge cases entirely.

BEGIN;

ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_provider_check;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_check
  CHECK (provider IN ('email', 'apple', 'google', 'passkey', 'browser'));

-- Backfill: every existing identity-less account gets a 'browser' marker so
-- the invariant holds retroactively. Covers vote-first auto-accounts,
-- name-only accounts, and abandoned passkey-registration-options orphans.
-- The marker is harmless for the orphans (they remain unreachable — no session,
-- no browser link) and correct for the real browser accounts.
INSERT INTO user_identities (provider, provider_user_id, user_id, email)
SELECT 'browser', 'backfill-' || gen_random_uuid()::text, u.id, NULL
  FROM users u
 WHERE NOT EXISTS (
   SELECT 1 FROM user_identities i WHERE i.user_id = u.id
 );

COMMIT;
