-- Revert user_profiles to per-browser keying (migration 124).
--
-- LOSSY: the original browser_id → image mapping cannot be reconstructed from
-- the user_id-keyed rows, so this restores the column SHAPE only. Existing
-- account-keyed photos are dropped (a browser_id PK can't be NULL); affected
-- users would re-upload under the per-browser model.

BEGIN;

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;
DELETE FROM user_profiles;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS user_id;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS browser_id UUID;
ALTER TABLE user_profiles ALTER COLUMN browser_id SET NOT NULL;
ALTER TABLE user_profiles ADD PRIMARY KEY (browser_id);

COMMIT;
