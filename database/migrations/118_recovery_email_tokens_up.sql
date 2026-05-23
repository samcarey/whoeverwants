-- Phase I of the auth & access model (see docs/auth-access-model.md
-- → "Adding a recovery email to a passkey-only account").
--
-- Phase D lets a user create an account with a passkey and no email at
-- all (`user_identities` carries only a 'passkey' row). Losing the only
-- device with that credential strands the account. Phase I lets such
-- users attach an email after the fact as a recovery / alternate sign-in
-- path, reusing the existing magic-link machinery.
--
-- The twist: the magic-link token must be tagged with the user_id that
-- requested the attach, so the verify step knows which account to bind
-- the email to. A nullable `user_id` column on `magic_link_tokens` is
-- the lightest carrier:
--
--   * Sign-in tokens (Phase B) leave `user_id` NULL.
--   * Recovery-email-attach tokens (Phase I) set `user_id`.
--
-- The two flows are kept uncrossed by predicate:
--   * `consume_magic_link` (sign-in) adds `AND user_id IS NULL` so a
--     recovery token can never be redeemed as a fresh sign-in.
--   * `consume_recovery_email_token` (attach) adds `AND user_id IS NOT
--     NULL` so a sign-in token can never be redeemed as an attach.
--
-- ON DELETE CASCADE so deleting a user (Phase I account deletion) also
-- drops any in-flight recovery tokens they minted.

BEGIN;

ALTER TABLE magic_link_tokens
  ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
