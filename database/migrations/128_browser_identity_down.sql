-- Reverse migration 128: drop the 'browser' identity rows and restore the
-- original provider CHECK. Accounts whose ONLY identity was the browser
-- marker revert to identity-less (the pre-128 state). Durable identities
-- attached after 128 are untouched.

BEGIN;

DELETE FROM user_identities WHERE provider = 'browser';

ALTER TABLE user_identities DROP CONSTRAINT IF EXISTS user_identities_provider_check;
ALTER TABLE user_identities ADD CONSTRAINT user_identities_provider_check
  CHECK (provider IN ('email', 'apple', 'google', 'passkey'));

COMMIT;
