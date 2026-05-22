BEGIN;

DROP INDEX IF EXISTS groups_creator_user_id_idx;
ALTER TABLE groups DROP COLUMN IF EXISTS creator_user_id;
ALTER TABLE groups DROP COLUMN IF EXISTS privacy;

COMMIT;
